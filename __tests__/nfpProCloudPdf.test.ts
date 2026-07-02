import type { NfpAnaliseEmpresa } from '../types';
import {
    coletarInconsistenciasManuais,
    montarCamposObrigacaoPdf,
    montarPlanoAcaoRelatorioPdf,
    montarResumoTecnicoNfp,
} from '../services/nfpProCloudPdf';

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
        expect(inconsistencias[0].evidencias?.map(e => `${e.label}:${e.value}`).join('|')).toContain('Observação / pendência:Ausência das informações do Bloco K');
    });

    it('inclui obrigação não verificada como pendência mesmo sem observação livre', () => {
        const analise = baseAnalise();
        analise.obrigacoes = [{
            id: 'obg_1',
            empresaId: analise.empresaId,
            nome: 'DCTFWeb',
            sigla: 'DCTFWeb',
            esfera: 'federal',
            periodicidade: 'mensal',
            status: 'nao_verificada',
        }];

        const inconsistencias = coletarInconsistenciasManuais(analise);

        expect(inconsistencias).toHaveLength(1);
        expect(inconsistencias[0].detalhe).toContain('Não verificada');
    });

    it('monta campos completos da obrigação para o PDF', () => {
        const campos = montarCamposObrigacaoPdf({
            id: 'obg_1',
            empresaId: 'prospect_46317827000124',
            nome: 'SPED Fiscal (EFD ICMS/IPI)',
            sigla: 'SPED Fiscal',
            esfera: 'estadual',
            periodicidade: 'mensal',
            competencia: '01/2023 a 05/2026',
            status: 'nao_verificada',
            prazoLegal: '2026-06-20',
            dataEntrega: '2026-06-30',
            observacao: 'Ausência das informações do Bloco K nas competências analisadas.',
        });

        const mapa = Object.fromEntries(campos.map(c => [c.label, c.value]));
        expect(mapa).toMatchObject({
            Esfera: 'Estadual',
            Sigla: 'SPED Fiscal',
            Obrigação: 'SPED Fiscal (EFD ICMS/IPI)',
            Periodicidade: 'Mensal',
            Competência: '01/2023 a 05/2026',
            'Prazo legal': '20/06/2026',
            'Data de entrega': '30/06/2026',
            Status: 'Não verificada',
            'Observação / pendência': 'Ausência das informações do Bloco K nas competências analisadas.',
        });
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
        expect(resumo.join(' ')).toContain('1 pendência(s)');
        expect(resumo.join(' ')).toContain('plano de ação');
    });

    it('gera plano de ação sugerido quando há pendências e nenhum plano salvo', () => {
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
        }];
        const pendencias = coletarInconsistenciasManuais(analise);

        const plano = montarPlanoAcaoRelatorioPdf(analise, pendencias, new Date('2026-07-02T12:00:00.000Z'));

        expect(plano).toHaveLength(1);
        expect(plano[0]).toMatchObject({
            descricao: 'Validar e regularizar: SPED Fiscal - SPED Fiscal (EFD ICMS/IPI)',
            esfera: 'estadual',
            gravidade: 'media',
            prazo: '2026-07-09',
            responsavel: 'Equipe fiscal',
            status: 'pendente',
        });
    });
});
