/**
 * components/AnaliseCredito/CsvDisplay.tsx
 *
 * Painel de resultado quando `modo === 'csv'`: totais, distribuição
 * por categoria, filtros, exportação e tabela de lançamentos.
 * Extraído de AnaliseCreditoExtrato.tsx.
 */
import React from 'react';
import {
    CATEGORIAS_CREDITO,
    type LancamentoExtrato,
    type TipoDespesaCredito,
} from '../../services/analiseCreditoExtratoService';
import { BadgeConfianca, CardTotal, brl } from './_shared';

type Filtro = 'todos' | 'com_credito' | 'sem_credito' | 'revisar';

interface Props {
    lancamentos: LancamentoExtrato[];
    lancamentosFiltrados: LancamentoExtrato[];
    totais: Record<string, number>;
    baseCreditos: number;
    creditoPis: number;
    creditoCofins: number;
    creditoTotal: number;
    filtro: Filtro;
    setFiltro: (f: Filtro) => void;
    exportarRelatorio: () => void;
    exportarPDF: () => void;
    exportandoPDF: boolean;
    ajustarCategoria: (idx: number, cat: TipoDespesaCredito | '') => void;
}

const INP_CLASS = "w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400";

const CsvDisplay: React.FC<Props> = ({
    lancamentos, lancamentosFiltrados, totais,
    baseCreditos, creditoPis, creditoCofins, creditoTotal,
    filtro, setFiltro,
    exportarRelatorio, exportarPDF, exportandoPDF,
    ajustarCategoria,
}) => (
    <>
        {/* ─── Totais ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CardTotal label="Base de Crédito" valor={baseCreditos}  cor="bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-100" qtde={lancamentos.filter(l=>l.categoriaSugerida).length} />
            <CardTotal label="Crédito PIS (1,65%)"    valor={creditoPis}    cor="bg-purple-50 dark:bg-purple-900/30 text-purple-800 dark:text-purple-100" />
            <CardTotal label="Crédito COFINS (7,60%)" valor={creditoCofins} cor="bg-orange-50 dark:bg-orange-900/30 text-orange-800 dark:text-orange-100" />
            <CardTotal label="Crédito Total" valor={creditoTotal} cor="bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-100" />
        </div>

        {/* ─── Totais por categoria ───────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-3 text-sm">Distribuição por Categoria</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {CATEGORIAS_CREDITO.filter(c => (totais[c] ?? 0) > 0).map(c => (
                    <div key={c} className="flex justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                        <span className="text-gray-600 dark:text-gray-300">{c}</span>
                        <span className="font-semibold text-gray-800 dark:text-white">R$ {brl(totais[c] ?? 0)}</span>
                    </div>
                ))}
                {(totais.SEM_CREDITO ?? 0) > 0 && (
                    <div className="flex justify-between bg-gray-200 dark:bg-gray-700 rounded-lg px-3 py-2 col-span-2 sm:col-span-4 border-t border-gray-300 dark:border-gray-600">
                        <span className="text-gray-500 dark:text-gray-400 italic">Sem crédito</span>
                        <span className="font-semibold text-gray-600 dark:text-gray-300">R$ {brl(totais.SEM_CREDITO ?? 0)}</span>
                    </div>
                )}
            </div>
        </div>

        {/* ─── Filtros + Exportar ─────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex gap-2 flex-wrap">
                {([
                    { v: 'todos',       l: `Todos (${lancamentos.length})` },
                    { v: 'com_credito', l: `Com crédito (${lancamentos.filter(l=>l.categoriaSugerida).length})` },
                    { v: 'sem_credito', l: `Sem crédito (${lancamentos.filter(l=>!l.categoriaSugerida && l.confianca!=='SEM_MATCH').length})` },
                    { v: 'revisar',     l: `Revisar (${lancamentos.filter(l=>l.confianca==='SEM_MATCH'||l.confianca==='BAIXA').length})` },
                ] as const).map(b => (
                    <button key={b.v} onClick={() => setFiltro(b.v)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium ${filtro===b.v?'bg-teal-600 text-white':'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'}`}>
                        {b.l}
                    </button>
                ))}
            </div>
            <div className="flex gap-2">
                <button onClick={exportarRelatorio}
                    className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm">
                    📥 Exportar .xlsx
                </button>
                <button onClick={exportarPDF} disabled={exportandoPDF}
                    className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-60">
                    {exportandoPDF ? 'Gerando...' : '📄 Exportar PDF'}
                </button>
            </div>
        </div>

        {/* ─── Tabela ─────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 uppercase">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Data</th>
                            <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                            <th className="px-3 py-2 text-left font-medium">Descrição</th>
                            <th className="px-3 py-2 text-right font-medium">Valor</th>
                            <th className="px-3 py-2 text-left font-medium">Categoria</th>
                            <th className="px-3 py-2 text-left font-medium">Confiança</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {lancamentosFiltrados.map((l) => {
                            const idxReal = lancamentos.indexOf(l);
                            return (
                                <tr key={idxReal} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{l.data}</td>
                                    <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium">{l.favorecido}</td>
                                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-xs truncate" title={l.descricao}>{l.descricao}</td>
                                    <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200 whitespace-nowrap">R$ {brl(l.valor)}</td>
                                    <td className="px-3 py-2">
                                        <select
                                            value={l.categoriaSugerida ?? ''}
                                            onChange={e => ajustarCategoria(idxReal, e.target.value as TipoDespesaCredito | '')}
                                            className={INP_CLASS}
                                        >
                                            <option value="">— Sem crédito —</option>
                                            {CATEGORIAS_CREDITO.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex flex-col gap-0.5">
                                            <BadgeConfianca c={l.confianca} />
                                            <span className="text-[10px] text-gray-400 italic" title={l.motivo}>{l.motivo.length > 30 ? l.motivo.slice(0, 28) + '…' : l.motivo}</span>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {lancamentosFiltrados.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-400">Nenhum lançamento neste filtro.</div>
            )}
        </div>
    </>
);

export default CsvDisplay;
