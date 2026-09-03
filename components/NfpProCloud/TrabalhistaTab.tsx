/**
 * components/NfpProCloud/TrabalhistaTab.tsx
 *
 * Aba "Trabalhista" da Consulta Situação Fiscal — apontamentos por
 * funcionário apurados no confronto Folha de Pagamentos × eSocial:
 * funcionário sem registro, registro efetivado depois do início real dos
 * trabalhos, ou outra irregularidade. Mesmo fluxo das demais abas
 * (inclusão manual por departamento + Salvar com merge colaborativo);
 * os apontamentos entram no parecer da IA e no relatório PDF.
 */
import React from 'react';
import type {
    NfpAnaliseEmpresa,
    NfpApontamentoTrabalhista,
    NfpTipoApontamentoTrabalhista,
    NfpStatusApontamentoTrabalhista,
    NfpFonteApontamentoTrabalhista,
    NfpGravidade,
} from '../../types';
import { uid, cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave } from './_common';

interface Props {
    analise: NfpAnaliseEmpresa;
    activeEmpresaId: string;
    setAnalise: (a: NfpAnaliseEmpresa) => void;
    saveAnalise: (a: NfpAnaliseEmpresa) => Promise<{ ok: boolean }>;
}

export const TIPO_APONTAMENTO_LABEL: Record<NfpTipoApontamentoTrabalhista, string> = {
    sem_registro: 'Sem registro',
    registro_fora_prazo: 'Registro fora do prazo',
    outro: 'Outro',
};

export const FONTE_APONTAMENTO_LABEL: Record<NfpFonteApontamentoTrabalhista, string> = {
    folha: 'Folha de Pagamentos',
    esocial: 'eSocial',
    manual: 'Apuração manual',
};

export const STATUS_APONTAMENTO_LABEL: Record<NfpStatusApontamentoTrabalhista, string> = {
    pendente: 'Pendente',
    em_regularizacao: 'Em regularização',
    regularizado: 'Regularizado',
};

const TrabalhistaTab: React.FC<Props> = ({ analise, activeEmpresaId, setAnalise, saveAnalise }) => {
    const apontamentos = analise.apontamentosTrabalhistas || [];

    const setApontamentos = (lista: NfpApontamentoTrabalhista[]) => {
        setAnalise({ ...analise, apontamentosTrabalhistas: lista });
    };

    const addApontamento = () => {
        const novo: NfpApontamentoTrabalhista = {
            id: uid(),
            empresaId: activeEmpresaId,
            funcionario: '',
            tipo: 'sem_registro',
            fonte: 'folha',
            gravidade: 'alta',
            status: 'pendente',
        };
        setApontamentos([...apontamentos, novo]);
    };

    const removeApontamento = (id: string) => {
        setApontamentos(apontamentos.filter(a => a.id !== id));
    };

    const updateApontamento = (id: string, patch: Partial<NfpApontamentoTrabalhista>) => {
        setApontamentos(apontamentos.map(a => a.id === id ? { ...a, ...patch } : a));
    };

    const gravidadeColor: Record<NfpGravidade, string> = {
        alta: 'var(--danger)',
        media: 'var(--warning, #d97706)',
        baixa: 'var(--success)',
    };

    return (
        <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                Apontamentos por funcionário apurados no confronto <strong>Folha de Pagamentos × eSocial</strong>:
                sem registro, registro efetivado após o início real dos trabalhos, ou outra irregularidade.
                Os apontamentos entram no parecer da IA e no relatório PDF.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <button onClick={addApontamento} style={btnStyle}>+ Adicionar Apontamento</button>
                <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
            </div>
            {apontamentos.length === 0 && (
                <p style={{ color: 'var(--text-muted)' }}>Nenhum apontamento trabalhista registrado.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {apontamentos.map(a => (
                    <div key={a.id} style={{ ...cardStyle, borderLeft: `4px solid ${gravidadeColor[a.gravidade]}` }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                                placeholder="Nome do funcionário"
                                value={a.funcionario}
                                onChange={e => updateApontamento(a.id, { funcionario: e.target.value })}
                                style={inputStyle}
                            />
                            <select value={a.tipo} onChange={e => updateApontamento(a.id, { tipo: e.target.value as NfpTipoApontamentoTrabalhista })} style={inputStyle}>
                                {(Object.keys(TIPO_APONTAMENTO_LABEL) as NfpTipoApontamentoTrabalhista[]).map(t => (
                                    <option key={t} value={t}>{TIPO_APONTAMENTO_LABEL[t]}</option>
                                ))}
                            </select>
                            <select value={a.status} onChange={e => updateApontamento(a.id, { status: e.target.value as NfpStatusApontamentoTrabalhista })} style={inputStyle}>
                                {(Object.keys(STATUS_APONTAMENTO_LABEL) as NfpStatusApontamentoTrabalhista[]).map(s => (
                                    <option key={s} value={s}>{STATUS_APONTAMENTO_LABEL[s]}</option>
                                ))}
                            </select>
                            <button
                                onClick={() => removeApontamento(a.id)}
                                style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}
                            >
                                x
                            </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                            <label style={labelSmall}>
                                CPF (opcional)
                                <input value={a.cpf || ''} onChange={e => updateApontamento(a.id, { cpf: e.target.value })} style={inputStyle} />
                            </label>
                            <label style={labelSmall}>
                                Início real dos trabalhos
                                <input type="date" value={a.dataInicioTrabalho || ''} onChange={e => updateApontamento(a.id, { dataInicioTrabalho: e.target.value })} style={inputStyle} />
                            </label>
                            <label style={labelSmall}>
                                Data do registro
                                <input
                                    type="date"
                                    value={a.dataRegistro || ''}
                                    onChange={e => updateApontamento(a.id, { dataRegistro: e.target.value })}
                                    disabled={a.tipo === 'sem_registro'}
                                    style={{ ...inputStyle, opacity: a.tipo === 'sem_registro' ? 0.5 : 1 }}
                                />
                            </label>
                            <label style={labelSmall}>
                                Fonte
                                <select value={a.fonte} onChange={e => updateApontamento(a.id, { fonte: e.target.value as NfpFonteApontamentoTrabalhista })} style={inputStyle}>
                                    {(Object.keys(FONTE_APONTAMENTO_LABEL) as NfpFonteApontamentoTrabalhista[]).map(f => (
                                        <option key={f} value={f}>{FONTE_APONTAMENTO_LABEL[f]}</option>
                                    ))}
                                </select>
                            </label>
                            <label style={labelSmall}>
                                Gravidade
                                <select value={a.gravidade} onChange={e => updateApontamento(a.id, { gravidade: e.target.value as NfpGravidade })} style={inputStyle}>
                                    <option value="alta">Alta</option>
                                    <option value="media">Média</option>
                                    <option value="baixa">Baixa</option>
                                </select>
                            </label>
                        </div>
                        <div style={{ marginTop: '0.5rem' }}>
                            <label style={labelSmall}>
                                Observação
                                <input
                                    placeholder="Ex.: admissão em 01/03 e registro só em 15/04, apurado na folha de abril"
                                    value={a.observacao || ''}
                                    onChange={e => updateApontamento(a.id, { observacao: e.target.value })}
                                    style={inputStyle}
                                />
                            </label>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TrabalhistaTab;
