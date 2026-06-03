import React, { useEffect, useState } from 'react';
import type { User, XmlErro, XmlCaptura } from '../../types';
import { listErros, listCapturas } from '../../services/xmlFiscalService';
import { fetchCronLogs, type CronLogItem, type CronLogColecao } from '../../services/capturaDiagnosticoService';

interface Props {
    currentUser: User;
    refreshKey?: number;
}

const CRONS: { col: CronLogColecao; label: string; descricao: string }[] = [
    { col: 'sefaz_cron_logs', label: 'SEFAZ NFe (DistDFe)', descricao: '02:00 BRT seg-sex' },
    { col: 'nfsesp_cron_logs', label: 'NFSe SP (portal)', descricao: '03:00 BRT seg-sex' },
    { col: 'nfse_nacional_dfe_cron_logs', label: 'NFSe Nacional (ADN DFe)', descricao: '04:00 BRT seg-sex' },
];

const XmlErros: React.FC<Props> = ({ currentUser, refreshKey }) => {
    const [erros, setErros] = useState<XmlErro[]>([]);
    const [capturas, setCapturas] = useState<XmlCaptura[]>([]);
    const [loading, setLoading] = useState(true);
    const [cronCol, setCronCol] = useState<CronLogColecao>('nfsesp_cron_logs');
    const [cronLogs, setCronLogs] = useState<CronLogItem[] | { erro: string } | null>(null);
    const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
    const isAdmin = currentUser?.role === 'admin';

    const toggleExpand = (id: string) => {
        setExpandidos(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    useEffect(() => {
        let alive = true;
        setLoading(true);
        Promise.all([listErros(currentUser), listCapturas(currentUser)]).then(([e, c]) => {
            if (alive) { setErros(e); setCapturas(c); setLoading(false); }
        });
        return () => { alive = false; };
    }, [currentUser, refreshKey]);

    useEffect(() => {
        if (!isAdmin) return;
        let alive = true;
        setCronLogs(null);
        fetchCronLogs(cronCol, 20)
            .then(logs => { if (alive) setCronLogs(logs); })
            .catch(e => { if (alive) setCronLogs({ erro: e.message }); });
        return () => { alive = false; };
    }, [cronCol, isAdmin, refreshKey]);

    if (loading) return <p className="text-center text-xs text-slate-400 py-6">Carregando logs...</p>;

    return (
        <div className="space-y-4">
            {isAdmin && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Execuções automáticas (cron)</h3>
                            <p className="text-[11px] text-slate-500 mt-0.5">Últimas 20 execuções de cada cron noturno. Confirma se está rodando e quando trouxe documentos novos.</p>
                        </div>
                        <select
                            value={cronCol}
                            onChange={(e) => setCronCol(e.target.value as CronLogColecao)}
                            className="px-2 py-1 text-xs border rounded bg-white dark:bg-slate-700 dark:border-slate-600"
                        >
                            {CRONS.map(c => (
                                <option key={c.col} value={c.col}>{c.label} — {c.descricao}</option>
                            ))}
                        </select>
                    </div>
                    {cronLogs === null ? (
                        <p className="text-center text-xs text-slate-400 py-6">Carregando…</p>
                    ) : Array.isArray(cronLogs) ? (
                        cronLogs.length === 0 ? (
                            <div className="px-4 py-6 text-xs">
                                <p className="text-red-600 dark:text-red-400 font-semibold">⚠ Nenhuma execução registrada nesta coleção.</p>
                                <p className="text-slate-500 mt-1">
                                    O cron pode estar desabilitado no Cloud Scheduler, retornando 403 (secret drift entre Scheduler e Cloud Run)
                                    ou nunca ter rodado. Verifique <code>gcloud scheduler jobs list</code> e os logs do Cloud Run.
                                </p>
                            </div>
                        ) : (
                            <div className="max-h-[360px] overflow-y-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Executado em</th>
                                            <th className="px-3 py-2 text-right">Duração</th>
                                            <th className="px-3 py-2 text-right">Empresas</th>
                                            <th className="px-3 py-2 text-right">Sucessos</th>
                                            <th className="px-3 py-2 text-right">Falhas</th>
                                            <th className="px-3 py-2 text-right">Docs novos</th>
                                            <th className="px-3 py-2 text-left">Login</th>
                                            <th className="px-3 py-2 text-left">Origem</th>
                                            <th className="px-3 py-2 text-left">Erro fatal</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {cronLogs.map(log => {
                                            const dt = log.executadoEmMs ? new Date(log.executadoEmMs) : null;
                                            const erro = !!log.erroFatal;
                                            const semNovas = !erro && (log.totalNovos ?? 0) === 0;
                                            const temFalhas = (log.falhas ?? 0) > 0;
                                            const temResumo = (log.errosResumo?.length ?? 0) > 0;
                                            const podeExpandir = temResumo || erro;
                                            const aberto = expandidos.has(log.id);
                                            const rowCls = erro
                                                ? 'bg-red-50/50 dark:bg-red-900/10'
                                                : semNovas
                                                    ? 'bg-amber-50/40 dark:bg-amber-900/10'
                                                    : '';
                                            return (
                                                <React.Fragment key={log.id}>
                                                <tr className={`${rowCls} ${podeExpandir ? 'cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-700/30' : ''}`}
                                                    onClick={() => podeExpandir && toggleExpand(log.id)}
                                                    title={podeExpandir ? 'Clique pra ver detalhes' : ''}>
                                                    <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300 font-mono">
                                                        {podeExpandir && <span className="inline-block w-3 text-slate-400">{aberto ? '▼' : '▶'}</span>}{' '}
                                                        {dt ? dt.toLocaleString('pt-BR') : '—'}
                                                    </td>
                                                    <td className="px-3 py-1.5 text-right text-slate-500">{log.duracaoMs != null ? `${(log.duracaoMs / 1000).toFixed(1)}s` : '—'}</td>
                                                    <td className="px-3 py-1.5 text-right">{log.processadas ?? log.totalEmpresas ?? '—'}</td>
                                                    <td className="px-3 py-1.5 text-right text-emerald-700 dark:text-emerald-400">{log.sucessos ?? '—'}</td>
                                                    <td className="px-3 py-1.5 text-right text-red-700 dark:text-red-400">{log.falhas ?? '—'}</td>
                                                    <td className={`px-3 py-1.5 text-right font-bold ${(log.totalNovos ?? 0) > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'}`}>{log.totalNovos ?? 0}</td>
                                                    <td className="px-3 py-1.5 text-slate-500">{log.metodoLogin || '—'}</td>
                                                    <td className="px-3 py-1.5 text-slate-500">{log.capturadoPor || '—'}</td>
                                                    <td className="px-3 py-1.5 text-red-600 dark:text-red-400 max-w-[280px] truncate" title={log.erroFatal || ''}>{log.erroFatal || '—'}</td>
                                                </tr>
                                                {aberto && podeExpandir && (
                                                    <tr className="bg-slate-50 dark:bg-slate-900/30">
                                                        <td colSpan={9} className="px-3 py-2">
                                                            {temResumo ? (
                                                                <div className="space-y-1">
                                                                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                                                        Erros por empresa (top {log.errosResumo!.length} de {log.falhas ?? 0}):
                                                                    </div>
                                                                    {log.errosResumo!.map((e, i) => {
                                                                        const msg = e.erroPrestador || e.erroTomador || e.motivo || `(${e.status})`;
                                                                        return (
                                                                            <div key={i} className="font-mono text-[11px] flex gap-2 items-start border-l-2 border-red-400 pl-2 py-0.5">
                                                                                <span className="text-slate-500 shrink-0">{e.cnpj || e.ccm || '—'}</span>
                                                                                <span className="text-slate-700 dark:text-slate-200 shrink-0 truncate max-w-[180px]" title={e.nome || ''}>{e.nome || '—'}</span>
                                                                                <span className="text-red-600 dark:text-red-400 flex-1">{msg}</span>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            ) : erro ? (
                                                                <div className="font-mono text-[11px] text-red-600 dark:text-red-400">
                                                                    Erro fatal (sem detalhes por empresa): {log.erroFatal}
                                                                </div>
                                                            ) : (
                                                                <div className="text-[11px] text-slate-500">Sem detalhes registrados — execuções antigas (anteriores ao deploy do PR #27) não persistiam motivos individuais.</div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )
                    ) : (
                        <p className="px-4 py-4 text-xs text-red-600 dark:text-red-400">Erro ao carregar logs: {cronLogs.erro}</p>
                    )}
                </div>
            )}
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
