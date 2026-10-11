// ============================================================================
// sefaz-backend/dp-dctfweb.js  (núcleo do túnel da DCTFWeb para o Consultor DP)
// ----------------------------------------------------------------------------
// Paulo, 11/10/2026: "a DCTFWeb tem a parte que cabe ao DP". O DP acompanha o
// semáforo dos insumos, emite o DARF (com a declaração em andamento ou ativa) e
// transmite — com as MESMAS travas da tela do CFI (transmitirComRegras), e a
// regra T1-DP: o DP só transmite com os três insumos confirmados.
//
// O token do DP traz só uid/e-mail; o papel e os departamentos vêm do perfil
// do CFI (users), achado pelo e-mail — a fonte única do cadastro central.
// ============================================================================

import { normalizarUsuarioCadastro } from './cadastro-central-departamentos.js';

/** 'AAAA-MM' → { anoPA, mesPA } (números), ou null. */
export function periodoDaCompetencia(competencia) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(competencia || ''));
    return m ? { anoPA: Number(m[1]), mesPA: Number(m[2]) } : null;
}

/**
 * Perfil do CFI para o e-mail do token (users/{uid} com o mesmo e-mail). Mais de
 * um perfil com o mesmo e-mail não escolhe por sorte: volta null com o motivo.
 */
export async function perfilCfiPorEmail(db, email) {
    const alvo = String(email || '').trim().toLowerCase();
    if (!alvo) return { perfil: null, motivo: 'Token sem e-mail.' };
    const achados = new Map();
    for (const valor of new Set([String(email).trim(), alvo])) {
        const snap = await db.collection('users').where('email', '==', valor).limit(3).get();
        for (const d of snap.docs) achados.set(d.id, { id: d.id, ...(d.data() || {}) });
    }
    const perfis = [...achados.values()].map(normalizarUsuarioCadastro).filter(Boolean);
    if (!perfis.length) {
        return { perfil: null, motivo: `Sem cadastro no Consultor Fiscal para ${alvo}: a transmissão confere o departamento pelo cadastro central.` };
    }
    if (perfis.length > 1) {
        return { perfil: null, motivo: `Há ${perfis.length} cadastros no Consultor Fiscal com o e-mail ${alvo}: peça ao admin para deixar um só.` };
    }
    const p = perfis[0];
    return { perfil: { uid: p.uid, email: p.email, role: p.role, departamentos: p.departamentos } };
}

/** O DARF que volta ao DP: sem o bruto do SERPRO; mock nunca passa por guia de verdade. */
export function respostaDarfDp(r, { emAndamento }) {
    if (!r || r.fonte !== 'serpro') {
        return { ok: false, error: `O Consultor Fiscal respondeu em modo ${r?.fonte || 'desconhecido'}, não com o DARF do SERPRO.` };
    }
    if (!r.pdfBase64) {
        const msgs = (r.mensagens || []).map((m) => m?.texto || m?.mensagem || '').filter(Boolean).join(' ');
        return { ok: false, error: `O SERPRO não devolveu o PDF do DARF${msgs ? `: ${msgs}` : '.'}`, mensagens: r.mensagens || [] };
    }
    return {
        ok: true,
        emAndamento: !!emAndamento,
        valor: r.valor ?? null,
        numeroDocumento: r.numeroDocumento || '',
        codigoBarras: r.codigoBarras || '',
        vencimento: r.vencimento || '',
        pdfBase64: r.pdfBase64,
        mensagens: r.mensagens || [],
        fonte: r.fonte,
    };
}
