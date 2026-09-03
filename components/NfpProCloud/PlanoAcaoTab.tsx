/**
 * components/NfpProCloud/PlanoAcaoTab.tsx
 *
 * Aba do Plano de Acao do dashboard NfpProCloud. Lista itens ordenados
 * por gravidade (alta/media/baixa, com borda esquerda colorida) com
 * prazo, responsavel e status.
 */
import React from 'react';
import type { NfpAnaliseEmpresa, NfpPlanoAcao, NfpEsfera, NfpGravidade } from '../../types';
import { uid, gravityColor, cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave } from './_common';

interface Props {
    analise: NfpAnaliseEmpresa;
    selectedEmpresaId: string;
    updateAnalise: (patch: Partial<NfpAnaliseEmpresa>) => void;
    saveAnalise: (a: NfpAnaliseEmpresa) => Promise<{ ok: boolean }>;
}

const PlanoAcaoTab: React.FC<Props> = ({ analise, selectedEmpresaId, updateAnalise, saveAnalise }) => {
    const sorted = [...analise.planoAcao].sort((a, b) => {
        const order: Record<NfpGravidade, number> = { alta: 0, media: 1, baixa: 2 };
        return order[a.gravidade] - order[b.gravidade];
    });

    const addPlano = () => {
        const novo: NfpPlanoAcao = {
            id: uid(), empresaId: selectedEmpresaId, descricao: '',
            gravidade: 'media', esfera: 'federal', status: 'pendente',
        };
        updateAnalise({ planoAcao: [...analise.planoAcao, novo] });
    };
    const updatePlano = (id: string, patch: Partial<NfpPlanoAcao>) =>
        updateAnalise({ planoAcao: analise.planoAcao.map(p => p.id === id ? { ...p, ...patch } : p) });
    const removePlano = (id: string) =>
        updateAnalise({ planoAcao: analise.planoAcao.filter(p => p.id !== id) });

    return (
        <div>
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button onClick={addPlano} style={btnStyle}>+ Adicionar</button>
                <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
            </div>
            {sorted.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhum item no plano de acao.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {sorted.map(p => (
                    <div key={p.id} style={{ ...cardStyle, borderLeft: `4px solid ${gravityColor(p.gravidade)}` }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                            <input placeholder="Descrição da ação" value={p.descricao} onChange={e => updatePlano(p.id, { descricao: e.target.value })} style={inputStyle} />
                            <select value={p.gravidade} onChange={e => updatePlano(p.id, { gravidade: e.target.value as NfpGravidade })} style={inputStyle}>
                                <option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option>
                            </select>
                            <select value={p.esfera} onChange={e => updatePlano(p.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}>
                                <option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option>
                            </select>
                            <select value={p.status} onChange={e => updatePlano(p.id, { status: e.target.value as any })} style={inputStyle}>
                                <option value="pendente">Pendente</option><option value="em_andamento">Em andamento</option><option value="concluida">Concluída</option>
                            </select>
                            <button onClick={() => removePlano(p.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                            <label style={labelSmall}>Prazo<input type="date" value={p.prazo || ''} onChange={e => updatePlano(p.id, { prazo: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Responsável<input value={p.responsavel || ''} onChange={e => updatePlano(p.id, { responsavel: e.target.value })} style={inputStyle} /></label>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default PlanoAcaoTab;
