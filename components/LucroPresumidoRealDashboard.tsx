import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { LucroPresumidoEmpresa, User, FichaFinanceiraRegistro, LucroInput, ItemFinanceiroAvulso } from '../types';
import * as lucroPresumidoService from '../services/lucroPresumidoService';
import { fetchCnpjFromBrasilAPI } from '../services/externalApiService';
import { calcularLucro } from '../services/lucroService';
import ConferirDctfwebModal from './DCTFWeb/ConferirDctfwebModal';
import { DownloadIcon, ArrowLeftIcon, BuildingIcon, PencilIcon, InfoIcon } from './Icons';
import ListView from './LucroPresumidoReal/ListView';
import NewCompanyView from './LucroPresumidoReal/NewCompanyView';
import DetailsView from './LucroPresumidoReal/DetailsView';
import NewFichaView from './LucroPresumidoReal/NewFichaView';
import LoadingSpinner from './LoadingSpinner';
import EmpresaDadosFiscaisModal from './EmpresaDadosFiscaisModal';
import CfopCorrelacaoModal from './CfopCorrelacaoModal';
import NfseSpAdminPanel from './NfseSpAdminPanel';

// Helper to convert Ficha to Input for Calculation Service
const convertFichaToInput = (ficha: FichaFinanceiraRegistro, empresa: LucroPresumidoEmpresa): LucroInput => {
    return {
        regimeSelecionado: ficha.regime,
        periodoApuracao: ficha.periodoApuracao,
        mesReferencia: ficha.mesReferencia,
        faturamentoComercio: ficha.faturamentoMesComercio,
        faturamentoIndustria: ficha.faturamentoMesIndustria,
        faturamentoServico: ficha.faturamentoMesServico,
        faturamentoServicoRetido: ficha.faturamentoMesServicoRetido,
        faturamentoLocacao: ficha.faturamentoMesLocacao,
        faturamentoServicoHospitalar: ficha.faturamentoMesServicoHospitalar,
        
        faturamentoFiliais: {
            comercio: ficha.faturamentoFiliaisComercio || 0,
            industria: ficha.faturamentoFiliaisIndustria || 0,
            servico: ficha.faturamentoFiliaisServico || 0,
            servicoRetido: ficha.faturamentoFiliaisServicoRetido || 0,
            locacao: ficha.faturamentoFiliaisLocacao || 0,
            servicoHospitalar: ficha.faturamentoFiliaisServicoHospitalar || 0
        },

        faturamentoMonofasico: ficha.faturamentoMonofasico,
        valorIpi: ficha.valorIpi,
        valorDevolucoes: ficha.valorDevolucoes,
        icmsVendas: ficha.icmsVendas,

        receitaFinanceira: ficha.receitaFinanceira,
        despesasOperacionais: ficha.despesas,
        despesasDedutiveis: ficha.despesasDedutiveis,
        folhaPagamento: ficha.folha,
        custoMercadoriaVendida: ficha.cmv,
        
        // Prioriza a configuração salva na ficha, senão usa a da empresa, senão padrão 5%
        issConfig: ficha.issConfig || empresa.issPadraoConfig || { tipo: 'aliquota_municipal', aliquota: 5 },
        
        retencaoPis: ficha.retencaoPis,
        retencaoCofins: ficha.retencaoCofins,
        retencaoIrpj: ficha.retencaoIrpj,
        retencaoCsll: ficha.retencaoCsll,

        isEquiparacaoHospitalar: ficha.isEquiparacaoHospitalar,
        isPresuncaoReduzida16: ficha.isPresuncaoReduzida16,
        itensAvulsos: ficha.itensAvulsos,
        
        acumuladoAno: ficha.acumuladoAno,
        acumuladoTrimestre: ficha.dadosTrimestrais,

        ipiRecolher: ficha.ipiRecolher,
        icmsProprioRecolher: ficha.icmsProprioRecolher,
        icmsStRecolher: ficha.icmsStRecolher,

        ajustesLucroRealAdicoes: ficha.ajustesLucroRealAdicoes,
        ajustesLucroRealExclusoes: ficha.ajustesLucroRealExclusoes,
        saldoCredorIcms: ficha.saldoCredorIcms,
        saldoCredorIpi: ficha.saldoCredorIpi
    };
};

