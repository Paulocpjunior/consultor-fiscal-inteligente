/**
 * cte-client.js — captura automática de CT-e (Paulo, 18/08: "como automatizar
 * as CTeS então"). Espelha o cliente NFeDistribuicaoDFe que já funciona em
 * produção, trocando o namespace/host pro webservice próprio do CT-e.
 *
 * 🚧 O host (`www1.cte.fazenda.gov.br`) segue a convenção de nome do NF-e mas
 * NÃO foi provado contra resposta real — a rede da SEFAZ é bloqueada deste
 * ambiente (mesma cegueira que já vale pro NFe DistDFe). A prova é produção,
 * contra um CNPJ tomador real (EDUARDO GUERRA).
 */
// @ts-ignore — módulo JS do backend
import { montaEnvelopeCte } from '../sefaz-backend/cte-client.js';

describe('montaEnvelopeCte — mesma estrutura do NFe, namespace do CT-e', () => {
    it('leva tpAmb, cUFAutor, CNPJ e distNSU dentro de distDFeInt', () => {
        const env = montaEnvelopeCte({ cnpj: '13344638000191', ultNSU: '000000000000123', uf: 'SP' });
        expect(env).toContain('xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe"');
        expect(env).toContain('<distDFeInt versao="1.01" xmlns="http://www.portalfiscal.inf.br/cte">');
        expect(env).toContain('<CNPJ>13344638000191</CNPJ>');
        expect(env).toContain('<cUFAutor>35</cUFAutor>'); // SP = 35
        expect(env).toContain('<ultNSU>000000000000123</ultNSU>');
    });

    it('normaliza CNPJ com máscara e ultNSU curto (padStart)', () => {
        const env = montaEnvelopeCte({ cnpj: '13.344.638/0001-91', ultNSU: '5', uf: 'SP' });
        expect(env).toContain('<CNPJ>13344638000191</CNPJ>');
        expect(env).toContain('<ultNSU>000000000000005</ultNSU>');
    });

    it('UF ausente/inválida recusa — nunca manda cUFAutor chutado', () => {
        expect(() => montaEnvelopeCte({ cnpj: '13344638000191', uf: 'XX' })).toThrow(/UF inválida/);
        expect(() => montaEnvelopeCte({ cnpj: '13344638000191', uf: '' })).toThrow(/UF inválida/);
    });

    it('XML sai minificado numa linha — mesma trava do NFe (cStat 215)', () => {
        const env = montaEnvelopeCte({ cnpj: '13344638000191', uf: 'SP' });
        expect(env).not.toMatch(/>\s*\n\s*</);
    });
});
