/**
 * O botão de CT-e não pode nascer sem o botão que chama a rota — é a mesma
 * família do "rota sem botão" (13/08): endpoint novo sem caminho na
 * interface é código morto com cara de entrega.
 */
import * as fs from 'fs';
import * as path from 'path';

const srcButton = fs.readFileSync(
    path.resolve(__dirname, '../components/SefazSyncButton.tsx'), 'utf8',
);
const srcService = fs.readFileSync(
    path.resolve(__dirname, '../services/dfeCaptureService.ts'), 'utf8',
);

describe('botão CT-e (beta) chama /sync-cte-one e nasce admin-only', () => {
    it('o serviço chama a rota certa', () => {
        expect(srcService).toContain("fetch('/api/admin/sefaz/sync-cte-one'");
        expect(srcService).toContain('export async function captureCteFromSefaz');
    });

    it('o botão importa e chama captureCteFromSefaz', () => {
        expect(srcButton).toMatch(/import \{[^}]*captureCteFromSefaz[^}]*\} from '\.\.\/services\/dfeCaptureService'/);
        expect(srcButton).toContain('await captureCteFromSefaz(');
    });

    it('o botão só aparece pra admin — é prova de conceito, não feature pronta', () => {
        const idx = srcButton.indexOf('🚚 CT-e (beta)');
        expect(idx).toBeGreaterThan(-1);
        const antes = srcButton.slice(Math.max(0, idx - 1000), idx);
        expect(antes).toMatch(/isAdmin &&/);
    });

    it('o resultado do CT-e não se mistura com o resultado do NF-e (estado próprio)', () => {
        expect(srcButton).toContain('resultCte');
        expect(srcButton).toContain('runningCte');
    });
});
