/**
 * PROVA DE CAPTURA contra a FONTE (SEFAZ) — caso NOVA ERA, 28/07/2026.
 *
 * Paulo: "79 notas no CFI × 502 na SIEG — o sistema não é confiável, temos que
 * usar o concorrente para conferir". A resposta não pode vir de comparação com
 * concorrente: vem do cursor do DistDFe (ultNSU × maxNSU), que diz sozinho se
 * ainda falta documento na fonte.
 *
 * O que este teste protege:
 *  - matriz e filial são CNPJs SEPARADOS e a prova sai lado a lado (foi o que
 *    o print mostrou: tela na filial 0002-02, SIEG na matriz 0001-21);
 *  - CNPJ sem cadastro aparece com o motivo, em vez de sumir da conta;
 *  - maxNSU > ultNSU nunca é verde — é falha com o número que falta;
 *  - "em dia" só quando o cursor alcançou a SEFAZ, e sempre com as ressalvas
 *    (janela de 90 dias, saída pela Rejeição 641).
 */
// @ts-expect-error — módulo .js puro
import { montarProvaCaptura, vereditoDoCnpj, ehResumo, JANELA_DISTDFE_DIAS } from '../sefaz-backend/prova-captura.js';

const AGORA = Date.parse('2026-07-28T12:00:00Z');
const MATRIZ = '29240822000121';
const FILIAL = '29240822000202';

const empresa = (cnpj: string, over: any = {}) => ({
    id: `id_${cnpj}`, cnpj, nome: 'COMERCIO DE FRUTAS NOVA ERA LTDA', regime: 'lucro',
    capturarSefaz: true, motivosBloqueio: [], ...over,
});
const state = (over: any = {}) => ({
    ultNSU: '900', maxNSU: '900', pendenciaNSU: 0, ultimaSyncMs: AGORA - 3600_000,
    cStatUltimaSync: '138', nsuTravado: null, ...over,
});
const doc = (cnpj: string, over: any = {}) => ({
    empresaCnpj: cnpj, direcao: 'entrada', competencia: '2026-07', status: 'autorizado',
    schema: 'procNFe', temItens: true, chave: '3'.repeat(20) + '55' + '1'.repeat(22),
    dhEmi: '2026-07-10T10:00:00-03:00', ...over,
});

const linhaDe = (r: any, cnpj: string) => r.linhas.find((l: any) => l.cnpj === cnpj);

describe('matriz × filial — a comparação que induziu ao erro', () => {
    it('devolve os DOIS CNPJs da raiz lado a lado, matriz primeiro', () => {
        const r = montarProvaCaptura({
            cnpjAlvo: FILIAL,
            empresas: [empresa(MATRIZ), empresa(FILIAL)],
            states: { [MATRIZ]: state(), [FILIAL]: state() },
            docs: [doc(FILIAL), doc(FILIAL), doc(MATRIZ)],
            agoraMs: AGORA,
        });
        expect(r.ok).toBe(true);
        expect(r.linhas.map((l: any) => l.cnpj)).toEqual([MATRIZ, FILIAL]);
        expect(r.linhas[0].matriz).toBe(true);
        expect(linhaDe(r, FILIAL).docs.total).toBe(2);
        expect(linhaDe(r, MATRIZ).docs.total).toBe(1);
        expect(r.totalDocs).toBe(3);
    });

    it('CNPJ da raiz SEM cadastro aparece com o motivo — não some da conta', () => {
        // É o cenário que faz o total "não bater": o app só captura o que conhece.
        const r = montarProvaCaptura({
            cnpjAlvo: MATRIZ,
            empresas: [empresa(FILIAL)],
            states: { [FILIAL]: state() },
            docs: [doc(FILIAL)],
            agoraMs: AGORA,
        });
        const m = linhaDe(r, MATRIZ);
        expect(m.veredito.codigo).toBe('nao-cadastrado');
        expect(m.veredito.farol).toBe('falha');
        expect(m.veredito.acao).toMatch(/matriz e filial são cadastros separados/i);
        expect(r.farol).toBe('falha');
    });

    it('a raiz inteira só é verde quando TODO CNPJ dela está em dia', () => {
        const r = montarProvaCaptura({
            cnpjAlvo: MATRIZ,
            empresas: [empresa(MATRIZ), empresa(FILIAL)],
            states: { [MATRIZ]: state(), [FILIAL]: state({ ultNSU: '10', maxNSU: '350', pendenciaNSU: 340 }) },
            docs: [doc(MATRIZ)],
            agoraMs: AGORA,
        });
        expect(r.farol).toBe('falha');
        expect(r.resumo).toMatch(/1 de 2 CNPJ\(s\).*INCOMPLETA/);
        expect(r.resumo).toMatch(/340 documento\(s\) que ainda não lemos/);
    });
});

