// ============================================================================
// A NOTA PRÓPRIA DE ENTRADA VOLTOU A VIRAR "SAÍDA" — e o FUNRURAL contou a
// nota do PRODUTOR no lugar da nota da empresa.
//
// Paulo, 14/08, urgente (NOVA ERA 29.240.822/0001-21, competência 07/2026):
// *"o CFI está levando a notas dele e não está considerando a da NOVA ERA"* —
// notas 255273, 255274, 255585, 255746, 256121, 256336, 256341, 256445, 256580,
// 257257, 257427, 258043, de JOSE D. KOKI, EWERTON RENE, NUNO MONTEIRO e COSME
// QUEIROZ. Ele desconfiou do CADASTRO dos produtores; o defeito estava antes
// disso, no IMPORT.
//
// ═══ A CADEIA, do defeito ao sintoma ════════════════════════════════════════
//
// Compra de produtor rural PF é **NOTA PRÓPRIA DE ENTRADA** (RICMS/SP art. 136,
// I, "a"): o produtor não emite NF-e, então quem emite é o ADQUIRENTE, com
// `tpNF=0`. A nota tem `emit = NOVA ERA` e mesmo assim é ENTRADA.
//
//   1. o import decidiu "emit == empresa ⇒ SAÍDA" e ignorou o tpNF
//   2. a DIPAM/FUNRURAL só olha ENTRADAS ⇒ a nota da NOVA ERA sumiu da conta
//   3. sem ela, `dedupNotaProdutorComEntrada` não acha a nota própria que COBRE
//      a NF-e do produtor ⇒ a NF-e DELE deixa de ser excluída
//   4. o FUNRURAL passa a sair da nota do produtor — exatamente o documento que
//      o art. 136 manda NÃO escriturar
//
// ═══ E POR QUE ISSO REAPARECEU ══════════════════════════════════════════════
//
// A régua foi escrita em 31/07 (caso EDUARDO GUERRA) dentro do `xml-importer`.
// O caminho de importação MANUAL do frontend tinha a **segunda cópia**, e ela
// nunca recebeu a correção. Régua fiscal com duas cópias diverge — e diverge em
// silêncio, porque nada quebra: a nota entra, só entra do lado errado.
// ============================================================================
import {
    decidirDirecaoPorTpNF,
    direcaoEfetivaDoc,
    ehNotaPropriaDeEntrada,
} from '../sefaz-backend/xml-metadata-helper.js';
import {
    classificarNota,
    dedupNotaProdutorComEntrada,
    agruparTiradosPorDecisao,
} from '../sefaz-backend/dipam-produtor-rural.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const NOVA_ERA = '29240822000121';
const NUNO = '00341924172';       // CPF, como o Paulo apontou
const EWERTON = '15097921000353'; // CNPJ — produtor PF com CNPJ (CAT 45/2008)

describe('o caso REAL da NOVA ERA', () => {
    it('nota própria de ENTRADA (tpNF=0) da NOVA ERA é ENTRADA, não saída', () => {
        // É a nota 255585 e as outras onze: emit = NOVA ERA, produtor no
        // destinatário, tpNF=0.
        expect(decidirDirecaoPorTpNF(NOVA_ERA, NUNO, NOVA_ERA, '0')).toBe('entrada');
        expect(decidirDirecaoPorTpNF(NOVA_ERA, EWERTON, NOVA_ERA, '0')).toBe('entrada');
    });

    it('venda de verdade (tpNF=1) continua saída — a correção não inverteu nada', () => {
        expect(decidirDirecaoPorTpNF(NOVA_ERA, '11222333000181', NOVA_ERA, '1')).toBe('saida');
    });

    it('sem tpNF, emitente continua saída — é o comportamento antigo, e é o certo', () => {
        // Documento sem o campo não vira entrada por dedução: ausência não é
        // prova, e transformar toda nota antiga em entrada seria pior.
        expect(decidirDirecaoPorTpNF(NOVA_ERA, '11222333000181', NOVA_ERA, null)).toBe('saida');
    });

    it('quando a empresa é a DESTINATÁRIA, o tpNF não muda nada', () => {
        // O tpNF é do EMITENTE. Lê-lo do lado de quem recebe seria inverter a
        // compra de um fornecedor comum.
        expect(decidirDirecaoPorTpNF('11222333000181', NOVA_ERA, NOVA_ERA, '0')).toBe('entrada');
        expect(decidirDirecaoPorTpNF('11222333000181', NOVA_ERA, NOVA_ERA, '1')).toBe('entrada');
    });

    it('CPF no destinatário não confunde — o eixo é o CNPJ da EMPRESA', () => {
        // Era a suspeita do Paulo ("a nota dele já vem com o CPF"). O CPF do
        // produtor nunca decidiu a direção; quem decidia era o `emit ===
        // empresa` sem tpNF.
        expect(decidirDirecaoPorTpNF(NOVA_ERA, NUNO, NOVA_ERA, '0')).toBe('entrada');
        expect(decidirDirecaoPorTpNF(NUNO, NOVA_ERA, NOVA_ERA, '1')).toBe('entrada');
    });
});

