/**
 * components/NfpProCloud/DebitosTab.tsx
 *
 * Aba de Debitos do dashboard NfpProCloud. Extraida de index.tsx (112 linhas).
 * Atualiza valores via SELIC do `nfpService.atualizarDebitosSelic` antes de
 * renderizar. Divide em 3 secoes (Federal/Estadual/Municipal) com badges
 * de fonte (SERPRO vs Manual) e status colorido.
 */
import React from 'react';
import type { NfpAnaliseEmpresa, NfpDebito, NfpEsfera, NfpStatusDebito } from '../../types';
import * as nfpService from '../../services/nfpProCloudService';
import { uid, formatCurrency, cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave } from './_common';

interface Props {
    analise: NfpAnaliseEmpresa;
    activeEmpresaId: string;
    activeUf?: string;
    activeMunicipio?: string;
    taxaSelic: number;
    setTaxaSelic: (v: number) => void;
    setAnalise: (a: NfpAnaliseEmpresa) => void;
    updateAnalise: (patch: Partial<NfpAnaliseEmpresa>) => void;
    saveAnalise: (a: NfpAnaliseEmpresa) => Promise<void>;
    renderEsferaSectionHeader: (esf: NfpEsfera, sublabel?: string) => React.ReactNode;
}

const DebitosTab: React.FC<Props> = ({
    analise, activeEmpresaId, activeUf, activeMunicipio,
    taxaSelic, setTaxaSelic,
    setAnalise, updateAnalise, saveAnalise,
    renderEsferaSectionHeader,
}) => {
    const debitos = nfpService.atualizarDebitosSelic(analise.debitos, taxaSelic);

    const addDebito = (esfera: NfpEsfera = 'federal') => {
        const novo: NfpDebito = {
            id: uid(), empresaId: activeEmpresaId, esfera,
            orgao: '', descricao: '', valorOriginal: 0, dataVencimento: new Date().toISOString().slice(0, 10), status: 'aberto',
        };
        setAnalise({ ...analise, debitos: [...analise.debitos, novo] });
    };
    const removeDebito = (id: string) => {
        setAnalise({ ...analise, debitos: analise.debitos.filter(d => d.id !== id) });
    };
    const updateDebito = (id: string, patch: Partial<NfpDebito>) => {
        setAnalise({ ...analise, debitos: analise.debitos.map(d => d.id === id ? { ...d, ...patch } : d) });
    };

    const getDebitoFonte = (d: NfpDebito): 'automatico' | 'manual' => {
        if (d.esfera === 'federal' && (d.orgao === 'Receita Federal' || d.orgao === 'PGFN')) return 'automatico';
        return 'manual';
    };

    const renderDebitoFonteBadge = (fonte: 'automatico' | 'manual') => {
        const isAuto = fonte === 'automatico';
        return (
            <span style={{
                padding: '1px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 600,
                background: isAuto ? 'var(--accent)18' : 'var(--text-muted)18',
                color: isAuto ? 'var(--accent)' : 'var(--text-muted)',
                border: `1px solid ${isAuto ? 'var(--accent)' : 'var(--text-muted)'}33`,
                whiteSpace: 'nowrap' as const,
            }}>
                {isAuto ? 'SERPRO' : 'Manual'}
            </span>
        );
    };

    const renderDebitoCard = (d: NfpDebito) => (
        <div key={d.id} style={cardStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: '0.5rem', alignItems: 'center' }}>
                <input placeholder="Descricao" value={d.descricao} onChange={e => updateDebito(d.id, { descricao: e.target.value })} style={inputStyle} />
                <select value={d.esfera} onChange={e => updateDebito(d.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}>
                    <option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option>
                </select>
                <select value={d.status} onChange={e => updateDebito(d.id, { status: e.target.value as NfpStatusDebito })} style={inputStyle}>
                    <option value="aberto">Aberto</option><option value="parcelado">Parcelado</option><option value="em_analise">Em analise</option><option value="quitado">Quitado</option><option value="prescrito">Prescrito</option>
                </select>
                {renderDebitoFonteBadge(getDebitoFonte(d))}
                <button onClick={() => removeDebito(d.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                <label style={labelSmall}>Orgao<input value={d.orgao} onChange={e => updateDebito(d.id, { orgao: e.target.value })} style={inputStyle} /></label>
                <label style={labelSmall}>Valor Original<input type="number" value={d.valorOriginal} onChange={e => updateDebito(d.id, { valorOriginal: Number(e.target.value) })} style={inputStyle} /></label>
                <label style={labelSmall}>Vencimento<input type="date" value={d.dataVencimento} onChange={e => updateDebito(d.id, { dataVencimento: e.target.value })} style={inputStyle} /></label>
                <div style={labelSmall}>Valor Atualizado<div style={{ fontWeight: 700, color: 'var(--danger)', marginTop: '4px' }}>{formatCurrency(d.valorAtualizado || d.valorOriginal)}</div></div>
            </div>
        </div>
    );

    const federais = debitos.filter(d => d.esfera === 'federal');
    const estaduais = debitos.filter(d => d.esfera === 'estadual');
    const municipais = debitos.filter(d => d.esfera === 'municipal');

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    Taxa Selic (% a.a.):
                    <input type="number" value={taxaSelic} onChange={e => setTaxaSelic(Number(e.target.value))} step="0.01"
                        style={{ marginLeft: '0.5rem', width: '80px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                </label>
                <button onClick={() => addDebito('federal')} style={btnStyle}>+ Adicionar Debito</button>
                <button onClick={() => { updateAnalise({ debitos: analise.debitos }); saveAnalise({ ...analise, debitos: analise.debitos }); }} style={btnStyleSave}>Salvar</button>
            </div>
            {debitos.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhum debito registrado.</p>}

            {federais.length > 0 && (
                <>
                    {renderEsferaSectionHeader('federal')}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        {federais.map(renderDebitoCard)}
                    </div>
                </>
            )}

            {estaduais.length > 0 && (
                <>
                    {renderEsferaSectionHeader('estadual', activeUf || undefined)}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        {estaduais.map(renderDebitoCard)}
                    </div>
                </>
            )}

            {municipais.length > 0 && (
                <>
                    {renderEsferaSectionHeader('municipal', activeMunicipio || undefined)}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        {municipais.map(renderDebitoCard)}
                    </div>
                </>
            )}
        </div>
    );
};

export default DebitosTab;
