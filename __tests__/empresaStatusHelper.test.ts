// @ts-expect-error modulo JS puro
import { classificarCapturaNfseNacionalAdn } from '../sefaz-backend/empresa-status-helper.js';
// @ts-expect-error modulo JS puro
import { pareceNfseNacional } from '../sefaz-backend/agent-xml-helper.js';

describe('classificarCapturaNfseNacionalAdn', () => {
    it('marca A3 ativo como coberto por agente local', () => {
        const r = classificarCapturaNfseNacionalAdn({
            nfseNacionalDfeAtivo: true,
            temA1ProprioValido: false,
            ehEscritorio: false,
            tipoCert: 'A3',
            usaCertEscritorio: false,
            procuracaoEcacAtiva: false,
            certUploaded: true,
            certValido: false,
        });

        expect(r).toEqual({ ok: true, via: 'a3-local', motivo: null });
    });

    it('mantem A1 proprio valido como captura em nuvem', () => {
        const r = classificarCapturaNfseNacionalAdn({
            nfseNacionalDfeAtivo: true,
            temA1ProprioValido: true,
            ehEscritorio: false,
            tipoCert: 'A1',
            usaCertEscritorio: false,
            procuracaoEcacAtiva: false,
            certUploaded: true,
            certValido: true,
        });

        expect(r).toEqual({ ok: true, via: 'cloud-a1', motivo: null });
    });

    it('bloqueia certificado do escritorio/procuracao para ADN sem A1 proprio', () => {
        const r = classificarCapturaNfseNacionalAdn({
            nfseNacionalDfeAtivo: true,
            temA1ProprioValido: false,
            ehEscritorio: false,
            tipoCert: 'escritorio',
            usaCertEscritorio: true,
            procuracaoEcacAtiva: true,
            certUploaded: false,
            certValido: false,
        });

        expect(r.ok).toBe(false);
        expect(r.via).toBe('bloqueada');
        expect(r.motivo).toContain('A1 próprio');
        expect(r.motivo).toContain('agente A3 local');
    });

    it('mantem flag inativa como pendencia operacional', () => {
        const r = classificarCapturaNfseNacionalAdn({
            nfseNacionalDfeAtivo: false,
            temA1ProprioValido: false,
            ehEscritorio: false,
            tipoCert: 'A3',
            usaCertEscritorio: false,
            procuracaoEcacAtiva: false,
            certUploaded: true,
            certValido: false,
        });

        expect(r.ok).toBe(false);
        expect(r.via).toBe('inativa');
        expect(r.motivo).toContain('desativada');
    });
});

describe('pareceNfseNacional', () => {
    it('identifica XML de NFS-e Nacional pelo infNFSe', () => {
        expect(pareceNfseNacional('<DFe><infNFSe Id="NFSe123"></infNFSe></DFe>', null)).toBe(true);
    });

    it('nao classifica NFe como NFS-e Nacional', () => {
        expect(pareceNfseNacional('<nfeProc><infNFe Id="NFe3526"></infNFe></nfeProc>', 'procNFe_v4.00.xsd')).toBe(false);
    });
});
