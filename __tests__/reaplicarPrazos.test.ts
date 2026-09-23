// ============================================================================
// __tests__/reaplicarPrazos.test.ts — a tarefa aberta recebe o prazo ATUAL do
// catálogo; a fechada e a manual não se mexem.
//
// 22/09/2026, Paulo, AFFITTARE 08/2026 ("continua do mesmo jeito"): a DCTFWeb
// foi para o último dia útil no catálogo, e o card seguia "EFD_CONTRIB —
// ATRASADA · 3 atrasada(s)". A tarefa guarda o vencimento do dia em que
// nasceu. Corrigir a regra sem reaplicar deixa a peça torta na prateleira.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { decidirReaplicacao, diaIsoDeVencimento } from '../sefaz-backend/reaplicar-prazos.js';

const RAIZ = join(__dirname, '..');
const ts = (iso: string) => ({ toDate: () => new Date(`${iso}T12:00:00`) });

describe('diaIsoDeVencimento lê as formas que a tarefa guarda', () => {
    it('Timestamp, Date, {seconds}, ISO — e ilegível vira vazio, nunca hoje', () => {
        expect(diaIsoDeVencimento(ts('2026-09-15'))).toBe('2026-09-15');
        expect(diaIsoDeVencimento(new Date(2026, 8, 30, 23, 59))).toBe('2026-09-30');
        expect(diaIsoDeVencimento({ seconds: Math.floor(new Date(2026, 8, 30, 12).getTime() / 1000) })).toBe('2026-09-30');
        expect(diaIsoDeVencimento('2026-10-14T00:00:00-03:00')).toBe('2026-10-14');
        expect(diaIsoDeVencimento(null)).toBe('');
        expect(diaIsoDeVencimento('15/09/2026')).toBe('');
    });
});

describe('decidirReaplicacao', () => {
    const regraNova = { obrigacao: 'DCTFWEB', vencimento: new Date(2026, 8, 30) };
    it('aberta + automática + data diferente → ALTERAR, de → para', () => {
        const d = decidirReaplicacao({ tarefa: { status: 'a_fazer', origem: 'automatica', vencimento: ts('2026-09-15') }, regra: regraNova });
        expect(d).toEqual({ acao: 'alterar', de: '2026-09-15', para: '2026-09-30' });
    });
    it('mesma data → igual (não grava à toa)', () => {
        expect(decidirReaplicacao({ tarefa: { status: 'a_fazer', vencimento: ts('2026-09-30') }, regra: regraNova }).acao).toBe('igual');
    });
    it('🚨 concluída e cancelada NÃO mudam — histórico não se reescreve', () => {
        expect(decidirReaplicacao({ tarefa: { status: 'concluida', vencimento: ts('2026-09-15') }, regra: regraNova }).acao).toBe('fechada');
        expect(decidirReaplicacao({ tarefa: { status: 'cancelada', vencimento: ts('2026-09-15') }, regra: regraNova }).acao).toBe('fechada');
    });
    it('manual NÃO muda — a data é a que a pessoa escolheu', () => {
        expect(decidirReaplicacao({ tarefa: { status: 'a_fazer', origem: 'manual', vencimento: ts('2026-09-15') }, regra: regraNova }).acao).toBe('manual');
    });
    it('sem regra no catálogo ou sem data → não se mexe (ausência não vira chute)', () => {
        expect(decidirReaplicacao({ tarefa: { status: 'a_fazer', vencimento: ts('2026-09-15') }, regra: null }).acao).toBe('sem-regra');
        expect(decidirReaplicacao({ tarefa: { status: 'a_fazer', vencimento: ts('2026-09-15') }, regra: { vencimento: null } }).acao).toBe('sem-data');
    });
    it('tarefa SEM data (ISS a informar) ganha a data quando o catálogo passa a ter', () => {
        const d = decidirReaplicacao({ tarefa: { status: 'a_fazer', vencimento: null }, regra: regraNova });
        expect(d).toEqual({ acao: 'alterar', de: '', para: '2026-09-30' });
    });
});

describe('a ação existe de ponta a ponta — rota admin, orquestrador e botão', () => {
    it('server.js expõe POST /api/admin/tarefas/reaplicar-prazos com requireAdmin', () => {
        const src = readFileSync(join(RAIZ, 'server.js'), 'utf8');
        expect(src).toMatch(/app\.post\('\/api\/admin\/tarefas\/reaplicar-prazos', requireAdmin/);
    });
    it('o orquestrador decide pelo dono puro e só grava as ALTERADAS, em lotes', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/tarefas-orchestrator.js'), 'utf8');
        expect(src).toContain('export async function reaplicarPrazosDoCatalogo');
        expect(src).toContain('decidirReaplicacao({ tarefa: t, regra })');
        expect(src).toContain("if (d.acao === 'alterar')");
        expect(src).toMatch(/i \+= 400/);
    });
    it('a tela de Tarefas oferece o botão ao admin e diz o resultado nomeado', () => {
        const src = readFileSync(join(RAIZ, 'components/Tarefas.tsx'), 'utf8');
        expect(src).toContain('/api/admin/tarefas/reaplicar-prazos');
        expect(src).toMatch(/\{isAdmin && \([\s\S]*Reaplicar prazos do catálogo/);
        expect(src).toContain('tarefa(s) mudaram de data');
    });
    it('o painel do catálogo separa "vira tarefa" de "não vira tarefa"', () => {
        const src = readFileSync(join(RAIZ, 'components/RotinaFiscalPainel.tsx'), 'utf8');
        expect(src).toContain('vira tarefa · prazo a confirmar');
        expect(src).toContain('não vira tarefa · depende de');
        expect(src).toContain('p2.oQueFalta');
    });
});
