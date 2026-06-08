/**
 * components/NfpProCloud/AcoesTab.tsx
 *
 * Aba de Acoes Judiciais do dashboard NfpProCloud. Permite cadastrar
 * processos com tipo (civil/trabalhista/tributaria/criminal), status e
 * dados basicos (numero, vara, valor da causa).
 */
import React from 'react';
import type { NfpAnaliseEmpresa, NfpAcaoJudicial, NfpTipoAcao } from '../../types';
import { uid, cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave } from './_common';

interface Props {
    analise: NfpAnaliseEmpresa;
    selectedEmpresaId: string;
    updateAnalise: (patch: Partial<NfpAnaliseEmpresa>) => void;
    saveAnalise: (a: NfpAnaliseEmpresa) => Promise<void>;
}

const AcoesTab: React.FC<Props> = ({ analise, selectedEmpresaId, updateAnalise, saveAnalise }) => {
    const addAcao = () => {
        const nova: NfpAcaoJudicial = {
            id: uid(), empresaId: selectedEmpresaId, tipo: 'tributaria', descricao: '', status: 'em_andamento',
        };
        updateAnalise({ acoes: [...analise.acoes, nova] });
    };
    const updateAcao = (id: string, patch: Partial<NfpAcaoJudicial>) =>
        updateAnalise({ acoes: analise.acoes.map(a => a.id === id ? { ...a, ...patch } : a) });
    const removeAcao = (id: string) =>
        updateAnalise({ acoes: analise.acoes.filter(a => a.id !== id) });

    return (
        <div>
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button onClick={addAcao} style={btnStyle}>+ Adicionar</button>
                <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
            </div>
            {analise.acoes.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhuma ação judicial registrada.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {analise.acoes.map(a => (
                    <div key={a.id} style={cardStyle}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                            <input placeholder="Descrição" value={a.descricao} onChange={e => updateAcao(a.id, { descricao: e.target.value })} style={inputStyle} />
                            <select value={a.tipo} onChange={e => updateAcao(a.id, { tipo: e.target.value as NfpTipoAcao })} style={inputStyle}>
                                <option value="civil">Civil</option><option value="trabalhista">Trabalhista</option><option value="tributaria">Tributária</option><option value="criminal">Criminal</option>
                            </select>
                            <select value={a.status} onChange={e => updateAcao(a.id, { status: e.target.value as any })} style={inputStyle}>
                                <option value="em_andamento">Em andamento</option><option value="encerrada">Encerrada</option><option value="arquivada">Arquivada</option>
                            </select>
                            <button onClick={() => removeAcao(a.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                            <label style={labelSmall}>Numero<input value={a.numero || ''} onChange={e => updateAcao(a.id, { numero: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Vara<input value={a.vara || ''} onChange={e => updateAcao(a.id, { vara: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Valor Causa<input type="number" value={a.valorCausa || 0} onChange={e => updateAcao(a.id, { valorCausa: Number(e.target.value) })} style={inputStyle} /></label>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AcoesTab;
