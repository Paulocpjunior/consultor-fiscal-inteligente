// ============================================================================
// sefaz-backend/escopo-cfi.js  (PURO — testável)
//
// Quem é "do CFI" para a auditoria do dono.
//
// O Firestore é UM só para os apps irmãos do escritório (SP Connect, DP/Folha,
// Contábil, Financeiro…): `users` é o cadastro central de TODOS os módulos, e
// trilhas como `whatsapp_envios` e `reinf_gateway_lotes` recebem gravação de
// outro app pelo túnel. Sem este recorte, a auditoria do CFI somava o
// atendente da Recepção e o RH junto com o fiscal (Paulo, 22/09: "aqui é
// somente sobre o CFI").
//
// A régua, dita:
//   · colaborador do CFI = departamento `fiscal` no cadastro central, OU
//     role admin, OU carteira de empresas vinculada (carteira é conceito do
//     CFI);
//   · evento com `projetoOrigem` de outro app fica de fora, seja de quem for;
//   · autor conhecido que NÃO é do CFI fica de fora, com o motivo NOMEADO
//     (departamento X / sem departamento) — para o admin vincular, se a
//     pessoa atua no Fiscal;
//   · autor desconhecido (não está em `users`) em trilha COMPARTILHADA com
//     app irmão fica de fora; em trilha EXCLUSIVA do CFI fica dentro
//     (ex-colaborador com o doc apagado ainda é ato do CFI);
//   · sem autor e "sistema" ficam dentro (a trilha é do CFI; o balde já é
//     contado à parte).
//
// Nada some em silêncio: o que sai vai contado por autor, com motivo, na
// ressalva e em `foraDoEscopo` — lista cortada diz "e mais N".
// ============================================================================

export const DEPARTAMENTO_CFI = 'fiscal';

/** Marcadores de `projetoOrigem` que são o próprio CFI. Ausente também é CFI. */
export const PROJETOS_CFI = new Set(['cfi', 'consultorfiscalapp']);

const AUTORES_DE_SISTEMA = new Set(['sistema', 'system', 'envio-imposto', 'cron', 'auto', 'automatico', 'automático']);

const texto = (v) => (v == null ? '' : String(v).trim());

/** Um doc de `users` é do CFI? Devolve {ehCfi, motivo}. */
export function classificarUsuarioCfi(usuario) {
    const u = usuario || {};
    const departamentos = Array.isArray(u.departamentos) ? u.departamentos.map((d) => texto(d).toLowerCase()).filter(Boolean) : [];
    if (departamentos.includes(DEPARTAMENTO_CFI)) return { ehCfi: true, motivo: 'departamento Fiscal' };
    if (texto(u.role).toLowerCase() === 'admin') return { ehCfi: true, motivo: 'admin' };
    if (departamentos.length) {
        return { ehCfi: false, motivo: `departamento ${departamentos.join('/')} — não vinculado ao Consultor Fiscal` };
    }
    return { ehCfi: false, motivo: 'sem departamento Fiscal no cadastro central' };
}

/**
 * Monta o conjunto do CFI a partir de `users` + `carteiras`.
 * @returns {{ emails: Set<string>, uids: Set<string>, porEmail: Map, porUid: Map }}
 */
export function conjuntoCfi({ usuarios = [], vinculos = [] } = {}) {
    const porEmail = new Map();
    const porUid = new Map();
    const uidsComCarteira = new Set((vinculos || []).map((v) => texto(v?.colaboradorUid)).filter(Boolean));
    for (const u of usuarios || []) {
        if (!u) continue;
        const uid = texto(u.id) || texto(u.uid);
        const email = texto(u.email).toLowerCase();
        let c = classificarUsuarioCfi(u);
        if (!c.ehCfi && uid && uidsComCarteira.has(uid)) c = { ehCfi: true, motivo: 'carteira de empresas vinculada' };
        if (uid) porUid.set(uid, c);
        if (email) porEmail.set(email, c);
    }
    const emails = new Set([...porEmail.entries()].filter(([, c]) => c.ehCfi).map(([e]) => e));
    const uids = new Set([...porUid.entries()].filter(([, c]) => c.ehCfi).map(([u]) => u));
    return { emails, uids, porEmail, porUid };
}