// Helper: calcula retencoes acumuladas do trimestre (meses anteriores ao mes de referencia).
// Usado tanto no card live (Resultado da Apuracao) quanto no Relatorio Final,
// para que IRPJ/CSLL trimestrais apareçam liquidos das retencoes na fonte.
const getRetencoesAcumuladasTrimestre = (
    empresa: LucroPresumidoEmpresa | null | undefined,
    mesReferencia: string,
    periodo: 'Mensal' | 'Trimestral'
): { irpj: number; csll: number } => {
    if (!empresa || periodo !== 'Trimestral' || !mesReferencia) return { irpj: 0, csll: 0 };

    const [anoStr, mesStr] = mesReferencia.split('-');
    const ano = parseInt(anoStr);
    const mes = parseInt(mesStr);
    if (isNaN(ano) || isNaN(mes)) return { irpj: 0, csll: 0 };

    const quarterStart = Math.floor((mes - 1) / 3) * 3 + 1;

    let accIrpj = 0;
    let accCsll = 0;

    if (empresa.fichaFinanceira) {
        empresa.fichaFinanceira.forEach(f => {
            const parts = f.mesReferencia.split('-');
            const fAnoNum = parseInt(parts[0]);
            const fMesNum = parseInt(parts[1]);
            if (fAnoNum === ano && fMesNum >= quarterStart && fMesNum < mes) {
                accIrpj += (f.retencaoIrpj || 0);
                accCsll += (f.retencaoCsll || 0);
            }
        });
    }

    return { irpj: accIrpj, csll: accCsll };
};


// CurrencyInput e ToggleSwitch agora vivem em ./LucroPresumidoReal/inputs.tsx
// e sao consumidos por NewFichaView (./LucroPresumidoReal/NewFichaView.tsx).

interface LucroPresumidoRealDashboardProps {
    currentUser: User | null;
    externalSelectedId: string | null;
    onAddToHistory: (item: any) => void;
}

