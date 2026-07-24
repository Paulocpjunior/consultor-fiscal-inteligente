import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { LucroPresumidoEmpresa, User, FichaFinanceiraRegistro, LucroInput, ItemFinanceiroAvulso } from '../types';
import * as lucroPresumidoService from '../services/lucroPresumidoService';
import { fetchCnpjFromBrasilAPI } from '../services/externalApiService';
import { useConfirm } from './dialog/DialogProvider';
import { calcularLucro } from '../services/lucroService';
import ConferirDctfwebModal from './DCTFWeb/ConferirDctfwebModal';
import ListView from './LucroPresumidoReal/ListView';
import NewCompanyView from './LucroPresumidoReal/NewCompanyView';
import DetailsView from './LucroPresumidoReal/DetailsView';
import NewFichaView from './LucroPresumidoReal/NewFichaView';
import ReportView from './LucroPresumidoReal/ReportView';
import { getRetencoesAcumuladasTrimestre } from './LucroPresumidoReal/fichaCalc';
import LoadingSpinner from './LoadingSpinner';
import EmpresaDadosFiscaisModal from './EmpresaDadosFiscaisModal';
import CfopCorrelacaoModal from './CfopCorrelacaoModal';
import NfseSpAdminPanel from './NfseSpAdminPanel';

interface LucroPresumidoRealDashboardProps {
    currentUser: User | null;
    externalSelectedId: string | null;
    onAddToHistory: (item: any) => void;
}

