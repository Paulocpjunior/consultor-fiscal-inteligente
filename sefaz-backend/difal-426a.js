// ============================================================================
// sefaz-backend/difal-426a.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Antecipação tributária do art. 426-A do RICMS/SP — FASE 2 do DIFAL.
//
// Quando o contribuinte paulista recebe de OUTRO ESTADO mercadoria sujeita a
// ST e o remetente não reteve o imposto, quem recolhe é o destinatário, ANTES
// da entrada em território paulista. Diferente do DIFAL de consumo (que o app
// consolida no mês), esta é INDIVIDUAL POR DOCUMENTO — desenho do Alexandre,
// 03/08/2026.
//
// FÓRMULA (art. 426-A, §2º):
//     IA = VA × (1 + IVA-ST) × ALQ − IC
//   IA  = imposto a recolher por antecipação
//   VA  = valor da aquisição, INCLUINDO frete, seguro, IPI e demais encargos
//         suportados pelo adquirente
//   IVA-ST = índice de valor adicionado setorial — vem da Portaria CAT do
//         segmento da mercadoria. NÃO está no XML e NÃO se deduz da nota.
//   ALQ = alíquota interna da mercadoria em SP
//   IC  = imposto cobrado na operação anterior (o ICMS destacado na aquisição)
//
// IVA-ST AJUSTADO: quando a alíquota interestadual é menor que a interna (o
// caso normal numa compra de fora), a Portaria manda usar o IVA ajustado:
//     IVA-ST ajustado = [(1 + IVA-ST) × (1 − ALQ_inter) / (1 − ALQ_intra)] − 1
// O app calcula o ajustado a partir do IVA original informado, mas aceita o
// ajustado direto (a Portaria publica os dois) — quem informa manda.
//
// REGRA INEGOCIÁVEL: sem IVA-ST informado NÃO HÁ CONTA. O documento fica
// PENDENTE e fora do total — nunca sai zero como se não houvesse imposto.
// Índice de Portaria não se adivinha (mesma regra do código de tributo).
// ============================================================================

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * VA — valor da aquisição do §2º: produtos − descontos + frete + seguro +
 * outras despesas + IPI. Usa os TOTAIS da nota quando existem; sem eles, soma
 * os itens (nota antiga capturada sem bloco de totais).
 */
export function valorAquisicao(doc) {
    const t = doc?.totais || {};
    const temTotais = ['vProd', 'vFrete', 'vSeg', 'vOutro', 'vIPI', 'vDesc']
        .some((k) => t[k] !== undefined && t[k] !== null);

    if (temTotais) {
        return r2(
            num(t.vProd) - num(t.vDesc)
            + num(t.vFrete) + num(t.vSeg) + num(t.vOutro) + num(t.vIPI),
        );
    }

    let total = 0;
    for (const it of doc?.itens || []) {
        total += num(it?.vProd) - num(it?.vDesc)
            + num(it?.vFrete) + num(it?.vSeg) + num(it?.vOutro) + num(it?.vIPI);
    }
    return r2(total);
}

/** IC — ICMS destacado na aquisição (crédito que abate a antecipação). */
export function impostoCobradoAnterior(doc) {
    const t = doc?.totais || {};
    if (t.vICMS !== undefined && t.vICMS !== null) return r2(num(t.vICMS));
    return r2((doc?.itens || []).reduce((s, i) => s + num(i?.vICMS), 0));
}

/**
 * IVA-ST ajustado pela diferença entre a alíquota interestadual e a interna.
 * Alíquota interestadual >= interna (caso raro) não ajusta — a Portaria só
 * manda ajustar pra CIMA.
 */
export function ivaStAjustado(ivaStOriginal, aliqInter, aliqIntra) {
    const iva = num(ivaStOriginal);
    const inter = num(aliqInter);
    const intra = num(aliqIntra);
    if (iva <= 0 || intra <= 0 || intra <= inter) return r2(iva);
    const ajustado = ((1 + iva / 100) * (1 - inter / 100) / (1 - intra / 100) - 1) * 100;
    // 2 casas — é como a Portaria CAT publica (ex.: 71,78%).
    return r2(ajustado);
}

/**
 * Calcula a antecipação de UM documento.
 *
 * @param {object} doc               documento fiscal capturado
 * @param {object} p
 * @param {number} p.ivaSt           IVA-ST da Portaria CAT (%), informado
 * @param {boolean} [p.ivaJaAjustado] o IVA informado já é o ajustado
 * @param {number} p.aliqInterna     alíquota interna em SP (%)
 * @param {number} p.aliqInterestadual alíquota interestadual da operação (%)
 */
