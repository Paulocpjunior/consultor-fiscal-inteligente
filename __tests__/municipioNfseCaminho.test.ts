/**
 * Testes do registro de caminho de captura de NFS-e por município.
 * Regra 2026 (LC 214/2025): default é ADN (Padrão Nacional, por CNPJ).
 */
// @ts-expect-error — módulo .js puro
import { caminhoNfseRecomendado, listarMunicipiosNfse, CAMINHO_NFSE, MUNICIPIOS_NFSE } from '../sefaz-backend/municipio-nfse-caminho.js';

describe('caminhoNfseRecomendado', () => {
    it('os 7 municípios priorizados são ADN', () => {
        for (const cod of ['3518800', '3534401', '3547809', '3548708', '3552205', '3549904', '3543402']) {
            const r = caminhoNfseRecomendado(cod);
            expect(r.caminho).toBe(CAMINHO_NFSE.ADN);
            expect(r.conhecido).toBe(true);
            expect(r.nome).toBeTruthy();
        }
    });

    it('São Paulo capital → portal próprio', () => {
        expect(caminhoNfseRecomendado('3550308').caminho).toBe(CAMINHO_NFSE.SP_PORTAL);
    });

    it('município não catalogado → ADN (padrão 2026), conhecido=false', () => {
        const r = caminhoNfseRecomendado('4106902'); // Curitiba (não está no registro de caminho)
        expect(r.caminho).toBe(CAMINHO_NFSE.ADN);
        expect(r.conhecido).toBe(false);
    });

    it('aceita IBGE com máscara/espaços', () => {
        expect(caminhoNfseRecomendado(' 3518800 ').caminho).toBe(CAMINHO_NFSE.ADN);
        expect(caminhoNfseRecomendado('3518800').cod).toBe('3518800');
    });

    it('IBGE ausente/curto → ADN default, cod null quando vazio', () => {
        expect(caminhoNfseRecomendado(null).caminho).toBe(CAMINHO_NFSE.ADN);
        expect(caminhoNfseRecomendado(null).cod).toBeNull();
        expect(caminhoNfseRecomendado('123').caminho).toBe(CAMINHO_NFSE.ADN); // < 7 dígitos
    });
});

describe('listarMunicipiosNfse', () => {
    it('lista todos os catalogados com código e caminho', () => {
        const l = listarMunicipiosNfse();
        expect(l.length).toBe(Object.keys(MUNICIPIOS_NFSE).length);
        expect(l.every((m: any) => m.cod && m.caminho && m.nome)).toBe(true);
    });
});
