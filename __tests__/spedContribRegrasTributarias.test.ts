/**
 * Testes do motor de regras tributárias EFD Contribuições.
 * SPED limpo -> 0 achados; cada regra dispara em dado deliberadamente errado.
 */
// @ts-expect-error — módulo .js puro
import { parseSpedFiscalParaEdicao, colunasDoTipo } from '../sefaz-backend/sped-fiscal-editor-parser.js';
// @ts-expect-error — módulo .js puro
import { aplicarRegrasContribuicoes } from '../sefaz-backend/sped-contrib-regras-tributarias.js';
// (sem @ts-expect-error: este módulo TEM .d.ts — silenciar devolveria o módulo
// inteiro a `any` e o tipo pararia de valer, que é o defeito do deploy 799.)
import { buildBlocoA } from '../sefaz-backend/sped-contrib-blocos.js';

// Constrói C170 contrib (36 campos) preenchendo só os relevantes por nome.
function c170Contrib(o: Record<string, string> = {}): string {
    const cols: string[] = colunasDoTipo('C170', 'contribuicoes');
    const campos = cols.map((c: string) => o[c] ?? '');
    if (campos[cols.indexOf('NUM_ITEM')] === '') campos[cols.indexOf('NUM_ITEM')] = '1';
    if (campos[cols.indexOf('COD_ITEM')] === '') campos[cols.indexOf('COD_ITEM')] = '001';
    if (campos[cols.indexOf('VL_ITEM')] === '') campos[cols.indexOf('VL_ITEM')] = '100,00';
    return '|C170|' + campos.join('|') + '|';
}

function montaContrib(c170s: string[], m210s: string[] = [], m610s: string[] = []): any {
    const txt = [
        '|0000|006|0|01012026|31012026|EMP|12345678000190|SP|3550308|0|0|',
        '|0001|0|',
        '|0200|001|PRODUTO|||UN|01|39011030|||20|',
        '|0990|3|',
        '|C001|0|', ...c170s, '|C990|1|',
        '|M001|0|', '|M200|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
        ...m210s, ...m610s,
        '|M990|3|',
    ].join('\r\n') + '\r\n';
    return parseSpedFiscalParaEdicao(txt);
}

// Constrói M210/M610: |M210|CST|VL_REC_BRT|VL_BC_CONT|... (15 campos)
function m210(cst: string, vlBc: string, vlContApur: string = '0,00'): string {
    return `|M210|${cst}|${vlBc}|${vlBc}|0,00|0,00|${vlBc}|0,65|0,00|0,00|${vlContApur}|0,00|0,00|0,00|0,00|${vlContApur}|`;
}
function m610(cst: string, vlBc: string, vlContApur: string = '0,00'): string {
    return `|M610|${cst}|${vlBc}|${vlBc}|0,00|0,00|${vlBc}|3|0,00|0,00|${vlContApur}|0,00|0,00|0,00|0,00|${vlContApur}|`;
}

describe('regras contribuições — SPED limpo não gera ruído', () => {
    it('cumulativo (Presumido) com CST 01 e alíquotas 0,65 / 3 -> 0 achados', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '01', VL_BC_PIS: '100,00', ALIQ_PIS: '0,65', VL_PIS: '0,65',
                CST_COFINS: '01', VL_BC_COFINS: '100,00', ALIQ_COFINS: '3', VL_COFINS: '3,00',
            }),
        ], [m210('01', '100,00', '0,65')], [m610('01', '100,00', '3,00')]));
        expect(r.achados).toHaveLength(0);
    });

    it('não-cumulativo (Real) com CST 50 e alíquotas 1,65 / 7,6 -> 0 achados', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '1102',
                CST_PIS: '50', VL_BC_PIS: '100,00', ALIQ_PIS: '1,65', VL_PIS: '1,65',
                CST_COFINS: '50', VL_BC_COFINS: '100,00', ALIQ_COFINS: '7,6', VL_COFINS: '7,60',
            }),
        ], [m210('50', '100,00', '1,65')], [m610('50', '100,00', '7,60')]));
        expect(r.achados).toHaveLength(0);
    });
});

describe('regras contribuições — ERROS de validade', () => {
    it('CST_PIS inválido', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({ CFOP: '5102', CST_PIS: '88', CST_COFINS: '01' }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'CST_PIS_INVALIDO')).toBeTruthy();
    });

    it('CST_COFINS inválido', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({ CFOP: '5102', CST_PIS: '01', CST_COFINS: '88' }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'CST_COFINS_INVALIDO')).toBeTruthy();
    });

    it('CFOP inválido', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({ CFOP: '9999', CST_PIS: '01', CST_COFINS: '01' }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'CFOP_INVALIDO')).toBeTruthy();
    });
});

