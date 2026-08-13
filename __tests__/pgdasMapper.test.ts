import type { SimplesNacionalEmpresa, SimplesNacionalResumo } from '../types';
import { mapPgdasPayload, avisosDoPayload, bloqueiosDoPayload } from '../services/pgdasMapper';

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
    it('receita com ISS fixo (SUP) nao vira AVISO — vira BLOQUEIO (ver bloqueiosDoPayload)', () => {
        expect(avisosDoPayload({
            'principal::0::9602501::III': { ...emptyState, valor: '10.000,00', isSup: true },
        } as any)).toEqual([]);
    });

    it('receita IMUNE tambem avisa — e agora manda CONFERIR O EXTRATO', () => {
        const avisos = avisosDoPayload({
            'principal::0::4711302::I': { ...emptyState, valor: '10.000,00', isImune: true },
        } as any);
        expect(avisos[0]).toContain('IMUNE');
        // O aviso mudou de papel: antes dizia que a qualificacao NAO viajava.
        // Agora ela viaja, e o que sobra e a conferencia — o DAS e o MESMO com
        // e sem a qualificacao, entao so o extrato denuncia se ela nao pegou.
        // E a mesma armadilha do ISS fixo (SUP), que passou meses despercebida.
        expect(avisos[0]).toContain('1007');
        expect(avisos[0]).toContain('1008');
        expect(avisos[0]).toMatch(/extrato/);
        expect(avisos[0]).not.toMatch(/ainda não envia|ainda nao envia/);
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

describe('ISS fixo do escritorio contabil (SUP) — caso S&P', () => {
    // Indicacao correta (Paulo, 03/08/2026): "Prestacao de Servicos, exceto para o
    // exterior - Escritorios de servicos contabeis autorizados pela legislacao
    // municipal a pagar o ISS em valor fixo em guia do Municipio" (LC 123 §22-A).
    // Enquanto o CODIGO oficial dessa atividade nao entra no app, a receita
    // marcada como SUP viaja como ISS retido: MESMO DAS, natureza a corrigir.
    it('SUP tira o ISS do DAS pela mesma atividade do ISS retido (valor preservado)', () => {
        const payload = mapPgdasPayload({
            empresa: baseEmpresa,
            resumo: baseResumo,
            mesApuracao: new Date(2026, 6, 1),
            faturamentoPorCnae: {
                'principal::0::6920601::III': { ...emptyState, valor: '20.000,00', isSup: true },
            },
            filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
        });

        const atividade = payload.declaracao.estabelecimentos[0].atividades[0];
        expect(atividade.idAtividade).toBe(15);
        expect(atividade.valorAtividade).toBe(20000);
        // e sem a qualificacao de retencao (que derrubava a entrega inteira)
        expect(atividade.receitasAtividade[0].qualificacoesTributarias).toBeUndefined();
    });

    it('enquanto falta o codigo, a transmissao e RECUSADA (nao vai errado pro Simples)', () => {
        const entrada = {
            'principal::0::6920601::III': { ...emptyState, valor: '20.000,00', isSup: true },
        } as any;
        // O valor calculado segue certo (id 15 tira o ISS do DAS)...
        expect(avisosDoPayload(entrada)).toEqual([]);
        // ...mas a entrega para: natureza errada na declaracao nao se desfaz.
        expect(bloqueiosDoPayload(entrada)[0]).toContain('valor fixo em guia do Município');
    });

    it('SUP no Anexo V e no IV tambem mantem o ISS fora do DAS', () => {
        for (const [anexo, id] of [['V', 12], ['IV', 18]] as Array<[string, number]>) {
            const payload = mapPgdasPayload({
                empresa: { ...baseEmpresa, anexo: anexo as any },
                resumo: baseResumo,
                mesApuracao: new Date(2026, 6, 1),
                faturamentoPorCnae: {
                    [`principal::0::6920601::${anexo}`]: { ...emptyState, valor: '20.000,00', isSup: true },
                },
                filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
            });
            expect(payload.declaracao.estabelecimentos[0].atividades[0].idAtividade).toBe(id);
        }
    });

    it('servico para o EXTERIOR ignora a marcacao de SUP (nao ha ISS a fixar)', () => {
        const payload = mapPgdasPayload({
            empresa: baseEmpresa,
            resumo: baseResumo,
            mesApuracao: new Date(2026, 6, 1),
            faturamentoPorCnae: {
                'principal::0::6920601::III': { ...emptyState, valor: '20.000,00', isSup: true, isExterior: true },
            },
            filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
        });
        expect(payload.declaracao.estabelecimentos[0].atividades[0].idAtividade).toBe(30);
    });
});

describe('bloqueiosDoPayload — o app se RECUSA a declarar natureza que nao sabe montar', () => {
    // Paulo, 03/08: "Continua com a MSG acima, e leva errado pro SIMPLES."
    // Enquanto o codigo da atividade de ISS fixo nao entra, transmitir mandaria
    // "ISS retido pelo tomador" — valor certo, natureza errada. Entrega ao
    // PGDAS-D nao se desfaz: melhor recusar e mandar entregar pelo e-CAC.
    it('receita com ISS fixo (SUP) bloqueia a transmissao com a acao pratica', () => {
        const bloqueios = bloqueiosDoPayload({
            'principal::0::6920601::III': { ...emptyState, valor: '151.619,17', isSup: true },
        } as any);

        expect(bloqueios).toHaveLength(1);
        expect(bloqueios[0]).toContain('Escritórios de serviços contábeis');
        expect(bloqueios[0]).toContain('Atividades declaradas');
        expect(bloqueios[0]).toContain('e-CAC');
    });

    it('o bloqueio viaja no payload pra defesa do backend', () => {
        const payload = mapPgdasPayload({
            empresa: baseEmpresa,
            resumo: baseResumo,
            mesApuracao: new Date(2026, 6, 1),
            faturamentoPorCnae: {
                'principal::0::6920601::III': { ...emptyState, valor: '151.619,17', isSup: true },
            },
            filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
        });
        expect(payload._bloqueios).toHaveLength(1);
    });

    it('ISS retido de verdade NAO bloqueia (o app sabe declarar isso)', () => {
        expect(bloqueiosDoPayload({
            'principal::0::9602501::III': { ...emptyState, valor: '10.000,00', issRetido: true },
        } as any)).toEqual([]);
    });

    it('marcacao SUP sem valor nao bloqueia (linha zerada nao declara nada)', () => {
        expect(bloqueiosDoPayload({
            'principal::0::9602501::III': { ...emptyState, valor: '0,00', isSup: true },
        } as any)).toEqual([]);
    });

    it('apuracao normal transmite sem bloqueio', () => {
        expect(bloqueiosDoPayload({
            'principal::0::9602501::III': { ...emptyState, valor: '10.000,00' },
        } as any)).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUALIFICAÇÃO TRIBUTÁRIA — os ids vieram do FORMULÁRIO do e-CAC (13/08/2026).
//
// Paulo colou o `outerHTML` do `<select>` da coluna de cada tributo na tela de
// Receitas do PGDAS-D. É a MESMA fonte que destravou o código 9 do ISS fixo, e
// a única que existe: o CONSULTIMADECREC14 devolve só PDFs, e o extrato é a
// saída humana ("Imunidade tributária de: ICMS, IPI.") — sem id nenhum.
//
//   data-cod-tributo="1007" (ICMS): 1 Imunidade · 2 Exigibilidade Suspensa ·
//                                   3 Lançamento de Ofício · 4 Isenção/Redução ·
//                                   6 Isenção/Redução Cesta Básica
//   data-cod-tributo="1008" (IPI):  1 · 2 · 3   ← PARA no 3
//
// O IPI não tem "Isenção/Redução". Não é omissão do print: é o formulário
// dizendo que isso não existe no campo.
// ═══════════════════════════════════════════════════════════════════════════
describe('imunidade viaja na declaração — caso POLO CULTURAL 06/2026', () => {
    // Extrato real: receita 22.169,56 · "Venda de mercadorias industrializadas
    // pelo contribuinte, exceto para o exterior" · ICMS 0,00 · IPI 0,00 ·
    // "Imunidade tributária de: ICMS, IPI." (livro — CF art. 150, VI, "d").
    const payloadImune = () => mapPgdasPayload({
        empresa: { ...baseEmpresa, anexo: 'II' },
        resumo: baseResumo,
        mesApuracao: new Date(2026, 5, 1),
        faturamentoPorCnae: {
            'principal::0::5811500::II': { ...emptyState, valor: '22.169,56', isImune: true },
        },
        filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
    });

    it('emite a qualificação de imunidade para ICMS (1007) E IPI (1008)', () => {
        const receita = payloadImune().declaracao.estabelecimentos[0].atividades[0].receitasAtividade[0];
        expect(receita.valor).toBe(22169.56);
        expect(receita.qualificacoesTributarias).toEqual([
            { codigoTributo: 1007, id: 1 },
            { codigoTributo: 1008, id: 1 },
        ]);
    });

    it('a imunidade NÃO inventa qualificação de PIS/COFINS/ISS', () => {
        const quals = payloadImune().declaracao.estabelecimentos[0].atividades[0]
            .receitasAtividade[0].qualificacoesTributarias || [];
        const tributos = quals.map((q) => q.codigoTributo);
        expect(tributos).not.toContain(1004);
        expect(tributos).not.toContain(1005);
        expect(tributos).not.toContain(1010);
    });

    it('receita SEM a marcação continua sem qualificação nenhuma', () => {
        const payload = mapPgdasPayload({
            empresa: { ...baseEmpresa, anexo: 'II' },
            resumo: baseResumo,
            mesApuracao: new Date(2026, 5, 1),
            faturamentoPorCnae: {
                'principal::0::5811500::II': { ...emptyState, valor: '22.169,56' },
            },
            filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
        });
        expect(payload.declaracao.estabelecimentos[0].atividades[0]
            .receitasAtividade[0].qualificacoesTributarias).toBeUndefined();
    });

    // Imunidade + ST na mesma receita: as duas viajam, sem uma apagar a outra.
    it('convive com as qualificações que já existiam (ST, monofásico)', () => {
        const payload = mapPgdasPayload({
            empresa: { ...baseEmpresa, anexo: 'I' },
            resumo: baseResumo,
            mesApuracao: new Date(2026, 5, 1),
            faturamentoPorCnae: {
                'principal::0::4711302::I': {
                    ...emptyState, valor: '10.000,00', isImune: true, icmsSt: true,
                },
            },
            filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
        });
        const quals = payload.declaracao.estabelecimentos[0].atividades[0]
            .receitasAtividade[0].qualificacoesTributarias || [];
        expect(quals).toContainEqual({ codigoTributo: 1007, id: 8 });   // ST
        expect(quals).toContainEqual({ codigoTributo: 1007, id: 1 });   // imunidade
        expect(quals).toContainEqual({ codigoTributo: 1008, id: 1 });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// ISENÇÃO ≠ IMUNIDADE — caso JAGUAREXPORT 07/2026.
//
// Extrato real: receita 63.878,60 · "Parcela 1: R$ 63.878,60" · "Isenção de
// ICMS: R$ 63.878,60" · coluna ICMS = 0,00, e o resto cobrado normalmente
// (IRPJ 335,49 · CSLL 213,49 · COFINS 777,12 · PIS 168,35 · CPP 2.561,92 ·
// total 4.056,37).
//
// Compare com a POLO CULTURAL: "Imunidade tributária de: ICMS, IPI." — SEM
// valor, porque a imunidade é um ESTADO da parcela inteira; a isenção é um
// VALOR dela. Naturezas diferentes, efeitos diferentes no DAS.
// ═══════════════════════════════════════════════════════════════════════════
describe('isenção de ICMS viaja na declaração — caso JAGUAREXPORT 07/2026', () => {
    const payloadIsento = (over: any = {}) => mapPgdasPayload({
        empresa: { ...baseEmpresa, anexo: 'I' },
        resumo: baseResumo,
        mesApuracao: new Date(2026, 6, 1),
        faturamentoPorCnae: {
            'principal::0::4632001::I': { ...emptyState, valor: '63.878,60', isIsento: true, ...over },
        },
        filialComercio: 0, filialIndustria: 0, filialServico: 0, icmsVendas: 0,
    });

    it('emite Isenção/Redução (id 4) SÓ para ICMS — o IPI não tem esse campo', () => {
        const receita = payloadIsento().declaracao.estabelecimentos[0].atividades[0].receitasAtividade[0];
        expect(receita.valor).toBe(63878.60);
        expect(receita.qualificacoesTributarias).toEqual([{ codigoTributo: 1007, id: 4 }]);
    });

    it('NÃO emite imunidade junto — são naturezas diferentes', () => {
        const quals = payloadIsento().declaracao.estabelecimentos[0].atividades[0]
            .receitasAtividade[0].qualificacoesTributarias || [];
        expect(quals.some((q) => q.id === 1)).toBe(false);
        expect(quals.some((q) => q.codigoTributo === 1008)).toBe(false);
    });

    // A rede de baixo do excludente da tela: se as duas chegarem marcadas, a
    // IMUNIDADE vence e a isenção NÃO viaja junto. Mandar as duas no mesmo
    // tributo é a forma do MSG_ISN_032 — derruba a ENTREGA INTEIRA.
    it('marcadas as DUAS, só a imunidade viaja (nunca as duas no mesmo tributo)', () => {
        const quals = payloadIsento({ isImune: true }).declaracao.estabelecimentos[0]
            .atividades[0].receitasAtividade[0].qualificacoesTributarias || [];
        expect(quals).toEqual([
            { codigoTributo: 1007, id: 1 },
            { codigoTributo: 1008, id: 1 },
        ]);
        expect(quals.some((q) => q.id === 4)).toBe(false);
    });

    it('o aviso diz que o IPI NÃO sai, e manda conferir o extrato', () => {
        const avisos = avisosDoPayload({
            'principal::0::4632001::I': { ...emptyState, valor: '63.878,60', isIsento: true },
        } as any);
        expect(avisos[0]).toContain('ISENTA');
        expect(avisos[0]).toContain('1007');
        expect(avisos[0]).toMatch(/IPI NÃO|IPI não/);
        expect(avisos[0]).toMatch(/extrato/);
    });
});
