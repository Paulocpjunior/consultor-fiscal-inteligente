// ============================================================================
// R-2055 — as aquisições de produção rural no formato do EFD-Reinf.
//
// O que estes testes protegem: o eixo muda (a aba 🌾 responde por NOTA e por
// MUNICÍPIO; o R-2055 é declarado por PRODUTOR), mas o CÁLCULO não se refaz.
// Dois números diferentes pro mesmo fato é o pior defeito de um arquivo fiscal.
// ============================================================================
// @ts-expect-error módulo JS puro sem tipos
import { montarPayloadR2055, normalizarAquisicao } from '../sefaz-backend/reinf-aquisicao-rural.js';

/** Bloco `funrural` como sai de montarDipamCompetencia. */
const funruralDe = (notas: any[]) => ({ notas, revisarAliquotas: false });

const nota = (over: any = {}) => ({
    chave: '3526...0001', numero: '425231', dhEmi: '2026-07-15',
    fornecedor: 'JOAO DA SILVA', doc: '11122233344', uf: 'SP',
    base: 1000, inss: 12, gilrat: 1, senar: 2, total: 15,
    aliquotas: { inss: 1.2, gilrat: 0.1, senar: 0.2 },
    declarado: null, divergencia: null,
    ...over,
});

describe('o eixo vira PRODUTOR, e o cálculo não se refaz', () => {
    test('duas notas do mesmo produtor viram UM bloco somado', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44.388.152/0001-89',
            competencia: '2026-07',
            funrural: funruralDe([nota(), nota({ numero: '425232', base: 500, inss: 6, gilrat: 0.5, senar: 1, total: 7.5 })]),
        });
        expect(r.produtores).toHaveLength(1);
        const p = r.produtores[0];
        expect(p.aquisicoes).toHaveLength(2);
        expect(p.base).toBe(1500);
        expect(p.total).toBe(22.5);
        expect(r.resumo.aquisicoes).toBe(2);
    });

    test('os valores vêm PRONTOS — nenhuma alíquota é multiplicada aqui', () => {
        // Valores propositalmente "errados" pra alíquota: se a casca recalculasse,
        // ela os corrigiria. Ela não pode: quem apura é o núcleo da DIPAM.
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07',
            funrural: funruralDe([nota({ base: 1000, inss: 99, gilrat: 88, senar: 77, total: 264 })]),
        });
        expect(r.produtores[0].inss).toBe(99);
        expect(r.produtores[0].total).toBe(264);
    });

    test('produtores diferentes viram blocos diferentes, ordenados por nome', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07',
            funrural: funruralDe([
                nota({ doc: '99988877766', fornecedor: 'ZEBEDEU' }),
                nota({ doc: '11122233344', fornecedor: 'ANTONIO' }),
            ]),
        });
        expect(r.produtores.map((p: any) => p.nome)).toEqual(['ANTONIO', 'ZEBEDEU']);
    });
});

describe('o que fica de fora NÃO some em silêncio', () => {
    test('produtor PESSOA JURÍDICA vira contagem — é R-2050, outro evento', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07',
            funrural: funruralDe([nota(), nota({ doc: '11222333000181', fornecedor: 'AGRO LTDA' })]),
        });
        expect(r.produtores).toHaveLength(1);
        expect(r.resumo.dePessoaJuridica).toBe(1);
        expect(r.ressalvas.join(' ')).toMatch(/R-2050/);
    });

    test('zero aquisição NÃO é sucesso — pode ser buraco de captura', () => {
        const r = montarPayloadR2055({ cnpjAdquirente: '44388152000189', competencia: '2026-07', funrural: funruralDe([]) });
        expect(r.produtores).toHaveLength(0);
        expect(r.ressalvas.join(' ')).toMatch(/problema é de CAPTURA/);
        expect(r.ressalvas.join(' ')).toMatch(/condicaoRural/);
    });
});

describe('o que o app NÃO sabe vai nulo, e o que ele sabe viaja', () => {
    test('indAquis é NULO: a tabela oficial não está neste app', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07', funrural: funruralDe([nota()]),
        });
        expect(r.produtores[0].indAquis).toBeNull();
        expect(r.ressalvas[0]).toMatch(/indAquis/);
        expect(r.ressalvas[0]).toMatch(/não se inventa/);
    });

    test('mas SEGURADO ESPECIAL viaja — é ele que decide a natureza da aquisição', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07',
            funrural: funruralDe([nota()]),
            produtores: { '11122233344': { seguradoEspecial: true } },
        });
        expect(r.produtores[0].seguradoEspecial).toBe(true);
        expect(r.resumo.seguradoEspecial).toBe(1);
    });

    test('sem cadastro, seguradoEspecial é false — nunca undefined viajando como "talvez"', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07', funrural: funruralDe([nota()]),
        });
        expect(r.produtores[0].seguradoEspecial).toBe(false);
    });

    test('a ressalva PROÍBE recalcular do outro lado', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07', funrural: funruralDe([nota()]),
        });
        expect(r.ressalvas.join(' ')).toMatch(/NÃO recalcule/);
        expect(r.ressalvas.join(' ')).toMatch(/LC 224\/2025/);
    });
});

describe('a divergência com a própria nota chega do outro lado', () => {
    test('nota com FUNRURAL declarado diferente do calculado acende', () => {
        const r = montarPayloadR2055({
            cnpjAdquirente: '44388152000189', competencia: '2026-07',
            funrural: funruralDe([nota({ declarado: 20, divergencia: { calculado: 15, declarado: 20 } })]),
        });
        expect(r.produtores[0].comDivergencia).toBe(1);
        expect(r.resumo.comDivergencia).toBe(1);
        expect(r.ressalvas.join(' ')).toMatch(/discordam sobre quanto foi retido/);
    });

    test('a aquisição carrega o valor declarado na nota, não só o calculado', () => {
        const a = normalizarAquisicao(nota({ declarado: 20 }));
        expect(a.declaradoNaNota).toBe(20);
        expect(a.total).toBe(15);
    });
});

describe('nomes de campo não fingem ser do leiaute', () => {
    test('a quebra usa os nomes do CÁLCULO (inss/gilrat/senar)', () => {
        const a = normalizarAquisicao(nota());
        expect(Object.keys(a)).toEqual(expect.arrayContaining(['inss', 'gilrat', 'senar', 'total']));
        // Nome que finge ser do leiaute faria o outro lado escrever no campo
        // errado achando que conferiu — é a lição do `csllOuTotal`.
        expect(Object.keys(a)).not.toEqual(expect.arrayContaining(['vlrCPDescPR', 'vlrRatDescPR', 'vlrSenarDesc']));
    });
});
