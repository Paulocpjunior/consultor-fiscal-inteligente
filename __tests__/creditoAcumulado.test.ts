/**
 * QUEM GERA CRÉDITO ACUMULADO DE ICMS EM SP — e quem só PARECE gerar.
 *
 * Antes de construir o arquivo do e-CredAc pra possivelmente ninguém (foi o
 * que os dados responderam sobre o SAT, o regime de caixa, o E310 e o bloco K),
 * a pergunta é quantos clientes realmente acumulam.
 *
 * O que este teste protege, e é a parte que importa: SALDO CREDOR SOZINHO NÃO
 * É CRÉDITO ACUMULADO. Sem uma hipótese do art. 71 do RICMS, empresa credora
 * todo mês quase sempre está com SAÍDA FALTANDO na captura — e mandar abrir
 * processo no e-CredAc em cima de livro incompleto seria pior que não ter a
 * ferramenta.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { apurarCompetencia, detectarHipotesesArt71, classificarEmpresa, montarPainelCreditoAcumulado } from '../sefaz-backend/credito-acumulado';

const item = (over: any = {}) => ({ cfop: '5102', cst: '000', vBC: 1000, vICMS: 180, vProd: 1000, ...over });
const nota = (over: any = {}) => ({
    direcao: 'saida', status: 'autorizado', modelo: '55', itens: [item()], ...over,
});

describe('apuração simplificada: débito × crédito', () => {
    it('saída maior que entrada é devedora', () => {
        const a = apurarCompetencia([
            nota({ itens: [item({ vICMS: 500 })] }),
            nota({ direcao: 'entrada', itens: [item({ vICMS: 200 })] }),
        ]);
        expect(a.debitos).toBe(500);
        expect(a.creditos).toBe(200);
        expect(a.saldo).toBe(300);
        expect(a.credor).toBe(false);
    });

    it('entrada maior que saída é credora, com o valor', () => {
        const a = apurarCompetencia([
            nota({ itens: [item({ vICMS: 100 })] }),
            nota({ direcao: 'entrada', itens: [item({ vICMS: 400 })] }),
        ]);
        expect(a.credor).toBe(true);
        expect(a.credorValor).toBe(300);
    });

    it('nota cancelada e modelo fora de 55/65 não entram (mesma régua do E110)', () => {
        const a = apurarCompetencia([
            nota({ status: 'cancelado', itens: [item({ vICMS: 999 })] }),
            nota({ modelo: '57', itens: [item({ vICMS: 999 })] }),
        ]);
        expect(a.debitos).toBe(0);
    });
});

describe('hipóteses do art. 71 (RICMS/SP)', () => {
    it('exportação (CFOP 7xxx) é a hipótese II — a mais fácil de provar', () => {
        const h = detectarHipotesesArt71([nota({ itens: [item({ cfop: '7102', vICMS: 0 })] })]);
        expect(h.exportacao).toBe(1);
    });

    it('saída isenta/não tributada com produto conta como hipótese', () => {
        const h = detectarHipotesesArt71([nota({ itens: [item({ cst: '040', vICMS: 0 })] })]);
        expect(h.isentaComCredito).toBe(1);
    });

    it('ST (CST 60) NÃO é hipótese — o débito existe, só foi retido antes', () => {
        const h = detectarHipotesesArt71([nota({ itens: [item({ cst: '060', vICMS: 0 })] })]);
        expect(h.isentaComCredito).toBe(0);
    });

    it('diferimento (CST 51) também não — inventaria hipótese que a lei não dá', () => {
        expect(detectarHipotesesArt71([nota({ itens: [item({ cst: '051', vICMS: 0 })] })]).isentaComCredito).toBe(0);
    });

    it('redução de base é sinalizada', () => {
        expect(detectarHipotesesArt71([nota({ itens: [item({ pRedBC: 41.67 })] })]).reducaoBase).toBe(1);
    });

    it('alíquota de saída MENOR que a de entrada é a hipótese I', () => {
        const h = detectarHipotesesArt71([
            nota({ itens: [item({ vBC: 1000, vICMS: 70 })] }),                    // 7% saída
            nota({ direcao: 'entrada', itens: [item({ vBC: 1000, vICMS: 180 })] }), // 18% entrada
        ]);
        expect(h.aliqSaida).toBe(7);
        expect(h.aliqEntrada).toBe(18);
        expect(h.aliquotaMenor).toBe(true);
    });

    it('diferença de arredondamento (menos de 1 ponto) NÃO é alíquota diversa', () => {
        const h = detectarHipotesesArt71([
            nota({ itens: [item({ vBC: 1000, vICMS: 175 })] }),
            nota({ direcao: 'entrada', itens: [item({ vBC: 1000, vICMS: 180 })] }),
        ]);
        expect(h.aliquotaMenor).toBe(false);
    });

    it('sem base de cálculo a alíquota é NULL, não zero', () => {
        // Zero faria toda empresa sem item lido parecer geradora.
        const h = detectarHipotesesArt71([]);
        expect(h.aliqSaida).toBeNull();
        expect(h.aliqEntrada).toBeNull();
        expect(h.aliquotaMenor).toBe(false);
    });
});

describe('o veredito da empresa', () => {
    const mes = (over: any = {}) => ({
        competencia: '2026-06', credor: false, credorValor: 0, itensLidos: 5,
        exportacao: 0, isentaComCredito: 0, reducaoBase: 0, aliquotaMenor: false, ...over,
    });

    it('credor recorrente COM hipótese é candidata real ao e-CredAc', () => {
        const v = classificarEmpresa([
            mes({ credor: true, credorValor: 5000, exportacao: 3 }),
            mes({ competencia: '2026-07', credor: true, credorValor: 4000, exportacao: 2 }),
        ]);
        expect(v.situacao).toBe('gerador-recorrente');
        expect(v.credorValor).toBe(9000);
        expect(v.acao).toMatch(/e-CredAc/);
    });

    it('credor recorrente SEM hipótese é SAÍDA FALTANDO, não crédito acumulado', () => {
        // O achado que mais importa: mandar abrir processo no e-CredAc em cima
        // de livro incompleto seria pior que não ter a ferramenta.
        const v = classificarEmpresa([
            mes({ credor: true, credorValor: 5000 }),
            mes({ competencia: '2026-07', credor: true, credorValor: 4000 }),
        ]);
        expect(v.situacao).toBe('credor-sem-hipotese');
        expect(v.acao).toMatch(/SAÍDA FALTANDO/);
        expect(v.acao).toMatch(/Cobertura de Saída/);
    });

    it('um mês credor só não caracteriza acúmulo', () => {
        expect(classificarEmpresa([
            mes({ credor: true, credorValor: 900, exportacao: 1 }),
            mes({ competencia: '2026-07' }),
        ]).situacao).toBe('gerador-pontual');
    });

    it('devedor em todos os meses é o caso normal', () => {
        expect(classificarEmpresa([mes(), mes({ competencia: '2026-07' })]).situacao).toBe('devedor');
    });

    it('sem competência nenhuma NÃO conclui — nem "devedor", nem "gerador"', () => {
        const v = classificarEmpresa([]);
        expect(v.situacao).toBe('sem-dados');
        expect(v.acao).toMatch(/rode a captura/i);
    });

    it('mês SEM item lido não vota na hipótese — ausente ≠ sem hipótese', () => {
        const v = classificarEmpresa([
            mes({ credor: true, credorValor: 100, itensLidos: 0 }),
            mes({ competencia: '2026-07', credor: true, credorValor: 100, itensLidos: 0 }),
        ]);
        // Sem item, nenhuma hipótese pôde ser vista — cai no alerta de saída
        // faltando, que é o veredito CONSERVADOR e o que manda conferir.
        expect(v.situacao).toBe('credor-sem-hipotese');
    });
});

describe('painel da carteira', () => {
    const empresas = [
        { empresaId: 'a', nome: 'EXPORTADORA', cnpj: '1', regime: 'lucro' },
        { empresaId: 'b', nome: 'NORMAL', cnpj: '2', regime: 'lucro' },
        { empresaId: 's', nome: 'OPTANTE', cnpj: '3', regime: 'simples' },
    ];
    const credoraComExportacao = [
        nota({ itens: [item({ cfop: '7102', vBC: 1000, vICMS: 0 })] }),
        nota({ direcao: 'entrada', itens: [item({ vICMS: 400 })] }),
    ];
    const devedora = [
        nota({ itens: [item({ vICMS: 500 })] }),
        nota({ direcao: 'entrada', itens: [item({ vICMS: 100 })] }),
    ];

    const painel = () => montarPainelCreditoAcumulado(empresas, {
        a: { '2026-06': credoraComExportacao, '2026-07': credoraComExportacao },
        b: { '2026-06': devedora, '2026-07': devedora },
        s: { '2026-06': credoraComExportacao, '2026-07': credoraComExportacao },
    });

    it('optante do Simples fica FORA — não apura ICMS por conta gráfica', () => {
        const p = painel();
        expect(p.linhas.map((l: any) => l.nome)).toEqual(['EXPORTADORA', 'NORMAL']);
    });

    it('quem precisa de ação vem primeiro', () => {
        expect(painel().linhas[0].situacao).toBe('gerador-recorrente');
    });

    it('o aviso NUNCA esconde que esta conta é um SINAL, não a apuração', () => {
        // Ela não inclui os ajustes do E111 nem o saldo de meses anteriores.
        expect(painel().avisos.join(' ')).toMatch(/SINAL, não a apuração/);
        expect(painel().avisos.join(' ')).toMatch(/E111/);
    });

    it('zero gerador é RESPOSTA de F0: o e-CredAc não atende ninguém hoje', () => {
        const p = montarPainelCreditoAcumulado(
            [{ empresaId: 'b', nome: 'NORMAL', cnpj: '2', regime: 'lucro' }],
            { b: { '2026-06': devedora, '2026-07': devedora } },
        );
        expect(p.resumo.geradorRecorrente).toBe(0);
        expect(p.avisos.join(' ')).toMatch(/não atende ninguém hoje/);
        // …e continua mandando rodar mais competências antes de concluir.
        expect(p.avisos.join(' ')).toMatch(/mês atípico esconde sinal/);
    });

    it('empresa credora sem hipótese acende alarme de captura, não de crédito', () => {
        const semSaida = [nota({ direcao: 'entrada', itens: [item({ vICMS: 400 })] })];
        const p = montarPainelCreditoAcumulado(
            [{ empresaId: 'c', nome: 'SEM SAÍDA', cnpj: '4', regime: 'lucro' }],
            { c: { '2026-06': semSaida, '2026-07': semSaida } },
        );
        expect(p.resumo.credorSemHipotese).toBe(1);
        expect(p.avisos.join(' ')).toMatch(/saída faltando na captura/);
    });
});

// ═══ A NOTA COMO ELA CHEGA DA CAPTURA — e não como o fixture a inventa ══════
//
// 21/08, varredura noturna dos leitores de DOCUMENTO. `detectarHipotesesArt71`
// lia `status !== 'autorizado'` e `String(n.modelo)` — as MESMAS duas leituras
// cruas que zeraram a apuração da PS VIDROS em 19/08. O importer principal NÃO
// grava `modelo` (ele mora na CHAVE) e o cancelamento chega por EVENTO.
//
// O efeito era PERVERSO e invisível: `apurarCompetencia` usa a régua
// (somarIcmsPorDirecao) e ENXERGA as notas; a detecção das hipóteses lia ZERO
// itens. A empresa aparecia credora todo mês e SEM hipótese legal — indo para
// o balde "provavelmente falta saída na captura" quando podia ser exportadora.
// Os 22 testes existentes passavam porque TODO fixture traz modelo e status.
describe('🚨 documento CAPTURADO (sem `modelo`, cancelado por evento)', () => {
    const CHAVE_55 = '35260731947349000169550010000000031705547508';
    /** Como o importer principal grava: sem `modelo`, modelo só na chave. */
    const capturada = (over: any = {}) => ({
        direcao: 'saida', status: 'autorizado', chave: CHAVE_55,
        itens: [item({ cfop: '7102', vICMS: 0 })], ...over,
    });

    it('exportação é reconhecida na nota SEM o campo modelo — era zero antes', () => {
        const h = detectarHipotesesArt71([capturada()]);
        expect(h.itensLidos).toBe(1);
        expect(h.exportacao).toBe(1);
    });

    it('a detecção olha os MESMOS documentos que a apuração soma', () => {
        // Se os dois conjuntos divergirem, o painel diz "credora sem hipótese"
        // sobre uma empresa cuja saída ele mesmo somou.
        const notas = [
            capturada({ itens: [item({ cfop: '7102', vICMS: 0, vBC: 0 })] }),
            capturada({ direcao: 'entrada', itens: [item({ vICMS: 400 })] }),
        ];
        expect(apurarCompetencia(notas).credor).toBe(true);
        expect(detectarHipotesesArt71(notas).itensLidos).toBe(2);
    });

    it('cancelada por EVENTO fica de fora da detecção, como fica da soma', () => {
        const cancelada = capturada({ eventos: [{ tpEvento: '110111', cStat: '135' }] });
        expect(detectarHipotesesArt71([cancelada]).itensLidos).toBe(0);
        expect(apurarCompetencia([cancelada]).debitos).toBe(0);
    });

    it('NFS-e não entra na conta do ICMS (a régua de mercadoria decide)', () => {
        const nfse = { direcao: 'saida', tipoDoc: 'NFSe', prestador: {}, itens: [item()] };
        expect(detectarHipotesesArt71([nfse]).itensLidos).toBe(0);
    });
});
