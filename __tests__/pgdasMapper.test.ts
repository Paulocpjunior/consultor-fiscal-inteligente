import type { SimplesNacionalEmpresa, SimplesNacionalResumo } from '../types';
import { mapPgdasPayload, avisosDoPayload } from '../services/pgdasMapper';

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

    it('inclui folha do PA anterior quando atividade III_V exige Fator R e só há folha12 legada', () => {
        const payload = mapPgdasPayload({
            empresa: {
                ...baseEmpresa,
                anexo: 'III_V',
                folha12: 50469.19,
            },
            resumo: {
                ...baseResumo,
                fator_r: 0.1376,
                anexo_efetivo: 'V',
                folha_12: 50469.19,
            },
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'principal::0::7311400::III_V': { ...emptyState, valor: '34.434,80' },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        expect(payload.declaracao.estabelecimentos[0].atividades[0].idAtividade).toBe(11);
        expect(payload.declaracao.folhasSalario).toEqual([
            { pa: 202604, valor: 50469.19 },
        ]);
    });

    it('nao envia folha12 legada para Anexo III que nao exige Fator R', () => {
        const payload = mapPgdasPayload({
            empresa: { ...baseEmpresa, anexo: 'III', folha12: 50469.19 },
            resumo: { ...baseResumo, fator_r: 0.1376, folha_12: 50469.19 },
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'principal::0::9602501::III': { ...emptyState, valor: '34.434,80' },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        expect(payload.declaracao).not.toHaveProperty('folhasSalario');
    });

    it('usa folhaMensal da janela de 12 meses quando ela existe', () => {
        const payload = mapPgdasPayload({
            empresa: {
                ...baseEmpresa,
                anexo: 'III_V',
                folha12: 999999,
                folhaMensal: {
                    '2026-05': 999,
                    '2026-04': 10000,
                    '2026-03': 9000,
                    '2025-05': 8000,
                    '2025-03': 7000,
                },
            },
            resumo: { ...baseResumo, fator_r: 0.2, anexo_efetivo: 'V' },
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'principal::0::7311400::III_V': { ...emptyState, valor: '34.434,80' },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        expect(payload.declaracao.folhasSalario).toEqual([
            { pa: 202505, valor: 8000 },
            { pa: 202603, valor: 9000 },
            { pa: 202604, valor: 10000 },
        ]);
    });

    it('nao envia receitas anteriores a abertura em empresa com RBT12 proporcionalizado', () => {
        const payload = mapPgdasPayload({
            empresa: {
                ...baseEmpresa,
                anexo: 'I',
                cnpj: '62.384.278/0001-67',
                dataAbertura: '2025-08-01',
                faturamentoManual: {
                    '2025-07': 0,
                    '2025-08': 0,
                    '2025-09': 12000,
                    '2026-04': 22000,
                },
            },
            resumo: {
                ...baseResumo,
                inicioAtividade: true,
                mesesAtividade: 9,
                rbt12: 147658.57,
            },
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'principal::0::4520001::I': { ...emptyState, valor: '68.830,68' },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        const pas = payload.declaracao.receitasBrutasAnteriores.map(r => r.pa);
        expect(pas).toHaveLength(9);
        expect(pas).toEqual([
            202604, 202603, 202602, 202601, 202512,
            202511, 202510, 202509, 202508,
        ]);
        expect(pas).not.toContain(202507);
        expect(pas).not.toContain(202506);
        expect(pas).not.toContain(202505);
    });

    it('nao envia receitas anteriores no primeiro mes de atividade', () => {
        const payload = mapPgdasPayload({
            empresa: {
                ...baseEmpresa,
                anexo: 'I',
                dataAbertura: '2026-05-10',
            },
            resumo: {
                ...baseResumo,
                inicioAtividade: true,
                mesesAtividade: 0,
            },
            mesApuracao: new Date(2026, 4, 1),
            faturamentoPorCnae: {
                'principal::0::4520001::I': { ...emptyState, valor: '10.000,00' },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            icmsVendas: 0,
        });

        expect(payload.declaracao.receitasBrutasAnteriores).toEqual([]);
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

describe('mapPgdasPayload — declaração por estabelecimento (filiais com CNPJ próprio)', () => {
    const matriz: SimplesNacionalEmpresa = {
        ...baseEmpresa,
        anexo: 'I',
        cnpj: '54.121.843/0001-75',
    };

    it('cria um estabelecimento por filial com o CNPJ e as atividades próprias', () => {
        const payload = mapPgdasPayload({
            empresa: matriz,
            resumo: { ...baseResumo, fator_r: 0 },
            mesApuracao: new Date(2026, 5, 1),
            faturamentoPorCnae: {
                'principal::0::4711302::I': { ...emptyState, valor: '10.000,00' },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            filiaisReceita: [
                { cnpj: '54121843000256', comercio: 0, industria: 123477.05, servico: 0 },
            ],
            icmsVendas: 0,
        });

        const estabs = payload.declaracao.estabelecimentos;
        expect(estabs).toHaveLength(2);

        // Matriz: sua própria receita de comércio.
        expect(estabs[0].cnpjCompleto).toBe('54121843000175');
        expect(estabs[0].atividades.map(a => a.idAtividade)).toEqual([1]);
        expect(estabs[0].atividades[0].valorAtividade).toBe(10000);

        // Filial: a indústria vai no CNPJ da filial, como idAtividade 4 (indústria).
        expect(estabs[1].cnpjCompleto).toBe('54121843000256');
        expect(estabs[1].atividades.map(a => a.idAtividade)).toEqual([4]);
        expect(estabs[1].atividades[0].valorAtividade).toBe(123477.05);

        // Total interno soma matriz + filial.
        expect(payload.declaracao.receitaPaCompetenciaInterno).toBe(133477.05);
    });

    it('ignora os buckets consolidados legados quando há receita por estabelecimento', () => {
        const payload = mapPgdasPayload({
            empresa: matriz,
            resumo: { ...baseResumo, fator_r: 0 },
            mesApuracao: new Date(2026, 5, 1),
            faturamentoPorCnae: {
                'principal::0::4711302::I': { ...emptyState, valor: '10.000,00' },
            },
            // Estes NÃO devem ser contados (per-filial ativo).
            filialComercio: 99999,
            filialIndustria: 88888,
            filialServico: 77777,
            filiaisReceita: [
                { cnpj: '54121843000256', comercio: 5000, industria: 0, servico: 0 },
            ],
            icmsVendas: 0,
        });

        expect(payload.declaracao.estabelecimentos).toHaveLength(2);
        expect(payload.declaracao.receitaPaCompetenciaInterno).toBe(15000);
    });

    it('mantém apenas a matriz quando filiaisReceita não tem receita > 0', () => {
        const payload = mapPgdasPayload({
            empresa: matriz,
            resumo: { ...baseResumo, fator_r: 0 },
            mesApuracao: new Date(2026, 5, 1),
            faturamentoPorCnae: {
                'principal::0::4711302::I': { ...emptyState, valor: '10.000,00' },
            },
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            filiaisReceita: [
                { cnpj: '54121843000256', comercio: 0, industria: 0, servico: 0 },
            ],
            icmsVendas: 0,
        });

        expect(payload.declaracao.estabelecimentos).toHaveLength(1);
        expect(payload.declaracao.estabelecimentos[0].cnpjCompleto).toBe('54121843000175');
        expect(payload.declaracao.receitaPaCompetenciaInterno).toBe(10000);
    });

    it('reparte comércio, indústria e serviço da mesma filial em atividades distintas', () => {
        const payload = mapPgdasPayload({
            empresa: { ...matriz, anexo: 'III' },
            resumo: { ...baseResumo, fator_r: 0 },
            mesApuracao: new Date(2026, 5, 1),
            faturamentoPorCnae: {},
            filialComercio: 0,
            filialIndustria: 0,
            filialServico: 0,
            filiaisReceita: [
                { cnpj: '54121843000256', comercio: 1000, industria: 2000, servico: 3000 },
            ],
            icmsVendas: 0,
        });

        const filial = payload.declaracao.estabelecimentos[1];
        expect(filial.cnpjCompleto).toBe('54121843000256');
        // comércio→1, indústria→4, serviço Anexo III próprio município (ISS retido)→15.
        expect(filial.atividades.map(a => a.idAtividade)).toEqual([1, 4, 15]);
        expect(payload.declaracao.receitaPaCompetenciaInterno).toBe(6000);
    });

    // ── Retenção de ISS: vai no ID, NUNCA em dobro ────────────────────────
    // Caso S&P (03/08/2026): o SERPRO recusava a entrega inteira com
    // MSG_ISN_032 "Retenção de ISS não é permitida para o idAtividade 15 com o
    // tributo ISS" — o mapper mandava a atividade 15 (que JÁ significa ISS
    // retido pelo tomador) E a qualificação tributária 1010/11.
    it('atividade 15 (Anexo III, ISS retido) NAO leva a qualificacao 1010/11 junto', () => {
        const payload = mapPgdasPayload({
            empresa: baseEmpresa,
            resumo: baseResumo,
            mesApuracao: new Date(2026, 6, 1),
            faturamentoPorCnae: {
                'principal::0::9602501::III': { ...emptyState, valor: '10.000,00', issRetido: true },
            },
            filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
        });

        const atividade = payload.declaracao.estabelecimentos[0].atividades[0];
        expect(atividade.idAtividade).toBe(15);
        const quals = atividade.receitasAtividade[0].qualificacoesTributarias || [];
        expect(quals.find((q) => q.codigoTributo === 1010)).toBeUndefined();
    });

    it('o mesmo vale pro Anexo V (12) e pro Anexo IV (18)', () => {
        const casos: Array<[string, number]> = [['V', 12], ['IV', 18]];
        for (const [anexo, id] of casos) {
            const payload = mapPgdasPayload({
                empresa: { ...baseEmpresa, anexo: anexo as any },
                resumo: baseResumo,
                mesApuracao: new Date(2026, 6, 1),
                faturamentoPorCnae: {
                    [`principal::0::9602501::${anexo}`]: { ...emptyState, valor: '10.000,00', issRetido: true },
                },
                filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
            });
            const atividade = payload.declaracao.estabelecimentos[0].atividades[0];
            expect(atividade.idAtividade).toBe(id);
            expect(atividade.receitasAtividade[0].qualificacoesTributarias).toBeUndefined();
        }
    });

    it('ST e monofasico seguem indo na qualificacao (so o ISS retido saiu)', () => {
        const payload = mapPgdasPayload({
            empresa: baseEmpresa,
            resumo: baseResumo,
            mesApuracao: new Date(2026, 6, 1),
            faturamentoPorCnae: {
                'principal::0::4711302::I': { ...emptyState, valor: '5.000,00', icmsSt: true, isMonofasico: true },
            },
            filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
        });

        const quals = payload.declaracao.estabelecimentos[0].atividades[0]
            .receitasAtividade[0].qualificacoesTributarias || [];
        expect(quals).toEqual([
            { codigoTributo: 1007, id: 8 },
            { codigoTributo: 1004, id: 9 },
            { codigoTributo: 1005, id: 9 },
        ]);
    });
});

describe('avisosDoPayload — o que reduz o DAS aqui mas ainda nao viaja na declaracao', () => {
    it('receita com ISS(SUP) avisa que o PGDAS-D nao recebe o ISS fixo', () => {
        const avisos = avisosDoPayload({
            'principal::0::9602501::III': { ...emptyState, valor: '10.000,00', isSup: true },
        } as any);
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toContain('ISS(SUP)');
        expect(avisos[0]).toContain('Confira');
    });

    it('receita IMUNE tambem avisa', () => {
        const avisos = avisosDoPayload({
            'principal::0::4711302::I': { ...emptyState, valor: '10.000,00', isImune: true },
        } as any);
        expect(avisos[0]).toContain('IMUNE');
    });

    it('marcacao SEM valor nao vira aviso (linha zerada nao declara nada)', () => {
        expect(avisosDoPayload({
            'principal::0::9602501::III': { ...emptyState, valor: '0,00', isSup: true },
        } as any)).toEqual([]);
    });

    it('apuracao normal nao inventa aviso', () => {
        expect(avisosDoPayload({
            'principal::0::9602501::III': { ...emptyState, valor: '10.000,00' },
        } as any)).toEqual([]);
    });
});
