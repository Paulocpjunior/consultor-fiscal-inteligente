// ============================================================================
// sefaz-backend/reaplicar-prazos.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 📅 REAPLICAR O PRAZO DO CATÁLOGO NUMA TAREFA JÁ CRIADA.
//
// 22/09, Paulo, AFFITTARE 08/2026: a DCTFWeb passou para o último dia útil e
// o card continuava "EFD_CONTRIB — ATRASADA · 3 atrasada(s)". A tarefa guarda
// o vencimento do DIA EM QUE FOI CRIADA; o catálogo mudou depois e a tarefa
// não. Corrigir a regra sem reaplicar é consertar o molde e deixar a peça
// torta na prateleira.
//
// O que se reaplica e o que NÃO:
//   · só tarefa ABERTA (a concluída/cancelada fica com a data em que foi
//     cobrada — mudar histórico é reescrever o que aconteceu);
//   · só tarefa AUTOMÁTICA (a manual tem a data que a pessoa escolheu);
//   · só quando o catálogo TEM data para a obrigação (sem data → não se mexe;
//     ausência não vira chute) e ela é DIFERENTE da gravada.
// ============================================================================

/** 'AAAA-MM-DD' de um Timestamp do Firestore, Date, ISO ou {seconds}. Ilegível = ''. */
export function diaIsoDeVencimento(v) {
    if (v == null || v === '') return '';
    if (typeof v?.toDate === 'function') return diaIsoDeVencimento(v.toDate());
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : local(v);
    if (typeof v === 'object' && Number.isFinite(Number(v.seconds))) return local(new Date(Number(v.seconds) * 1000));
    if (typeof v === 'string') {
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    }
    return '';
}

function local(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * O que fazer com UMA tarefa diante da regra atual do catálogo.
 *
 * @param {object} p
 * @param {object} p.tarefa  doc de `tarefas`
 * @param {object|null} p.regra  a obrigação do mês do cliente (com `vencimento`), ou null
 * @returns {{acao:'alterar'|'igual'|'fechada'|'manual'|'sem-regra'|'sem-data', de:string, para:string}}
 */
export function decidirReaplicacao({ tarefa, regra }) {
    const de = diaIsoDeVencimento(tarefa?.vencimento);
    const st = String(tarefa?.status || '');
    if (st === 'concluida' || st === 'cancelada') return { acao: 'fechada', de, para: de };
    if (String(tarefa?.origem || 'automatica') !== 'automatica') return { acao: 'manual', de, para: de };
    if (!regra) return { acao: 'sem-regra', de, para: de };
    const para = diaIsoDeVencimento(regra.vencimento);
    if (!para) return { acao: 'sem-data', de, para: de };
    if (para === de) return { acao: 'igual', de, para };
    return { acao: 'alterar', de, para };
}
