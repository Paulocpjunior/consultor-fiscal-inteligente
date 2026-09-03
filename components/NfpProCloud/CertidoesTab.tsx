/**
 * components/NfpProCloud/CertidoesTab.tsx
 *
 * Aba de Certidoes do dashboard NfpProCloud. Extraida de index.tsx (170
 * linhas dominadas pelo `renderCertidaoCard`).
 *
 * Layout: 3 secoes empilhadas (Federal, Estadual, Municipal). Cada card
 * permite editar tipo/orgao (so se for custom), status, data emissao/
 * validade/consulta, motivo de impedimento e link pro portal oficial.
 * Cards com pdfBase64 ganham botao "Baixar PDF".
 */
import React from 'react';
import type { NfpAnaliseEmpresa, NfpCertidao, NfpEsfera, NfpStatusCertidao } from '../../types';
import {
    CERTIDOES_BASE, uid, certidaoColor, certidaoLabel,
    cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave,
} from './_common';

interface Props {
    analise: NfpAnaliseEmpresa;
    activeEmpresaId: string;
    activeUf?: string;
    activeMunicipio?: string;
    updateAnalise: (patch: Partial<NfpAnaliseEmpresa>) => void;
    saveAnalise: (a: NfpAnaliseEmpresa) => Promise<{ ok: boolean }>;
    renderEsferaSectionHeader: (esf: NfpEsfera, sublabel?: string) => React.ReactNode;
    renderFonteBadge: (tipo: 'automatico' | 'manual' | 'serpro' | 'consulta_publica') => React.ReactNode;
}

