/**
 * Ajustes da apuração ICMS (Registro E111) — a maior lacuna técnica da
 * migração E-Fiscal → CFI (02/08). O TIPO do ajuste sai do 4º caractere do
 * COD_AJ_APUR (tabela 5.1.1); ajuste inválido NUNCA entra calado no arquivo.
 */
import {
    validarCodigoAjuste, classificarAjustes, aplicarAjustesApuracao, montarLinhasE111,
} from '../sefaz-backend/sped-ajustes-apuracao.js';

describe('validarCodigoAjuste', () => {
    it('aceita código de apuração própria da UF da empresa e devolve o tipo', () => {
        expect(validarCodigoAjuste('SP020799', 'SP')).toEqual({ ok: true, tipo: 2, apuracao: 'proprio' });
        expect(validarCodigoAjuste('sp000207', 'SP')).toEqual({ ok: true, tipo: 0, apuracao: 'proprio' });
    });

    it('recusa formato errado, UF divergente e tipo desconhecido', () => {
        expect(validarCodigoAjuste('SP123', 'SP').ok).toBe(false);
        expect(validarCodigoAjuste('MG020799', 'SP').erro).toMatch(/UF MG/);
        expect(validarCodigoAjuste('SP090799', 'SP').erro).toMatch(/desconhecido/);
        // DIFAL/FCP (3º caractere fora de 0/1) segue recusado — E310 não existe.
        expect(validarCodigoAjuste('SP520799', 'SP').erro).toMatch(/E310/);
    });

    it('código de ST (3º caractere 1) agora é ACEITO e marcado como da apuração ST', () => {
        // Antes ia pro erro "lance no PVA"; desde 04/08 vira linha do E220.
        expect(validarCodigoAjuste('SP120799', 'SP')).toEqual({ ok: true, tipo: 2, apuracao: 'st' });
    });

    it('classificarAjustes só soma a apuração pedida — o resto é do outro registro', () => {
        const ajustes = [
            { codigo: 'SP000207', valor: 100 },  // próprio, outros débitos
            { codigo: 'SP100207', valor: 250 },  // ST, outros débitos
        ];
        expect(classificarAjustes(ajustes, 'SP').outrosDebitos).toBe(100);
        expect(classificarAjustes(ajustes, 'SP', 'st').outrosDebitos).toBe(250);
        // e nenhum dos dois vira ERRO — cada um tem seu registro
        expect(classificarAjustes(ajustes, 'SP').erros).toEqual([]);
        expect(classificarAjustes(ajustes, 'SP', 'st').erros).toEqual([]);
    });
});

describe('classificarAjustes', () => {
    it('separa cada tipo no balde certo e lista os válidos', () => {
        const c = classificarAjustes([
            { codigo: 'SP000001', descricao: 'outros débitos', valor: 100 },
            { codigo: 'SP010001', descricao: 'estorno de crédito', valor: 50 },
            { codigo: 'SP020799', descricao: 'crédito outorgado', valor: 300 },
            { codigo: 'SP030001', descricao: 'estorno de débito', valor: 20 },
            { codigo: 'SP040001', descricao: 'dedução', valor: 10 },
            { codigo: 'SP050001', descricao: 'débito especial', valor: 5 },
        ], 'SP');
        expect(c).toMatchObject({
            outrosDebitos: 100, estornosCredito: 50, outrosCreditos: 300,
            estornosDebito: 20, deducoes: 10, debitosEspeciais: 5,
        });
        expect(c.validos).toHaveLength(6);
        expect(c.erros).toHaveLength(0);
    });

    it('código inválido e valor não-positivo viram ERRO, nunca entram calados', () => {
        const c = classificarAjustes([
            { codigo: 'MG020799', valor: 100 },
            { codigo: 'SP020799', valor: -5 },
            { codigo: 'SP020799', valor: 80 },
        ], 'SP');
        expect(c.erros).toHaveLength(2);
        expect(c.outrosCreditos).toBe(80);
        expect(c.erros[1]).toMatch(/POSITIVO/);
    });
});

describe('aplicarAjustesApuracao', () => {
    const base = { vlTotDebitos: 1000, vlTotCreditos: 400, vlSldCredorAnt: 100 };

    it('sem ajustes: apuração igual à antiga (devedor)', () => {
        const ap = aplicarAjustesApuracao(base, classificarAjustes([], 'SP'));
        expect(ap.vlSldApurado).toBe(500);
        expect(ap.vlIcmsRecolher).toBe(500);
        expect(ap.vlSldCredorTransportar).toBe(0);
    });

    it('crédito outorgado + dedução mudam recolher; débito especial fica fora da apuração', () => {
        const cls = classificarAjustes([
            { codigo: 'SP020799', descricao: 'crédito outorgado', valor: 200 },
            { codigo: 'SP040001', descricao: 'dedução', valor: 50 },
            { codigo: 'SP050001', descricao: 'débito especial', valor: 30 },
        ], 'SP');
        const ap = aplicarAjustesApuracao(base, cls);
        // 1000 − (400+200) − 100 = 300 devedor; recolher = 300 − 50
        expect(ap.vlSldApurado).toBe(300);
        expect(ap.vlTotDed).toBe(50);
        expect(ap.vlIcmsRecolher).toBe(250);
        expect(ap.vlDebEsp).toBe(30);
    });

    it('saldo CREDOR: VL_SLD_APURADO fica 0 e o credor transporta (correção do gerador antigo)', () => {
        const cls = classificarAjustes([{ codigo: 'SP020799', valor: 700 }], 'SP');
        const ap = aplicarAjustesApuracao(base, cls);
        // 1000 − (400+700) − 100 = −200 → credor
        expect(ap.vlSldApurado).toBe(0);
        expect(ap.vlIcmsRecolher).toBe(0);
        expect(ap.vlSldCredorTransportar).toBe(200);
    });

    it('dedução maior que o saldo devedor não vira crédito — excedente sinalizado', () => {
        const cls = classificarAjustes([{ codigo: 'SP040001', valor: 800 }], 'SP');
        const ap = aplicarAjustesApuracao(base, cls);
        expect(ap.vlTotDed).toBe(500);      // aplicada até o teto do saldo
        expect(ap.vlIcmsRecolher).toBe(0);
        expect(ap.deducaoExcedente).toBe(300);
    });

    it('estornos entram no lado certo da fórmula', () => {
        const cls = classificarAjustes([
            { codigo: 'SP010001', valor: 60 },  // estorno de crédito → soma no débito
            { codigo: 'SP030001', valor: 40 },  // estorno de débito → soma no crédito
        ], 'SP');
        const ap = aplicarAjustesApuracao(base, cls);
        // (1000+60) − (400+40) − 100 = 520
        expect(ap.vlSldApurado).toBe(520);
        expect(ap.vlEstornosCred).toBe(60);
        expect(ap.vlEstornosDeb).toBe(40);
    });
});

describe('montarLinhasE111', () => {
    it('uma linha por ajuste válido, na ordem lançada', () => {
        const cls = classificarAjustes([
            { codigo: 'SP020799', descricao: 'crédito outorgado', valor: 300 },
            { codigo: 'SP000207', descricao: '', valor: 10 },
        ], 'SP');
        expect(montarLinhasE111(cls.validos)).toEqual([
            ['E111', 'SP020799', 'crédito outorgado', 300],
            ['E111', 'SP000207', '', 10],
        ]);
    });
});
