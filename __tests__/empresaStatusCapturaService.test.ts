import {
    formatarErroAcaoStatusCaptura,
    formatarMotivoBloqueioCaptura,
    exportarEmpresasCsv,
    type EmpresaStatusCaptura,
} from '../services/empresaStatusCapturaService';

const empresaBase: EmpresaStatusCaptura = {
    id: 'e1',
    cnpj: '66641236000115',
    nome: 'HYPE CAFE SERVICOS DE ALIMENTACAO LTDA',
    regime: 'lucro',
    fonte: 'lucro_empresas',
    uf: 'SP',
    tipoCert: 'A1',
    certUploaded: true,
    certValido: true,
    certVenceEm: null,
    usaCertEscritorio: false,
    procuracaoEcacAtiva: false,
    procuracaoEcacFlagBruta: false,
    ccmSp: '',
    nfseSpAutorizado: false,
    nfseNacionalDfeAtivo: false,
    capturarSefaz: true,
    capturaNfeOk: true,
    capturaNfseSpOk: false,
    capturaNfseNacionalOk: false,
    capturaNfseNacionalVia: 'inativa',
    motivosBloqueio: ['NFSe Nacional: flag nfseNacionalDfeAtivo desabilitada'],
    responsaveis: [{ nome: 'sandra', papel: 'principal' }],
    ultimaSyncMs: null,
    ultNSU: null,
    cStatUltimaSync: null,
};

describe('empresaStatusCapturaService mensagens', () => {
    it('traduz flag tecnica de NFS-e Nacional para mensagem operacional', () => {
        expect(formatarMotivoBloqueioCaptura('NFSe Nacional: flag nfseNacionalDfeAtivo desabilitada'))
            .toBe('NFS-e Nacional ADN desativada no cadastro. Ative NFS-e Nacional para incluir esta empresa na captura ADN.');
    });

    it('traduz erro de empresa nao encontrada com CNPJ e proximo passo', () => {
        const msg = formatarErroAcaoStatusCaptura(
            { error: 'Empresa não encontrada', code: 'EMPRESA_NAO_ENCONTRADA', cnpj: '66641236000115' },
            empresaBase,
            'salvar a alteração',
        );

        expect(msg).toContain('Não consegui salvar a alteração');
        expect(msg).toContain('HYPE CAFE SERVICOS DE ALIMENTACAO LTDA');
        expect(msg).toContain('66.641.236/0001-15');
        expect(msg).toContain('Atualize o painel');
    });

    it('exporta CSV com motivos amigaveis', () => {
        const csv = exportarEmpresasCsv([empresaBase]);

        expect(csv).toContain('NFS-e Nacional ADN desativada no cadastro');
        expect(csv).not.toContain('nfseNacionalDfeAtivo');
    });
});