describe('a consequência: a dedup do art. 136 escolhia a nota ERRADA', () => {
    const nota = (over: Record<string, unknown> = {}) => ({
        chave: 'x', numero: '1', dhEmi: '2026-07-10', valor: 10000,
        fornecedor: { doc: NUNO, nome: 'NUNO MONTEIRO' },
        competencia: '2026-07',
        notaPropria: false,
        direcao: 'entrada',
        dipam: { aplica: true }, funrural: { aplica: true },
        ...over,
    });

    it('COM a nota própria de entrada, a NF-e do produtor sai da conta', () => {
        const r = dedupNotaProdutorComEntrada([
            nota({ numero: '255585', notaPropria: true }),
            nota({ numero: '900', notaPropria: false }),
        ]);
        const doProdutor = r.find((n: any) => n.numero === '900');
        const daEmpresa = r.find((n: any) => n.numero === '255585');
        expect(doProdutor.funrural.aplica).toBe(false);
        expect(doProdutor.notaOrigemProdutor).toBe(true);
        // A da EMPRESA é a que fica — é ela que se escritura (art. 136, I, "a").
        expect(daEmpresa.funrural.aplica).toBe(true);
    });

    it('SEM ela — que era o efeito do bug — a nota do produtor entra sozinha', () => {
        // Este teste descreve o ESTRAGO, e é por isso que ele existe: enquanto
        // a nota própria estava gravada como 'saida', ela não chegava aqui, e
        // a dedup não tinha o que parear. O FUNRURAL saía da nota do produtor.
        const r = dedupNotaProdutorComEntrada([nota({ numero: '900', notaPropria: false })]);
        expect(r[0].funrural.aplica).toBe(true);
        expect(r[0].notaOrigemProdutor).toBeUndefined();
    });
});

// ============================================================================
// "A CORREÇÃO SUBIU E O NÚMERO NÃO MUDOU" — e a explicação NÃO era a que eu dei.
//
// Paulo, 14/08, com os deploys 488-490 já verdes: *"vamos ter que voltar … Não
// subiu"*. Eu concluí que faltava alcançar documentos gravados sem `tpNF` e
// acrescentei uma prova pelo CFOP. Errado nos dois níveis:
//
//   · a causa real era outra — os produtores estavam FORA por DECISÃO gravada
//     (o ✕ do cadastro), então a régua automática nem rodava neles;
//   · e as notas SEMPRE tiveram `tpNF` (a própria tela provou, mostrando a
//     prova `tpNF` e não `cfop-de-entrada`).
//
// A prova pelo CFOP foi revertida: ela lia `itens`, que três dos quatro
// consumidores de `direcaoEfetivaDoc` não projetam — e o MESMO documento
// passou a sair `entrada` na base de crédito de PIS/COFINS e `saida` no
// faturamento. Os testes abaixo travam as duas coisas.
// ============================================================================
describe('a direção NÃO se deduz do CFOP — e o motivo é medido, não opinião', () => {
    // Em 14/08 eu pus aqui uma segunda prova ("emitida pela empresa + CFOP de
    // entrada"). Ela criava DUAS LEITURAS DO MESMO DADO, porque três dos quatro
    // consumidores de `direcaoEfetivaDoc` leem o documento com `.select()` de
    // projeção — e nenhuma projeção traz `itens` (é justamente o campo pesado
    // que elas evitam). Medido: o MESMO doc saía `entrada` na base de crédito
    // de PIS/COFINS e `saida` no faturamento.
    const comoEstaNoBanco = {
        direcao: 'saida',
        empresaCnpj: NOVA_ERA,
        cnpjEmit: NOVA_ERA,
        itens: [{ cfop: '1102' }],
    };

    it('CFOP de entrada em nota da empresa NÃO vira entrada sozinho', () => {
        expect(ehNotaPropriaDeEntrada(comoEstaNoBanco, NOVA_ERA).sim).toBe(false);
        expect(direcaoEfetivaDoc(comoEstaNoBanco)).toBe('saida');
    });

    it('com o tpNF gravado, vira — e a prova é nomeada', () => {
        const r = ehNotaPropriaDeEntrada({ ...comoEstaNoBanco, tpNF: '0' }, NOVA_ERA);
        expect(r).toEqual({ sim: true, prova: 'tpNF' });
    });

    it('nota de TERCEIRO não vira nota própria nossa', () => {
        // tpNF=0 de outro emitente é a nota de entrada DELE.
        const deTerceiro = { direcao: 'entrada', empresaCnpj: NOVA_ERA, cnpjEmit: '11222333000181', tpNF: '0' };
        expect(ehNotaPropriaDeEntrada(deTerceiro, NOVA_ERA).sim).toBe(false);
    });
});

