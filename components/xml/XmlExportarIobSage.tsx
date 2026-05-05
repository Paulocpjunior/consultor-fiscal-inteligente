import React, { useEffect, useMemo, useState } from 'react';
import type { User, DocumentoFiscal } from '../../types';
import { listDocumentos } from '../../services/xmlFiscalService';
import { exportarParaIobSage, downloadBlob } from '../../services/iobSageExportService';
import { formatCurrency } from '../../services/xmlParserService';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

const XmlExportarIobSage: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [docs, setDocs] = useState<DocumentoFiscal[]>([]);
    const [loading, setLoading] = useState(true);
    const [empresaId, setEmpresaId] = useState<string>('');
    const [competencia, setCompetencia] = useState<string>('');
    const [direcao, setDirecao] = useState<'entrada' | 'saida' | ''>('');
    const [numeroEmpresaEfiscal, setNumeroEmpresaEfiscal] = useState<number>(1);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        let alive = true;
        listDocumentos(currentUser).then(d => {
            if (alive) { setDocs(d); setLoading(false); }
        });
        return () => { alive = false; };
    }, [currentUser]);

    const empresas = useMemo(() => {
        const map = new Map<string, { id: string; nome: string; cnpj: string }>();
        docs.forEach(d => {
            if (!map.has(d.empresaId)) {
                map.set(d.empresaId, { id: d.empresaId, nome: d.empresaNome, cnpj: d.empresaCnpj });
            }
        });
        return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
    }, [docs]);

    const competencias = useMemo(() => {
        const set = new Set<string>();
        docs.forEach(d => d.competencia && set.add(d.competencia));
        return Array.from(set).sort().reverse();
    }, [docs]);

    const filtrados = useMemo(() => {
        return docs.filter(d => {
            if (empresaId && d.empresaId !== empresaId) return false;
            if (competencia && d.competencia !== competencia) return false;
            if (direcao && d.direcao !== direcao) return false;
            // Por padrão, não exporta canceladas/denegadas/inutilizadas (situação 2/4/5).
            // O contador pode incluir manualmente removendo o filtro de status no futuro.
            return true;
        });
    }, [docs, empresaId, competencia, direcao]);

    const totalValor = useMemo(
        () => filtrados.reduce((acc, d) => acc + (d.totais?.vNF || 0), 0),
        [filtrados],
    );

    const handleExportar = async () => {
        if (filtrados.length === 0) {
            onShowToast?.('Nenhum documento para exportar com os filtros atuais.');
            return;
        }
        setExporting(true);
        try {
            const result = exportarParaIobSage({
                documentos: filtrados,
                numeroEmpresaEfiscal,
            });
            downloadBlob(result.blob, result.fileName);
            onShowToast?.(
                `Arquivo ${result.fileName} gerado: ${result.estatisticas.documentos} NF, ` +
                `${result.estatisticas.participantes} participantes, ${result.estatisticas.produtos} produtos.`,
            );
        } catch (err: any) {
            onShowToast?.(`Falha ao gerar arquivo: ${err?.message || err}`);
        } finally {
            setExporting(false);
        }
    };

    if (loading) return <p className="text-center text-xs text-slate-400 py-6">Carregando...</p>;

    return (
        <div className="space-y-3">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                    Gera arquivo <strong>.FML</strong> no Layout Folhamatic Fiscal v2.0.06 (largura fixa, Windows-1252, CRLF) para importação no E-Fiscal IOB SAGE.
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                    Inclui registros E001, E010 (clientes/fornecedores), E020 (produtos), E200, E201, E221, E222 e E342 (chave NF-e).
                </p>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Empresa</label>
                        <select
                            value={empresaId}
                            onChange={(e) => setEmpresaId(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="">Todas</option>
                            {empresas.map(e => (
                                <option key={e.id} value={e.id}>{e.nome}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Competência</label>
                        <select
                            value={competencia}
                            onChange={(e) => setCompetencia(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="">Todas</option>
                            {competencias.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Direção</label>
                        <select
                            value={direcao}
                            onChange={(e) => setDirecao(e.target.value as any)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="">Entradas e saídas</option>
                            <option value="entrada">Apenas entradas</option>
                            <option value="saida">Apenas saídas</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Nº empresa no E-Fiscal
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={9999}
                            value={numeroEmpresaEfiscal}
                            onChange={(e) => setNumeroEmpresaEfiscal(parseInt(e.target.value) || 1)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                            title="Código da empresa no cadastro do E-Fiscal Folhamatic (campo do registro E001)"
                        />
                    </div>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-700 pt-3 grid grid-cols-3 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3 text-center">
                        <p className="text-[10px] uppercase text-slate-500">Documentos</p>
                        <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{filtrados.length}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3 text-center">
                        <p className="text-[10px] uppercase text-slate-500">Valor total</p>
                        <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(totalValor)}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3 text-center">
                        <p className="text-[10px] uppercase text-slate-500">Itens (E222)</p>
                        <p className="text-lg font-bold text-slate-700 dark:text-slate-200">
                            {filtrados.reduce((a, d) => a + (d.itens?.length || 0), 0)}
                        </p>
                    </div>
                </div>

                <div className="flex justify-end pt-2">
                    <button
                        onClick={handleExportar}
                        disabled={exporting || filtrados.length === 0}
                        className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed font-bold"
                    >
                        {exporting ? 'Gerando...' : 'Gerar arquivo .FML'}
                    </button>
                </div>
            </div>

            {filtrados.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                            Pré-visualização ({Math.min(filtrados.length, 100)} de {filtrados.length})
                        </h3>
                    </div>
                    <div className="overflow-x-auto max-h-[320px]">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left">Empresa</th>
                                    <th className="px-3 py-2 text-left">Comp.</th>
                                    <th className="px-3 py-2 text-left">Tipo</th>
                                    <th className="px-3 py-2 text-left">Nº</th>
                                    <th className="px-3 py-2 text-left">Direção</th>
                                    <th className="px-3 py-2 text-right">Valor</th>
                                    <th className="px-3 py-2 text-center">Itens</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {filtrados.slice(0, 100).map(d => (
                                    <tr key={d.id}>
                                        <td className="px-3 py-1.5 truncate max-w-[180px]" title={d.empresaNome}>{d.empresaNome}</td>
                                        <td className="px-3 py-1.5 font-mono">{d.competencia}</td>
                                        <td className="px-3 py-1.5">{d.tipo}</td>
                                        <td className="px-3 py-1.5 font-mono">{d.numero}/{d.serie}</td>
                                        <td className="px-3 py-1.5">{d.direcao}</td>
                                        <td className="px-3 py-1.5 text-right font-bold">{formatCurrency(d.totais?.vNF || 0)}</td>
                                        <td className="px-3 py-1.5 text-center">{d.itens?.length || 0}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default XmlExportarIobSage;
