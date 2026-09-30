/**
 * 📡 COMUNICAÇÃO NO SIMPLES — LC 123/2006, art. 18, § 5º-E: Anexo III
 * DEDUZIDA a parcela do ISS e ACRESCIDA a parcela do ICMS do Anexo I.
 *
 * Paulo, 30/09 (pedido da Valeria de 09/09, RADIO SB · Porto Alegre/RS):
 * *"é serviço de comunicação, está puxando como prestação de serviço normal,
 * ela é sujeita ao ICMS"*. A atividade do PGDAS-D é a 36, lida do input do
 * e-CAC (`value="07147345000111-36"`) — a mesma fonte do código 9 do ISS fixo.
 *
 * Fatos cobrados: a configuração é da empresa por CNAE; a alíquota efetiva é
 * a do Anexo III sem ISS + efetiva do Anexo I × %ICMS (conferida contra as
 * tabelas da LC, faixa a faixa); o ICMS sai do DAS com ST/imunidade/isenção/
 * exterior; o mês gravado antes da marcação também segue a regra; o PGDAS-D
 * vai com a atividade 36 sem qualificação de ISS; com ST ou exterior a
 * transmissão é BLOQUEADA (id não confirmado).
 */
jest.mock('../services/firebaseConfig', () => ({ db: null, auth: null, isFirebaseConfigured: false }));
jest.mock('firebase/firestore', () => ({
    collection: jest.fn(), getDocs: jest.fn(), doc: jest.fn(), setDoc: jest.fn(), getDoc: jest.fn(),
    query: jest.fn(), where: jest.fn(), deleteDoc: jest.fn(), limit: jest.fn(),
}));
jest.mock('../services/geminiService', () => ({ extractDocumentData: jest.fn(), extractPgdasDataFromPdf: jest.fn() }));
jest.mock('../services/pgdasPdfParser', () => ({ parsePgdasExtrato: jest.fn() }));
jest.mock('../services/empresaUniquenessService', () => ({
    verificarCnpjDuplicado: jest.fn().mockResolvedValue({ duplicado: false }), mensagemCnpjDuplicado: jest.fn(),
}));

import { calcularResumoEmpresa } from '../services/simplesNacionalService';
import {
    ehCnaeComunicacao, alternarCnaeComunicacao, cnaeSugereComunicacao, idAtividadeComunicacao,
    aliquotaEfetivaComunicacao, ID_ATIVIDADE_COMUNICACAO_SEM_ST,
} from '../services/simplesComunicacao';
import { mapPgdasPayload, bloqueiosDoPayload, avisosDoPayload } from '../services/pgdasMapper';
import type { SimplesNacionalEmpresa, SimplesNacionalResumo } from '../types';

const CNAE_RADIO = '6010100';

