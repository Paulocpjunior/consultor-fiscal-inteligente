import React, { useState, useMemo, useEffect } from 'react';
import { SimplesNacionalEmpresa, SimplesNacionalNota, SimplesNacionalImportResult, User, SimplesDetalheItem, SimplesItemCalculo } from '../types';
import * as simplesService from '../services/simplesNacionalService';
import { ArrowLeftIcon, SaveIcon, UserIcon, HistoryIcon, EyeIcon, DownloadIcon, CalculatorIcon, GlobeIcon, DocumentTextIcon, ShieldIcon, AnimatedCheckIcon, PlusIcon, TrashIcon, TagIcon, BuildingIcon } from './Icons';
import LoadingSpinner from './LoadingSpinner';

interface SimplesNacionalDetalheProps {
    empresa: SimplesNacionalEmpresa;
    notas: SimplesNacionalNota[];
    onBack: () => void;
    onImport: (empresaId: string, file: File) => Promise<SimplesNacionalImportResult>;
    onUpdateFolha12: (empresaId: string, val: number) => void;
    onSaveFaturamentoManual: (empresaId: string, faturamento: any, faturamentoDetalhado?: any) => Promise<any>;
    onUpdateEmpresa: (empresaId: string, data: Partial<SimplesNacionalEmpresa>) => Promise<any>;
    onShowClienteView: () => void;
    onShowToast: (message: string) => void;
    currentUser?: User | null;
}

interface CnaeInputState {
    valor: string;
    issRetido: boolean;
    icmsSt: boolean;
    isSup: boolean;
    isMonofasico: boolean;
    isImune: boolean;
    isExterior: boolean;
}

const CurrencyInput: React.FC<{ value: number; onChange: (val: number) => void; className?: string; placeholder?: string; label?: string }> = ({ value, onChange, className, placeholder, label }) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/\D/g, '');
        const num = parseFloat(raw) / 100;
        onChange(isNaN(num) ? 0 : num);
    };
    const formatted = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(value);
    return (
        <div className={`relative ${className || ''}`}>
            {label && <label className="block text-xs font-bold text-slate-500 mb-1">{label}</label>}
            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs">R$</span>
                <input 
                    type="text" 
                    value={value === 0 && placeholder ? '' : formatted}
                    placeholder={placeholder}
                    onChange={handleChange} 
                    className="w-full pl-8 pr-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-slate-900 font-bold dark:text-white dark:font-mono text-right text-sm"
                />
            </div>
        </div>
    );
};

