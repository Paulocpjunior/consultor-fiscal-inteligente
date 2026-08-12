// ============================================================================
// R-2010 — retenção previdenciária sobre serviços tomados.
//
// CALIBRADO CONTRA UM EVENTO ACEITO. Paulo mandou em 12/08/2026 o `evtServTom`
// real de 06/2026 (contribuinte 32602701, prestador 03222111000130) COM o
// recibo da Receita ao lado (`cdRetorno 0 — SUCESSO`, `tpEv 2010`).
//
// Os números dele são o alvo destes testes:
//   vlrTotalBruto    5.755,54
//   vlrTotalBaseRet  4.604,43   ← NÃO é o bruto: houve dedução de INSUMOS
//   vlrTotalRetPrinc   506,49   ← 11% da base, não do bruto
//
// É essa diferença que este módulo existe para não deixar passar: declarar
// base = bruto seria declarar retenção sobre 25% a mais de base.
// ============================================================================
// @ts-expect-error módulo JS puro sem tipos
import { conferirBaseRetencaoInss, montarPayloadR2010, normalizarServicoTomado, ALIQUOTA_ART31, ALIQUOTA_CPRB } from '../sefaz-backend/reinf-servicos-tomados.js';

const notaTomada = (over: any = {}) => ({
    tipoDoc: 'NFSe', direcao: 'entrada', status: 'autorizado',
    numero: '30349', serie: '0', competencia: '2026-06',
    dataFatoGerador: '2026-06-24',
    prestadorCnpj: '03222111000130', prestadorNome: 'LIMPEZA TOTAL LTDA',
    tomadorCnpj: '32602701000197',
    valorServicos: 5755.54,
    valores: { inss: 506.49 },
    ...over,
});

describe('a assinatura de alíquota decide a base — não o palpite', () => {
    test('11% cheios: a base É o bruto, e isso está PROVADO pela razão', () => {
        const c = conferirBaseRetencaoInss({ bruto: 1000, retido: 110 });
        expect(c.situacao).toBe('base-e-o-bruto');
        expect(c.base).toBe(1000);
        expect(c.baseOrigem).toBe('bruto-sem-deducao');
        expect(c.indCPRB).toBe(0);
        expect(c.exigeAcao).toBe(false);
    });

    test('o caso REAL do evento aceito: 506,49 sobre 5.755,54 é 8,8% ⇒ houve dedução', () => {
        const c = conferirBaseRetencaoInss({ bruto: 5755.54, retido: 506.49 });
        expect(c.situacao).toBe('base-deduzida-nao-informada');
        expect(c.exigeAcao).toBe(true);
        expect(c.motivo).toMatch(/abaixo dos 11%/);
        expect(c.motivo).toMatch(/971/);
        // A base derivada CHEGA PERTO da real (4.604,43) mas não é ela — por
        // isso ela é marcada, nunca apresentada como a base.
        expect(c.base).toBeCloseTo(4604.45, 2);
        expect(c.baseOrigem).toBe('derivada-da-retencao');
        expect(c.acao).toMatch(/valor estimado não vai para declaração/);
    });

    test('3,5% é AMBÍGUO e o app NÃO escolhe — são indCPRB diferentes', () => {
        const c = conferirBaseRetencaoInss({ bruto: 1000, retido: 35 });
        expect(c.situacao).toBe('aliquota-ambigua-cprb-ou-deducao');
        expect(c.indCPRB).toBeNull();
        expect(c.base).toBeNull();
        expect(c.motivo).toMatch(/DUAS leituras/);
        expect(c.acao).toMatch(/desoneração \(CPRB\)/);
    });

    test('alíquota que nenhuma regra explica vira pendência com a suspeita nomeada', () => {
        const c = conferirBaseRetencaoInss({ bruto: 1000, retido: 300 });
        expect(c.situacao).toBe('aliquota-fora-da-regua');
        expect(c.acao).toMatch(/outra natureza lançada no campo de INSS/);
    });

    test('sem bruto ou sem retenção não se estima nada', () => {
        expect(conferirBaseRetencaoInss({ bruto: 0, retido: 110 }).situacao).toBe('sem-dados');
        expect(conferirBaseRetencaoInss({ bruto: 1000 }).situacao).toBe('sem-dados');
        expect(conferirBaseRetencaoInss({}).acao).toMatch(/não se estima/);
    });

    test('a tolerância cobre o arredondamento por nota (4.604,43 × 11% = 506,4873)', () => {
        expect(conferirBaseRetencaoInss({ bruto: 4604.43, retido: 506.49 }).situacao).toBe('base-e-o-bruto');
        expect(ALIQUOTA_ART31).toBe(11);
        expect(ALIQUOTA_CPRB).toBe(3.5);
    });
});