describe('regras contribuições — AVISOS de coerência', () => {
    it('CST 06 (alíq zero) com VL_PIS > 0 -> aviso', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '06', VL_BC_PIS: '0,00', ALIQ_PIS: '0', VL_PIS: '10,00',
                CST_COFINS: '06', VL_BC_COFINS: '0,00', ALIQ_COFINS: '0', VL_COFINS: '0,00',
            }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'CST_PIS_NAO_TRIBUTAVEL_COM_VALOR')).toBeTruthy();
    });

    it('CST 01 com BC zero e alíquota 0,65 -> aviso', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '01', VL_BC_PIS: '0,00', ALIQ_PIS: '0,65', VL_PIS: '0,00',
                CST_COFINS: '01', VL_BC_COFINS: '100,00', ALIQ_COFINS: '3', VL_COFINS: '3,00',
            }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'BC_PIS_ZERO_COM_ALIQ')).toBeTruthy();
    });

    it('alíquota PIS incomum (ex.: 2,5%)', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '01', VL_BC_PIS: '100,00', ALIQ_PIS: '2,5', VL_PIS: '2,50',
                CST_COFINS: '01', VL_BC_COFINS: '100,00', ALIQ_COFINS: '3', VL_COFINS: '3,00',
            }),
        ], [m210('01', '100,00', '2,50')], [m610('01', '100,00', '3,00')]));
        expect(r.achados.find((a: any) => a.regra === 'ALIQ_PIS_INCOMUM')).toBeTruthy();
    });

    it('CST_PIS != CST_COFINS -> aviso (operação normalmente coerente)', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '01', VL_BC_PIS: '100,00', ALIQ_PIS: '0,65', VL_PIS: '0,65',
                CST_COFINS: '06', VL_BC_COFINS: '0,00', ALIQ_COFINS: '0', VL_COFINS: '0,00',
            }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'CST_PIS_COFINS_DIVERGENTE')).toBeTruthy();
    });
});

describe('regras contribuições — R9: M210/M610 totalizador × C170', () => {
    const c170Tributado = (over: Record<string, string> = {}) => c170Contrib({
        CFOP: '5102',
        CST_PIS: '01', VL_BC_PIS: '100,00', ALIQ_PIS: '0,65', VL_PIS: '0,65',
        CST_COFINS: '01', VL_BC_COFINS: '100,00', ALIQ_COFINS: '3', VL_COFINS: '3,00',
        ...over,
    });

    it('soma C170 bate com M210/M610 -> sem achado de R9', () => {
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Tributado()],
            [m210('01', '100,00')], [m610('01', '100,00')],
        ));
        expect(r.achados.filter((a: any) => a.regra.startsWith('M210') || a.regra.startsWith('M610'))).toHaveLength(0);
    });

    it('M210 ausente (CST 01 em C170, sem totalizador) -> erro M210_FALTANTE', () => {
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Tributado()],
            [], [m610('01', '100,00')], // sem M210, só M610
        ));
        expect(r.achados.find((a: any) => a.regra === 'M210_FALTANTE')).toBeTruthy();
    });

    it('M610 ausente -> erro M610_FALTANTE', () => {
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Tributado()],
            [m210('01', '100,00')], [],
        ));
        expect(r.achados.find((a: any) => a.regra === 'M610_FALTANTE')).toBeTruthy();
    });

    it('M210 BC MENOR que soma C170 (faltou item) -> erro', () => {
        // 2 itens de 100 = 200; M210 declarado 100 (faltou um)
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Tributado(), c170Tributado({ NUM_ITEM: '2' })],
            [m210('01', '100,00')], [m610('01', '200,00')],
        ));
        expect(r.achados.find((a: any) => a.regra === 'M210_BC_MENOR_QUE_C170')).toBeTruthy();
    });

    it('M210 BC MAIOR que soma C170 -> aviso (pode ter A170/F100)', () => {
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Tributado()],
            [m210('01', '500,00')], [m610('01', '100,00')],
        ));
        expect(r.achados.find((a: any) => a.regra === 'M210_BC_MAIOR_QUE_C170')).toBeTruthy();
        expect(r.achados.find((a: any) => a.regra === 'M210_BC_MAIOR_QUE_C170').severidade).toBe('aviso');
    });

    it('CST 06 (alíq zero, BC=0) -> não exige M210/M610 (skip)', () => {
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Contrib({
                CFOP: '5102',
                CST_PIS: '06', VL_BC_PIS: '0,00', ALIQ_PIS: '0', VL_PIS: '0,00',
                CST_COFINS: '06', VL_BC_COFINS: '0,00', ALIQ_COFINS: '0', VL_COFINS: '0,00',
            })],
        ));
        expect(r.achados.find((a: any) => a.regra === 'M210_FALTANTE')).toBeFalsy();
        expect(r.achados.find((a: any) => a.regra === 'M610_FALTANTE')).toBeFalsy();
    });
});