/**
 * Um evento/ato está no escopo do CFI?
 * @param {{quem?: string|null, projetoOrigem?: string|null}} ev
 * @param {ReturnType<typeof conjuntoCfi>} conjunto
 * @param {{compartilhada?: boolean}} [trilha]  trilha gravada também por app irmão?
 * @returns {{ dentro: boolean, motivo: string|null }}
 */
export function classificarEscopoCfi(ev, conjunto, trilha = {}) {
    const projeto = texto(ev?.projetoOrigem).toLowerCase();
    if (projeto && !PROJETOS_CFI.has(projeto)) {
        return { dentro: false, motivo: `gravado por outro app (projeto de origem "${projeto}")` };
    }
    const quem = texto(ev?.quem);
    if (!quem) return { dentro: true, motivo: null };
    const baixo = quem.toLowerCase();
    if (AUTORES_DE_SISTEMA.has(baixo)) return { dentro: true, motivo: null };

    const c = conjunto?.porEmail?.get(baixo) || conjunto?.porUid?.get(quem) || null;
    if (c) return c.ehCfi ? { dentro: true, motivo: null } : { dentro: false, motivo: c.motivo };

    if (trilha?.compartilhada) {
        return { dentro: false, motivo: 'não está no cadastro de usuários do CFI (trilha compartilhada com app irmão)' };
    }
    return { dentro: true, motivo: null };
}

/**
 * Separa a lista em dentro/fora e resume o que saiu, por autor, com motivo.
 * `trilhaDe(ev)` devolve a trilha/tipo do evento (para saber se é compartilhada).
 */
export function filtrarEscopoCfi(eventos = [], conjunto, trilhaDe = () => ({})) {
    const dentro = [];
    const porAutor = new Map();
    let fora = 0;
    for (const ev of eventos) {
        const c = classificarEscopoCfi(ev, conjunto, trilhaDe(ev) || {});
        if (c.dentro) { dentro.push(ev); continue; }
        fora++;
        const autor = texto(ev?.quem).toLowerCase() || '(sem autor)';
        const atual = porAutor.get(autor) || { quem: autor, quantidade: 0, motivo: c.motivo };
        atual.quantidade++;
        porAutor.set(autor, atual);
    }
    const autores = [...porAutor.values()].sort((a, b) => b.quantidade - a.quantidade || a.quem.localeCompare(b.quem));
    return { dentro, foraDoEscopo: { eventos: fora, autores } };
}

/** A ressalva que diz o recorte — e o que ficou de fora, nomeado. */
export function ressalvaEscopoCfi(foraDoEscopo, { maxNomes = 8, rotuloEvento = 'evento' } = {}) {
    const base = 'Escopo: SOMENTE o Consultor Fiscal — colaborador com departamento Fiscal, admin ou carteira vinculada; '
        + 'registros de outros apps do escritório (SP Connect, DP/Folha, Contábil, Financeiro) ficam de fora.';
    const f = foraDoEscopo || { eventos: 0, autores: [] };
    if (!f.eventos) return base;
    const nomes = (f.autores || []).slice(0, maxNomes)
        .map((a) => `${a.quem} (${a.quantidade}: ${a.motivo})`);
    const resto = (f.autores || []).length - nomes.length;
    return `${base} Ficaram de fora ${f.eventos} ${rotuloEvento}(s) de ${(f.autores || []).length} autor(es): ${nomes.join('; ')}`
        + `${resto > 0 ? `; e mais ${resto}` : ''}. Se alguém aí atua no Fiscal, vincule o departamento em Gerenciar Usuários.`;
}
