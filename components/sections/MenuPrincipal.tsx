/**
 * components/sections/MenuPrincipal.tsx
 *
 * Renderiza o menu de cards agrupado por gênero (Consultas, Regimes,
 * Documentos Fiscais, Vencimentos, etc). Cada grupo tem cor própria e
 * titulo. Cards adminOnly aparecem pra admin ou pra colaborador com o
 * módulo liberado individualmente (modulosPermitidos do perfil).
 *
 * Extraido do App.tsx (renderia inline, ~40 linhas com 2 maps aninhados).
 * Layout: 2/3/4/6 colunas conforme breakpoint, card compacto horizontal
 * (icone + label).
 */
import React from 'react';
import { MENU_GRUPOS, searchDescriptions, podeAcessarCard } from '../../config/menuConfig';
import { SearchType, type User } from '../../types';

interface Props {
    currentUser: User;
    searchType: SearchType;
    onSelecionar: (type: SearchType) => void;
}

const MenuPrincipal: React.FC<Props> = ({ currentUser, searchType, onSelecionar }) => (
    <div className="space-y-2 mb-3">
        {MENU_GRUPOS.map((grupo) => {
            const cards = grupo.cards.filter(c => podeAcessarCard(currentUser, c));
            if (cards.length === 0) return null;
            return (
                <div key={grupo.titulo}>
                    <div className="flex items-center gap-1.5 mb-1">
                        <span className="inline-block h-3 w-1 rounded" style={{ background: grupo.cor }} />
                        <h3 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{grupo.titulo}</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5">
                        {cards.map(({ type, label, Icon }) => {
                            const ativo = searchType === type;
                            return (
                                <button
                                    key={type}
                                    onClick={() => onSelecionar(type)}
                                    title={searchDescriptions[type] || (label ?? type)}
                                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150"
                                    style={{
                                        background: ativo ? grupo.cor : 'var(--bg-elevated)',
                                        border: `1px solid ${ativo ? grupo.cor : 'var(--border-default)'}`,
                                        color: ativo ? '#fff' : 'var(--text-secondary)',
                                    }}
                                >
                                    <span className="flex-shrink-0" style={{ color: ativo ? '#fff' : grupo.cor }}>
                                        <Icon className="w-4 h-4" />
                                    </span>
                                    <span className="text-[11px] font-semibold text-left leading-tight line-clamp-2">
                                        {label ?? type}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            );
        })}
    </div>
);

export default MenuPrincipal;