describe('regras contribuições — escopo', () => {
    it('EFD ICMS/IPI -> naoAplicavel', () => {
        const r = aplicarRegrasContribuicoes({ tipoSped: 'fiscal', linhas: [] });
        expect(r.resumo.naoAplicavel).toBe(true);
        expect(r.achados).toHaveLength(0);
    });
});

// ============================================================================
// 🚨 O CST TEM LADO — e a separação estava no COMENTÁRIO deste módulo, sem
// nada travar (o vício de 13/08: *regra escrita não é regra travada*).
//
// Caso real: a **PWR saiu com CST `01` numa ENTRADA** (20/08) — código que nem
// existe na Tabela 4.3.7, a das aquisições. O gerador do C170 foi corrigido no
// dia; a CLASSE ficou aberta, e o **A170 continuou copiando o CST do XML**, que
// é o do FORNECEDOR.
// ============================================================================
const cstDirecao = (r: any) => r.achados.filter((a: any) => a.regra === 'CST_DA_DIRECAO_ERRADA');

describe('🚨 CST no lado errado da operação', () => {
    it('C170 de ENTRADA com CST 01 (receita) -> acusa — o defeito da PWR', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '1102',
                CST_PIS: '01', VL_BC_PIS: '100,00', ALIQ_PIS: '0,65', VL_PIS: '0,65',
                CST_COFINS: '01', VL_BC_COFINS: '100,00', ALIQ_COFINS: '3', VL_COFINS: '3,00',
            }),
        ]));
        const d = cstDirecao(r);
        expect(d).toHaveLength(2);                       // PIS e COFINS
        expect(d[0].severidade).toBe('erro');
        expect(String(d[0].mensagem)).toMatch(/ENTRADA/);
        expect(String(d[0].mensagem)).toMatch(/4\.3\.7/);
    });

    it('C170 de SAÍDA com CST 50 (crédito de aquisição) -> acusa', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '50', VL_BC_PIS: '100,00', ALIQ_PIS: '1,65', VL_PIS: '1,65',
                CST_COFINS: '50', VL_BC_COFINS: '100,00', ALIQ_COFINS: '7,6', VL_COFINS: '7,60',
            }),
        ]));
        expect(cstDirecao(r).length).toBeGreaterThan(0);
        expect(String(cstDirecao(r)[0].mensagem)).toMatch(/SAIDA/);
    });

    // ⚠️ 98 e 99 ("Outras Operações") valem nos DOIS lados — é o que a tabela
    // diz, e acusá-los seria alarme sobre código legítimo.
    it('98 e 99 ficam MUDOS nos dois sentidos', () => {
        for (const cst of ['98', '99']) {
            for (const cfop of ['1102', '5102']) {
                const r = aplicarRegrasContribuicoes(montaContrib([
                    c170Contrib({ CFOP: cfop, CST_PIS: cst, CST_COFINS: cst }),
                ]));
                expect(cstDirecao(r)).toEqual([]);
            }
        }
    });

    it('código INVÁLIDO não vira "lado errado" — a causa dita é outra', () => {
        // Dizer "lado errado" sobre um código que não existe manda procurar o
        // erro no lugar errado. Quem fala aqui é CST_PIS_INVALIDO.
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({ CFOP: '1102', CST_PIS: '88', CST_COFINS: '88' }),
        ]));
        expect(cstDirecao(r)).toEqual([]);
        expect(r.achados.find((a: any) => a.regra === 'CST_PIS_INVALIDO')).toBeTruthy();
    });

    it('e o arquivo CERTO continua mudo (entrada 50 · saída 01)', () => {
        const entrada = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '1102',
                CST_PIS: '50', VL_BC_PIS: '100,00', ALIQ_PIS: '1,65', VL_PIS: '1,65',
                CST_COFINS: '50', VL_BC_COFINS: '100,00', ALIQ_COFINS: '7,6', VL_COFINS: '7,60',
            }),
        ], [m210('50', '100,00', '1,65')], [m610('50', '100,00', '7,60')]));
        expect(cstDirecao(entrada)).toEqual([]);
    });
});