describe('o cursor da SEFAZ é a prova', () => {
    it('maxNSU > ultNSU é FALHA com o número que falta — nunca verde', () => {
        const v = vereditoDoCnpj({
            cadastro: empresa(MATRIZ),
            state: state({ ultNSU: '120', maxNSU: '622', pendenciaNSU: 502 }),
            docs: { total: 79, resumosSemCompleta: 0 },
        }, AGORA);
        expect(v.farol).toBe('falha');
        expect(v.codigo).toBe('incompleta-na-fonte');
        expect(v.motivo).toMatch(/502 documento\(s\) ALÉM/);
        expect(v.acao).toMatch(/a própria SEFAZ está dizendo que falta/i);
    });

    it('pendência é recalculada quando o state não a gravou', () => {
        const v = vereditoDoCnpj({
            cadastro: empresa(MATRIZ),
            state: { ultNSU: '100', maxNSU: '150', ultimaSyncMs: AGORA },
            docs: { total: 5, resumosSemCompleta: 0 },
        }, AGORA);
        expect(v.motivo).toMatch(/50 documento\(s\)/);
    });

    it('cursor alcançado + sync recente + tudo completo = em dia na fonte', () => {
        const v = vereditoDoCnpj({
            cadastro: empresa(MATRIZ), state: state(), docs: { total: 79, resumosSemCompleta: 0 },
        }, AGORA);
        expect(v.farol).toBe('ok');
        expect(v.codigo).toBe('em-dia-na-fonte');
    });

    it('sem maxNSU gravado NÃO afirma completude — é âmbar', () => {
        const v = vereditoDoCnpj({
            cadastro: empresa(MATRIZ), state: { ultNSU: '90', ultimaSyncMs: AGORA },
            docs: { total: 3, resumosSemCompleta: 0 },
        }, AGORA);
        expect(v.farol).toBe('atencao');
        expect(v.codigo).toBe('sem-cursor');
    });

    it('cursor em dia mas parada há dias vira âmbar (o que entrou depois não veio)', () => {
        const v = vereditoDoCnpj({
            cadastro: empresa(MATRIZ),
            state: state({ ultimaSyncMs: AGORA - 5 * 24 * 3600_000 }),
            docs: { total: 79, resumosSemCompleta: 0 },
        }, AGORA);
        expect(v.codigo).toBe('cursor-em-dia-mas-parada');
        expect(v.motivo).toMatch(/há 5 dia/);
    });

    it('resumo sem completa não deixa verde mesmo com o cursor alcançado', () => {
        const v = vereditoDoCnpj({
            cadastro: empresa(MATRIZ), state: state(), docs: { total: 79, resumosSemCompleta: 12 },
        }, AGORA);
        expect(v.farol).toBe('atencao');
        expect(v.motivo).toMatch(/12 nota\(s\) estão só como RESUMO/);
    });
});

describe('o que trava antes do cursor', () => {
    const base = { state: state(), docs: { total: 0, resumosSemCompleta: 0 } };

    it('captura desligada', () => {
        const v = vereditoDoCnpj({ ...base, cadastro: empresa(MATRIZ, { capturarSefaz: false }) }, AGORA);
        expect(v.codigo).toBe('captura-desligada');
    });

    it('bloqueio de certificado sai com o motivo real', () => {
        const v = vereditoDoCnpj({
            ...base, cadastro: empresa(MATRIZ, { motivosBloqueio: ['Sem certificado A1 válido'] }),
        }, AGORA);
        expect(v.codigo).toBe('bloqueada');
        expect(v.motivo).toMatch(/Sem certificado A1 válido/);
    });

    it('NSU travado vem antes de qualquer conclusão sobre completude', () => {
        const v = vereditoDoCnpj({
            cadastro: empresa(MATRIZ), state: state({ nsuTravado: '4471' }),
            docs: { total: 10, resumosSemCompleta: 0 },
        }, AGORA);
        expect(v.codigo).toBe('travada');
        expect(v.motivo).toMatch(/4471/);
    });

    it('nunca sincronizou', () => {
        const v = vereditoDoCnpj({ cadastro: empresa(MATRIZ), state: null, docs: { total: 0, resumosSemCompleta: 0 } }, AGORA);
        expect(v.codigo).toBe('nunca-sincronizou');
    });
});

