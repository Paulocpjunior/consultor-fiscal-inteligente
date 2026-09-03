// ═══════════════════════════════════════════════════════════════════════════
// MULTA E JUROS ESTIMADOS — o que a auditoria de 03/09 corrigiu.
//
// (a) `diasUteisEntre` contava dias CORRIDOS: o nome mentia (a mora de 0,33%
//     "por dia" do art. 61 é por dia de calendário). Virou `diasCorridosEntre`.
// (b) O piso de R$ 200 é a multa por atraso na ENTREGA da DCTFWeb (Lei
//     10.426/2002 art. 7º) — não é mora sobre o débito. Saiu do caminho da mora.
// (c) Juros do art. 61 §3º são por MÊS de calendário: SELIC do mês seguinte ao
//     vencimento até o mês anterior ao pagamento + 1% no mês do pagamento.
//     Pagou no MESMO mês ⇒ juros zero (antes: `ceil(dias/30)` dava 1%).
// ═══════════════════════════════════════════════════════════════════════════
// @ts-expect-error — modulo .js puro
import * as m from '../sefaz-backend/multa-calculator.js';

const d = (iso: string) => new Date(iso);

describe('juros do art. 61 §3º — aritmética de MESES, não ceil(dias/30)', () => {
    it('pagamento no MESMO mês do vencimento ⇒ juros 0 (só a multa de mora)', () => {
        const r = m.calcularMultaDarf(1000, d('2026-07-10'), d('2026-07-25'));
        expect(r.dias).toBe(15);
        expect(r.jurosPct).toBe(0);
        expect(r.jurosValor).toBe(0);
        expect(r.multaPct).toBeCloseTo(4.95, 4);   // 0,33% × 15
        expect(r.total).toBe(1049.5);
    });

    it('pagamento no mês SEGUINTE ⇒ 1% (nenhum mês inteiro de SELIC ainda)', () => {
        const r = m.calcularMultaDarf(1000, d('2026-07-31'), d('2026-08-05'));
        expect(r.jurosPct).toBe(1);
        expect(r.jurosValor).toBe(10);
    });

    it('três meses depois ⇒ SELIC de 2 meses + 1%', () => {
        const r = m.calcularMultaDarf(1000, d('2026-07-31'), d('2026-10-15'));
        expect(r.jurosPct).toBeCloseTo(m.SELIC_MENSAL_PCT * 2 + 1, 4);
        expect(m.jurosSelicPct(d('2026-07-31'), d('2026-10-15'), 1)).toBe(3);
    });

    it('a virada do ano conta certo', () => {
        expect(m.mesesCalendarioEntre(d('2026-11-30'), d('2027-01-02'))).toBe(2);
        expect(m.jurosSelicPct(d('2026-11-30'), d('2027-01-02'), 1)).toBe(2);
    });
});

describe('diasCorridosEntre — o nome diz o que conta', () => {
    it('conta dias de CALENDÁRIO (fim de semana incluso)', () => {
        // 31/07/2026 é sexta; 03/08 é segunda ⇒ 3 dias corridos.
        expect(m.diasCorridosEntre(d('2026-07-31'), d('2026-08-03'))).toBe(3);
    });
    it('o nome antigo não existe mais', () => {
        expect((m as any).diasUteisEntre).toBeUndefined();
    });
});

describe('DCTFWeb — mora sobre o DÉBITO não leva o piso de R$ 200 da multa de ENTREGA', () => {
    it('débito pequeno em atraso: 2% de mora, não R$ 200', () => {
        const r = m.calcularMultaDctfweb(100, d('2026-07-15'), d('2026-07-20'));
        expect(r.multaPct).toBe(2);
        expect(r.multaValor).toBe(2);
        expect(r.multaValor).toBeLessThan(200);
        expect(r.jurosPct).toBe(0);
    });
    it('teto de 20% continua', () => {
        const r = m.calcularMultaDctfweb(1000, d('2025-01-15'), d('2026-07-20'));
        expect(r.multaPct).toBe(20);
    });
});

describe('em dia ou datas inválidas: nada é cobrado', () => {
    it('pagamento antes/no vencimento ⇒ zeros', () => {
        expect(m.calcularMultaDarf(1000, d('2026-07-31'), d('2026-07-31')).total).toBe(1000);
        expect(m.calcularMultaDarf(1000, d('2026-07-31'), d('2026-07-01')).total).toBe(1000);
    });
    it('data inválida não vira dias negativos nem NaN', () => {
        expect(m.diasCorridosEntre(d('lixo'), d('2026-07-31'))).toBe(0);
        expect(m.calcularMultaDarf(1000, d('lixo'), d('2026-07-31')).total).toBe(1000);
    });
});