const CertidoesTab: React.FC<Props> = ({
    analise, activeEmpresaId, activeUf, activeMunicipio,
    updateAnalise, saveAnalise,
    renderEsferaSectionHeader, renderFonteBadge,
}) => {
    const updateCertidao = (id: string, patch: Partial<NfpCertidao>) => {
        updateAnalise({ certidoes: analise.certidoes.map(c => c.id === id ? { ...c, ...patch } : c) });
    };

    const removeCertidao = (id: string) => {
        updateAnalise({ certidoes: analise.certidoes.filter(c => c.id !== id) });
    };

    const addCertidao = () => {
        const nova: NfpCertidao = {
            id: uid(), empresaId: activeEmpresaId, esfera: 'federal',
            orgao: '', tipo: '', status: 'nao_consultada',
        };
        updateAnalise({ certidoes: [...analise.certidoes, nova] });
    };

    const getCertidaoFonte = (c: NfpCertidao): 'serpro' | 'consulta_publica' | 'manual' => {
        if (c.fonte) return c.fonte;
        const base = CERTIDOES_BASE.find(b => b.tipo === c.tipo && b.esfera === c.esfera);
        return base?.fonte === 'automatico' ? 'serpro' : 'manual';
    };

    const downloadPdf = (c: NfpCertidao) => {
        if (!c.pdfBase64) return;
        const byteChars = atob(c.pdfBase64);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${c.tipo.replace(/[^a-zA-Z0-9]/g, '_')}_${(c.numeroCertidao || 'certidao')}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const isCustomCertidao = (c: NfpCertidao): boolean =>
        !CERTIDOES_BASE.some(b => b.tipo === c.tipo && b.esfera === c.esfera);

    const renderCertidaoCard = (c: NfpCertidao) => (
        <div key={c.id} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {isCustomCertidao(c) ? (
                        <input placeholder="Tipo" value={c.tipo} onChange={e => updateCertidao(c.id, { tipo: e.target.value })}
                            style={{ ...inputStyle, width: 'auto', fontWeight: 700 }} />
                    ) : (
                        <strong style={{ color: 'var(--text-primary)' }}>{c.tipo}</strong>
                    )}
                    {isCustomCertidao(c) ? (
                        <input placeholder="Orgao" value={c.orgao} onChange={e => updateCertidao(c.id, { orgao: e.target.value })}
                            style={{ ...inputStyle, width: 'auto', fontSize: '0.85rem' }} />
                    ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{c.orgao}</span>
                    )}
                    {renderFonteBadge(getCertidaoFonte(c))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, background: certidaoColor(c.status) + '22', color: certidaoColor(c.status), border: `1px solid ${certidaoColor(c.status)}44` }}>
                        {certidaoLabel(c.status)}
                    </span>
                    <select value={c.status} onChange={e => updateCertidao(c.id, { status: e.target.value as NfpStatusCertidao })} style={{ ...inputStyle, width: 'auto', fontSize: '0.8rem' }}>
                        <option value="negativa">Negativa</option><option value="positiva_efeitos_negativa">Positiva c/ Efeitos Negativa</option><option value="positiva">Positiva</option><option value="indisponivel">Indisponivel</option><option value="nao_consultada">Nao consultada</option>
                    </select>
                    {c.pdfBase64 && (
                        <button onClick={() => downloadPdf(c)} title="Baixar PDF da certidao" style={{ background: 'var(--accent)14', border: `1px solid var(--accent)44`, borderRadius: '8px', padding: '2px 10px', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            Baixar PDF
                        </button>
                    )}
                    {isCustomCertidao(c) && (
                        <button onClick={() => removeCertidao(c.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                    )}
                </div>
            </div>
            {c.numeroCertidao && (
                <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Certidao n.{'º'} <strong>{c.numeroCertidao}</strong>
                </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                <label style={labelSmall}>Data Emissao<input type="date" value={c.dataEmissao || ''} onChange={e => updateCertidao(c.id, { dataEmissao: e.target.value })} style={inputStyle} /></label>
                <label style={labelSmall}>Validade<input type="date" value={c.dataValidade || ''} onChange={e => updateCertidao(c.id, { dataValidade: e.target.value })} style={inputStyle} /></label>
                <label style={labelSmall}>Data Consulta<input type="date" value={c.dataConsulta || ''} onChange={e => updateCertidao(c.id, { dataConsulta: e.target.value })} style={inputStyle} /></label>
            </div>
            {(c.status === 'positiva' || c.status === 'positiva_efeitos_negativa') && (
                <div style={{ marginTop: '0.5rem' }}>
                    <input placeholder="Motivo do impedimento" value={c.motivoImpedimento || ''} onChange={e => updateCertidao(c.id, { motivoImpedimento: e.target.value })}
                        style={{ ...inputStyle, width: '100%' }} />
                </div>
            )}
            {(c.status === 'nao_consultada') && getCertidaoFonte(c) === 'manual' && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#e67e22', fontStyle: 'italic' }}>
                    {c.motivoImpedimento || 'Consulta manual necessaria — acesse o portal do orgao emissor.'}
                </div>
            )}
            {(c.status === 'indisponivel' || c.status === 'nao_consultada') && c.portalUrl && (
                <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <a href={c.portalUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '4px 12px', borderRadius: '8px', background: 'var(--accent)14', border: '1px solid var(--accent)44', color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}>
                        Consultar no Portal Oficial →
                    </a>
                    {c.motivoImpedimento && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.motivoImpedimento}</span>
                    )}
                </div>
            )}
        </div>
    );

    const federais = analise.certidoes.filter(c => c.esfera === 'federal');
    const estaduais = analise.certidoes.filter(c => c.esfera === 'estadual');
    const municipais = analise.certidoes.filter(c => c.esfera === 'municipal');

    return (
        <div>
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button onClick={addCertidao} style={btnStyle}>+ Adicionar Certidao</button>
                <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
            </div>

            {federais.length > 0 && (
                <>
                    {renderEsferaSectionHeader('federal')}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        {federais.map(renderCertidaoCard)}
                    </div>
                </>
            )}

            {estaduais.length > 0 && (
                <>
                    {renderEsferaSectionHeader('estadual', activeUf || undefined)}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        {estaduais.map(renderCertidaoCard)}
                    </div>
                </>
            )}

            {municipais.length > 0 && (
                <>
                    {renderEsferaSectionHeader('municipal', activeMunicipio || undefined)}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        {municipais.map(renderCertidaoCard)}
                    </div>
                </>
            )}
        </div>
    );
};

export default CertidoesTab;
