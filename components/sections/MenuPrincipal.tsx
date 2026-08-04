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
import { MENU_GRUPOS, MENU_LINKS, searchDescriptions, podeAcessarCard } from '../../config/menuConfig';
import { SearchType, type User } from '../../types';
import {
    NOVIDADES_VERSAO, marcarNovidadesComoLidas, temNovidadeNaoLida, versaoVistaLocal,
} from '../../services/novidadesService';

interface Props {
    currentUser: User;
    searchType: SearchType;
    onSelecionar: (type: SearchType) => void;
}

const MenuPrincipal: React.FC<Props> = ({ currentUser, searchType, onSelecionar }) => {
  // Selo de comunicado não lido — igual ao do cabeçalho, mesma fonte.
  const [novoAviso, setNovoAviso] = React.useState(false);
  React.useEffect(() => {
      setNovoAviso(temNovidadeNaoLida(NOVIDADES_VERSAO, versaoVistaLocal()));
  }, []);

  return (
    <div className="space-y-2 mb-3">
        {MENU_GRUPOS.map((grupo) => {
            const cards = grupo.cards.filter(c => podeAcessarCard(currentUser, c));
            const links = MENU_LINKS.filter(l => l.grupo === grupo.titulo);
            if (cards.length === 0 && links.length === 0) return null;
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

                        {links.map((link) => (
                            <a
                                key={link.id}
                                href={link.href}
                                target="_blank"
                                rel="noopener"
                                onClick={() => { marcarNovidadesComoLidas(); setNovoAviso(false); }}
                                title={link.titulo}
                                className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150"
                                style={{
                                    background: novoAviso ? grupo.cor : 'var(--bg-elevated)',
                                    border: `1px solid ${novoAviso ? grupo.cor : 'var(--border-default)'}`,
                                    color: novoAviso ? '#fff' : 'var(--text-secondary)',
                                }}
                            >
                                <span className="flex-shrink-0 text-base leading-none" aria-hidden="true">{link.emoji}</span>
                                <span className="text-[11px] font-semibold text-left leading-tight line-clamp-2">
                                    {link.label}
                                </span>
                                {novoAviso && (
                                    <span
                                        className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full"
                                        style={{ background: 'var(--danger)' }}
                                        title="Tem comunicado novo que você ainda não abriu"
                                    />
                                )}
                            </a>
                        ))}
                    </div>
                </div>
            );
        })}
    </div>
  );
};

export default MenuPrincipal;