describe('ressalvas que impedem a comparação enganosa', () => {
    it('sempre declara a janela do DistDFe, o corte matriz/filial e a Rejeição 641', () => {
        const r = montarProvaCaptura({
            cnpjAlvo: MATRIZ, empresas: [empresa(MATRIZ)], states: { [MATRIZ]: state() },
            docs: [doc(MATRIZ)], agoraMs: AGORA,
        });
        expect(r.janelaDistDfeDias).toBe(JANELA_DISTDFE_DIAS);
        expect(r.ressalvas.join(' ')).toMatch(/Matriz e filial são CNPJs diferentes/);
        expect(r.ressalvas.join(' ')).toMatch(/últimos 90 dias/);
        expect(r.ressalvas.join(' ')).toMatch(/Rejeição 641/);
    });

    it('conta quantos docs são anteriores à janela (esses vieram de importação)', () => {
        const r = montarProvaCaptura({
            cnpjAlvo: MATRIZ, empresas: [empresa(MATRIZ)], states: { [MATRIZ]: state() },
            docs: [
                doc(MATRIZ, { dhEmi: '2026-07-10T10:00:00-03:00' }),
                doc(MATRIZ, { dhEmi: '2025-11-02T10:00:00-03:00' }),
            ],
            agoraMs: AGORA,
        });
        expect(r.docsAntesDoCorte).toBe(1);
    });

    it('CNPJ inválido não devolve prova nenhuma', () => {
        expect(montarProvaCaptura({ cnpjAlvo: '123', agoraMs: AGORA }).ok).toBe(false);
    });
});

describe('contagem por CNPJ', () => {
    it('separa entrada/saída, cancelada, resumo e competência', () => {
        const r = montarProvaCaptura({
            cnpjAlvo: MATRIZ,
            empresas: [empresa(MATRIZ)],
            states: { [MATRIZ]: state() },
            docs: [
                doc(MATRIZ),
                doc(MATRIZ, { direcao: 'saida', competencia: '2026-06' }),
                doc(MATRIZ, { status: 'cancelado' }),
                doc(MATRIZ, { schema: 'resNFe', temItens: false }),
            ],
            agoraMs: AGORA,
        });
        const l = linhaDe(r, MATRIZ);
        expect(l.docs).toMatchObject({ total: 4, entradas: 3, saidas: 1, canceladas: 1, resumosSemCompleta: 1 });
        expect(l.docs.porCompetencia).toEqual({ '2026-07': 3, '2026-06': 1 });
    });

    it('CTe completa não conta como resumo (modelo 57 nunca tem itens)', () => {
        const chaveCte = '3'.repeat(20) + '57' + '1'.repeat(22);
        expect(ehResumo({ chave: chaveCte, temItens: false, schema: 'procCTe' })).toBe(false);
    });
});

