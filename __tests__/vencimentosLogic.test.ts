/**
 * Testes da classificação de vencimentos por urgência.
 */
import { classificarUrgenciaVencimento, URG_LABEL, type Urg } from '../services/vencimentosLogic';

describe('classificarUrgenciaVencimento — fronteiras', () => {
    it('dias < 0 → atrasada', () => {
        expect(classificarUrgenciaVencimento(-1)).toBe('atrasada');
        expect(classificarUrgenciaVencimento(-100)).toBe('atrasada');
    });

    it('dias = 0 → hoje', () => {
        expect(classificarUrgenciaVencimento(0)).toBe('hoje');
    });

    it('dias = 1 → amanha (não cai em 3d)', () => {
        expect(classificarUrgenciaVencimento(1)).toBe('amanha');
    });

    it('dias = 2 ou 3 → 3d', () => {
        expect(classificarUrgenciaVencimento(2)).toBe('3d');
        expect(classificarUrgenciaVencimento(3)).toBe('3d');
    });

    it('dias 4..7 → 7d', () => {
        expect(classificarUrgenciaVencimento(4)).toBe('7d');
        expect(classificarUrgenciaVencimento(5)).toBe('7d');
        expect(classificarUrgenciaVencimento(7)).toBe('7d');
    });

    it('dias = 8 → futura (fora do horizonte semanal)', () => {
        expect(classificarUrgenciaVencimento(8)).toBe('futura');
    });

    it('dias muito grande → futura', () => {
        expect(classificarUrgenciaVencimento(365)).toBe('futura');
    });

    it('NaN / Infinity → futura (defensivo)', () => {
        expect(classificarUrgenciaVencimento(NaN)).toBe('futura');
        expect(classificarUrgenciaVencimento(Infinity)).toBe('futura');
    });
});

describe('URG_LABEL — cobertura completa', () => {
    it('todas as urgências têm label', () => {
        const urgs: Urg[] = ['atrasada', 'hoje', 'amanha', '3d', '7d', 'futura'];
        urgs.forEach(u => expect(URG_LABEL[u]).toBeTruthy());
    });

    it('labels distintos por urgência', () => {
        const labels = Object.values(URG_LABEL);
        expect(new Set(labels).size).toBe(labels.length);
    });
});

describe('ordenação por urgência (sanidade)', () => {
    const ranks: Record<Urg, number> = {
        atrasada: 0, hoje: 1, amanha: 2, '3d': 3, '7d': 4, futura: 5,
    };

    it('uma lista de dias variados ordena coerentemente', () => {
        const dias = [10, -3, 1, 5, 0, 2, 90, 7];
        const ordenado = dias
            .map(d => ({ dias: d, urg: classificarUrgenciaVencimento(d) }))
            .sort((a, b) => ranks[a.urg] - ranks[b.urg]);
        expect(ordenado[0].urg).toBe('atrasada'); // -3
        expect(ordenado[ordenado.length - 1].urg).toBe('futura'); // 10, 90
    });
});
