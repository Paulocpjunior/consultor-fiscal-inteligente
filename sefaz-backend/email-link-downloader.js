// ============================================================================
// sefaz-backend/email-link-downloader.js  (ESM — rede)
// ----------------------------------------------------------------------------
// Baixa o documento fiscal de um LINK vindo de e-mail (cliente que manda o XML
// por link em vez de anexo — ISS.NET-DF, ERPs com pacote mensal).
//
// SEGURANÇA (o link vem de FORA, então nada de ingenuidade):
//   - só https;
//   - domínio precisa estar na allowlist (email-link-xml.dominioAutorizado);
//   - cada salto de redirect é revalidado na allowlist;
//   - o host precisa resolver pra IP PÚBLICO — bloqueia SSRF pro metadata do
//     Cloud Run (169.254.169.254) e pra rede interna;
//   - teto de bytes e timeout.
// ============================================================================

import https from 'node:https';
import dns from 'node:dns/promises';
import { dominioAutorizado, hostDaUrl } from './email-link-xml.js';

const MAX_BYTES = Number(process.env.XML_INGEST_LINK_MAX_BYTES || 25_000_000);
const TIMEOUT_MS = Number(process.env.XML_INGEST_LINK_TIMEOUT_MS || 30_000);
const MAX_REDIRECTS = 4;

/** IP privado/reservado? (SSRF guard) */
export function ehIpPrivado(ip) {
    const s = String(ip || '');
    if (s.includes(':')) {
        // IPv6: loopback, link-local, unique-local.
        return s === '::1' || /^fe80:/i.test(s) || /^f[cd]/i.test(s);
    }
    const p = s.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return true; // desconhecido = bloqueia
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;   // metadata do GCP
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
}

async function validarDestino(url, dominios) {
    if (!/^https:\/\//i.test(url)) throw new Error('Link recusado: só https é aceito.');
    if (!dominioAutorizado(url, dominios)) {
        throw new Error(`Link recusado: domínio "${hostDaUrl(url) || '?'}" não está autorizado para download automático.`);
    }
    const host = hostDaUrl(url);
    let ips;
    try {
        ips = await dns.lookup(host, { all: true });
    } catch (e) {
        throw new Error(`Link recusado: host "${host}" não resolve (${e.code || e.message}).`);
    }
    if (ips.some((r) => ehIpPrivado(r.address))) {
        throw new Error(`Link recusado: host "${host}" aponta para rede interna.`);
    }
}

function pegar(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: TIMEOUT_MS }, (res) => {
            const chunks = [];
            let total = 0;
            res.on('data', (d) => {
                total += d.length;
                if (total > MAX_BYTES) {
                    req.destroy();
                    reject(new Error(`Arquivo do link excede ${Math.round(MAX_BYTES / 1e6)}MB.`));
                    return;
                }
                chunks.push(d);
            });
            res.on('end', () => resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                buffer: Buffer.concat(chunks),
            }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout (${TIMEOUT_MS}ms) baixando o link.`)); });
    });
}

/**
 * Baixa o conteúdo de um link fiscal, seguindo redirects com revalidação.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string[]} [opts.dominios]  allowlist de sufixos de domínio
 * @returns {Promise<{buffer: Buffer, contentType: string, urlFinal: string}>}
 */
export async function baixarLinkFiscal(url, { dominios } = {}) {
    let atual = url;
    for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
        await validarDestino(atual, dominios);
        const r = await pegar(atual);

        if ([301, 302, 303, 307, 308].includes(r.statusCode)) {
            const destino = r.headers.location;
            if (!destino) throw new Error(`Redirect ${r.statusCode} sem destino.`);
            atual = new URL(destino, atual).toString();  // revalidado no topo do loop
            continue;
        }
        if (r.statusCode !== 200) {
            throw new Error(`HTTP ${r.statusCode} ao baixar o link.`);
        }
        return {
            buffer: r.buffer,
            contentType: String(r.headers['content-type'] || ''),
            urlFinal: atual,
        };
    }
    throw new Error('Muitos redirecionamentos no link.');
}