// ═══ A CARTEIRA INTEIRA — "como estão as capturas?" ═════════════════════════
//
// Paulo, 15/08. A prova por CNPJ respondia bem e a do CONJUNTO não existia:
// para saber como está a carteira era abrir a tela ~390 vezes, ou estimar de
// memória — que é o vício do "0/388" carimbado neste projeto.
describe('prova de captura da CARTEIRA', () => {
    const { montarProvaCarteira } = require('../sefaz-backend/prova-captura.js');
    const AGORA = Date.parse('2026-08-15T12:00:00Z');
    const emp = (cnpj: string, nome: string, over: any = {}) =>
        ({ id: cnpj, cnpj, nome, regime: 'lucro', capturarSefaz: true, motivosBloqueio: [], ...over });
    const st = (over: any = {}) =>
        ({ ultNSU: 100, maxNSU: 100, pendenciaNSU: 0, ultimaSyncMs: AGORA - 3600e3, ...over });

    it('agrupa POR VEREDITO e põe o pior primeiro — lista de 390 nomes não diz por onde começar', () => {
        const r = montarProvaCarteira({
            agoraMs: AGORA,
            empresas: [emp('11111111000101', 'A'), emp('22222222000102', 'B'), emp('33333333000103', 'C')],
            states: {
                '11111111000101': st(),
                '22222222000102': st({ ultNSU: 10, maxNSU: 510, pendenciaNSU: 500 }),
                '33333333000103': st({ nsuTravado: 77 }),
            },
        });
        expect(r.total).toBe(3);
        // Incompleta na fonte é a mais grave: a SEFAZ está DIZENDO que falta.
        expect(r.grupos[0].codigo).toBe('incompleta-na-fonte');
        expect(r.grupos[1].codigo).toBe('travada');
        expect(r.emDia).toBe(1);
        expect(r.comFalha).toBe(2);
    });

    it('🚨 diz QUANTOS documentos a SEFAZ ainda tem — "incompleta" sozinho não dimensiona', () => {
        const r = montarProvaCarteira({
            agoraMs: AGORA,
            empresas: [emp('22222222000102', 'B'), emp('44444444000104', 'D')],
            states: {
                '22222222000102': st({ ultNSU: 10, maxNSU: 510, pendenciaNSU: 500 }),
                '44444444000104': st({ ultNSU: 5, maxNSU: 8, pendenciaNSU: 3 }),
            },
        });
        expect(r.documentosPendentes).toBe(503);
        // Dentro do grupo, quem tem mais documento faltando aparece antes.
        expect(r.grupos[0].empresas[0].nome).toBe('B');
        expect(r.grupos[0].documentosPendentes).toBe(503);
    });

    it('🚨 cursor em dia NÃO afirma sobre resumo — verde por coisa não olhada é o pior farol', () => {
        const r = montarProvaCarteira({
            agoraMs: AGORA,
            empresas: [emp('11111111000101', 'A')],
            states: { '11111111000101': st() },
        });
        expect(r.grupos[0].codigo).toBe('cursor-em-dia');
        expect(r.escopo).toMatch(/NÃO confere/);
        expect(r.escopo).toMatch(/Rejeição 641/); // a SAÍDA também está fora
    });

    it('CNPJ com cursor e SEM cadastro não some — é ele que faz o total não bater', () => {
        const r = montarProvaCarteira({
            agoraMs: AGORA, empresas: [], states: { '99999999000199': st() },
        });
        expect(r.total).toBe(1);
        expect(r.grupos[0].codigo).toBe('nao-cadastrado');
    });

    it('lista cortada DIZ quantos ficaram — slice mudo faz o painel contradizer o próprio número', () => {
        const empresas = Array.from({ length: 30 }, (_, i) =>
            emp(String(i).padStart(8, '0') + '000101', `E${i}`));
        const states = Object.fromEntries(empresas.map((e) => [e.cnpj, st({ pendenciaNSU: 1, maxNSU: 101 })]));
        const r = montarProvaCarteira({ agoraMs: AGORA, empresas, states, limitePorGrupo: 25 });
        expect(r.grupos[0].total).toBe(30);
        expect(r.grupos[0].empresas).toHaveLength(25);
        expect(r.grupos[0].truncado).toBe(true);
    });

    it('all-failed NUNCA é verde, e carteira vazia não é ok', () => {
        const r = montarProvaCarteira({
            agoraMs: AGORA,
            empresas: [emp('11111111000101', 'A', { capturarSefaz: false })],
            states: {},
        });
        expect(r.farol).toBe('falha');
        expect(montarProvaCarteira({ agoraMs: AGORA, empresas: [], states: {} }).farol).toBe('neutro');
    });
});

describe('a visão da carteira tem TELA — função sem botão é código morto', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const RAIZ = join(__dirname, '..');

    it('a rota existe e respeita o escopo da carteira do colaborador', () => {
        const rota = readFileSync(join(RAIZ, 'sefaz-backend/prova-captura-routes.js'), 'utf8');
        expect(rota).toMatch(/prova-captura-carteira/);
        expect(rota).toMatch(/getCnpjsDaCarteira/);
        // Cursor de CNPJ fora da carteira não pode aparecer — seria pendência
        // de cliente que não é dele.
        expect(rota).toMatch(/permitidos && !permitidos\.has\(c\)/);
    });

    it('a régua de BLOQUEIO é a mesma das duas telas — sem segunda cópia', () => {
        const rota = readFileSync(join(RAIZ, 'sefaz-backend/prova-captura-routes.js'), 'utf8');
        expect(rota).toMatch(/async function anotarBloqueios/);
        // Uma definição, dois chamadores (o CNPJ único e a carteira).
        expect((rota.match(/anotarBloqueios\(/g) || []).length).toBe(3);
    });

    it('o painel mostra a visão da carteira ANTES do CNPJ único', () => {
        const tela = readFileSync(join(RAIZ, 'components/xml/ProvaCapturaPanel.tsx'), 'utf8');
        expect(tela).toMatch(/<VisaoCarteira \/>/);
        expect(tela).toMatch(/provarCapturaDaCarteira/);
        // Recorte e escopo DITOS na tela.
        expect(tela).toMatch(/dados\.recorte/);
        expect(tela).toMatch(/dados\.escopo/);
    });
});
