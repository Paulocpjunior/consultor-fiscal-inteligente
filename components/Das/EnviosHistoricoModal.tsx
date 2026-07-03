/**
 * components/Das/EnviosHistoricoModal.tsx
 * Historico de envios de DAS ao cliente (e-mails enviados via Graph).
 * Le a colecao das_envios_cliente via GET /api/admin/das/envios-cliente.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User, DasEnvioCliente, SimplesNacionalEmpresa } from '../../types';
import { listarEnviosDas, formatBRL } from '../../services/dasService';

interface Props {
    currentUser: User | null;
    empresas: SimplesNacionalEmpresa[];
    /** Pre-filtra por CNPJ (ex.: aberto a partir do detalhe de uma guia). */
    cnpjInicial?: string;
    onClose: () => void;
    onShowToast?: (msg: string) => void;
}

const formatDataHora = (iso: string | null): string => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    } catch {
        return iso;
    }
};

const EnviosHistoricoModal: React.FC<Props> = ({ currentUser, empresas, cnpjInicial, onClose, onShowToast }) => {
    const [envios, setEnvios] = useState<DasEnvioCliente[]>([]);
    const [loading, setLoading] = useState(true);
    const [filtroCnpj, setFiltroCnpj] = useState((cnpjInicial || '').replace(/\D/g, ''));
    const [expandido, setExpandido] = useState<string | null>(null);

    const carregar = async (cnpj: string) => {
        setLoading(true);
        try {
            const r = await listarEnviosDas(currentUser, { cnpj: cnpj || undefined });
            setEnvios(r);
        } catch (e: any) {
            onShowToast?.(`Erro ao carregar histórico: ${e.message}`);
            setEnvios([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(filtroCnpj); }, [filtroCnpj]);

    const empresasComCnpj = useMemo(
        () => empresas
            .map(e => ({ ...e, cnpjLimpo: (e.cnpj || '').replace(/\D/g, '') }))
            .filter(e => e.cnpjLimpo),
        [empresas]
    );

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[80]" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-5 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">📨 Histórico de envios ao cliente</h3>
                    <p className="text-xs text-slate-500 mt-1">
                        E-mails de DAS enviados pelo sistema, com destinatário, PDF anexado, quem enviou e a mensagem entregue.
                    </p>
                </div>

                <div className="px-5 pt-4 flex flex-wrap items-center gap-3">
                    <select
                        value={filtroCnpj}
                        onChange={e => setFiltroCnpj(e.target.value)}
                        className="px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                    >
                        <option value="">Todas as empresas</option>
                        {empresasComCnpj.map(e => (
                            <option key={e.id} value={e.cnpjLimpo}>{e.nome}</option>
                        ))}
                    </select>
                    {!loading && (
                        <span className="text-xs text-slate-500">
                            {envios.length === 0 ? 'Nenhum envio' : `${envios.length} envio${envios.length > 1 ? 's' : ''}`}
                        </span>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                    {loading ? (
                        <div className="text-center py-12 text-slate-500">Carregando...</div>
                    ) : envios.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                            Nenhum envio registrado{filtroCnpj ? ' para esta empresa' : ''} ainda.
                            <p className="text-xs mt-2">Os envios feitos pelo botão "Enviar ao cliente" das guias aparecem aqui.</p>
                        </div>
                    ) : (
                        envios.map(env => (
                            <div
                                key={env.id}
                                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30"
                            >
                                <button
                                    onClick={() => setExpandido(expandido === env.id ? null : env.id)}
                                    className="w-full text-left px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-700/40 rounded-lg"
                                >
                                    <div className="flex items-start justify-between gap-3 flex-wrap">
                                        <div className="min-w-0">
                                            <div className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">
                                                {env.empresaNome}
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                {env.competencia ? `Competência ${env.competencia} · ` : ''}
                                                {env.valor > 0 ? `${formatBRL(env.valor)} · ` : ''}
                                                para <span className="font-mono">{env.para}</span>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
                                                {formatDataHora(env.enviadoEm)}
                                            </div>
                                            <div className="flex gap-1 justify-end mt-1">
                                                <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 text-[10px] font-bold uppercase">
                                                    {env.canal}
                                                </span>
                                                {env.anexouPdf && (
                                                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] font-bold">
                                                        📎 PDF
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                                {expandido === env.id && (
                                    <div className="px-4 pb-4 space-y-2 text-sm border-t border-slate-200 dark:border-slate-700 pt-3">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                                            <div><span className="text-slate-400">Assunto:</span> {env.assunto || '—'}</div>
                                            <div><span className="text-slate-400">Enviado por:</span> {env.enviadoPor || '—'}</div>
                                            <div><span className="text-slate-400">CNPJ:</span> <span className="font-mono">{env.empresaCnpj}</span></div>
                                            <div><span className="text-slate-400">Vencimento:</span> {env.vencimento || '—'}</div>
                                            {env.copiaPara && env.copiaPara.length > 0 && (
                                                <div className="md:col-span-2">
                                                    <span className="text-slate-400">Cópia (CC):</span> <span className="font-mono">{env.copiaPara.join(', ')}</span>
                                                </div>
                                            )}
                                        </div>
                                        {env.mensagem ? (
                                            <div>
                                                <div className="text-xs text-slate-400 mb-1">Mensagem enviada</div>
                                                <pre className="whitespace-pre-wrap font-mono text-xs bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded p-3 max-h-64 overflow-y-auto">
                                                    {env.mensagem}
                                                </pre>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-slate-400 italic">
                                                Conteúdo da mensagem não registrado (envio anterior à versão que grava a mensagem).
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                    <button
                        onClick={onClose}
                        className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EnviosHistoricoModal;
