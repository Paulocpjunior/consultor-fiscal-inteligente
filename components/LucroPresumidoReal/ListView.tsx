/**
 * components/LucroPresumidoReal/ListView.tsx
 *
 * View "list" do LucroPresumidoRealDashboard - lista empresas LP/LR
 * cadastradas com botoes Abrir + Excluir (admin).
 * Extraido de LucroPresumidoRealDashboard.tsx - issue #100.
 *
 * Busca por nome/CNPJ: mesmo comportamento do painel Simples Nacional
 * (SimplesNacionalDashboard) — o dept. contabil localiza a empresa no
 * fechamento trimestral sem rolar a lista inteira.
 */
import React, { useMemo, useState } from 'react';
import type { LucroPresumidoEmpresa, User } from '../../types';
import { PlusIcon, TrashIcon } from '../Icons';
import LoteDareModal from './LoteDareModal';

// CNPJ SEMPRE formatado na exibição — a base tem registros mistos
// ('05049535000170' e '05.049.535/0001-70'), o que escondia duplicatas do
// olho humano (caso WALDESA 24/07: mesma empresa 2x em formatos diferentes).
const fmtCnpj = (c?: string): string => {
    const d = String(c || '').replace(/\D/g, '');
    return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (c || '—');
};

export interface ListViewProps {
    empresas: LucroPresumidoEmpresa[];
    currentUser: User | null;
    onNovaEmpresa: () => void;
    onAbrir: (empresaId: string) => void;
    onExcluir: (empresaId: string) => void;
}

const ListView: React.FC<ListViewProps> = ({ empresas, currentUser, onNovaEmpresa, onAbrir, onExcluir }) => {
    const [busca, setBusca] = useState('');
    const [loteDareAberto, setLoteDareAberto] = useState(false);
    const empresasFiltradas = useMemo(() => {
        const termo = busca.trim().toLowerCase();
        if (!termo) return empresas;
        const termoCnpj = termo.replace(/\D/g, '');
        return empresas.filter(e => {
            const nome = (e.nome || '').toLowerCase();
            const cnpj = (e.cnpj || '').replace(/\D/g, '');
            return nome.includes(termo) || (termoCnpj !== '' && cnpj.includes(termoCnpj));
        });
    }, [empresas, busca]);

    // Duplicatas por CNPJ NORMALIZADO: mesma empresa cadastrada 2+ vezes (em
    // formatos diferentes o olho não pega). Badge vermelho pro admin limpar
    // (🗑️ aqui, ou Arquivar no Status por Empresa) — duplicata divide fichas
    // entre dois cadastros e gera erro de colaborador.
    const cnpjsDuplicados = useMemo(() => {
        const contagem = new Map<string, number>();
        for (const e of empresas) {
            const d = String(e.cnpj || '').replace(/\D/g, '');
            if (d.length === 14) contagem.set(d, (contagem.get(d) || 0) + 1);
        }
        return new Set([...contagem.entries()].filter(([, n]) => n > 1).map(([c]) => c));
    }, [empresas]);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Lucro Presumido e Real</h2>
                    <p className="mt-1 text-slate-500 dark:text-slate-400">Gestão de fichas financeiras e cálculo de impostos.</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setLoteDareAberto(true)}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-600 transition-colors"
                        title="Gera o TXT do 'Dare em Lote' com o ICMS informado nas fichas do mês — cola no portal e baixa o ZIP com todos os DAREs"
                    >
                        🧾 Lote DARE
                    </button>
                    <button
                        onClick={onNovaEmpresa}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-semibold rounded-lg hover:bg-sky-700 transition-colors"
                    >
                        <PlusIcon className="w-5 h-5" /> Nova Empresa
                    </button>
                </div>
            </div>

            {loteDareAberto && <LoteDareModal empresas={empresas} onClose={() => setLoteDareAberto(false)} />}

            {empresas.length > 0 && (
                <div className="relative">
                    <input
                        type="text"
                        value={busca}
                        onChange={(ev) => setBusca(ev.target.value)}
                        placeholder="Buscar empresa por nome ou CNPJ..."
                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                </div>
            )}

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                    <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                        <tr>
                            <th className="px-6 py-3">Empresa</th>
                            <th className="px-6 py-3">CNPJ</th>
                            <th className="px-6 py-3">Regime Padrão</th>
                            <th className="px-6 py-3 text-right">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {empresasFiltradas.map(emp => (
                            <tr key={emp.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                <td className="px-6 py-4 font-bold text-slate-800 dark:text-slate-200">
                                    {emp.nome}
                                    {cnpjsDuplicados.has(String(emp.cnpj || '').replace(/\D/g, '')) && (() => {
                                        // Responde "qual excluir?" com dado: quem tem 0 fichas é o
                                        // cadastro-lixo; quem tem fichas é o verdadeiro. Duas com
                                        // fichas = NÃO excluir nenhuma (precisa mesclagem — admin).
                                        const nFichas = (emp.fichaFinanceira || []).length;
                                        return (
                                            <span
                                                className={`ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded ${
                                                    nFichas === 0
                                                        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                                        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                                }`}
                                                title={nFichas === 0
                                                    ? 'CNPJ duplicado e SEM fichas — este é o cadastro que pode ser excluído (🗑️).'
                                                    : `CNPJ duplicado, mas este cadastro TEM ${nFichas} ficha(s) — é o que deve ser MANTIDO. Exclua o gêmeo sem fichas.`}
                                            >
                                                ⚠ duplicada · {nFichas === 0 ? '0 fichas — excluir este' : `${nFichas} ficha(s) — manter`}
                                            </span>
                                        );
                                    })()}
                                </td>
                                <td className="px-6 py-4 font-mono">{fmtCnpj(emp.cnpj)}</td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${emp.regimePadrao === 'Real' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                        {emp.regimePadrao || 'Presumido'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right flex justify-end gap-2">
                                    <button onClick={() => onAbrir(emp.id)} className="text-sky-600 hover:text-sky-800 font-medium">Abrir</button>
                                    {currentUser?.role === 'admin' && (
                                        <button onClick={() => onExcluir(emp.id)} className="text-red-500 hover:text-red-700" title="Excluir empresa (admin)"><TrashIcon className="w-4 h-4" /></button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {empresasFiltradas.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                                    {empresas.length === 0
                                        ? 'Nenhuma empresa cadastrada.'
                                        : `Nenhuma empresa encontrada para "${busca.trim()}".`}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ListView;
