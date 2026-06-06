/**
 * EmpresaFilterCombobox — autocomplete pra filtrar XMLs por empresa.
 *
 * Substitui o <select> nativo do HTML (que não permite digitar pra buscar)
 * por um input com lista filtrada. Aceita digitação por NOME (token-match
 * em prefixo, igual o filtro da Central de Documentos) OU por CNPJ
 * (substring numérica — funciona em CNPJ raw ou formatado).
 *
 * Cuidado com performance: 113 empresas hoje, vai crescer. A lista filtrada
 * é memoizada e fechada quando perde foco (com delay pra clique funcionar).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatCnpjCpf } from '../../services/xmlParserService';

export interface OpcaoEmpresa {
    cnpj: string;
    nome: string;
}

interface Props {
    opcoes: OpcaoEmpresa[];
    valor?: string;
    onChange: (cnpj: string | undefined) => void;
    className?: string;
}

const EmpresaFilterCombobox: React.FC<Props> = ({ opcoes, valor, onChange, className = '' }) => {
    const [buscaInterna, setBuscaInterna] = useState('');
    const [aberto, setAberto] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const listaRef = useRef<HTMLUListElement>(null);

    // Quando o valor selecionado muda externamente, sincroniza o texto exibido.
    const empresaSelecionada = useMemo(
        () => opcoes.find(o => o.cnpj === valor),
        [opcoes, valor],
    );
    useEffect(() => {
        if (empresaSelecionada && !aberto) {
            // Quando fechado, mostra "nome — cnpj formatado"
            setBuscaInterna(`${empresaSelecionada.nome} — ${formatCnpjCpf(empresaSelecionada.cnpj)}`);
        } else if (!empresaSelecionada && !aberto) {
            setBuscaInterna('');
        }
    }, [empresaSelecionada, aberto]);

    // Filtra opções enquanto digita. Numérico → substring no CNPJ; textual →
    // prefixo de algum token do nome (igual filtro principal).
    const opcoesFiltradas = useMemo(() => {
        const q = buscaInterna.trim().toLowerCase();
        if (!q) return opcoes;
        const qDigits = q.replace(/\D/g, '');
        const isNum = qDigits.length === q.replace(/[\s.\-/]/g, '').length && qDigits.length > 0;

        return opcoes.filter(o => {
            if (isNum && qDigits) {
                // Match por CNPJ — substring numérica
                return o.cnpj.includes(qDigits);
            }
            // Match textual em tokens do nome (prefixo)
            const tokens = o.nome.toLowerCase().split(/\s+/).map(t => t.replace(/[^a-z0-9]/g, ''));
            return tokens.some(t => t.startsWith(q.replace(/[^a-z0-9]/g, '')));
        });
    }, [opcoes, buscaInterna]);

    // Fecha quando clica fora.
    useEffect(() => {
        const onClickFora = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setAberto(false);
            }
        };
        document.addEventListener('mousedown', onClickFora);
        return () => document.removeEventListener('mousedown', onClickFora);
    }, []);

    const selecionar = (cnpj: string | undefined) => {
        onChange(cnpj);
        setAberto(false);
        setHighlight(0);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAberto(true);
            setHighlight(h => Math.min(h + 1, opcoesFiltradas.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight(h => Math.max(h - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (opcoesFiltradas[highlight]) {
                selecionar(opcoesFiltradas[highlight].cnpj);
            }
        } else if (e.key === 'Escape') {
            setAberto(false);
        }
    };

    // Scroll automático pro item highlightado
    useEffect(() => {
        if (!aberto || !listaRef.current) return;
        const item = listaRef.current.children[highlight] as HTMLElement | undefined;
        if (item && typeof item.scrollIntoView === 'function') {
            item.scrollIntoView({ block: 'nearest' });
        }
    }, [highlight, aberto]);

    return (
        <div ref={wrapperRef} className={`relative ${className}`}>
            <input
                type="text"
                placeholder={`Empresa (${opcoes.length}) — digite p/ buscar`}
                className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                value={buscaInterna}
                onChange={e => {
                    setBuscaInterna(e.target.value);
                    setAberto(true);
                    setHighlight(0);
                }}
                onFocus={() => {
                    setAberto(true);
                    // Limpa pra deixar fácil digitar nova busca
                    if (empresaSelecionada) setBuscaInterna('');
                }}
                onKeyDown={onKeyDown}
            />
            {valor && (
                <button
                    type="button"
                    onClick={() => { selecionar(undefined); setBuscaInterna(''); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs"
                    title="Limpar filtro"
                >
                    ×
                </button>
            )}

            {aberto && (
                <ul
                    ref={listaRef}
                    className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg text-xs"
                >
                    {opcoesFiltradas.length === 0 && (
                        <li className="px-3 py-2 text-slate-400">Nenhuma empresa encontrada.</li>
                    )}
                    {opcoesFiltradas.slice(0, 200).map((o, i) => (
                        <li
                            key={o.cnpj}
                            onMouseDown={() => selecionar(o.cnpj)}
                            onMouseEnter={() => setHighlight(i)}
                            className={`px-3 py-1.5 cursor-pointer ${
                                i === highlight
                                    ? 'bg-blue-100 dark:bg-blue-900/40'
                                    : 'hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                        >
                            <div className="font-medium text-slate-700 dark:text-slate-200">
                                {o.nome}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                {formatCnpjCpf(o.cnpj)}
                            </div>
                        </li>
                    ))}
                    {opcoesFiltradas.length > 200 && (
                        <li className="px-3 py-2 text-slate-400 text-center">
                            +{opcoesFiltradas.length - 200} resultados. Refine a busca.
                        </li>
                    )}
                </ul>
            )}
        </div>
    );
};

export default EmpresaFilterCombobox;
