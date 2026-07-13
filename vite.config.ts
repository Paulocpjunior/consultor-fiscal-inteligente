import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const buildTime = new Date().toISOString();
// Release combina versão semântica + timestamp curto. Garante unicidade a cada build.
const release = `${pkg.version}+${Math.floor(Date.now() / 1000)}`;
// Commit exibido no rodapé — permite conferir se a tela está na versão mais
// recente sem decifrar o timestamp do release. No CI o build roda dentro do
// Docker SEM .git (.dockerignore), então o valor vem do build-arg APP_COMMIT
// (GITHUB_SHA); localmente cai no git rev-parse.
const commit = (() => {
    if (process.env.APP_COMMIT) return process.env.APP_COMMIT.slice(0, 7);
    try {
        return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim().slice(0, 7);
    } catch {
        return 'local';
    }
})();

export default defineConfig({
    plugins: [
        react(),
        {
            name: 'sp-version-json',
            apply: 'build',
            closeBundle() {
                const outDir = resolve(__dirname, 'dist');
                if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
                const target = resolve(outDir, 'version.json');
                const data = {
                    version: pkg.version,
                    release,
                    buildTime,
                    commit,
                };
                writeFileSync(target, JSON.stringify(data, null, 2));
                // eslint-disable-next-line no-console
                console.log(`[sp-version-json] gerado ${target} → ${release}`);
            },
        },
    ],
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
        '__APP_VERSION__': JSON.stringify(pkg.version),
        '__APP_RELEASE__': JSON.stringify(release),
        '__APP_BUILD_TIME__': JSON.stringify(buildTime),
        '__APP_COMMIT__': JSON.stringify(commit),
    },
    server: {
        host: '0.0.0.0',
        port: parseInt(process.env.PORT || '3000'),
        proxy: {
            '/api/gemini': {
                target: 'https://generativelanguage.googleapis.com',
                changeOrigin: true,
                rewrite: (path: string) => path.replace(/^\/api\/gemini/, ''),
                secure: true,
            },
            '/api': {
                target: 'http://localhost:8080',
                changeOrigin: true,
            },
            '/health': {
                target: 'http://localhost:8080',
                changeOrigin: true,
            },
        },
    },
    preview: {
        host: '0.0.0.0',
        port: parseInt(process.env.PORT || '3000'),
    },
    build: {
        // Sobe o limite default (500kB) só pra reduzir ruído.
        chunkSizeWarningLimit: 800,
        rollupOptions: {
            output: {
                /**
                 * Vendor chunks:
                 * - react-vendor: React + ReactDOM (base do app)
                 * - firebase-vendor: SDK Firebase (auth, firestore, storage) — pesa ~600kB
                 * - export-vendor: bibliotecas de export (xlsx, jspdf, html2canvas, pdfjs) — usadas só em telas específicas
                 * - markdown-vendor: react-markdown + dependências (raramente carregadas)
                 * - chart-vendor: chart.js (idem)
                 * Todo resto cai no chunk default (lazy chunks por rota continuam funcionando).
                 */
                manualChunks: (id: string) => {
                    if (!id.includes('node_modules')) return undefined;
                    if (id.includes('react-dom') || id.match(/\/react\/(?!.*react-)/)) return 'react-vendor';
                    if (id.includes('firebase')) return 'firebase-vendor';
                    if (id.includes('xlsx')) return 'xlsx-vendor';
                    if (id.includes('jspdf')) return 'jspdf-vendor';
                    if (id.includes('html2canvas')) return 'html2canvas-vendor';
                    if (id.includes('pdfjs-dist')) return 'pdfjs-vendor';
                    if (id.includes('react-markdown') || id.includes('remark') || id.includes('rehype') || id.includes('micromark') || id.includes('mdast') || id.includes('unist') || id.includes('unified')) return 'markdown-vendor';
                    if (id.includes('chart.js')) return 'chart-vendor';
                    if (id.includes('motion')) return 'motion-vendor';
                    if (id.includes('lucide-react')) return 'icons-vendor';
                    return undefined;
                },
            },
        },
    },
});
