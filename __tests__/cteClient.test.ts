/**
 * cte-client.js — captura automática de CT-e (Paulo, 18/08: "como automatizar
 * as CTeS então"). Espelha o cliente NFeDistribuicaoDFe que já funciona em
 * produção, trocando o namespace/host pro webservice próprio do CT-e.
 *
 * ✅ Host, TLS e estrutura do envelope PROVADOS em produção 19/08 (a SEFAZ
 * respondeu com cStat 239 — "versão do XML não suportada" — que é uma
 * REJEIÇÃO estruturada, não erro de rede/schema). A causa era a versão do
 * `distDFeInt`: CT-e tem versão PRÓPRIA (NT 2015.002), "1.00", nunca a
 * "1.01" da NF-e. Ainda falta provar uma rodada com `ok: true` de verdade.
 */
// @ts-ignore — módulo JS do backend
import { montaEnvelopeCte } from '../sefaz-backend/cte-client.js';

describe('montaEnvelopeCte — mesma estrutura do NFe, namespace do CT-e', () => {
    it('leva tpAmb, cUFAutor, CNPJ e distNSU dentro de distDFeInt', () => {
        const env = montaEnvelopeCte({ cnpj: '13344638000191', ultNSU: '000000000000123', uf: 'SP' });
        expect(env).toContain('xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe"');
        expect(env).toContain('<distDFeInt versao="1.00" xmlns="http://www.portalfiscal.inf.br/cte">');
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