// ============================================================================
// A TRAVA QUE FICA: régua de LEITURA só pode usar campo que TODO chamador traz.
//
// `direcaoEfetivaDoc` é lida em quatro lugares, e três consultam com `.select()`
// — faturamento, Livro e conferência de chaves. Nenhuma dessas projeções traz
// `itens` (é justamente o campo pesado que elas evitam) nem `cnpjEmit`.
//
// Quando acrescentei a prova pelo CFOP, a régua passou a olhar `itens`: medido,
// o MESMO documento saía `entrada` na base de crédito de PIS/COFINS (que lê o
// doc inteiro) e `saida` no faturamento (projetado). Duas leituras do mesmo
// dado discordando é a armadilha que mais mordeu este projeto.
//
// A trava é o CONTRATO, e por isso não tem falso positivo: a resposta pode
// depender de `direcao` e `tpNF`, e de mais nada. Campo novo na régua faz este
// teste cair na hora — que é o momento certo de perguntar se TODAS as projeções
// o trazem.
// ============================================================================
describe('a direção EFETIVA depende só de `direcao` e `tpNF`', () => {
    const CAMPOS_PERMITIDOS = ['direcao', 'tpNF'];

    const casos: Array<[string, Record<string, unknown>]> = [
        ['nota própria de entrada', {
            direcao: 'saida', tpNF: '0', status: 'autorizado', valorTotal: 100,
            empresaCnpj: NOVA_ERA, cnpjEmit: NOVA_ERA, itens: [{ cfop: '1102' }],
        }],
        ['venda comum', {
            direcao: 'saida', tpNF: '1', status: 'autorizado', valorTotal: 100,
            empresaCnpj: NOVA_ERA, cnpjEmit: NOVA_ERA, itens: [{ cfop: '5102' }],
        }],
        ['compra de fornecedor', {
            direcao: 'entrada', tpNF: '1', status: 'autorizado', valorTotal: 100,
            empresaCnpj: NOVA_ERA, cnpjEmit: '11222333000181', itens: [{ cfop: '1102' }],
        }],
        ['sem tpNF gravado', {
            direcao: 'saida', status: 'autorizado', valorTotal: 100,
            empresaCnpj: NOVA_ERA, cnpjEmit: NOVA_ERA, itens: [{ cfop: '1102' }],
        }],
    ];

    it.each(casos)('%s: o documento REDUZIDO responde igual ao inteiro', (_nome, completo) => {
        const reduzido: Record<string, unknown> = {};
        for (const c of CAMPOS_PERMITIDOS) if (c in completo) reduzido[c] = completo[c];
        expect(direcaoEfetivaDoc(reduzido)).toBe(direcaoEfetivaDoc(completo));
    });

    it('e as projeções que alimentam a régua trazem os dois campos', () => {
        // Varredura: `.select()` que traz `direcao` num arquivo que decide
        // direção pela régua tem que trazer `tpNF` junto — senão a régua recebe
        // um campo que pode mentir e não recebe o que o desmente.
        const ROTAS = [
            'sefaz-backend/relatorios-routes.js',
            'sefaz-backend/pis-cofins-credito-routes.js',
        ];
        for (const rota of ROTAS) {
            const fonte = readFileSync(join(__dirname, '..', rota), 'utf8');
            const re = /\.select\(([^)]*)\)/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(fonte)) !== null) {
                const campos = m[1];
                if (!campos.includes("'direcao'")) continue;
                expect(`${rota}: ${campos}`).toContain("'tpNF'");
            }
        }
    });
});