const SimplesNacionalDetalhe: React.FC<SimplesNacionalDetalheProps> = ({ 
    empresa, notas, onBack, onImport, onUpdateFolha12, onSaveFaturamentoManual, onUpdateEmpresa, onShowClienteView, onShowToast, currentUser 
}) => {
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [folha12Input, setFolha12Input] = useState(empresa.folha12);
    
    // Estados de Apuração Mensal
    const [mesApuracao, setMesApuracao] = useState(new Date());
    const [faturamentoPorCnae, setFaturamentoPorCnae] = useState<Record<string, CnaeInputState>>({});
    
    // Filiais Detalhadas
    const [filialComercio, setFilialComercio] = useState<number>(0);
    const [filialIndustria, setFilialIndustria] = useState<number>(0);
    const [filialServico, setFilialServico] = useState<number>(0);

    const [icmsVendas, setIcmsVendas] = useState<number>(0);
    
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Manual RBT12 editing state
    const [manualRbtHistory, setManualRbtHistory] = useState<Record<string, number>>(empresa.faturamentoManual || {});

    // Carrega dados ao mudar o mês
    useEffect(() => {
        const mesChave = `${mesApuracao.getFullYear()}-${(mesApuracao.getMonth() + 1).toString().padStart(2, '0')}`;
        const detalheMes = empresa.faturamentoMensalDetalhado?.[mesChave] || {};
        
        const novoFaturamentoPorCnae: Record<string, CnaeInputState> = {};
        
        // Helper para criar estado inicial ou carregar
        const getOrCreateState = (key: string, storedItem: any): CnaeInputState => {
            if (storedItem && typeof storedItem === 'object') {
                const item = storedItem as SimplesDetalheItem;
                return {
                    valor: new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(item.valor),
                    issRetido: item.issRetido || false,
                    icmsSt: item.icmsSt || false,
                    isSup: item.isSup || false,
                    isMonofasico: item.isMonofasico || false,
                    isImune: item.isImune || false,
                    isExterior: item.isExterior || false
                };
            }
            return { valor: '0,00', issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };
        };

        // Verifica se já existem dados salvos completos (incluindo itens extras adicionados manualmente)
        const keysSalvas = Object.keys(detalheMes).filter(k => !k.startsWith('filial_') && k !== 'icms_vendas');
        
        if (keysSalvas.length > 0) {
            keysSalvas.forEach(key => {
                novoFaturamentoPorCnae[key] = getOrCreateState(key, detalheMes[key]);
            });
        } else {
            // Inicializa com padrão (Principal + Secundários)
            const keyPrincipal = `principal::0::${empresa.cnae}::${empresa.anexo}`;
            const storedPrincipal = detalheMes[keyPrincipal] || detalheMes[empresa.cnae];
            novoFaturamentoPorCnae[keyPrincipal] = getOrCreateState(keyPrincipal, storedPrincipal);

            if (empresa.atividadesSecundarias) {
                empresa.atividadesSecundarias.forEach((ativ, index) => {
                    const keySec = `secundario::${index}::${ativ.cnae}::${ativ.anexo}`;
                    const storedSec = detalheMes[keySec] || detalheMes[ativ.cnae];
                    novoFaturamentoPorCnae[keySec] = getOrCreateState(keySec, storedSec);
                });
            }
        }

        setFaturamentoPorCnae(novoFaturamentoPorCnae);

        // Carrega Filiais
        setFilialComercio(detalheMes['filial_comercio']?.valor || 0);
        setFilialIndustria(detalheMes['filial_industria']?.valor || 0);
        setFilialServico(detalheMes['filial_servico']?.valor || 0);
        
        // Carrega ICMS
        setIcmsVendas(detalheMes['icms_vendas']?.valor || 0);

        setManualRbtHistory(empresa.faturamentoManual || {});

    }, [mesApuracao, empresa.id, empresa.faturamentoMensalDetalhado, empresa.cnae, empresa.anexo, empresa.atividadesSecundarias]);

    // Recalcula o Resumo em Tempo Real com base nos Inputs
    const resumo = useMemo(() => {
        const itensCalculo: SimplesItemCalculo[] = [];
        
        Object.entries(faturamentoPorCnae).forEach(([key, value]) => {
            const state = value as CnaeInputState;
            const parts = key.split('::');
            const cnaeCode = parts.length >= 3 ? parts[2] : key;
            const anexoCode = parts.length >= 4 ? parts[3] : empresa.anexo;
            
            const val = parseFloat(state.valor.replace(/\./g, '').replace(',', '.') || '0');
            
            itensCalculo.push({
                cnae: cnaeCode,
                anexo: anexoCode as any,
                valor: val,
                issRetido: state.issRetido,
                icmsSt: state.icmsSt,
                isSup: state.isSup,
                isMonofasico: state.isMonofasico,
                isImune: state.isImune,
                isExterior: state.isExterior
            });
        });

        // Adiciona Filiais ao cálculo (Assume Anexo I para Comércio, II Indústria, III Serviço se não especificado, ou usa o da empresa)
        if (filialComercio > 0) {
            itensCalculo.push({ cnae: 'Filial Comércio', anexo: 'I', valor: filialComercio, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false });
        }
        if (filialIndustria > 0) {
            itensCalculo.push({ cnae: 'Filial Indústria', anexo: 'II', valor: filialIndustria, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false });
        }

if (filialServico > 0) {
    const anexoServico = ['III', 'IV', 'V'].includes(empresa.anexo) ? empresa.anexo : 'III';
    itensCalculo.push({ 
        cnae: 'Filial Serviço', 
        anexo: anexoServico as any, 
        valor: filialServico, 
        issRetido: true,  // ✅ ISS NÃO compõe o DAS da matriz (é municipal, pago na filial)
        icmsSt: false, 
        isSup: false, 
        isMonofasico: false, 
        isImune: false, 
        isExterior: false 
    });
}

        // Simula a empresa com os dados atuais de input para o cálculo
        const empresaTemp = {
            ...empresa,
            faturamentoManual: manualRbtHistory,
            folha12: folha12Input
        };

        return simplesService.calcularResumoEmpresa(empresaTemp, notas, mesApuracao, { itensCalculo });
    }, [empresa, notas, mesApuracao, faturamentoPorCnae, filialComercio, filialIndustria, filialServico, manualRbtHistory, folha12Input]);

    // Calculate total RBT12 from manual inputs
    const totalRbt12Manual = useMemo(() => {
        let total = 0;
        const today = new Date(mesApuracao); 
        for (let i = 1; i <= 12; i++) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const k = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            total += (manualRbtHistory[k] || 0);
        }
        return total;
    }, [manualRbtHistory, mesApuracao]);

    const handleFaturamentoChange = (key: string, rawValue: string) => {
        const digits = rawValue.replace(/\D/g, '');
        const numberValue = parseInt(digits, 10) / 100;
        const formatted = isNaN(numberValue) ? '0,00' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numberValue);

        setFaturamentoPorCnae((prev) => ({
            ...prev,
            [key]: { ...prev[key], valor: formatted }
        }));
    };

    const handleOptionToggle = (key: string, field: keyof CnaeInputState) => {
        setFaturamentoPorCnae((prev) => ({
            ...prev,
            [key]: { ...prev[key], [field]: !prev[key][field] }
        }));
    };

    const handleAddRevenueItem = () => {
        const id = Date.now();
        const key = `extra::${id}::${empresa.cnae}::${empresa.anexo}`;
        
        setFaturamentoPorCnae(prev => ({
            ...prev,
            [key]: { valor: '0,00', issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false }
        }));
    };

    const handleRemoveRevenueItem = (key: string) => {
        setFaturamentoPorCnae(prev => {
            const newState = { ...prev };
            delete newState[key];
            return newState;
        });
    };

    const handleSaveMesVigente = async () => {
        setIsSaving(true);
        try {
            const detalheMes: Record<string, SimplesDetalheItem> = {};
            let totalMes: number = 0;

            // 1. Processa Itens Normais e Extras
            Object.entries(faturamentoPorCnae).forEach(([key, value]) => {
                const state = value as CnaeInputState;
                const valString = state.valor.replace(/\./g, '').replace(',', '.') || '0';
                const val = parseFloat(valString);
                const safeVal = isNaN(val) ? 0 : val;
                
                totalMes += safeVal;
                
                detalheMes[key] = {
                    valor: safeVal,
                    issRetido: state.issRetido,
                    icmsSt: state.icmsSt,
                    isSup: state.isSup,
                    isMonofasico: state.isMonofasico,
                    isImune: state.isImune,
                    isExterior: state.isExterior
                };
            });

            // 2. Processa Filiais (Somando ao total e salvando detalhado)
            const safeFilialComercio = Number(filialComercio) || 0;
            const safeFilialIndustria = Number(filialIndustria) || 0;
            const safeFilialServico = Number(filialServico) || 0;
            
            totalMes += safeFilialComercio + safeFilialIndustria + safeFilialServico;
            
            detalheMes['filial_comercio'] = { valor: safeFilialComercio, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };
            detalheMes['filial_industria'] = { valor: safeFilialIndustria, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };
            detalheMes['filial_servico'] = { valor: safeFilialServico, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };

            // 3. Salva ICMS Informativo
            detalheMes['icms_vendas'] = { valor: icmsVendas || 0, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false };

            const mesChave = `${mesApuracao.getFullYear()}-${(mesApuracao.getMonth() + 1).toString().padStart(2, '0')}`;
            
            // Atualiza histórico manual com o total do mês (Matriz + Filiais)
            const novoHistorico = { ...manualRbtHistory, [mesChave]: totalMes };
            setManualRbtHistory(novoHistorico);

            // Atualiza detalhamento do mês
            const novoDetalhamento = { ...(empresa.faturamentoMensalDetalhado || {}), [mesChave]: detalheMes };

            await onUpdateEmpresa(empresa.id, {
                faturamentoManual: novoHistorico,
                faturamentoMensalDetalhado: novoDetalhamento,
                folha12: folha12Input
            });

            setSaveSuccess(true);
            onShowToast('Apuração salva com sucesso!');
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error) {
            console.error(error);
            onShowToast('Erro ao salvar apuração.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveHistory = async () => {
        await onSaveFaturamentoManual(empresa.id, manualRbtHistory);
        setIsHistoryModalOpen(false);
        onShowToast("Histórico de faturamento atualizado!");
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const res = await onImport(empresa.id, file);
            if (res.errors.length > 0) {
                onShowToast(`Importação com avisos: ${res.errors[0]}`);
            } else {
                onShowToast(`Importado com sucesso!`);
            }
        }
    };

    return (
        <div className="animate-fade-in pb-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors">
                        <ArrowLeftIcon className="w-5 h-5" />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{empresa.nome}</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-mono">{empresa.cnpj} • Anexo {empresa.anexo}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={onShowClienteView} className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-100 text-sky-700 font-bold rounded-lg hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50">
                        <EyeIcon className="w-5 h-5" />
                        Visão Cliente
                    </button>
                    <label className="btn-press flex items-center gap-2 px-4 py-2 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-700 cursor-pointer">
                        <DownloadIcon className="w-5 h-5" />
                        Importar NFe/PGDAS
                        <input type="file" accept=".xml,.pdf,.xls,.xlsx" className="hidden" onChange={handleFileUpload} />
                    </label>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Right Column (Main): Inputs & Calculation */}
                <div className="lg:col-span-2 space-y-6 order-1 lg:order-2">
                    
                    {/* Month Selection & Summary */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <div className="flex flex-col sm:flex-row justify-between items-center gap-6 mb-6">
                            <div className="w-full sm:w-auto">
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Competência (Mês/Ano)</label>
                                <input 
                                    type="month" 
                                    value={mesApuracao.toISOString().substring(0, 7)} 
                                    onChange={(e) => { 
                                        if(e.target.value) { 
                                            const [y, m] = e.target.value.split('-'); 
                                            setMesApuracao(new Date(parseInt(y), parseInt(m)-1, 1)); 
                                        } 
                                    }} 
                                    className="w-full p-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 font-bold dark:text-white" 
                                />
                            </div>
                            
                            <div className="flex gap-4">
                                <div className="text-center">
                                    <p className="text-[10px] font-bold text-slate-500 uppercase">Apuração do Mês</p>
                                    <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                                        R$ {(Object.values(faturamentoPorCnae).reduce((acc: number, curr) => {
                                            const state = curr as CnaeInputState;
                                            return acc + parseFloat(state.valor.replace(/\./g,'').replace(',','.') || '0');
                                        }, 0) + (filialComercio || 0) + (filialIndustria || 0) + (filialServico || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </p>
                                </div>
                                <div className="text-center px-4 py-1 bg-sky-50 dark:bg-sky-900/20 rounded-lg border border-sky-100 dark:border-sky-800">
                                    <p className="text-[10px] font-bold text-sky-700 dark:text-sky-400 uppercase">DAS Estimado</p>
                                    <p className="text-xl font-mono font-bold text-sky-700 dark:text-sky-300">
                                        R$ {resumo.das_mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase mb-4 flex items-center gap-2 border-b border-slate-100 dark:border-slate-700 pb-2">
                            <CalculatorIcon className="w-4 h-4 text-sky-600" /> Discriminativo de Receitas por CNAE (Matriz)
                        </h3>

                        <div className="space-y-4">
                            {Object.entries(faturamentoPorCnae).map(([key, value]) => {
                                const state = value as CnaeInputState;
                                const parts = key.split('::');
                                const type = parts.length >= 2 ? parts[0] : 'activity';
                                const cnaeCode = parts.length >= 3 ? parts[2] : 'UNKNOWN';
                                const anexoCode = parts.length >= 4 ? parts[3] : empresa.anexo;
                                const isExtra = type === 'extra';
                                const label = isExtra ? 'Receita Adicional' : (type === 'principal' ? 'Atividade Principal' : 'Atividade Secundária');

                                return (
                                    <div key={key} className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/20 hover:border-sky-300 transition-colors relative group">
                                        
                                        {/* Botão de Remover para Itens Extras */}
                                        {isExtra && (
                                            <button 
                                                onClick={() => handleRemoveRevenueItem(key)}
                                                className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-red-500 bg-white dark:bg-slate-800 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Remover este item"
                                            >
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        )}

                                        <div className="flex flex-col md:flex-row justify-between gap-4 mb-3">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-white dark:bg-slate-800 rounded text-sky-600 dark:text-sky-400 border border-slate-100 dark:border-slate-600">
                                                    <DocumentTextIcon className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-slate-800 dark:text-slate-200">{cnaeCode}</span>
                                                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${isExtra ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}>
                                                            {label}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">Anexo {anexoCode}</p>
                                                </div>
                                            </div>
                                            <div className="w-full md:w-48">
                                                <CurrencyInput 
                                                    value={parseFloat(state.valor.replace(/\./g,'').replace(',','.') || '0')} 
                                                    onChange={(val) => handleFaturamentoChange(key, (val * 100).toFixed(0))}
                                                    className="w-full"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-600">
                                            <label className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.isExterior ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}>
                                                <input type="checkbox" checked={state.isExterior} onChange={() => handleOptionToggle(key, 'isExterior')} className="hidden" />
                                                <GlobeIcon className="w-3 h-3" /> Serviço no Exterior
                                            </label>
                                            
                                            {['III', 'IV', 'V', 'III_V'].includes(anexoCode) && (
                                                <label className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.issRetido ? 'bg-teal-100 text-teal-700 border-teal-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}>
                                                    <input type="checkbox" checked={state.issRetido} onChange={() => handleOptionToggle(key, 'issRetido')} className="hidden" />
                                                    ISS Retido
                                                </label>
                                            )}

                                            {['I', 'II'].includes(anexoCode) && (
                                                <>
                                                    <label className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.icmsSt ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}>
                                                        <input type="checkbox" checked={state.icmsSt} onChange={() => handleOptionToggle(key, 'icmsSt')} className="hidden" />
                                                        ICMS ST
                                                    </label>
                                                    <label className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.isMonofasico ? 'bg-green-100 text-green-700 border-green-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}>
                                                        <input type="checkbox" checked={state.isMonofasico} onChange={() => handleOptionToggle(key, 'isMonofasico')} className="hidden" />
                                                        <TagIcon className="w-3 h-3" /> PIS/COFINS Monofásico
                                                    </label>
                                                </>
                                            )}
                                            
                                            <label className={`cursor-pointer px-3 py-1 rounded text-xs font-bold border transition-colors flex items-center gap-2 select-none ${state.isImune ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}>
                                                <input type="checkbox" checked={state.isImune} onChange={() => handleOptionToggle(key, 'isImune')} className="hidden" />
                                                Imunidade
                                            </label>
                                        </div>
                                    </div>
                                );
                            })}

                            <button 
                                onClick={handleAddRevenueItem}
                                className="w-full py-3 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg text-slate-500 dark:text-slate-400 hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400 transition-colors flex items-center justify-center gap-2 font-bold text-sm"
                            >
                                <PlusIcon className="w-4 h-4" />
                                Adicionar Receita / Segregar (ST/Normal)
                            </button>

                            <div className="pt-4 mt-6 border-t border-slate-100 dark:border-slate-700">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase mb-4 flex items-center gap-2">
                                    <BuildingIcon className="w-4 h-4 text-sky-600" /> Faturamento Filiais (Consolidação)
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <CurrencyInput 
                                        label="Filial Comércio"
                                        value={filialComercio}
                                        onChange={setFilialComercio}
                                        className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700"
                                    />
                                    <CurrencyInput 
                                        label="Filial Indústria"
                                        value={filialIndustria}
                                        onChange={setFilialIndustria}
                                        className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700"
                                    />
                                    <CurrencyInput 
                                        label="Filial Serviço"
                                        value={filialServico}
                                        onChange={setFilialServico}
                                        className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700"
                                    />
                                </div>
                            </div>

                            <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
                                <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Informações Adicionais</h3>
                                <CurrencyInput 
                                    label="ICMS sobre Vendas (Informativo)"
                                    value={icmsVendas}
                                    onChange={setIcmsVendas}
                                    placeholder="Valor destacado em nota"
                                />
                            </div>
                        </div>

                        <div className="mt-6 flex gap-3">
                            <button 
                                onClick={handleSaveMesVigente} 
                                disabled={isSaving} 
                                className={`flex-1 py-4 font-bold text-lg rounded-xl transition-all flex justify-center items-center gap-2 shadow-lg ${
                                    saveSuccess 
                                    ? 'bg-green-500 hover:bg-green-600 text-white' 
                                    : 'bg-sky-600 hover:bg-sky-700 text-white'
                                }`}
                            >
                                {isSaving ? (
                                    <LoadingSpinner small />
                                ) : saveSuccess ? (
                                    <><AnimatedCheckIcon className="text-white" size="w-6 h-6" /><span>Salvo!</span></>
                                ) : (
                                    <><SaveIcon className="w-5 h-5" /><span>Calcular e Salvar</span></>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Alíquota Efetiva Info */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-sky-100 dark:bg-sky-900/30 rounded-lg text-sky-600 dark:text-sky-400">
                                <CalculatorIcon className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Alíquota Efetiva Atual</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Baseado no RBT12 e Anexo</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg">
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1">Alíquota Nominal</p>
                                <p className="text-2xl font-mono font-bold text-slate-800 dark:text-slate-200">{resumo.aliq_nom}%</p>
                            </div>
                            <div className="bg-sky-50 dark:bg-sky-900/20 p-4 rounded-lg border border-sky-100 dark:border-sky-800">
                                <p className="text-xs font-bold text-sky-700 dark:text-sky-300 uppercase mb-1">Alíquota Efetiva</p>
                                <p className="text-3xl font-mono font-bold text-sky-600 dark:text-sky-400">{resumo.aliq_eff.toFixed(2)}%</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Left Column (Sidebar): History & Setup */}
                <div className="lg:col-span-1 space-y-6 order-2 lg:order-1">
                    {/* RBT12 Card */}
                    <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                            <HistoryIcon className="w-4 h-4 text-sky-600" /> RBT12 (Histórico 12m)
                        </h3>
                        <button onClick={() => setIsHistoryModalOpen(true)} className="text-[10px] text-sky-600 hover:underline font-bold w-full text-right mb-2">Editar Manual</button>
                        <div className="p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg mb-3">
                            <p className="text-[10px] text-slate-500 uppercase font-bold">Receita Bruta Acumulada</p>
                            <p className="text-lg font-mono font-bold text-slate-900 dark:text-white">R$ {totalRbt12Manual.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                            
                            {/* Exibição Segregada */}
                            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-600 flex justify-between text-[10px] font-bold">
                                <div className="text-slate-600 dark:text-slate-400">
                                    <span className="block uppercase text-[9px] text-slate-400">Interno</span>
                                    R$ {resumo.rbt12Interno.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </div>
                                <div className="text-indigo-600 dark:text-indigo-400 text-right">
                                    <span className="block uppercase text-[9px] text-indigo-400">Externo</span>
                                    R$ {resumo.rbt12Externo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </div>
                            </div>
                            <p className="text-[9px] text-slate-400 mt-2 italic text-center">* Base de cálculo segregada para faixa</p>
                        </div>
                    </div>

                    {/* Folha Card */}
                    <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                            <UserIcon className="w-4 h-4 text-sky-600" /> Folha de Salários (12m)
                        </h3>
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <CurrencyInput value={folha12Input} onChange={setFolha12Input} className="flex-1" />
                                <button onClick={() => onUpdateFolha12(empresa.id, folha12Input)} className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 p-2 rounded-lg text-slate-600 dark:text-slate-300"><SaveIcon className="w-4 h-4" /></button>
                            </div>
                            <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">Fator R Calculado</label>
                                    <span className={`text-xs font-bold ${resumo.fator_r >= 0.28 ? 'text-green-600' : 'text-orange-600'}`}>
                                        {(resumo.fator_r * 100).toFixed(2)}%
                                    </span>
                                </div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                    <div className={`h-2 rounded-full ${resumo.fator_r >= 0.28 ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${Math.min(resumo.fator_r * 100, 100)}%` }}></div>
                                </div>
                                <p className="text-[9px] text-slate-400 mt-1">Meta: 28% para Anexo III (se aplicável)</p>
                            </div>
                        </div>
                    </div>

                    {/* Notas Recentes */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">Notas Importadas</h3>
                        {notas.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                                    <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                                        <tr>
                                            <th className="px-4 py-2">Data</th>
                                            <th className="px-4 py-2 text-right">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {notas.slice(0, 5).map(nota => (
                                            <tr key={nota.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-4 py-2">{new Date(nota.data).toLocaleDateString()}</td>
                                                <td className="px-4 py-2 text-right font-mono font-bold text-slate-700 dark:text-slate-200">
                                                    {nota.valor.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-slate-500 dark:text-slate-400 text-sm text-center py-4">Nenhuma nota importada.</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal de Histórico Manual */}
            {isHistoryModalOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[60] animate-fade-in" onClick={() => setIsHistoryModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">Editor de Histórico RBT12</h3>
                            <button onClick={() => setIsHistoryModalOpen(false)} className="text-slate-400 hover:text-slate-600"><div className="rotate-45"><PlusIcon className="w-5 h-5" /></div></button>
                        </div>
                        <div className="p-4 overflow-y-auto flex-grow space-y-3">
                            <p className="text-xs text-slate-500 mb-2">Informe o faturamento bruto mensal dos últimos 12 meses para cálculo correto da alíquota.</p>
                            {Array.from({length: 12}).map((_, i) => {
                                const d = new Date(mesApuracao); // Baseado no mês selecionado
                                d.setMonth(d.getMonth() - (i + 1));
                                const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                                const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                                
                                return (
                                    <div key={key} className="flex justify-between items-center gap-4">
                                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 capitalize w-1/3">{label}</label>
                                        <CurrencyInput 
                                            value={manualRbtHistory[key] || 0} 
                                            onChange={(val) => setManualRbtHistory(prev => ({...prev, [key]: val}))}
                                            className="flex-grow"
                                        />
                                    </div>
                                )
                            })}
                        </div>
                        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button onClick={() => setIsHistoryModalOpen(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg">Cancelar</button>
                            <button onClick={handleSaveHistory} className="px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700">Salvar Histórico</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SimplesNacionalDetalhe;
