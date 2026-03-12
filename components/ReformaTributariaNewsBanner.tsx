import React, { useState } from 'react';

interface NewsItem {
    id: string;
    tag: string;
    tagColor: string;
    title: string;
    description: string;
    date: string;
    icon: string;
}

const NEWS_ITEMS: NewsItem[] = [
    {
        id: '1',
        tag: 'VIGÊNCIA 2026',
        tagColor: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
        title: 'IBS e CBS entram em vigor',
        description: 'A partir de 2026 começa o período de teste: CBS (federal) e IBS (estados/municípios) passam a coexistir com os tributos atuais. Alíquota-teste de 0,1% para CBS e 0,05% para IBS.',
        date: 'Jan 2026',
        icon: '🚀',
    },
    {
        id: '2',
        tag: 'EXTINÇÃO',
        tagColor: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
        title: 'PIS e COFINS extintos',
        description: 'Em 2027, PIS e COFINS são extintos e absorvidos pela CBS. O IPI também é extinto, exceto para produtos que compitam com a ZFM (Zona Franca de Manaus).',
        date: '2027',
        icon: '⚡',
    },
    {
        id: '3',
        tag: 'TRANSIÇÃO',
        tagColor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
        title: 'ICMS e ISS: redução gradual',
        description: 'De 2029 a 2032, as alíquotas de ICMS e ISS são reduzidas progressivamente (90%, 80%, 70%, 40% dos valores originais). Em 2033, ambos são extintos definitivamente.',
        date: '2029–2033',
        icon: '📉',
    },
    {
        id: '4',
        tag: 'ALÍQUOTA',
        tagColor: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
        title: 'Alíquota padrão ~26,5%',
        description: 'A alíquota de referência combinada (IBS + CBS) será fixada pelo Senado até 2024. Estimativas apontam para 26,5%, podendo ser a maior alíquota de IVA do mundo.',
        date: 'Referência',
        icon: '📊',
    },
    {
        id: '5',
        tag: 'BENEFÍCIO',
        tagColor: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
        title: 'Cesta básica com alíquota zero',
        description: 'Alimentos da cesta básica nacional terão alíquota zero. Outros produtos essenciais (saúde, educação, transporte público) têm redução de 60% na alíquota padrão.',
        date: 'Permanente',
        icon: '🛒',
    },
    {
        id: '6',
        tag: 'NOVO IMPOSTO',
        tagColor: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
        title: 'Imposto Seletivo (IS)',
        description: 'Novo tributo extrafiscal sobre produtos prejudiciais à saúde ou ao meio ambiente: cigarros, bebidas alcoólicas, agrotóxicos, veículos, embarcações e aeronaves.',
        date: '2027+',
        icon: '🎯',
    },
];

const ChevronLeftIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
);

const ChevronRightIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
);

const CloseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const ReformaTributariaNewsBanner: React.FC = () => {
    const [visible, setVisible] = useState(true);
    const [activeIndex, setActiveIndex] = useState(0);
    const [expanded, setExpanded] = useState(false);

    if (!visible) return null;

    const current = NEWS_ITEMS[activeIndex];

    const prev = () => setActiveIndex(i => (i - 1 + NEWS_ITEMS.length) % NEWS_ITEMS.length);
    const next = () => setActiveIndex(i => (i + 1) % NEWS_ITEMS.length);

    return (
        <div className="mb-6 animate-fade-in">
            {/* Header bar */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                    </span>
                    <span className="text-[11px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                        Reforma Tributária — Atualizações
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setExpanded(e => !e)}
                        className="text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors uppercase tracking-wide"
                    >
                        {expanded ? 'Ver menos' : 'Ver todos'}
                    </button>
                    <button
                        onClick={() => setVisible(false)}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        title="Fechar"
                    >
                        <CloseIcon />
                    </button>
                </div>
            </div>

            {!expanded ? (
                /* Compact carousel */
                <div className="relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
                    {/* Accent stripe */}
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-400 to-orange-500" />

                    <div className="pl-5 pr-4 py-4 flex items-center gap-4">
                        {/* Icon */}
                        <div className="text-2xl flex-shrink-0 w-10 h-10 flex items-center justify-center bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-100 dark:border-slate-600">
                            {current.icon}
                        </div>

                        {/* Content */}
                        <div className="flex-grow min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${current.tagColor}`}>
                                    {current.tag}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{current.date}</span>
                            </div>
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight mb-1">
                                {current.title}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                                {current.description}
                            </p>
                        </div>

                        {/* Navigation */}
                        <div className="flex flex-col items-center gap-2 flex-shrink-0">
                            <button onClick={prev} className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-sky-100 dark:hover:bg-sky-900/30 hover:text-sky-600 transition-colors">
                                <ChevronLeftIcon />
                            </button>
                            <span className="text-[10px] font-mono text-slate-400">{activeIndex + 1}/{NEWS_ITEMS.length}</span>
                            <button onClick={next} className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-sky-100 dark:hover:bg-sky-900/30 hover:text-sky-600 transition-colors">
                                <ChevronRightIcon />
                            </button>
                        </div>
                    </div>

                    {/* Dot indicators */}
                    <div className="flex justify-center gap-1.5 pb-3">
                        {NEWS_ITEMS.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setActiveIndex(i)}
                                className={`rounded-full transition-all duration-200 ${
                                    i === activeIndex
                                        ? 'w-4 h-1.5 bg-amber-500'
                                        : 'w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600 hover:bg-slate-400'
                                }`}
                            />
                        ))}
                    </div>
                </div>
            ) : (
                /* Expanded grid view */
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {NEWS_ITEMS.map((item, i) => (
                        <div
                            key={item.id}
                            onClick={() => { setActiveIndex(i); setExpanded(false); }}
                            className="group relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-sky-300 dark:hover:border-sky-700 transition-all cursor-pointer"
                        >
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-400 to-orange-500 rounded-l-xl" />
                            <div className="pl-3">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${item.tagColor}`}>
                                            {item.tag}
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-400">{item.date}</span>
                                    </div>
                                    <span className="text-lg flex-shrink-0">{item.icon}</span>
                                </div>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1 group-hover:text-sky-700 dark:group-hover:text-sky-400 transition-colors">
                                    {item.title}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-3">
                                    {item.description}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ReformaTributariaNewsBanner;
