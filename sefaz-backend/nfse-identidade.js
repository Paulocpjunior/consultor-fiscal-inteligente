// ============================================================================
// sefaz-backend/nfse-identidade.js  (ESM, puro)
// ----------------------------------------------------------------------------
// A IDENTIDADE DO DOCUMENTO DE NFS-e — num lugar só.
//
// A NFS-e do portal **não tem chave de 44 dígitos** (07/08: ausência de chave
// ali é NATUREZA, não falha de captura), então o app a identifica por
// TOMADOR + PRESTADOR + NÚMERO. Essa fórmula já estava escrita À MÃO em DOIS
// importadores, e a terceira cópia ia nascer no lançamento manual — que é
// exatamente como se cria o defeito que mais custou neste projeto.
//
// E aqui a cópia não seria cosmética: **é a fórmula do id que faz a nota do
// portal cair NO MESMO documento da digitada** e substituí-la. Divergindo um
// caractere, a captura automática criaria um SEGUNDO documento e o mesmo
// serviço entraria duas vezes no livro, no ISS e no faturamento — a mesma
// duplicidade que o art. 136 causou no FUNRURAL.
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Id determinístico da NFS-e por partes + número.
 *
 * ⚠️ A ORDEM É TOMADOR, DEPOIS PRESTADOR — é a que os importadores já gravaram
 * em produção. Inverter aqui "para ficar mais lógico" órfã todo documento que
 * já está no banco.
 */
export function idDocumentoNfseSp({ prestadorCnpj, tomadorCnpj, numero }) {
    const p = soDigitos(prestadorCnpj);
    const t = soDigitos(tomadorCnpj);
    const n = String(numero ?? '').trim();
    if (!n) throw new Error('NFS-e sem número — não há identidade possível.');
    return `nfsesp-${t || 'sem-tomador'}-${p || 'sem-prestador'}-${n}`;
}

/**
 * O ID DO DOCUMENTO DE NFS-e — **a chave nacional VENCE**.
 *
 * 🚨 POR QUE ISTO EXISTE (10/09, importador do portal de Barueri): a NFS-e do
 * padrão nacional TEM chave (50 dígitos), e a captura pelo ADN grava o
 * documento **com a chave como id** (`nfse-nacional-dfe-importer.js`). O CSV
 * do portal do município traz a MESMA chave — e se o importador dele usasse a
 * fórmula por partes, a mesma nota entraria DUAS VEZES: uma pelo ADN e outra
 * pelo município, e o serviço contaria em dobro no livro, no ISS e no
 * faturamento. É a duplicidade do art. 136 com outra roupa.
 *
 * ✅ E o efeito bom é o que fechou o caso das canceladas: importar o CSV do
 * município **cai por cima** do documento que o ADN trouxe — a nota que subiu
 * ativa passa a ficar cancelada, sem ninguém marcar nada à mão.
 *
 * ⚠️ A chave é usada COMO VEIO quando já é só dígitos — é o id que o ADN já
 * gravou em produção, e mudar a forma órfã o acervo (um teste prova isso).
 * Sem chave, cai na fórmula por partes, que é a da NFS-e sem chave.
 */
export function idDocumentoNfse({ chave, prestadorCnpj, tomadorCnpj, numero } = {}) {
    const c = soDigitos(chave);
    if (c.length >= 44) return c;
    return idDocumentoNfseSp({ prestadorCnpj, tomadorCnpj, numero });
}

/**
 * O documento que está no banco é uma NOTA DIGITADA à mão?
 */
export function ehDigitada(existente) {
    return String(existente?.origem || '') === 'digitada';
}

/**
 * Patch que APAGA o carimbo de digitada quando o documento de verdade chega.
 *
 * 🚨 POR QUE ISTO PRECISA EXISTIR: os importadores gravam com
 * `set(doc, { merge: true })`, e merge **não remove campo que o novo objeto
 * não traz**. Sem este patch, a nota capturada do portal ficaria com os dados
 * reais E com `origem: 'digitada'` grudado — o documento passaria a MENTIR
 * sobre a própria procedência, e a tela de procedência (que existe justamente
 * para explicar por que não há XML) diria que aquilo foi lançado à mão.
 *
 * O rastro NÃO se perde: fica dito que ali existiu uma digitada, quem a fez e
 * quando ela foi substituída. Reescrita de dado fiscal sem quem/quando não se
 * reconstrói depois (lição do ↻ Substituir, 14/08).
 *
 * @returns {object} campos a mesclar — `{}` quando não havia digitada.
 */
export function patchSubstituiuDigitada(existente, agoraIso = new Date().toISOString()) {
    if (!ehDigitada(existente)) return {};
    return {
        origem: null,
        digitadaPorEmail: null,
        digitadaEm: null,
        substituiuDigitada: true,
        substituiuDigitadaDe: existente?.digitadaPorEmail || null,
        substituiuDigitadaEm: agoraIso,
    };
}
