/**
 * NFP Pro Cloud — Painel de compliance tributário.
 *
 * Abas: Dashboard | Débitos | Obrigações | Certidões | Parcelamentos |
 *       Ações Judiciais | Plano de Ação | Análise
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
import { mesclarAnaliseComRemota } from '../../services/nfpAnaliseMerge';
import { criarAnaliseManual, gerarPlanoAcaoAutomatico, mesclarPlanoAcao } from '../../services/nfpManualAnalysis';
import { gerarAnaliseIA } from '../../services/nfpAnaliseIA';
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
import TrabalhistaTab from './TrabalhistaTab';
import PlanoAcaoTab from './PlanoAcaoTab';
import TaxProfileCard from './TaxProfileCard';
import DashboardTab from './DashboardTab';
import AnaliseTab from './AnaliseTab';
import type { NfpManualSituacaoFiscalPayload } from './ManualSituacaoFiscalForm';
import {
    OBRIGACOES_BASE, CERTIDOES_BASE, uid, formatCurrency, gravityColor, certidaoColor, certidaoLabel,
    cardStyle, inputStyle, labelSmall, btnStyle, btnStyleSave,
    renderEsferaSectionHeader, renderFonteBadge,
} from './_common';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

type Tab = 'dashboard' | 'debitos' | 'obrigacoes' | 'certidoes' | 'parcelamentos' | 'acoes' | 'trabalhista' | 'plano' | 'analise';

const TABS: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'debitos', label: 'Débitos' },
    { key: 'obrigacoes', label: 'Obrigações' },
    { key: 'certidoes', label: 'Certidões' },
    { key: 'parcelamentos', label: 'Parcelamentos' },
    { key: 'acoes', label: 'Ações Judiciais' },
    { key: 'trabalhista', label: 'Trabalhista' },
    { key: 'plano', label: 'Plano de Ação' },
    { key: 'analise', label: 'Análise' },
];

const EDITABLE_TABS: Tab[] = ['debitos', 'obrigacoes', 'certidoes', 'parcelamentos', 'acoes', 'trabalhista', 'plano'];



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
    // Snapshot da análise como veio do servidor — baseline do merge
    // colaborativo: distingue item removido nesta tela de item lançado por
    // outro colaborador depois do carregamento.
    const analiseBaselineRef = useRef<NfpAnaliseEmpresa | null>(null);
    const [loading, setLoading] = useState(false);
    const [taxaSelic, setTaxaSelic] = useState(13.25);
    const [exportingPdf, setExportingPdf] = useState(false);

    // Análise tab state
    const [fonteAnalise, setFonteAnalise] = useState<'certificado_escritorio' | 'certificado_cliente' | 'offline'>('certificado_escritorio');
    const [analiseRealLoading, setAnaliseRealLoading] = useState(false);
    const [analiseIALoading, setAnaliseIALoading] = useState(false);

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
        if (!selectedEmpresaId) { setAnalise(null); analiseBaselineRef.current = null; return; }
        setLoading(true);
        nfpService.getAnalise(selectedEmpresaId)
            .then(a => { setAnalise(a); analiseBaselineRef.current = a; })
            .catch(() => { setAnalise(null); analiseBaselineRef.current = null; })
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
            analiseBaselineRef.current = null;
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
        analiseBaselineRef.current = null;

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

            const savedAnalise = await nfpService.getAnalise(`prospect_${cnpj}`).catch(() => null);
            if (savedAnalise) {
                setAnalise(savedAnalise);
                analiseBaselineRef.current = savedAnalise;
                setTab('dashboard');
                onShowToast?.(`Empresa encontrada. Análise salva carregada para edição.`);
                return;
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
            // O serviço mescla com a versão do servidor antes de gravar —
            // lançamentos de outros colaboradores (departamentos) não são
            // apagados. O retorno é a análise completa já mesclada.
            const salva = await nfpService.salvarAnalise(a, currentUser, analiseBaselineRef.current);
            analiseBaselineRef.current = salva;
            setAnalise(salva);
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
            apontamentosTrabalhistas: [],
        };
    }, [activeEmpresaId, activeNome, activeCnpj, currentUser, fonteAnalise, taxProfile]);

    const ensureDraftAnalise = useCallback(() => {
        setAnalise(prev => prev || createEmptyAnalise());
    }, [createEmptyAnalise]);

    useEffect(() => {
        if (!loading && hasActiveSelection && !analise && EDITABLE_TABS.includes(tab)) {
            ensureDraftAnalise();
        }
    }, [analise, ensureDraftAnalise, hasActiveSelection, loading, tab]);

    const handleTabChange = useCallback((nextTab: Tab) => {
        setTab(nextTab);
        if (hasActiveSelection && EDITABLE_TABS.includes(nextTab)) {
            ensureDraftAnalise();
        }
    }, [ensureDraftAnalise, hasActiveSelection]);

    // ─── Esfera Section Helpers ────────────────────────────────────────────




    // ─── Render Helpers ─────────────────────────────────────────────────────

    const renderTaxProfileCard = () => <TaxProfileCard taxProfile={taxProfile} />;

    /**
     * Recarrega a versão salva no servidor e mescla com o estado local.
     * Necessário antes de gerar PDF/Análise da IA: outros colaboradores
     * podem ter lançado débitos/certidões/obrigações depois que esta tela
     * carregou, e gerar só com o estado local omitiria esses dados.
     */
    const refreshAnaliseComRemota = useCallback(async (base: NfpAnaliseEmpresa): Promise<NfpAnaliseEmpresa> => {
        const remota = await nfpService.getAnalise(base.empresaId).catch(() => null);
        if (!remota) return base;
        const completa = mesclarAnaliseComRemota(base, remota, analiseBaselineRef.current);
        analiseBaselineRef.current = remota;
        setAnalise(completa);
        return completa;
    }, []);

    const exportarRelatorioPdf = useCallback(async () => {
        if (!analise) return;
        setExportingPdf(true);
        try {
            const completa = await refreshAnaliseComRemota(analise);
            const { gerarRelatorioPdfNfp } = await import("../../services/nfpProCloudPdf");
            const { blob, nomeArquivo } = await gerarRelatorioPdfNfp({ analise: completa, taxaSelic, taxProfile });
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
    }, [analise, refreshAnaliseComRemota, taxaSelic, taxProfile, onShowToast]);
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
            selectedEmpresaId={activeEmpresaId}
            updateAnalise={updateAnalise}
            saveAnalise={saveAnalise}
        />
    );

    const renderAcoes = () => analise && (
        <AcoesTab
            analise={analise}
            selectedEmpresaId={activeEmpresaId}
            updateAnalise={updateAnalise}
            saveAnalise={saveAnalise}
        />
    );

    const renderTrabalhista = () => analise && (
        <TrabalhistaTab
            analise={analise}
            activeEmpresaId={activeEmpresaId}
            setAnalise={setAnalise}
            saveAnalise={saveAnalise}
        />
    );

    const renderPlanoAcao = () => analise && (
        <PlanoAcaoTab
            analise={analise}
            selectedEmpresaId={activeEmpresaId}
            updateAnalise={updateAnalise}
            saveAnalise={saveAnalise}
        />
    );

    const handleAnaliseManual = useCallback(async (payload: NfpManualSituacaoFiscalPayload) => {
        const nova = criarAnaliseManual({
            baseAnalise: createEmptyAnalise(),
            activeEmpresaId,
            analisadoPor: currentUser?.name || '',
            ...payload,
            uid,
        });
        setAnalise(nova);
        await saveAnalise(nova);
        onShowToast?.(`Análise manual gerada com ${nova.planoAcao.length} item(ns) no plano de ação.`);
        setTab('dashboard');
    }, [activeEmpresaId, createEmptyAnalise, currentUser, prospectMode, saveAnalise, onShowToast]);

    const handleAnaliseReal = useCallback(async () => {
        if (!activeCnpj) return;
        setAnaliseRealLoading(true);
        try {
            const resp = await nfpService.analisarEmpresaCompleta(
                activeCnpj,
                taxProfile?.regime || prospectRegime || 'lucro_presumido',
                activeUf || undefined,
            );
            const { mapearRespostaSerpro } = await import('../../services/nfpAnaliseSerpro');
            const { updated, isMock } = mapearRespostaSerpro({
                resp,
                baseAnalise: analise || createEmptyAnalise(),
                activeEmpresaId,
                analisadoPor: currentUser?.name || '',
                fonteAnalise,
                certidoesBase: CERTIDOES_BASE,
                obrigacoesBase: OBRIGACOES_BASE,
                uid,
            });
            // Plano de ação com as mesmas regras do fluxo manual — o plano
            // ofertado ao cliente não depende da origem dos dados.
            const planoGerado = gerarPlanoAcaoAutomatico({
                empresaId: activeEmpresaId,
                debitos: updated.debitos,
                certidoes: updated.certidoes,
                obrigacoes: updated.obrigacoes,
                parcelamentos: updated.parcelamentos,
                acoes: updated.acoes,
                uid,
            });
            updated.planoAcao = mesclarPlanoAcao(updated.planoAcao || [], planoGerado);
            setAnalise(updated);
            await saveAnalise(updated);
            onShowToast?.(isMock
                ? 'Análise concluída com DADOS SIMULADOS (SERPRO em modo teste)'
                : `Varredura automática concluída — ${updated.planoAcao.length} item(ns) no plano de ação`);
            setTab('dashboard');
        } catch (e: any) {
            onShowToast?.('Erro na análise real: ' + (e?.message || 'desconhecido'));
        } finally {
            setAnaliseRealLoading(false);
        }
    }, [activeCnpj, activeEmpresaId, activeUf, analise, createEmptyAnalise, currentUser, fonteAnalise, prospectMode, prospectRegime, saveAnalise, taxProfile, onShowToast]);

    const handleGerarAnaliseIA = useCallback(async () => {
        if (!analise) return;
        setAnaliseIALoading(true);
        try {
            const completa = await refreshAnaliseComRemota(analise);
            const bloco = await gerarAnaliseIA(completa, {
                regime: taxProfile ? regimeLabel(taxProfile.regime) : undefined,
                atividade: prospectData?.cnaePrincipal?.descricao || undefined,
                geradoPor: currentUser?.name || undefined,
            });
            const atualizada = { ...completa, analiseIA: bloco };
            setAnalise(atualizada);
            await saveAnalise(atualizada);
            onShowToast?.('Análise da IA gerada com sucesso');
        } catch (e: any) {
            onShowToast?.('Erro ao gerar análise da IA: ' + (e?.message || 'desconhecido'));
        } finally {
            setAnaliseIALoading(false);
        }
    }, [analise, currentUser, prospectData, refreshAnaliseComRemota, saveAnalise, taxProfile, onShowToast]);

    const renderAnalise = () => (
        <AnaliseTab
            hasActiveSelection={hasActiveSelection}
            activeCnpj={activeCnpj}
            analise={analise}
            fonteAnalise={fonteAnalise}
            setFonteAnalise={setFonteAnalise}
            prospectMode={prospectMode}
            prospectData={prospectData}
            analiseRealLoading={analiseRealLoading}
            analiseIALoading={analiseIALoading}
            exportingPdf={exportingPdf}
            onExportPdf={exportarRelatorioPdf}
            onIniciarAnalise={() => {
                const nova = createEmptyAnalise();
                setAnalise(nova);
                saveAnalise(nova);
                setTab("dashboard");
            }}
            onIniciarAnaliseReal={handleAnaliseReal}
            onGerarAnaliseManual={handleAnaliseManual}
            onGerarAnaliseIA={handleGerarAnaliseIA}
        />
    );

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
                        onClick={() => handleTabChange(t.key)}
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
                    {tab === 'trabalhista' && renderTrabalhista()}
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
