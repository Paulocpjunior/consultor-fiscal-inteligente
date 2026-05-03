import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const buildTime = new Date().toISOString();
// Release combina versão semântica + timestamp curto. Garante unicidade a cada build.
const release = `${pkg.version}+${Math.floor(Date.now() / 1000)}`;

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
        },
    },
    preview: {
        host: '0.0.0.0',
        port: parseInt(process.env.PORT || '3000'),
    }
});
