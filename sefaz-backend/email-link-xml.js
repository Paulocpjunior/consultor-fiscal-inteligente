// ============================================================================
// sefaz-backend/email-link-xml.js  (PURO — sem io/rede, testável)
// ----------------------------------------------------------------------------
// Muitos clientes NÃO anexam o XML: mandam LINK de download (27/07, prints do
// Paulo):
//   - SEFAZ-DF / ISS.NET: link direto do XML da NFS-e
//     (iss.fazenda.df.gov.br/online/NotaDigital/NotaDigitalXmlDownload.aspx?<token>)
//   - ERP do cliente: "Clique aqui para download dos arquivos fiscais"
//     (pacote com os XMLs do mês, link que EXPIRA em 7 dias)
//
// Aqui ficam as regras PURAS: achar os links candidatos no corpo do e-mail,
// decidir se o domínio é autorizado e classificar o que foi baixado.
// O download em si (rede + guardas SSRF) fica em email-link-downloader.js.
// ============================================================================

/** Domínios sempre confiáveis: SEFAZ/prefeituras. Cobre o caso ISS.NET-DF. */
export const DOMINIOS_PADRAO = ['gov.br'];

/** Palavras que indicam "isto baixa documento fiscal". */
const PISTAS_URL = /(xml|nfe|nfse|nota|danfe|documento|download|arquivo|fiscal)/i;
const PISTAS_ANCORA = /(xml|nota|download|arquivos?\s+fiscais|baixar)/i;

/** Extensões/rotas que indicam XML direto (vs. página HTML). */
const URL_XML_DIRETO = /(\.xml(\?|$)|xmldownload|downloadxml|obterxml|getxml)/i;

function normalizarUrl(u) {
    const s = String(u || '').trim().replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(s)) return null;
    // Remove pontuação/aspas coladas no fim (corpo de e-mail costuma ter).
    return s.replace(/[)\]}>"',.;]+$/, '');
}

/**
 * Extrai links candidatos a documento fiscal do corpo do e-mail.
 * Aceita HTML (href) e texto puro (URLs soltas).
 *
 * @param {string} corpo  HTML ou texto do e-mail
 * @returns {Array<{url: string, ancora: string|null, xmlDireto: boolean}>}
 */
export function extrairLinksFiscais(corpo) {
    const html = String(corpo || '');
    const achados = new Map(); // url → item (dedup)

    // 1) <a href="...">texto</a>
    const reAnchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = reAnchor.exec(html)) !== null) {
        const url = normalizarUrl(m[1]);
        if (!url) continue;
        const ancora = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!PISTAS_URL.test(url) && !PISTAS_ANCORA.test(ancora)) continue;
        if (!achados.has(url)) achados.set(url, { url, ancora: ancora || null, xmlDireto: URL_XML_DIRETO.test(url) });
    }

    // 2) URLs soltas no texto (e-mail sem HTML ou link quebrado em linhas).
    //    O ISS.NET-DF quebra o token em várias linhas — junta antes de casar.
    const semTags = html.replace(/<[^>]*>/g, '\n');
    const colado = semTags.replace(/(https?:\/\/[^\s]*)\n\s*(?=[A-Za-z0-9%+=/_.-]+)/g, '$1');
    const reUrl = /https?:\/\/[^\s<>"']+/gi;
    while ((m = reUrl.exec(colado)) !== null) {
        const url = normalizarUrl(m[0]);
        if (!url || !PISTAS_URL.test(url)) continue;
        if (!achados.has(url)) achados.set(url, { url, ancora: null, xmlDireto: URL_XML_DIRETO.test(url) });
    }

    // XML direto primeiro — é o que dá menos trabalho e mais certeza.
    return [...achados.values()].sort((a, b) => Number(b.xmlDireto) - Number(a.xmlDireto));
}

/** Host de uma URL (minúsculo, sem porta). null se inválida. */
export function hostDaUrl(url) {
    try {
        return new URL(String(url)).hostname.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * O domínio pode ser baixado? Allowlist por SUFIXO de domínio — seguir link
 * arbitrário de e-mail é risco (SSRF/phishing), então só domínio autorizado.
 *
 * @param {string} url
 * @param {string[]} [dominios]  sufixos permitidos (default: DOMINIOS_PADRAO)
 */
export function dominioAutorizado(url, dominios = DOMINIOS_PADRAO) {
    const host = hostDaUrl(url);
    if (!host) return false;
    return (dominios || []).some((d) => {
        const suf = String(d || '').trim().toLowerCase().replace(/^\.+/, '');
        if (!suf) return false;
        return host === suf || host.endsWith(`.${suf}`);
    });
}

/**
 * Classifica o conteúdo baixado: 'xml' | 'zip' | 'html' | 'desconhecido'.
 * Usa a assinatura do arquivo (mais confiável que o content-type do servidor,
 * que costuma vir application/octet-stream).
 */
export function classificarConteudoBaixado(buffer, contentType = '') {
    if (!buffer || buffer.length === 0) return 'desconhecido';
    const inicio = buffer.slice(0, 512).toString('utf-8').replace(/^﻿/, '').trimStart();
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'zip';   // "PK"
    if (inicio.startsWith('<?xml') || /^<(nfeProc|NFe|nfse|Nfse|CompNfse|ConsultarNfse|enviNFe|procEventoNFe)/i.test(inicio)) return 'xml';
    if (/^<!doctype html|^<html/i.test(inicio)) return 'html';
    if (/xml/i.test(contentType) && inicio.startsWith('<')) return 'xml';
    return 'desconhecido';
}
