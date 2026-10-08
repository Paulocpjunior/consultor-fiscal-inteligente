/**
 * 🧾 O VALOR DA GUIA ANEXADA CONFERE COM A APURAÇÃO? (08/10)
 *
 * Paulo, depois do caso REALITY (e-mail de "ISS retido R$ 1.290,33" calculado
 * sobre notas lidas ao contrário): o corpo do e-mail sai da APURAÇÃO, e o PDF
 * anexado é outra fonte — nada conferia uma contra a outra. *"Sim, faz a
 * leitura do valor do PDF da guia"*.
 *
 * ⚠️ LEIAUTE NÃO SE CHUTA: cada prefeitura imprime a guia de um jeito, e não
 * há modelo conferido de cada uma. Por isso a pergunta é a mais simples que
 * se pode fazer a QUALQUER guia: **o valor apurado aparece impresso nela?**
 *   · aparece → confere;
 *   · o PDF tem valores legíveis e o apurado não está entre eles → DIVERGE
 *     (trava o envio e lista o que o PDF traz);
 *   · o PDF não tem texto (imagem escaneada) ou não traz nenhum valor
 *     legível → não dá para conferir, e isso é DITO (não trava, não aprova).
 */

export type ConferenciaValorGuia =
    | { situacao: 'confere'; valor: number }
    | { situacao: 'diverge'; valor: number; valoresNoPdf: number[] }
    | { situacao: 'ilegivel'; motivo: string };

/** Valores em formato brasileiro (1.290,33 · 17,86) presentes no texto, sem repetição. */
export function valoresMonetariosDoTexto(texto: string): number[] {
    const vistos = new Set<number>();
    const re = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?![\d,])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(texto || '')))) {
        const centavos = Number(m[1]!.replace(/\./g, '')) * 100 + Number(m[2]);
        if (Number.isFinite(centavos)) vistos.add(centavos);
    }
    return [...vistos].sort((a, b) => b - a).map((c) => c / 100);
}

/**
 * @param paginas  texto de cada página do PDF
 * @param valorEsperado  o valor que vai no e-mail (apuração)
 * @param opts.textoInsuficiente  o extrator não achou texto (PDF imagem)
 */
export function conferirValorNaGuia(
    paginas: string[],
    valorEsperado: number,
    opts: { textoInsuficiente?: boolean } = {},
): ConferenciaValorGuia {
    if (opts.textoInsuficiente) {
        return { situacao: 'ilegivel', motivo: 'o PDF não tem texto legível (parece imagem escaneada)' };
    }
    const valores = valoresMonetariosDoTexto((paginas || []).join('\n'));
    if (!valores.length) {
        return { situacao: 'ilegivel', motivo: 'não achei nenhum valor em reais no texto do PDF' };
    }
    const esperado = Math.round(Number(valorEsperado) * 100);
    if (valores.some((v) => Math.round(v * 100) === esperado)) return { situacao: 'confere', valor: esperado / 100 };
    return { situacao: 'diverge', valor: esperado / 100, valoresNoPdf: valores.slice(0, 6) };
}
