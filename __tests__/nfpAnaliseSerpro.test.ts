import type { NfpAnaliseEmpresa, NfpCertidao, NfpObrigacao } from '../types';
import { mapearRespostaSerpro } from '../services/nfpAnaliseSerpro';

function baseAnalise(obrigacoes: NfpObrigacao[], certidoes: NfpCertidao[] = []): NfpAnaliseEmpresa {
    return {
        empresaId: 'prospect_46317827000124',
        empresaNome: 'CLICK PISCINAS',
        empresaCnpj: '46317827000124',
        dataAnalise: '2026-07-02T12:00:00.000Z',
        analisadoPor: 'Paulo',
        fonte: 'offline',
        debitos: [],
        certidoes,
        obrigacoes,
        parcelamentos: [],
        acoes: [],
        planoAcao: [],
    };
}

describe('mapearRespostaSerpro', () => {
    it('preserva observações manuais ao atualizar obrigações pela análise automática', () => {
        const { updated } = mapearRespostaSerpro({
            resp: {
                obrigacoes: {
                    ok: true,
                    obrigacoes: [{ sigla: 'EFD', status: 'nao_verificada' }],
                },
            },
            baseAnalise: baseAnalise([{
                id: 'obg_efd',
                empresaId: 'prospect_46317827000124',
                nome: 'SPED Fiscal',
                sigla: 'EFD',
                esfera: 'federal',
                periodicidade: 'mensal',
                status: 'nao_verificada',
                competencia: '01/2023 a 05/2026',
                observacao: 'Ausência do Bloco K informada pela equipe.',
            }]),
            activeEmpresaId: 'prospect_46317827000124',
            analisadoPor: 'Paulo',
            fonteAnalise: 'offline',
            certidoesBase: [],
            obrigacoesBase: [{
                nome: 'SPED Fiscal',
                sigla: 'EFD',
                esfera: 'federal',
                periodicidade: 'mensal',
            }],
            uid: () => 'novo_id',
        });

        expect(updated.obrigacoes).toHaveLength(1);
        expect(updated.obrigacoes[0]).toMatchObject({
            id: 'obg_efd',
            observacao: 'Ausência do Bloco K informada pela equipe.',
            competencia: '01/2023 a 05/2026',
        });
    });

    it('mantém obrigação customizada de SPED ICMS fora da lista base', () => {
        const { updated } = mapearRespostaSerpro({
            resp: {
                obrigacoes: {
                    ok: true,
                    obrigacoes: [{ sigla: 'EFD', status: 'nao_verificada' }],
                },
            },
            baseAnalise: baseAnalise([{
                id: 'obg_sped_icms',
                empresaId: 'prospect_46317827000124',
                nome: 'SPED ICMS/IPI',
                sigla: 'SPED ICMS',
                esfera: 'estadual',
                periodicidade: 'mensal',
                status: 'nao_verificada',
                competencia: '01/2023 a 05/2026',
                observacao: 'Ausência do Bloco K em todos os meses informados.',
            }]),
            activeEmpresaId: 'prospect_46317827000124',
            analisadoPor: 'Paulo',
            fonteAnalise: 'offline',
            certidoesBase: [],
            obrigacoesBase: [{
                nome: 'SPED Fiscal',
                sigla: 'EFD',
                esfera: 'federal',
                periodicidade: 'mensal',
            }],
            uid: () => 'novo_id',
        });

        expect(updated.obrigacoes).toHaveLength(2);
        expect(updated.obrigacoes.find(o => o.sigla === 'SPED ICMS')).toMatchObject({
            id: 'obg_sped_icms',
            esfera: 'estadual',
            observacao: 'Ausência do Bloco K em todos os meses informados.',
        });
    });

    it('preserva datas manuais das certidões ao atualizar pela análise automática', () => {
        const { updated } = mapearRespostaSerpro({
            resp: {
                certidoes: {
                    ok: true,
                    certidoes: [{ esfera: 'estadual', status: 'nao_consultada' }],
                },
            },
            baseAnalise: baseAnalise([], [{
                id: 'cert_estadual',
                empresaId: 'prospect_46317827000124',
                esfera: 'estadual',
                orgao: 'SEFAZ Estadual',
                tipo: 'CND Estadual (ICMS)',
                status: 'nao_consultada',
                dataEmissao: '2026-07-01',
                dataValidade: '2026-10-01',
                dataConsulta: '2026-07-02',
                motivoImpedimento: 'Certidão validada manualmente no portal estadual.',
                fonte: 'manual',
            }]),
            activeEmpresaId: 'prospect_46317827000124',
            analisadoPor: 'Paulo',
            fonteAnalise: 'offline',
            certidoesBase: [{
                orgao: 'SEFAZ Estadual',
                tipo: 'CND Estadual (ICMS)',
                esfera: 'estadual',
                fonte: 'manual',
            }],
            obrigacoesBase: [],
            uid: () => 'novo_id',
        });

        expect(updated.certidoes).toHaveLength(1);
        expect(updated.certidoes[0]).toMatchObject({
            id: 'cert_estadual',
            dataEmissao: '2026-07-01',
            dataValidade: '2026-10-01',
            motivoImpedimento: 'Certidão validada manualmente no portal estadual.',
            fonte: 'manual',
        });
    });

    it('mantém certidão customizada fora da lista base', () => {
        const { updated } = mapearRespostaSerpro({
            resp: {
                certidoes: {
                    ok: true,
                    certidoes: [{ esfera: 'federal', status: 'negativa', validade: '2026-12-31' }],
                },
            },
            baseAnalise: baseAnalise([], [{
                id: 'cert_municipal_manual',
                empresaId: 'prospect_46317827000124',
                esfera: 'municipal',
                orgao: 'Prefeitura Municipal',
                tipo: 'CND Municipal',
                status: 'nao_consultada',
                dataEmissao: '2026-07-01',
                dataValidade: '2026-08-01',
                motivoImpedimento: 'Certidão municipal registrada manualmente.',
                fonte: 'manual',
            }]),
            activeEmpresaId: 'prospect_46317827000124',
            analisadoPor: 'Paulo',
            fonteAnalise: 'offline',
            certidoesBase: [{
                orgao: 'Receita Federal',
                tipo: 'CND Federal',
                esfera: 'federal',
                fonte: 'automatico',
            }],
            obrigacoesBase: [],
            uid: () => 'novo_id',
        });

        expect(updated.certidoes).toHaveLength(2);
        expect(updated.certidoes.find(c => c.tipo === 'CND Municipal')).toMatchObject({
            id: 'cert_municipal_manual',
            dataEmissao: '2026-07-01',
            dataValidade: '2026-08-01',
            motivoImpedimento: 'Certidão municipal registrada manualmente.',
            fonte: 'manual',
        });
    });
});
