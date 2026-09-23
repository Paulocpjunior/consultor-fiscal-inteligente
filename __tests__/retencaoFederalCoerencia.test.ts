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

describe('os campos de PIS/COFINS são o tributo do PRESTADOR, não retenção', () => {
    /**
     * Nota REAL (07/08): NFS-e 00375235, ELEVADORES ATLAS SCHINDLER →
     * CONDOMINIO EDIFICIO MONTE CARLO. Base 3.413,24 com PIS 56,32 (1,65%) e
     * COFINS 259,41 (7,60%) — as alíquotas do NÃO-CUMULATIVO — e a retenção de
     * verdade em outro campo: 158,72 = 4,65% (CSRF). A própria nota avisa em
     * "Outras Informações" que PIS e COFINS ali são o TOTAL da operação.
     *
     * O importer grava esses campos como `pisRetido`/`cofinsRetida`. Mandados
     * ao R-4020, declarariam como retido o imposto do prestador — 315,73 no
     * lugar de 158,72.
     */
    const ATLAS = { base: 3413.24, pis: 56.32, cofins: 259.41, csll: 158.72 };

    it('a assinatura 1,65% + 7,60% é nomeada, não vira "alíquota fora"', () => {
        const r = conferirRetencaoFederal(ATLAS);
        expect(r.situacao).toBe('campos-sao-totais-da-operacao');
        expect(r.aliquotas.pis).toBeCloseTo(1.65, 1);
        expect(r.aliquotas.cofins).toBeCloseTo(7.6, 1);
        expect(r.motivo).toMatch(/NÃO-CUMULATIVO do prestador/);
        expect(r.exigeAcao).toBe(true);
    });

    it('aponta ONDE está a retenção de verdade quando a CSRF está na nota', () => {
        const r = conferirRetencaoFederal(ATLAS);
        expect(r.aliquotas.csll).toBeCloseTo(ALIQ_CSRF, 1);
        expect(r.motivo).toMatch(/contribuições sociais retidas/);
        expect(r.acao).toMatch(/CSRF 4,65%/);
    });

    it('sem a CSRF na nota, NÃO inventa de onde tirar — manda conferir', () => {
        const r = conferirRetencaoFederal({ base: 3413.24, pis: 56.32, cofins: 259.41 });
        expect(r.situacao).toBe('campos-sao-totais-da-operacao');
        expect(r.motivo).not.toMatch(/contribuições sociais retidas/);
        expect(r.acao).toMatch(/Confira no documento/);
    });

    it('não devolve valor "corrigido": o rateio entre PIS, COFINS e CSLL não está no documento', () => {
        const r = conferirRetencaoFederal(ATLAS);
        expect(r).not.toHaveProperty('pisCorrigido');
        expect(r).not.toHaveProperty('retencaoCorrigida');
    });

    it('a retenção CUMULATIVA de verdade (0,65% e 3%) continua coerente', () => {
        // A distinção é o ponto: mesmos campos, leituras opostas.
        const r = conferirRetencaoFederal({ base: 3413.24, pis: 22.19, cofins: 102.40, csll: 34.13 });
        expect(r.situacao).toBe('coerente');
    });

    it('a varredura conta e avisa em separado do "CSLL é o total"', () => {
        const v = varrerRetencaoFederal([ATLAS, CLINIPAR_COMO_VEM, CLINIPAR_VERDADE]);
        expect(v.resumo.camposDaOperacao).toBe(1);
        expect(v.resumo.csllEhOTotal).toBe(1);
        expect(v.avisos.join(' ')).toMatch(/tributo do PRESTADOR/);
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

// ============================================================================
// 🚨 "PUXOU UMA NOTA QUE NÃO TEM RETENÇÃO — COMO NÃO CONSIDERAR ELA?"
// (02/09, Paulo, HS PROJETOS · 08/2026, nota 22243 da EMBRATOP GEO)
//
// O PDF da NFS-e paulistana traz, lado a lado:
//   · PIS/PASEP 2,31 (1,65% de 140) e COFINS 10,64 (7,60%) — as alíquotas do
//     NÃO-CUMULATIVO, ou seja o tributo da OPERAÇÃO do prestador (caso ATLAS);
//   · Contribuições Sociais - Retidas: 0,00, com a descrição
//     "0 - PIS/COFINS/CSLL Não Retidos".
//
// Os dois sinais concordam e o campo de contribuições retidas é O campo da
// retenção neste leiaute. Com ele PRESENTE e ZERO, a resposta está no
// documento — mandar ajustar à mão é a régua de 24/08 ao contrário.
// ============================================================================
describe('🚫 o documento DECLARA que não houve retenção', () => {
    // Os números são os do PDF que o Paulo mandou.
    const nota22243 = { base: 140, pis: 2.31, cofins: 10.64, csll: 0, csllPresente: true };

    it('CSRF presente e ZERO + assinatura da operação ⇒ sem retenção a declarar', () => {
        const r = conferirRetencaoFederal(nota22243);
        expect(r.situacao).toBe('sem-retencao-declarada');
        // 🚨 Não exige ação: não há o que ajustar numa nota sem retenção.
        expect(r.exigeAcao).toBe(false);
        expect(r.acao).toBeNull();
        expect(r.motivo).toMatch(/Não Retidos/);
        expect(r.motivo).toMatch(/tributo da OPERAÇÃO/);
    });

    // ⚠️ PRESENÇA ≠ ZERO: sem o campo, o app NÃO conclui — o documento não
    // disse nada, e concluir "sem retenção" ali tiraria do R-4020 uma nota que
    // ninguém conferiu.
    it('CSRF AUSENTE não vira "sem retenção" — continua exigindo conferência', () => {
        const r = conferirRetencaoFederal({ base: 140, pis: 2.31, cofins: 10.64, csll: 0 });
        expect(r.situacao).toBe('campos-sao-totais-da-operacao');
        expect(r.exigeAcao).toBe(true);
    });

    // 🚨 E ELA SÓ VALE COM A ASSINATURA DA OPERAÇÃO: PIS 0,65% + COFINS 3% com
    // a CSRF zerada é RETENÇÃO DE VERDADE com o campo agregado em branco.
    // Concluir "sem retenção" ali declararia a MENOS do que foi retido.
    it('retenção de verdade com CSRF zerada NÃO é dispensada', () => {
        const r = conferirRetencaoFederal({ base: 1000, pis: 6.5, cofins: 30, csll: 0, csllPresente: true });
        expect(r.situacao).not.toBe('sem-retencao-declarada');
    });

    // ⚠️ E o caso ATLAS continua como era: CSRF de 4,65% preenchida é retenção,
    // e o app manda usar ELA, não os campos de PIS/COFINS.
    it('CSRF preenchida (4,65%) segue sendo retenção, não dispensa', () => {
        const r = conferirRetencaoFederal({
            base: 3413.24, pis: 56.32, cofins: 259.41, csll: 158.72, csllPresente: true,
        });
        expect(r.situacao).toBe('campos-sao-totais-da-operacao');
        expect(r.exigeAcao).toBe(true);
        expect(r.acao).toMatch(/CSRF 4,65%/);
    });
});
