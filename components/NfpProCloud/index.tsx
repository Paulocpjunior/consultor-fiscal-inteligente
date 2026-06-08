/**
 * NFP Pro Cloud — Painel de compliance tributário.
 *
 * Abas: Dashboard | Débitos | Obrigações | Certidões | Parcelamentos |
 *       Ações Judiciais | Plano de Ação | Análise
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import type {
    User,
    CnpjData,
    NfpAnaliseEmpresa,
    NfpDebito,
    NfpParcelamento,
    NfpCertidao,
    NfpObrigacao,
    NfpAcaoJudicial,
    NfpPlanoAcao,
    NfpEsfera,
    NfpGravidade,
    NfpStatusDebito,
    NfpStatusCertidao,
    NfpStatusObrigacao,
    NfpTipoAcao,
} from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import * as nfpService from '../../services/nfpProCloudService';
import { auth } from '../../services/firebaseConfig';
import {
    gerarPerfilTributario,
    inferirAtividadePorCnae,
    inferirRegimePorFonte,
    regimeLabel,
    atividadeLabel,
    type TaxProfile,
    type RegimeTributario,
} from '../../services/nfpTaxRulesEngine';

import CertificadoEmpresaUpload from '../CertificadoEmpresaUpload';
import CertidoesTab from './CertidoesTab';
import DebitosTab from './DebitosTab';
import ObrigacoesTab from './ObrigacoesTab';
import ParcelamentosTab from './ParcelamentosTab';
import AcoesTab from './AcoesTab';
import PlanoAcaoTab from './PlanoAcaoTab';
import TaxProfileCard from './TaxProfileCard';
import DashboardTab from './DashboardTab';
import {
    OBRIGACOES_BASE, CERTIDOES_BASE, uid, formatCurrency, gravityColor, certidaoColor, certidaoLabel,
    cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave,
    renderEsferaSectionHeader, renderFonteBadge,
} from './_common';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

type Tab = 'dashboard' | 'debitos' | 'obrigacoes' | 'certidoes' | 'parcelamentos' | 'acoes' | 'plano' | 'analise';

const TABS: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'debitos', label: 'Débitos' },
    { key: 'obrigacoes', label: 'Obrigações' },
    { key: 'certidoes', label: 'Certidões' },
    { key: 'parcelamentos', label: 'Parcelamentos' },
    { key: 'acoes', label: 'Ações Judiciais' },
    { key: 'plano', label: 'Plano de Ação' },
    { key: 'analise', label: 'Análise' },
];



/** Aplica máscara XX.XXX.XXX/XXXX-XX ao digitar. */
function applyCnpjMask(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 14);
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

/** Dados estendidos do prospect (BrasilAPI retorna situacao_cadastral). */
interface ProspectData extends CnpjData {
    cnpj: string;
    situacaoCadastral: string;
    descricaoSituacaoCadastral: string;
    opcaoSimples?: boolean | null;
    opcaoMei?: boolean | null;
    porte?: string;
    naturezaJuridica?: string;
}

