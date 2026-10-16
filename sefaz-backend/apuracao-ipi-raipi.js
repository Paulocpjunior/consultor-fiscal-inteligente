// ============================================================================
// sefaz-backend/apuracao-ipi-raipi.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🏭 LIVRO DE APURAÇÃO DO IPI (modelo 8) — o relatório (16/10).
//
// Paulo, com o modelo do e-Fiscal (PWR · 09/2026): "Apuração de IPI - Mensal"
// com ENTRADAS e SAÍDAS por CFOP (Valores Contábeis · Base de Cálculo ·
// Imposto Creditado/Debitado · Isentas/Não tributadas · Outras), subtotal por
// família de CFOP (1.000, 2.000, 3.000 / 5.000, 6.000, 7.000) e total, e o
// DEMONSTRATIVO AUXILIAR (001 a 012: débito, crédito, saldo credor anterior,
// saldo devedor ou credor a transportar).
//
// ⚠️ ESTE MÓDULO NÃO APURA NADA. Ele só distribui nas colunas do livro o que
// o dono (`apurarIpi`, em sped-fiscal-blocoE.js) já apurou para o E510/E520
// do SPED: linhas por CFOP = os E510 (somados os CST do mesmo CFOP), e o
// demonstrativo = o E520. Número diferente aqui e no arquivo seria o
// relatório divergindo do que a Receita recebe.
//
// A distribuição nas colunas (Convênio SINIEF s/nº 1970, livros modelos 1 e
// 2 — colunas do IPI), pela CST do IPI do próprio E510:
//  · com imposto (VL_IPI > 0): Base de Cálculo e Imposto; o que o valor
//    contábil tem além da base e do imposto vai em Outras;
//  · sem imposto e CST isenta / não tributada / imune / alíquota zero
//    (01, 02, 03, 04 · 51, 52, 53, 54): Isentas/Não tributadas;
//  · sem imposto nas demais (suspensão, outras, uso e consumo sem crédito):
//    Outras.
// ============================================================================

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** CST do IPI que vão em "Isentas/Não tributadas" (entrada e saída). */
export const CST_IPI_ISENTAS_NT = Object.freeze(['01', '02', '03', '04', '51', '52', '53', '54']);

export const FAMILIAS_CFOP_IPI = Object.freeze({
    1: '1.000 - Entradas ou Aquisições de Serviços do Estado',
    2: '2.000 - Entradas ou Aquisições de Serviços de Outros Estados',
    3: '3.000 - Entradas ou Aquisições de Serviços do Exterior',
    5: '5.000 - Saídas ou Prestações de Serviços para o Estado',
    6: '6.000 - Saídas ou Prestações de Serviços para Outros Estados',
    7: '7.000 - Saídas ou Prestações de Serviços para o Exterior',
});

/** As colunas do livro para UM grupo do E510 ({cfop, cst, vlCont, vlBc, vlIpi}). */
export function colunasDoGrupoIpi(g) {
    const vlCont = r2(g.vlCont);
    if (Number(g.vlIpi) > 0) {
        const bc = r2(g.vlBc);
        const imposto = r2(g.vlIpi);
        return { vlCont, bc, imposto, isentas: 0, outras: Math.max(0, r2(vlCont - bc - imposto)) };
    }
    if (CST_IPI_ISENTAS_NT.includes(String(g.cst))) return { vlCont, bc: 0, imposto: 0, isentas: vlCont, outras: 0 };
    return { vlCont, bc: 0, imposto: 0, isentas: 0, outras: vlCont };
}

const zeros = () => ({ vlCont: 0, bc: 0, imposto: 0, isentas: 0, outras: 0 });
const somar = (a, b) => {
    for (const k of Object.keys(a)) a[k] = r2(a[k] + b[k]);
    return a;
};

