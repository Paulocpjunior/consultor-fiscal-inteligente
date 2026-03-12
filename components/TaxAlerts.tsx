import React from 'react';
import { SearchResult, SearchType } from '../types';
import { FormattedText } from './FormattedText';
import { ShieldIcon } from './Icons';

const extractTaxInfo = (text: string): string => {
    const lines = text.split('\n');
    
    // Look for relevant tax-related headers
    const taxHeaders = ['**Incidência de Impostos**', '**Retenção de ISS?**', '**Alertas e Prazos**', '**Alertas**', '**Pontos de Atenção Críticos**', '**Pontos de Atenção e Riscos**'];
    let startIndex = -1;
    
    for (const header of taxHeaders) {
        startIndex = lines.findIndex(line => line.includes(header));
        if (startIndex !== -1) break;
    }
    
    if (startIndex === -1) {
        return 'Nenhuma informação de alerta ou impostos encontrada.';
    }

    let endIndex = lines.findIndex((line, index) => index > startIndex && line.startsWith('**') && line.endsWith('**'));
    if (endIndex === -1) {
        endIndex = lines.length;
    }
    
    return lines.slice(startIndex + 1, endIndex).join('\n').trim();
};


interface TaxAlertsProps {
    results: SearchResult[];
    searchType: SearchType;
}

const TaxAlerts: React.FC<TaxAlertsProps> = ({ results, searchType }) => {
    if (!results || results.length === 0) {
        return null;
    }

    const isReforma = searchType === SearchType.REFORMA_TRIBUTARIA;
    const title = isReforma ? "Principais Riscos e Pontos de Atenção" : "Alertas de Impostos";
    const description = isReforma
        ? "Análise dos principais riscos e pontos que exigem planejamento e adaptação."
        : "Resumo rápido da incidência de impostos para os códigos consultados.";


    return (
        <section className="mt-8 p-6 bg-white dark:bg-slate-800 rounded-lg shadow-sm animate-fade-in">
            <div className="flex items-center mb-4">
                <ShieldIcon className="w-7 h-7 text-sky-600 dark:text-sky-400" />
                <h2 className="ml-3 text-2xl font-bold text-slate-800 dark:text-slate-100">
                    {title}
                </h2>
            </div>
            <p className="mb-6 text-slate-500 dark:text-slate-400">
                {description}
            </p>

            <div className={`grid grid-cols-1 ${results.length > 1 ? 'md:grid-cols-2' : ''} gap-6`}>
                {results.map((result) => (
                    <div key={result.query} className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                        <h3 className="font-bold text-lg text-sky-700 dark:text-sky-400 mb-2">
                           {isReforma ? `Análise: ${result.query}` : `${searchType} ${result.query}`}
                        </h3>
                        <div className="prose prose-sm prose-slate dark:prose-invert max-w-none text-slate-600 dark:text-slate-300">
                           <FormattedText text={extractTaxInfo(result.text)} />
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default TaxAlerts;
