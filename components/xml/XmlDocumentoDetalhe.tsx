import React from 'react';
import type { DocumentoFiscal } from '../../types';
import { formatCnpjCpf, formatCurrency, formatDate } from '../../services/xmlParserService';

interface Props {
    documento: DocumentoFiscal;
    onClose: () => void;
}

const XmlDocumentoDetalhe: React.FC<Props> = ({ documento: d, onClose }) => {
    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-bold text-emerald-800 dark:text-emerald-300">
                            {d.tipo} Nº {d.numero} — Série {d.serie}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {d.natOp} • Emissão: {formatDate(d.dhEmi)} • Status: {d.status} • {d.direcao}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5 font-mono">Chave: {d.chave}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {d.storageUrl && (
                            <a href={d.storageUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 dark:text-emerald-300 underline">
                                Baixar XML
                            </a>
                        )}
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Emitente</p>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{(d as any).emitente?.nome || (d as any).prestador?.nome || '—'}</p>
                        {(d as any).emitente?.fantasia && <p className="text-xs text-slate-500">{(d as any).emitente.fantasia}</p>}
                        <p className="text-xs text-slate-500 mt-1">CNPJ: {formatCnpjCpf((d as any).emitente?.cnpjCpf || (d as any).prestador?.cnpj || '')}</p>
                        <p className="text-xs text-slate-500">IE: {(d as any).emitente?.ie || '-'}</p>
                        <p className="text-xs text-slate-500">{(d as any).emitente?.municipio || (d as any).prestador?.municipio || '—'}/{(d as any).emitente?.uf || (d as any).prestador?.uf || ''}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Destinatário</p>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{(d as any).destinatario?.nome || (d as any).tomador?.nome || '—'}</p>
                        <p className="text-xs text-slate-500 mt-1">CNPJ/CPF: {formatCnpjCpf((d as any).destinatario?.cnpjCpf || (d as any).tomador?.cnpj || '')}</p>
                        <p className="text-xs text-slate-500">IE: {(d as any).destinatario?.ie || '-'}</p>
                        <p className="text-xs text-slate-500">{(d as any).destinatario?.municipio || (d as any).tomador?.municipio || '—'}/{(d as any).destinatario?.uf || (d as any).tomador?.uf || ''}</p>
                    </div>
                </div>

                <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Resumo de Impostos</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                            { label: 'Valor Produtos', value: (d as any).totais?.vProd ?? 0 },
                            { label: 'Valor NF', value: (d as any).totais?.vNF ?? (d as any).valores?.liquido ?? 0 },
                            { label: 'BC ICMS', value: (d as any).totais?.vBC ?? 0 },
                            { label: 'ICMS', value: (d as any).totais?.vICMS ?? 0 },
                            { label: 'BC ICMS ST', value: (d as any).totais?.vBCST ?? 0 },
                            { label: 'ICMS ST', value: (d as any).totais?.vST ?? 0 },
                            { label: 'IPI', value: (d as any).totais?.vIPI ?? 0 },
                            { label: 'PIS', value: (d as any).totais?.vPIS ?? (d as any).valores?.pis ?? 0 },
                            { label: 'COFINS', value: (d as any).totais?.vCOFINS ?? (d as any).valores?.cofins ?? 0 },
                            { label: 'Frete', value: (d as any).totais?.vFrete ?? 0 },
                            { label: 'Desconto', value: (d as any).totais?.vDesc ?? 0 },
                            { label: 'Outros', value: (d as any).totais?.vOutro ?? 0 },
                        ].map(item => (
                            <div key={item.label} className="bg-slate-50 dark:bg-slate-700/30 rounded-lg p-2 text-center">
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">{item.label}</p>
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{formatCurrency(item.value)}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                        Itens ({(d as any).itens?.length || 0})
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 max-h-[360px]">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-2 py-2 text-left">#</th>
                                    <th className="px-2 py-2 text-left">Produto</th>
                                    <th className="px-2 py-2 text-center">NCM</th>
                                    <th className="px-2 py-2 text-center">CFOP</th>
                                    <th className="px-2 py-2 text-center">CST</th>
                                    <th className="px-2 py-2 text-right">Qtd</th>
                                    <th className="px-2 py-2 text-right">Vl. Unit.</th>
                                    <th className="px-2 py-2 text-right">Vl. Total</th>
                                    <th className="px-2 py-2 text-right">ICMS</th>
                                    <th className="px-2 py-2 text-right">IPI</th>
                                    <th className="px-2 py-2 text-right">PIS</th>
                                    <th className="px-2 py-2 text-right">COFINS</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {((d as any).itens || []).map((p: any, i: number) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                        <td className="px-2 py-1.5 text-slate-400">{p.nItem}</td>
                                        <td className="px-2 py-1.5 max-w-[200px] truncate" title={p.xProd}>{p.xProd}</td>
                                        <td className="px-2 py-1.5 text-center text-slate-500">{p.ncm}</td>
                                        <td className="px-2 py-1.5 text-center text-slate-500">{p.cfop}</td>
                                        <td className="px-2 py-1.5 text-center text-slate-500">{p.cst}</td>
                                        <td className="px-2 py-1.5 text-right text-slate-500">{p.qCom.toLocaleString('pt-BR')} {p.uCom}</td>
                                        <td className="px-2 py-1.5 text-right text-slate-500">{formatCurrency(p.vUnCom)}</td>
                                        <td className="px-2 py-1.5 text-right font-bold">{formatCurrency(p.vProd)}</td>
                                        <td className="px-2 py-1.5 text-right text-blue-600">{formatCurrency(p.vICMS)}</td>
                                        <td className="px-2 py-1.5 text-right text-amber-600">{formatCurrency(p.vIPI)}</td>
                                        <td className="px-2 py-1.5 text-right text-orange-600">{formatCurrency(p.vPIS)}</td>
                                        <td className="px-2 py-1.5 text-right text-orange-600">{formatCurrency(p.vCOFINS)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {d.infAdic && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/10 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Informações Adicionais</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{d.infAdic}</p>
                    </div>
                )}

                <div className="text-[10px] text-slate-400 grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <div><span className="font-bold">Origem:</span> {d.origem}</div>
                    <div><span className="font-bold">Importado por:</span> {d.importadoPorEmail || d.importadoPor}</div>
                    <div><span className="font-bold">Em:</span> {new Date(d.importadoEm).toLocaleString('pt-BR')}</div>
                    <div className="truncate" title={d.xmlHash}><span className="font-bold">Hash:</span> {d.xmlHash.slice(0, 16)}...</div>
                </div>
            </div>
        </div>
    );
};

export default XmlDocumentoDetalhe;