describe('ponta a ponta: a nota do banco chega no FUNRURAL do lado certo', () => {
    // É a composição que roda em produção — e era só ela que ninguém testava.
    // Cada peça passava fazendo o que o próprio teste mandava (a família do
    // IPI no E200 e do Bloco H zerado).
    const notaDaNovaEra = {
        chave: '3'.repeat(44),
        numero: '255585',
        dhEmi: '2026-07-10',
        competencia: '2026-07',
        direcao: 'saida',            // ← como o campo está gravado
        tpNF: '0',                   // ← e é o tpNF que desmente o campo
        empresaCnpj: NOVA_ERA,
        cnpjEmit: NOVA_ERA,
        emitente: { cnpjCpf: NOVA_ERA, nome: 'NOVA ERA' },
        destinatario: { cnpjCpf: NUNO, nome: 'NUNO MONTEIRO', uf: 'SP', ie: 'P4111111111' },
        itens: [{ cfop: '1101', ncm: '08039000' }],
        totais: { vNF: 10000 },
    };

    it('classificarNota devolve ENTRADA, notaPropria e o PRODUTOR como contraparte', () => {
        const n = classificarNota(notaDaNovaEra, { empresa: { cnpj: NOVA_ERA } });
        expect(n.direcao).toBe('entrada');
        expect(n.notaPropria).toBe(true);
        // A contraparte é o DESTINATÁRIO — na nota própria o produtor está lá.
        expect(n.fornecedor.doc).toBe(NUNO);
    });

    it('e com ela na lista, a NF-e do produtor SAI do FUNRURAL (art. 136)', () => {
        const daEmpresa = classificarNota(notaDaNovaEra, { empresa: { cnpj: NOVA_ERA } });
        const doProdutor = classificarNota({
            chave: '4'.repeat(44),
            numero: '900',
            dhEmi: '2026-07-10',
            competencia: '2026-07',
            direcao: 'entrada',
            empresaCnpj: NOVA_ERA,
            cnpjEmit: NUNO,
            emitente: { cnpjCpf: NUNO, nome: 'NUNO MONTEIRO', uf: 'SP', ie: 'P4111111111' },
            destinatario: { cnpjCpf: NOVA_ERA, nome: 'NOVA ERA' },
            itens: [{ cfop: '1101', ncm: '08039000' }],
            totais: { vNF: 10000 },
        }, { empresa: { cnpj: NOVA_ERA } });

        // Guarda: se o FUNRURAL não aplicasse nas duas, a dedup abaixo não
        // provaria nada — passaria verde por não ter o que deduplicar.
        expect(daEmpresa.funrural.aplica).toBe(true);
        expect(doProdutor.funrural.aplica).toBe(true);

        const r = dedupNotaProdutorComEntrada([daEmpresa, doProdutor]);
        expect(r.find((n: any) => n.numero === '900').funrural.aplica).toBe(false);
        expect(r.find((n: any) => n.numero === '255585').funrural.aplica).toBe(true);
    });
});

describe('o import manual grava o que o conserto do histórico precisa', () => {
    const parser = readFileSync(join(__dirname, '..', 'services/xmlParserService.ts'), 'utf8');

    it('o parser LÊ o tpNF do <ide>', () => {
        expect(parser).toMatch(/tpNF: getTextContent\(ide, 'tpNF'\) \|\| null/);
    });

    it('e GRAVA no documento — campo só em memória não conserta banco', () => {
        // `corrigirDirecaoEntradaPropria` (backfill do sync-cron) reconhece a
        // nota própria por tpNF==0 + direcao=='saida' + emit==empresa. Sem o
        // campo gravado, ele não tem como achar o que precisa consertar.
        expect(parser).toMatch(/tpNF: parsed\.tpNF \?\? null/);
    });

    it('e usa a régua ÚNICA, não uma cópia', () => {
        expect(parser).toMatch(/decidirDirecaoPorTpNF/);
        expect(parser).not.toMatch(/if \(emit === emp\) return \{ ok: true, direcao: 'saida' \}/);
    });
});