function serie(receita: number, ano: number, mes: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (let i = 1; i <= 12; i++) {
        const d = new Date(ano, mes - 1 - i, 1);
        out[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = receita;
    }
    return out;
}

const radio = (extra: Partial<SimplesNacionalEmpresa> = {}): SimplesNacionalEmpresa => ({
    id: 'radio', nome: 'RADIO SB FM LTDA', cnpj: '07.147.345/0001-11', cnae: CNAE_RADIO, anexo: 'III',
    folha12: 0, faturamentoManual: serie(80_000, 2026, 9), cnaesComunicacao: [CNAE_RADIO], ...extra,
});
const item = (extra: Record<string, unknown> = {}) => ({
    cnae: CNAE_RADIO, anexo: 'III' as const, valor: 80_694.11, issRetido: false, icmsSt: false, isSup: false,
    isMonofasico: false, isImune: false, isExterior: false, isComunicacao: true, ...extra,
});

// RBT12 = 960.000 → Anexo III faixa 4 (16% · 35.640) e Anexo I faixa 4 (10,7% · 22.500).
const EF_III = ((960_000 * 0.16) - 35_640) / 960_000 * 100;      // 12,2875%
const EF_I = ((960_000 * 0.107) - 22_500) / 960_000 * 100;       // 8,35625%
const ESPERADA = EF_III * (1 - 32.5 / 100) + EF_I * (33.5 / 100); // ISS III fx4 = 32,5% · ICMS I fx4 = 33,5%

describe('a configuração é da empresa, por CNAE', () => {
    it('ehCnaeComunicacao compara só dígitos; alternar liga/desliga sem duplicar', () => {
        expect(ehCnaeComunicacao(radio(), '6010-1/00')).toBe(true);
        expect(ehCnaeComunicacao(radio({ cnaesComunicacao: [] }), CNAE_RADIO)).toBe(false);
        expect(ehCnaeComunicacao(null, CNAE_RADIO)).toBe(false);
        expect(alternarCnaeComunicacao([], '6010-1/00')).toEqual([CNAE_RADIO]);
        expect(alternarCnaeComunicacao([CNAE_RADIO], CNAE_RADIO)).toEqual([]);
        expect(cnaeSugereComunicacao('6010-1/00')).toBe(true);
        expect(cnaeSugereComunicacao('6204-0/00')).toBe(false);
    });
});

describe('§5º-E: Anexo III sem ISS + parcela do ICMS do Anexo I', () => {
    it('a regra pura soma as duas parcelas e tira o ICMS quando ele não é devido no DAS', () => {
        const rep = { IRPJ: 4, CSLL: 3.5, COFINS: 13.64, PIS: 2.96, CPP: 43.4, ISS: 32.5 };
        expect(aliquotaEfetivaComunicacao({ efetivaIII: EF_III, reparticaoIII: rep, efetivaI: EF_I, percentualIcmsI: 33.5 })).toBeCloseTo(ESPERADA, 6);
        const semIcms = EF_III * (1 - 32.5 / 100);
        for (const flag of ['icmsSt', 'isImune', 'isIsento'] as const) {
            expect(aliquotaEfetivaComunicacao({ efetivaIII: EF_III, reparticaoIII: rep, efetivaI: EF_I, percentualIcmsI: 33.5, [flag]: true })).toBeCloseTo(semIcms, 6);
        }
        expect(aliquotaEfetivaComunicacao({ efetivaIII: EF_III, reparticaoIII: rep, efetivaI: EF_I, percentualIcmsI: 33.5, isExterior: true }))
            .toBeCloseTo(EF_III * (1 - (32.5 + 2.96 + 13.64) / 100), 6);
    });

    it('o cálculo do DAS da tela aplica a regra (e fica DIFERENTE do serviço comum do Anexo III)', () => {
        const mes = new Date(2026, 8, 1);
        const com = calcularResumoEmpresa(radio(), [], mes, { itensCalculo: [item()] });
        const comum = calcularResumoEmpresa(radio({ cnaesComunicacao: [] }), [], mes, { itensCalculo: [item({ isComunicacao: false })] });
        expect(com.rbt12).toBeCloseTo(960_000, 2);
        expect(com.detalhamento_anexos?.[0]?.aliquotaEfetiva).toBeCloseTo(ESPERADA, 6);
        expect(com.das_mensal).toBeCloseTo(80_694.11 * ESPERADA / 100, 2);
        expect(comum.detalhamento_anexos?.[0]?.aliquotaEfetiva).toBeCloseTo(EF_III, 6);
        expect(com.detalhamento_anexos?.[0]?.anexo).toBe('III');
    });

    it('comunicação ignora o fator R: cadastrada como III_V, calcula pelo Anexo III', () => {
        const mes = new Date(2026, 8, 1);
        const r = calcularResumoEmpresa(radio({ anexo: 'III_V' }), [], mes, { itensCalculo: [item({ anexo: 'III_V' })] });
        expect(r.detalhamento_anexos?.[0]?.anexo).toBe('III');
        expect(r.detalhamento_anexos?.[0]?.aliquotaEfetiva).toBeCloseTo(ESPERADA, 6);
    });

    it('o mês gravado ANTES da marcação segue a configuração da empresa (sem itensCalculo)', () => {
        const mes = new Date(2026, 8, 1);
        const empresa = radio({
            faturamentoMensalDetalhado: {
                '2026-09': { [`principal::0::${CNAE_RADIO}::III`]: { valor: 80_694.11, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false } },
            },
        });
        const r = calcularResumoEmpresa(empresa, [], mes);
        expect(r.detalhamento_anexos?.[0]?.aliquotaEfetiva).toBeCloseTo(ESPERADA, 6);
    });
});

// ─── PGDAS-D ────────────────────────────────────────────────────────────────
const resumo = { rbt12: 960_000, rbt12Interno: 960_000, rbt12Externo: 0, aliq_nom: 16, aliq_eff: 11, das: 0, das_mensal: 0, mensal: {},
    historico_simulado: [], anexo_efetivo: 'III', fator_r: 0, folha_12: 0, ultrapassou_sublimite: false, faixa_index: 3,
    totalMercadoInterno: 80_694.11, totalMercadoExterno: 0 } as unknown as SimplesNacionalResumo;
const estado = (extra: Record<string, unknown> = {}) => ({
    valor: '80.694,11', issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false, ...extra,
});
const payload = (st: Record<string, unknown> = {}, empresa = radio()) => mapPgdasPayload({
    empresa, resumo, mesApuracao: new Date(2026, 8, 1),
    faturamentoPorCnae: { [`principal::0::${CNAE_RADIO}::III`]: estado(st) as any },
    filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
});

describe('PGDAS-D: atividade 36, sem ISS; variantes sem número ficam BLOQUEADAS', () => {
    it('receita de comunicação vai com idAtividade 36 e sem qualificação de ISS retido', () => {
        const p = payload({ issRetido: true });
        const at = p.declaracao.estabelecimentos[0].atividades[0];
        expect(ID_ATIVIDADE_COMUNICACAO_SEM_ST).toBe(36);
        expect(at.idAtividade).toBe(36);
        expect(JSON.stringify(at.receitasAtividade)).not.toContain('"codigoTributo":1010');
        expect(p._bloqueios).toEqual([]);
        expect((p._avisos || []).some((a) => /COMUNICAÇÃO/.test(a))).toBe(true);
        expect(p.declaracao).not.toHaveProperty('folhasSalario');
    });

    it('sem a marcação na empresa, o mesmo CNAE continua serviço comum (14)', () => {
        expect(payload({}, radio({ cnaesComunicacao: [] })).declaracao.estabelecimentos[0].atividades[0].idAtividade).toBe(14);
    });

    it('comunicação com ST ou para o exterior: id não confirmado → bloqueio com a saída', () => {
        expect(idAtividadeComunicacao({ icmsSt: true })).toBeNull();
        expect(idAtividadeComunicacao({ isExterior: true })).toBeNull();
        const b = bloqueiosDoPayload({ [`principal::0::${CNAE_RADIO}::III`]: estado({ icmsSt: true }) as any }, radio());
        expect(b).toHaveLength(1);
        expect(b[0]).toContain('value="CNPJ-número"');
        expect(avisosDoPayload({ [`principal::0::${CNAE_RADIO}::III`]: estado() as any }, radio({ cnaesComunicacao: [] }))
            .some((a) => /COMUNICAÇÃO/.test(a))).toBe(false);
    });
});