export function calcularAntecipacao426A(doc, {
    ivaSt, ivaJaAjustado = false, aliqInterna, aliqInterestadual,
} = {}) {
    const va = valorAquisicao(doc);
    const ic = impostoCobradoAnterior(doc);
    const intra = num(aliqInterna);
    const inter = num(aliqInterestadual);
    const ivaInformado = num(ivaSt);

    if (ivaInformado <= 0) {
        return {
            calculavel: false,
            motivo: 'IVA-ST não informado — o índice vem da Portaria CAT do segmento da '
                + 'mercadoria e não está na nota. Informe para calcular a antecipação.',
            va, ic, aliqInterna: intra, aliqInterestadual: inter,
            ivaSt: 0, ivaAplicado: 0, baseSt: 0, antecipacao: 0,
        };
    }
    if (intra <= 0) {
        return {
            calculavel: false,
            motivo: 'Alíquota interna não informada — sem ela não há como aplicar a fórmula do 426-A.',
            va, ic, aliqInterna: intra, aliqInterestadual: inter,
            ivaSt: ivaInformado, ivaAplicado: 0, baseSt: 0, antecipacao: 0,
        };
    }

    const ivaAplicado = ivaJaAjustado
        ? r2(ivaInformado)
        : ivaStAjustado(ivaInformado, inter, intra);

    const baseSt = r2(va * (1 + ivaAplicado / 100));
    // Clamp em 0: crédito maior que o imposto da base não vira "imposto negativo".
    const antecipacao = r2(Math.max(0, baseSt * intra / 100 - ic));

    return {
        calculavel: true,
        motivo: null,
        va, ic,
        aliqInterna: intra,
        aliqInterestadual: inter,
        ivaSt: ivaInformado,
        ivaAplicado,
        ivaFoiAjustado: !ivaJaAjustado && ivaAplicado !== r2(ivaInformado),
        baseSt,
        antecipacao,
    };
}

/**
 * Apura a antecipação de um LOTE de documentos (os que a fase 1 separou como
 * "com ST"). Cada documento tem sua guia própria — o total aqui é só para a
 * tela saber o tamanho do mês, NUNCA para gerar uma guia só.
 *
 * @param {Array} documentos  linhas com { chave, doc, ... } vindas da fase 1
 * @param {object} parametrosPorChave  { [chave]: { ivaSt, ivaJaAjustado, aliqInterna } }
 * @param {number} aliqInternaPadrao
 */
export function apurarAntecipacoes426A(documentos, parametrosPorChave = {}, aliqInternaPadrao = 18) {
    const calculadas = [];
    const pendentes = [];

    for (const item of documentos || []) {
        const chave = item?.chave;
        const p = parametrosPorChave[chave] || {};
        const r = calcularAntecipacao426A(item?.doc || item, {
            ivaSt: p.ivaSt,
            ivaJaAjustado: !!p.ivaJaAjustado,
            aliqInterna: num(p.aliqInterna) > 0 ? p.aliqInterna : aliqInternaPadrao,
            aliqInterestadual: item?.aliqInterestadual ?? p.aliqInterestadual,
        });

        const linha = {
            chave,
            numero: item?.numero || '—',
            dhEmi: item?.dhEmi || null,
            fornecedor: item?.fornecedor || '—',
            ufOrigem: item?.ufOrigem || '—',
            ...r,
        };
        if (r.calculavel) calculadas.push(linha);
        else pendentes.push(linha);
    }

    return {
        calculadas,
        pendentes,
        totalAntecipacao: r2(calculadas.reduce((s, l) => s + l.antecipacao, 0)),
        // Farol honesto: o total só significa alguma coisa junto com o que
        // ficou de fora. Documento pendente NÃO é documento sem imposto.
        resumo: {
            documentos: (documentos || []).length,
            calculados: calculadas.length,
            pendentes: pendentes.length,
        },
        ressalvas: [
            'Uma guia POR DOCUMENTO: a antecipação do 426-A não se consolida no mês. O total abaixo é só o tamanho do mês.',
            'O IVA-ST vem da Portaria CAT do segmento da mercadoria — o app não deduz da nota. Documento sem IVA fica PENDENTE e fora do total.',
            'VA inclui frete, seguro, IPI e demais encargos do adquirente (art. 426-A §2º); IC é o ICMS destacado na aquisição.',
            'Mercadoria com preço final fixado (pauta/PMC) usa a base do §3º, não o IVA-ST — confira o segmento antes de recolher.',
        ],
    };
}