// ============================================================================
// O NÚMERO DO ↩ PROMETIA O DOBRO — e é o número em que alguém decide.
//
// Paulo, 14/08, mandando o bloco "✕ 7 produtor(es) FORA do FUNRURAL por decisão
// gravada" da NOVA ERA 07/2026: NUNO MONTEIRO com **11 notas · R$ 309.645,94 ·
// voltaria R$ 5.047,23**.
//
// A base contava as DUAS notas da mesma compra. A dedup do art. 136 nunca
// tinha rodado nesse grupo: ela exigia `funrural.aplica`, e quem saiu pelo ✕
// tem `aplica: false` — exatamente o grupo cujo número aparece ao lado de um
// botão de reverter imposto.
//
// "Reverter imposto sem o número do lado é decidir no escuro" (regra do
// proprio botao, 14/08). Numero INFLADO é pior que numero nenhum: ele nao
// levanta suspeita — a pessoa clica confiando.
// ============================================================================
describe('o "voltaria ao total" nao pode contar a mesma compra duas vezes', () => {
    const par = (over: Record<string, unknown> = {}) => ({
        chave: 'k', numero: '1', dhEmi: '2026-07-10', valor: 10000,
        fornecedor: { doc: NUNO, nome: 'NUNO MONTEIRO' },
        competencia: '2026-07',
        notaPropria: false,
        direcao: 'entrada',
        dipam: { aplica: false },
        // Fora do FUNRURAL por DECISAO gravada — é o estado do ✕.
        funrural: { aplica: false, decisao: 'nao_aplica' },
        ...over,
    });

    it('a NF-e do produtor é marcada como documento de origem mesmo com o FUNRURAL desligado por decisão', () => {
        const r = dedupNotaProdutorComEntrada([
            par({ numero: '255585', notaPropria: true }),
            par({ numero: '900' }),
        ]);
        expect(r.find((n: any) => n.numero === '900').notaOrigemProdutor).toBe(true);
        expect(r.find((n: any) => n.numero === '255585').notaOrigemProdutor).toBeUndefined();
    });

    it('e o motivo da saída continua sendo a DECISÃO, não o art. 136', () => {
        // Trocar o motivo faria a tela mandar a pessoa procurar o caminho de
        // volta no lugar errado: o ✕ se desfaz no cadastro do produtor.
        const r = dedupNotaProdutorComEntrada([
            par({ numero: '255585', notaPropria: true }),
            par({ numero: '900' }),
        ]);
        const doProdutor = r.find((n: any) => n.numero === '900');
        expect(doProdutor.funrural.decisao).toBe('nao_aplica');
        expect(doProdutor.funrural.aplica).toBe(false);
    });

    it('o total que VOLTARIA passa a ser o da nota escriturada — não a soma das duas', () => {
        const r = dedupNotaProdutorComEntrada([
            par({ numero: '255585', notaPropria: true }),
            par({ numero: '900' }),
        ]);
        const paraOBloco = r.filter((n: any) => !n.notaOrigemProdutor && n.funrural?.decisao);
        const g = agruparTiradosPorDecisao(paraOBloco, '2026-07');
        expect(g).toHaveLength(1);
        expect(g[0].notas).toBe(1);          // era 2
        expect(g[0].valor).toBe(10000);      // era 20000
        // 1,63% da LC 224/2025 sobre a base certa.
        expect(g[0].funruralPotencial).toBeCloseTo(163, 2);
    });

    it('produtor SEM nota própria continua inteiro — a dedup desfaz duplicidade, não impõe processo', () => {
        const r = dedupNotaProdutorComEntrada([par({ numero: '900' }), par({ numero: '901' })]);
        const g = agruparTiradosPorDecisao(r.filter((n: any) => !n.notaOrigemProdutor && n.funrural?.decisao), '2026-07');
        expect(g[0].notas).toBe(2);
    });
});
