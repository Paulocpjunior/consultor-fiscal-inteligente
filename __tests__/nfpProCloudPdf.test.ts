import type { NfpAnaliseEmpresa } from '../types';
import { coletarInconsistenciasManuais, montarResumoTecnicoNfp } from '../services/nfpProCloudPdf';

function baseAnalise(): NfpAnaliseEmpresa {
    return {
        empresaId: 'prospect_46317827000124',
        empresaNome: 'CLICK PISCINAS',
        empresaCnpj: '46317827000124',
        dataAnalise: '2026-07-01T12:00:00.000Z',
        analisadoPor: 'Paulo',
        fonte: 'offline',
        debitos: [],
        parcelamentos: [],
        certidoes: [],
        obrigacoes: [],
        acoes: [],
        planoAcao: [],
    };
}

describe('nfpProCloudPdf helpers', () => {
    it('coleta observações manuais das obrigações como inconsistências do relatório', () => {
        const analise = baseAnalise();
        analise.obrigacoes = [{
            id: 'obg_1',
            empresaId: analise.empresaId,
            nome: 'SPED Fiscal (EFD ICMS/IPI)',
            sigla: 'SPED Fiscal',
            esfera: 'estadual',
            periodicidade: 'mensal',
            competencia: '01/2023 a 05/2026',
            status: 'nao_verificada',
            observacao: 'Ausência das informações do Bloco K nas competências analisadas.',
        }];

        const inconsistencias = coletarInconsistenciasManuais(analise);

        expect(inconsistencias).toHaveLength(1);
        expect(inconsistencias[0]).toMatchObject({
            categoria: 'Obrigação Estadual',
            status: 'Não verificada',
            competencia: '01/2023 a 05/2026',
        });
        expect(inconsistencias[0].detalhe).toContain('Bloco K');
    });

    it('monta resumo técnico citando pendências manuais e obrigações com alerta', () => {
        const analise = baseAnalise();
        const inconsistencias = [{
            titulo: 'SPED Fiscal - SPED Fiscal (EFD ICMS/IPI)',
            categoria: 'Obrigação Estadual',
            status: 'Não verificada',
            competencia: '01/2023 a 05/2026',
            detalhe: 'Ausência do Bloco K.',
        }];
        const obrigacao = {
            id: 'obg_1',
            empresaId: analise.empresaId,
            nome: 'SPED Fiscal (EFD ICMS/IPI)',
            sigla: 'SPED Fiscal',
            esfera: 'estadual' as const,
            periodicidade: 'mensal' as const,
            status: 'nao_verificada' as const,
            observacao: 'Ausência do Bloco K.',
        };

        const resumo = montarResumoTecnicoNfp({
            analise,
            semaforo: 'amarelo',
            debitosAbertos: [],
            obrigacoesPendentes: [obrigacao],
            certidoesRestritivas: [],
            inconsistenciasManuais: inconsistencias,
            parcelamentosIrregulares: [],
        });

        expect(resumo.join(' ')).toContain('1 obrigação(ões)');
        expect(resumo.join(' ')).toContain('1 inconsistência(s)');
        expect(resumo.join(' ')).toContain('plano de ação');
    });
});
