// ============================================================================
// sefaz-backend/backfill-itens-fiscais.js  (ESM, puro)
// ----------------------------------------------------------------------------
// CAMPO DE ITEM QUE O EXTRATOR APRENDEU DEPOIS — recuperado do XML-FONTE.
//
// O extrator ganha campos com o tempo, e o que foi capturado ANTES fica sem
// eles. Dois buracos nomeados no projeto, os dois travando entrega:
//
//   · `cstIpi`/`cEnqIpi`/`vBcIpi` (11/08) — sem eles o **E510** não sai, e o
//     E510 é o último bloco que trava indústria com IPI no de-para;
//   · `cstPis`/`cstCofins` (12/08) — sem eles a base de crédito de PIS/COFINS
//     devolve `indefinido` ("nota capturada sem o CST — reprocessar o XML").
//
// **E O XML CRU ESTÁ NO CLOUD STORAGE.** Toda captura grava o arquivo e guarda
// o `storagePath`. Então isto é RECUPERAÇÃO DA FONTE — não se pede arquivo ao
// cliente, não se consulta a SEFAZ de novo, e não se digita nada: a mesma régua
// do ♻️ Reler município (12/08).
//
// ═══ POR QUE O PAREAMENTO É O RISCO, E NÃO A LEITURA ════════════════════════
//
// Escrever o CST do item 3 no item 2 produz um arquivo fiscal ACEITO declarando
// outra coisa — o pior desfecho, porque não volta recusa avisando. Por isso o
// par é pelo **`nItem`** (que é a identidade do item dentro da nota) e, quando
// ele não existe dos dois lados, só pelo índice E com as contagens IGUAIS.
// Divergiu, não mescla: devolve o motivo e a nota fica para conferência humana.
// ============================================================================

/**
 * Campos que este backfill recupera.
 *
 * Lista CURTA de propósito: são os que o extrator passou a ler depois, e cada
 * um tem um consumidor que hoje trava sem ele. Campo novo entra aqui junto com
 * quem o consome — nunca "já que estamos aqui".
 */
export const CAMPOS_RECUPERAVEIS = [
    'cstIpi',    // E510 — consolidação por CFOP + CST do IPI
    'cEnqIpi',   // enquadramento legal do IPI
    'vBcIpi',
    'cstPis',    // base de crédito de PIS/COFINS
    'cstCofins',
];

/** Vazio = ausente. `0` e `'0'` NÃO são vazios: zero é resposta. */
function vazio(v) {
    return v === undefined || v === null || v === '';
}

const nItemDe = (i) => {
    const n = String(i?.nItem ?? '').replace(/\D/g, '');
    return n || null;
};

/**
 * Pareia os itens gravados com os do XML.
 *
 * @returns {{ pares: Array<[object, object]>, criterio: 'nItem'|'indice', motivo?: string }}
 */
export function parearItens(gravados = [], doXml = []) {
    const g = Array.isArray(gravados) ? gravados : [];
    const x = Array.isArray(doXml) ? doXml : [];
    if (!g.length || !x.length) {
        return { pares: [], criterio: 'indice', motivo: 'sem itens de um dos lados' };
    }

    // 1) `nItem` é a identidade do item DENTRO da nota — é o par seguro, e
    //    funciona mesmo se a ordem ou a quantidade mudar.
    const porNItem = new Map();
    for (const it of x) {
        const n = nItemDe(it);
        if (n) porNItem.set(n, it);
    }
    const todosTemNItem = g.every((it) => nItemDe(it)) && porNItem.size === x.length;
    if (todosTemNItem) {
        const pares = [];
        for (const it of g) {
            const alvo = porNItem.get(nItemDe(it));
            if (alvo) pares.push([it, alvo]);
        }
        return { pares, criterio: 'nItem' };
    }

    // 2) Sem `nItem`, o índice só vale com as contagens IGUAIS. Contagem
    //    diferente significa que não dá para saber quem é quem — e chutar aqui
    //    grava o CST de um produto em outro.
    if (g.length !== x.length) {
        return {
            pares: [], criterio: 'indice',
            motivo: `itens não conferem (gravados ${g.length} × XML ${x.length}) — sem nItem não dá para parear`,
        };
    }
    return { pares: g.map((it, i) => [it, x[i]]), criterio: 'indice' };
}

/**
 * Mescla os campos recuperáveis do XML nos itens gravados.
 *
 * **NÃO APAGA E NÃO SOBRESCREVE**: preenche só o que está VAZIO. Este backfill
 * recupera AUSÊNCIA; divergência entre o gravado e a fonte é ALERTA (regra de
 * 06/08), e alerta não se resolve por escrita silenciosa.
 *
 * @returns {{ itens: Array, alterados: number, campos: Record<string, number>,
 *             criterio: string, motivo?: string }}
 */
export function mesclarItensRelidos(gravados, doXml, campos = CAMPOS_RECUPERAVEIS) {
    const { pares, criterio, motivo } = parearItens(gravados, doXml);
    if (!pares.length) {
        return { itens: gravados || [], alterados: 0, campos: {}, criterio, motivo };
    }

    const porCampo = {};
    const novos = new Map();
    let alterados = 0;
    for (const [gravado, doFonte] of pares) {
        let mudou = false;
        const copia = { ...gravado };
        for (const campo of campos) {
            if (!vazio(copia[campo])) continue;          // já tem: não toca
            if (vazio(doFonte?.[campo])) continue;        // o XML também não tem
            copia[campo] = doFonte[campo];
            porCampo[campo] = (porCampo[campo] || 0) + 1;
            mudou = true;
        }
        if (mudou) { alterados++; novos.set(gravado, copia); }
    }

    return {
        itens: (gravados || []).map((it) => novos.get(it) || it),
        alterados,
        campos: porCampo,
        criterio,
    };
}
