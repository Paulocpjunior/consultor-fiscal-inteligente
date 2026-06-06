// ============================================================================
// cert-vencimento-helper.js  (PURO — sem io/firebase, testavel)
//
// Classifica certificados digitais por dias restantes ate o vencimento.
// Quando um cert expira, TUDO para sem aviso: SERPRO, SEFAZ, e-CAC, manifesto.
// Esse helper define UMA UNICA tabela de faixas usada por:
//   - cert-alerta-cron.js (email noturno)
//   - sefaz-backend/cert-vencimento-routes.js (painel admin)
//
// Faixas:
//   expirado  dias <= 0
//   1         dias = 1 dia (vence amanhã)
//   3         dias <= 3
//   7         dias <= 7
//   15        dias <= 15
//   30        dias <= 30
//   null      dias > 30  (sem alerta)
// ============================================================================

/**
 * Classifica dias restantes em faixa de alerta.
 * Faixas: 'expirado' | '1' | '3' | '7' | '15' | '30' | null
 * dias null/undefined → null (sem alerta).
 */
export function faixaDeVencimento(dias) {
    if (dias == null || !Number.isFinite(dias)) return null;
    if (dias <= 0) return 'expirado';
    if (dias <= 1) return '1';
    if (dias <= 3) return '3';
    if (dias <= 7) return '7';
    if (dias <= 15) return '15';
    if (dias <= 30) return '30';
    return null;
}

/** Urgência visual da faixa. */
export function urgenciaFaixa(faixa) {
    if (faixa === 'expirado') return { label: 'EXPIRADO', severidade: 'critica', cor: '#dc2626' };
    if (faixa === '1' || faixa === '3') return { label: 'CRÍTICO', severidade: 'critica', cor: '#dc2626' };
    if (faixa === '7') return { label: 'URGENTE', severidade: 'alta', cor: '#d97706' };
    if (faixa === '15' || faixa === '30') return { label: 'ATENÇÃO', severidade: 'media', cor: '#d97706' };
    return { label: 'OK', severidade: 'baixa', cor: '#16a34a' };
}

/** Calcula dias restantes entre notAfter (string ISO ou Date) e agora. */
export function diasAteVencimento(notAfter, agora = new Date()) {
    if (!notAfter) return null;
    const fim = (notAfter instanceof Date) ? notAfter : new Date(notAfter);
    if (isNaN(fim.getTime())) return null;
    return Math.floor((fim.getTime() - agora.getTime()) / 86_400_000);
}
