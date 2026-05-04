import React, { useEffect, useMemo, useState } from 'react';
import type { User, DocumentoFiscal } from '../../types';
import { listDocumentos, type ListDocumentosFilters } from '../../services/xmlFiscalService';
import { formatCnpjCpf, formatCurrency, formatDate } from '../../services/xmlParserService';
import { captureFromSefaz, isSefazCaptureAvailable } from '../../services/dfeCaptureService';
import { db } from '../../services/firebaseConfig';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';

interface Props {
    currentUser: User;
    onSelect: (doc: DocumentoFiscal) => void;
    /** Quando muda, força recarregar a lista. */
    refreshKey?: number;
    onShowToast?: (msg: string) => void;
}

const XmlDocumentosList: React.FC<Props> = ({ currentUser, onSelect, refreshKey, onShowToast }) => {
    const [docs, setDocs] = useState<DocumentoFiscal[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<ListDocumentosFilters>({});
    const [busca, setBusca] = useState('');
    const [validando, setValidando] = useState(false);
    const sefazAvailable = isSefazCaptureAvailable();

    useEffect(() => {
        let alive = true;
        setLoading(true);
        listDocumentos(currentUser, { ...filters, busca })
            .then(list => { if (alive) { setDocs(list); setLoading(false); } });
        return () => { alive = false; };
    }, [currentUser, filters, busca, refreshKey]);

    const competencias = useMemo(() => {
        const set = new Set<string>();
        docs.forEach(d => d.competencia && set.add(d.competencia));
        return Array.from(set).sort().reverse();
    }, [docs]);

    const validarSefaz = async () => {
        if (!sefazAvailable || validando || docs.length === 0 || !db) return;
        setValidando(true);
        try {
            // Agrupa documentos por CNPJ da empresa cadastrada (titular do cert).
            const porEmpresa = new Map<string, DocumentoFiscal[]>();
            docs.forEach(d => {
                if (!d.empresaCnpj) return;
                const arr = porEmpresa.get(d.empresaCnpj) || [];
                arr.push(d);
                porEmpresa.set(d.empresaCnpj, arr);
            });

            let atualizados = 0;
            let errosTotais = 0;
            for (const [cnpj, lista] of porEmpresa.entries()) {
                // Backend aceita até 50 chaves por chamada.
                for (let i = 0; i < lista.length; i += 50) {
                    const batch = lista.slice(i, i + 50);
                    const result = await captureFromSefaz({
                        cnpjTitular: cnpj,
                        chaves: batch.map(d => d.chave).filter(Boolean),
                        user: currentUser,
                    });
                    if (!result.sucesso) {
                        errosTotais++;
                        continue;
                    }
                    // Atualiza cada documento que voltou.
                    for (const item of result.itens) {
                        const docOriginal = batch.find(d => d.chave === item.chave);
                        if (!docOriginal) continue;
                        try {
                            await updateDoc(doc(db, 'documentos_fiscais', docOriginal.id), {
                                status: item.status,
                                statusOriginal: item.xMotivo,
                                cStat: item.cStat,
                                consultadoEm: serverTimestamp(),
                                canceladaEm: item.canceladaEm || null,
                            });
                            atualizados++;
                        } catch (err) {
                            errosTotais++;
                        }
                    }
                }
            }

            onShowToast?.(`Validacao SEFAZ concluida: ${atualizados} atualizados, ${errosTotais} erro(s).`);
            // Recarrega a lista
            const fresh = await listDocumentos(currentUser, { ...filters, busca });
            setDocs(fresh);
        } finally {
            setValidando(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <input
                        placeholder="Buscar (nº, chave, emit/dest)"
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                    />
                    <select
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={filters.direcao || ''}
                        onChange={(e) => setFilters(f => ({ ...f, direcao: (e.target.value || undefined) as any }))}
                    >
                        <option value="">Direção (todas)</option>
                        <option value="entrada">Entrada</option>
                        <option value="saida">Saída</option>
                    </select>
                    <select
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={filters.competencia || ''}
                        onChange={(e) => setFilters(f => ({ ...f, competencia: e.target.value || undefined }))}
                    >
                        <option value="">Competência (todas)</option>
                        {competencias.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={filters.status || ''}
                        onChange={(e) => setFilters(f => ({ ...f, status: (e.target.value || undefined) as any }))}
                    >
                        <option value="">Status (todos)</option>
                        <option value="autorizado">Autorizado</option>
                        <option value="cancelado">Cancelado</option>
                        <option value="denegado">Denegado</option>
                        <option value="rejeitado">Rejeitado</option>
                        <option value="desconhecido">Desconhecido</option>
                    </select>
                    <select
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                        value={filters.origem || ''}
                        onChange={(e) => setFilters(f => ({ ...f, origem: (e.target.value || undefined) as any }))}
                    >
                        <option value="">Origem (todas)</option>
                        <option value="manual">Manual</option>
                        <option value="sefaz">SEFAZ</option>
                        <option value="sharepoint">SharePoint</option>
                        <option value="email">E-mail</option>
                        <option value="api">API</option>
                    </select>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                        XMLs Capturados ({docs.length})
                    </h3>
                    <button
                        onClick={validarSefaz}
                        disabled={!sefazAvailable || validando || docs.length === 0}
                        title={!sefazAvailable
                            ? 'Backend SEFAZ não configurado neste ambiente (defina VITE_SEFAZ_BACKEND_URL).'
                            : 'Consulta status atual de cada chave na SEFAZ e atualiza os documentos.'}
                        className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {validando ? 'Validando...' : 'Validar SEFAZ'}
                    </button>
                </div>
                {loading ? (
                    <p className="text-center text-xs text-slate-400 py-6">Carregando...</p>
                ) : docs.length === 0 ? (
                    <p className="text-center text-xs text-slate-400 py-6">Nenhum documento encontrado.</p>
                ) : (
                    <div className="overflow-x-auto max-h-[520px]">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Data</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Empresa</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Tipo</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Nº</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Direção</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Contraparte</th>
                                    <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Valor</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {docs.map(d => (
                                    <tr
                                        key={d.id}
                                        onClick={() => onSelect(d)}
                                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40"
                                    >
                                        <td className="px-3 py-1.5 text-slate-500">{formatDate(d.dhEmi).split(' ')[0]}</td>
                                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 max-w-[180px] truncate" title={d.empresaNome}>{d.empresaNome}</td>
                                        <td className="px-3 py-1.5 text-slate-500">{d.tipo}</td>
                                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 font-mono">{d.numero}/{d.serie}</td>
                                        <td className="px-3 py-1.5">
                                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                                d.direcao === 'entrada' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                                : d.direcao === 'saida' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                            }`}>
                                                {d.direcao}
                                            </span>
                                        </td>
                                        <td className="px-3 py-1.5 max-w-[200px] truncate text-slate-600 dark:text-slate-300" title={`${d.emitente.nome} → ${d.destinatario.nome}`}>
                                            {d.direcao === 'entrada' ? d.emitente.nome : d.destinatario.nome}
                                            <span className="text-[10px] text-slate-400 ml-1">{formatCnpjCpf(d.direcao === 'entrada' ? d.emitente.cnpjCpf : d.destinatario.cnpjCpf)}</span>
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-bold text-slate-700 dark:text-slate-200">{formatCurrency(d.totais.vNF)}</td>
                                        <td className="px-3 py-1.5 text-slate-500">{d.status}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default XmlDocumentosList;
