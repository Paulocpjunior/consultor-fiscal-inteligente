


import React, { useState } from 'react';
import { FavoriteItem, HistoryItem, SearchType } from '../types';
import { CloseIcon, HistoryIcon, StarIcon, TrashIcon, ChevronDownIcon } from './Icons';

type SidebarTab = 'favorites' | 'history';

interface FavoritesSidebarProps {
    favorites: FavoriteItem[];
    onFavoriteRemove: (favorites: FavoriteItem[]) => void;
    onFavoriteSelect: (item: FavoriteItem) => void;
    history: HistoryItem[];
    onHistorySelect: (item: HistoryItem) => void;
    onHistoryRemove: (id: string) => void;
    onHistoryClear: () => void;
    isOpen: boolean;
    onClose: () => void;
}

const formatTimestamp = (timestamp: number) => {
    const now = new Date();
    const date = new Date(timestamp);
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 3600 * 24));

    if (diffDays === 0) return 'Hoje';
    if (diffDays === 1) return 'Ontem';
    return date.toLocaleDateString('pt-BR');
};

const TypeBadge: React.FC<{ type: SearchType, mini?: boolean }> = ({ type, mini }) => {
    const typeClasses: Record<string, string> = {
        [SearchType.CFOP]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        [SearchType.NCM]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        [SearchType.SERVICO]: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
        [SearchType.REFORMA_TRIBUTARIA]: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
    };
    return (
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${typeClasses[type] || ''} ${mini ? 'w-2 h-2 p-0 rounded-full' : ''}`}>
            {mini ? '' : type}
        </span>
    );
};

const FavoritesSidebar: React.FC<FavoritesSidebarProps> = ({ 
    favorites, onFavoriteRemove, onFavoriteSelect, 
    history, onHistorySelect, onHistoryRemove, onHistoryClear,
    isOpen, onClose
}) => {
    const [activeTab, setActiveTab] = useState<SidebarTab>('favorites');
    const [isCollapsed, setIsCollapsed] = useState(false);

    const handleRemoveFavorite = (itemToRemove: FavoriteItem) => {
        onFavoriteRemove(favorites.filter(item => !(item.code === itemToRemove.code && item.type === itemToRemove.type)));
    };

    const favoritesByType = (type: SearchType) => favorites.filter(fav => fav.type === type);

    const FavoriteSection: React.FC<{type: SearchType, title: string}> = ({ type, title }) => {
        const items = favoritesByType(type);
        if (items.length === 0) return null;

        if (isCollapsed) {
             return (
                <div className="flex flex-col gap-2 items-center">
                    {items.map(item => (
                         <button 
                            key={`${item.type}-${item.code}`}
                            onClick={() => onFavoriteSelect(item)} 
                            className="p-2 rounded-md hover:bg-sky-100 dark:hover:bg-slate-700 w-full flex justify-center"
                            title={`${title}: ${item.code} - ${item.description}`}
                        >
                            <span className="text-xs font-bold text-sky-700 dark:text-sky-400 truncate max-w-[3ch]">{item.code.slice(0,2)}</span>
                        </button>
                    ))}
                </div>
             )
        }

        return (
            <div>
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">{title}</h3>
                <ul className="space-y-1">
                    {items.map(item => (
                        <li key={`${item.type}-${item.code}`} className="group flex items-center justify-between p-2 rounded-md hover:bg-sky-100 dark:hover:bg-slate-700">
                            <button onClick={() => onFavoriteSelect(item)} className="text-left flex-grow min-w-0">
                                <p className="font-semibold text-slate-700 dark:text-slate-200 truncate">{item.code}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.description}</p>
                            </button>
                            <button 
                                onClick={() => handleRemoveFavorite(item)} 
                                className="btn-press ml-2 p-1 text-slate-400 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Remover favorito"
                            >
                                <TrashIcon className="w-4 h-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        )
    }
    
    const renderContent = () => {
        if (activeTab === 'favorites') {
            if (favorites.length === 0) {
                return isCollapsed ? null : (
                    <div className="text-center py-8">
                        <p className="text-slate-500 dark:text-slate-400 text-sm">Sem favoritos.</p>
                    </div>
                );
            }
            return (
                <div className="space-y-6">
                    <FavoriteSection type={SearchType.CFOP} title="CFOPs" />
                    <FavoriteSection type={SearchType.NCM} title="NCMs" />
                    <FavoriteSection type={SearchType.SERVICO} title="Serviços" />
                    <FavoriteSection type={SearchType.REFORMA_TRIBUTARIA} title="Reforma Tributária" />
                </div>
            );
        }

        if (activeTab === 'history') {
            if (history.length === 0) {
                return isCollapsed ? null : (
                     <div className="text-center py-8">
                        <p className="text-slate-500 dark:text-slate-400 text-sm">Sem histórico.</p>
                    </div>
                );
            }

            if (isCollapsed) {
                 return (
                    <div className="flex flex-col gap-2 items-center">
                        {history.slice(0, 10).map(item => (
                             <button 
                                key={item.id}
                                onClick={() => onHistorySelect(item)} 
                                className="p-2 rounded-md hover:bg-sky-100 dark:hover:bg-slate-700 w-full flex justify-center"
                                title={`${item.queries.join(' vs ')}`}
                            >
                                <div className="w-2 h-2 rounded-full bg-sky-500"></div>
                            </button>
                        ))}
                    </div>
                 )
            }

            return (
                <div>
                    <div className="flex justify-between items-center mb-2">
                         <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                            Minhas Consultas
                         </span>
                         <button onClick={onHistoryClear} className="text-xs text-sky-600 dark:text-sky-400 hover:underline">
                            Limpar
                        </button>
                    </div>
                    <ul className="space-y-1">
                        {history.map(item => (
                            <li key={item.id} className="group flex items-center justify-between p-2 rounded-md hover:bg-sky-100 dark:hover:bg-slate-700">
                                <button onClick={() => onHistorySelect(item)} className="text-left flex-grow min-w-0">
                                    <div className="flex items-center justify-between">
                                        <p className="font-semibold text-slate-700 dark:text-slate-200 truncate pr-2 max-w-[140px]">
                                            {item.queries.join(' vs ')}
                                        </p>
                                        <TypeBadge type={item.type} mini />
                                    </div>
                                    {item.resultSnippet && (
                                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                            {item.resultSnippet}
                                        </p>
                                    )}
                                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{formatTimestamp(item.timestamp)}</p>
                                </button>
                                <button 
                                    onClick={() => onHistoryRemove(item.id)} 
                                    className="btn-press ml-2 p-1 text-slate-400 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Remover do histórico"
                                >
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            );
        }
        return null;
    }

    return (
        <>
            {/* Backdrop for mobile */}
            <div
                className={`fixed inset-0 bg-black/60 dark:bg-black/80 z-20 md:hidden transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
                aria-hidden="true"
            />
            <aside className={`
                transform transition-all ease-in-out duration-300
                ${isCollapsed ? 'w-20' : 'w-80'} 
                flex-shrink-0 bg-white dark:bg-slate-800 rounded-xl p-4
                
                fixed right-0 top-0 h-full z-30 
                md:relative md:h-auto md:z-auto md:transform-none md:shadow-md
                
                ${isOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
            `}>
                <div className={`flex ${isCollapsed ? 'flex-col gap-4' : 'justify-between'} items-center mb-4 border-b border-slate-200 dark:border-slate-700 pb-2`}>
                    {/* Desktop Collapse Toggle */}
                    <button 
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="hidden md:flex p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        title={isCollapsed ? "Expandir Sidebar" : "Minimizar Sidebar"}
                    >
                         <ChevronDownIcon className={`w-5 h-5 transform transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-90'}`} />
                    </button>

                    <div className={`flex ${isCollapsed ? 'flex-col gap-4 items-center' : ''}`}>
                        <button 
                            onClick={() => setActiveTab('favorites')}
                            title="Favoritos"
                            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors rounded-lg ${activeTab === 'favorites' ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400 hover:text-sky-600'}`}>
                            <StarIcon className="w-5 h-5" /> 
                            {!isCollapsed && <span>Favoritos</span>}
                        </button>
                        <button 
                            onClick={() => setActiveTab('history')}
                            title="Histórico"
                            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors rounded-lg ${activeTab === 'history' ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400 hover:text-sky-600'}`}>
                            <HistoryIcon className="w-5 h-5" /> 
                            {!isCollapsed && <span>Histórico</span>}
                        </button>
                    </div>
                    
                    {!isCollapsed && (
                        <button onClick={onClose} className="p-1 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 md:hidden">
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    )}
                </div>
                
                <div className="overflow-y-auto max-h-[calc(100vh-80px)] md:max-h-[70vh] pr-1 scrollbar-thin">
                    {renderContent()}
                </div>
            </aside>
        </>
    );
};

export default FavoritesSidebar;
