import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LucroPresumidoEmpresa, User, FichaFinanceiraRegistro, LucroInput, HistoryItem, SearchType, ItemFinanceiroAvulso } from '../types';
import * as lucroPresumidoService from '../services/lucroPresumidoService';
import { fetchCnpjFromBrasilAPI } from '../services/externalApiService';
import { calcularLucro } from '../services/lucroService';
import { PlusIcon, CalculatorIcon, DownloadIcon, TrashIcon, ArrowLeftIcon, SaveIcon, UserIcon, BuildingIcon, PencilIcon, CloseIcon, TagIcon, BriefcaseIcon, ShieldIcon, InfoIcon } from './Icons';
import LoadingSpinner from './LoadingSpinner';

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

// Helper component for Currency Input
const CurrencyInput: React.FC<{ label?: string; value: number; onChange: (val: number) => void; className?: string; disabled?: boolean; placeholder?: string; highlight?: boolean; subtitle?: string; noLabel?: boolean }> = ({ label, value, onChange, className, disabled, placeholder, highlight, subtitle, noLabel }) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/\D/g, '');
        const num = parseFloat(raw) / 100;
        onChange(isNaN(num) ? 0 : num);
    };
    const formatted = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(value);
    
    return (
        <div className={className}>
            {!noLabel && label && <label className={`block text-xs font-bold uppercase mb-1 ${disabled ? 'text-slate-400' : (highlight ? 'text-sky-700 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400')}`}>{label}</label>}
            <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-xs ${highlight ? 'text-sky-600' : 'text-slate-400'}`}>R$</span>
                <input 
                    type="text" 
                    value={value === 0 ? '' : formatted}
                    placeholder={placeholder || '0,00'}
                    onChange={handleChange} 
                    disabled={disabled}
                    className={`w-full pl-8 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-sky-500 outline-none font-mono text-sm font-bold text-right transition-colors 
                        ${disabled ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700' : 
                          highlight ? 'bg-sky-50 dark:bg-sky-900/20 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800' : 
                          'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600'}`}
                />
            </div>
            {subtitle && <p className="text-[9px] text-sky-600 dark:text-sky-400 mt-1 text-right font-bold">{subtitle}</p>}
        </div>
    );
};

const ToggleSwitch: React.FC<{ label: string; checked: boolean; onChange: (val: boolean) => void; description?: string; colorClass?: string }> = ({ label, checked, onChange, description, colorClass = "bg-sky-600" }) => (
    <div className={`p-4 rounded-lg border transition-all cursor-pointer ${checked ? 'bg-white dark:bg-slate-800 border-l-4 border-l-' + colorClass.replace('bg-', '') + ' border-y-slate-200 border-r-slate-200 dark:border-y-slate-700 dark:border-r-slate-700 shadow-sm' : 'bg-slate-50 dark:bg-slate-800/50 border-transparent opacity-70 hover:opacity-100'}`} onClick={() => onChange(!checked)}>
        <div className="flex items-start gap-3">
            <div className={`mt-1 w-5 h-5 rounded border flex items-center justify-center transition-colors ${checked ? colorClass + ' border-transparent' : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-500'}`}>
                {checked && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
            </div>
            <div>
                <span className={`block text-sm font-bold ${checked ? 'text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>{label}</span>
                {description && <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block leading-relaxed">{description}</span>}
            </div>
        </div>
    </div>
);

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

    // Configurações Fiscais (Tempo Real)
    const [isEquiparacaoHospitalar, setIsEquiparacaoHospitalar] = useState(false);
    const [isPresuncaoReduzida, setIsPresuncaoReduzida] = useState(false);
    const [issTipo, setIssTipo] = useState<'aliquota_municipal' | 'sup_fixo'>('aliquota_municipal');
    const [issAliquota, setIssAliquota] = useState(5);
    const [pagarCotas, setPagarCotas] = useState(false);

    const selectedEmpresa = useMemo(() => empresas.find(e => e.id === selectedEmpresaId), [empresas, selectedEmpresaId]);

    // CÁLCULO DE RETENÇÕES DE MESES ANTERIORES NO TRIMESTRE
    const retencoesAcumuladas = useMemo(() => {
        if (!selectedEmpresa || periodoApuracao !== 'Trimestral') return { irpj: 0, csll: 0 };
        
        const [anoStr, mesStr] = fichaMes.split('-');
        const ano = parseInt(anoStr);
        const mes = parseInt(mesStr);
        
        // Define início do trimestre (1=Jan/Feb/Mar, 4=Apr/May/Jun, etc)
        const quarterStart = Math.floor((mes - 1) / 3) * 3 + 1;
        
        let accIrpj = 0;
        let accCsll = 0;

        if (selectedEmpresa.fichaFinanceira) {
            selectedEmpresa.fichaFinanceira.forEach(f => {
                const [fAno, fMes] = f.mesReferencia.split('-');
                const fMesNum = parseInt(fMes);
                const fAnoNum = parseInt(fAno);
                
                // Soma se for do mesmo ano, mesmo trimestre, e estritamente ANTERIOR ao mês atual
                if (fAnoNum === ano && fMesNum >= quarterStart && fMesNum < mes) {
                    accIrpj += (f.retencaoIrpj || 0);
                    accCsll += (f.retencaoCsll || 0);
                }
            });
        }
        
        return { irpj: accIrpj, csll: accCsll };
    }, [selectedEmpresa, fichaMes, periodoApuracao]);

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

    const resetForm = () => {
        setFichaMes(new Date().toISOString().substring(0, 7));
        setPeriodoApuracao('Mensal');
        setFichaComercio(0); setFichaIndustria(0); setFichaServico(0); setFichaServicoRetido(0); setFichaLocacao(0); setFichaServicoHospitalar(0);
        setFichaFilialComercio(0); setFichaFilialIndustria(0); setFichaFilialServico(0); setFichaFilialServicoHospitalar(0);
        setFichaIpi(0); setFichaDevolucoes(0); setFichaCmv(0); setFichaFolha(0); setFichaDespesas(0); setFichaDespesasDedutiveis(0); setFichaIcmsVendas(0);
        setFichaMonofasico(0); setIsMonofasicoOption(false);
        setFichaIpiRecolher(0); setFichaIcmsProprio(0); setFichaIcmsSt(0);
        setAjustesLucroRealAdicoes(0); setAjustesLucroRealExclusoes(0);
        setSaldoCredorIcms(0); setSaldoCredorIpi(0);
        setAcumuladoComercio(0); setAcumuladoIndustria(0); setAcumuladoServico(0); setAcumuladoServicoHospitalar(0); setAcumuladoFinanceira(0);
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
        acumuladoComercio, acumuladoIndustria, acumuladoServico, acumuladoServicoHospitalar, acumuladoFinanceira,
        fichaFilialComercio, fichaFilialIndustria, fichaFilialServico, fichaFilialServicoHospitalar,
        isMonofasicoOption, fichaMonofasico, fichaIpi, fichaDevolucoes, fichaIcmsVendas,
        fichaCmv, fichaFolha, fichaDespesas, fichaDespesasDedutiveis,
        issTipo, issAliquota,
        fichaRetPis, fichaRetCofins, fichaRetIrpj, fichaRetCsll,
        isEquiparacaoHospitalar, isPresuncaoReduzida,
        fichaIpiRecolher, fichaIcmsProprio, fichaIcmsSt,
        ajustesLucroRealAdicoes, ajustesLucroRealExclusoes, saldoCredorIcms, saldoCredorIpi, itensAdicionaisExtra,
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
        if (window.confirm('Tem certeza que deseja excluir esta empresa?')) {
            await lucroPresumidoService.deleteEmpresa(id);
            loadEmpresas();
            if (selectedEmpresaId === id) { setSelectedEmpresaId(null); setView('list'); }
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
        <div className="space-y-6 animate-fade-in">
             <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Lucro Presumido e Real</h2>
                    <p className="mt-1 text-slate-500 dark:text-slate-400">Gestão de fichas financeiras e cálculo de impostos.</p>
                </div>
                <button
                    onClick={() => setView('new_company')}
                    className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-semibold rounded-lg hover:bg-sky-700 transition-colors"
                >
                    <PlusIcon className="w-5 h-5" /> Nova Empresa
                </button>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                    <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                        <tr>
                            <th className="px-6 py-3">Empresa</th>
                            <th className="px-6 py-3">CNPJ</th>
                            <th className="px-6 py-3">Regime Padrão</th>
                            <th className="px-6 py-3 text-right">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {empresas.map(emp => (
                            <tr key={emp.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                <td className="px-6 py-4 font-bold text-slate-800 dark:text-slate-200">{emp.nome}</td>
                                <td className="px-6 py-4 font-mono">{emp.cnpj}</td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${emp.regimePadrao === 'Real' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                        {emp.regimePadrao || 'Presumido'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right flex justify-end gap-2">
                                    <button onClick={() => { setSelectedEmpresaId(emp.id); setView('details'); }} className="text-sky-600 hover:text-sky-800 font-medium">Abrir</button>
                                    <button onClick={() => handleDeleteCompany(emp.id)} className="text-red-500 hover:text-red-700"><TrashIcon className="w-4 h-4" /></button>
                                </td>
                            </tr>
                        ))}
                        {empresas.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-6 py-8 text-center text-slate-500">Nenhuma empresa cadastrada.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderNewCompany = () => (
        <div className="max-w-xl mx-auto bg-white dark:bg-slate-800 p-8 rounded-lg shadow-sm animate-fade-in">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">Nova Empresa</h2>
            <form onSubmit={handleSaveNewCompany} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">CNPJ</label>
                    <div className="mt-1 flex gap-2">
                        <input 
                            type="text" 
                            value={newCnpj} 
                            onChange={e => setNewCnpj(e.target.value)} 
                            placeholder="00.000.000/0001-00"
                            required 
                            className="flex-grow p-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 font-mono" 
                        />
                        <button
                            type="button"
                            onClick={handleCnpjVerification}
                            disabled={isCnpjLoading}
                            className="btn-press flex-shrink-0 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-wait"
                        >
                            {isCnpjLoading ? '...' : 'Verificar Receita'}
                        </button>
                    </div>
                    {cnpjError && <p className="mt-1 text-xs text-red-500">{cnpjError}</p>}
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Razão Social</label>
                    <input type="text" value={newName} onChange={e => setNewName(e.target.value)} required className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">CNAE Principal (Opcional)</label>
                    <input type="text" value={newCnae} onChange={e => setNewCnae(e.target.value)} className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Regime Tributário Padrão</label>
                    <select value={newRegime} onChange={e => setNewRegime(e.target.value as any)} className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500">
                        <option value="Presumido">Lucro Presumido</option>
                        <option value="Real">Lucro Real</option>
                    </select>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                    <button type="button" onClick={() => setView('list')} className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg font-medium text-slate-700 dark:text-slate-300">Cancelar</button>
                    <button type="submit" disabled={loading} className="px-4 py-2 bg-sky-600 text-white rounded-lg font-bold hover:bg-sky-700">{loading ? 'Salvando...' : 'Salvar Empresa'}</button>
                </div>
            </form>
        </div>
    );

    const renderNewFicha = () => (
        <div className="max-w-7xl mx-auto animate-fade-in pb-20">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-4">
                    <button onClick={() => setView('details')} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-300"><ArrowLeftIcon className="w-5 h-5" /></button>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 uppercase">{selectedEmpresa?.nome}</h2>
                </div>
                <div>
                    <button onClick={handleSaveFicha} disabled={loading} className="px-6 py-2 bg-sky-600 text-white rounded-lg font-bold hover:bg-sky-700 shadow-lg flex items-center gap-2">
                        {loading ? 'Salvando...' : <><SaveIcon className="w-5 h-5" /> {selectedFichaId ? 'Salvar Alterações' : 'Salvar Competência'}</>}
                    </button>
                </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* COLUNA 1: Configurações e Inputs (Esquerda) */}
                <div className="lg:col-span-2 space-y-6">
                    
                    {/* Configurações Fiscais */}
                    <div className="bg-slate-900/5 dark:bg-slate-800/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <h3 className="font-bold text-sky-700 dark:text-sky-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
                            <ShieldIcon className="w-4 h-4" /> Configurações Fiscais (ISS e Especiais)
                        </h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                            <ToggleSwitch 
                                label="Equiparação Hospitalar" 
                                description="Selecione se a empresa possui decisão judicial ou atende aos requisitos da ANVISA para alíquotas reduzidas (8% IRPJ / 12% CSLL)."
                                checked={isEquiparacaoHospitalar} 
                                onChange={setIsEquiparacaoHospitalar} 
                                colorClass="bg-purple-600"
                            />
                            <ToggleSwitch 
                                label="Presunção Reduzida IRPJ (16%)" 
                                description="Aplica-se apenas para receita bruta anual até R$ 120.000,00. Reduz a base de IRPJ de 32% para 16%."
                                checked={isPresuncaoReduzida} 
                                onChange={setIsPresuncaoReduzida} 
                                colorClass="bg-green-600"
                            />
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row items-center gap-6">
                            <div className="flex gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" checked={issTipo === 'aliquota_municipal'} onChange={() => setIssTipo('aliquota_municipal')} className="text-sky-600 focus:ring-sky-500" />
                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Alíquota Municipal (%)</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" checked={issTipo === 'sup_fixo'} onChange={() => setIssTipo('sup_fixo')} className="text-sky-600 focus:ring-sky-500" />
                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">ISS Fixo (SUP)</span>
                                </label>
                            </div>
                            <div className="flex-grow w-full md:w-auto">
                                {issTipo === 'aliquota_municipal' ? (
                                    <div className="flex flex-col">
                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1">Alíquota do ISS (%)</label>
                                        <input 
                                            type="number" 
                                            value={issAliquota} 
                                            onChange={e => setIssAliquota(parseFloat(e.target.value) || 0)}
                                            className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-sky-500"
                                        />
                                    </div>
                                ) : (
                                    <div className="text-sm text-slate-500 italic">Cálculo por sócio (SUP) será aplicado.</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Consolidação Filiais */}
                    <div className="bg-slate-900/5 dark:bg-slate-800/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <h3 className="font-bold text-indigo-600 dark:text-indigo-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
                            <BuildingIcon className="w-4 h-4" /> Consolidação de Filiais (Matriz)
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                            Insira o faturamento das filiais para cálculo unificado dos impostos federais (PIS/COFINS/IRPJ/CSLL).
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <CurrencyInput label="Faturamento Filiais (Comércio)" value={fichaFilialComercio} onChange={setFichaFilialComercio} className="bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700" />
                            <CurrencyInput label="Faturamento Filiais (Indústria)" value={fichaFilialIndustria} onChange={setFichaFilialIndustria} className="bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700" />
                            <CurrencyInput label="Faturamento Filiais (Serviço)" value={fichaFilialServico} onChange={setFichaFilialServico} className="bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700" />
                            {isEquiparacaoHospitalar && (
                                <CurrencyInput label="Filiais (Hospitalar 8%)" value={fichaFilialServicoHospitalar} onChange={setFichaFilialServicoHospitalar} className="bg-purple-50 dark:bg-purple-900/10 p-2 rounded border border-purple-200 dark:border-purple-800 animate-fade-in" highlight />
                            )}
                        </div>
                    </div>

                    {/* Receitas da Matriz */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide border-b border-slate-100 dark:border-slate-700 pb-2">
                            <CalculatorIcon className="w-4 h-4" /> Receitas da Matriz
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="col-span-1 md:col-span-2 flex gap-4 items-end">
                                <div className="flex-grow">
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Mês de Referência</label>
                                    <input type="month" value={fichaMes} onChange={e => setFichaMes(e.target.value)} className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white" />
                                </div>
                                <div className="bg-slate-100 dark:bg-slate-700 p-1 rounded-lg flex items-center h-[42px]">
                                    <button 
                                        onClick={() => setPeriodoApuracao('Mensal')}
                                        className={`px-3 h-full text-xs font-bold rounded transition-all ${periodoApuracao === 'Mensal' ? 'bg-white dark:bg-slate-600 text-sky-700 dark:text-sky-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                                    >
                                        Estimativa Mensal
                                    </button>
                                    <button 
                                        onClick={() => setPeriodoApuracao('Trimestral')}
                                        className={`px-3 h-full text-xs font-bold rounded transition-all ${periodoApuracao === 'Trimestral' ? 'bg-white dark:bg-slate-600 text-sky-700 dark:text-sky-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                                    >
                                        Encerramento Trimestral
                                    </button>
                                </div>
                            </div>

                            {/* Inputs Específicos para Fechamento Trimestral (Acumulado) */}
                            {periodoApuracao === 'Trimestral' && (
                                <div className="col-span-1 md:col-span-2 bg-sky-50 dark:bg-sky-900/20 p-4 rounded-lg border border-sky-200 dark:border-sky-800 animate-fade-in">
                                    <h4 className="text-xs font-bold text-sky-800 dark:text-sky-300 uppercase mb-2 flex items-center gap-2">
                                        <InfoIcon className="w-4 h-4" /> Dados Anteriores do Trimestre (Acumulado)
                                    </h4>
                                    <p className="text-[10px] text-sky-600 dark:text-sky-400 mb-3">
                                        Informe a soma da receita bruta dos meses anteriores deste trimestre para o cálculo correto do Adicional do IRPJ (10% sobre o excedente de R$ 60.000,00 no trimestre).
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <CurrencyInput label="Acumulado Comércio" value={acumuladoComercio} onChange={setAcumuladoComercio} className="bg-white dark:bg-slate-800 p-2 rounded border border-sky-100 dark:border-sky-900" />
                                        <CurrencyInput label="Acumulado Indústria" value={acumuladoIndustria} onChange={setAcumuladoIndustria} className="bg-white dark:bg-slate-800 p-2 rounded border border-sky-100 dark:border-sky-900" />
                                        <CurrencyInput label="Acumulado Serviços" value={acumuladoServico} onChange={setAcumuladoServico} className="bg-white dark:bg-slate-800 p-2 rounded border border-sky-100 dark:border-sky-900" />
                                        {isEquiparacaoHospitalar && (
                                            <CurrencyInput label="Acumulado Hosp. (8%)" value={acumuladoServicoHospitalar} onChange={setAcumuladoServicoHospitalar} className="bg-purple-50 dark:bg-purple-900/10 p-2 rounded border border-purple-200 dark:border-purple-800" />
                                        )}
                                        <CurrencyInput label="Acumulado Financeira" value={acumuladoFinanceira} onChange={setAcumuladoFinanceira} className="bg-white dark:bg-slate-800 p-2 rounded border border-sky-100 dark:border-sky-900" />
                                    </div>
                                </div>
                            )}

                            <CurrencyInput label="Comércio (Revenda)" value={fichaComercio} onChange={setFichaComercio} />
                            <CurrencyInput label="Indústria" value={fichaIndustria} onChange={setFichaIndustria} />
                            
                            <div className="col-span-1 md:col-span-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Serviços e Locação</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <CurrencyInput 
                                        label={isEquiparacaoHospitalar ? "Serviços (ISS A Pagar / Próprio - Sem Equip.)" : "Serviços (ISS A Pagar / Próprio)"} 
                                        value={fichaServico} 
                                        onChange={setFichaServico}
                                        className="bg-white dark:bg-slate-800"
                                    />
                                    
                                    <CurrencyInput 
                                        label="Serviços (ISS Retido na Fonte)" 
                                        value={fichaServicoRetido} 
                                        onChange={setFichaServicoRetido} 
                                        placeholder="ISS Retido pelo Tomador" 
                                    />
                                    
                                    <CurrencyInput 
                                        label="Locação de Bens (Não Incide ISS)" 
                                        value={fichaLocacao} 
                                        onChange={setFichaLocacao} 
                                    />

                                    {isEquiparacaoHospitalar && (
                                        <div className="animate-fade-in">
                                            <CurrencyInput label="Serviços Hospitalares (8% - Equiparação)" value={fichaServicoHospitalar} onChange={setFichaServicoHospitalar} highlight />
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            <div className="col-span-1 md:col-span-2 pt-4 mt-2 border-t border-slate-100 dark:border-slate-700">
                                <div className="p-4 bg-sky-50 dark:bg-sky-900/10 rounded-lg border border-sky-100 dark:border-sky-900">
                                    <CurrencyInput 
                                        label="Receita Financeira (Aplicações/Juros)" 
                                        value={fichaRecFinanceira} 
                                        onChange={setFichaRecFinanceira} 
                                        highlight
                                    />
                                    <p className="text-[10px] text-sky-600 dark:text-sky-400 mt-1">
                                        * Soma-se integralmente à base de IRPJ/CSLL (não sofre presunção).
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Deduções e Ajustes */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <h3 className="font-bold text-orange-600 dark:text-orange-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide border-b border-slate-100 dark:border-slate-700 pb-2">
                            <TagIcon className="w-4 h-4" /> Deduções e Ajustes
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <CurrencyInput label="IPI Faturado" value={fichaIpi} onChange={setFichaIpi} />
                            <CurrencyInput label="Devoluções de Vendas" value={fichaDevolucoes} onChange={setFichaDevolucoes} />
                            <CurrencyInput label="ICMS sobre Vendas (Para dedução PIS/COFINS)" value={fichaIcmsVendas} onChange={setFichaIcmsVendas} className="col-span-1 md:col-span-2" />
                            
                            <div className="col-span-1 md:col-span-2 pt-2 border-t border-orange-100 dark:border-orange-800/30">
                                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300 cursor-pointer mb-2">
                                    <input 
                                        type="checkbox" 
                                        checked={isMonofasicoOption} 
                                        onChange={e => setIsMonofasicoOption(e.target.checked)} 
                                        className="w-4 h-4 text-sky-600 rounded"
                                    />
                                    Opção Monofásico?
                                </label>
                                {isMonofasicoOption && (
                                    <div className="animate-fade-in pl-6">
                                        <CurrencyInput 
                                            label="Valor Receita Monofásica" 
                                            value={fichaMonofasico} 
                                            onChange={setFichaMonofasico}
                                            className="bg-slate-50 dark:bg-slate-700 rounded-lg p-2 border border-slate-200 dark:border-slate-600"
                                        />
                                        <p className="text-[10px] text-slate-500 mt-1">
                                            * Base PIS/COFINS será ajustada (Faturamento Bruto - IPI - Devolução) conforme regra STF/Monofásico.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Novo Bloco: Impostos Estaduais e IPI (Apuração Manual) */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <h3 className="font-bold text-indigo-600 dark:text-indigo-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide border-b border-slate-100 dark:border-slate-700 pb-2">
                            <BriefcaseIcon className="w-4 h-4" /> Apuração de ICMS e IPI (Saldos Devedores)
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <CurrencyInput 
                                label="ICMS Próprio (A Recolher)" 
                                value={fichaIcmsProprio} 
                                onChange={setFichaIcmsProprio} 
                                className="bg-indigo-50 dark:bg-indigo-900/10 p-2 rounded border border-indigo-100 dark:border-indigo-800"
                            />
                            <CurrencyInput 
                                label="ICMS ST (A Recolher)" 
                                value={fichaIcmsSt} 
                                onChange={setFichaIcmsSt} 
                                className="bg-indigo-50 dark:bg-indigo-900/10 p-2 rounded border border-indigo-100 dark:border-indigo-800"
                            />
                            <CurrencyInput 
                                label="IPI (A Recolher)" 
                                value={fichaIpiRecolher} 
                                onChange={setFichaIpiRecolher} 
                                className="bg-indigo-50 dark:bg-indigo-900/10 p-2 rounded border border-indigo-100 dark:border-indigo-800"
                            />
                        </div>
                    </div>

                    {/* Novo Bloco: Ajustes Lucro Real e Saldos Credores */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 animate-fade-in">
                        <h3 className="font-bold text-emerald-600 dark:text-emerald-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide border-b border-slate-100 dark:border-slate-700 pb-2">
                            <CalculatorIcon className="w-4 h-4" /> Ajustes e Saldos Credores
                        </h3>
                        
                        {selectedEmpresa?.regimePadrao === 'Real' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                <CurrencyInput 
                                    label="Adições (LALUR/LACS)" 
                                    value={ajustesLucroRealAdicoes} 
                                    onChange={setAjustesLucroRealAdicoes} 
                                    className="bg-emerald-50 dark:bg-emerald-900/10 p-2 rounded border border-emerald-100 dark:border-emerald-800"
                                />
                                <CurrencyInput 
                                    label="Exclusões (LALUR/LACS)" 
                                    value={ajustesLucroRealExclusoes} 
                                    onChange={setAjustesLucroRealExclusoes} 
                                    className="bg-emerald-50 dark:bg-emerald-900/10 p-2 rounded border border-emerald-100 dark:border-emerald-800"
                                />
                                <CurrencyInput 
                                    label="Itens Adicionais (Extra Operacionais)" 
                                    value={itensAdicionaisExtra} 
                                    onChange={setItensAdicionaisExtra} 
                                    className="bg-emerald-50 dark:bg-emerald-900/10 p-2 rounded border border-emerald-100 dark:border-emerald-800"
                                />
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <CurrencyInput 
                                label="Saldo Credor ICMS (Mês Anterior)" 
                                value={saldoCredorIcms} 
                                onChange={setSaldoCredorIcms} 
                                className="bg-slate-50 dark:bg-slate-700 p-2 rounded border border-slate-200 dark:border-slate-600"
                            />
                            <CurrencyInput 
                                label="Saldo Credor IPI (Mês Anterior)" 
                                value={saldoCredorIpi} 
                                onChange={setSaldoCredorIpi} 
                                className="bg-slate-50 dark:bg-slate-700 p-2 rounded border border-slate-200 dark:border-slate-600"
                            />
                        </div>
                    </div>
                </div>

                {/* COLUNA 2: RESULTADOS (Direita - Sticky) */}
                <div className="lg:col-span-1">
                    <div className="sticky top-6 space-y-6">
                        {/* Resultado Card */}
                        <div className="bg-slate-800 dark:bg-slate-900 text-white rounded-xl shadow-xl overflow-hidden border border-slate-700">
                            <div className="p-4 bg-slate-900/50 border-b border-slate-700">
                                <h3 className="text-lg font-bold flex items-center gap-2 text-sky-400">
                                    <InfoIcon className="w-5 h-5" /> Resultado da Apuração
                                </h3>
                            </div>
                            
                            {liveResults ? (
                                <div className="p-6 space-y-6">
                                    {liveResults.detalhamento.map((item, idx) => (
                                        <div key={idx} className="border-b border-slate-700/50 pb-4 last:border-0 last:pb-0">
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{item.imposto}</span>
                                                <span className="text-lg font-bold text-sky-300">
                                                    {item.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                </span>
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-mono">
                                                BASE: {item.baseCalculo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} ({item.aliquota}%)
                                            </div>
                                            {item.observacao && <div className="text-[10px] text-slate-600 italic mt-1">{item.observacao}</div>}
                                            
                                            {item.cotaInfo?.disponivel && (
                                                <div className="mt-2 bg-slate-700/30 p-2 rounded border border-slate-700">
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input 
                                                            type="checkbox" 
                                                            checked={pagarCotas} 
                                                            onChange={e => setPagarCotas(e.target.checked)}
                                                            className="rounded border-slate-500 bg-slate-800 text-sky-500 focus:ring-offset-slate-900" 
                                                        />
                                                        <span className="text-xs font-bold text-sky-400">PAGAR EM COTAS (3X)</span>
                                                    </label>
                                                    {pagarCotas && (
                                                        <div className="mt-1 pl-5 text-[10px] text-slate-400">
                                                            1ª Cota: {item.cotaInfo.valorPrimeiraCota.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}

                                    <div className="pt-4 border-t border-slate-600 mt-4">
                                        <div className="flex justify-between items-center bg-sky-600 p-4 rounded-lg shadow-lg">
                                            <span className="text-xs font-bold text-sky-100 uppercase">TOTAL DE IMPOSTOS</span>
                                            <span className="text-2xl font-black text-white">
                                                {liveResults.totalImpostos.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-8 text-center text-slate-500 italic">
                                    Preencha os valores para visualizar a apuração.
                                </div>
                            )}
                        </div>

                        {/* Custos e Retenções (Inputs Secundários) */}
                        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                            <h3 className="font-bold text-slate-600 dark:text-slate-400 mb-4 text-xs uppercase tracking-wide">Custos e Retenções (Mês Vigente)</h3>
                            <div className="space-y-3">
                                <CurrencyInput label="CMV" value={fichaCmv} onChange={setFichaCmv} />
                                <CurrencyInput label="Folha de Pagamento" value={fichaFolha} onChange={setFichaFolha} />
                                
                                <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Despesas Itemizadas</h4>
                                        <button 
                                            onClick={handleAddDespesa}
                                            className="text-[10px] flex items-center gap-1 bg-sky-50 text-sky-600 hover:bg-sky-100 px-2 py-1 rounded font-bold transition-colors"
                                        >
                                            <PlusIcon className="w-3 h-3" /> Adicionar Despesa
                                        </button>
                                    </div>
                                    
                                    <div className="space-y-2 mb-4">
                                        {despesasAvulsas.map((despesa) => (
                                            <div key={despesa.id} className="flex gap-2 items-center bg-slate-50 dark:bg-slate-700/30 p-2 rounded-lg border border-slate-100 dark:border-slate-600 group">
                                                <div className="flex-1">
                                                    <input 
                                                        type="text"
                                                        placeholder="Descrição (ex: Frete, Aluguel)"
                                                        className="w-full text-xs bg-transparent border-none focus:ring-0 p-1 text-slate-700 dark:text-slate-200 font-medium"
                                                        value={despesa.descricao}
                                                        onChange={(e) => handleUpdateDespesa(despesa.id, 'descricao', e.target.value)}
                                                    />
                                                </div>
                                                <div className="w-28">
                                                    <CurrencyInput 
                                                        value={despesa.valor} 
                                                        onChange={(val) => handleUpdateDespesa(despesa.id, 'valor', val)}
                                                        noLabel
                                                        className="text-xs"
                                                    />
                                                </div>
                                                <button 
                                                    onClick={() => handleRemoveDespesa(despesa.id)}
                                                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                        {despesasAvulsas.length === 0 && (
                                            <p className="text-[10px] text-slate-400 italic text-center py-2">Nenhuma despesa itemizada adicionada.</p>
                                        )}
                                    </div>
                                </div>

                                <CurrencyInput label="Outras Despesas (Total)" value={fichaDespesas} onChange={setFichaDespesas} />
                                <CurrencyInput label="Despesas Dedutíveis (PIS/COFINS)" value={fichaDespesasDedutiveis} onChange={setFichaDespesasDedutiveis} />
                                
                                <div className="pt-3 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-4">
                                    <CurrencyInput label="Ret. PIS" value={fichaRetPis} onChange={setFichaRetPis} />
                                    <CurrencyInput label="Ret. COFINS" value={fichaRetCofins} onChange={setFichaRetCofins} />
                                    
                                    <CurrencyInput 
                                        label="Ret. IRPJ" 
                                        value={fichaRetIrpj} 
                                        onChange={setFichaRetIrpj}
                                        subtitle={retencoesAcumuladas.irpj > 0 ? `+ ${retencoesAcumuladas.irpj.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})} (Ant. Trimestre)` : undefined}
                                        highlight={retencoesAcumuladas.irpj > 0}
                                    />
                                    <CurrencyInput 
                                        label="Ret. CSLL" 
                                        value={fichaRetCsll} 
                                        onChange={setFichaRetCsll}
                                        subtitle={retencoesAcumuladas.csll > 0 ? `+ ${retencoesAcumuladas.csll.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})} (Ant. Trimestre)` : undefined}
                                        highlight={retencoesAcumuladas.csll > 0}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderDetails = () => {
        if (!selectedEmpresa) return null;
        return (
            <div className="space-y-6 animate-fade-in">
                <div className="flex items-center gap-4">
                    <button onClick={() => setView('list')} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full"><ArrowLeftIcon className="w-5 h-5" /></button>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{selectedEmpresa.nome}</h2>
                        <p className="text-slate-500 dark:text-slate-400 font-mono text-sm">{selectedEmpresa.cnpj}</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                            <CalculatorIcon className="w-5 h-5 text-sky-600" />
                            Fichas Financeiras (Competências)
                        </h3>
                         <button 
                            onClick={handleCreateNewFicha}
                            className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 transition-colors"
                        >
                            <PlusIcon className="w-4 h-4" /> Nova Competência
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {selectedEmpresa.fichaFinanceira && selectedEmpresa.fichaFinanceira.length > 0 ? selectedEmpresa.fichaFinanceira.map(ficha => (
                             <div key={ficha.id} onClick={() => { setSelectedFichaId(ficha.id); setView('report'); }} className="cursor-pointer bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg border border-slate-200 dark:border-slate-600 hover:border-sky-400 transition-all">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="font-bold text-slate-800 dark:text-white capitalize">{new Date(ficha.mesReferencia + '-02').toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${ficha.periodoApuracao === 'Trimestral' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' : 'bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300'}`}>
                                        {ficha.periodoApuracao || 'Mensal'}
                                    </span>
                                </div>
                                <div className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
                                    <div className="flex justify-between"><span>Faturamento:</span> <span className="font-mono text-slate-900 dark:text-slate-200 font-bold">{ficha.faturamentoMesTotal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>
                                    <div className="flex justify-between"><span>Impostos:</span> <span className="font-mono">{ficha.totalImpostos.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span></div>
                                </div>
                             </div>
                        )) : (
                            <p className="text-slate-500 col-span-3 text-center py-4">Nenhuma ficha financeira registrada.</p>
                        )}
                    </div>
                </div>
            </div>
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
        const resultadoCalculado = calcularLucro(convertFichaToInput(selectedFicha, selectedEmpresa));
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
                        >
                            <DownloadIcon className="w-4 h-4" /> Gerar PDF
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
        </div>
    );
};

export default LucroPresumidoRealDashboard;