import type { SimplesNacionalEmpresa, SimplesNacionalResumo } from '../types';
import { mapPgdasPayload } from '../services/pgdasMapper';

const baseEmpresa: SimplesNacionalEmpresa = {
    id: 'emp-1',
    nome: 'Empresa Teste',
    cnpj: '28.810.670/0001-92',
    cnae: '9602501',
    anexo: 'III',
    folha12: 0,
    faturamentoManual: {},
    regimeApuracao: 'competencia',
};

const baseResumo: SimplesNacionalResumo = {
    rbt12: 641904.64,
    rbt12Interno: 641904.64,
    rbt12Externo: 0,
    aliq_nom: 11.2,
    aliq_eff: 10.75,
    das: 0,
    das_mensal: 4652.41,
    mensal: {},
    historico_simulado: [],
    anexo_efetivo: 'III',
    fator_r: 0,
    folha_12: 0,
    ultrapassou_sublimite: false,
    faixa_index: 2,
    totalMercadoInterno: 43270.5,
    totalMercadoExterno: 0,
};

const emptyState = {
    issRetido: false,
    icmsSt: false,
    isSup: false,
    isMonofasico: false,
    isImune: false,
    isExterior: false,
};

describe('mapPgdasPayload', () => {
    it('mapeia servico Anexo III proprio municipio para idAtividade 14 sem campos legados', () => {
        const payload = mapPgdasPayload({
            empresa: baseEmpresa,
            resumo: baseResumo,
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'principal::0::9602501::III': { ...emptyState, valor: '43.270,50' },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        expect(payload.declaracao.receitaPaCompetenciaInterno).toBe(43270.5);
        expect(payload.declaracao.receitaPaCompetenciaExterno).toBe(0);
        expect(payload.declaracao).not.toHaveProperty('folhaSalario12m');
        expect(payload.declaracao).not.toHaveProperty('folhasSalario');

        const atividade = payload.declaracao.estabelecimentos[0].atividades[0];
        expect(atividade.idAtividade).toBe(14);
        expect(atividade.valorAtividade).toBe(43270.5);
        expect(atividade.receitasAtividade[0]).toEqual({ valor: 43270.5 });
        expect(atividade.receitasAtividade[0]).not.toHaveProperty('municipioISS');
        expect(atividade.receitasAtividade[0]).not.toHaveProperty('ufICMS');
        expect(atividade.receitasAtividade[0]).not.toHaveProperty('qualificacaoTributaria');
    });

    it('mapeia servico Anexo III com ISS retido para idAtividade 15', () => {
        const payload = mapPgdasPayload({
            empresa: baseEmpresa,
            resumo: baseResumo,
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'principal::0::9602501::III': { ...emptyState, valor: '10.000,00', issRetido: true },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        expect(payload.declaracao.estabelecimentos[0].atividades[0].idAtividade).toBe(15);
    });

    it('mapeia comercio e industria pelos ids oficiais do dominio PGDAS-D', () => {
        const payload = mapPgdasPayload({
            empresa: { ...baseEmpresa, anexo: 'I' },
            resumo: { ...baseResumo, fator_r: 0 },
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'principal::0::4711302::I': { ...emptyState, valor: '1.000,00' },
                'secundario::0::1091100::II': { ...emptyState, valor: '2.000,00' },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        expect(payload.declaracao.estabelecimentos[0].atividades.map(a => a.idAtividade)).toEqual([1, 4]);
        expect(payload.declaracao.receitaPaCompetenciaInterno).toBe(3000);
    });

    it('inclui qualificacao tributaria para receita com ICMS ST no Anexo I', () => {
        const payload = mapPgdasPayload({
            empresa: { ...baseEmpresa, anexo: 'I', cnpj: '43.212.877/0001-59' },
            resumo: { ...baseResumo, fator_r: 0, das_mensal: 2170.41 },
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'principal::0::4789099::I': { ...emptyState, valor: '28.920,50' },
                'extra::1781197058850::4789099::I': { ...emptyState, valor: '5.069,15', icmsSt: true },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        const atividades = payload.declaracao.estabelecimentos[0].atividades;
        expect(atividades.map(a => a.idAtividade)).toEqual([1, 2]);
        expect(payload.declaracao.receitaPaCompetenciaInterno).toBe(33989.65);
        expect(atividades[1]).toMatchObject({
            idAtividade: 2,
            valorAtividade: 5069.15,
            receitasAtividade: [{
                valor: 5069.15,
                qualificacoesTributarias: [{ codigoTributo: 1007, id: 8 }],
            }],
        });
    });

    it('mantem parcelas distintas quando receitas do mesmo idAtividade tem qualificacoes diferentes', () => {
        const payload = mapPgdasPayload({
            empresa: { ...baseEmpresa, anexo: 'I' },
            resumo: { ...baseResumo, fator_r: 0 },
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'extra::1::4789099::I': { ...emptyState, valor: '1.000,00', icmsSt: true },
                'extra::2::4789099::I': { ...emptyState, valor: '2.000,00', isMonofasico: true },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        const atividade = payload.declaracao.estabelecimentos[0].atividades[0];
        expect(atividade.idAtividade).toBe(2);
        expect(atividade.valorAtividade).toBe(3000);
        expect(atividade.receitasAtividade).toEqual([
            {
                valor: 1000,
                qualificacoesTributarias: [{ codigoTributo: 1007, id: 8 }],
            },
            {
                valor: 2000,
                qualificacoesTributarias: [
                    { codigoTributo: 1004, id: 9 },
                    { codigoTributo: 1005, id: 9 },
                ],
            },
        ]);
    });

    it('separa receita de servico para exterior no idAtividade 30 e no total externo', () => {
        const payload = mapPgdasPayload({
            empresa: baseEmpresa,
            resumo: baseResumo,
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'principal::0::9602501::III': { ...emptyState, valor: '5.500,00', isExterior: true },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        expect(payload.declaracao.estabelecimentos[0].atividades[0].idAtividade).toBe(30);
        expect(payload.declaracao.receitaPaCompetenciaInterno).toBe(0);
        expect(payload.declaracao.receitaPaCompetenciaExterno).toBe(5500);
    });
});
