import React, { useState, useEffect } from 'react';
import { fetchReformaNews } from '../services/geminiService';
import { type NewsAlert } from '../types';
import { NewspaperIcon } from './Icons';

const AlertCard: React.FC<{ alert: NewsAlert }> = ({ alert }) => {
    const isValidUrl = alert.source && alert.source.startsWith('http');

    if (!isValidUrl) {
        return (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-lg flex flex-col h-full border border-emerald-100 dark:border-emerald-800/50">
                <h3 className="font-bold text-md text-emerald-800 dark:text-emerald-400 mb-2">
                    {alert.title}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 flex-grow">
                    {alert.summary}
                </p>
                <span className="text-sm text-emerald-400/70 mt-4 self-start">
                    Fonte indisponível
                </span>
            </div>
        );
    }

    return (
        <a
            href={alert.source}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-lg flex flex-col h-full border border-emerald-100 dark:border-emerald-800/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors cursor-pointer"
        >
            <h3 className="font-bold text-md text-emerald-800 dark:text-emerald-400 mb-2">
                {alert.title}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 flex-grow">
                {alert.summary}
            </p>
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-4 self-start">
                Ler mais &rarr;
            </span>
        </a>
    );
};

const SkeletonCard: React.FC = () => (
    <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-lg animate-pulse border border-emerald-100 dark:border-emerald-800/50">
        <div className="h-4 bg-emerald-200 dark:bg-emerald-800/50 rounded w-3/4 mb-3"></div>
        <div className="h-3 bg-emerald-200 dark:bg-emerald-800/50 rounded w-full mb-2"></div>
        <div className="h-3 bg-emerald-200 dark:bg-emerald-800/50 rounded w-5/6 mb-4"></div>
        <div className="h-3 bg-emerald-200 dark:bg-emerald-800/50 rounded w-1/4"></div>
    </div>
);

const ReformaNews: React.FC = () => {
    const [alerts, setAlerts] = useState<NewsAlert[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadAlerts = async () => {
            try {
                const data = await fetchReformaNews();
                setAlerts(data);
            } catch (err) {
                console.error("Failed to load reforma news:", err);
                setError(err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.');
            } finally {
                setIsLoading(false);
            }
        };

        loadAlerts();
    }, []);

    if (error) {
        return null;
    }

    if (!isLoading && alerts.length === 0) {
        return null;
    }

    return (
        <section className="mt-8 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-emerald-100 dark:border-emerald-900/50 animate-fade-in">
            <div className="flex items-center mb-4">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
                    <NewspaperIcon className="w-6 h-6" />
                </div>
                <h2 className="ml-3 text-xl font-bold text-slate-800 dark:text-slate-100">
                    Reforma News: Atualizações Automáticas
                </h2>
            </div>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
                Acompanhe as últimas notícias e decisões sobre a Reforma Tributária (IBS, CBS e IS), selecionadas por IA.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {isLoading ? (
                    <>
                        <SkeletonCard />
                        <SkeletonCard />
                        <SkeletonCard />
                    </>
                ) : (
                    alerts.map((alert, index) => (
                        <AlertCard key={index} alert={alert} />
                    ))
                )}
            </div>
        </section>
    );
};

export default ReformaNews;
