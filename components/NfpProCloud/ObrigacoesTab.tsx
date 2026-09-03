/**
 * components/NfpProCloud/ObrigacoesTab.tsx
 *
 * Aba de Obrigacoes Acessorias do dashboard NfpProCloud. Extraida de
 * index.tsx (108 linhas). Lista DEFIS/ECD/ECF/SPED/eSocial/etc pre-
 * configuradas em OBRIGACOES_BASE + permite adicionar custom.
 */
import React from 'react';
import type { NfpAnaliseEmpresa, NfpObrigacao, NfpEsfera, NfpStatusObrigacao } from '../../types';
import { OBRIGACOES_BASE, uid, cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave } from './_common';

interface Props {
    analise: NfpAnaliseEmpresa;
    activeEmpresaId: string;
    activeUf?: string;
    activeMunicipio?: string;
    updateAnalise: (patch: Partial<NfpAnaliseEmpresa>) => void;
    saveAnalise: (a: NfpAnaliseEmpresa) => Promise<{ ok: boolean }>;
    renderEsferaSectionHeader: (esf: NfpEsfera, sublabel?: string) => React.ReactNode;
}

const ObrigacoesTab: React.FC<Props> = ({
    analise, activeEmpresaId, activeUf, activeMunicipio,
    updateAnalise, saveAnalise, renderEsferaSectionHeader,
}) => {
    const updateObrigacao = (id: string, patch: Partial<NfpObrigacao>) => {
        updateAnalise({ obrigacoes: analise.obrigacoes.map(o => o.id === id ? { ...o, ...patch } : o) });
    };
    const removeObrigacao = (id: string) => {
        updateAnalise({ obrigacoes: analise.obrigacoes.filter(o => o.id !== id) });
    };
    const addObrigacao = () => {
        const nova: NfpObrigacao = {
            id: uid(), empresaId: activeEmpresaId, nome: '', sigla: '',
            esfera: 'federal', periodicidade: 'mensal', status: 'nao_verificada',
        };
        updateAnalise({ obrigacoes: [...analise.obrigacoes, nova] });
    };

    const isCustomObrigacao = (o: NfpObrigacao): boolean =>
        !OBRIGACOES_BASE.some(b => b.sigla === o.sigla && b.esfera === o.esfera);

    const statusBadge = (s: NfpStatusObrigacao) => {
        const colors: Record<NfpStatusObrigacao, string> = {
            entregue: 'var(--success)', pendente: 'var(--warning)', atrasada: 'var(--danger)', dispensada: 'var(--text-muted)', nao_verificada: 'var(--border-default)',
        };
        return <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: colors[s] + '22', color: colors[s], border: `1px solid ${colors[s]}44` }}>{s.replace('_', ' ')}</span>;
    };

    const renderObrigacaoCard = (o: NfpObrigacao) => {
        const custom = isCustomObrigacao(o);
        return (
            <div key={o.id} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {custom ? (
                            <>
                                <input placeholder="Sigla" value={o.sigla} onChange={e => updateObrigacao(o.id, { sigla: e.target.value })}
                                    style={{ ...inputStyle, width: '80px', fontWeight: 700 }} />
                                <input placeholder="Nome" value={o.nome} onChange={e => updateObrigacao(o.id, { nome: e.target.value })}
                                    style={{ ...inputStyle, width: '160px', fontSize: '0.85rem' }} />
                            </>
                        ) : (
                            <>
                                <strong style={{ color: 'var(--text-primary)' }}>{o.sigla}</strong>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{o.nome} ({o.periodicidade})</span>
                            </>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {statusBadge(o.status)}
                        <select value={o.status} onChange={e => updateObrigacao(o.id, { status: e.target.value as NfpStatusObrigacao })} style={{ ...inputStyle, width: 'auto', fontSize: '0.8rem' }}>
                            <option value="entregue">Entregue</option><option value="pendente">Pendente</option><option value="atrasada">Atrasada</option><option value="dispensada">Dispensada</option><option value="nao_verificada">Nao verificada</option>
                        </select>
                        {custom && (
                            <button onClick={() => removeObrigacao(o.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                        )}
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <label style={labelSmall}>Competencia<input value={o.competencia || ''} onChange={e => updateObrigacao(o.id, { competencia: e.target.value })} placeholder="MM/AAAA" style={inputStyle} /></label>
                    <label style={labelSmall}>Data Entrega<input type="date" value={o.dataEntrega || ''} onChange={e => updateObrigacao(o.id, { dataEntrega: e.target.value })} style={inputStyle} /></label>
                </div>
                <label style={labelSmall}>
                    Observação / Pendência
                    <textarea
                        value={o.observacao || ''}
                        onChange={e => updateObrigacao(o.id, { observacao: e.target.value })}
                        placeholder="Ex.: Ausência do Bloco K nas competências 01/2026, 02/2026, 03/2026..."
                        rows={2}
                        style={{ ...inputStyle, resize: 'vertical', minHeight: '52px', lineHeight: 1.35 }}
                    />
                </label>
            </div>
        );
    };

    const federais = analise.obrigacoes.filter(o => o.esfera === 'federal');
    const estaduais = analise.obrigacoes.filter(o => o.esfera === 'estadual');
    const municipais = analise.obrigacoes.filter(o => o.esfera === 'municipal');

    return (
        <div>
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button onClick={addObrigacao} style={btnStyle}>+ Adicionar Obrigacao</button>
                <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
            </div>

            {federais.length > 0 && (
                <>
                    {renderEsferaSectionHeader('federal')}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        {federais.map(renderObrigacaoCard)}
                    </div>
                </>
            )}

            {estaduais.length > 0 && (
                <>
                    {renderEsferaSectionHeader('estadual', activeUf || undefined)}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        {estaduais.map(renderObrigacaoCard)}
                    </div>
                </>
            )}

            {municipais.length > 0 && (
                <>
                    {renderEsferaSectionHeader('municipal', activeMunicipio || undefined)}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        {municipais.map(renderObrigacaoCard)}
                    </div>
                </>
            )}
        </div>
    );
};

export default ObrigacoesTab;
