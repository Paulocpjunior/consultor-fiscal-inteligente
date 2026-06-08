/**
 * components/NfpProCloud/_common.tsx
 *
 * Helpers, constantes e estilos compartilhados pelo dashboard NfpProCloud
 * e suas sub-tabs. Centraliza o que estava duplicado/inline em index.tsx
 * pra permitir extrair tabs sem ciclos de import.
 */
import React from 'react';
import type { NfpEsfera, NfpStatusCertidao, NfpGravidade } from '../../types';

export const OBRIGACOES_BASE = [
    // Federal
    { nome: 'DEFIS', sigla: 'DEFIS', esfera: 'federal' as NfpEsfera, periodicidade: 'anual' as const },
    { nome: 'ECD', sigla: 'ECD', esfera: 'federal' as NfpEsfera, periodicidade: 'anual' as const },
    { nome: 'ECF', sigla: 'ECF', esfera: 'federal' as NfpEsfera, periodicidade: 'anual' as const },
    { nome: 'SPED Fiscal', sigla: 'EFD', esfera: 'federal' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'SPED Contribuições', sigla: 'EFD-C', esfera: 'federal' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'eSocial', sigla: 'eSocial', esfera: 'federal' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'FGTS Digital', sigla: 'FGTS', esfera: 'federal' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'DCTFWeb', sigla: 'DCTFWeb', esfera: 'federal' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'DIRF', sigla: 'DIRF', esfera: 'federal' as NfpEsfera, periodicidade: 'anual' as const },
    { nome: 'RAIS', sigla: 'RAIS', esfera: 'federal' as NfpEsfera, periodicidade: 'anual' as const },
    // Estadual
    { nome: 'GIA', sigla: 'GIA', esfera: 'estadual' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'DeSTDA', sigla: 'DeSTDA', esfera: 'estadual' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'SINTEGRA', sigla: 'SINTEGRA', esfera: 'estadual' as NfpEsfera, periodicidade: 'mensal' as const },
    // Municipal
    { nome: 'ISS Digital', sigla: 'ISS', esfera: 'municipal' as NfpEsfera, periodicidade: 'mensal' as const },
];

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

// ─── Mini-componentes compartilhados ──────────────────────────────────────

export const DashCard: React.FC<{ title: string; value: string; sub: string; color: string }> = ({ title, value, sub, color }) => (
    <div style={{ padding: '1rem', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{sub}</span>
    </div>
);

// ─── Render Helpers (compartilhados entre tabs) ────────────────────────────

export function esferaIcon(esf: NfpEsfera): string {
    if (esf === 'federal') return '\u{1F3DB}'; // classical building
    if (esf === 'estadual') return '\u{1F3E2}'; // office building
    return '\u{1F3E0}'; // house
}

export function renderEsferaSectionHeader(esf: NfpEsfera, sublabel?: string): React.ReactNode {
    const labels: Record<NfpEsfera, string> = { federal: 'Federal', estadual: 'Estadual', municipal: 'Municipal' };
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 0', marginTop: '0.75rem', marginBottom: '0.25rem',
            borderBottom: '1px solid var(--border-subtle)',
        }}>
            <span style={{ fontSize: '1.1rem' }}>{esferaIcon(esf)}</span>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{labels[esf]}</span>
            {sublabel && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>({sublabel})</span>
            )}
        </div>
    );
}

export function renderFonteBadge(tipo: 'automatico' | 'manual' | 'serpro' | 'consulta_publica'): React.ReactNode {
    const labelMap: Record<string, string> = {
        automatico: 'SERPRO', serpro: 'SERPRO',
        consulta_publica: 'Portal Publico', manual: 'Manual',
    };
    const colorMap: Record<string, string> = {
        automatico: 'var(--accent)', serpro: 'var(--accent)',
        consulta_publica: 'var(--text-muted)', manual: '#e67e22',
    };
    const label = labelMap[tipo] || tipo;
    const color = colorMap[tipo] || 'var(--text-muted)';
    return (
        <span style={{
            padding: '1px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 600,
            background: color + '18',
            color: color,
            border: `1px solid ${color}33`,
            whiteSpace: 'nowrap' as const,
        }}>
            {label}
        </span>
    );
}
