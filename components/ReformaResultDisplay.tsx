import React, { useState } from 'react';
import { FormattedText } from './FormattedText';
import { type SearchResult } from '../types';
import { DownloadIcon, InfoIcon, RocketIcon, StarIcon } from './Icons';

const REFORMA_CNAE_DETAIL_SEPARATOR = '---DETALHAMENTO_CNAE---';
const REFORMA_SUMMARY_SEPARATOR = '---RESUMO_EXECUTIVO---';
const REFORMA_CRUCIAL_SEPARATOR = '---MUDANCAS_CRUCIAIS---';
const REFORMA_ATUAL_SEPARATOR = '---CENARIO_ATUAL---';
const REFORMA_NOVO_SEPARATOR = '---NOVO_CENARIO---';
const REFORMA_OPORTUNIDADES_SEPARATOR = '---OPORTUNIDADES---';

const parseReformaText = (text: string | undefined) => {
    if (!text) {
        return { detalhamentoCnae: '', resumo: '', mudancas: '', atual: '', novo: '', oportunidades: '' };
    }

    const getSection = (startSeparator: string, endSeparator?: string) => {
        const startIndex = text.indexOf(startSeparator);
        if (startIndex === -1) return '';
        
        const contentStart = startIndex + startSeparator.length;
        
        if (endSeparator) {
            const endIndex = text.indexOf(endSeparator, contentStart);
            return text.substring(contentStart, endIndex === -1 ? undefined : endIndex).trim();
        }
        
        return text.substring(contentStart).trim();
    };

    return {
        detalhamentoCnae: getSection(REFORMA_CNAE_DETAIL_SEPARATOR, REFORMA_SUMMARY_SEPARATOR),
        resumo: getSection(REFORMA_SUMMARY_SEPARATOR, REFORMA_CRUCIAL_SEPARATOR),
        mudancas: getSection(REFORMA_CRUCIAL_SEPARATOR, REFORMA_ATUAL_SEPARATOR),
        atual: getSection(REFORMA_ATUAL_SEPARATOR, REFORMA_NOVO_SEPARATOR),
        novo: getSection(REFORMA_NOVO_SEPARATOR, REFORMA_OPORTUNIDADES_SEPARATOR),
        oportunidades: getSection(REFORMA_OPORTUNIDADES_SEPARATOR),
    };
};

interface ReformaResultDisplayProps {
    result: SearchResult;
    isFavorite: boolean;
    onToggleFavorite: () => void;
}

const Section: React.FC<{ title: string; children: React.ReactNode; variant?: 'default' | 'card' }> = ({ title, children, variant = 'default' }) => {
    const containerClasses = variant === 'card' 
        ? "bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg h-full"
        : "p-6 bg-white dark:bg-slate-800 rounded-lg shadow-sm";

    return (
        <div className={containerClasses}>
            <h2 className="text-xl font-bold text-sky-700 dark:text-sky-400 mb-3">{title}</h2>
            <div className="prose prose-slate dark:prose-invert max-w-none text-slate-600 dark:text-slate-300 text-sm">
                {children}
            </div>
        </div>
    );
};

