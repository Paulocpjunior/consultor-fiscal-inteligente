/**
 * O prazo do ISS é do MUNICÍPIO — o buraco que o catálogo único deixou nomeado.
 *
 * Paulo, 11/08: "os vencimentos são datas definidas pelos órgãos competentes,
 * sempre separados por esferas". 12/08, confirmando: "ISS é municipal e não
 * federal". O ISS nasceu como PROPOSTA, sem data, porque carimbar o dia de São
 * Paulo em cliente de outra cidade seria INVENTAR prazo — e prazo inventado
 * erra dos dois lados: multa de um, "atrasada" falsa do outro.
 */
// @ts-nocheck — módulo .js do backend
import {
    resolverPrazoIss, validarPrazoIss, municipiosSemPrazo, PRAZOS_ISS_SEMENTE,
} from '../sefaz-backend/prazo-iss-municipal.js';

const CADASTRO = [
    { codMunIBGE: '3550308', municipio: 'São Paulo', diaVencimento: 10, mesesApos: 1,
      vigenciaInicio: null, vigenciaFim: '2025-12', fonte: 'Portaria SF antiga' },
    { codMunIBGE: '3550308', municipio: 'São Paulo', diaVencimento: 15, mesesApos: 1,
      vigenciaInicio: '2026-01', vigenciaFim: null, fonte: 'Portaria SF nova' },
];

describe('vigência manda — nunca "o mais recente"', () => {
    it('competência antiga usa o prazo da época', () => {
        const r = resolverPrazoIss({ codMunIBGE: '3550308', competencia: '2025-06', cadastro: CADASTRO });
        expect(r.resolvido).toBe(true);
        expect(r.diaVencimento).toBe(10);
        expect(r.fonte).toMatch(/antiga/);
    });

    it('competência nova usa o prazo novo', () => {
        const r = resolverPrazoIss({ codMunIBGE: '3550308', competencia: '2026-07', cadastro: CADASTRO });
        expect(r.diaVencimento).toBe(15);
    });

    it('sem vigência que cubra a competência, NÃO chuta', () => {
        const r = resolverPrazoIss({
            codMunIBGE: '3550308', competencia: '2020-01',
            cadastro: [{ ...CADASTRO[1] }],
        });
        expect(r.resolvido).toBe(false);
        expect(r.motivo).toMatch(/nenhum vigente/);
    });
});

describe('sem cadastro, sem data', () => {
    it('município não cadastrado vira pendência NOMEADA, com o IBGE', () => {
        const r = resolverPrazoIss({ codMunIBGE: '3509502', competencia: '2026-07', cadastro: CADASTRO });
        expect(r.resolvido).toBe(false);
        expect(r.motivo).toMatch(/3509502/);
        // A obrigação não some do mês — aparece SEM data.
        expect(r.acao).toMatch(/SEM data/);
        expect(r.acao).toMatch(/nunca com o prazo de outra cidade/);
    });

    it('cliente sem município no cadastro: diz onde arrumar', () => {
        const r = resolverPrazoIss({ codMunIBGE: '', competencia: '2026-07' });
        expect(r.resolvido).toBe(false);
        expect(r.acao).toMatch(/Dados Fiscais/);
    });
});

describe('a semente é honesta sobre o que ela é', () => {
    it('SP entra herdado do mapa interno, e carimbado como A CONFERIR', () => {
        const r = resolverPrazoIss({ codMunIBGE: '3550308', competencia: '2026-07' });
        expect(r.resolvido).toBe(true);
        expect(r.diaVencimento).toBe(10);
        expect(r.confirmar).toBe(true);
        expect(r.acao).toMatch(/ainda NÃO conferido na norma/);
        expect(PRAZOS_ISS_SEMENTE).toHaveLength(1);   // só a capital tem fonte
    });
});

describe('cadastro exige FONTE', () => {
    it('prazo sem a norma que o define é recusado', () => {
        const e = validarPrazoIss({ codMunIBGE: '3509502', diaVencimento: 20, fonte: '' });
        expect(e.join(' ')).toMatch(/fonte é obrigatória/);
        expect(e.join(' ')).toMatch(/achismo com cara de cadastro/);
    });

    it('dia fora do mês e vigência invertida também são recusados', () => {
        const e = validarPrazoIss({
            codMunIBGE: '3509502', diaVencimento: 45, fonte: 'x',
            vigenciaInicio: '2026-07', vigenciaFim: '2026-01',
        });
        expect(e.join(' ')).toMatch(/dia do mês/);
        expect(e.join(' ')).toMatch(/não pode ser depois/);
    });

    it('linha completa passa', () => {
        expect(validarPrazoIss({
            codMunIBGE: '3509502', diaVencimento: 20, mesesApos: 1,
            fonte: 'Lei Municipal 1.234/2020 art. 5º', vigenciaInicio: '2026-01',
        })).toEqual([]);
    });
});

describe('onde falta cadastrar, por volume', () => {
    it('lista os municípios da carteira sem prazo, do maior pro menor', () => {
        const r = municipiosSemPrazo(
            ['3550308', '3509502', '3509502', '3543402', '3550308'], PRAZOS_ISS_SEMENTE,
        );
        expect(r).toEqual([
            { codMunIBGE: '3509502', clientes: 2 },
            { codMunIBGE: '3543402', clientes: 1 },
        ]);
    });
});
