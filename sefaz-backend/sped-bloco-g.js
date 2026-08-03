// ============================================================================
// sefaz-backend/sped-bloco-g.js  (ESM, PURO — sem Firestore)
// ----------------------------------------------------------------------------
// Bloco G da EFD ICMS/IPI — CIAP (crédito de ICMS do ativo permanente).
//
// REGRA (LC 87/96 art. 20 §5º): o ICMS pago na compra do bem do ativo não é
// creditado de uma vez — é apropriado em 48 PARCELAS, e cada parcela só entra
// na PROPORÇÃO das saídas tributadas + exportação sobre o total das saídas do
// mês. Mês com muita saída isenta/ST credita menos.
//
// A régua foi conferida contra o CIAP REAL da EXPERTE METAIS (06/2026, recibo
// de 20/07/2026) que o Paulo mandou — os números do relatório do PVA saem
// exatos deste módulo (ver __tests__/spedBlocoG.test.ts):
//   Σ parcelas 527,53 × índice 0,86032111 = 453,85 apropriado.
//
// Registros gerados:
//   G001 — abertura
//   G110 — período do CIAP (saldo inicial, Σ parcelas, saídas, índice, crédito)
//   G125 — movimentação de cada bem/componente (parcela do mês)
//   G990 — encerramento
//
// G110: a ORDEM dos campos está confirmada contra o relatório do PVA (o
// visualizador imprime na mesma sequência). G125 segue o layout do Guia
// Prático (OP, ST, FRT, DIF) — a validação final é no PVA, como todo o resto
// do arquivo.
// ============================================================================

/** Nº de parcelas do CIAP (LC 87/96 art. 20 §5º, inciso I). */
export const PARCELAS_CIAP = 48;

/** Tipos de movimentação aceitos no G125 (Guia Prático, Tabela 4.6.1). */
export const TIPOS_MOVIMENTACAO = {
    SI: 'Saldo inicial de bens imobilizados',
    IM: 'Imobilização de bem individual',
    IA: 'Imobilização em andamento — componente',
    CI: 'Conclusão de imobilização em andamento — bem resultante',
    MC: 'Imobilização oriunda do ativo circulante',
    BA: 'Baixa do bem — fim do período de apropriação',
    AT: 'Alienação ou transferência',
    PE: 'Perecimento, extravio ou deterioração',
    OT: 'Outras saídas do imobilizado',
};

