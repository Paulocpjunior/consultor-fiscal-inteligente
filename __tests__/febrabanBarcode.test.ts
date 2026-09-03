/**
 * Código de barras FEBRABAN de arrecadação (DARF).
 * Achado 09/07/2026: o 3º dígito é 6 (valor efetivo, DV geral por MÓDULO 10),
 * mas o DV geral era calculado por módulo 11 → barra rejeitada pelo banco.
 * Trava aqui a coerência: DV geral por módulo 10, igual aos blocos da linha
 * digitável.
 */
// @ts-expect-error — modulo .js puro
import { gerarBarrasDarf, gerarLinhaDigitavelArrecadacao } from '../sefaz-backend/febraban-barcode.js';

// DV módulo 10 (mesma regra do arquivo) para validar de forma independente.
function dvMod10(numero: string): string {
    let soma = 0, peso = 2;
    for (let i = numero.length - 1; i >= 0; i--) {
        let n = parseInt(numero[i], 10) * peso;
        if (n > 9) n = Math.floor(n / 10) + (n % 10);
        soma += n;
        peso = peso === 2 ? 1 : 2;
    }
    const resto = soma % 10;
    return resto === 0 ? '0' : String(10 - resto);
}

describe('gerarBarrasDarf (FEBRABAN arrecadação)', () => {
    const barras = gerarBarrasDarf({ cnpj: '11222333000181', periodo: '202605', valor: 1234.56, codigoReceita: '2089' });

    it('tem 44 dígitos e produto/segmento/valor corretos', () => {
        expect(barras).toHaveLength(44);
        expect(barras.slice(0, 3)).toBe('856');           // 8=arrecad, 5=RFB, 6=valor efetivo mod10
        expect(barras.slice(4, 15)).toBe('00000123456');  // valor em centavos, 11 dígitos
    });

    it('DV geral (posição 4) é o MÓDULO 10 dos outros 43 dígitos', () => {
        const semDv = barras.slice(0, 3) + barras.slice(4); // remove o DV geral
        expect(semDv).toHaveLength(43);
        expect(barras[3]).toBe(dvMod10(semDv));
    });

    it('linha digitável: 4 blocos de 11+DV módulo 10', () => {
        const linha = gerarLinhaDigitavelArrecadacao(barras);
        const blocos = linha.split(' ');
        expect(blocos).toHaveLength(4);
        for (const b of blocos) {
            expect(b).toHaveLength(12);
            expect(b.slice(11)).toBe(dvMod10(b.slice(0, 11)));
        }
    });

    // ═══ 03/09: NADA AQUI ERA CONFERIDO ═══════════════════════════════════
    // Valor em texto virava "NaN" DENTRO da barra, "07/2026" virava 072026
    // (ano 0720) e CNPJ curto era completado com zeros — barra apontando para
    // contribuinte nenhum. O teste antigo ("valor zero e cnpj curto não quebram
    // o layout") DESCREVIA o defeito: 44 dígitos de mentira continuam sendo 44.
    it('valor em TEXTO pt-BR é RECUSADO — "NaN" nunca entra na barra', () => {
        expect(() => gerarBarrasDarf({ cnpj: '11222333000181', periodo: '202605', valor: '1.234,56' as any, codigoReceita: '2089' }))
            .toThrow(/Valor inválido/);
    });

    it('valor zero, negativo ou não finito é RECUSADO', () => {
        for (const v of [0, -1, NaN, Infinity, undefined, null]) {
            expect(() => gerarBarrasDarf({ cnpj: '11222333000181', periodo: '202605', valor: v as any, codigoReceita: '2089' }))
                .toThrow(/Valor inválido/);
        }
    });

    it('período fora de AAAAMM é RECUSADO — "07/2026" NÃO vira 072026', () => {
        for (const p of ['07/2026', '2026-07', '202613', '20260', '', undefined]) {
            expect(() => gerarBarrasDarf({ cnpj: '11222333000181', periodo: p as any, valor: 10, codigoReceita: '2089' }))
                .toThrow(/Período de apuração inválido/);
        }
    });

    it('CNPJ sem 14 dígitos é RECUSADO — zero à esquerda seria outro contribuinte', () => {
        expect(() => gerarBarrasDarf({ cnpj: '123', periodo: '202601', valor: 10, codigoReceita: '2089' }))
            .toThrow(/CNPJ inválido/);
    });

    it('CNPJ com máscara continua aceito (a pontuação sai)', () => {
        const b = gerarBarrasDarf({ cnpj: '11.222.333/0001-81', periodo: '202605', valor: 10, codigoReceita: '2089' });
        expect(b.slice(19, 33)).toBe('11222333000181');
        expect(b).toMatch(/^\d{44}$/);
    });
});