describe('a nota chega nas DUAS formas do documento', () => {
    test('forma ACHATADA do portal de SP', () => {
        const n = normalizarServicoTomado(notaTomada({ valores: undefined, valorInss: 506.49 }));
        expect(n.inssRetido).toBe(506.49);
        expect(n.vlrBruto).toBe(5755.54);
        expect(n.prestadorCnpj).toBe('03222111000130');
    });

    test('forma ANINHADA do XML', () => {
        const n = normalizarServicoTomado({
            tipoDoc: 'NFSe', direcao: 'entrada',
            emitente: { cnpjCpf: '03222111000130', nome: 'LIMPEZA TOTAL LTDA' },
            destinatario: { cnpjCpf: '32602701000197' },
            valores: { valorServicos: 5755.54, inss: 506.49 },
        });
        expect(n.prestadorCnpj).toBe('03222111000130');
        expect(n.tomadorCnpj).toBe('32602701000197');
        expect(n.inssRetido).toBe(506.49);
    });

    test('nome de campo não finge conferência: é `inssRetido`, o que a NOTA diz', () => {
        const n = normalizarServicoTomado(notaTomada());
        expect(Object.keys(n)).toEqual(expect.arrayContaining(['inssRetido', 'vlrBruto', 'baseRetencao', 'baseOrigem']));
        expect(Object.keys(n)).not.toEqual(expect.arrayContaining(['vlrRetencao', 'vlrBaseRet']));
    });
});

describe('o que NÃO está no documento vai nulo e nomeado', () => {
    test('tpServico e indObra são nulos — nem o XML nem o portal os têm', () => {
        const n = normalizarServicoTomado(notaTomada());
        expect(n.tpServico).toBeNull();
        expect(n.indObra).toBeNull();
    });

    test('e a ressalva PROÍBE o default de indObra', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06', documentos: [notaTomada()],
        });
        expect(r.ressalvas[0]).toMatch(/tpServico/);
        expect(r.ressalvas[0]).toMatch(/indObra/);
        expect(r.ressalvas[0]).toMatch(/quase sempre é 0/);
    });
});

describe('o eixo é o PRESTADOR, como no evento aceito', () => {
    test('duas notas do mesmo prestador viram UM bloco com os totais somados', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [
                notaTomada({ numero: '1', valorServicos: 1000, valores: { inss: 110 } }),
                notaTomada({ numero: '2', valorServicos: 2000, valores: { inss: 220 } }),
            ],
        });
        expect(r.prestadores).toHaveLength(1);
        const p = r.prestadores[0];
        expect(p.notas).toHaveLength(2);
        expect(p.vlrTotalBruto).toBe(3000);
        expect(p.vlrTotalRetPrinc).toBe(330);
        // As duas provaram a base pela alíquota, então o total sai.
        expect(p.vlrTotalBaseRet).toBe(3000);
        expect(p.nrInscEstab).toBe('32602701000197');
    });

    test('base não provada derruba o TOTAL da base para nulo, nunca para parcial', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [
                notaTomada({ numero: '1', valorServicos: 1000, valores: { inss: 110 } }),
                notaTomada({ numero: '2', valorServicos: 5755.54, valores: { inss: 506.49 } }),
            ],
        });
        const p = r.prestadores[0];
        // Total parcial num campo chamado "vlrTotalBaseRet" seria lido como a
        // base inteira do prestador — e ninguém desconfiaria.
        expect(p.vlrTotalBaseRet).toBeNull();
        expect(p.baseCompleta).toBe(false);
        expect(r.resumo.semBaseProvada).toBe(1);
        expect(r.ressalvas.join(' ')).toMatch(/BASE não está provada/);
        // Bruto e retenção continuam somando: esses SÃO conhecidos.
        expect(p.vlrTotalRetPrinc).toBe(616.49);
    });

    test('prestadores diferentes viram blocos diferentes, ordenados por nome', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [
                notaTomada({ prestadorCnpj: '11222333000181', prestadorNome: 'ZELADORIA SA' }),
                notaTomada({ prestadorCnpj: '03222111000130', prestadorNome: 'ALFA SERVICOS' }),
            ],
        });
        expect(r.prestadores.map((p: any) => p.nome)).toEqual(['ALFA SERVICOS', 'ZELADORIA SA']);
    });
});

describe('o que fica de fora NÃO some em silêncio', () => {
    test('nota tomada sem INSS retido é contagem, não pendência — é a maioria', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [notaTomada(), notaTomada({ numero: '9', valores: { inss: 0 } })],
        });
        expect(r.resumo.semRetencaoPrevidenciaria).toBe(1);
        expect(r.prestadores).toHaveLength(1);
    });

    test('prestador PESSOA FÍSICA fica de fora — é eSocial, não R-2010', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [notaTomada({ prestadorCnpj: '11122233344' })],
        });
        expect(r.resumo.dePessoaFisica).toBe(1);
        expect(r.ressalvas.join(' ')).toMatch(/eSocial/);
    });

    test('nota CANCELADA e nota de SAÍDA não entram', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [
                notaTomada({ status: 'cancelado' }),
                notaTomada({ direcao: 'saida' }),
            ],
        });
        expect(r.prestadores).toHaveLength(0);
    });

    test('zero prestador NÃO é sucesso — pode ser buraco de captura', () => {
        const r = montarPayloadR2010({ cnpjTomador: '32602701000197', competencia: '2026-06', documentos: [] });
        expect(r.ressalvas.join(' ')).toMatch(/problema é de CAPTURA/);
        expect(r.ressalvas.join(' ')).toMatch(/cessão de mão de obra/);
    });

    test('a ambiguidade do CPRB sobe como ressalva de primeira classe', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [notaTomada({ valorServicos: 1000, valores: { inss: 35 } })],
        });
        expect(r.ressalvas.join(' ')).toMatch(/DUAS leituras/);
        expect(r.ressalvas.join(' ')).toMatch(/indCPRB/);
        expect(r.resumo.comPendencia).toBe(1);
    });
});
