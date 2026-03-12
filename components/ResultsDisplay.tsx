import React, { useState } from 'react';
import { FormattedText } from './FormattedText';
import { type SearchResult, SearchType } from '../types';
import { DownloadIcon, ExternalLinkIcon, LightBulbIcon, StarIcon, CalculatorIcon } from './Icons';
import IbptCalculator from './IbptCalculator';
import { motion } from 'motion/react';

interface ResultsDisplayProps {
    result: SearchResult | null;
    error: string | null;
    onStartCompare: () => void;
    isFavorite: boolean;
    onToggleFavorite: () => void;
    onError: (message: string) => void;
    searchType: SearchType;
    onFindSimilar: () => void;
    onShowToast?: (message: string) => void;
}


const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ result, error, onStartCompare, isFavorite, onToggleFavorite, onError, searchType, onFindSimilar, onShowToast }) => {
    const [isExporting, setIsExporting] = useState(false);
    const [animateFavorite, setAnimateFavorite] = useState(false);

    const handleToggleFavoriteClick = () => {
        onToggleFavorite();
        setAnimateFavorite(true);
        setTimeout(() => setAnimateFavorite(false), 300);
    };

    const handleExportPDF = async () => {
        if (!result) return;
        setIsExporting(true);
        try {
            const { default: jsPDF } = await import('jspdf');
            const { default: html2canvas } = await import('html2canvas');

            const element = document.getElementById(`result-content-${result.query}`);
            if (!element) {
                console.error("Elemento para exportar não encontrado.");
                return;
            }
            
            const canvas = await html2canvas(element, { 
                scale: 2,
                backgroundColor: '#ffffff',
                logging: false,
                useCORS: true
            });
            const imgData = canvas.toDataURL('image/png');

            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            const imgProps = pdf.getImageProperties(imgData);
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            
            let heightLeft = pdfHeight;
            let position = 0;
            const pageHeight = pdf.internal.pageSize.getHeight();

            pdf.setFontSize(10);
            pdf.setTextColor(100);
            pdf.text('Consultor Fiscal Inteligente - Análise Gerada por IA', 10, 10);

            pdf.addImage(imgData, 'PNG', 0, position + 15, pdfWidth, pdfHeight);
            heightLeft -= (pageHeight - 15);

            while (heightLeft > 0) {
                position = heightLeft - pdfHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
                heightLeft -= pageHeight;
            }
            
            const pageCount = pdf.getNumberOfPages();
            for(let i = 1; i <= pageCount; i++) {
                pdf.setPage(i);
                pdf.setFontSize(8);
                pdf.setTextColor(150);
                pdf.text(`Página ${i} de ${pageCount}`, pdf.internal.pageSize.getWidth() - 30, pdf.internal.pageSize.getHeight() - 10);
            }
            
            pdf.save(`consulta-${result.query.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`);
        } catch (e) {
            console.error("Erro ao exportar PDF:", e);
            onError("Falha ao gerar o PDF. Tente novamente.");
        } finally {
            setIsExporting(false);
        }
    };

    if (error) {
        return (
            <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 font-bold dark:text-red-300"
            >
                <p className="font-bold">Ocorreu um erro</p>
                <p>{error}</p>
            </motion.div>
        );
    }

    if (!result) {
        return null;
    }

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-6"
        >
            <div id={`result-content-${result.query}`} className="mt-6 p-8 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                {/* Header visible in PDF */}
                <div className="mb-6 border-b border-slate-100 dark:border-slate-700 pb-6">
                     <div className="flex justify-between items-start">
                        <div>
                            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                                Resultado da Análise
                            </h2>
                            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mt-1">
                                Consulta: <span className="font-bold text-sky-700 dark:text-sky-400">{result.query}</span>
                            </p>
                        </div>
                        <div className="flex gap-2 no-print">
                            <button 
                                onClick={handleToggleFavoriteClick}
                                className={`p-2 rounded-lg border transition-all ${isFavorite ? 'bg-amber-50 border-amber-200 text-amber-500' : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-400 hover:text-slate-600'}`}
                                title={isFavorite ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}
                            >
                                <StarIcon className={`w-5 h-5 ${animateFavorite ? 'animate-ping' : ''}`} solid={isFavorite} />
                            </button>
                            <button 
                                onClick={handleExportPDF}
                                disabled={isExporting}
                                className="p-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 transition-all disabled:opacity-50"
                                title="Exportar PDF"
                            >
                                {isExporting ? <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /> : <DownloadIcon className="w-5 h-5" />}
                            </button>
                        </div>
                     </div>
                </div>

                {/* Optional Context Display */}
                {result.context && (result.context.aliquotaIcms || result.context.aliquotaPisCofins || result.context.aliquotaIss || result.context.userNotes) && (
                    <div className="mb-8 p-4 bg-sky-50/50 dark:bg-sky-900/10 rounded-xl border border-sky-100 dark:border-sky-800/50 flex items-start gap-4">
                         <div className="p-2 bg-sky-100 dark:bg-sky-900/30 rounded-lg text-sky-600 dark:text-sky-400">
                            <CalculatorIcon className="w-5 h-5" />
                         </div>
                         <div className="flex-grow">
                             <p className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider">Contexto Tributário Considerado</p>
                             <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2 text-sm font-bold text-slate-800 dark:text-slate-300">
                                 {result.context.aliquotaIss && <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" /> ISS: <strong className="text-sky-700 dark:text-sky-400">{result.context.aliquotaIss}%</strong></span>}
                                 {result.context.aliquotaIcms && <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" /> ICMS: <strong className="text-sky-700 dark:text-sky-400">{result.context.aliquotaIcms}%</strong></span>}
                                 {result.context.aliquotaPisCofins && <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" /> PIS/COFINS: <strong className="text-sky-700 dark:text-sky-400">{result.context.aliquotaPisCofins}%</strong></span>}
                             </div>
                             {result.context.userNotes && (
                                <div className="mt-4 p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg border-l-4 border-sky-400 dark:border-sky-600">
                                    <p className="text-sm text-slate-700 dark:text-slate-300 italic">
                                        "{result.context.userNotes}"
                                    </p>
                                </div>
                             )}
                         </div>
                    </div>
                )}

                <div className="prose prose-slate dark:prose-invert max-w-none">
                    <FormattedText text={result.text} />
                </div>

                {/* Grounding Sources Section */}
                {result.sources && result.sources.length > 0 && (
                    <div className="mt-10 pt-8 border-t border-slate-100 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2 uppercase tracking-widest">
                            <ExternalLinkIcon className="w-4 h-4 text-sky-500" />
                            Fontes Consultadas
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {result.sources.map((source, idx) => (
                                <a 
                                    key={idx}
                                    href={source.web.uri} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="group flex items-center p-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-xl hover:border-sky-300 dark:hover:border-sky-700 transition-all"
                                >
                                    <div className="w-8 h-8 flex-shrink-0 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 group-hover:text-sky-500 transition-colors">
                                        <ExternalLinkIcon className="w-4 h-4" />
                                    </div>
                                    <div className="ml-3 overflow-hidden">
                                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-sky-600 dark:group-hover:text-sky-400 truncate transition-colors">
                                            {source.web.title || source.web.uri}
                                        </p>
                                        <p className="text-[10px] text-slate-400 truncate">
                                            {source.web.uri}
                                        </p>
                                    </div>
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* IBPT Calculator Section */}
            {[SearchType.NCM, SearchType.SERVICO, SearchType.CFOP].includes(searchType) && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    <IbptCalculator 
                        initialRates={result.ibpt} 
                        queryCode={result.query} 
                        contextRates={result.context ? {
                            icms: result.context.aliquotaIcms,
                            pisCofins: result.context.aliquotaPisCofins,
                            iss: result.context.aliquotaIss
                        } : undefined}
                    />
                </motion.div>
            )}

            {searchType === SearchType.SERVICO && (
                <div className="p-4 bg-sky-50 dark:bg-sky-900/10 rounded-xl border-l-4 border-sky-500">
                    <div className="flex items-start">
                        <ExternalLinkIcon className="w-5 h-5 text-sky-600 dark:text-sky-400 mr-3 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-300 mb-1">
                                Para mais detalhes e a lista completa, consulte a fonte oficial:
                            </p>
                            <a 
                                href="https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-sm text-sky-600 dark:text-sky-400 hover:underline font-bold"
                            >
                                Lei Complementar nº 116/2003
                            </a>
                        </div>
                    </div>
                </div>
            )}
            
            <div className="mt-6 flex flex-col sm:flex-row gap-4 flex-wrap justify-end no-print">
                <button
                    onClick={onStartCompare}
                    className="btn-press w-full sm:w-auto px-6 py-3 bg-slate-100 dark:bg-slate-700 text-slate-800 font-bold dark:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                    Comparar este código
                </button>
                 {searchType === SearchType.SERVICO && (
                     <button
                        onClick={onFindSimilar}
                        className="btn-press w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-slate-100 dark:bg-slate-700 text-slate-800 font-bold dark:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    >
                        <LightBulbIcon className="w-5 h-5" />
                        Serviços Similares
                    </button>
                )}
            </div>
        </motion.div>
    );
};

export default ResultsDisplay;