function round2(n) {
    const v = Number(n);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Índice de participação das saídas tributadas + exportação no total.
 * 8 casas decimais (é assim que o PVA imprime: 0,86032111).
 * Sem saída no mês o índice é 0 — não credita (e não divide por zero).
 */
export function indiceParticipacao(tributadasEExportacao, totalSaidas) {
    const total = num(totalSaidas);
    if (total <= 0) return 0;
    const bruto = num(tributadasEExportacao) / total;
    return Math.round(bruto * 1e8) / 1e8;
}

/** Crédito total de ICMS de UM bem (as 4 origens somadas). */
export function creditoTotalDoBem(bem) {
    return round2(
        num(bem?.creditoIcmsProprio) + num(bem?.creditoIcmsSt)
        + num(bem?.creditoIcmsFrete) + num(bem?.creditoIcmsDifal),
    );
}

/**
 * Parcela mensal passível de apropriação = crédito total / 48.
 * Bem já BAIXADO (ou fora da janela de parcelas) não gera parcela.
 */
export function parcelaPassivel(bem) {
    const parcela = Number(bem?.numeroParcela);
    if (!Number.isFinite(parcela) || parcela < 1 || parcela > PARCELAS_CIAP) return 0;
    if (['BA', 'AT', 'PE', 'OT'].includes(String(bem?.tipoMovimentacao || '').toUpperCase())) return 0;
    return round2(creditoTotalDoBem(bem) / PARCELAS_CIAP);
}

/**
 * Classifica as saídas do período para o índice do CIAP.
 *
 * Tributada = saída com ICMS destacado (débito). Exportação (CFOP 7xxx) entra
 * no numerador mesmo sem destaque — é o que a lei manda. Saída isenta, não
 * tributada ou já substituída (ST) fica só no denominador e DERRUBA o índice.
 *
 * Documento cancelado/denegado não entra em nenhum dos dois.
 */
export function classificarSaidasCiap(documentos) {
    let tributadasEExportacao = 0;
    let total = 0;

    for (const doc of Array.isArray(documentos) ? documentos : []) {
        if (String(doc?.direcao) !== 'saida') continue;
        const situacao = String(doc?.situacao || '').toLowerCase();
        if (situacao.includes('cancel') || situacao.includes('deneg')) continue;

        const valor = num(doc?.valores?.total ?? doc?.valorTotal ?? doc?.valores?.valorTotal);
        if (valor <= 0) continue;
        total = round2(total + valor);

        const icms = num(doc?.valores?.icms ?? doc?.valores?.vICMS);
        const cfops = Array.isArray(doc?.cfops) ? doc.cfops : [];
        const exportacao = cfops.some((c) => String(c).trim().startsWith('7'));

        if (icms > 0 || exportacao) tributadasEExportacao = round2(tributadasEExportacao + valor);
    }

    return { tributadasEExportacao, total };
}

/**
 * Apura o CIAP do período.
 *
 * @param {object} p
 * @param {Array} p.bens              bens/componentes do CIAP com a parcela do mês
 * @param {number} p.saldoInicial     saldo de ICMS do CIAP no início do período
 * @param {number} p.saidasTributadas saídas tributadas + exportação
 * @param {number} p.saidasTotais     valor total das saídas
 * @param {number} [p.outrosCreditos] outros créditos de ICMS (G126)
 */
export function apurarCiap({ bens, saldoInicial, saidasTributadas, saidasTotais, outrosCreditos = 0 }) {
    const lista = (Array.isArray(bens) ? bens : []).map((bem) => ({
        ...bem,
        creditoTotal: creditoTotalDoBem(bem),
        valorParcela: parcelaPassivel(bem),
    }));

    const somaParcelas = round2(lista.reduce((s, b) => s + b.valorParcela, 0));
    const indice = indiceParticipacao(saidasTributadas, saidasTotais);
    const creditoApropriado = round2(somaParcelas * indice);

    const avisos = [];
    for (const bem of lista) {
        if (!bem.codigo) avisos.push('Bem sem código de identificação — o G125 exige COD_IND_BEM.');
        if (bem.tipo === 'componente' && !bem.codigoBemPrincipal) {
            avisos.push(`Componente "${bem.codigo || bem.descricao || '?'}" sem bem principal informado.`);
        }
        if (bem.valorParcela === 0 && bem.creditoTotal > 0) {
            avisos.push(`Bem "${bem.codigo || bem.descricao}" não gerou parcela (parcela ${bem.numeroParcela ?? '—'} / movimentação ${bem.tipoMovimentacao || '—'}).`);
        }
    }
    if (num(saidasTotais) <= 0) {
        avisos.push('Sem saídas no período: índice 0 — nenhum crédito do CIAP é apropriado neste mês.');
    }

    return {
        bens: lista,
        saldoInicial: round2(saldoInicial),
        somaParcelas,
        saidasTributadas: round2(saidasTributadas),
        saidasTotais: round2(saidasTotais),
        indice,
        creditoApropriado,
        outrosCreditos: round2(outrosCreditos),
        avisos,
    };
}

// ── Formatação dos registros ────────────────────────────────────────────────

const dec = (n, casas = 2) => {
    const v = Number(n);
    return (Number.isFinite(v) ? v : 0).toFixed(casas).replace('.', ',');
};

/** AAAA-MM-DD (ou Date) → DDMMAAAA, formato de data do SPED. */
function dataSped(valor) {
    if (!valor) return '';
    const s = String(valor);
    // Já no formato do SPED (DDMMAAAA) — vem assim do orquestrador, que usa os
    // mesmos helpers de competência do resto do arquivo.
    if (/^\d{8}$/.test(s)) return s;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}${m[2]}${m[1]}`;
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;
}

/**
 * Monta as linhas do Bloco G. Sem bens no CIAP devolve o bloco VAZIO
 * (G001 com IND_MOV=1), que é o que a maioria das empresas entrega.
 */
export function montarLinhasBlocoG({ apuracao, dtIni, dtFin }) {
    const bens = apuracao?.bens || [];
    if (bens.length === 0) {
        return ['G001|1|', 'G990|2|'];
    }

    const linhas = ['G001|0|'];

    // G110 — ordem conferida contra o relatório do PVA da EXPERTE.
    linhas.push([
        'G110',
        dataSped(dtIni),
        dataSped(dtFin),
        dec(apuracao.saldoInicial),
        dec(apuracao.somaParcelas),
        dec(apuracao.saidasTributadas),
        dec(apuracao.saidasTotais),
        dec(apuracao.indice, 8),
        dec(apuracao.creditoApropriado),
        dec(apuracao.outrosCreditos),
        '',
    ].join('|'));

    for (const bem of bens) {
        // G125 — layout do Guia Prático: OP, ST, FRT, DIF (nessa ordem).
        linhas.push([
            'G125',
            String(bem.codigo || ''),
            dataSped(bem.dataMovimentacao),
            String(bem.tipoMovimentacao || 'SI').toUpperCase(),
            dec(bem.creditoIcmsProprio),
            dec(bem.creditoIcmsSt),
            dec(bem.creditoIcmsFrete),
            dec(bem.creditoIcmsDifal),
            String(bem.numeroParcela ?? ''),
            dec(bem.valorParcela),
            '',
        ].join('|'));
    }

    linhas.push(`G990|${linhas.length + 1}|`);
    return linhas;
}
