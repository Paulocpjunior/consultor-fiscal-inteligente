// ============================================================================
// sefaz-backend/conferencia-chaves.js  (PURO — sem firebase/io, testável)
//
// CONFERÊNCIA POR CHAVES (CFI × SIEG): o colaborador cola qualquer texto
// vindo da SIEG (relatório, CSV, lista) e o app extrai as chaves de 44
// dígitos, dedupe, e compara com o que já está em documentos_fiscais.
// Caso motivador (22/07): EDUARDO GUERRA 07/2026 — SIEG 65 × CFI 45, e
// ninguém sabia QUAIS 20 faltavam.
// ============================================================================

/** Extrai chaves de acesso (44 dígitos) de texto livre. Dedupe preservando
 *  ordem. Ignora sequências numéricas coladas maiores (ex.: 88 dígitos sem
 *  separador não viram 2 chaves — provável lixo de concatenação). */
export function extrairChaves(texto) {
    const out = [];
    const vistas = new Set();
    // \d{44} com lookarounds pra não fatiar números maiores.
    const re = /(?<!\d)(\d{44})(?!\d)/g;
    let m;
    while ((m = re.exec(String(texto || ''))) !== null) {
        const chave = m[1];
        if (vistas.has(chave)) continue;
        vistas.add(chave);
        out.push(chave);
    }
    return out;
}

/** Modelo (posições 20-21) — '55' NFe, '65' NFC-e, '57' CTe... */
export function modeloDaChaveAcesso(chave) {
    const c = String(chave || '');
    return c.length === 44 ? c.substring(20, 22) : null;
}

const isResumoSchema = (sch) => /^res(NFe|NFCe|CTe|MDFe)/.test(String(sch || ''));

/**
 * Classifica cada chave contra o mapa do que existe na base.
 * @param {string[]} chaves
 * @param {Map<string, {schema?:string, tipoDoc?:string, direcao?:string, empresaCnpj?:string}>} presentes
 */
export function classificarChaves(chaves, presentes) {
    const itens = chaves.map((chave) => {
        const doc = presentes.get(chave);
        if (!doc) {
            return { chave, modelo: modeloDaChaveAcesso(chave), status: 'ausente' };
        }
        const resumo = isResumoSchema(doc.schema) || doc.tipoDoc === 'resNFe';
        return {
            chave,
            modelo: modeloDaChaveAcesso(chave),
            status: resumo ? 'presente-resumo' : 'presente-completa',
            direcao: doc.direcao || null,
            empresaCnpj: doc.empresaCnpj || null,
        };
    });
    const resumo = {
        total: itens.length,
        presentesCompletas: itens.filter((i) => i.status === 'presente-completa').length,
        presentesResumo: itens.filter((i) => i.status === 'presente-resumo').length,
        ausentes: itens.filter((i) => i.status === 'ausente').length,
    };
    return { itens, resumo };
}