/** Um lado do livro (entradas: CFOP 1/2/3; saídas: 5/6/7), por família e CFOP. */
function ladoDoLivro(grupos, digitos) {
    const porCfop = new Map();
    for (const g of grupos) {
        const cfop = String(g.cfop || '');
        if (!digitos.includes(Number(cfop[0]))) continue;
        porCfop.set(cfop, somar(porCfop.get(cfop) || zeros(), colunasDoGrupoIpi(g)));
    }
    const familias = [];
    const total = zeros();
    for (const d of digitos) {
        const linhas = [...porCfop.entries()]
            .filter(([c]) => Number(c[0]) === d)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([cfop, v]) => ({ cfop: `${cfop[0]}.${cfop.slice(1)}`, ...v }));
        if (!linhas.length) continue;
        const subtotal = linhas.reduce((acc, l) => somar(acc, l), zeros());
        somar(total, subtotal);
        familias.push({ titulo: FAMILIAS_CFOP_IPI[d], linhas, subtotal });
    }
    return { familias, total };
}

/**
 * O livro inteiro a partir da apuração do dono.
 *
 * @param {ReturnType<import('./sped-fiscal-blocoE.js').apurarIpi>} ap
 */
export function montarRaipi(ap) {
    const grupos = ap?.e510?.grupos || [];
    const entradas = ladoDoLivro(grupos, [1, 2, 3]);
    const saidas = ladoDoLivro(grupos, [5, 6, 7]);
    const deb = r2(ap?.vlDeb || 0);
    const cred = r2(ap?.vlCred || 0);
    const sdAnt = r2(ap?.vlSdAnt || 0);
    const demonstrativo = [
        { codigo: '001', secao: 'Débito do Imposto', historico: 'Por saídas com débito do imposto', soma: deb },
        { codigo: '002', historico: 'Outros débitos', soma: 0 },
        { codigo: '003', historico: 'Estornos de crédito', soma: 0 },
        { codigo: '004', historico: 'Total (001+002+003)', soma: deb },
        { codigo: '005', secao: 'Crédito do Imposto', historico: 'Por entradas com crédito do imposto', soma: cred },
        { codigo: '006', historico: 'Outros créditos', soma: 0 },
        { codigo: '007', historico: 'Estornos de débito', soma: 0 },
        { codigo: '008', historico: 'Subtotal (005+006+007)', soma: cred },
        { codigo: '009', historico: 'Saldo credor do período anterior', soma: sdAnt },
        { codigo: '010', historico: 'Total (008+009)', soma: r2(cred + sdAnt) },
        { codigo: '011', secao: 'Apuração de Saldos', historico: 'Saldo devedor (débito − crédito)', soma: r2(ap?.vlSdIpi || 0) },
        { codigo: '012', historico: 'Saldo credor (crédito − débito) a transportar para o próximo período', soma: r2(ap?.vlScIpi || 0) },
    ];
    const avisos = [...(ap?.e510?.avisos || [])];
    // O livro e o E520 têm de dizer o mesmo débito e o mesmo crédito: o PVA
    // amarra Σ VL_IPI dos E510 com o E520. Divergência é DITA, nunca acertada.
    if (Math.abs(r2(saidas.total.imposto) - deb) > 0.01) {
        avisos.push(`O imposto debitado nas SAÍDAS por CFOP (${saidas.total.imposto.toFixed(2)}) não fecha com o débito da apuração (${deb.toFixed(2)}) — confira os itens com IPI sem CST.`);
    }
    if (Math.abs(r2(entradas.total.imposto) - cred) > 0.01) {
        avisos.push(`O imposto creditado nas ENTRADAS por CFOP (${entradas.total.imposto.toFixed(2)}) não fecha com o crédito da apuração (${cred.toFixed(2)}) — confira os itens com IPI sem CST.`);
    }
    return {
        entradas, saidas, demonstrativo,
        devedor: r2(ap?.vlSdIpi || 0) > 0,
        impostoARecolher: r2(ap?.vlSdIpi || 0),
        saldoCredorATransportar: r2(ap?.vlScIpi || 0),
        geraNoSped: !!ap?.gera,
        avisos,
    };
}
