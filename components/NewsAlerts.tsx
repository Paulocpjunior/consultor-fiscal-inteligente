import React, { useState, useEffect } from 'react';
import { fetchNewsAlerts } from '../services/geminiService';
import { type NewsAlert } from '../types';
import { NewspaperIcon } from './Icons';

const AlertCard: React.FC<{ alert: NewsAlert }> = ({ alert }) => {
    const isValidUrl = alert.source && alert.source.startsWith('http');

    if (!isValidUrl) {
        return (
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg flex flex-col h-full">
                <h3 className="font-bold text-md text-sky-700 dark:text-sky-400 mb-2">
                    {alert.title}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 flex-grow">
                    {alert.summary}
                </p>
                <span className="text-sm text-slate-400 mt-4 self-start">
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
            className="block bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg flex flex-col h-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
            <h3 className="font-bold text-md text-sky-700 dark:text-sky-400 mb-2">
                {alert.title}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 flex-grow">
                {alert.summary}
            </p>
            <span className="text-sm font-semibold text-sky-600 dark:text-sky-400 mt-4 self-start">
                Ler mais &rarr;
            </span>
        </a>
    );
};

const SkeletonCard: React.FC = () => (
    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg animate-pulse">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-3"></div>
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-full mb-2"></div>
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-5/6 mb-4"></div>
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
    </div>
);

const NewsAlerts: React.FC = () => {
    const [alerts, setAlerts] = useState<NewsAlert[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadAlerts = async () => {
            try {
                const data = await fetchNewsAlerts();
                setAlerts(data);
            } catch (err) {
                // For this non-critical feature, we log the error to the console
                // but don't display an error message in the UI to avoid disruption.
                console.error("Failed to load news alerts:", err);
                setError(err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.');
            } finally {
                setIsLoading(false);
            }
        };

        loadAlerts();
    }, []);

    // If there was an error fetching alerts, just don't show the component.
    if (error) {
        return null;
    }

    // Don't render the section at all if loading is finished and there are no alerts.
    if (!isLoading && alerts.length === 0) {
        return null;
    }

    return (
        <section className="mt-8 p-6 bg-white dark:bg-slate-800 rounded-lg shadow-sm animate-fade-in">
            <div className="flex items-center mb-4">
                <NewspaperIcon className="w-7 h-7 text-sky-600 dark:text-sky-400" />
                <h2 className="ml-3 text-2xl font-bold text-slate-800 dark:text-slate-100">
                    Fique por Dentro: Últimas Atualizações Fiscais
                </h2>
            </div>
            <p className="mb-6 text-slate-500 dark:text-slate-400">
                Notícias e atualizações importantes do mundo fiscal, selecionadas por IA.
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

export default NewsAlerts;