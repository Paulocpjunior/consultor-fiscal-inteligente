
import React, { useState, useEffect } from 'react';
import { IbptRates } from '../types';
import { CalculatorIcon, InfoIcon, ChevronDownIcon } from './Icons';
import Tooltip from './Tooltip';

interface IbptCalculatorProps {
    initialRates?: IbptRates;
    queryCode: string;
    contextRates?: {
        icms?: string;
        pisCofins?: string;
        iss?: string;
    };
}

const IbptCalculator: React.FC<IbptCalculatorProps> = ({ initialRates, queryCode, contextRates }) => {
    const [productValue, setProductValue] = useState<number>(100);
    const [origin, setOrigin] = useState<'nacional' | 'importado'>('nacional');
    const [calcMode, setCalcMode] = useState<'ibpt' | 'detailed' | 'reforma'>('ibpt');
    
    // Standard IBPT Aggregate Rates
    const [rates, setRates] = useState<IbptRates>({
        nacional: 0,
        importado: 0,
        estadual: 0,
        municipal: 0
    });

    // Detailed Manual Rates (Optional override)
    const [detailedRates, setDetailedRates] = useState({
        pis: 1.65,
        cofins: 7.60,
        ipi: 0,
        icms: 18,
        iss: 5
    });

    // Reforma Tributaria Rates
    const [reformaRates, setReformaRates] = useState({
        cbs: 8.8, // Contribuição sobre Bens e Serviços (Federal)
        ibs: 17.7, // Imposto sobre Bens e Serviços (Estadual/Municipal)
        is: 0 // Imposto Seletivo (Federal - apenas bens específicos)
    });

    // Load initial rates from Gemini or set defaults
    useEffect(() => {
        if (initialRates) {
            setRates(initialRates);
            
            // If we have context rates from the search form, use them to override defaults in detailed mode
            const icmsVal = contextRates?.icms ? parseFloat(contextRates.icms) : (initialRates.estadual || 18);
            const issVal = contextRates?.iss ? parseFloat(contextRates.iss) : (initialRates.municipal || 5);
            
            // PIS/COFINS split is tricky, if we have a combined rate, we might split it or just use it for one
            let pisVal = 1.65;
            let cofinsVal = 7.60;
            if (contextRates?.pisCofins) {
                const combined = parseFloat(contextRates.pisCofins);
                // Simple split for demonstration if combined is provided
                pisVal = combined * 0.178; // Roughly 1.65/9.25
                cofinsVal = combined * 0.822; // Roughly 7.60/9.25
            }

            setDetailedRates(prev => ({
                ...prev,
                icms: isNaN(icmsVal) ? 18 : icmsVal,
                iss: isNaN(issVal) ? 5 : issVal,
                pis: isNaN(pisVal) ? 1.65 : pisVal,
                cofins: isNaN(cofinsVal) ? 7.60 : cofinsVal
            }));

            // If user provided specific rates in context, maybe default to Detailed mode
            if (contextRates?.icms || contextRates?.pisCofins || contextRates?.iss) {
                setCalcMode('detailed');
            }
        } else {
            setRates({
                nacional: 13.45,
                importado: 0,
                estadual: 17.00,
                municipal: 0
            });
        }
    }, [initialRates, contextRates]);

    const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/\D/g, '');
        const val = parseFloat(raw) / 100;
        setProductValue(isNaN(val) ? 0 : val);
    };

    const handleRateChange = (key: keyof IbptRates, value: string) => {
        const num = parseFloat(value);
        setRates(prev => ({ ...prev, [key]: isNaN(num) ? 0 : num }));
    };

    const handleDetailedRateChange = (key: keyof typeof detailedRates, value: string) => {
        const num = parseFloat(value);
        setDetailedRates(prev => ({ ...prev, [key]: isNaN(num) ? 0 : num }));
    };

    const handleReformaRateChange = (key: keyof typeof reformaRates, value: string) => {
        const num = parseFloat(value);
        setReformaRates(prev => ({ ...prev, [key]: isNaN(num) ? 0 : num }));
    };

    const calculateTax = (rate: number) => productValue * (rate / 100);

    // Calculation Logic
    let federalVal = 0;
    let estadualVal = 0;
    let municipalVal = 0;
    let totalBurden = 0;
    let totalPercentage = 0;

    if (calcMode === 'detailed') {
        // Detailed Mode
        estadualVal = calculateTax(detailedRates.icms);
        
        // Deduct ICMS from PIS/COFINS base (STF ruling)
        const basePisCofins = Math.max(0, productValue - estadualVal);
        const pisVal = basePisCofins * (detailedRates.pis / 100);
        const cofinsVal = basePisCofins * (detailedRates.cofins / 100);
        
        const ipiVal = calculateTax(detailedRates.ipi);
        federalVal = pisVal + cofinsVal + ipiVal;
        
        municipalVal = calculateTax(detailedRates.iss);
        
        totalBurden = federalVal + estadualVal + municipalVal;
        totalPercentage = productValue > 0 ? (totalBurden / productValue) * 100 : 0;
    } else if (calcMode === 'reforma') {
        // Reforma Tributaria Mode
        const cbsVal = calculateTax(reformaRates.cbs);
        const isVal = calculateTax(reformaRates.is);
        federalVal = cbsVal + isVal;
        
        const ibsVal = calculateTax(reformaRates.ibs);
        // IBS is shared between states and municipalities, we'll group it under "Estadual/Municipal"
        estadualVal = ibsVal; 
        municipalVal = 0; // Handled together with IBS
        
        totalBurden = federalVal + estadualVal;
        totalPercentage = reformaRates.cbs + reformaRates.ibs + reformaRates.is;
    } else {
        // IBPT Aggregate Mode
        const federalRate = origin === 'nacional' ? rates.nacional : rates.importado;
        federalVal = calculateTax(federalRate);
        estadualVal = calculateTax(rates.estadual);
        municipalVal = calculateTax(rates.municipal);
        
        totalBurden = federalVal + estadualVal + municipalVal;
        totalPercentage = federalRate + rates.estadual + rates.municipal;
    }

    return (
        <div className="bg-white dark:bg-slate-800/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700 animate-fade-in mt-8 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-sky-100 dark:bg-sky-900/30 rounded-lg text-sky-600 dark:text-sky-400">
                        <CalculatorIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Calculadora de Impostos (IBPT)</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Carga tributária aproximada para <span className="font-mono font-bold text-sky-700 dark:text-sky-400">{queryCode}</span>
                        </p>
                    </div>
                </div>
                
                <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
                    <button 
                        onClick={() => setCalcMode('ibpt')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${calcMode === 'ibpt' ? 'bg-white dark:bg-slate-600 shadow text-sky-700 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                    >
                        Padrão IBPT
                    </button>
                    <button 
                        onClick={() => setCalcMode('detailed')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${calcMode === 'detailed' ? 'bg-white dark:bg-slate-600 shadow text-sky-700 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                    >
                        Detalhado
                    </button>
                    <button 
                        onClick={() => setCalcMode('reforma')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${calcMode === 'reforma' ? 'bg-white dark:bg-slate-600 shadow text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                    >
                        Reforma
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Inputs Section */}
                <div className="space-y-6">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Valor da Operação / Produto</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">R$</span>
                            <input 
                                type="text"
                                value={new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(productValue)}
                                onChange={handleValueChange}
                                className="w-full pl-9 pr-3 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-xl font-bold text-slate-900 dark:text-white text-right transition-colors"
                            />
                        </div>
                    </div>

                    {calcMode === 'ibpt' && (
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase flex items-center gap-1">
                                    Alíquotas IBPT (%)
                                    <Tooltip content="Estimativa média de carga tributária conforme Lei 12.741/2012.">
                                        <InfoIcon className="w-3 h-3 text-slate-400 cursor-help" />
                                    </Tooltip>
                                </p>
                                <div className="flex items-center gap-2 text-[10px] font-bold">
                                    <label className="flex items-center gap-1 cursor-pointer">
                                        <input type="radio" checked={origin === 'nacional'} onChange={() => setOrigin('nacional')} className="text-sky-600 focus:ring-sky-500" />
                                        Nacional
                                    </label>
                                    <label className="flex items-center gap-1 cursor-pointer">
                                        <input type="radio" checked={origin === 'importado'} onChange={() => setOrigin('importado')} className="text-sky-600 focus:ring-sky-500" />
                                        Importado
                                    </label>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">Federal</label>
                                    <input 
                                        type="number" 
                                        value={origin === 'nacional' ? rates.nacional : rates.importado} 
                                        onChange={(e) => handleRateChange(origin === 'nacional' ? 'nacional' : 'importado', e.target.value)}
                                        className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">Estadual</label>
                                    <input 
                                        type="number" 
                                        value={rates.estadual} 
                                        onChange={(e) => handleRateChange('estadual', e.target.value)}
                                        className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">Municipal</label>
                                    <input 
                                        type="number" 
                                        value={rates.municipal} 
                                        onChange={(e) => handleRateChange('municipal', e.target.value)}
                                        className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {calcMode === 'detailed' && (
                        <div className="space-y-3 animate-fade-in">
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">Detalhamento de Alíquotas (%)</p>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">PIS</label>
                                    <input type="number" value={detailedRates.pis} onChange={e => handleDetailedRateChange('pis', e.target.value)} className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">COFINS</label>
                                    <input type="number" value={detailedRates.cofins} onChange={e => handleDetailedRateChange('cofins', e.target.value)} className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">IPI</label>
                                    <input type="number" value={detailedRates.ipi} onChange={e => handleDetailedRateChange('ipi', e.target.value)} className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">ICMS</label>
                                    <input type="number" value={detailedRates.icms} onChange={e => handleDetailedRateChange('icms', e.target.value)} className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">ISS</label>
                                    <input type="number" value={detailedRates.iss} onChange={e => handleDetailedRateChange('iss', e.target.value)} className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-sky-500" />
                                </div>
                            </div>
                        </div>
                    )}

                    {calcMode === 'reforma' && (
                        <div className="space-y-3 animate-fade-in">
                            <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase flex items-center gap-1">
                                Novos Tributos (Reforma)
                                <Tooltip content="Estimativa com base no novo sistema tributário (IBS, CBS e IS).">
                                    <InfoIcon className="w-3 h-3 text-emerald-500 cursor-help" />
                                </Tooltip>
                            </p>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">CBS (Federal)</label>
                                    <input type="number" value={reformaRates.cbs} onChange={e => handleReformaRateChange('cbs', e.target.value)} className="w-full p-2 text-sm bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-emerald-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">IBS (Est/Mun)</label>
                                    <input type="number" value={reformaRates.ibs} onChange={e => handleReformaRateChange('ibs', e.target.value)} className="w-full p-2 text-sm bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-emerald-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] block text-slate-500 mb-1 font-bold">IS (Seletivo)</label>
                                    <input type="number" value={reformaRates.is} onChange={e => handleReformaRateChange('is', e.target.value)} className="w-full p-2 text-sm bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded text-center font-bold text-slate-900 dark:text-white outline-none focus:border-emerald-500" />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Results Visualization */}
                <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-700 flex flex-col justify-center">
                    <div className="space-y-4">
                        {/* Federal */}
                        <div className="flex justify-between items-end border-b border-slate-200 dark:border-slate-800 pb-2">
                            <div>
                                <p className={`text-xs font-bold uppercase ${calcMode === 'reforma' ? 'text-emerald-600' : 'text-sky-600'}`}>
                                    {calcMode === 'reforma' ? 'Federal (CBS + IS)' : 'Federal (IPI, PIS, COFINS)'}
                                </p>
                                <p className="text-[10px] text-slate-400 font-medium">
                                    {calcMode === 'detailed' ? (
                                        <>
                                            PIS: {detailedRates.pis}% | COFINS: {detailedRates.cofins}% | IPI: {detailedRates.ipi}%
                                            <span className="block text-sky-600/70 dark:text-sky-400/70 mt-0.5">
                                                *Base PIS/COFINS reduzida do ICMS
                                            </span>
                                        </>
                                    ) : 
                                     calcMode === 'reforma' ? `CBS: ${reformaRates.cbs}% | IS: ${reformaRates.is}%` :
                                     `Agregado IBPT ${origin === 'nacional' ? 'Nacional' : 'Importado'}`}
                                </p>
                            </div>
                            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(federalVal)}
                            </p>
                        </div>
                        
                        {/* Estadual / IBS */}
                        <div className="flex justify-between items-end border-b border-slate-200 dark:border-slate-800 pb-2">
                            <div>
                                <p className={`text-xs font-bold uppercase ${calcMode === 'reforma' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    {calcMode === 'reforma' ? 'Estadual/Municipal (IBS)' : 'Estadual (ICMS)'}
                                </p>
                                <p className="text-[10px] text-slate-400 font-medium">
                                    {calcMode === 'detailed' ? `Aliquota: ${detailedRates.icms}%` : 
                                     calcMode === 'reforma' ? `Aliquota: ${reformaRates.ibs}%` :
                                     `Agregado IBPT`}
                                </p>
                            </div>
                            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(estadualVal)}
                            </p>
                        </div>
                        
                        {/* Municipal (Hidden in Reforma mode) */}
                        {calcMode !== 'reforma' && (
                            <div className="flex justify-between items-end border-b border-slate-200 dark:border-slate-800 pb-2">
                                <div>
                                    <p className="text-xs font-bold text-purple-600 uppercase">Municipal (ISS)</p>
                                    <p className="text-[10px] text-slate-400 font-medium">
                                        {calcMode === 'detailed' ? `Aliquota: ${detailedRates.iss}%` : `Agregado IBPT`}
                                    </p>
                                </div>
                                <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(municipalVal)}
                                </p>
                            </div>
                        )}
                        
                        {/* Total */}
                        <div className="pt-2">
                            <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                                <p className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase">Total Tributos (Est.)</p>
                                <div className="text-right">
                                    <p className="text-2xl font-extrabold text-slate-900 dark:text-white">
                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBurden)}
                                    </p>
                                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                        ({totalPercentage.toFixed(2)}% da Nota)
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-4 text-center">
                * Fonte: IBPT (Instituto Brasileiro de Planejamento e Tributação) ou parâmetros manuais. Valores aproximados para fins da Lei da Transparência Fiscal (12.741/2012).
            </p>
        </div>
    );
};

export default IbptCalculator;
