#!/usr/bin/env node
// ============================================================================
// scripts/extract-prod-frontend-config.mjs
//
// Resolve a config do frontend (VITE_*) para o build do CI SEM depender de
// setup manual: usa os GitHub Secrets quando definidos e, na falta deles,
// extrai os valores do bundle que JÁ ESTÁ em produção.
//
// Por que isso é seguro: a config web do Firebase (apiKey, authDomain,
// projectId, appId...) é pública por design — ela é entregue a qualquer
// navegador que abre o app. A proteção real vem das Firestore Rules e do
// Auth, não do sigilo dessas strings. Extrair do bundle publicado não expõe
// nada que um visitante da página já não receba.
//
// Como funciona: firebaseConfig.ts captura `import.meta.env` inteiro, então
// o Vite/Rolldown embute no chunk um objeto com TODAS as envs VITE_ do
// build (`var a={BASE_URL:'/',...,VITE_FIREBASE_API_KEY:'...'}`). Basta
// varrer os chunks atrás de `VITE_XXX:"valor"`.
//
// Saída: imprime `::add-mask::` por valor e escreve KEY=VALUE no $GITHUB_ENV
// (quando presente) para os passos seguintes do workflow.
// ============================================================================

import fs from 'node:fs';

const PROD_URL = (process.env.PROD_URL
    || 'https://consultor-fiscal-inteligente-631239634290.us-west1.run.app').replace(/\/+$/, '');

const REQUIRED = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
];
const OPTIONAL = [
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_VAPID_KEY',
    'VITE_SENTRY_DSN',
    'VITE_SENTRY_ENV',
];
const ALL = [...REQUIRED, ...OPTIONAL];

async function fetchText(url) {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`GET ${url} -> HTTP ${r.status}`);
    return r.text();
}

// Varre um chunk atrás de pares VITE_XXX:"valor" (aspas ', " ou crase).
export function harvestVite(text, found) {
    for (const m of String(text || '').matchAll(/VITE_([A-Z0-9_]+)\s*:\s*([`"'])((?:(?!\2).)*)\2/g)) {
        const key = `VITE_${m[1]}`;
        const val = m[3];
        if (val && !(key in found)) found[key] = val;
    }
    return found;
}

async function main() {
    const found = {};
    // 1. Secrets/env já definidos têm prioridade absoluta.
    for (const key of ALL) {
        const v = String(process.env[key] || '').trim();
        if (v) found[key] = v;
    }
    const missing = () => REQUIRED.filter((k) => !found[k]);

    // 2. Fallback: varre o bundle em produção.
    if (missing().length > 0) {
        console.log(`Extraindo config do bundle em produção (${PROD_URL})…`);
        const html = await fetchText(`${PROD_URL}/`);
        const queue = [...new Set([...html.matchAll(/\/assets\/[\w.-]+\.js/g)].map((m) => m[0]))];
        const fetched = new Set();

        while (queue.length > 0 && missing().length > 0 && fetched.size < 200) {
            // Chunks com cara de config primeiro (firebaseConfig-*.js).
            queue.sort((a, b) => Number(b.includes('firebaseConfig')) - Number(a.includes('firebaseConfig')));
            const path = queue.shift();
            if (fetched.has(path)) continue;
            fetched.add(path);
            let text;
            try {
                text = await fetchText(`${PROD_URL}${path}`);
            } catch (e) {
                console.warn(`  (pulo ${path}: ${e.message})`);
                continue;
            }
            harvestVite(text, found);
            // Descobre novos chunks referenciados por este.
            for (const m of text.matchAll(/(?:\.\/|assets\/)([\w-]+\.js)/g)) {
                const p = `/assets/${m[1]}`;
                if (!fetched.has(p)) queue.push(p);
            }
        }
        console.log(`  ${fetched.size} chunk(s) analisado(s).`);
    }

    if (missing().length > 0) {
        console.error(
            `\n❌ Não consegui resolver: ${missing().join(', ')}.\n`
            + 'Defina esses valores como GitHub Secrets (Settings → Secrets → Actions) com os\n'
            + 'mesmos nomes VITE_* do seu .env local e rode o workflow de novo.'
        );
        process.exit(1);
    }

    // 3. Exporta pro workflow (mascarando valores nos logs).
    const lines = [];
    for (const key of ALL) {
        if (!found[key]) continue;
        console.log(`::add-mask::${found[key]}`);
        lines.push(`${key}=${found[key]}`);
    }
    // Fora do CI (deploy manual do Mac, quando o Actions está fora), o mesmo
    // resultado precisa ir pra um arquivo que o script de deploy consegue ler.
    if (process.env.CONFIG_OUT) {
        fs.writeFileSync(process.env.CONFIG_OUT, `${lines.join('\n')}\n`);
        console.log(`✓ Config escrita em ${process.env.CONFIG_OUT}`);
    }
    if (process.env.GITHUB_ENV) {
        fs.appendFileSync(process.env.GITHUB_ENV, `${lines.join('\n')}\n`);
    }
    console.log(`✓ Config resolvida: ${ALL.filter((k) => found[k]).join(', ')}`);
    const opcionaisFaltando = OPTIONAL.filter((k) => !found[k]);
    if (opcionaisFaltando.length > 0) {
        console.log(`  (opcionais ausentes, seguindo sem: ${opcionaisFaltando.join(', ')})`);
    }
}

// Permite importar harvestVite em teste sem executar o main.
if (process.argv[1] && process.argv[1].endsWith('extract-prod-frontend-config.mjs')) {
    main().catch((e) => {
        console.error('❌ extração falhou:', e.message);
        process.exit(1);
    });
}
