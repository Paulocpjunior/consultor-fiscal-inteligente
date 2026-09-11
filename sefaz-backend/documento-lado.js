// ============================================================================
// sefaz-backend/documento-lado.js  (PURO — testável)
// ----------------------------------------------------------------------------
// A MESMA NF-e É SAÍDA DE UMA EMPRESA E ENTRADA DA OUTRA — e o id do
// documento é a CHAVE, então uma chave só comportava UM dono.
//
// ═══ O CASO QUE FECHOU A RAIZ (Paulo, 11/09, LEGACY × FEDERAÇÃO) ═════════════
//
// *"fui importar o movimento de saída da empresa 360 - Legacy, são notas
// emitidas para Federação, porém no consultor diz que esse XML já está gravado
// em outra empresa (Federação)"*. A Federação capturou as ENTRADAS pela SEFAZ
// (o id é a chave); a LEGACY importou as SAÍDAS pelo navegador e bateu na
// recusa — cinco chaves no print, e são dezenas por mês.
//
// A raiz estava NOMEADA desde 17/08 (KROYA × GOLDLOG): *"a identidade do
// documento ainda não separa os dois lados"*. O contorno era lançar o lado que
// falta pelo ✍️ SEM CHAVE — nota a nota. Com volume isso não é processo (Paulo,
// 16/08: *"eu não vou fazer nada manual"*), e a nota digitada NUNCA recebe o
// evento de cancelamento que a SEFAZ manda pela chave.
//
// ═══ A RÉGUA ════════════════════════════════════════════════════════════════
//
// O primeiro a chegar fica com o id = CHAVE (nada muda para o acervo). O OUTRO
// LADO — a contraparte que também é cliente da casa — grava um documento
// PRÓPRIO, com id derivado da chave + o CNPJ de quem escritura, carimbado
// `ladoDe: { chave, outroLadoCnpj, outroLadoEmpresaId }`. Cada empresa fica com
// o SEU documento, com a SUA direção, no SEU livro.
//
// ⚠️ Só nasce um lado quando as DUAS empresas são PARTES do documento
// (`decidirPosseDocumento` → 'contraparte-legitima'). Dono que não é parte
// continua sendo posse errada; nota de terceiro continua sendo recusada.
//
// ⚠️ O que chega PELA CHAVE (evento de cancelamento, CC-e, manifestação, a
// resposta da reconferência) é FATO DA NOTA, não de um lado — e tem de chegar
// nos DOIS documentos. Quem faz isso é `documento-lado-io.js` (refsDaChave);
// escritor novo por chave passa por lá, senão o lado fica com a nota
// cancelada contando no faturamento.
//
// ⚠️ A FÓRMULA DO ID MORA AQUI (REGUAS_VIGIADAS): quem a montar à mão em outro
// lugar e divergir um caractere faz o mesmo lado existir com dois ids — a
// venda contando duas vezes, sem nenhum validador acusar.
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

const SEPARADOR = '__lado_';

/** A chave de 44 dígitos é legível? */
export function chaveLegivel(chave) {
    const c = soDigitos(chave);
    return c.length === 44 ? c : '';
}

/**
 * O id do documento do OUTRO LADO desta chave, para a empresa que escritura.
 * Devolve '' quando não dá para montar (chave ou CNPJ ilegível) — id chutado
 * seria documento órfão.
 */
export function idDoDocumentoDoLado(chave, cnpjEmpresa) {
    const c = chaveLegivel(chave);
    const e = soDigitos(cnpjEmpresa);
    if (!c || (e.length !== 14 && e.length !== 11)) return '';
    return `${c}${SEPARADOR}${e}`;
}

/** Este id é de um documento de lado (e não a chave nua)? */
export function ehIdDeLado(id) {
    return typeof id === 'string' && id.includes(SEPARADOR);
}

/**
 * A CHAVE a partir de qualquer id de `documentos_fiscais` que a carregue —
 * a chave nua ou um id de lado. Devolve '' se o id não for de documento com
 * chave (NFS-e do portal, nota digitada…).
 */
export function chaveDoIdDeDocumento(id) {
    const s = String(id ?? '');
    const base = s.includes(SEPARADOR) ? s.split(SEPARADOR)[0] : s;
    return chaveLegivel(base);
}

/**
 * O carimbo que vai no documento do lado. `ladoDe.chave` é o campo pelo qual a
 * propagação de eventos acha os lados (índice simples de igualdade).
 */
export function carimboDoLado({ chave, outroLadoCnpj, outroLadoEmpresaId, agoraIso } = {}) {
    const c = chaveLegivel(chave);
    if (!c) return null;
    return {
        chave: c,
        outroLadoCnpj: soDigitos(outroLadoCnpj) || null,
        outroLadoEmpresaId: outroLadoEmpresaId ? String(outroLadoEmpresaId) : null,
        em: agoraIso || new Date().toISOString(),
    };
}

/** O documento é o lado de uma chave que já tem dono? */
export function ehDocumentoDeLado(doc) {
    return !!(doc && doc.ladoDe && chaveLegivel(doc.ladoDe.chave));
}
