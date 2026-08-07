/**
 * A RETENÇÃO FEDERAL TEM ASSINATURA DE ALÍQUOTA — e é ela que denuncia o campo
 * trocado, sem precisar de arquivo novo.
 *
 * Achado 07/08: a coluna "CSLL" do export de NFS-e do portal de SP não é a
 * CSLL. Na nota da CLINIPAR (base 590,10) ela vale 27,44 = PIS 3,84 + COFINS
 * 17,70 + CSLL 5,90 — o TOTAL. A CSLL verdadeira não aparece em coluna nenhuma,
 * e o importer gravava `valorCsll` a partir dela.
 *
 * Perguntar "isso vale também no export CSV?" não precisa de outro arquivo: as
 * alíquotas são fixas em lei e a assinatura está no próprio dado.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { conferirRetencaoFederal, varrerRetencaoFederal, aliquotaEfetiva, ALIQ_CSRF } from '../sefaz-backend/retencao-federal-coerencia';

/** A nota REAL do print do IOB, como o portal a entrega hoje. */
const CLINIPAR_COMO_VEM = { base: 590.10, pis: 3.84, cofins: 17.70, csll: 27.44 };
/** A mesma nota com a verdade do IOB. */
const CLINIPAR_VERDADE = { base: 590.10, pis: 3.84, cofins: 17.70, csll: 5.90 };

describe('a nota real do Paulo denuncia o campo trocado', () => {
    it('como o portal entrega: a CSLL é o TOTAL da CSRF', () => {
        const r = conferirRetencaoFederal(CLINIPAR_COMO_VEM);
        expect(r.situacao).toBe('csll-e-o-total');
        expect(r.aliquotas.csll).toBeCloseTo(ALIQ_CSRF, 1);
        expect(r.motivo).toMatch(/CSRF INTEIRA/);
        expect(r.acao).toMatch(/em dobro/);
        expect(r.exigeAcao).toBe(true);
    });

    it('com a CSLL verdadeira (5,90 = 1%), a nota fica coerente', () => {
        const r = conferirRetencaoFederal(CLINIPAR_VERDADE);
        expect(r.situacao).toBe('coerente');
        expect(r.aliquotas).toEqual({ pis: 0.65, cofins: 3, csll: 1 });
    });
});

describe('a assinatura das alíquotas', () => {
    it('PIS 0,65% · COFINS 3% · CSLL 1% é o esperado', () => {
        expect(conferirRetencaoFederal({ base: 1000, pis: 6.5, cofins: 30, csll: 10 }).situacao).toBe('coerente');
    });

    it('centavo arredondado não vira divergência', () => {
        expect(conferirRetencaoFederal({ base: 333.33, pis: 2.17, cofins: 10, csll: 3.33 }).situacao).toBe('coerente');
    });

    it('alíquota fora da lei acende, com o esperado ao lado', () => {
        const r = conferirRetencaoFederal({ base: 1000, pis: 6.5, cofins: 30, csll: 45 });
        expect(r.situacao).toBe('aliquota-fora');
        expect(r.motivo).toMatch(/CSLL 4\.5% \(esperado 1%\)/);
    });

    it('nota SEM retenção nenhuma é o caso normal, não alarme', () => {
        expect(conferirRetencaoFederal({ base: 1000 }).situacao).toBe('sem-retencao');
    });

    it('sem base não se inventa alíquota', () => {
        const r = conferirRetencaoFederal({ base: 0, pis: 10 });
        expect(r.situacao).toBe('sem-base');
        expect(r.exigeAcao).toBe(false);
        expect(aliquotaEfetiva(10, 0)).toBeNull();
    });
});

describe('o app ACUSA, não conserta', () => {
    it('não devolve uma "CSLL corrigida" — dividir o total seria inventar', () => {
        // A nota pode ter retenção parcial, dispensa por valor mínimo, ou só
        // uma das três contribuições. "Provavelmente é X" não entra em
        // declaração.
        const r = conferirRetencaoFederal(CLINIPAR_COMO_VEM);
        expect(r).not.toHaveProperty('csllCorrigida');
        expect(r.acao).toMatch(/pegue do XML da nota ou do texto da discriminação/);
    });
});

describe('varredura — é ela que responde sem arquivo novo', () => {
    it('conta quantas notas já gravadas têm a assinatura do erro', () => {
        const v = varrerRetencaoFederal([
            CLINIPAR_COMO_VEM,
            { base: 230, pis: 1.50, cofins: 6.90, csll: 10.70 },   // ORION: mesma doença
            CLINIPAR_VERDADE,
            { base: 1000 },
        ]);
        expect(v.resumo.analisadas).toBe(4);
        expect(v.resumo.csllEhOTotal).toBe(2);
        expect(v.avisos.join(' ')).toMatch(/contada em dobro/);
    });

    it('nota coerente e nota sem retenção NÃO entram na lista', () => {
        const v = varrerRetencaoFederal([CLINIPAR_VERDADE, { base: 500 }]);
        expect(v.linhas).toHaveLength(0);
        expect(v.avisos.join(' ')).toMatch(/Nenhuma incoerência/);
    });

    it('lista vazia não inventa aviso', () => {
        expect(varrerRetencaoFederal([]).avisos).toEqual([]);
    });
});
