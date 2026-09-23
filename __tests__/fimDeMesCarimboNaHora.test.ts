// ============================================================================
// 🔒 "só está encerrando depois de fazer o mesmo processo 2x" (Paulo, 23/09).
// O fechamento gravava no primeiro clique; a tela só mudava quando o painel
// inteiro recarregasse. O que este teste prende: a rota devolve o carimbo em
// "já fechada" (409, não 400 mudo), o serviço repassa os campos extras da
// recusa, e o card usa o carimbo devolvido até o painel trazer o dele.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

describe('o carimbo aparece na hora', () => {
    it('rota: "já fechada" volta 409 com jaFechada + fechamento', () => {
        const src = ler('sefaz-backend/fim-de-mes-routes.js');
        expect(src).toContain('if (competenciaFechada(r.fechamento))');
        expect(src).toMatch(/status\(409\)\.json\(\{[\s\S]*jaFechada: true[\s\S]*fechamento: r\.fechamento/);
    });
    it('serviço: a recusa repassa os campos extras (…data)', () => {
        expect(ler('services/fimDeMesService.ts')).toContain('return { ...data, ok: false, erro: data.erro');
    });
    it('card: usa o carimbo devolvido (local) até o painel trazer o dele; "já fechada" mostra o carimbo em vez de erro', () => {
        const src = ler('components/FimDeMesBloco.tsx');
        expect(src).toContain('const f = fDoPainel || (local && local.base === fDoPainel ? local.fechamento : null);');
        expect(src).toContain('if (r.jaFechada && r.fechamento) { setFechamentoLocal(r.fechamento); onMudou?.(); return; }');
        expect(src).toContain('if (r.fechamento) setFechamentoLocal(r.fechamento);');
        expect(src).toContain('local.base === fDoPainel');
        expect(src).not.toMatch(/useEffect/);
    });
});
