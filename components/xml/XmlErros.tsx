import React, { useEffect, useState } from 'react';
import type { User, XmlErro, XmlCaptura } from '../../types';
import { listErros, listCapturas } from '../../services/xmlFiscalService';

interface Props {
    currentUser: User;
    refreshKey?: number;
}

const XmlErros: React.FC<Props> = ({ currentUser, refreshKey }) => {
    const [erros, setErros] = useState<XmlErro[]>([]);
    const [capturas, setCapturas] = useState<XmlCaptura[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        Promise.all([listErros(currentUser), listCapturas(currentUser)]).then(([e, c]) => {
            if (alive) { setErros(e); setCapturas(c); setLoading(false); }
        });
        return () => { alive = false; };
    }, [currentUser, refreshKey]);

    if (loading) return <p className="text-center text-xs text-slate-400 py-6">Carregando logs...</p>;

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Erros de importação ({erros.length})</h3>
                </div>
                {erros.length === 0 ? (
                    <p className="text-center text-xs text-slate-400 py-6">Nenhum erro registrado.</p>
                ) : (
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-700">
                            <tr>
                                <th className="px-3 py-2 text-left">Data</th>
                                <th className="px-3 py-2 text-left">Origem</th>
                                <th className="px-3 py-2 text-left">Arquivo / Chave</th>
                                <th className="px-3 py-2 text-left">Mensagem</th>
                                <th className="px-3 py-2 text-left">Usuário</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {erros.map(e => (
                                <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                    <td className="px-3 py-1.5 text-slate-500">{new Date(e.timestamp).toLocaleString('pt-BR')}</td>
                                    <td className="px-3 py-1.5 capitalize">{e.origem}</td>
                                    <td className="px-3 py-1.5 truncate max-w-[180px] font-mono text-slate-600 dark:text-slate-300" title={e.chave || e.fileName}>{e.fileName || e.chave || '-'}</td>
                                    <td className="px-3 py-1.5 text-red-600 dark:text-red-400 max-w-[400px] truncate" title={e.mensagem}>{e.mensagem}</td>
                                    <td className="px-3 py-1.5 text-slate-500">{e.usuarioEmail || e.usuarioId}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Histórico de capturas ({capturas.length})</h3>
                </div>
                {capturas.length === 0 ? (
                    <p className="text-center text-xs text-slate-400 py-6">Nenhuma captura registrada.</p>
                ) : (
                    <div className="max-h-[360px] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left">Data</th>
                                    <th className="px-3 py-2 text-left">Origem</th>
                                    <th className="px-3 py-2 text-left">Status</th>
                                    <th className="px-3 py-2 text-left">Arquivo</th>
                                    <th className="px-3 py-2 text-left">Usuário</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {capturas.map(c => (
                                    <tr key={c.id}>
                                        <td className="px-3 py-1.5 text-slate-500">{new Date(c.timestamp).toLocaleString('pt-BR')}</td>
                                        <td className="px-3 py-1.5 capitalize">{c.origem}</td>
                                        <td className="px-3 py-1.5">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                c.status === 'sucesso' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                : c.status === 'duplicado' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                            }`}>{c.status}</span>
                                        </td>
                                        <td className="px-3 py-1.5 truncate max-w-[200px] font-mono text-slate-600 dark:text-slate-300" title={c.fileName || c.chave}>{c.fileName || c.chave || '-'}</td>
                                        <td className="px-3 py-1.5 text-slate-500">{c.usuarioEmail || c.usuarioId}</td>
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

export default XmlErros;
