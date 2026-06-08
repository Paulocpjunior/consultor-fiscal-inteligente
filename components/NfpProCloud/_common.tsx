/**
 * components/NfpProCloud/_common.tsx
 *
 * Helpers, constantes e estilos compartilhados pelo dashboard NfpProCloud
 * e suas sub-tabs. Centraliza o que estava duplicado/inline em index.tsx
 * pra permitir extrair tabs sem ciclos de import.
 */
import React from 'react';
import type { NfpEsfera, NfpStatusCertidao, NfpGravidade } from '../../types';

export const CERTIDOES_BASE = [
    // Federal (Automático via SERPRO)
    { orgao: 'Receita Federal / PGFN', tipo: 'CND Federal', esfera: 'federal' as NfpEsfera, fonte: 'automatico' as const },
    { orgao: 'Caixa Econômica Federal', tipo: 'CRF (FGTS)', esfera: 'federal' as NfpEsfera, fonte: 'automatico' as const },
    { orgao: 'Justiça do Trabalho (TST)', tipo: 'CNDT (Trabalhista)', esfera: 'federal' as NfpEsfera, fonte: 'automatico' as const },
    // Estadual (Manual)
    { orgao: 'Sefaz Estadual (ICMS)', tipo: 'CND Estadual', esfera: 'estadual' as NfpEsfera, fonte: 'manual' as const },
    // Municipal (Manual)
    { orgao: 'Prefeitura Municipal (ISS)', tipo: 'CND Municipal', esfera: 'municipal' as NfpEsfera, fonte: 'manual' as const },
];

export function uid(): string {
    return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

export function formatCurrency(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function gravityColor(g: NfpGravidade): string {
    if (g === 'alta') return 'var(--danger)';
    if (g === 'media') return 'var(--warning)';
    return 'var(--accent)';
}

export function certidaoColor(status: NfpStatusCertidao): string {
    if (status === 'negativa') return 'var(--success)';
    if (status === 'positiva_efeitos_negativa') return 'var(--warning)';
    if (status === 'positiva') return 'var(--danger)';
    return 'var(--text-muted)';
}

export function certidaoLabel(status: NfpStatusCertidao): string {
    if (status === 'negativa') return 'Negativa';
    if (status === 'positiva_efeitos_negativa') return 'Positiva c/ Efeitos Negativa';
    if (status === 'positiva') return 'Positiva';
    if (status === 'indisponivel') return 'Indisponível';
    return 'Não consultada';
}

// ─── Shared Styles ───────────────────────────────────────────────────────────

export const cardStyle: React.CSSProperties = {
    padding: '1rem',
    borderRadius: '10px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border-subtle)',
};

export const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid var(--border-default)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    width: '100%',
};

export const labelSmall: React.CSSProperties = {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
};

export const btnStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '8px',
    border: '1px solid var(--accent)',
    background: 'transparent',
    color: 'var(--accent)',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
};

export const btnStyleSave: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '8px',
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
};