/**
 * Antecipação do 426-A POR ITEM, agregada por documento (a guia é por
 * documento, mas a CONTA é por item).
 *
 * Paulo, 04/08: "não pode aglutinar". Uma nota com dois NCMs pode precisar de
 * dois IVA-ST diferentes — o índice é do SEGMENTO da mercadoria, não da nota.
 * Somar tudo com um IVA só produz um número que não corresponde a documento
 * nenhum, e o erro só aparece na fiscalização.
 *
 * @param {Array}  linhasComSt  saída do `antecipacaoIndividual` (cabeçalho +
 *                              `itens` já filtrados como COM ST)
 * @param {object} ivaPorItem   { "CHAVE|NITEM": { ivaSt, ivaJaAjustado, aliqInterna } }
 * @param {number} aliqInternaPadrao
 */
export function apurarAntecipacoes426APorItem(linhasComSt, ivaPorItem = {}, aliqInternaPadrao = 18) {
    const documentos = [];
    let totalCalculado = 0;
    let itensCalculados = 0;
    let itensPendentes = 0;

    for (const nota of linhasComSt || []) {
        const itens = [];
        let somaDoc = 0;
        let pendentesDoc = 0;

        for (const it of nota?.itens || []) {
            const p = ivaPorItem[`${nota.chave}|${it.nItem}`] || {};
            const aliqInterna = num(p.aliqInterna) > 0 ? p.aliqInterna : num(nota.aliqInterna) || aliqInternaPadrao;
            const aliqInter = num(it.aliqIcms) > 0
                ? num(it.aliqIcms)
                : aliqInterestadualDerivada(it.orig, nota.ufOrigem);

            const r = calcularAntecipacao426A(
                {
                    totais: {
                        vProd: it.valorAquisicao, vDesc: 0, vFrete: 0,
                        vSeg: 0, vOutro: 0, vIPI: 0, vICMS: it.icmsPago,
                    },
                },
                {
                    ivaSt: p.ivaSt,
                    ivaJaAjustado: !!p.ivaJaAjustado,
                    aliqInterna,
                    aliqInterestadual: aliqInter,
                },
            );

            itens.push({
                nItem: it.nItem, cProd: it.cProd, xProd: it.xProd, ncm: it.ncm,
                cfop: it.cfop, cst: it.cst,
                encargosRateados: !!it.encargosRateados,
                ...r,
            });

            if (r.calculavel) { somaDoc = r2(somaDoc + r.antecipacao); itensCalculados++; }
            else { pendentesDoc++; itensPendentes++; }
        }

        const completo = pendentesDoc === 0 && itens.length > 0;
        documentos.push({
            chave: nota.chave,
            numero: nota.numero,
            dhEmi: nota.dhEmi,
            fornecedor: nota.fornecedor,
            ufOrigem: nota.ufOrigem,
            notaMista: !!nota.notaMista,
            itens,
            itensPendentes: pendentesDoc,
            // GUIA só sai com o documento INTEIRO calculado: recolher a
            // antecipação de 2 de 3 itens é recolher a menos, e o extrato
            // não denuncia. Parcial fica sinalizado e fora do total.
            guiaLiberada: completo,
            antecipacaoDocumento: somaDoc,
        });
        if (completo) totalCalculado = r2(totalCalculado + somaDoc);
    }

    return {
        documentos,
        totalAntecipacao: totalCalculado,
        resumo: {
            documentos: documentos.length,
            documentosCompletos: documentos.filter((d) => d.guiaLiberada).length,
            itensCalculados,
            itensPendentes,
        },
        ressalvas: [
            'A conta é POR ITEM: o IVA-ST vem da Portaria CAT do SEGMENTO (NCM), e uma nota com vários NCMs pode ter IVA-ST diferentes.',
            'A GUIA é por DOCUMENTO e só é liberada com TODOS os itens calculados — documento com item pendente sairia a menor.',
            'Item pendente NÃO é item isento: ele fica fora do total até o IVA-ST ser informado.',
            'VA inclui frete, seguro, IPI e demais encargos do adquirente (art. 426-A §2º). Quando a nota antiga não traz esses valores por item, o rateio é sinalizado na linha.',
            'Mercadoria com preço final fixado (pauta/PMC) usa a base do §3º, não o IVA-ST.',
        ],
    };
}

/** Interestadual derivada quando o item não destaca pICMS. */
function aliqInterestadualDerivada(orig, ufOrigem) {
    if (['1', '2', '3', '8'].includes(String(orig ?? ''))) return 4;
    return ['SP', 'RJ', 'MG', 'RS', 'SC', 'PR'].includes(String(ufOrigem || '').toUpperCase()) ? 12 : 7;
}
