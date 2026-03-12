import React, { useState } from 'react';
import { type ComparisonResult } from '../types';
import { FormattedText } from './FormattedText';
import { DownloadIcon } from './Icons';

const ResultCard: React.FC<{ result: ComparisonResult['result1'] }> = ({ result }) => (
    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg h-full">
        <h2 className="text-xl font-bold text-sky-700 dark:text-sky-400 mb-3">{result.query}</h2>
        <div className="prose prose-slate dark:prose-invert max-w-none text-slate-600 dark:text-slate-300 text-sm">
            <FormattedText text={result.text} />
        </div>
    </div>
);

const ComparisonDisplay: React.FC<{ result: ComparisonResult | null }> = ({ result }) => {
    const [isExporting, setIsExporting] = useState(false);

    const handleExportPDF = async () => {
        if (!result) return;
        setIsExporting(true);
        try {
            const { default: jsPDF } = await import('jspdf');
            const { default: html2canvas } = await import('html2canvas');
            
            const element = document.getElementById('comparison-content');
            if (!element) return;
            
            const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
            
            const canvas = await html2canvas(element, { 
                scale: 2,
                backgroundColor: theme === 'dark' ? '#1e293b' : '#f8fafc',
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

            const filename = `comparativo-${result.result1.query.replace(/[^a-zA-Z0-9]/g, '-')}-vs-${result.result2.query.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;
            pdf.save(filename);
        } catch (e) {
            console.error("Erro ao exportar PDF:", e);
        } finally {
            setIsExporting(false);
        }
    };

    if (!result) {
        return null;
    }

    return (
        <div id="comparison-content" className="space-y-6 animate-fade-in">
            {/* AI Summary Section */}
            <div className="p-6 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                 <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Análise Comparativa por IA</h2>
                    <button
                        onClick={handleExportPDF}
                        disabled={isExporting}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <DownloadIcon className="w-5 h-5" />
                        {isExporting ? 'Exportando...' : 'Exportar PDF'}
                    </button>
                 </div>
                 <div className="prose prose-slate dark:prose-invert max-w-none text-slate-600 dark:text-slate-300">
                    <FormattedText text={result.summary} />
                </div>
            </div>

            {/* Side-by-Side Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ResultCard result={result.result1} />
                <ResultCard result={result.result2} />
            </div>
        </div>
    );
};

export default ComparisonDisplay;
