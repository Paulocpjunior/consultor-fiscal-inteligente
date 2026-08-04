/**
 * Antecipação do art. 426-A (RICMS/SP) — fase 2 do DIFAL.
 *
 * IA = VA × (1 + IVA-ST) × ALQ − IC, uma guia POR DOCUMENTO.
 * A trava que mais importa aqui: sem IVA-ST informado não há conta — o
 * documento fica PENDENTE, nunca sai zero como se não houvesse imposto.
 */
import {
    valorAquisicao, impostoCobradoAnterior, ivaStAjustado,
    calcularAntecipacao426A, apurarAntecipacoes426A,
} from '../sefaz-backend/difal-426a.js';

const NOTA = {
    chave: '3526080000000000000000550010000001231000001238',
    numero: '123',
    totais: { vProd: 10000, vDesc: 0, vFrete: 500, vSeg: 0, vOutro: 0, vIPI: 0, vICMS: 700 },
    itens: [{ vProd: 10000, vICMS: 700, aliqIcms: 7 }],
};

describe('VA e IC — o que entra na conta', () => {
    it('VA soma frete, seguro, IPI e outras despesas (art. 426-A §2º)', () => {
        expect(valorAquisicao({
            totais: { vProd: 10000, vDesc: 200, vFrete: 500, vSeg: 100, vOutro: 50, vIPI: 300 },
        })).toBe(10750);
    });

    it('sem bloco de totais (nota antiga), soma pelos itens', () => {
        expect(valorAquisicao({
            itens: [
                { vProd: 1000, vDesc: 0, vFrete: 50 },
                { vProd: 500, vDesc: 100 },
            ],
        })).toBe(1450);
    });

    it('IC é o ICMS destacado na aquisição', () => {
        expect(impostoCobradoAnterior(NOTA)).toBe(700);
        expect(impostoCobradoAnterior({ itens: [{ vICMS: 120 }, { vICMS: 80 }] })).toBe(200);
    });
});

describe('IVA-ST ajustado', () => {
    it('ajusta pra cima quando a interestadual é menor que a interna', () => {
        // [(1+0,40) × (1-0,07) / (1-0,18)] - 1 = 0,5878... → 58,78%
        expect(ivaStAjustado(40, 7, 18)).toBe(58.78);
    });

    it('interestadual de 4% (importado) ajusta mais ainda', () => {
        // [(1,40 × 0,96) / 0,82] - 1 = 63,90%
        expect(ivaStAjustado(40, 4, 18)).toBe(63.9);
    });

    it('interestadual igual ou maior que a interna não ajusta', () => {
        expect(ivaStAjustado(40, 18, 18)).toBe(40);
        expect(ivaStAjustado(40, 20, 18)).toBe(40);
    });
});

describe('calcularAntecipacao426A', () => {
    it('aplica a fórmula do §2º com o IVA ajustado', () => {
        const r = calcularAntecipacao426A(NOTA, {
            ivaSt: 40, aliqInterna: 18, aliqInterestadual: 7,
        });

        expect(r.calculavel).toBe(true);
        expect(r.va).toBe(10500);            // 10.000 + 500 de frete
        expect(r.ic).toBe(700);
        expect(r.ivaAplicado).toBe(58.78);   // ajustado de 40%
        expect(r.ivaFoiAjustado).toBe(true);
        expect(r.baseSt).toBe(16671.9);      // 10.500 × 1,5878
        expect(r.antecipacao).toBe(2300.94); // 16.671,90 × 18% − 700
    });

    it('aceita o IVA JÁ ajustado da Portaria sem reajustar', () => {
        const r = calcularAntecipacao426A(NOTA, {
            ivaSt: 58.78, ivaJaAjustado: true, aliqInterna: 18, aliqInterestadual: 7,
        });
        expect(r.ivaAplicado).toBe(58.78);
        expect(r.ivaFoiAjustado).toBeFalsy();
        expect(r.antecipacao).toBe(2300.94);
    });

    it('SEM IVA-ST não calcula: fica pendente com o motivo (nunca zero calado)', () => {
        const r = calcularAntecipacao426A(NOTA, { aliqInterna: 18, aliqInterestadual: 7 });
        expect(r.calculavel).toBe(false);
        expect(r.antecipacao).toBe(0);
        expect(r.motivo).toContain('Portaria CAT');
    });

    it('sem alíquota interna também não calcula', () => {
        const r = calcularAntecipacao426A(NOTA, { ivaSt: 40, aliqInterna: 0, aliqInterestadual: 7 });
        expect(r.calculavel).toBe(false);
        expect(r.motivo).toContain('Alíquota interna');
    });

    it('crédito maior que o imposto da base não vira imposto negativo', () => {
        const notaCreditoAlto = {
            ...NOTA,
            totais: { ...NOTA.totais, vICMS: 999999 },
        };
        const r = calcularAntecipacao426A(notaCreditoAlto, {
            ivaSt: 40, aliqInterna: 18, aliqInterestadual: 7,
        });
        expect(r.antecipacao).toBe(0);
    });
});

describe('apurarAntecipacoes426A — lote', () => {
    const documentos = [
        { chave: 'A', numero: '1', doc: NOTA, aliqInterestadual: 7, fornecedor: 'FORN A', ufOrigem: 'MG' },
        { chave: 'B', numero: '2', doc: NOTA, aliqInterestadual: 7, fornecedor: 'FORN B', ufOrigem: 'PR' },
    ];

    it('separa calculadas de pendentes e só soma as calculadas', () => {
        const r = apurarAntecipacoes426A(documentos, { A: { ivaSt: 40 } }, 18);

        expect(r.resumo).toEqual({ documentos: 2, calculados: 1, pendentes: 1 });
        expect(r.calculadas[0].chave).toBe('A');
        expect(r.pendentes[0].chave).toBe('B');
        expect(r.totalAntecipacao).toBe(2300.94);
    });

    it('alíquota interna por documento vence a padrão', () => {
        const r = apurarAntecipacoes426A(
            [documentos[0]],
            { A: { ivaSt: 40, aliqInterna: 25 } },
            18,
        );
        expect(r.calculadas[0].aliqInterna).toBe(25);
    });

    it('deixa escrito que a guia é POR DOCUMENTO e que pendente não é isento', () => {
        const r = apurarAntecipacoes426A(documentos, {}, 18);
        const texto = r.ressalvas.join(' ');
        expect(texto).toContain('POR DOCUMENTO');
        expect(texto).toContain('PENDENTE');
        expect(r.totalAntecipacao).toBe(0);
        expect(r.resumo.pendentes).toBe(2);
    });

    it('lote vazio não quebra', () => {
        expect(apurarAntecipacoes426A([], {}, 18).resumo)
            .toEqual({ documentos: 0, calculados: 0, pendentes: 0 });
    });
});
