async function loadProvider(mode?: 'mock' | 'serpro') {
    jest.resetModules();
    if (mode) process.env.NFSE_NAC_MODE = mode;
    else delete process.env.NFSE_NAC_MODE;
    // @ts-expect-error modulo .js puro sem types; transformado pelo ts-jest.
    return import('../sefaz-backend/nfse-nacional-provider.js');
}

describe('NFSe Nacional provider gate', () => {
    const OLD_MODE = process.env.NFSE_NAC_MODE;

    afterEach(() => {
        if (OLD_MODE === undefined) delete process.env.NFSE_NAC_MODE;
        else process.env.NFSE_NAC_MODE = OLD_MODE;
        jest.resetModules();
    });

    it('usa serpro por default, mas bloqueia emissao enquanto provider real nao existe', async () => {
        const mod = await loadProvider();

        expect(mod.getNfseNacionalCapabilities()).toMatchObject({
            mode: 'serpro',
            emissaoDisponivel: false,
            cancelamentoDisponivel: false,
            emissaoFiscalDisponivel: false,
            capturaDfeDisponivel: true,
        });

        await expect(mod.getNfseNacionalProvider().emitirNfse({})).rejects.toMatchObject({
            code: 'NFSE_NACIONAL_SERPRO_NOT_IMPLEMENTED',
            statusCode: 501,
            feature: 'emissao',
        });
    });

    it('mantem mock disponivel apenas quando NFSE_NAC_MODE=mock', async () => {
        const mod = await loadProvider('mock');

        expect(mod.getNfseNacionalCapabilities()).toMatchObject({
            mode: 'mock',
            emissaoDisponivel: true,
            cancelamentoDisponivel: true,
            emissaoFiscalDisponivel: false,
        });

        await expect(mod.getNfseNacionalProvider().emitirNfse({
            prestador: { cnpj: '44388152000189', nome: 'SP Assessoria' },
            tomador: { cnpj: '11222333000144', nome: 'Cliente Teste' },
            servico: {
                codigoNbs: '101010100',
                descricao: 'Escrituracao contabil',
                valor: 1000,
                aliquotaIss: 5,
            },
        })).resolves.toMatchObject({
            fonte: 'mock',
            status: 'autorizada',
            servico: { issValor: 50 },
        });
    });
});
