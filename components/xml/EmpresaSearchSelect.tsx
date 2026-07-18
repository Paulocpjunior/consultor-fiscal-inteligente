import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EmpresaXmlOption } from '../../services/xmlFiscalService';
import { formatCnpjCpf } from '../../services/xmlParserService';

interface Props {
    empresas: EmpresaXmlOption[];
    value: string;                       // empresaId selecionado
    onChange: (id: string) => void;
    placeholder?: string;
    disabled?: boolean;
    maxResultados?: number;
}

/**
 * EmpresaSearchSelect — combobox com busca por NOME ou CNPJ.
 * Substitui o <select> gigante (centenas de empresas) por um campo pesquisável:
 * digite parte do nome ou dígitos do CNPJ e clique para selecionar.
 */
const EmpresaSearchSelect: React.FC<Props> = ({
    empresas, value, onChange, placeholder = 'Buscar por nome ou CNPJ…', disabled, maxResultados = 60,
}) => {
    const [aberto, setAberto] = useState(false);
    const [busca, setBusca] = useState('');
    const wrapRef = useRef<HTMLDivElement>(null);

    const selecionada = empresas.find(e => e.id === value) || null;

    // Fecha ao clicar fora.
    useEffect(() => {
        const onDoc = (ev: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
                setAberto(false);
                setBusca('');
            }
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    const filtradas = useMemo(() => {
        const termo = busca.trim().toLowerCase();
        const digitos = termo.replace(/\D/g, '');
        let lista = empresas;
        if (termo) {
            lista = empresas.filter(e => {
                const nomeOk = (e.nome || '').toLowerCase().includes(termo);
                const cnpjOk = digitos.length > 0 && (e.cnpj || '').replace(/\D/g, '').includes(digitos);
                return nomeOk || cnpjOk;
            });
        }
        return lista.slice(0, maxResultados);
    }, [empresas, busca, maxResultados]);

    const rotulo = selecionada
        ? `${selecionada.nome} — ${formatCnpjCpf(selecionada.cnpj)}`
        : '';

    return (
        <div ref={wrapRef} className="relative">
            <input
                type="text"
                disabled={disabled}
                value={aberto ? busca : rotulo}
                placeholder={selecionada ? rotulo : placeholder}
                onFocus={() => { setAberto(true); setBusca(''); }}
                onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
                className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 disabled:opacity-50"
            />
            {aberto && (
                <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg">
                    {filtradas.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-400">Nenhuma empresa encontrada.</div>
                    ) : (
                        <>
                            {filtradas.map(e => (
                                <button
                                    key={e.id}
                                    type="button"
                                    onClick={() => { onChange(e.id); setAberto(false); setBusca(''); }}
                                    className={`w-full text-left px-3 py-2 text-sm border-b border-slate-100 dark:border-slate-700/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 ${
                                        e.id === value ? 'bg-emerald-50/60 dark:bg-emerald-900/30 font-semibold' : ''
                                    }`}
                                >
                                    <span className="text-slate-800 dark:text-slate-100">{e.nome}</span>
                                    <span className="block text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                        {formatCnpjCpf(e.cnpj)} · {e.fonte === 'simples' ? 'Simples' : 'Lucro'}
                                    </span>
                                </button>
                            ))}
                            {empresas.length > filtradas.length && (
                                <div className="px-3 py-1.5 text-[11px] text-slate-400 bg-slate-50 dark:bg-slate-900/40">
                                    Mostrando {filtradas.length} de {empresas.length}. Refine a busca para ver mais.
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default EmpresaSearchSelect;
