// ============================================================================
// sefaz-backend/dare-recon.js  (ESM)
// ----------------------------------------------------------------------------
// RECONHECIMENTO do portal DARE ICMS da SEFAZ-SP (www4.fazenda.sp.gov.br/
// DareICMS) — mesmo padrão da POC de saída F0: roda NO BACKEND IMPLANTADO
// (o sandbox de dev não alcança a fazenda; o Cloud Run alcança), SOMENTE
// LEITURA (GET), e devolve a ESTRUTURA das páginas:
//   · forms (action/method) e inputs (name/id/type)
//   · selects com as OPTIONS — o dropdown "Tipo de débito" do DareAvulso
//     lista TODOS os códigos DARE oficiais (fonte primária p/ nossa tabela)
//   · links de XSD/manual/layout (o lote aceita XML-GNRE)
//   · tokens anti-forgery e presença de captcha
//
// É o ground-truth pra fase de automação (gerador de XML-GNRE em lote ou
// POST do formulário unitário) SEM chutar contrato — "não pode haver erros".
// ============================================================================

import https from 'node:https';

export const PAGINAS_DARE = [
  { id: 'avulso', url: 'https://www4.fazenda.sp.gov.br/DareICMS/DareAvulso' },
  { id: 'lote', url: 'https://www4.fazenda.sp.gov.br/DareICMS/DareLote' },
  { id: 'gnre-lote', url: 'https://www4.fazenda.sp.gov.br/DareICMS/GnreLote' },
];

const TIMEOUT_MS = 30_000;

function fetchPagina(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: { 'content-type': res.headers['content-type'], location: res.headers.location },
        body: Buffer.concat(chunks).toString('utf-8'),
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Timeout ${TIMEOUT_MS}ms`)));
  });
}

/**
 * Extrai a estrutura de um HTML de formulário — PURO (testável). Parser por
 * regex: suficiente pra reconhecimento (não é um DOM completo).
 */
export function extrairEstrutura(html) {
  const s = String(html || '');
  const out = { forms: [], inputs: [], selects: [], linksLayout: [], tokens: [], captcha: false };

  for (const m of s.matchAll(/<form\b([^>]*)>/gi)) {
    const attrs = m[1];
    out.forms.push({
      action: (attrs.match(/action\s*=\s*["']([^"']*)["']/i) || [])[1] || null,
      method: ((attrs.match(/method\s*=\s*["']([^"']*)["']/i) || [])[1] || 'GET').toUpperCase(),
      id: (attrs.match(/id\s*=\s*["']([^"']*)["']/i) || [])[1] || null,
    });
  }

  for (const m of s.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = m[1];
    const name = (attrs.match(/name\s*=\s*["']([^"']*)["']/i) || [])[1] || null;
    const type = ((attrs.match(/type\s*=\s*["']([^"']*)["']/i) || [])[1] || 'text').toLowerCase();
    if (!name) continue;
    if (/requestverificationtoken|csrf|antiforgery/i.test(name)) {
      out.tokens.push(name);
      continue;
    }
    if (type !== 'submit' && type !== 'button') out.inputs.push({ name, type });
  }

  for (const m of s.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attrs = m[1];
    const corpo = m[2];
    const name = (attrs.match(/name\s*=\s*["']([^"']*)["']/i) || [])[1]
      || (attrs.match(/id\s*=\s*["']([^"']*)["']/i) || [])[1] || null;
    const options = [];
    for (const o of corpo.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      const value = (o[1].match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] ?? null;
      const label = o[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (value !== null || label) options.push({ value, label });
    }
    out.selects.push({ name, options });
  }

  for (const m of s.matchAll(/href\s*=\s*["']([^"']*(?:\.xsd|\.pdf|layout|leiaute|manual)[^"']*)["']/gi)) {
    if (!out.linksLayout.includes(m[1])) out.linksLayout.push(m[1]);
  }

  out.captcha = /captcha|recaptcha|hcaptcha/i.test(s);
  return out;
}

/** Roda o reconhecimento nas páginas do portal DARE. Somente leitura. */
export async function reconhecerPortalDare() {
  const resultados = [];
  for (const pag of PAGINAS_DARE) {
    try {
      const resp = await fetchPagina(pag.url);
      resultados.push({
        id: pag.id,
        url: pag.url,
        statusCode: resp.statusCode,
        redirect: resp.headers.location || null,
        tamanho: resp.body.length,
        estrutura: resp.statusCode === 200 ? extrairEstrutura(resp.body) : null,
      });
    } catch (e) {
      resultados.push({ id: pag.id, url: pag.url, erro: e.message });
    }
  }
  return { geradoEm: new Date().toISOString(), paginas: resultados };
}
