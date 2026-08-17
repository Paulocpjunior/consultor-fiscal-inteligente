// ============================================================================
// sefaz-backend/auditoria-permissoes.js  (ESM — I/O curto)
// ----------------------------------------------------------------------------
// TRILHA DE MUDANÇA DE PODER. Até 16/08 o app guardava só o ESTADO das
// permissões (users.role/departamentos/filasAtendimento/papelAtendimento) e
// NENHUM histórico: dava pra virar gestor, fazer o que quisesse e voltar,
// sem deixar rastro. Quem responde "quem deu esse acesso, e quando?" é esta
// coleção.
//
// REGRAS:
// - Gravação é BEST-EFFORT e NUNCA derruba a ação: falhar em anotar não
//   pode impedir o admin de corrigir um acesso (o alarme não vale mais que
//   a operação) — mas a falha vai pro log.
// - Guarda o ANTES e o DEPOIS. "Mudou o papel" sem o valor anterior não
//   responde a pergunta que a auditoria existe pra responder.
// - Só grava quando REALMENTE mudou: registro de "trocou X por X" enche a
//   trilha de ruído e esconde a mudança que importa.
// ============================================================================

import admin from 'firebase-admin';

export const COLECAO_PERMISSOES = 'auditoria_permissoes';

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const mesmoValor = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Anota a mudança de permissão. Devolve true se gravou (o chamador NÃO
 * precisa esperar nem tratar — é rastro, não parte da transação).
 */
export async function registrarMudancaPermissao({ alvoUid, alvoEmail, campo, de, para, por, deps = {} }) {
    if (mesmoValor(de, para)) return false;   // nada mudou = nada a anotar
    try {
        const db = deps.db || getDb();
        await db.collection(COLECAO_PERMISSOES).add({
            alvoUid: alvoUid || null,
            alvoEmail: alvoEmail || null,
            campo,
            de: de ?? null,
            para: para ?? null,
            por: por || null,
            em: new Date().toISOString(),
        });
        return true;
    } catch (e) {
        console.warn('[auditoria-permissoes] mudança não anotada:', e.message);
        return false;
    }
}
