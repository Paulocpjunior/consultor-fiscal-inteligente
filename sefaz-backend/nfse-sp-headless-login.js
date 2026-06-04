// ============================================================================
// sefaz-backend/nfse-sp-headless-login.js
// Login programático no portal nfe.prefeitura.sp.gov.br via Chromium headless.
//
// Substitui completamente o login mTLS manual (que rejeitava silenciosamente)
// e elimina a necessidade de o admin copiar cookies todo dia.
//
// Fluxo:
//   1. Carrega cert A1 do Secret Manager
//   2. Salva cert temporário em /tmp/sp-cert.pfx
//   3. Abre Chromium headless com clientCertificates configurado
//   4. Navega pra /LoginICP.aspx → Chromium responde ao TLS challenge com cert
//   5. Portal devolve PMSP_NFeID
//   6. Captura todos os cookies → retorna jar pra uso pelo cron
//
// Resiliencia:
//   - Retry com backoff exponencial (3 tentativas: 0s, 3s, 9s) so para erros
//     RETENTAVEIS — timeout, rede, manutencao do portal.
//   - Erros ESTRUTURAIS (selector mudou, cert rejeitado) NAO disparam retry
//     (nao vao mudar em segundos; reportam imediatamente pra admin agir).
//   - Classe HeadlessLoginError carrega `tipo` (manutencao | timeout-rede |
//     selector-mudou | cert-rejeitado | desconhecido), `tentativas` (quantas
//     foram feitas) e `ultimaMensagem` — orchestrator persiste no log do
//     cron pra metrica honesta de causa-raiz.
//
// Esse módulo NÃO é importado em hot path do frontend — só backend cron.
// ============================================================================

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadCertificate } from './secret-loader.js';
import { HeadlessLoginError, classificarErro } from './nfse-sp-error-classifier.js';

// Re-exporta pra compat — testes e callers que importavam daqui continuam ok.
export { HeadlessLoginError, classificarErro };

const PORTAL_HOST = 'nfe.prefeitura.sp.gov.br';
const LOGIN_URL = `https://${PORTAL_HOST}/LoginICP.aspx`;
const OPCOES_URL = `https://${PORTAL_HOST}/contribuinte/opcoes.aspx`;

// Backoff entre tentativas RETENTAVEIS. Total time-box ~12s no pior caso.
// Conservador: o portal SP ja eh rate-limit por sessao; nao quero piorar.
const RETRY_BACKOFF_MS = [0, 3_000, 9_000];

