// 📅 A data de hoje no fuso do escritório — dono único (auditoria 26/09).
// O instante entra por parâmetro: nada aqui lê o relógio nem o fuso da
// máquina. Cada caso pina o instante em que UTC e Brasília DIVERGEM.
import { dataBrt, hojeBrt, anoMesBrt, FUSO_ESCRITORIO } from '../sefaz-backend/data-brt.js';

describe('📅 hoje em Brasília, não em UTC', () => {
    it('às 21h30 de Brasília o UTC já virou o dia — a régua não vira', () => {
        const instante = new Date('2026-09-26T00:30:00Z'); // 25/09 21:30 BRT
        expect(instante.toISOString().slice(0, 10)).toBe('2026-09-26'); // o que o código antigo fazia
        expect(hojeBrt(instante)).toBe('2026-09-25');
    });

    it('na virada do mês em UTC, a competência corrente ainda é a de Brasília', () => {
        const instante = new Date('2026-10-01T02:00:00Z'); // 30/09 23:00 BRT
        expect(instante.toISOString().slice(0, 7)).toBe('2026-10');
        expect(anoMesBrt(instante)).toBe('2026-09');
    });

    it('de dia as duas coincidem', () => {
        const instante = new Date('2026-09-25T15:00:00Z'); // 12:00 BRT
        expect(hojeBrt(instante)).toBe('2026-09-25');
        expect(dataBrt(instante)).toBe('2026-09-25');
    });

    it('aceita ISO e epoch; inválido devolve null, nunca "Invalid Date"', () => {
        expect(dataBrt('2026-09-26T00:30:00Z')).toBe('2026-09-25');
        expect(dataBrt(Date.parse('2026-09-26T00:30:00Z'))).toBe('2026-09-25');
        expect(dataBrt('nada')).toBeNull();
        expect(anoMesBrt('nada')).toBeNull();
    });

    it('o fuso é o do escritório', () => {
        expect(FUSO_ESCRITORIO).toBe('America/Sao_Paulo');
    });
});
