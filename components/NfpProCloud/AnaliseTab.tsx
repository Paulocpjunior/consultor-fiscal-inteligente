/**
 * components/NfpProCloud/AnaliseTab.tsx
 *
 * Aba "Análise" — ponto de partida das análises de compliance.
 *
 * Cenário 1 (cliente cadastrado): escolhe fonte de dados (certificado do
 * escritório / do cliente / offline) + dispara análise vazia ou análise REAL
 * via SERPRO.
 *
 * Cenário 2 (prospect, por CNPJ): duas formas de trabalho, com os MESMOS
 * preenchimentos, plano de ação e análise de IA:
 *   a) Inclusão Manual — o colaborador lança os apontamentos diagnosticados;
 *   b) Certificado Digital do Cliente — o cliente fornece o A1, e a
 *      ferramenta faz a mesma varredura de forma automática. A varredura só
 *      libera após upload de certificado válido (CNPJ batendo e na validade).
 *
 * Ao final de qualquer fluxo, a seção "Análise da IA" gera o parecer sobre o
 * mesmo objeto de análise — idêntico independentemente da origem dos dados.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import type { NfpAnaliseEmpresa } from '../../types';
import CertificadoEmpresaUpload from '../CertificadoEmpresaUpload';
import { cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave } from './_common';
import ManualSituacaoFiscalForm, { type NfpManualSituacaoFiscalPayload } from './ManualSituacaoFiscalForm';
import ConsultasAvulsas from './ConsultasAvulsas';

interface ProspectData {
    cnpj: string;
    razaoSocial: string;
    nomeFantasia?: string;
}

type FonteAnalise = 'certificado_escritorio' | 'certificado_cliente' | 'offline';

interface CertClienteInfo {
    cnpj: string;
    notAfter: string;
}

interface Props {
    hasActiveSelection: boolean;
    activeCnpj: string;
    analise: NfpAnaliseEmpresa | null;
    fonteAnalise: FonteAnalise;
    setFonteAnalise: (f: FonteAnalise) => void;
    prospectMode: boolean;
    prospectData: ProspectData | null;
    analiseRealLoading: boolean;
    analiseIALoading: boolean;
    exportingPdf: boolean;
    onIniciarAnalise: () => void;
    onIniciarAnaliseReal: () => Promise<void>;
    onGerarAnaliseManual: (payload: NfpManualSituacaoFiscalPayload) => void;
    onGerarAnaliseIA: () => Promise<void>;
    onExportPdf: () => void;
}

const AnaliseTab: React.FC<Props> = ({
    hasActiveSelection, activeCnpj, analise,
    fonteAnalise, setFonteAnalise,
    prospectMode, prospectData, analiseRealLoading, analiseIALoading, exportingPdf,
    onIniciarAnalise, onIniciarAnaliseReal, onGerarAnaliseManual, onGerarAnaliseIA, onExportPdf,
}) => {
    const canStart = hasActiveSelection;

    // ─── Certificado do cliente (prospect) ─────────────────────────────────
    const prospectEmpresaId = prospectData ? `prospect_${prospectData.cnpj}` : '';
    const [certCliente, setCertCliente] = useState<CertClienteInfo | null>(null);
    const [certClienteLoading, setCertClienteLoading] = useState(false);

    const fetchCertCliente = useCallback(async () => {
        if (!prospectEmpresaId) { setCertCliente(null); return; }
        setCertClienteLoading(true);
        try {
            const user = getAuth().currentUser;
            if (!user) throw new Error('sem sessão');
            const token = await user.getIdToken();
            const res = await fetch(`/api/admin/cert-empresa/info/${prospectEmpresaId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) { setCertCliente(null); return; }
            const data = await res.json();
            setCertCliente(data?.exists === false || !data?.cnpj ? null : { cnpj: data.cnpj, notAfter: data.notAfter });
        } catch {
            setCertCliente(null);
        } finally {
            setCertClienteLoading(false);
        }
    }, [prospectEmpresaId]);

    useEffect(() => {
        if (prospectMode && fonteAnalise === 'certificado_cliente') fetchCertCliente();
    }, [prospectMode, fonteAnalise, fetchCertCliente]);

    const certClienteValido = !!certCliente
        && certCliente.cnpj.replace(/\D/g, '') === (prospectData?.cnpj || '').replace(/\D/g, '')
        && (!certCliente.notAfter || new Date(certCliente.notAfter).getTime() > Date.now());

    const canStartReal = hasActiveSelection && !!activeCnpj && !analiseRealLoading
        && (!prospectMode || fonteAnalise !== 'certificado_cliente' || certClienteValido);

    // ─── Cartões de escolha do modo prospect ───────────────────────────────
    const renderProspectModeCards = () => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
            {([
                {
                    key: 'certificado_cliente' as FonteAnalise,
                    titulo: 'Certificado Digital do Cliente',
                    descricao: 'O cliente fornece o certificado A1 e a ferramenta faz a varredura completa de forma automática (débitos, certidões, obrigações, parcelamentos).',
                },
                {
                    key: 'offline' as FonteAnalise,
                    titulo: 'Inclusão Manual pelo Colaborador',
                    descricao: 'O colaborador lança manualmente os apontamentos diagnosticados. Mesmos preenchimentos, plano de ação e análise de IA da varredura automática.',
                },
            ]).map(op => {
                const ativo = fonteAnalise === op.key;
                return (
                    <button
                        key={op.key}
                        onClick={() => setFonteAnalise(op.key)}
                        style={{
                            ...cardStyle,
                            textAlign: 'left', cursor: 'pointer',
                            border: ativo ? '2px solid var(--accent)' : '1px solid var(--border-default)',
                            background: ativo ? 'var(--accent)11' : 'var(--bg-card)',
                        }}
                    >
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: ativo ? 'var(--accent)' : 'var(--text-primary)', marginBottom: '4px' }}>
                            {op.titulo}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{op.descricao}</div>
                    </button>
                );
            })}
        </div>
    );

    return (
        <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                {prospectMode
                    ? 'Escolha como atuar com o prospect: varredura automática com o certificado digital fornecido pelo cliente, ou inclusão manual dos apontamentos diagnosticados.'
                    : 'Inicie uma nova análise de compliance para a empresa selecionada. Escolha a fonte dos dados e clique em "Iniciar Análise".'}
            </p>

            {prospectMode && (
                <span style={{
                    display: 'inline-block', marginBottom: '1rem', padding: '3px 10px',
                    borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                    background: 'var(--accent)22', color: 'var(--accent)',
                    border: '1px solid var(--accent)44',
                }}>
                    Modo Prospect
                </span>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: fonteAnalise === 'offline' ? '100%' : '640px' }}>
                {prospectMode ? renderProspectModeCards() : (
                    <label style={labelSmall}>
                        Fonte de Dados
                        <select value={fonteAnalise} onChange={e => setFonteAnalise(e.target.value as FonteAnalise)} style={{ ...inputStyle, width: '100%', marginTop: '4px' }}>
                            <option value="certificado_escritorio">Certificado Digital do Escritorio</option>
                            <option value="certificado_cliente">Certificado Digital do Cliente</option>
                            <option value="offline">Offline (lancamento manual)</option>
                        </select>
                    </label>
                )}

                {prospectMode && prospectData && fonteAnalise === 'certificado_cliente' && (
                    <div style={{ ...cardStyle, borderLeft: '4px solid var(--accent)' }}>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                            Upload do Certificado Digital A1 fornecido pelo cliente. Com ele, a varredura automática
                            faz os mesmos levantamentos do preenchimento manual.
                        </p>
                        <CertificadoEmpresaUpload
                            empresaId={prospectEmpresaId}
                            empresaNome={prospectData.nomeFantasia || prospectData.razaoSocial}
                            empresaCnpj={prospectData.cnpj}
                            onChange={fetchCertCliente}
                        />
                        {!certClienteLoading && !certClienteValido && (
                            <p style={{ color: 'var(--warning, #d97706)', fontSize: '0.8rem', marginTop: '0.75rem' }}>
                                A varredura automática libera após o upload de um certificado válido do CNPJ do prospect.
                            </p>
                        )}
                    </div>
                )}

                {fonteAnalise === 'offline' ? (
                    <ManualSituacaoFiscalForm
                        disabled={!canStart}
                        onGerarAnaliseManual={onGerarAnaliseManual}
                    />
                ) : (
                    <>
                        <button
                            disabled={!canStart}
                            onClick={onIniciarAnalise}
                            style={{ ...btnStyle, opacity: canStart ? 1 : 0.5 }}
                        >
                            Iniciar Analise
                        </button>
                        <button
                            disabled={!canStartReal}
                            onClick={onIniciarAnaliseReal}
                            style={{
                                ...btnStyleSave,
                                opacity: canStartReal ? 1 : 0.5,
                            }}
                        >
                            {analiseRealLoading
                                ? 'Consultando...'
                                : prospectMode ? 'Iniciar Varredura Automática' : 'Iniciar Analise Real'}
                        </button>
                        {analiseRealLoading && (
                            <p style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>
                                Consultando situacao fiscal, divida ativa, certidoes, obrigacoes e parcelamentos...
                            </p>
                        )}
                    </>
                )}
                {analise && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        Ultima analise: {new Date(analise.dataAnalise).toLocaleDateString('pt-BR')} por {analise.analisadoPor} (fonte: {analise.fonte})
                    </p>
                )}
            </div>

            {/* ─── Consultas avulsas ─────────────────────────────────────────
                Mora AQUI, e não numa aba própria, porque é aqui que a pessoa
                está quando a varredura falha em UMA das cinco consultas — o
                caminho tem de nascer onde a dúvida nasce (a lição do card CFOP
                que não levava ao CFOP, 18/08). */}
            {hasActiveSelection && <ConsultasAvulsas cnpj={activeCnpj} />}

            {/* ─── Análise da IA — mesma para os dois fluxos ─────────────────── */}
            {analise && (
                <div style={{ ...cardStyle, marginTop: '1.5rem', borderLeft: '4px solid #9333ea' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <h3 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Análise da IA</h3>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                                onClick={onExportPdf}
                                disabled={exportingPdf}
                                style={{ ...btnStyle, opacity: exportingPdf ? 0.5 : 1 }}
                            >
                                {exportingPdf ? 'Gerando PDF...' : 'Exportar Relatório PDF'}
                            </button>
                            <button
                                onClick={onGerarAnaliseIA}
                                disabled={analiseIALoading}
                                style={{ ...btnStyleSave, opacity: analiseIALoading ? 0.5 : 1 }}
                            >
                                {analiseIALoading ? 'Gerando parecer...' : analise.analiseIA ? 'Atualizar Análise da IA' : 'Gerar Análise da IA'}
                            </button>
                        </div>
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                        Parecer gerado sobre os apontamentos desta análise (débitos, certidões, obrigações,
                        parcelamentos, ações e plano de ação) — o mesmo formato para inclusão manual e varredura automática.
                    </p>
                    {analise.analiseIA ? (
                        <>
                            <div style={{
                                whiteSpace: 'pre-wrap', fontSize: '0.875rem', lineHeight: 1.6,
                                color: 'var(--text-primary)', background: 'var(--bg-elevated)',
                                border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '1rem',
                            }}>
                                {analise.analiseIA.texto}
                            </div>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                                Gerado em {new Date(analise.analiseIA.geradoEm).toLocaleString('pt-BR')}
                                {analise.analiseIA.geradoPor ? ` por ${analise.analiseIA.geradoPor}` : ''}
                                {analise.analiseIA.fonteDados ? ` — dados via ${analise.analiseIA.fonteDados === 'offline' ? 'inclusão manual' : analise.analiseIA.fonteDados === 'certificado_cliente' ? 'certificado do cliente' : 'certificado do escritório'}` : ''}
                            </p>
                        </>
                    ) : (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            Nenhum parecer gerado ainda. Preencha ou execute a análise e clique em "Gerar Análise da IA".
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default AnaliseTab;
