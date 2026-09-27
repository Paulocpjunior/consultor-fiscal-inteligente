// ============================================================================
// 🛡️ O mata-burro da credencial do e-mail (Paulo, 24/09: "isso não pode
// voltar a acontecer"). O que este teste prende: a faixa acende em recusa
// (com "desde"), acende em silêncio (vigia velho) e some quando está ok e
// recente; o cron sonda ANTES de mandar o alerta; a Rotina mostra a faixa.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo .js puro (a sonda em si é I/O; a faixa é pura)
import { faixaDoVigia } from '../sefaz-backend/graph-credencial-vigia.js';

const AGORA = Date.parse('2026-09-24T20:00:00Z');

describe('faixaDoVigia', () => {
    it('recusada → vermelho, com desde quando e onde corrigir', () => {
        const f = faixaDoVigia({ situacao: 'recusada', titulo: 'A Microsoft RECUSOU a credencial do e-mail.', onde: 'graph-notificacoes-secret', testadoEm: '2026-09-24T11:00:00Z', primeiraFalhaEm: '2026-09-22T11:00:00Z', forma: { ehProblema: true, diagnostico: 'é o Secret ID' } }, AGORA);
        expect(f.cor).toBe('vermelho');
        expect(f.titulo).toMatch(/desde 22\/09\/2026/);
        expect(f.detalhe).toMatch(/graph-notificacoes-secret/);
        expect(f.detalhe).toMatch(/Secret ID/);
        expect(f.detalhe).toMatch(/Outlook Web/);
    });
    it('ok e recente → nada a dizer; ok mas velho (>2 dias) → amarelo: silêncio não é saúde', () => {
        expect(faixaDoVigia({ situacao: 'ok', testadoEm: '2026-09-24T11:00:00Z' }, AGORA)).toBeNull();
        const f = faixaDoVigia({ situacao: 'ok', testadoEm: '2026-09-20T11:00:00Z' }, AGORA)!;
        expect(f.cor).toBe('amarelo');
        expect(f.titulo).toMatch(/não é sondada desde/);
    });
    it('nunca sondada → amarelo e manda testar à mão', () => {
        expect(faixaDoVigia(null, AGORA)!.detalhe).toMatch(/Testar credencial do e-mail/);
    });
});

describe('o vigia está ligado onde importa', () => {
    const raiz = join(__dirname, '..');
    it('o cron noturno sonda ANTES de calcular/mandar o alerta e marca crítico', () => {
        const src = readFileSync(join(raiz, 'sefaz-backend', 'health-alerta-cron.js'), 'utf8');
        const iVigia = src.indexOf('await vigiarCredencialGraph(');
        const iSaude = src.indexOf('await calcularSaude()');
        expect(iVigia).toBeGreaterThan(-1);
        expect(iVigia).toBeLessThan(iSaude);
        expect(src).toMatch(/saude\.status = 'critico'/);
    });
    it('a Rotina do Mês mostra a faixa e a rota existe', () => {
        expect(readFileSync(join(raiz, 'components', 'RotinaFiscalPainel.tsx'), 'utf8')).toContain('<CredencialEmailFaixa');
        expect(readFileSync(join(raiz, 'server.js'), 'utf8')).toContain("app.use('/api/admin/credencial-email', graphCredencialVigiaRouter)");
    });
});
