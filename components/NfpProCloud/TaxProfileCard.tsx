/**
 * components/NfpProCloud/TaxProfileCard.tsx
 *
 * Card de perfil tributario mostrado no topo do dashboard quando uma
 * empresa tem regime + CNAE detectados. Lista impostos aplicaveis
 * (federal/estadual/municipal com cores distintas), observacoes do
 * engine de regras e badge do regime + tipo de atividade.
 */
import React from 'react';
import { regimeLabel, atividadeLabel, type TaxProfile, type RegimeTributario } from '../../services/nfpTaxRulesEngine';
import { cardStyle } from './_common';

interface Props {
    taxProfile: TaxProfile | null;
}

const TaxProfileCard: React.FC<Props> = ({ taxProfile }) => {
    if (!taxProfile) return null;

    const regimeBadgeColors: Record<RegimeTributario, string> = {
        simples_nacional: 'var(--success)',
        lucro_presumido: 'var(--accent)',
        lucro_real: '#9333ea',
        mei: 'var(--text-muted)',
    };
    const badgeColor = regimeBadgeColors[taxProfile.regime] || 'var(--text-muted)';

    return (
        <div style={{ ...cardStyle, marginBottom: '1rem', borderLeft: `4px solid ${badgeColor}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{
                    padding: '3px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                    background: badgeColor + '22', color: badgeColor,
                    border: `1px solid ${badgeColor}44`,
                }}>
                    {regimeLabel(taxProfile.regime)}
                </span>
                <span style={{
                    padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                    background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border-default)',
                }}>
                    {atividadeLabel(taxProfile.atividadeTipo)}
                </span>
                {taxProfile.cnae && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        CNAE {taxProfile.cnae}{taxProfile.descricaoCnae ? ` - ${taxProfile.descricaoCnae}` : ''}
                    </span>
                )}
            </div>

            {taxProfile.impostosAplicaveis.length > 0 && (
                <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
                        Impostos Aplicaveis
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.4rem' }}>
                        {taxProfile.impostosAplicaveis.map((imp, i) => (
                            <span key={i} title={imp.aliquotaBase || ''} style={{
                                padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 500,
                                background: imp.esfera === 'federal' ? 'var(--accent)11' : imp.esfera === 'estadual' ? 'var(--warning)11' : 'var(--success)11',
                                color: imp.esfera === 'federal' ? 'var(--accent)' : imp.esfera === 'estadual' ? 'var(--warning)' : 'var(--success)',
                                border: `1px solid ${imp.esfera === 'federal' ? 'var(--accent)' : imp.esfera === 'estadual' ? 'var(--warning)' : 'var(--success)'}33`,
                                cursor: imp.aliquotaBase ? 'help' : 'default',
                            }}>
                                {imp.nome}{imp.aliquotaBase ? ` (${imp.aliquotaBase})` : ''}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {taxProfile.observacoes.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                    {taxProfile.observacoes.map((obs, i) => (
                        <p key={i} style={{ margin: '2px 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {obs}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TaxProfileCard;