const LucroPresumidoRealDashboard: React.FC<LucroPresumidoRealDashboardProps> = ({ currentUser, externalSelectedId, onAddToHistory }) => {
    const confirm = useConfirm();
    const [empresas, setEmpresas] = useState<LucroPresumidoEmpresa[]>([]);
    const [selectedEmpresaId, setSelectedEmpresaId] = useState<string | null>(null);
    const [selectedFichaId, setSelectedFichaId] = useState<string | null>(null);
    const [view, setView] = useState<'list' | 'details' | 'report' | 'new_company' | 'new_ficha'>('list');
    const [loading, setLoading] = useState(false);
    const [isDadosFiscaisModalOpen, setIsDadosFiscaisModalOpen] = useState(false);
    // Toast local (o Lucro nao recebe onShowToast por prop como o Simples).
    const [toastMsg, setToastMsg] = useState<string | null>(null);
    const showToast = (msg: string) => {
        setToastMsg(msg);
        window.setTimeout(() => setToastMsg(null), 4000);
    };
    const [isCfopCorrelacaoModalOpen, setIsCfopCorrelacaoModalOpen] = useState(false);

    // New Company Form State
    const [newName, setNewName] = useState('');
    const [newCnpj, setNewCnpj] = useState('');
    const [newCnae, setNewCnae] = useState('');
    const [newRegime, setNewRegime] = useState<'Presumido' | 'Real'>('Presumido');
    
    // CNPJ Verification State
    const [isCnpjLoading, setIsCnpjLoading] = useState(false);
    const [cnpjError, setCnpjError] = useState('');

    // New Ficha State
    const [fichaMes, setFichaMes] = useState(new Date().toISOString().substring(0, 7));
    const [periodoApuracao, setPeriodoApuracao] = useState<'Mensal' | 'Trimestral'>('Mensal');
    
    // Matriz (Mês Atual)
    const [fichaComercio, setFichaComercio] = useState(0);
    const [fichaIndustria, setFichaIndustria] = useState(0);
    const [fichaServico, setFichaServico] = useState(0);
    const [fichaServicoRetido, setFichaServicoRetido] = useState(0);
    const [fichaLocacao, setFichaLocacao] = useState(0);
    const [fichaRecFinanceira, setFichaRecFinanceira] = useState(0);
    const [fichaServicoHospitalar, setFichaServicoHospitalar] = useState(0);
    
    // Acumulado Trimestre (Meses Anteriores do Trimestre)
    const [acumuladoComercio, setAcumuladoComercio] = useState(0);
    const [acumuladoIndustria, setAcumuladoIndustria] = useState(0);
    const [acumuladoServico, setAcumuladoServico] = useState(0);
    const [acumuladoServicoHospitalar, setAcumuladoServicoHospitalar] = useState(0);
    const [acumuladoFinanceira, setAcumuladoFinanceira] = useState(0);
    const [acumuladoAluguel, setAcumuladoAluguel] = useState(0);

    // Filiais (Consolidação)
    const [fichaFilialComercio, setFichaFilialComercio] = useState(0);
    const [fichaFilialIndustria, setFichaFilialIndustria] = useState(0);
    const [fichaFilialServico, setFichaFilialServico] = useState(0);
    const [fichaFilialServicoHospitalar, setFichaFilialServicoHospitalar] = useState(0); 
    
    // Deduções e Ajustes
    const [isMonofasicoOption, setIsMonofasicoOption] = useState(false);
    const [fichaMonofasico, setFichaMonofasico] = useState(0);
    const [fichaIpi, setFichaIpi] = useState(0);
    // ICMS-ST destacado nas vendas (dedução da receita bruta, igual IPI).
    // Não confundir com fichaIcmsSt (ICMS ST a recolher, apuração fiscal).
    const [fichaIcmsStFaturado, setFichaIcmsStFaturado] = useState(0);
    const [fichaIcmsVendas, setFichaIcmsVendas] = useState(0);
    const [fichaDevolucoes, setFichaDevolucoes] = useState(0);
    
    // Custos
    const [fichaCmv, setFichaCmv] = useState(0);
    const [fichaFolha, setFichaFolha] = useState(0);
    const [fichaDespesas, setFichaDespesas] = useState(0);
    const [fichaDespesasDedutiveis, setFichaDespesasDedutiveis] = useState(0);

    // Retenções
    const [fichaRetPis, setFichaRetPis] = useState(0);
    const [fichaRetCofins, setFichaRetCofins] = useState(0);
    const [fichaRetIrpj, setFichaRetIrpj] = useState(0);
    const [fichaRetCsll, setFichaRetCsll] = useState(0);

    // Outros Impostos (Informados Manualmente)
    const [fichaIpiRecolher, setFichaIpiRecolher] = useState(0);
    const [fichaIcmsProprio, setFichaIcmsProprio] = useState(0);
    const [fichaIcmsSt, setFichaIcmsSt] = useState(0);

    // Ajustes Lucro Real e Saldos Credores
    const [ajustesLucroRealAdicoes, setAjustesLucroRealAdicoes] = useState(0);
    const [ajustesLucroRealExclusoes, setAjustesLucroRealExclusoes] = useState(0);
    const [itensAdicionaisExtra, setItensAdicionaisExtra] = useState(0);
    const [despesasAvulsas, setDespesasAvulsas] = useState<ItemFinanceiroAvulso[]>([]);
    const [saldoCredorIcms, setSaldoCredorIcms] = useState(0);
    const [saldoCredorIpi, setSaldoCredorIpi] = useState(0);
    const [saldoCredorPis, setSaldoCredorPis] = useState(0);
    const [saldoCredorCofins, setSaldoCredorCofins] = useState(0);

    // Configurações Fiscais (Tempo Real)
    const [isEquiparacaoHospitalar, setIsEquiparacaoHospitalar] = useState(false);
    const [isPresuncaoReduzida, setIsPresuncaoReduzida] = useState(false);
    const [issTipo, setIssTipo] = useState<'aliquota_municipal' | 'sup_fixo'>('aliquota_municipal');
    const [issAliquota, setIssAliquota] = useState(5);
    const [pagarCotas, setPagarCotas] = useState(false);

    const selectedEmpresa = useMemo(() => empresas.find(e => e.id === selectedEmpresaId), [empresas, selectedEmpresaId]);

    // CÁLCULO DE RETENÇÕES DE MESES ANTERIORES NO TRIMESTRE
    const retencoesAcumuladas = useMemo(
        () => getRetencoesAcumuladasTrimestre(selectedEmpresa, fichaMes, periodoApuracao),
        [selectedEmpresa, fichaMes, periodoApuracao]
    );

    useEffect(() => {
        loadEmpresas();
    }, [currentUser]);

    useEffect(() => {
        if (externalSelectedId && empresas.length > 0) {
            const exists = empresas.find(e => e.id === externalSelectedId);
            if (exists) {
                setSelectedEmpresaId(externalSelectedId);
                setView('details');
            }
        }
    }, [externalSelectedId, empresas]);

    // POPULAR FORMULÁRIO QUANDO ENTRAR EM MODO DE EDIÇÃO
    useEffect(() => {
        if (view === 'new_ficha' && selectedFichaId && selectedEmpresa) {
            const ficha = selectedEmpresa.fichaFinanceira.find(f => f.id === selectedFichaId);
            if (ficha) {
                // Popula os campos com os dados da ficha salva
                setFichaMes(ficha.mesReferencia);
                setPeriodoApuracao(ficha.periodoApuracao);
                
                // Matriz
                setFichaComercio(ficha.faturamentoMesComercio);
                setFichaIndustria(ficha.faturamentoMesIndustria);
                setFichaServico(ficha.faturamentoMesServico);
                setFichaServicoRetido(ficha.faturamentoMesServicoRetido);
                setFichaLocacao(ficha.faturamentoMesLocacao);
                setFichaServicoHospitalar(ficha.faturamentoMesServicoHospitalar);
                setFichaRecFinanceira(ficha.receitaFinanceira);

                // Filiais
                setFichaFilialComercio(ficha.faturamentoFiliaisComercio || 0);
                setFichaFilialIndustria(ficha.faturamentoFiliaisIndustria || 0);
                setFichaFilialServico(ficha.faturamentoFiliaisServico || 0);
                setFichaFilialServicoHospitalar(ficha.faturamentoFiliaisServicoHospitalar || 0);

                // Acumulados Trimestrais
                if (ficha.dadosTrimestrais) {
                    setAcumuladoComercio(ficha.dadosTrimestrais.comercio || 0);
                    setAcumuladoIndustria(ficha.dadosTrimestrais.industria || 0);
                    setAcumuladoServico(ficha.dadosTrimestrais.servico || 0);
                    setAcumuladoServicoHospitalar(ficha.dadosTrimestrais.servicoHospitalar || 0);
                    setAcumuladoFinanceira(ficha.dadosTrimestrais.financeira || 0);
                    setAcumuladoAluguel(ficha.dadosTrimestrais.aluguel || 0);
                }

                // Ajustes e Deduções
                setFichaIpi(ficha.valorIpi || 0);
                setFichaIcmsStFaturado(ficha.valorIcmsSt || 0);
                setFichaDevolucoes(ficha.valorDevolucoes || 0);
                setFichaIcmsVendas(ficha.icmsVendas || 0);
                
                if (ficha.faturamentoMonofasico > 0) {
                    setIsMonofasicoOption(true);
                    setFichaMonofasico(ficha.faturamentoMonofasico);
                } else {
                    setIsMonofasicoOption(false);
                    setFichaMonofasico(0);
                }

                // Custos
                setFichaCmv(ficha.cmv || 0);
                setFichaFolha(ficha.folha || 0);
                setFichaDespesas(ficha.despesas || 0);
                setFichaDespesasDedutiveis(ficha.despesasDedutiveis || 0);

                // Retenções
                setFichaRetPis(ficha.retencaoPis || 0);
                setFichaRetCofins(ficha.retencaoCofins || 0);
                setFichaRetIrpj(ficha.retencaoIrpj || 0);
                setFichaRetCsll(ficha.retencaoCsll || 0);

                // Impostos Manuais
                setFichaIpiRecolher(ficha.ipiRecolher || 0);
                setFichaIcmsProprio(ficha.icmsProprioRecolher || 0);
                setFichaIcmsSt(ficha.icmsStRecolher || 0);

                // Ajustes Lucro Real e Saldos Credores
                setAjustesLucroRealAdicoes(ficha.ajustesLucroRealAdicoes || 0);
                setAjustesLucroRealExclusoes(ficha.ajustesLucroRealExclusoes || 0);
                setSaldoCredorIcms(ficha.saldoCredorIcms || 0);
                setSaldoCredorIpi(ficha.saldoCredorIpi || 0);
                setSaldoCredorPis(ficha.saldoCredorPis || 0);
                setSaldoCredorCofins(ficha.saldoCredorCofins || 0);
                
                const extraReceitas = (ficha.itensAvulsos || []).filter(i => i.tipo === 'receita' && i.descricao === 'Itens Adicionais - (Extra Operacionais)').reduce((a, b) => a + b.valor, 0);
                setItensAdicionaisExtra(extraReceitas);

                const otherExpenses = (ficha.itensAvulsos || []).filter(i => i.tipo === 'despesa');
                setDespesasAvulsas(otherExpenses);

                // Configurações
                setIsEquiparacaoHospitalar(ficha.isEquiparacaoHospitalar || false);
                setIsPresuncaoReduzida(ficha.isPresuncaoReduzida16 || false);
                
                // Carregar Configurações de ISS
                if (ficha.issConfig) {
                    setIssTipo(ficha.issConfig.tipo);
                    setIssAliquota(ficha.issConfig.aliquota || 0);
                } else if (selectedEmpresa.issPadraoConfig) {
                    // Fallback para config da empresa se a ficha não tiver (registros antigos)
                    setIssTipo(selectedEmpresa.issPadraoConfig.tipo);
                    setIssAliquota(selectedEmpresa.issPadraoConfig.aliquota || 0);
                }
            }
        }
    }, [view, selectedFichaId, selectedEmpresa]);

    // Defesa em profundidade: se a empresa selecionada e Lucro Presumido e
    // o state esta em 'Mensal' (vindo de ficha antiga salva ou default), forca
    // Trimestral. Lucro Presumido nao admite apuracao mensal (Lei 9.430/96 art. 1º).
    useEffect(() => {
        if (selectedEmpresa?.regimePadrao === 'Presumido' && periodoApuracao === 'Mensal') {
            setPeriodoApuracao('Trimestral');
        }
    }, [selectedEmpresa, periodoApuracao]);

    const resetForm = () => {
        setFichaMes(new Date().toISOString().substring(0, 7));
        // Lucro Presumido e trimestral por lei (Lei 9.430/96 art. 1º). Default
        // pra Trimestral quando o regime da empresa for Presumido — evita
        // que o contador gere calculo num cenario impossivel legalmente.
        // Lucro Real pode ser mensal (estimativa) ou trimestral.
        setPeriodoApuracao(selectedEmpresa?.regimePadrao === 'Real' ? 'Mensal' : 'Trimestral');
        setFichaComercio(0); setFichaIndustria(0); setFichaServico(0); setFichaServicoRetido(0); setFichaLocacao(0); setFichaServicoHospitalar(0);
        setFichaFilialComercio(0); setFichaFilialIndustria(0); setFichaFilialServico(0); setFichaFilialServicoHospitalar(0);
        setFichaIpi(0); setFichaIcmsStFaturado(0); setFichaDevolucoes(0); setFichaCmv(0); setFichaFolha(0); setFichaDespesas(0); setFichaDespesasDedutiveis(0); setFichaIcmsVendas(0);
        setFichaMonofasico(0); setIsMonofasicoOption(false);
        setFichaIpiRecolher(0); setFichaIcmsProprio(0); setFichaIcmsSt(0);
        setAjustesLucroRealAdicoes(0); setAjustesLucroRealExclusoes(0);
        setSaldoCredorIcms(0); setSaldoCredorIpi(0); setSaldoCredorPis(0); setSaldoCredorCofins(0);
        setAcumuladoComercio(0); setAcumuladoIndustria(0); setAcumuladoServico(0); setAcumuladoServicoHospitalar(0); setAcumuladoFinanceira(0);
        setAcumuladoComercio(0); setAcumuladoIndustria(0); setAcumuladoServico(0); setAcumuladoServicoHospitalar(0); setAcumuladoAluguel(0);
        setIsEquiparacaoHospitalar(false); setIsPresuncaoReduzida(false);
        setFichaRecFinanceira(0);
        setItensAdicionaisExtra(0);
        setDespesasAvulsas([]);
    };

    const handleAddDespesa = () => {
        const id = Math.random().toString(36).substr(2, 9);
        setDespesasAvulsas([...despesasAvulsas, { id, descricao: '', valor: 0, tipo: 'despesa' }]);
    };

    const handleRemoveDespesa = (id: string) => {
        setDespesasAvulsas(despesasAvulsas.filter(d => d.id !== id));
    };

    const handleUpdateDespesa = (id: string, field: keyof ItemFinanceiroAvulso, value: any) => {
        setDespesasAvulsas(despesasAvulsas.map(d => d.id === id ? { ...d, [field]: value } : d));
    };

    const handleCreateNewFicha = () => {
        setSelectedFichaId(null);
        resetForm();
        setView('new_ficha');
    };

    const handleEditFicha = () => {
        if (!selectedFicha) return;
        setView('new_ficha');
    };

    const [conferirDctfwebAberto, setConferirDctfwebAberto] = useState(false);

    // Live Calculation Logic
    const liveResults = useMemo(() => {
        if (!selectedEmpresa) return null;

        const liveInput: LucroInput = {
            regimeSelecionado: selectedEmpresa.regimePadrao || 'Presumido',
            periodoApuracao: periodoApuracao,
            mesReferencia: fichaMes,
            
            faturamentoComercio: fichaComercio,
            faturamentoIndustria: fichaIndustria,
            faturamentoServico: fichaServico,
            faturamentoServicoRetido: fichaServicoRetido,
            faturamentoLocacao: fichaLocacao,
            faturamentoServicoHospitalar: fichaServicoHospitalar,
            
            faturamentoFiliais: {
                comercio: fichaFilialComercio,
                industria: fichaFilialIndustria,
                servico: fichaFilialServico,
                servicoRetido: 0,
                locacao: 0,
                servicoHospitalar: fichaFilialServicoHospitalar
            },

            acumuladoTrimestre: periodoApuracao === 'Trimestral' ? {
                comercio: acumuladoComercio,
                industria: acumuladoIndustria,
                servico: acumuladoServico,
                servicoHospitalar: acumuladoServicoHospitalar,
                financeira: acumuladoFinanceira,
                aluguel: acumuladoAluguel,
                mesesConsiderados: []
            } : undefined,

            faturamentoMonofasico: isMonofasicoOption ? fichaMonofasico : 0,
            valorIpi: fichaIpi,
            valorIcmsSt: fichaIcmsStFaturado,
            valorDevolucoes: fichaDevolucoes,
            icmsVendas: fichaIcmsVendas,

            receitaFinanceira: fichaRecFinanceira,
            despesasOperacionais: fichaDespesas,
            despesasDedutiveis: fichaDespesasDedutiveis,
            folhaPagamento: fichaFolha,
            custoMercadoriaVendida: fichaCmv,
            
            issConfig: {
                tipo: issTipo,
                aliquota: issAliquota
            },
            
            // SOMA AUTOMÁTICA DE RETENÇÕES:
            // O valor enviado para cálculo é: (Retenção do Mês Inputada) + (Retenções de meses anteriores do Trimestre)
            retencaoPis: fichaRetPis,
            retencaoCofins: fichaRetCofins,
            retencaoIrpj: fichaRetIrpj + retencoesAcumuladas.irpj,
            retencaoCsll: fichaRetCsll + retencoesAcumuladas.csll,

            isEquiparacaoHospitalar: isEquiparacaoHospitalar,
            isPresuncaoReduzida16: isPresuncaoReduzida,

            ipiRecolher: fichaIpiRecolher,
            icmsProprioRecolher: fichaIcmsProprio,
            icmsStRecolher: fichaIcmsSt,

            ajustesLucroRealAdicoes: ajustesLucroRealAdicoes,
            ajustesLucroRealExclusoes: ajustesLucroRealExclusoes,
            saldoCredorIcms: saldoCredorIcms,
            saldoCredorIpi: saldoCredorIpi,
                saldoCredorPis: saldoCredorPis,
                saldoCredorCofins: saldoCredorCofins,
            itensAvulsos: [
                ...(itensAdicionaisExtra > 0 ? [{
                    id: 'extra',
                    descricao: 'Itens Adicionais - (Extra Operacionais)',
                    valor: itensAdicionaisExtra,
                    tipo: 'receita' as const
                }] : []),
                ...despesasAvulsas
            ]
        };

        return calcularLucro(liveInput);
    }, [
        selectedEmpresa, fichaMes, periodoApuracao, 
        fichaComercio, fichaIndustria, fichaServico, fichaServicoRetido, fichaLocacao, fichaRecFinanceira, fichaServicoHospitalar,
        acumuladoComercio, acumuladoIndustria, acumuladoServico, acumuladoServicoHospitalar, acumuladoFinanceira, acumuladoAluguel,
        fichaFilialComercio, fichaFilialIndustria, fichaFilialServico, fichaFilialServicoHospitalar,
        isMonofasicoOption, fichaMonofasico, fichaIpi, fichaDevolucoes, fichaIcmsVendas,
        fichaCmv, fichaFolha, fichaDespesas, fichaDespesasDedutiveis,
        issTipo, issAliquota,
        fichaRetPis, fichaRetCofins, fichaRetIrpj, fichaRetCsll,
        isEquiparacaoHospitalar, isPresuncaoReduzida,
        fichaIpiRecolher, fichaIcmsProprio, fichaIcmsSt,
        ajustesLucroRealAdicoes, ajustesLucroRealExclusoes, saldoCredorIcms, saldoCredorIpi, saldoCredorPis, saldoCredorCofins, itensAdicionaisExtra,
        retencoesAcumuladas
    ]);

    const loadEmpresas = async () => {
        setLoading(true);
        try {
            const data = await lucroPresumidoService.getEmpresas(currentUser);
            setEmpresas(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleCnpjVerification = async () => {
        if (!newCnpj.trim()) { setCnpjError('Digite um CNPJ para verificar.'); return; }
        setIsCnpjLoading(true); setCnpjError('');
        try {
            const data = await fetchCnpjFromBrasilAPI(newCnpj);
            if (data && data.razaoSocial) {
                setNewName(data.razaoSocial);
                if (data.cnaePrincipal) setNewCnae(data.cnaePrincipal.codigo);
            }
        } catch (e: any) { setCnpjError(e.message || 'Erro ao verificar o CNPJ.'); } 
        finally { setIsCnpjLoading(false); }
    };

    const handleSaveNewCompany = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser) return;
        if (!newName.trim()) { setCnpjError('Informe a Razão Social da empresa.'); return; }
        if (!newCnpj.trim()) { setCnpjError('Informe o CNPJ da empresa.'); return; }
        setCnpjError('');
        setLoading(true);
        try {
            // Prevenção "Sem UF": semeia dadosFiscais.uf da BrasilAPI já na
            // criação — sem isto a empresa nasce com a captura NFe bloqueada
            // e vira pendência no Status por Empresa. Falha da API não bloqueia
            // o cadastro (a UF pode ser preenchida depois no modal).
            let dadosFiscais: { uf?: string } | undefined;
            try {
                const info = await fetchCnpjFromBrasilAPI(newCnpj.replace(/\D/g, ''));
                const uf = (info?.uf || '').trim().toUpperCase();
                if (/^[A-Z]{2}$/.test(uf)) dadosFiscais = { uf };
            } catch { /* segue sem UF; modal cobre depois */ }
            await lucroPresumidoService.saveEmpresa({
                nome: newName, cnpj: newCnpj, cnaePrincipal: { codigo: newCnae, descricao: '' },
                regimePadrao: newRegime, fichaFinanceira: [],
                ...(dadosFiscais ? { dadosFiscais, uf: dadosFiscais.uf } : {}),
            }, currentUser.id);
            await loadEmpresas(); setView('list'); setNewName(''); setNewCnpj(''); setNewCnae('');
        } catch (err: any) {
            console.error(err);
            setCnpjError(err?.message || 'Erro ao salvar a empresa. Tente novamente.');
        } finally { setLoading(false); }
    };

    const handleDeleteCompany = async (id: string) => {
        const empresa = empresas.find(e => e.id === id);
        const ok = await confirm({
            title: empresa ? `Excluir "${empresa.nome}"?` : 'Excluir empresa?',
            message: 'Esta ação não pode ser desfeita.',
            variant: 'danger',
            confirmLabel: 'Excluir',
        });
        if (!ok) return;
        try {
            await lucroPresumidoService.deleteEmpresa(id);
            loadEmpresas();
            if (selectedEmpresaId === id) { setSelectedEmpresaId(null); setView('list'); }
        } catch (err: any) {
            const msg = err?.code === 'permission-denied'
                ? 'Sem permissão para deletar esta empresa (só admin ou dono).'
                : (err?.message || 'Erro ao deletar empresa.');
            alert(msg);
            console.error('[deleteEmpresa Lucro]', err);
        }
    };

    const handleSaveFicha = async () => {
        if (!selectedEmpresa || !liveResults) return;
        setLoading(true);
        try {
            const totalFaturamento = 
                fichaComercio + fichaIndustria + fichaServico + fichaServicoRetido + fichaLocacao + fichaRecFinanceira + fichaServicoHospitalar +
                fichaFilialComercio + fichaFilialIndustria + fichaFilialServico + fichaFilialServicoHospitalar;
            
            const tempFicha: FichaFinanceiraRegistro = {
                // Se estiver editando (selectedFichaId existe), usa o ID existente, senão cria novo
                id: selectedFichaId || Date.now().toString(),
                dataRegistro: Date.now(),
                mesReferencia: fichaMes,
                regime: selectedEmpresa.regimePadrao || 'Presumido',
                periodoApuracao: periodoApuracao,
                acumuladoAno: 0,
                
                faturamentoMesComercio: fichaComercio,
                faturamentoMesIndustria: fichaIndustria,
                faturamentoMesServico: fichaServico,
                faturamentoMesServicoRetido: fichaServicoRetido,
                faturamentoMesLocacao: fichaLocacao,
                faturamentoMesServicoHospitalar: fichaServicoHospitalar,
                
                faturamentoFiliaisComercio: fichaFilialComercio,
                faturamentoFiliaisIndustria: fichaFilialIndustria,
                faturamentoFiliaisServico: fichaFilialServico,
                faturamentoFiliaisServicoHospitalar: fichaFilialServicoHospitalar,

                dadosTrimestrais: periodoApuracao === 'Trimestral' ? {
                    comercio: acumuladoComercio,
                    industria: acumuladoIndustria,
                    servico: acumuladoServico,
                    servicoHospitalar: acumuladoServicoHospitalar,
                    financeira: acumuladoFinanceira,
                    aluguel: acumuladoAluguel,
                    mesesConsiderados: []
                } : undefined,

                faturamentoMonofasico: isMonofasicoOption ? fichaMonofasico : 0,
                valorIpi: fichaIpi,
                valorIcmsSt: fichaIcmsStFaturado,
                valorDevolucoes: fichaDevolucoes,
                icmsVendas: fichaIcmsVendas,
                
                receitaFinanceira: fichaRecFinanceira,
                faturamentoMesTotal: totalFaturamento,
                totalGeral: totalFaturamento,
                
                despesas: fichaDespesas,
                despesasDedutiveis: fichaDespesasDedutiveis,
                folha: fichaFolha,
                cmv: fichaCmv,
                
                retencaoPis: fichaRetPis,
                retencaoCofins: fichaRetCofins,
                retencaoIrpj: fichaRetIrpj,
                retencaoCsll: fichaRetCsll,
                
                totalImpostos: liveResults.totalImpostos,
                cargaTributaria: liveResults.cargaTributaria,
                
                isEquiparacaoHospitalar: isEquiparacaoHospitalar,
                isPresuncaoReduzida16: isPresuncaoReduzida,
                
                // SALVANDO A CONFIGURAÇÃO DE ISS ESPECÍFICA DA FICHA
                issConfig: {
                    tipo: issTipo,
                    aliquota: issAliquota
                },

                ipiRecolher: fichaIpiRecolher,
                icmsProprioRecolher: fichaIcmsProprio,
                icmsStRecolher: fichaIcmsSt,

                ajustesLucroRealAdicoes: ajustesLucroRealAdicoes,
                ajustesLucroRealExclusoes: ajustesLucroRealExclusoes,
                saldoCredorIcms: saldoCredorIcms,
                saldoCredorIpi: saldoCredorIpi,
                saldoCredorPis: saldoCredorPis,
                saldoCredorCofins: saldoCredorCofins,
                itensAvulsos: [
                    ...(itensAdicionaisExtra > 0 ? [{
                        id: 'extra',
                        descricao: 'Itens Adicionais - (Extra Operacionais)',
                        valor: itensAdicionaisExtra,
                        tipo: 'receita' as const
                    }] : []),
                    ...despesasAvulsas
                ]
            };

            const savedFicha = await lucroPresumidoService.addFichaFinanceira(selectedEmpresa.id, tempFicha);

            // Transferência automática do saldo residual PIS/COFINS pro próximo mês (Lucro Real)
            const residualPis = (liveResults as any)?.saldoResidualPis || 0;
            const residualCofins = (liveResults as any)?.saldoResidualCofins || 0;
            if ((selectedEmpresa.regimePadrao === 'Real') && (residualPis > 0 || residualCofins > 0)) {
                try {
                    const [anoN, mesN] = fichaMes.split('-').map(n => parseInt(n, 10));
                    const proxMes = mesN === 12 ? `${anoN + 1}-01` : `${anoN}-${String(mesN + 1).padStart(2, '0')}`;
                    const fichaProxExiste = savedFicha?.fichaFinanceira?.find(f => f.mesReferencia === proxMes);
                    const fichaBase: FichaFinanceiraRegistro = fichaProxExiste
                        ? { ...fichaProxExiste }
                        : {
                            id: Date.now().toString(),
                            dataRegistro: Date.now(),
                            mesReferencia: proxMes,
                            regime: 'Real',
                            periodoApuracao: periodoApuracao,
                            acumuladoAno: 0,
                            faturamentoMesComercio: 0, faturamentoMesIndustria: 0, faturamentoMesServico: 0,
                            faturamentoMesServicoRetido: 0, faturamentoMesLocacao: 0, faturamentoMesServicoHospitalar: 0,
                            faturamentoFiliaisComercio: 0, faturamentoFiliaisIndustria: 0, faturamentoFiliaisServico: 0, faturamentoFiliaisServicoHospitalar: 0,
                            faturamentoMonofasico: 0, valorIpi: 0, valorIcmsSt: 0, valorDevolucoes: 0, icmsVendas: 0,
                            receitaFinanceira: 0, faturamentoMesTotal: 0, totalGeral: 0,
                            despesas: 0, despesasDedutiveis: 0, folha: 0, cmv: 0,
                            retencaoPis: 0, retencaoCofins: 0, retencaoIrpj: 0, retencaoCsll: 0,
                            totalImpostos: 0, cargaTributaria: 0,
                        } as any;
                    fichaBase.saldoCredorPis = residualPis;
                    fichaBase.saldoCredorCofins = residualCofins;
                    await lucroPresumidoService.addFichaFinanceira(selectedEmpresa.id, fichaBase);
                } catch (err) {
                    console.warn('Falha ao transferir saldo residual pro próximo mês:', err);
                }
            }

            await loadEmpresas();
            
            if (savedFicha) {
                const novaFicha = savedFicha.fichaFinanceira.find(f => f.mesReferencia === fichaMes);
                if (novaFicha) {
                    setSelectedFichaId(novaFicha.id);
                    setView('report');
                } else {
                    setView('details');
                }
            } else {
                setView('details');
            }
            
        } catch (e: any) {
            console.error(e);
            // Sem isso, falha de gravacao na nuvem (ex: permission-denied)
            // era silenciosa e o usuario achava que a competencia foi salva.
            const detalhe = e?.code === 'permission-denied'
                ? 'Sem permissão para gravar nesta empresa — verifique com o administrador.'
                : (e?.message || 'erro desconhecido');
            showToast(`❌ Competência NÃO foi salva: ${detalhe}`);
        } finally {
            setLoading(false);
        }
    };

    const selectedFicha = useMemo(() => selectedEmpresa?.fichaFinanceira.find(f => f.id === selectedFichaId), [selectedEmpresa, selectedFichaId]);

    const renderNewCompany = () => (
        <NewCompanyView
            newCnpj={newCnpj}
            newName={newName}
            newCnae={newCnae}
            newRegime={newRegime as 'Presumido' | 'Real'}
            isCnpjLoading={isCnpjLoading}
            cnpjError={cnpjError}
            loading={loading}
            onChangeCnpj={setNewCnpj}
            onChangeName={setNewName}
            onChangeCnae={setNewCnae}
            onChangeRegime={setNewRegime}
            onVerificarCnpj={handleCnpjVerification}
            onSubmit={handleSaveNewCompany}
            onCancelar={() => setView('list')}
        />
    );

    const renderNewFicha = () => (
        <NewFichaView
            selectedEmpresa={selectedEmpresa}
            selectedFichaId={selectedFichaId}
            loading={loading}
            fichaMes={fichaMes} setFichaMes={setFichaMes}
            periodoApuracao={periodoApuracao} setPeriodoApuracao={setPeriodoApuracao}
            fichaComercio={fichaComercio} setFichaComercio={setFichaComercio}
            fichaIndustria={fichaIndustria} setFichaIndustria={setFichaIndustria}
            fichaServico={fichaServico} setFichaServico={setFichaServico}
            fichaServicoRetido={fichaServicoRetido} setFichaServicoRetido={setFichaServicoRetido}
            fichaLocacao={fichaLocacao} setFichaLocacao={setFichaLocacao}
            fichaServicoHospitalar={fichaServicoHospitalar} setFichaServicoHospitalar={setFichaServicoHospitalar}
            fichaRecFinanceira={fichaRecFinanceira} setFichaRecFinanceira={setFichaRecFinanceira}
            acumuladoComercio={acumuladoComercio} setAcumuladoComercio={setAcumuladoComercio}
            acumuladoIndustria={acumuladoIndustria} setAcumuladoIndustria={setAcumuladoIndustria}
            acumuladoServico={acumuladoServico} setAcumuladoServico={setAcumuladoServico}
            acumuladoServicoHospitalar={acumuladoServicoHospitalar} setAcumuladoServicoHospitalar={setAcumuladoServicoHospitalar}
            acumuladoFinanceira={acumuladoFinanceira} setAcumuladoFinanceira={setAcumuladoFinanceira}
            acumuladoAluguel={acumuladoAluguel} setAcumuladoAluguel={setAcumuladoAluguel}
            fichaFilialComercio={fichaFilialComercio} setFichaFilialComercio={setFichaFilialComercio}
            fichaFilialIndustria={fichaFilialIndustria} setFichaFilialIndustria={setFichaFilialIndustria}
            fichaFilialServico={fichaFilialServico} setFichaFilialServico={setFichaFilialServico}
            fichaFilialServicoHospitalar={fichaFilialServicoHospitalar} setFichaFilialServicoHospitalar={setFichaFilialServicoHospitalar}
            isMonofasicoOption={isMonofasicoOption} setIsMonofasicoOption={setIsMonofasicoOption}
            fichaMonofasico={fichaMonofasico} setFichaMonofasico={setFichaMonofasico}
            fichaIpi={fichaIpi} setFichaIpi={setFichaIpi}
            fichaIcmsStFaturado={fichaIcmsStFaturado} setFichaIcmsStFaturado={setFichaIcmsStFaturado}
            fichaIcmsVendas={fichaIcmsVendas} setFichaIcmsVendas={setFichaIcmsVendas}
            fichaDevolucoes={fichaDevolucoes} setFichaDevolucoes={setFichaDevolucoes}
            fichaCmv={fichaCmv} setFichaCmv={setFichaCmv}
            fichaFolha={fichaFolha} setFichaFolha={setFichaFolha}
            fichaDespesas={fichaDespesas} setFichaDespesas={setFichaDespesas}
            fichaDespesasDedutiveis={fichaDespesasDedutiveis} setFichaDespesasDedutiveis={setFichaDespesasDedutiveis}
            fichaRetPis={fichaRetPis} setFichaRetPis={setFichaRetPis}
            fichaRetCofins={fichaRetCofins} setFichaRetCofins={setFichaRetCofins}
            fichaRetIrpj={fichaRetIrpj} setFichaRetIrpj={setFichaRetIrpj}
            fichaRetCsll={fichaRetCsll} setFichaRetCsll={setFichaRetCsll}
            fichaIpiRecolher={fichaIpiRecolher} setFichaIpiRecolher={setFichaIpiRecolher}
            fichaIcmsProprio={fichaIcmsProprio} setFichaIcmsProprio={setFichaIcmsProprio}
            fichaIcmsSt={fichaIcmsSt} setFichaIcmsSt={setFichaIcmsSt}
            ajustesLucroRealAdicoes={ajustesLucroRealAdicoes} setAjustesLucroRealAdicoes={setAjustesLucroRealAdicoes}
            ajustesLucroRealExclusoes={ajustesLucroRealExclusoes} setAjustesLucroRealExclusoes={setAjustesLucroRealExclusoes}
            itensAdicionaisExtra={itensAdicionaisExtra} setItensAdicionaisExtra={setItensAdicionaisExtra}
            despesasAvulsas={despesasAvulsas}
            onAddDespesa={handleAddDespesa}
            onRemoveDespesa={handleRemoveDespesa}
            onUpdateDespesa={handleUpdateDespesa}
            saldoCredorIcms={saldoCredorIcms} setSaldoCredorIcms={setSaldoCredorIcms}
            saldoCredorIpi={saldoCredorIpi} setSaldoCredorIpi={setSaldoCredorIpi}
            saldoCredorPis={saldoCredorPis} setSaldoCredorPis={setSaldoCredorPis}
            saldoCredorCofins={saldoCredorCofins} setSaldoCredorCofins={setSaldoCredorCofins}
            isEquiparacaoHospitalar={isEquiparacaoHospitalar} setIsEquiparacaoHospitalar={setIsEquiparacaoHospitalar}
            isPresuncaoReduzida={isPresuncaoReduzida} setIsPresuncaoReduzida={setIsPresuncaoReduzida}
            issTipo={issTipo} setIssTipo={setIssTipo}
            issAliquota={issAliquota} setIssAliquota={setIssAliquota}
            pagarCotas={pagarCotas} setPagarCotas={setPagarCotas}
            liveResults={liveResults}
            retencoesAcumuladas={retencoesAcumuladas}
            onVoltar={() => setView("details")}
            onSalvar={handleSaveFicha}
            onAbrirConferirDctfweb={() => setConferirDctfwebAberto(true)}
        />
    );

    const renderDetails = () => {
        if (!selectedEmpresa) return null;
        return (
            <DetailsView
                empresa={selectedEmpresa}
                currentUser={currentUser}
                onVoltar={() => setView('list')}
                onAbrirDadosFiscais={() => setIsDadosFiscaisModalOpen(true)}
                onAbrirCorrelacaoCfop={() => setIsCfopCorrelacaoModalOpen(true)}
                onCriarNovaFicha={handleCreateNewFicha}
                onAbrirFicha={(fichaId) => { setSelectedFichaId(fichaId); setView('report'); }}
                onSalvarNfseSpConfig={async ({ ccmSp, nfseSpAutorizadoEm }) => {
                    // Cadastro unico: grava ccmSp em dadosFiscais (spread do
                    // existente pra preservar uf/IE) + a data de autorizacao.
                    await lucroPresumidoService.updateEmpresa(selectedEmpresa.id, {
                        dadosFiscais: { ...selectedEmpresa.dadosFiscais, ccmSp },
                        nfseSpAutorizadoEm: nfseSpAutorizadoEm || undefined,
                    });
                    const atualizadas = await lucroPresumidoService.getEmpresas(currentUser);
                    setEmpresas(atualizadas);
                }}
                onShowToast={showToast}
            />
        );
    };

    if (loading) return <LoadingSpinner />;

    return (
        <div className="pb-10">
            {view === 'list' && (
                <ListView
                    empresas={empresas}
                    currentUser={currentUser}
                    onNovaEmpresa={() => setView('new_company')}
                    onAbrir={(id) => { setSelectedEmpresaId(id); setView('details'); }}
                    onExcluir={handleDeleteCompany}
                />
            )}
            {view === 'new_company' && renderNewCompany()}
            {view === 'details' && renderDetails()}
            {view === 'new_ficha' && renderNewFicha()}
            {view === 'report' && selectedFicha && selectedEmpresa && (
                <ReportView
                    ficha={selectedFicha}
                    empresa={selectedEmpresa}
                    onVoltar={() => setView("details")}
                    onEditar={handleEditFicha}
                />
            )}

            {selectedEmpresa && (
                <>
                {conferirDctfwebAberto && liveResults && fichaMes && (
                    <ConferirDctfwebModal
                        empresaCnpj={selectedEmpresa.cnpj}
                        empresaNome={selectedEmpresa.nome}
                        empresaId={selectedEmpresa.id}
                        competencia={fichaMes}
                        detalhamento={liveResults.detalhamento}
                        isAdmin={currentUser?.role === 'admin'}
                        onClose={() => setConferirDctfwebAberto(false)}
                    />
                )}
                <EmpresaDadosFiscaisModal
                    isOpen={isDadosFiscaisModalOpen}
                    onClose={() => setIsDadosFiscaisModalOpen(false)}
                    empresaNome={selectedEmpresa.nome}
                    valoresAtuais={selectedEmpresa.dadosFiscais}
                    onSave={async (dados) => {
                        // Cadastro UNICO: ccmSp vive em dadosFiscais.ccmSp, igual
                        // aos demais campos (uf, IE, codMunIBGE). O backend le esse
                        // caminho (com fallback ao top-level legado).
                        await lucroPresumidoService.updateEmpresa(selectedEmpresa.id, { dadosFiscais: dados });
                        // Refresh lista pra refletir mudanca
                        const empresasAtualizadas = await lucroPresumidoService.getEmpresas(currentUser);
                        setEmpresas(empresasAtualizadas);
                    }}
                />

                <CfopCorrelacaoModal
                    isOpen={isCfopCorrelacaoModalOpen}
                    onClose={() => setIsCfopCorrelacaoModalOpen(false)}
                    empresaId={selectedEmpresa.id}
                    empresaNome={selectedEmpresa.nome}
                    empresaCnpj={selectedEmpresa.cnpj}
                    user={currentUser}
                    valoresAtuais={selectedEmpresa.dadosFiscais}
                    onSave={async (dados) => {
                        await lucroPresumidoService.updateEmpresa(selectedEmpresa.id, { dadosFiscais: dados });
                        const empresasAtualizadas = await lucroPresumidoService.getEmpresas(currentUser);
                        setEmpresas(empresasAtualizadas);
                    }}
                />
                </>
            )}

            {/* Toast local via portal (escapa de ancestrais com transform) */}
            {toastMsg && createPortal(
                <div className="fixed bottom-4 right-4 z-[100] max-w-sm bg-slate-800 text-white text-sm px-4 py-3 rounded-lg shadow-2xl border border-slate-700">
                    {toastMsg}
                </div>,
                document.body
            )}
        </div>
    );
};

export default LucroPresumidoRealDashboard;