const ReformaResultDisplay: React.FC<ReformaResultDisplayProps> = ({ result, isFavorite, onToggleFavorite }) => {
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
            if (!element) return;
            
            const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';

            const canvas = await html2canvas(element, { 
                scale: 2,
                backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff',
            });
            const imgData = canvas.toDataURL('image/png');

            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

            const imgProps = pdf.getImageProperties(imgData);
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            
            let heightLeft = pdfHeight;
            let position = 0;
            const pageHeight = pdf.internal.pageSize.getHeight();

            pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
            heightLeft -= pageHeight;

            while (heightLeft > 0) {
                position = heightLeft - pdfHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
                heightLeft -= pageHeight;
            }
            
            pdf.save(`reforma-tributaria-${result.query.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`);
        } catch (e) {
            console.error("Erro ao exportar PDF:", e);
        } finally {
            setIsExporting(false);
        }
    };

    const parsedText = parseReformaText(result.text);

    return (
        <div id={`result-content-${result.query}`} className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="p-6 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                <div className="flex justify-between items-start gap-4">
                    <div>
                        <p className="text-sm font-semibold text-sky-600 dark:text-sky-400">Análise de Impacto da Reforma Tributária</p>
                        <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-slate-100 mt-1">{result.query}</h1>
                    </div>
                    <div className="flex-shrink-0 flex gap-2">
                        <button
                            onClick={handleToggleFavoriteClick}
                            title={isFavorite ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
                            className={`btn-press flex items-center justify-center gap-2 px-3 py-2 font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-colors ${
                                isFavorite 
                                ? 'bg-amber-100 dark:bg-amber-800/50 text-amber-600 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-800' 
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }`}
                        >
                            <StarIcon className={`w-5 h-5 ${animateFavorite ? 'animate-pop-in' : ''}`} solid={isFavorite} />
                            <span className="hidden sm:inline">{isFavorite ? 'Favorito' : 'Favoritar'}</span>
                        </button>
                        <button
                            onClick={handleExportPDF}
                            disabled={isExporting}
                            className="btn-press flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <DownloadIcon className="w-5 h-5" />
                            <span className="hidden sm:inline">{isExporting ? 'Exportando...' : 'PDF'}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Detalhamento do CNAE */}
            {parsedText.detalhamentoCnae && (
                <div className="p-6 bg-sky-50 dark:bg-sky-900/30 rounded-lg shadow-sm border-l-4 border-sky-500 dark:border-sky-400">
                    <div className="flex items-center mb-3">
                        <InfoIcon className="w-6 h-6 text-sky-600 dark:text-sky-400" />
                        <h2 className="ml-3 text-xl font-bold text-sky-800 dark:text-sky-200">
                            {`Detalhamento do CNAE: ${result.query.replace('Análise para CNAE ', '')}`}
                        </h2>
                    </div>
                    <div className="prose prose-slate dark:prose-invert max-w-none text-slate-600 dark:text-slate-300 text-sm pl-9">
                         <FormattedText text={parsedText.detalhamentoCnae} />
                    </div>
                </div>
            )}

            {/* Resumo Executivo */}
            {parsedText.resumo && (
                <Section title="Resumo Executivo para o Empresário">
                    <FormattedText text={parsedText.resumo} />
                </Section>
            )}

            {/* Mudanças Cruciais */}
            {parsedText.mudancas && (
                 <Section title="Mudanças Cruciais em Destaque">
                    <FormattedText text={parsedText.mudancas} />
                </Section>
            )}

            {/* Cenários Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {parsedText.atual && (
                    <Section title="Cenário Atual (Pré-Reforma)" variant="card">
                        <FormattedText text={parsedText.atual} />
                    </Section>
                )}
                {parsedText.novo && (
                     <Section title="Novo Cenário (Pós-Reforma)" variant="card">
                        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/30 rounded-md border-l-4 border-amber-400 dark:border-amber-500">
                            <h4 className="font-semibold text-amber-800 dark:text-amber-200">O que é o Imposto Seletivo (IS)?</h4>
                            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                                Conhecido como "imposto do pecado", o IS é um tributo extra que incide sobre a produção, comercialização ou importação de bens e serviços prejudiciais à saúde ou ao meio ambiente.
                                <br />
                                <strong>Exemplo prático:</strong> cigarros, bebidas alcoólicas e, possivelmente, veículos mais poluentes terão uma alíquota adicional do IS para desestimular seu consumo. A análise da IA abaixo detalhará a aplicabilidade para o seu CNAE.
                            </p>
                        </div>
                        <FormattedText text={parsedText.novo} />
                    </Section>
                )}
            </div>

            {/* Oportunidades - STYLED SECTION */}
            {parsedText.oportunidades && (
                 <div className="p-6 bg-green-50 dark:bg-green-900/30 rounded-lg shadow-sm border-l-4 border-green-500 dark:border-green-400">
                    <div className="flex items-center mb-3">
                        <RocketIcon className="w-6 h-6 text-green-600 dark:text-green-400" />
                        <h2 className="ml-3 text-xl font-bold text-green-800 dark:text-green-200">Incentivos Fiscais e Oportunidades</h2>
                    </div>
                    <div className="prose prose-slate dark:prose-invert max-w-none text-slate-600 dark:text-slate-300 text-sm pl-9">
                        <FormattedText text={parsedText.oportunidades} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReformaResultDisplay;