const LucroPresumidoRealDashboard: React.FC<LucroPresumidoRealDashboardProps> = ({ currentUser, externalSelectedId, onAddToHistory }) => {
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
        setFichaIpi(0); setFichaDevolucoes(0); setFichaCmv(0); setFichaFolha(0); setFichaDespesas(0); setFichaDespesasDedutiveis(0); setFichaIcmsVendas(0);
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
            await lucroPresumidoService.saveEmpresa({
                nome: newName, cnpj: newCnpj, cnaePrincipal: { codigo: newCnae, descricao: '' },
                regimePadrao: newRegime, fichaFinanceira: []
            }, currentUser.id);
            await loadEmpresas(); setView('list'); setNewName(''); setNewCnpj(''); setNewCnae('');
        } catch (err: any) {
            console.error(err);
            setCnpjError(err?.message || 'Erro ao salvar a empresa. Tente novamente.');
        } finally { setLoading(false); }
    };

    const handleDeleteCompany = async (id: string) => {
        if (!window.confirm('Tem certeza que deseja excluir esta empresa?')) return;
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
                            faturamentoMonofasico: 0, valorIpi: 0, valorDevolucoes: 0, icmsVendas: 0,
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
            
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const selectedFicha = useMemo(() => selectedEmpresa?.fichaFinanceira.find(f => f.id === selectedFichaId), [selectedEmpresa, selectedFichaId]);

    const renderList = () => (
        <ListView
            empresas={empresas}
            currentUser={currentUser}
            onNovaEmpresa={() => setView('new_company')}
            onAbrir={(id) => { setSelectedEmpresaId(id); setView('details'); }}
            onExcluir={handleDeleteCompany}
        />
    );

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

    const renderReport = () => {
        if (!selectedFicha || !selectedEmpresa) return null;
        
        const financeiro = {
            cmv: selectedFicha.cmv || 0,
            folha: selectedFicha.folha || 0,
            despesas: (selectedFicha.despesas || 0) + (selectedFicha.despesasDedutiveis || 0),
        };
        const itensAvulsos = selectedFicha.itensAvulsos || [];
        // Aplica retencoes acumuladas do trimestre (meses anteriores) ao input do calculo,
        // para o relatorio final mostrar IRPJ/CSLL liquidos -- igual ao card live.
        const _baseInputRel = convertFichaToInput(selectedFicha, selectedEmpresa);
        const _retAcumRel = getRetencoesAcumuladasTrimestre(
            selectedEmpresa,
            selectedFicha.mesReferencia,
            selectedFicha.periodoApuracao
        );
        const _inputRelatorio: LucroInput = {
            ..._baseInputRel,
            retencaoIrpj: (_baseInputRel.retencaoIrpj || 0) + _retAcumRel.irpj,
            retencaoCsll: (_baseInputRel.retencaoCsll || 0) + _retAcumRel.csll,
        };
        const resultadoCalculado = calcularLucro(_inputRelatorio);
        const [ano, mes] = selectedFicha.mesReferencia.split('-');
        const dateObj = new Date(parseInt(ano), parseInt(mes) - 1, 1);
        const mesExtenso = dateObj.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

        // Cálculos para exibição de Bases no Relatório
        const baseIrpjCsll = selectedFicha.faturamentoMesTotal - (selectedFicha.valorIpi || 0) - (selectedFicha.valorDevolucoes || 0);
        // Base PIS/COFINS Estimada (Pode variar se for Real ou Presumido, mas aqui mostramos a base líquida de ICMS para referência visual)
        const basePisCofins = baseIrpjCsll - (selectedFicha.icmsVendas || 0);

        return (
            <div className="space-y-6 animate-fade-in pb-10">
                <div className="flex items-center justify-between gap-4 print:hidden">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setView('details')} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full"><ArrowLeftIcon className="w-5 h-5" /></button>
                        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Relatório de Apuração</h2>
                    </div>
                    <div className="flex gap-2">
                        <button 
                            onClick={handleEditFicha}
                            className="btn-press flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-bold rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                        >
                            <PencilIcon className="w-4 h-4" /> Editar Competência
                        </button>
                        <button
                            className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 transition-colors"
                            onClick={() => window.print()}
                            title="Imprime via navegador o relatório de apuração do regime atual (HTML→PDF)"
                        >
                            <DownloadIcon className="w-4 h-4" /> Imprimir (regime atual)
                        </button>
                        <button
                            className="btn-press flex items-center gap-2 px-4 py-2 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-900 transition-colors"
                            onClick={async () => {
                                // Gera PDF profissional Presumido × Real com capa, sumário,
                                // apuração lado a lado e disclaimer (padrão Big4).
                                const { compararRegimes, gerarPdfComparativoLucro } =
                                    await import('../services/lucroComparativoPdf');
                                const comp = compararRegimes(_inputRelatorio);
                                const blob = await gerarPdfComparativoLucro({
                                    input: _inputRelatorio,
                                    comparativo: comp,
                                    cliente: selectedEmpresa?.nome,
                                    clienteCnpj: selectedEmpresa?.cnpj,
                                    periodo: mesExtenso,
                                });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `comparativo-lucro-${selectedEmpresa?.nome?.replace(/\W+/g, '-').toLowerCase() || 'cliente'}-${selectedFicha.mesReferencia}.pdf`;
                                a.click();
                                URL.revokeObjectURL(url);
                            }}
                            title="Gera PDF profissional Presumido × Real com capa, sumário executivo, apuração lado a lado e recomendação. Pronto pra levar à reunião com o cliente."
                        >
                            <DownloadIcon className="w-4 h-4" /> Comparativo P × R (PDF)
                        </button>
                    </div>
                </div>

                {/* PDF Template Container */}
                <div className="bg-white text-slate-800 p-0 md:p-8 max-w-4xl mx-auto rounded-none md:rounded-xl shadow-none md:shadow-lg overflow-hidden">
                    
                    {/* Header Report */}
                    <div className="flex justify-between items-start border-b-4 border-sky-600 pb-6 mb-8">
                        <div>
                            <h1 className="text-3xl font-black text-slate-800 tracking-tight">MEMÓRIA DE APURAÇÃO</h1>
                            <p className="text-sky-600 font-bold text-sm uppercase tracking-widest mt-1">SP ASSESSORIA CONTÁBIL • AUDITORIA E PLANEJAMENTO</p>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] text-slate-400 uppercase font-bold">Enquadramento Aplicado</p>
                            <p className="text-xl font-black text-sky-800 uppercase leading-none">{selectedFicha.regime} {selectedFicha.periodoApuracao === 'Trimestral' ? '/ Trimestral' : ''}</p>
                            <p className="text-sm font-bold text-slate-500 uppercase mt-1">{mesExtenso}</p>
                        </div>
                    </div>

                    <div className="flex justify-between items-center bg-slate-50 rounded-2xl p-6 mb-8 border border-slate-100">
                        <div>
                            <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Empresa / Contribuinte</p>
                            <h2 className="text-xl font-black text-slate-800">{selectedEmpresa.nome}</h2>
                            <span className="inline-block bg-sky-100 text-sky-800 text-xs font-mono font-bold px-2 py-1 rounded mt-1">{selectedEmpresa.cnpj}</span>
                        </div>
                        <div className="bg-sky-600 text-white px-6 py-4 rounded-xl text-center shadow-lg transform -rotate-1">
                            <p className="text-[10px] font-bold opacity-80 uppercase">Carga Tributária Efetiva</p>
                            <p className="text-3xl font-black">{resultadoCalculado.cargaTributaria.toFixed(2)}%</p>
                            <p className="text-[9px] font-bold opacity-80 uppercase">Sobre Faturamento Bruto</p>
                        </div>
                    </div>

                    <div className="mb-6 flex items-center gap-2">
                        <div className="bg-sky-800 text-white p-2 rounded-lg">
                            <BuildingIcon className="w-5 h-5" />
                        </div>
                        <h3 className="text-lg font-black text-slate-800 uppercase">1. Fluxo Operacional de Receitas e Custos</h3>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Receitas */}
                        <div className="bg-white border-2 border-slate-100 rounded-[2rem] p-8 shadow-sm">
                            <h4 className="text-xs font-black text-slate-400 uppercase mb-6 border-b pb-2">Receitas Operacionais Brutas</h4>
                            <div className="space-y-2">
                                {selectedFicha.faturamentoMesComercio > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Comércio (Matriz+Filial):</span><span>{selectedFicha.faturamentoMesComercio.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                {selectedFicha.faturamentoMesIndustria > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Indústria (Matriz+Filial):</span><span>{selectedFicha.faturamentoMesIndustria.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                {selectedFicha.faturamentoMesServico > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Serviços ISS Próprio (Matriz+Filial):</span><span>{selectedFicha.faturamentoMesServico.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                {selectedFicha.faturamentoMesServicoRetido > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Serviços ISS Retido (Matriz+Filial):</span><span>{selectedFicha.faturamentoMesServicoRetido.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                {selectedFicha.faturamentoMesLocacao > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Locação de Bens (Matriz+Filial):</span><span>{selectedFicha.faturamentoMesLocacao.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                {selectedFicha.faturamentoMesServicoHospitalar > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Serviços Hospitalares (Matriz+Filial):</span><span>{selectedFicha.faturamentoMesServicoHospitalar.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                {selectedFicha.receitaFinanceira > 0 && <div className="flex justify-between text-sm font-bold text-amber-600"><span>(+) Receita Financeira:</span><span>{selectedFicha.receitaFinanceira.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                {itensAvulsos.filter(i => i.tipo === 'receita').length > 0 && (
                                    <div className="flex justify-between text-sm font-bold text-emerald-600">
                                        <span>(+) Itens Adicionais (Extra Operacionais):</span>
                                        <span>{itensAvulsos.filter(i => i.tipo === 'receita').reduce((a, b) => a + b.valor, 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                    </div>
                                )}
                                
                                {/* Deduções e Bases */}
                                {(selectedFicha.valorIpi > 0 || selectedFicha.valorDevolucoes > 0) && (
                                    <div className="pt-2 mt-2 border-t border-dashed border-slate-200">
                                        {selectedFicha.valorIpi > 0 && <div className="flex justify-between text-xs font-bold text-red-400 italic"><span>(-) Dedução IPI:</span><span>{selectedFicha.valorIpi.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                        {selectedFicha.valorDevolucoes > 0 && <div className="flex justify-between text-xs font-bold text-red-400 italic"><span>(-) Dedução Devoluções:</span><span>{selectedFicha.valorDevolucoes.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                    </div>
                                )}

                                <div className="flex justify-between text-base font-black text-slate-800 border-t pt-4 mt-2">
                                    <span>Base Cálculo IRPJ/CSLL:</span>
                                    <span>{baseIrpjCsll.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                </div>

                                {selectedFicha.icmsVendas > 0 && (
                                    <div className="flex justify-between text-xs font-bold text-blue-400 italic mt-1">
                                        <span>(-) Ded. ICMS s/ Vendas (STF):</span>
                                        <span>{selectedFicha.icmsVendas.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                    </div>
                                )}

                                {selectedFicha.faturamentoMonofasico > 0 && (
                                    <div className="flex justify-between text-xs font-bold text-blue-400 italic mt-1">
                                        <span>(-) Receita Monofásica (PIS/COFINS):</span>
                                        <span>{selectedFicha.faturamentoMonofasico.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                    </div>
                                )}

                                <div className="flex justify-between text-sm font-black text-slate-700 mt-2">
                                    <span>Base Cálculo PIS/COFINS:</span>
                                    <span>{basePisCofins.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                </div>

                                {/* Ajustes Lucro Real */}
                                {selectedFicha.regime === 'Real' && ((selectedFicha.ajustesLucroRealAdicoes || 0) > 0 || (selectedFicha.ajustesLucroRealExclusoes || 0) > 0) && (
                                    <div className="pt-2 mt-2 border-t border-emerald-100">
                                        <h5 className="text-[10px] font-black text-emerald-600 uppercase mb-1">Ajustes Lucro Real (LALUR)</h5>
                                        {(selectedFicha.ajustesLucroRealAdicoes || 0) > 0 && <div className="flex justify-between text-xs font-bold text-emerald-600"><span>(+) Adições:</span><span>{(selectedFicha.ajustesLucroRealAdicoes || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                        {(selectedFicha.ajustesLucroRealExclusoes || 0) > 0 && <div className="flex justify-between text-xs font-bold text-red-500"><span>(-) Exclusões:</span><span>{(selectedFicha.ajustesLucroRealExclusoes || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Custos, Gastos e IMPOSTOS */}
                        <div className="bg-white border-2 border-slate-100 rounded-[2rem] p-8 shadow-sm">
                            <h4 className="text-xs font-black text-slate-400 uppercase mb-6 border-b pb-2">Custos, Gastos e Impostos</h4>
                            <div className="space-y-4">
                                <div className="flex justify-between text-sm font-bold text-slate-600"><span>Custo de Mercadoria (CMV):</span><span>{financeiro.cmv.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>
                                <div className="flex justify-between text-sm font-bold text-slate-600"><span>Folha e Encargos Sociais:</span><span>{financeiro.folha.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>
                                <div className="flex justify-between text-sm font-bold text-slate-600"><span>Despesas Operacionais:</span><span>{financeiro.despesas.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>
                                
                                {/* Saldos Credores */}
                                {((selectedFicha.saldoCredorIcms || 0) > 0 || (selectedFicha.saldoCredorIpi || 0) > 0) && (
                                    <div className="pt-2 mt-2 border-t border-slate-100">
                                        <h5 className="text-[10px] font-black text-slate-400 uppercase mb-1">Saldos Credores Compensados</h5>
                                        {(selectedFicha.saldoCredorIcms || 0) > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>Cred. ICMS Anterior:</span><span>{(selectedFicha.saldoCredorIcms || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                        {(selectedFicha.saldoCredorIpi || 0) > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>Cred. IPI Anterior:</span><span>{(selectedFicha.saldoCredorIpi || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                    </div>
                                )}

                                {/* Retenções na Fonte */}
                                {(selectedFicha.retencaoPis > 0 || selectedFicha.retencaoCofins > 0 || selectedFicha.retencaoIrpj > 0 || selectedFicha.retencaoCsll > 0) && (
                                    <div className="pt-2 mt-2 border-t border-slate-100">
                                        <h5 className="text-[10px] font-black text-slate-400 uppercase mb-1">Retenções na Fonte (Deduções Federais)</h5>
                                        {selectedFicha.retencaoPis > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>PIS Retido:</span><span>{selectedFicha.retencaoPis.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                        {selectedFicha.retencaoCofins > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>COFINS Retido:</span><span>{selectedFicha.retencaoCofins.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                        {selectedFicha.retencaoIrpj > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>IRPJ Retido:</span><span>{selectedFicha.retencaoIrpj.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                        {selectedFicha.retencaoCsll > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>CSLL Retido:</span><span>{selectedFicha.retencaoCsll.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>}
                                    </div>
                                )}

                                {itensAvulsos.filter(i => i.tipo === 'despesa').length > 0 && (
                                    <div className="flex justify-between text-sm font-bold text-slate-600">
                                        <span>(+) Outras Despesas:</span>
                                        <span>{itensAvulsos.filter(i => i.tipo === 'despesa').reduce((a, b) => a + b.valor, 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                    </div>
                                )}

                                {/* Detalhamento de Impostos - Lista Completa */}
                                <div className="pt-4 mt-2 border-t border-slate-100 space-y-2">
                                    {resultadoCalculado.detalhamento.map((det, idx) => (
                                        <div key={idx} className="flex justify-between text-sm font-bold text-amber-600">
                                            <span>{det.imposto}:</span>
                                            <span>{det.valor.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                        </div>
                                    ))}
                                    {resultadoCalculado.detalhamento.length === 0 && (
                                        <p className="text-xs text-slate-400 italic">Nenhum imposto apurado.</p>
                                    )}
                                </div>

                                <div className="flex justify-between text-base font-black text-sky-900 border-t border-sky-100 pt-4 mt-2">
                                    <span>Total Desembolsos:</span>
                                    <span>{(financeiro.cmv + financeiro.folha + financeiro.despesas + itensAvulsos.filter(i => i.tipo === 'despesa').reduce((a, b) => a + b.valor, 0) + resultadoCalculado.totalImpostos).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                </div>
                            </div>
                        </div>

                        {/* SEÇÃO EXTRA: DADOS TRIMESTRAIS ACUMULADOS (Se houver) */}
                        {selectedFicha.dadosTrimestrais && selectedFicha.periodoApuracao === 'Trimestral' && (
                            <div className="bg-sky-50/50 border-2 border-sky-100 rounded-[2rem] p-8 shadow-sm col-span-1 lg:col-span-2">
                                <h4 className="text-xs font-black text-sky-600 uppercase mb-4 border-b border-sky-100 pb-2 flex items-center gap-2">
                                    <InfoIcon className="w-4 h-4" /> Memória de Cálculo - Acumulado Trimestral (Meses Anteriores)
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm mb-4">
                                    {selectedFicha.dadosTrimestrais.comercio > 0 && (
                                        <div>
                                            <span className="block text-slate-500 text-[10px] uppercase font-bold">Comércio Ant.</span>
                                            <span className="font-bold text-slate-700">{selectedFicha.dadosTrimestrais.comercio.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                        </div>
                                    )}
                                    {selectedFicha.dadosTrimestrais.industria > 0 && (
                                        <div>
                                            <span className="block text-slate-500 text-[10px] uppercase font-bold">Indústria Ant.</span>
                                            <span className="font-bold text-slate-700">{selectedFicha.dadosTrimestrais.industria.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                        </div>
                                    )}
                                    {selectedFicha.dadosTrimestrais.servico > 0 && (
                                        <div>
                                            <span className="block text-slate-500 text-[10px] uppercase font-bold">Serviços Ant.</span>
                                            <span className="font-bold text-slate-700">{selectedFicha.dadosTrimestrais.servico.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                        </div>
                                    )}
                                    {(selectedFicha.dadosTrimestrais.servicoHospitalar || 0) > 0 && (
                                        <div>
                                            <span className="block text-slate-500 text-[10px] uppercase font-bold">Hospitalar Ant.</span>
                                            <span className="font-bold text-slate-700">{selectedFicha.dadosTrimestrais.servicoHospitalar?.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                        </div>
                                    )}
                                    {selectedFicha.dadosTrimestrais.financeira > 0 && (
                                        <div>
                                            <span className="block text-slate-500 text-[10px] uppercase font-bold">Rec. Fin. Ant.</span>
                                            <span className="font-bold text-slate-700">{selectedFicha.dadosTrimestrais.financeira.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                        </div>
                                    )}
                                    {(selectedFicha.dadosTrimestrais.aluguel ?? 0) > 0 && (
                                        <div>
                                            <span className="block text-slate-500 text-[10px] uppercase font-bold">Rec. Fin. Ant.</span>
                                            <span className="font-bold text-slate-700">{(selectedFicha.dadosTrimestrais.aluguel ?? 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                                        </div>
                                    )}
                                </div>
                                <p className="text-[10px] text-slate-500 italic">
                                    * Estes valores foram somados à receita do mês atual para o cálculo da base trimestral do IRPJ e CSLL (Adicional de 10% sobre excedente de R$ 60.000,00).
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    if (loading) return <LoadingSpinner />;

    return (
        <div className="pb-10">
            {view === 'list' && renderList()}
            {view === 'new_company' && renderNewCompany()}
            {view === 'details' && renderDetails()}
            {view === 'new_ficha' && renderNewFicha()}
            {view === 'report' && renderReport()}

            {selectedEmpresa && (
                <>
                {conferirDctfwebAberto && liveResults && fichaMes && (
                    <ConferirDctfwebModal
                        empresaCnpj={selectedEmpresa.cnpj}
                        empresaNome={selectedEmpresa.nome}
                        competencia={fichaMes}
                        detalhamento={liveResults.detalhamento}
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
