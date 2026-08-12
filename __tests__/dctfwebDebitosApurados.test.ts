/**
 * DÉBITOS APURADOS da DCTFWeb — a tabela que o e-CAC mostra e o CFI não mostrava.
 *
 * Paulo, 12/08/2026: *"no consultor fiscal não está atualizado igual no e-CAC"*.
 * O detalhe do CFI dizia "Valor do resumo SERPRO: não retornado no resumo" e
 * parava aí; o e-CAC listava tributo a tributo (IRRF 0561-07, 0588-06, 3208-06,
 * PIS…) e o total.
 *
 * O dado NUNCA faltou — o mesmo XML já era consultado e `extrairDebitosDctfweb`
 * já lia código, descrição e valor. O que existia era um FILTRO: só os
 * trimestrais (IRPJ/CSLL) sobreviviam e o resto era descartado.
 *
 * Este teste trava as duas pontas: TODO débito com saldo a pagar volta (nada de
 * filtro por família), e ausência de leitura NÃO vira zero.
 */
// @ts-expect-error — módulo .js puro
import { extrairDebitosDctfweb } from '../sefaz-backend/dctfweb-retencao-normalizer.js';

/** Shape confirmado contra XML real do CONSXMLDECLARACAO. */
const credito = (codReceita: string, descricao: string, valor: string) => `
    <CreditoTributarioApurado>
        <codReceita>${codReceita}</codReceita>
        <ctDescricaoTributo>${descricao}</ctDescricaoTributo>
        <ctValor>${valor}</ctValor>
        <saldoaPagar>${valor}</saldoaPagar>
    </CreditoTributarioApurado>`;

// Números do e-CAC que o Paulo mandou (COMUNIDADE EVANGELICA, 07/2026).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<ProcDctf><ConteudoDeclaracao><DctfXml><A050-CreditosTributarios>
${credito('116201', 'CONTRIBUICAO PREVIDENCIARIA PATRONAL', '5382.64')}
${credito('115501', 'CONTRIBUICAO PREVIDENCIARIA SEGURADOS', '2353.92')}
${credito('056107', 'IRRF - RD TRB ASSAL PAIS/AUS NO EXT A SERV PAIS', '606.71')}
${credito('058806', 'IRRF - REND DO TABALHO SEM VINCULO EMPREGATICIO', '710.88')}
${credito('320806', 'IRRF - ALUG E ROYALTIES PAGOS A PF', '18859.51')}
${credito('850701', 'PIS - FOLHA DE SALARIOS', '232.41')}
${/* O código desta linha NÃO aparece no print (o grupo estava recolhido no
     e-CAC) — o que importa aqui é o valor, que fecha o total. Zeros de
     propósito: código inventado num fixture vira código copiado depois. */ ''}
${credito('000000', 'CONTRIBUICAO PARA OUTRAS ENTIDADES E FUNDOS', '1347.99')}
</A050-CreditosTributarios></DctfXml></ConteudoDeclaracao></ProcDctf>`;

describe('extrairDebitosDctfweb — todos os débitos, não só os da Reinf', () => {
    it('devolve TODA linha com saldo a pagar, inclusive débito próprio', () => {
        const r = extrairDebitosDctfweb(XML);
        expect(r.lido).toBe(true);
        expect(r.debitos).toHaveLength(7);
        // Previdenciária própria e PIS sobre folha NÃO são retenção da Reinf —
        // e é exatamente por isso que precisam aparecer: o e-CAC as mostra.
        expect(r.debitos.map((d: any) => d.codReceita)).toEqual(
            expect.arrayContaining(['116201', '115501', '850701']),
        );
    });

    it('separa código e extensão como o e-CAC imprime (0561-07)', () => {
        const r = extrairDebitosDctfweb(XML);
        const irrfAluguel = r.debitos.find((d: any) => d.codReceita === '320806');
        expect(irrfAluguel.codigo).toBe('3208');
        expect(irrfAluguel.extensao).toBe('06');
        expect(irrfAluguel.valor).toBe(18859.51);
        expect(irrfAluguel.descricao).toMatch(/ALUG E ROYALTIES/);
    });

    it('a soma bate com o total do e-CAC (29.494,06)', () => {
        const r = extrairDebitosDctfweb(XML);
        const total = r.debitos.reduce((s: number, d: any) => s + d.valor, 0);
        expect(Number(total.toFixed(2))).toBe(29494.06);
    });

    it('linha sem saldo a pagar não entra — declarado ≠ a pagar', () => {
        const comZerado = XML.replace('<saldoaPagar>232.41</saldoaPagar>', '<saldoaPagar>0.00</saldoaPagar>');
        expect(extrairDebitosDctfweb(comZerado).debitos).toHaveLength(6);
    });

    // Farol honesto: ilegível não é "sem débito".
    it('XML ausente ou ilegível devolve lido=false com motivo, nunca zero', () => {
        expect(extrairDebitosDctfweb('')).toMatchObject({ lido: false, debitos: [] });
        expect(extrairDebitosDctfweb('')).toHaveProperty('motivo', expect.stringMatching(/ausente/i));
        expect(extrairDebitosDctfweb(42)).toMatchObject({ lido: false });
    });
});