// ── O A170 (bloco A — serviços) ─────────────────────────────────────────────
//
// 📌 EM 22/08 ELE FICOU DE FORA, e o motivo escrito era *"a contagem dele não
// está em CAMPOS_POR_REGISTRO, e conferir posição deduzida é alarme falso"*.
// Esse motivo CADUCOU em 29/08, com o Guia 1.35 extraído: A170 = 18 campos,
// **sem buraco e com os NOMES** (CST_PIS no 09, CST_COFINS no 13), e A100 = 21
// com o IND_OPER no 02. As posições são LIDAS da fonte, não deduzidas.
//
// ⚠️ E o A170 NÃO TEM CFOP: a direção vem do **A100 PAI**, pelo mesmo
// pareamento do C100 × C190 e do D100 × D190 — o filho pertence ao pai que o
// ANTECEDE.

/** Monta um arquivo de Contribuições com bloco A montado à mão. */
function montaBlocoA(linhasA: string[]): any {
    const txt = [
        '|0000|006|0|01072026|31072026|EMP|11111111000191|SP|3550308|0|0|',
        '|0001|0|', '|0990|3|',
        '|A001|0|', '|A010|11111111000191|', ...linhasA, `|A990|${linhasA.length + 3}|`,
        '|M001|0|', '|M200|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|', '|M990|3|',
    ].join('\r\n') + '\r\n';
    return parseSpedFiscalParaEdicao(txt);
}
/** A100 com 21 campos — só o IND_OPER importa aqui. */
const a100 = (indOper: string) =>
    `|A100|${indOper}|1|22222222000191|00|||1||10072026|10072026|1000,00|0||1000,00|6,50|1000,00|30,00||||`;
/** A170 com 18 campos — CST_PIS no 09, CST_COFINS no 13. */
const a170 = (cst: string) =>
    `|A170|1|S1|SERVICO|1000,00|||0|${cst}|1000,00|0,6500|6,50|${cst}|1000,00|3,0000|30,00|||`;

describe('🚨 A170: a direção vem do A100 PAI', () => {
    it('A100 de AQUISIÇÃO (IND_OPER 0) com A170 CST 01 -> acusa', () => {
        const d = cstDirecao(aplicarRegrasContribuicoes(montaBlocoA([a100('0'), a170('01')])));
        expect(d).toHaveLength(2);
        expect(d[0].registro).toBe('A170');
        expect(String(d[0].mensagem)).toMatch(/IND_OPER 0 do A100/);
    });

    it('A100 de PRESTAÇÃO (IND_OPER 1) com A170 CST 01 -> mudo', () => {
        expect(cstDirecao(aplicarRegrasContribuicoes(montaBlocoA([a100('1'), a170('01')])))).toEqual([]);
    });

    // 🚨 A LIÇÃO DO D100 × D190 (29/08): com UM pai só, "o primeiro A100 do
    // arquivo" e "o pai que antecede" dão a MESMA resposta — e é essa
    // coincidência que faz a versão errada passar. Com DOIS, elas divergem.
    it('com DOIS pais, cada A170 é julgado pelo SEU — não pelo primeiro', () => {
        const d = cstDirecao(aplicarRegrasContribuicoes(montaBlocoA([
            a100('1'), a170('01'),   // prestação com CST de receita — CERTO
            a100('0'), a170('01'),   // aquisição com CST de receita — ERRADO
        ])));
        expect(d).toHaveLength(2);   // só o segundo par, PIS e COFINS
        // E ele aponta a LINHA do filho errado, não a do primeiro.
        const idxs = new Set(d.map((x: any) => x.idx));
        expect(idxs.size).toBe(1);
    });

    it('e o inverso: A170 de PRESTAÇÃO com CST 50 -> acusa', () => {
        const d = cstDirecao(aplicarRegrasContribuicoes(montaBlocoA([a100('1'), a170('50')])));
        expect(d).toHaveLength(2);
        expect(String(d[0].mensagem)).toMatch(/SAIDA/);
    });

    // ⚠️ AUSÊNCIA NÃO É PROVA: sem pai legível o app não leu a direção, e
    // afirmar o lado ali seria alarme sobre arquivo que ninguém conferiu.
    it('A170 sem A100 pai fica MUDO', () => {
        expect(cstDirecao(aplicarRegrasContribuicoes(montaBlocoA([a170('01')])))).toEqual([]);
    });

    it('e o A990 fecha o bloco — filho depois dele não herda o pai', () => {
        const p = montaBlocoA([a100('0')]);
        p.linhas.push({ tipo: 'A170', idx: 99, campos: a170('01').slice(1, -1).split('|') });
        expect(cstDirecao(aplicarRegrasContribuicoes(p))).toEqual([]);
    });
});

