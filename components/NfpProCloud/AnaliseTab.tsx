/**
 * components/NfpProCloud/AnaliseTab.tsx
 *
 * Aba "Iniciar Analise" -- escolhe fonte de dados (certificado do
 * escritorio / do cliente / offline) + dispara analise vazia (empresa
 * normal) ou analise REAL via SERPRO.
 *
 * Em modo prospect, mostra badge "Modo Prospect" + form de upload de
 * certificado A1 (necessario pra analise real do prospect via SEFAZ).
 *
 * O botao "Iniciar Analise" cria empresa estrutura zerada e abre o
 * dashboard. O botao "Iniciar Analise Real" chama o callback que
 * consome SERPRO (situacao fiscal, divida ativa, certidoes, etc).
 */
import React from 'react';
import type { NfpAnaliseEmpresa } from '../../types';
import CertificadoEmpresaUpload from '../CertificadoEmpresaUpload';
import { cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave } from './_common';
import ManualSituacaoFiscalForm, { type NfpManualSituacaoFiscalPayload } from './ManualSituacaoFiscalForm';

interface ProspectData {
    cnpj: string;
    razaoSocial: string;
    nomeFantasia?: string;
}

type FonteAnalise = 'certificado_escritorio' | 'certificado_cliente' | 'offline';

interface Props {
    hasActiveSelection: boolean;
    activeCnpj: string;
    analise: NfpAnaliseEmpresa | null;
    fonteAnalise: FonteAnalise;
    setFonteAnalise: (f: FonteAnalise) => void;
    prospectMode: boolean;
    prospectData: ProspectData | null;
    analiseRealLoading: boolean;
    onIniciarAnalise: () => void;
    onIniciarAnaliseReal: () => Promise<void>;
    onGerarAnaliseManual: (payload: NfpManualSituacaoFiscalPayload) => void;
}

const AnaliseTab: React.FC<Props> = ({
    hasActiveSelection, activeCnpj, analise,
    fonteAnalise, setFonteAnalise,
    prospectMode, prospectData, analiseRealLoading,
    onIniciarAnalise, onIniciarAnaliseReal, onGerarAnaliseManual,
}) => {
    const canStart = hasActiveSelection;
    const canStartReal = hasActiveSelection && !!activeCnpj && !analiseRealLoading;

    return (
        <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Inicie uma nova análise de compliance para {prospectMode ? 'o prospect' : 'a empresa selecionada'}.
                Escolha a fonte dos dados e clique em "Iniciar Análise".
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: fonteAnalise === 'offline' ? '100%' : '500px' }}>
                <label style={labelSmall}>
                    Fonte de Dados
                    <select value={fonteAnalise} onChange={e => setFonteAnalise(e.target.value as FonteAnalise)} style={{ ...inputStyle, width: '100%', marginTop: '4px' }}>
                        <option value="certificado_escritorio">Certificado Digital do Escritorio</option>
                        <option value="certificado_cliente">Certificado Digital do Cliente</option>
                        <option value="offline">Offline (lancamento manual)</option>
                    </select>
                </label>

                {prospectMode && prospectData && fonteAnalise === 'certificado_cliente' && (
                    <div style={{ ...cardStyle, borderLeft: '4px solid var(--accent)' }}>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                            Upload do Certificado Digital A1 (necessario para analise real via SEFAZ)
                        </p>
                        <CertificadoEmpresaUpload
                            empresaId={`prospect_${prospectData.cnpj}`}
                            empresaNome={prospectData.nomeFantasia || prospectData.razaoSocial}
                            empresaCnpj={prospectData.cnpj}
                        />
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
                            {analiseRealLoading ? 'Consultando SERPRO...' : 'Iniciar Analise Real'}
                        </button>
                        {analiseRealLoading && (
                            <p style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>
                                Consultando situacao fiscal, divida ativa, certidoes, obrigacoes e parcelamentos via SERPRO...
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
        </div>
    );
};

export default AnaliseTab;
