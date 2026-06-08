/**
 * components/NfpProCloud/ParcelamentosTab.tsx
 *
 * Aba de Parcelamentos do dashboard NfpProCloud. Lista parcelamentos com
 * barra de progresso (parcelas pagas/total) e permite editar programa,
 * status, esfera, valores.
 */
import React from 'react';
import type { NfpAnaliseEmpresa, NfpParcelamento, NfpEsfera } from '../../types';
import { uid, cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave } from './_common';

interface Props {
    analise: NfpAnaliseEmpresa;
    selectedEmpresaId: string;
    updateAnalise: (patch: Partial<NfpAnaliseEmpresa>) => void;
    saveAnalise: (a: NfpAnaliseEmpresa) => Promise<void>;
}

const ParcelamentosTab: React.FC<Props> = ({ analise, selectedEmpresaId, updateAnalise, saveAnalise }) => {
    const addParcelamento = () => {
        const novo: NfpParcelamento = {
            id: uid(), empresaId: selectedEmpresaId, esfera: 'federal',
            programa: '', valorTotal: 0, parcelas: 1, parcelasPagas: 0, valorParcela: 0,
            status: 'ativo', dataInicio: new Date().toISOString().slice(0, 10),
        };
        updateAnalise({ parcelamentos: [...analise.parcelamentos, novo] });
    };
    const updateParc = (id: string, patch: Partial<NfpParcelamento>) =>
        updateAnalise({ parcelamentos: analise.parcelamentos.map(p => p.id === id ? { ...p, ...patch } : p) });
    const removeParc = (id: string) =>
        updateAnalise({ parcelamentos: analise.parcelamentos.filter(p => p.id !== id) });

    return (
        <div>
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button onClick={addParcelamento} style={btnStyle}>+ Adicionar</button>
                <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
            </div>
            {analise.parcelamentos.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhum parcelamento.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {analise.parcelamentos.map(p => {
                    const pct = p.parcelas > 0 ? Math.round((p.parcelasPagas / p.parcelas) * 100) : 0;
                    return (
                        <div key={p.id} style={cardStyle}>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                                <input placeholder="Programa" value={p.programa} onChange={e => updateParc(p.id, { programa: e.target.value })} style={inputStyle} />
                                <select value={p.status} onChange={e => updateParc(p.id, { status: e.target.value as any })} style={inputStyle}>
                                    <option value="ativo">Ativo</option><option value="inadimplente">Inadimplente</option><option value="quitado">Quitado</option><option value="cancelado">Cancelado</option>
                                </select>
                                <select value={p.esfera} onChange={e => updateParc(p.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}>
                                    <option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option>
                                </select>
                                <button onClick={() => removeParc(p.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <label style={labelSmall}>Valor Total<input type="number" value={p.valorTotal} onChange={e => updateParc(p.id, { valorTotal: Number(e.target.value) })} style={inputStyle} /></label>
                                <label style={labelSmall}>Parcelas<input type="number" value={p.parcelas} onChange={e => updateParc(p.id, { parcelas: Number(e.target.value) })} style={inputStyle} /></label>
                                <label style={labelSmall}>Pagas<input type="number" value={p.parcelasPagas} onChange={e => updateParc(p.id, { parcelasPagas: Number(e.target.value) })} style={inputStyle} /></label>
                                <label style={labelSmall}>Valor Parcela<input type="number" value={p.valorParcela} onChange={e => updateParc(p.id, { valorParcela: Number(e.target.value) })} style={inputStyle} /></label>
                            </div>
                            <div style={{ marginTop: '0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: 'var(--border-default)' }}>
                                        <div style={{ width: `${pct}%`, height: '100%', borderRadius: '4px', background: pct === 100 ? 'var(--success)' : 'var(--accent)', transition: 'width 0.3s' }} />
                                    </div>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: '45px' }}>{pct}%</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ParcelamentosTab;