// ============================================================================
// 🚨 E O GERADOR EMITIA O DEFEITO — o A170 copiava o CST do FORNECEDOR.
//
// O C170 passou a decidir pelo REGIME em 20/08; o A170 ficou para trás. Pior:
// quando caía no 70 (*aquisição SEM direito a crédito*) ele declarava crédito
// na casa seguinte. Medido, antes da correção:
//
//   |A170|1|SERV-GENERICO|...|1000,00|||0|**70**|1000,00|0,6500|**6,50**|...
//
// A contagem de campos está CERTA, então nenhuma trava de forma via — é a
// família do M100/M500 que se desmentia por dentro (29/08).
// ============================================================================
const notaServico = (direcao: string, itens: any[]) => ({
    empresa: { cnpj: '11111111000191', dadosFiscais: { uf: 'SP' } },
    competenciaInicio: '2026-07',
    competenciaFim: '2026-07',
    notas: [{
        tipo: 'nfse', direcao, numero: '1', dataEmissao: '2026-07-10', valorTotal: 1000,
        prestador: { cnpjCpf: '22222222000191', nome: 'F' },
        tomador: { cnpjCpf: '33333333000191', nome: 'T' },
        itens,
    }],
    warnings: [] as string[],
});
const camposA170 = (dados: any) => {
    const l = (buildBlocoA(dados) as string[]).find((x) => x.startsWith('|A170|'));
    expect(l).toBeTruthy();
    return l!.replace(/\r?\n$/, '').split('|');
};
const cstDoFornecedor = [{ nItem: '1', cProd: 'S1', xProd: 'S', vProd: 1000, cstPis: '01', cstCofins: '01' }];

describe('🚨 o gerador do A170 decide pelo REGIME na entrada, nunca pelo CST do XML', () => {
    it('entrada CUMULATIVA: CST 70 e crédito ZERO — nem o CST do fornecedor, nem valor', () => {
        const c = camposA170({ ...notaServico('entrada', cstDoFornecedor), regimeApuracao: '2' });
        expect(c[9]).toBe('70');    // CST_PIS  — era '01', o do fornecedor
        expect(c[10]).toBe('0,00'); // VL_BC_PIS — era 1000,00 com CST 70 ao lado
        expect(c[12]).toBe('0,00'); // VL_PIS    — era 6,50 de crédito inexistente
        expect(c[13]).toBe('70');   // CST_COFINS
        expect(c[16]).toBe('0,00'); // VL_COFINS
    });

    it('entrada NÃO-CUMULATIVA: CST 50 e o crédito CONTINUA — nada foi tirado de ninguém', () => {
        const c = camposA170({ ...notaServico('entrada', []), regimeApuracao: '1' });
        expect(c[9]).toBe('50');
        expect(c[10]).toBe('1000,00');
        expect(c[12]).toBe('16,50');   // 1,65%
        expect(c[16]).toBe('76,00');   // 7,6%
    });

    it('na SAÍDA o documento é NOSSO — o CST do item continua vencendo', () => {
        const c = camposA170({ ...notaServico('saida', cstDoFornecedor), regimeApuracao: '2' });
        expect(c[9]).toBe('01');
        expect(c[12]).toBe('6,50');
    });

    // ✅ E A REGRA NASCE VERDE sobre o que o gerador emite — nas quatro
    // combinações de direção × regime.
    it('e a regra fica MUDA sobre o bloco A que o gerador produz hoje', () => {
        for (const direcao of ['entrada', 'saida']) {
            for (const regimeApuracao of ['1', '2']) {
                for (const itens of [[], cstDoFornecedor]) {
                    const linhas = buildBlocoA({ ...notaServico(direcao, itens), regimeApuracao }) as string[];
                    const p = montaBlocoA(linhas.map((l) => l.replace(/\r?\n$/, '')).slice(2, -1));
                    expect(cstDirecao(aplicarRegrasContribuicoes(p))).toEqual([]);
                }
            }
        }
    });
});
