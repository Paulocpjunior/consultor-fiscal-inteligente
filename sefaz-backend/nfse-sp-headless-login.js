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
// Esse módulo NÃO é importado em hot path do frontend — só backend cron.
// ============================================================================

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadCertificate } from './secret-loader.js';

const PORTAL_HOST = 'nfe.prefeitura.sp.gov.br';
const LOGIN_URL = `https://${PORTAL_HOST}/LoginICP.aspx`;
const OPCOES_URL = `https://${PORTAL_HOST}/contribuinte/opcoes.aspx`;

// Path executável do Chromium baixado pelo `npx playwright install chromium`
// no Dockerfile. Localização padrão do Playwright dentro do container.
const CHROMIUM_PATHS = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    '/root/.cache/ms-playwright/chromium-*/chrome-linux/chrome',
    '/home/nodeuser/.cache/ms-playwright/chromium-*/chrome-linux/chrome',
];

async function findChromiumExecutable() {
    // Playwright detecta automaticamente quando PLAYWRIGHT_BROWSERS_PATH
    // não está customizado. Retornamos null pra deixar playwright resolver.
    return null;
}

/**
 * Faz login no portal SP via Chromium headless e retorna jar de cookies.
 *
 * @returns {Promise<{cookies: Record<string, string>}>}
 */
export async function loginHeadlessPortalSp() {
    const certs = await loadCertificate();
    if (!certs.pfxBuffer) throw new Error('Cert A1 não disponível no Secret Manager');

    // Salva cert temporário (Playwright lê do disco)
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-cert-'));
    const pfxPath = path.join(tmpDir, 'cert.pfx');
    await fs.writeFile(pfxPath, certs.pfxBuffer);

    const executablePath = await findChromiumExecutable();
    const launchOpts = {
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--ignore-certificate-errors',
            '--auto-select-certificate-for-urls=https://nfe.prefeitura.sp.gov.br',
        ],
    };
    if (executablePath) launchOpts.executablePath = executablePath;

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

        // Espera adicional pra qualquer JS redirect
        await page.waitForTimeout(3000);

        const urlPos = page.url();
        const title = await page.title().catch(() => '?');
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '').catch(() => '');
        console.log(`[headless-login] URL pós-wait: ${urlPos} title="${title}" body-head="${bodyText.replace(/\s+/g, ' ').slice(0, 200)}"`);

        if (urlPos.includes('relogin.aspx') || urlPos.includes('avisoacesso')) {
            const screenshot = await page.screenshot({ type: 'png', fullPage: false }).catch(() => null);
            throw new Error(`Portal SP rejeitou cert (redirect ${urlPos}). ${screenshot ? 'screenshot capturada (descartada).' : ''}`);
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
            throw new Error(`Login headless: PMSP_NFeID não retornado. Cookies recebidos: ${cookieNames || '(nenhum)'}`);
        }

        console.log(`[headless-login] ok — ${Object.keys(jar).length} cookies, PMSP_NFeID len=${jar['PMSP_NFeID'].length}`);
        return { cookies: jar };
    } finally {
        await browser.close().catch(() => {});
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}