const NfpProCloud: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [tab, setTab] = useState<Tab>('dashboard');
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [selectedEmpresaId, setSelectedEmpresaId] = useState<string>('');
    const [analise, setAnalise] = useState<NfpAnaliseEmpresa | null>(null);
    const [loading, setLoading] = useState(false);
    const [taxaSelic, setTaxaSelic] = useState(13.25);
    const [exportingPdf, setExportingPdf] = useState(false);

    // Análise tab state
    const [fonteAnalise, setFonteAnalise] = useState<'certificado_escritorio' | 'certificado_cliente' | 'offline'>('certificado_escritorio');
    const [analiseRealLoading, setAnaliseRealLoading] = useState(false);

    // Prospect mode state
    const [prospectMode, setProspectMode] = useState(false);
    const [prospectCnpjInput, setProspectCnpjInput] = useState('');
    const [prospectLoading, setProspectLoading] = useState(false);
    const [prospectError, setProspectError] = useState('');
    const [prospectData, setProspectData] = useState<ProspectData | null>(null);

    // Tax rules engine state
    const [taxProfile, setTaxProfile] = useState<TaxProfile | null>(null);
    const [prospectRegime, setProspectRegime] = useState<RegimeTributario>('simples_nacional');

    useEffect(() => {
        getEmpresasDisponiveis(currentUser).then(setEmpresas).catch(() => {});
    }, [currentUser]);

    // Load analysis when empresa changes
    useEffect(() => {
        if (!selectedEmpresaId) { setAnalise(null); return; }
        setLoading(true);
        nfpService.getAnalise(selectedEmpresaId)
            .then(a => setAnalise(a))
            .catch(() => setAnalise(null))
            .finally(() => setLoading(false));
    }, [selectedEmpresaId]);

    const selectedEmpresa = useMemo(() => empresas.find(e => e.id === selectedEmpresaId), [empresas, selectedEmpresaId]);

    // Compute tax profile when empresa changes (non-prospect mode)
    useEffect(() => {
        if (!selectedEmpresa) { setTaxProfile(null); return; }
        // Try to get CNAE from the empresa data — look up from Simples or Lucro
        // The empresa list comes from xmlFiscalService and has fonte ('simples'|'lucro')
        const regime = inferirRegimePorFonte(selectedEmpresa.fonte);
        // CNAE is not available on EmpresaXmlOption directly; will be populated
        // from analysis or prospect. For now, create a basic profile.
        const profile = gerarPerfilTributario({ cnae: '', regime });
        setTaxProfile(profile);
    }, [selectedEmpresa]);

    // Derived helpers for prospect mode
    const prospectCnpjClean = useMemo(() => prospectCnpjInput.replace(/\D/g, ''), [prospectCnpjInput]);
    const activeEmpresaId = prospectMode && prospectData ? `prospect_${prospectData.cnpj}` : selectedEmpresaId;
    const activeCnpj = prospectMode && prospectData ? prospectData.cnpj : (selectedEmpresa?.cnpj || '');
    const activeNome = prospectMode && prospectData ? (prospectData.nomeFantasia || prospectData.razaoSocial) : (selectedEmpresa?.nome || '');
    const activeUf = prospectMode && prospectData ? (prospectData.uf || '') : (selectedEmpresa?.uf || '');
    const activeMunicipio = prospectMode && prospectData ? (prospectData.municipio || '') : (selectedEmpresa?.municipio || '');
    const hasActiveSelection = prospectMode ? !!prospectData : !!selectedEmpresaId;

    // Reset prospect state when toggling modes
    useEffect(() => {
        if (!prospectMode) {
            setProspectData(null);
            setProspectCnpjInput('');
            setProspectError('');
        } else {
            setSelectedEmpresaId('');
            setAnalise(null);
        }
    }, [prospectMode]);

    // When prospect mode, default fonte to certificado_cliente
    useEffect(() => {
        if (prospectMode) {
            setFonteAnalise('certificado_cliente');
        }
    }, [prospectMode]);

    // Compute tax profile when prospect data or prospect regime changes
    useEffect(() => {
        if (!prospectMode || !prospectData) { return; }
        const cnae = prospectData.cnaePrincipal?.codigo || '';
        const desc = prospectData.cnaePrincipal?.descricao || '';
        const profile = gerarPerfilTributario({ cnae, descricaoCnae: desc, regime: prospectRegime });
        setTaxProfile(profile);
    }, [prospectMode, prospectData, prospectRegime]);

    /** Consultar CNPJ do prospect via BrasilAPI. */
    const handleProspectLookup = useCallback(async () => {
        const cnpj = prospectCnpjInput.replace(/\D/g, '');
        if (cnpj.length !== 14) {
            setProspectError('CNPJ deve conter 14 dígitos.');
            return;
        }
        setProspectLoading(true);
        setProspectError('');
        setProspectData(null);
        setAnalise(null);

        try {
            const token = await auth?.currentUser?.getIdToken();
            const resp = await fetch(`/api/admin/cnpj-lookup/${cnpj}`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `Erro ${resp.status}`);
            }
            const raw = await resp.json();

            const situacao = String(raw.situacao_cadastral ?? '');
            let descSituacao = raw.descricao_situacao_cadastral || '';
            if (!descSituacao) {
                const map: Record<string, string> = { '2': 'Ativa', '3': 'Suspensa', '4': 'Inapta', '8': 'Baixada' };
                descSituacao = map[situacao] || situacao;
            }

            const opcaoSimples = raw.opcao_simples ?? raw.opcao_pelo_simples ?? null;
            const opcaoMei = raw.opcao_mei ?? null;
            const porte = raw.porte || raw.descricao_porte || '';
            const naturezaJuridica = raw.natureza_juridica || '';

            const data: ProspectData = {
                razaoSocial: raw.razao_social || raw.nome_fantasia || '',
                nomeFantasia: raw.nome_fantasia || '',
                cnaePrincipal: {
                    codigo: raw.cnae_fiscal?.toString() || '',
                    descricao: raw.cnae_fiscal_descricao || '',
                },
                cnaesSecundarios: (raw.cnaes_secundarios || []).map((c: any) => ({
                    codigo: c.codigo?.toString() || '',
                    descricao: c.descricao || '',
                })),
                logradouro: raw.logradouro || '',
                numero: raw.numero || '',
                bairro: raw.bairro || '',
                municipio: raw.municipio || '',
                uf: raw.uf || '',
                cep: raw.cep || '',
                dataAbertura: raw.data_inicio_atividade || '',
                cnpj,
                situacaoCadastral: situacao,
                descricaoSituacaoCadastral: descSituacao,
                opcaoSimples,
                opcaoMei,
                porte,
                naturezaJuridica,
            };
            setProspectData(data);

            // Auto-infer regime from API response
            if (opcaoMei === true) {
                setProspectRegime('mei');
            } else if (opcaoSimples === true) {
                setProspectRegime('simples_nacional');
            } else {
                setProspectRegime('lucro_presumido');
            }

            onShowToast?.(`Empresa encontrada: ${data.razaoSocial}`);
        } catch (e: any) {
            setProspectError(e?.message || 'Erro ao consultar CNPJ.');
        } finally {
            setProspectLoading(false);
        }
    }, [prospectCnpjInput, onShowToast]);

    // Helpers to mutate analysis in state
    const updateAnalise = useCallback((patch: Partial<NfpAnaliseEmpresa>) => {
        setAnalise(prev => {
            if (!prev) return prev;
            return { ...prev, ...patch };
        });
    }, []);

    const saveAnalise = useCallback(async (a: NfpAnaliseEmpresa) => {
        if (!currentUser) return;
        try {
            await nfpService.salvarAnalise(a, currentUser);
            onShowToast?.('Análise salva com sucesso');
        } catch (e: any) {
            onShowToast?.('Erro ao salvar: ' + (e?.message || 'desconhecido'));
        }
    }, [currentUser, onShowToast]);

    const createEmptyAnalise = useCallback((): NfpAnaliseEmpresa => {
        // When a TaxProfile is available, use its rules-driven lists
        const certidoesSrc = taxProfile
            ? taxProfile.certidoesObrigatorias.map(c => ({
                esfera: c.esfera as NfpEsfera,
                orgao: c.orgao,
                tipo: c.tipo,
            }))
            : CERTIDOES_BASE.map(c => ({ esfera: c.esfera, orgao: c.orgao, tipo: c.tipo }));

        const obrigacoesSrc = taxProfile
            ? taxProfile.obrigacoesObrigatorias.map(o => ({
                nome: o.nome,
                sigla: o.sigla,
                esfera: o.esfera as NfpEsfera,
                periodicidade: o.periodicidade as 'mensal' | 'trimestral' | 'anual' | 'eventual',
            }))
            : OBRIGACOES_BASE.map(o => ({ nome: o.nome, sigla: o.sigla, esfera: o.esfera, periodicidade: o.periodicidade }));

        return {
            empresaId: activeEmpresaId,
            empresaNome: activeNome,
            empresaCnpj: activeCnpj,
            dataAnalise: new Date().toISOString(),
            analisadoPor: currentUser?.name || '',
            fonte: fonteAnalise,
            debitos: [],
            parcelamentos: [],
            certidoes: certidoesSrc.map(c => ({
                id: uid(),
                empresaId: activeEmpresaId,
                esfera: c.esfera,
                orgao: c.orgao,
                tipo: c.tipo,
                status: 'nao_consultada' as NfpStatusCertidao,
            })),
            obrigacoes: obrigacoesSrc.map(o => ({
                id: uid(),
                empresaId: activeEmpresaId,
                nome: o.nome,
                sigla: o.sigla,
                esfera: o.esfera,
                periodicidade: o.periodicidade,
                status: 'nao_verificada' as NfpStatusObrigacao,
            })),
            acoes: [],
            planoAcao: [],
        };
    }, [activeEmpresaId, activeNome, activeCnpj, currentUser, fonteAnalise, taxProfile]);

    // ─── Esfera Section Helpers ────────────────────────────────────────────




    // ─── Render Helpers ─────────────────────────────────────────────────────

    const renderTaxProfileCard = () => <TaxProfileCard taxProfile={taxProfile} />;

    const exportarRelatorioPdf = useCallback(async () => {
        if (!analise) return;
        setExportingPdf(true);
        try {
            const { gerarRelatorioPdfNfp } = await import("../../services/nfpProCloudPdf");
            const { blob, nomeArquivo } = await gerarRelatorioPdfNfp({ analise, taxaSelic, taxProfile });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = nomeArquivo;
            a.click();
            URL.revokeObjectURL(url);
            onShowToast?.("Relatorio fiscal exportado em PDF.");
        } catch (e) {
            console.error("Erro ao gerar PDF:", e);
            onShowToast?.("Falha ao gerar o relatorio PDF.");
        } finally {
            setExportingPdf(false);
        }
    }, [analise, taxaSelic, taxProfile, onShowToast]);
    const renderDashboard = () => (
        <DashboardTab
            analise={analise}
            exportingPdf={exportingPdf}
            onExportPdf={exportarRelatorioPdf}
        />
    );

    const renderDebitos = () => analise && (
        <DebitosTab
            analise={analise}
            activeEmpresaId={activeEmpresaId}
            activeUf={activeUf}
            activeMunicipio={activeMunicipio}
            taxaSelic={taxaSelic}
            setTaxaSelic={setTaxaSelic}
            setAnalise={setAnalise}
            updateAnalise={updateAnalise}
            saveAnalise={saveAnalise}
            renderEsferaSectionHeader={renderEsferaSectionHeader}
        />
    );

    const renderObrigacoes = () => analise && (
        <ObrigacoesTab
            analise={analise}
            activeEmpresaId={activeEmpresaId}
            activeUf={activeUf}
            activeMunicipio={activeMunicipio}
            updateAnalise={updateAnalise}
            saveAnalise={saveAnalise}
            renderEsferaSectionHeader={renderEsferaSectionHeader}
        />
    );

    const renderCertidoes = () => analise && (
        <CertidoesTab
            analise={analise}
            activeEmpresaId={activeEmpresaId}
            activeUf={activeUf}
            activeMunicipio={activeMunicipio}
            updateAnalise={updateAnalise}
            saveAnalise={saveAnalise}
            renderEsferaSectionHeader={renderEsferaSectionHeader}
            renderFonteBadge={renderFonteBadge}
        />
    );

    const renderParcelamentos = () => analise && (
        <ParcelamentosTab
            analise={analise}
            selectedEmpresaId={selectedEmpresaId}
            updateAnalise={updateAnalise}
            saveAnalise={saveAnalise}
        />
    );

    const renderAcoes = () => analise && (
        <AcoesTab
            analise={analise}
            selectedEmpresaId={selectedEmpresaId}
            updateAnalise={updateAnalise}
            saveAnalise={saveAnalise}
        />
    );

    const renderPlanoAcao = () => analise && (
        <PlanoAcaoTab
            analise={analise}
            selectedEmpresaId={selectedEmpresaId}
            updateAnalise={updateAnalise}
            saveAnalise={saveAnalise}
        />
    );

    const handleAnaliseReal = useCallback(async () => {
        if (!activeCnpj) return;
        setAnaliseRealLoading(true);
        try {
            const resp = await nfpService.analisarEmpresaCompleta(activeCnpj, taxProfile?.regime || prospectRegime || 'lucro_presumido', activeUf || undefined);
            // Create or update analysis from SERPRO response
            const base = analise || createEmptyAnalise();

            // Populate debitos from situacaoFiscal + dividaAtiva
            const debitos: NfpDebito[] = [];
            if (resp.situacaoFiscal?.ok && resp.situacaoFiscal.debitos) {
                for (const d of resp.situacaoFiscal.debitos) {
                    debitos.push({
                        id: uid(), empresaId: activeEmpresaId, esfera: 'federal' as NfpEsfera,
                        orgao: 'Receita Federal', descricao: d.tributo || d.descricao || 'Débito Federal',
                        valorOriginal: Number(d.valorOriginal || 0), dataVencimento: d.competencia || new Date().toISOString().slice(0, 10),
                        status: (d.status === 'quitado' ? 'quitado' : 'aberto') as NfpStatusDebito,
                    });
                }
            }
            if (resp.dividaAtiva?.ok && resp.dividaAtiva.inscricoes) {
                for (const i of resp.dividaAtiva.inscricoes) {
                    debitos.push({
                        id: uid(), empresaId: activeEmpresaId, esfera: 'federal' as NfpEsfera,
                        orgao: 'PGFN', descricao: `Dívida Ativa ${i.numero || ''}`.trim(),
                        valorOriginal: Number(i.valorConsolidado || 0), dataVencimento: i.dataInscricao || new Date().toISOString().slice(0, 10),
                        status: 'aberto' as NfpStatusDebito,
                    });
                }
            }

            // Populate certidoes — map SERPRO response (which uses esfera 'fgts'/'trabalhista')
            // to our CERTIDOES_BASE (which uses esfera 'federal' for all federal-scope CNDs)
            const certidoes: NfpCertidao[] = CERTIDOES_BASE.map(c => {
                const match = resp.certidoes?.certidoes?.find((rc: any) => {
                    const esf = String(rc.esfera || '').toLowerCase();
                    if (c.esfera === 'federal' && c.tipo.includes('CND Federal') && esf === 'federal') return true;
                    if (c.esfera === 'estadual' && esf === 'estadual') return true;
                    if (c.tipo.includes('CNDT') && esf === 'trabalhista') return true;
                    if (c.tipo.includes('FGTS') && esf === 'fgts') return true;
                    return false;
                });
                return {
                    id: uid(), empresaId: activeEmpresaId, esfera: c.esfera,
                    orgao: match?.orgao || c.orgao, tipo: match?.tipo || c.tipo,
                    status: (match?.status as NfpStatusCertidao) || 'nao_consultada',
                    dataValidade: match?.validade || undefined,
                    dataEmissao: match?.dataEmissao || undefined,
                    numeroCertidao: match?.numero || undefined,
                    motivoImpedimento: match?.motivo || undefined,
                    pdfBase64: match?.pdfBase64 || undefined,
                    fonte: (match?.fonte || undefined) as any,
                    portalUrl: match?.portalUrl || undefined,
                    dataConsulta: match ? new Date().toISOString().slice(0, 10) : undefined,
                };
            });

            // Populate obrigacoes
            const obrigacoes: NfpObrigacao[] = OBRIGACOES_BASE.map(o => {
                const match = resp.obrigacoes?.obrigacoes?.find((ro: any) =>
                    (ro.sigla || '').toUpperCase() === o.sigla.toUpperCase()
                );
                return {
                    id: uid(), empresaId: activeEmpresaId,
                    nome: o.nome, sigla: o.sigla, esfera: o.esfera, periodicidade: o.periodicidade,
                    status: (match?.status as NfpStatusObrigacao) || 'nao_verificada',
                    competencia: match?.competencia || undefined,
                };
            });

            // Populate parcelamentos
            const parcelamentos: NfpParcelamento[] = [];
            if (resp.parcelamentos?.ok && resp.parcelamentos.parcelamentos) {
                for (const p of resp.parcelamentos.parcelamentos) {
                    parcelamentos.push({
                        id: uid(), empresaId: activeEmpresaId, esfera: 'federal' as NfpEsfera,
                        programa: p.programa || '', valorTotal: Number(p.valorTotal || 0),
                        parcelas: Number(p.parcelas || 0), parcelasPagas: Number(p.parcelasPagas || 0),
                        valorParcela: p.parcelas > 0 ? Math.round((p.valorTotal / p.parcelas) * 100) / 100 : 0,
                        status: (p.status || 'ativo') as any, dataInicio: p.dataInicio || new Date().toISOString().slice(0, 10),
                    });
                }
            }

            const updated: NfpAnaliseEmpresa = {
                ...base,
                dataAnalise: new Date().toISOString(),
                analisadoPor: currentUser?.name || '',
                fonte: fonteAnalise,
                debitos: debitos.length > 0 ? debitos : base.debitos,
                certidoes: resp.certidoes?.ok ? certidoes : base.certidoes,
                obrigacoes: resp.obrigacoes?.ok ? obrigacoes : base.obrigacoes,
                parcelamentos: parcelamentos.length > 0 ? parcelamentos : base.parcelamentos,
            };

            const isMock = resp.situacaoFiscal?.fonte === 'mock' || resp.certidoes?.fonte === 'mock';
            if (isMock) {
                (updated as any)._serproMock = true;
            }

            setAnalise(updated);
            if (!prospectMode) {
                await saveAnalise(updated);
            }
            onShowToast?.(isMock
                ? 'Análise concluída com DADOS SIMULADOS (SERPRO em modo teste)'
                : 'Análise real SERPRO concluída com sucesso');
            setTab('dashboard');
        } catch (e: any) {
            onShowToast?.('Erro na análise real: ' + (e?.message || 'desconhecido'));
        } finally {
            setAnaliseRealLoading(false);
        }
    }, [activeCnpj, activeEmpresaId, analise, createEmptyAnalise, currentUser, fonteAnalise, prospectMode, saveAnalise, onShowToast]);

    const renderAnalise = () => {
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '500px' }}>
                    <label style={labelSmall}>
                        Fonte de Dados
                        <select value={fonteAnalise} onChange={e => setFonteAnalise(e.target.value as any)} style={{ ...inputStyle, width: '100%', marginTop: '4px' }}>
                            <option value="certificado_escritorio">Certificado Digital do Escritorio</option>
                            <option value="certificado_cliente">Certificado Digital do Cliente</option>
                            <option value="offline">Offline (lancamento manual)</option>
                        </select>
                    </label>

                    {/* Certificate upload for prospect mode */}
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

                    <button
                        disabled={!canStart}
                        onClick={() => {
                            const nova = createEmptyAnalise();
                            setAnalise(nova);
                            if (!prospectMode) saveAnalise(nova);
                            setTab('dashboard');
                        }}
                        style={{ ...btnStyle, opacity: canStart ? 1 : 0.5 }}
                    >
                        Iniciar Analise
                    </button>
                    <button
                        disabled={!canStartReal}
                        onClick={handleAnaliseReal}
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
                    {analise && (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            Ultima analise: {new Date(analise.dataAnalise).toLocaleDateString('pt-BR')} por {analise.analisadoPor} (fonte: {analise.fonte})
                        </p>
                    )}
                </div>
            </div>
        );
    };

    // ─── Main Render ────────────────────────────────────────────────────────

    return (
        <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.5rem', margin: 0 }}>Consulta Situação Fiscal</h2>
                {prospectMode && (
                    <span style={{
                        padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                        background: 'var(--accent)22', color: 'var(--accent)', border: '1px solid var(--accent)44',
                    }}>
                        Modo Prospect
                    </span>
                )}
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                Compliance tributario: debitos, certidoes, obrigacoes, parcelamentos e plano de acao.
            </p>

            {/* Mode toggle: Cliente cadastrado vs Prospect */}
            <div style={{
                marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '10px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
            }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Modo:</span>
                <button
                    onClick={() => setProspectMode(false)}
                    style={{
                        padding: '6px 14px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                        border: !prospectMode ? '2px solid var(--accent)' : '1px solid var(--border-default)',
                        background: !prospectMode ? 'var(--accent)11' : 'transparent',
                        color: !prospectMode ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                >
                    Analisar cliente cadastrado
                </button>
                <button
                    onClick={() => setProspectMode(true)}
                    style={{
                        padding: '6px 14px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                        border: prospectMode ? '2px solid var(--accent)' : '1px solid var(--border-default)',
                        background: prospectMode ? 'var(--accent)11' : 'transparent',
                        color: prospectMode ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                >
                    Analisar por CNPJ (prospect)
                </button>
            </div>

            {/* Prospect CNPJ input */}
            {prospectMode && (
                <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                            placeholder="XX.XXX.XXX/XXXX-XX"
                            value={prospectCnpjInput}
                            onChange={e => setProspectCnpjInput(applyCnpjMask(e.target.value))}
                            onKeyDown={e => { if (e.key === 'Enter') handleProspectLookup(); }}
                            style={{
                                ...inputStyle, width: 'auto', minWidth: '220px',
                                fontFamily: 'monospace', fontSize: '0.95rem', letterSpacing: '0.5px',
                            }}
                        />
                        <button
                            onClick={handleProspectLookup}
                            disabled={prospectLoading || prospectCnpjClean.length !== 14}
                            style={{
                                ...btnStyleSave,
                                opacity: (prospectLoading || prospectCnpjClean.length !== 14) ? 0.5 : 1,
                            }}
                        >
                            {prospectLoading ? 'Consultando...' : 'Consultar'}
                        </button>
                    </div>
                    {prospectError && (
                        <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.5rem' }}>{prospectError}</p>
                    )}

                    {/* Prospect company info card */}
                    {prospectData && (
                        <div style={{
                            ...cardStyle, marginTop: '1rem',
                            borderLeft: '4px solid var(--accent)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                <div>
                                    <h3 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0 }}>
                                        {prospectData.razaoSocial}
                                    </h3>
                                    {prospectData.nomeFantasia && (
                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                            {prospectData.nomeFantasia}
                                        </span>
                                    )}
                                </div>
                                {prospectData.descricaoSituacaoCadastral && (() => {
                                    const sit = prospectData.descricaoSituacaoCadastral.toLowerCase();
                                    const isAtiva = sit === 'ativa' || prospectData.situacaoCadastral === '2';
                                    const badgeColor = isAtiva ? 'var(--success)' : 'var(--danger)';
                                    return (
                                        <span style={{
                                            padding: '3px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                                            background: badgeColor + '22', color: badgeColor,
                                            border: `1px solid ${badgeColor}44`,
                                        }}>
                                            {prospectData.descricaoSituacaoCadastral}
                                        </span>
                                    );
                                })()}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem', fontSize: '0.85rem' }}>
                                <div>
                                    <span style={{ color: 'var(--text-muted)' }}>CNPJ: </span>
                                    <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{applyCnpjMask(prospectData.cnpj)}</span>
                                </div>
                                <div>
                                    <span style={{ color: 'var(--text-muted)' }}>CNAE: </span>
                                    <span style={{ color: 'var(--text-primary)' }}>{prospectData.cnaePrincipal.codigo} - {prospectData.cnaePrincipal.descricao}</span>
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Endereco: </span>
                                    <span style={{ color: 'var(--text-primary)' }}>
                                        {[prospectData.logradouro, prospectData.numero, prospectData.bairro, `${prospectData.municipio}/${prospectData.uf}`].filter(Boolean).join(', ')}
                                        {prospectData.cep ? ` - CEP ${prospectData.cep}` : ''}
                                    </span>
                                </div>
                                {prospectData.dataAbertura && (
                                    <div>
                                        <span style={{ color: 'var(--text-muted)' }}>Abertura: </span>
                                        <span style={{ color: 'var(--text-primary)' }}>
                                            {new Date(prospectData.dataAbertura + 'T00:00:00').toLocaleDateString('pt-BR')}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Empresa selector (only in non-prospect mode) */}
            {!prospectMode && (
                <div style={{ marginBottom: '1.5rem' }}>
                    <select
                        value={selectedEmpresaId}
                        onChange={e => setSelectedEmpresaId(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.9rem', minWidth: '300px' }}
                    >
                        <option value="">Selecione uma empresa...</option>
                        {empresas.map(e => (
                            <option key={e.id} value={e.id}>{e.nome} ({e.cnpj})</option>
                        ))}
                    </select>
                    {/* Tax Profile summary card for selected empresa */}
                    {selectedEmpresa && taxProfile && (
                        <div style={{ marginTop: '0.75rem' }}>{renderTaxProfileCard()}</div>
                    )}
                </div>
            )}

            {/* Prospect regime selector + Tax Profile card */}
            {prospectMode && prospectData && (
                <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Regime Tributario:</span>
                        {(['simples_nacional', 'lucro_presumido', 'lucro_real', 'mei'] as RegimeTributario[]).map(r => {
                            const colors: Record<RegimeTributario, string> = {
                                simples_nacional: 'var(--success)',
                                lucro_presumido: 'var(--accent)',
                                lucro_real: '#9333ea',
                                mei: 'var(--text-muted)',
                            };
                            const isActive = prospectRegime === r;
                            return (
                                <button
                                    key={r}
                                    onClick={() => setProspectRegime(r)}
                                    style={{
                                        padding: '4px 12px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                                        border: isActive ? `2px solid ${colors[r]}` : '1px solid var(--border-default)',
                                        background: isActive ? colors[r] + '18' : 'transparent',
                                        color: isActive ? colors[r] : 'var(--text-muted)',
                                    }}
                                >
                                    {regimeLabel(r)}
                                </button>
                            );
                        })}
                    </div>
                    {taxProfile && renderTaxProfileCard()}
                </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '2px', marginBottom: '1.5rem', overflowX: 'auto', borderBottom: '2px solid var(--border-subtle)', paddingBottom: '0' }}>
                {TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        style={{
                            padding: '8px 14px',
                            fontSize: '0.85rem',
                            fontWeight: tab === t.key ? 700 : 500,
                            color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            marginBottom: '-2px',
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            {loading && <p style={{ color: 'var(--text-muted)' }}>Carregando...</p>}
            {!loading && !hasActiveSelection && (
                <p style={{ color: 'var(--text-muted)' }}>
                    {prospectMode
                        ? 'Digite um CNPJ acima e clique em "Consultar" para analisar um prospect.'
                        : 'Selecione uma empresa para visualizar a analise de compliance.'}
                </p>
            )}
            {!loading && hasActiveSelection && (
                <div>
                    {tab === 'dashboard' && renderDashboard()}
                    {tab === 'debitos' && renderDebitos()}
                    {tab === 'obrigacoes' && renderObrigacoes()}
                    {tab === 'certidoes' && renderCertidoes()}
                    {tab === 'parcelamentos' && renderParcelamentos()}
                    {tab === 'acoes' && renderAcoes()}
                    {tab === 'plano' && renderPlanoAcao()}
                    {tab === 'analise' && renderAnalise()}
                </div>
            )}
        </div>
    );
};

// ─── Dashboard Card Component ────────────────────────────────────────────────


// ─── Shared Styles ───────────────────────────────────────────────────────────


export default NfpProCloud;