// ─── 1 TENTATIVA isolada (sem retry) ─────────────────────────────────────
async function tentativaLoginHeadlessPortalSp() {
    const certs = await loadCertificate();
    if (!certs.pfxBuffer) {
        throw new HeadlessLoginError('cert-rejeitado', 'Cert A1 não disponível no Secret Manager');
    }

    // Salva cert temporário (Playwright lê do disco)
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-cert-'));
    const pfxPath = path.join(tmpDir, 'cert.pfx');
    await fs.writeFile(pfxPath, certs.pfxBuffer);

    const launchOpts = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--ignore-certificate-errors',
            '--auto-select-certificate-for-urls=https://nfe.prefeitura.sp.gov.br',
        ],
    };

    const browser = await chromium.launch(launchOpts);
    try {
        const context = await browser.newContext({
            ignoreHTTPSErrors: true,
            clientCertificates: [
                {
                    origin: `https://${PORTAL_HOST}`,
                    pfxPath,
                    passphrase: certs.password,
                },
            ],
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15',
        });

        const page = await context.newPage();

        // Captura console errors pra diagnóstico
        page.on('pageerror', e => console.error('[headless] pageerror:', e.message));
        page.on('requestfailed', r => console.error('[headless] requestfailed:', r.url(), r.failure()?.errorText));

        // Navega pra LoginICP
        const resp = await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 60000 });
        const finalUrl = page.url();
        const status = resp?.status?.() || 0;
        console.log(`[headless-login] LoginICP final URL: ${finalUrl} (status ${status})`);

        // Status 5xx aqui = manutencao do portal SP.
        if (status >= 500) {
            throw new HeadlessLoginError('manutencao', `Portal respondeu HTTP ${status} no LoginICP`);
        }

        // Espera adicional pra qualquer JS redirect
        await page.waitForTimeout(3000);

        const urlPos = page.url();
        const title = await page.title().catch(() => '?');
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '').catch(() => '');
        console.log(`[headless-login] URL pós-wait: ${urlPos} title="${title}" body-head="${bodyText.replace(/\s+/g, ' ').slice(0, 200)}"`);

        // Detecta texto de manutencao mesmo com HTTP 200 (portal SP retorna 200
        // com "Sistema em manutencao" no body em janelas curtas de atualizacao).
        if (/em manuten[cç][aã]o|sistema.*indispon[ií]vel/i.test(bodyText)) {
            throw new HeadlessLoginError('manutencao', `Portal SP em manutencao (body match): ${bodyText.slice(0, 100)}`);
        }

        // Se a página ainda é LoginICP, é a tela de confirmação:
        // "Certificado identificado: ... [botão ENTRAR]"
        // Clicamos no botão pra completar a autenticação.
        if (urlPos.includes('LoginICP.aspx')) {
            console.log('[headless-login] tela de confirmação detectada, clicando ENTRAR…');
            const clicked = await page.evaluate(() => {
                // Procura botão "Entrar" — pode ser <input type=submit> ou <button>
                const candidates = [
                    ...document.querySelectorAll('input[type=submit]'),
                    ...document.querySelectorAll('button'),
                    ...document.querySelectorAll('input[type=button]'),
                    ...document.querySelectorAll('a[href*="javascript:"]'),
                ];
                for (const el of candidates) {
                    const txt = (el.value || el.innerText || el.textContent || '').trim().toUpperCase();
                    if (txt.includes('ENTRAR') || txt.includes('CONTINUAR') || txt.includes('ACESSAR') || txt.includes('CONFIRMAR')) {
                        el.click();
                        return { ok: true, label: txt, tag: el.tagName, id: el.id, name: el.name };
                    }
                }
                // Fallback: submit do primeiro form
                const form = document.forms[0];
                if (form) {
                    form.submit();
                    return { ok: true, label: '(submit form)', tag: 'FORM', id: form.id };
                }
                return { ok: false };
            });
            console.log(`[headless-login] clicou: ${JSON.stringify(clicked)}`);

            // Botao ENTRAR nao encontrado E sem form — selector mudou no portal.
            if (!clicked.ok) {
                throw new HeadlessLoginError('selector-mudou',
                    `Botao ENTRAR/CONTINUAR/ACESSAR/CONFIRMAR nao encontrado na LoginICP. Portal mudou layout?`);
            }

            // Espera redirect pra opcoes.aspx
            try {
                await page.waitForURL(/opcoes\.aspx|inicio\.aspx/, { timeout: 30000 });
            } catch (_) {
                // continua
            }
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

            const urlFinal = page.url();
            const titleFinal = await page.title().catch(() => '?');
            console.log(`[headless-login] URL após clique: ${urlFinal} title="${titleFinal}"`);
        }

        if (urlPos.includes('relogin.aspx') || urlPos.includes('avisoacesso')) {
            throw new HeadlessLoginError('cert-rejeitado',
                `Portal SP rejeitou cert (redirect ${urlPos}).`);
        }

        // Coleta todos os cookies do contexto
        const allCookies = await context.cookies();
        const jar = {};
        for (const c of allCookies) {
            if (c.domain.includes('prefeitura.sp.gov.br')) {
                jar[c.name] = c.value;
            }
        }

        if (!jar['PMSP_NFeID']) {
            const cookieNames = Object.keys(jar).join(',');
            throw new HeadlessLoginError('selector-mudou',
                `PMSP_NFeID não retornado. Cookies recebidos: ${cookieNames || '(nenhum)'}`);
        }

        console.log(`[headless-login] ok — ${Object.keys(jar).length} cookies, PMSP_NFeID len=${jar['PMSP_NFeID'].length}`);
        return { cookies: jar };
    } finally {
        await browser.close().catch(() => {});
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Faz login no portal SP via Chromium headless e retorna jar de cookies.
 * Retry com backoff so para erros retentaveis (manutencao | timeout-rede).
 * Erros estruturais (selector-mudou | cert-rejeitado) abortam imediato.
 *
 * @returns {Promise<{cookies: Record<string, string>}>}
 * @throws {HeadlessLoginError} com .tipo, .tentativas, .ultimaMensagem
 */
export async function loginHeadlessPortalSp() {
    let ultimoErro = null;
    for (let tentativa = 1; tentativa <= RETRY_BACKOFF_MS.length; tentativa++) {
        const delayMs = RETRY_BACKOFF_MS[tentativa - 1];
        if (delayMs > 0) {
            console.log(`[headless-login] retry ${tentativa}/${RETRY_BACKOFF_MS.length} — aguardando ${delayMs}ms (ultimo erro: ${ultimoErro?.tipo || '?'})`);
            await sleep(delayMs);
        }
        try {
            return await tentativaLoginHeadlessPortalSp();
        } catch (raw) {
            const err = classificarErro(raw);
            err.tentativas = tentativa;
            err.ultimaMensagem = String(raw?.message || raw);
            ultimoErro = err;
            console.warn(`[headless-login] tentativa ${tentativa} falhou: tipo=${err.tipo} retentavel=${err.retentavel} msg=${err.ultimaMensagem.slice(0, 200)}`);
            if (!err.retentavel) {
                // Estrutural — proximas tentativas nao vao mudar resultado.
                throw err;
            }
        }
    }
    // Esgotou retries em erro retentavel — re-lanca com contagem.
    throw ultimoErro || new HeadlessLoginError('desconhecido', 'Loop de retry sem erro registrado');
}
