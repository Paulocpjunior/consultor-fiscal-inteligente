/**
 * XML por LINK no cofre de e-mail (27/07) — casos REAIS dos prints do Paulo:
 *  - ISS.NET-DF (naoresponda@sefaz.df.gov.br): link direto do XML da NFS-e,
 *    com o token quebrado em várias linhas no corpo;
 *  - ERP do cliente (Ludus): "Clique aqui para download dos arquivos fiscais",
 *    link que EXPIRA em 7 dias e não é .gov.br.
 * Seguir link de e-mail é superfície de ataque: allowlist + guarda de SSRF.
 */
// @ts-expect-error — modulo .js puro
import { extrairLinksFiscais, dominioAutorizado, classificarConteudoBaixado, hostDaUrl, DOMINIOS_PADRAO } from '../sefaz-backend/email-link-xml.js';
// @ts-expect-error — modulo .js puro
import { ehIpPrivado } from '../sefaz-backend/email-link-downloader.js';

const CORPO_ISSNET = `
<p>Nota Eletr&ocirc;nica de Servi&ccedil;os N&ordm; 44 emitida pelo prestador:</p>
<p>O download do arquivo .xml referente a esta nota eletr&ocirc;nica pode ser feita acessando:<br>
<a href="https://iss.fazenda.df.gov.br/online/NotaDigital/NotaDigitalXmlDownload.aspx?EF+4E+50+D1+44">
https://iss.fazenda.df.gov.br/online/NotaDigital/NotaDigitalXmlDownload.aspx?EF+4E+50+D1+44</a></p>
<p>A Nota Eletr&ocirc;nica est&aacute; dispon&iacute;vel para impress&atilde;o:<br>
<a href="https://iss.fazenda.df.gov.br/online/NotaDigital/Nota_Digital_Nacional.aspx?EF+4E">imprimir</a></p>
`;

const CORPO_ERP = `
<p>Segue link para download dos arquivos de XML das vendas do per&iacute;odo 01/06/2026 &agrave; 30/06/2026</p>
<p><a href="https://arquivos.erpdocliente.com.br/download/pacote?id=abc123">Clique aqui para download dos arquivos fiscais</a></p>
<p><b>Aten&ccedil;&atilde;o:</b> O link ir&aacute; expirar em 7 dias!</p>
`;

describe('extrairLinksFiscais — casos reais da caixa do cofre', () => {
    it('ISS.NET-DF: acha o link do XML e o marca como XML DIRETO (prioridade)', () => {
        const links = extrairLinksFiscais(CORPO_ISSNET);
        expect(links.length).toBeGreaterThan(0);
        expect(links[0].url).toContain('NotaDigitalXmlDownload.aspx');
        expect(links[0].xmlDireto).toBe(true);
    });

    it('ERP: acha o link pela âncora ("arquivos fiscais"), sem .xml na URL', () => {
        const links = extrairLinksFiscais(CORPO_ERP);
        const alvo = links.find((l: any) => l.url.includes('erpdocliente'));
        expect(alvo).toBeTruthy();
        expect(alvo.ancora).toMatch(/arquivos fiscais/i);
        expect(alvo.xmlDireto).toBe(false);
    });

    it('ignora corpo sem link e não inventa candidato', () => {
        expect(extrairLinksFiscais('<p>Segue em anexo a nota.</p>')).toEqual([]);
        expect(extrairLinksFiscais('')).toEqual([]);
    });

    it('ignora link que não tem cara de documento fiscal (rodapé, redes sociais)', () => {
        const links = extrairLinksFiscais('<a href="https://facebook.com/empresa">Siga-nos</a>');
        expect(links).toEqual([]);
    });
});

describe('dominioAutorizado — allowlist por sufixo', () => {
    it('libera gov.br por padrão (SEFAZ/prefeituras) e recusa o resto', () => {
        expect(dominioAutorizado('https://iss.fazenda.df.gov.br/x', DOMINIOS_PADRAO)).toBe(true);
        expect(dominioAutorizado('https://arquivos.erpdocliente.com.br/x', DOMINIOS_PADRAO)).toBe(false);
    });

    it('domínio extra autorizado pelo admin passa a valer (e só ele)', () => {
        const lista = [...DOMINIOS_PADRAO, 'erpdocliente.com.br'];
        expect(dominioAutorizado('https://arquivos.erpdocliente.com.br/x', lista)).toBe(true);
        expect(dominioAutorizado('https://outro.com.br/x', lista)).toBe(false);
    });

    it('não cai em domínio que apenas TERMINA parecido (anti-spoof)', () => {
        // "malicioso-gov.br" não é subdomínio de "gov.br"
        expect(dominioAutorizado('https://malicioso-gov.br/x', DOMINIOS_PADRAO)).toBe(false);
        expect(hostDaUrl('https://malicioso-gov.br/x')).toBe('malicioso-gov.br');
    });
});

describe('classificarConteudoBaixado — o que o link devolveu', () => {
    it('detecta XML, ZIP e página HTML (link expirado)', () => {
        expect(classificarConteudoBaixado(Buffer.from('<?xml version="1.0"?><nfeProc/>'))).toBe('xml');
        expect(classificarConteudoBaixado(Buffer.from('<CompNfse><Nfse/></CompNfse>'))).toBe('xml');
        expect(classificarConteudoBaixado(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
        expect(classificarConteudoBaixado(Buffer.from('<!DOCTYPE html><html>Sessão expirada</html>'))).toBe('html');
        expect(classificarConteudoBaixado(Buffer.alloc(0))).toBe('desconhecido');
    });
});

describe('ehIpPrivado — guarda de SSRF (link vem de fora)', () => {
    it('bloqueia metadata do Cloud Run, loopback e redes internas', () => {
        expect(ehIpPrivado('169.254.169.254')).toBe(true); // metadata GCP
        expect(ehIpPrivado('127.0.0.1')).toBe(true);
        expect(ehIpPrivado('10.1.2.3')).toBe(true);
        expect(ehIpPrivado('172.16.0.9')).toBe(true);
        expect(ehIpPrivado('192.168.1.1')).toBe(true);
        expect(ehIpPrivado('::1')).toBe(true);
        expect(ehIpPrivado('lixo')).toBe(true);            // desconhecido = bloqueia
    });

    it('libera IP público normal', () => {
        expect(ehIpPrivado('200.160.2.3')).toBe(false);
        expect(ehIpPrivado('8.8.8.8')).toBe(false);
    });
});
