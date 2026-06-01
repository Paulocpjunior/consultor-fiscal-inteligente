/**
 * components/AnaliseRetencoesNfseSP.tsx
 *
 * Modo "Retenções NFSe SP" do componente Análise de Créditos.
 * Upload do CSV (formato exportado pela captura nfse-sp-portal) e
 * análise de retenções tributárias por nota:
 *   ISS / INSS / PIS / COFINS / CSLL / IRRF
 *
 * Função pura de análise mora em services/retencoesNfseAnalyzer.ts.
 */
import React, { useState, useMemo } from 'react';
import {
    parseCsvNfseSp,
    analisarRetencoes,
    resumirRetencoes,
    type LinhaNfseCsv,
    type AnaliseRetencoes,
} from '../services/retencoesNfseAnalyzer';

type LinhaAnalisada = LinhaNfseCsv & { analise: AnaliseRetencoes };

const TRIBUTOS = ['iss', 'inss', 'pis', 'cofins', 'csll', 'irrf'] as const;
const LABEL_TRIBUTO: Record<typeof TRIBUTOS[number], string> = {
    iss: 'ISS', inss: 'INSS', pis: 'PIS', cofins: 'COFINS', csll: 'CSLL', irrf: 'IRRF',
};
const COR_TRIBUTO: Record<typeof TRIBUTOS[number], string> = {
    iss: 'bg-blue-100 text-blue-800 border-blue-300',
    inss: 'bg-purple-100 text-purple-800 border-purple-300',
    pis: 'bg-teal-100 text-teal-800 border-teal-300',
    cofins: 'bg-cyan-100 text-cyan-800 border-cyan-300',
    csll: 'bg-amber-100 text-amber-800 border-amber-300',
    irrf: 'bg-rose-100 text-rose-800 border-rose-300',
};

const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const AnaliseRetencoesNfseSP: React.FC = () => {
    const [linhas, setLinhas] = useState<LinhaAnalisada[]>([]);
    const [filtro, setFiltro] = useState<'todas' | 'comRetencao' | 'semRetencao'>('comRetencao');
    const [erro, setErro] = useState<string | null>(null);
    const [nomeArquivo, setNomeArquivo] = useState<string>('');

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setErro(null);
        setNomeArquivo(file.name);
        try {
            const txt = await file.text();
            const parsed = parseCsvNfseSp(txt);
            if (parsed.length === 0) {
                setErro('Nenhuma nota encontrada. Verifique se é o CSV exportado pela captura NFSe SP.');
                setLinhas([]);
                return;
            }
            setLinhas(parsed.map(l => ({ ...l, analise: analisarRetencoes(l) })));
        } catch (err: any) {
            setErro(`Falha ao processar CSV: ${err?.message || err}`);
            setLinhas([]);
        }
    };

    const resumo = useMemo(() => resumirRetencoes(linhas.map(l => l.analise)), [linhas]);

    const linhasFiltradas = useMemo(() => {
        if (filtro === 'todas') return linhas;
        if (filtro === 'comRetencao') return linhas.filter(l => l.analise.temAlgumaRetencao);
        return linhas.filter(l => !l.analise.temAlgumaRetencao);
    }, [linhas, filtro]);

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">
                    📑 Análise de Retenções — CSV NFSe SP
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Importe o CSV exportado pela captura NFSe SP. O sistema identifica retenções de ISS, INSS, PIS,
                    COFINS, CSLL e IRRF por nota — ISS vem da coluna própria; demais tributos são extraídos da
                    discriminação com filtros pra ignorar tributos aproximados (IBPT/Lei 12741) e declarações de
                    não-retenção.
                </p>
                <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleUpload}
                    className="block text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
                />
                {nomeArquivo && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Arquivo: {nomeArquivo}</p>
                )}
                {erro && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{erro}</div>
                )}
            </div>

            {linhas.length > 0 && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                            <div className="text-xs text-gray-500">Total notas</div>
                            <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{resumo.totalNotas}</div>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                            <div className="text-xs text-gray-500">Com retenção</div>
                            <div className="text-xl font-bold text-emerald-700">{resumo.notasComRetencao}</div>
                        </div>
                        {TRIBUTOS.map(t => (
                            <div key={t} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                                <div className="text-xs text-gray-500">{LABEL_TRIBUTO[t]}</div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                    {resumo.porTributo[t].qtd}
                                </div>
                                <div className="text-[10px] text-gray-500">{formatBRL(resumo.porTributo[t].valor)}</div>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm text-gray-600 dark:text-gray-300">Filtro:</span>
                        {(['comRetencao', 'semRetencao', 'todas'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFiltro(f)}
                                className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                                    filtro === f
                                        ? 'bg-teal-600 text-white'
                                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'
                                }`}
                            >
                                {f === 'comRetencao' && `Com retenção (${resumo.notasComRetencao})`}
                                {f === 'semRetencao' && `Sem retenção (${resumo.totalNotas - resumo.notasComRetencao})`}
                                {f === 'todas' && `Todas (${resumo.totalNotas})`}
                            </button>
                        ))}
                        <span className="ml-auto text-sm font-semibold text-gray-700 dark:text-gray-200">
                            Total retido: {formatBRL(resumo.totalRetido)}
                        </span>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                    <tr>
                                        <th className="px-2 py-2 text-left font-medium">Direção</th>
                                        <th className="px-2 py-2 text-left font-medium">Nº</th>
                                        <th className="px-2 py-2 text-left font-medium">Data</th>
                                        <th className="px-2 py-2 text-left font-medium">Contraparte</th>
                                        <th className="px-2 py-2 text-right font-medium">Valor Serv.</th>
                                        <th className="px-2 py-2 text-left font-medium">Retenções</th>
                                        <th className="px-2 py-2 text-right font-medium">Total Retido</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                    {linhasFiltradas.map((l, i) => {
                                        const contraparte = l.direcao === 'Emitida' ? l.tomadorNome : l.prestadorNome;
                                        return (
                                            <tr key={`${l.numero}-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                <td className="px-2 py-2">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                                        l.direcao === 'Emitida'
                                                            ? 'bg-green-100 text-green-700'
                                                            : 'bg-orange-100 text-orange-700'
                                                    }`}>{l.direcao}</span>
                                                </td>
                                                <td className="px-2 py-2 font-mono">{l.numero}</td>
                                                <td className="px-2 py-2">{l.data}</td>
                                                <td className="px-2 py-2 truncate max-w-[260px]" title={contraparte}>{contraparte}</td>
                                                <td className="px-2 py-2 text-right font-mono">{formatBRL(l.valorServicos)}</td>
                                                <td className="px-2 py-2">
                                                    {l.analise.temAlgumaRetencao ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {TRIBUTOS.filter(t => l.analise[t].retido).map(t => (
                                                                <span
                                                                    key={t}
                                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${COR_TRIBUTO[t]}`}
                                                                    title={l.analise[t].trechoEvidencia}
                                                                >
                                                                    {LABEL_TRIBUTO[t]} {formatBRL(l.analise[t].valor)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400 text-[10px]">—</span>
                                                    )}
                                                </td>
                                                <td className="px-2 py-2 text-right font-mono font-semibold">
                                                    {l.analise.totalRetido > 0 ? formatBRL(l.analise.totalRetido) : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {linhasFiltradas.length === 0 && (
                            <div className="p-4 text-center text-sm text-gray-500">
                                Nenhuma nota corresponde ao filtro.
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default AnaliseRetencoesNfseSP;
