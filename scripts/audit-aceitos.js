// ============================================================================
// scripts/audit-aceitos.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🔐 ADVISORY ACEITO, COM NOME, MOTIVO E PRAZO (02/10).
//
// O node-forge ganhou um advisory high (GHSA-86w9-cpqp-85rv) SEM versão
// corrigida, e a auditoria do deploy travou TODA entrega — o SPED de
// encerramento da Vinatex, inclusive. O `[skip-audit]` libera um commit e cega
// a auditoria INTEIRA naquele deploy; o próximo trava de novo.
//
// Esta régua é o meio-termo honesto (Paulo, 02/10: *"sim, libera, e precisamos
// de uma solução urgente"*): a auditoria continua rodando em TUDO, e só deixa
// passar o advisory que está em `audit-aceitos.json` com
//   · o GHSA exato e o pacote (nunca "todos do pacote");
//   · quem aprovou e por quê;
//   · a trava que mantém o motivo verdadeiro;
//   · uma data `ate` — vencida, o advisory volta a BLOQUEAR, dito.
// Advisory NOVO no mesmo pacote bloqueia normalmente.
// ============================================================================

const GRAVES = new Set(['high', 'critical']);

/** 'GHSA-xxxx-xxxx-xxxx' a partir da URL do advisory (ou '' sem ela). */
export function ghsaDaUrl(url) {
    const m = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(String(url || ''));
    return m ? m[0].toUpperCase() : '';
}

/**
 * @param {object} relatorio  saída de `npm audit --omit=dev --json`
 * @param {Array}  aceitos    conteúdo de audit-aceitos.json
 * @param {string} hojeIso    'AAAA-MM-DD' — injetado (teste não lê relógio)
 * @returns {{bloqueia: Array<{pacote:string, advisory:string, titulo:string, motivo:string}>,
 *            aceitos: Array<{pacote:string, advisory:string, ate:string}>}}
 */
export function avaliarAuditoria(relatorio, aceitos, hojeIso) {
    const lista = Array.isArray(aceitos) ? aceitos : [];
    const bloqueia = [];
    const liberados = [];
    const vistos = new Set();
    for (const [nome, v] of Object.entries(relatorio?.vulnerabilities || {})) {
        for (const via of v?.via || []) {
            // `via` em texto é a dependência que TRAZ o problema — o advisory
            // dela é avaliado na entrada dela, não aqui.
            if (!via || typeof via !== 'object') continue;
            if (!GRAVES.has(String(via.severity || '').toLowerCase())) continue;
            const pacote = String(via.name || nome);
            const advisory = ghsaDaUrl(via.url);
            const chave = `${pacote}|${advisory || via.source}`;
            if (vistos.has(chave)) continue;
            vistos.add(chave);
            const aceito = advisory && lista.find((a) => String(a?.advisory || '').toUpperCase() === advisory
                && String(a?.pacote || '') === pacote);
            if (!aceito) {
                bloqueia.push({ pacote, advisory, titulo: String(via.title || ''), motivo: 'advisory não aceito' });
            } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(aceito.ate || '')) || String(hojeIso) > String(aceito.ate)) {
                bloqueia.push({ pacote, advisory, titulo: String(via.title || ''), motivo: `aceite vencido ou sem data (ate ${aceito.ate || '—'})` });
            } else if (!aceito.aprovadoPor || !aceito.motivo || !aceito.trava) {
                bloqueia.push({ pacote, advisory, titulo: String(via.title || ''), motivo: 'aceite sem aprovadoPor, motivo ou trava' });
            } else {
                liberados.push({ pacote, advisory, ate: String(aceito.ate) });
            }
        }
    }
    return { bloqueia, aceitos: liberados };
}
