/**
 * components/NfseNacional/index.tsx
 * Dashboard NFS-e Nacional — gestao + listagem + cancelamento.
 *
 * Versao base — emissao acontece dentro da tela de empresa Simples
 * (proximo Chunk C). Aqui só visualizacao + cancelamento.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User, NfseNacionalEmitida, NfseNacResumo, NfseNacStatus } from '../../types';
import {
    getResumoNfse, listarNfse, cancelarNfse,
    formatBRL, formatChave, statusBadgeClass,
} from '../../services/nfseNacionalService';
import { baixarDanfse } from '../../services/danfseGenerator';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const NfseNacionalDashboard: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [resumo, setResumo] = useState<NfseNacResumo | null>(null);
    const [docs, setDocs] = useState<NfseNacionalEmitida[]>([]);
    const [loading, setLoading] = useState(false);
    const [filtroStatus, setFiltroStatus] = useState<NfseNacStatus | ''>('');
    const [selecionada, setSelecionada] = useState<NfseNacionalEmitida | null>(null);

    const carregar = async () => {
        setLoading(true);
        try {
            const [r, d] = await Promise.all([
                getResumoNfse(currentUser),
                listarNfse(currentUser, { status: filtroStatus || undefined }),
            ]);
            setResumo(r);
            setDocs(d);
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, [filtroStatus]);

    const handleCancelar = async (nfse: NfseNacionalEmitida) => {
        const motivo = window.prompt('Motivo do cancelamento:', 'erro de digitacao');
        if (!motivo) return;
        try {
            await cancelarNfse(currentUser, nfse.chave, motivo);
            await carregar();
            setSelecionada(null);
            onShowToast?.('NFSe cancelada com sucesso');
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        }
    };

    const cards = useMemo(() => {
        if (!resumo) return [];
        return [
            { label: 'Total', valor: resumo.total, clave: '' },
            { label: 'Autorizadas', valor: resumo.autorizadas, clave: 'autorizada' as NfseNacStatus, cor: 'bg-emerald-100 text-emerald-700' },
            { label: 'Canceladas', valor: resumo.canceladas, clave: 'cancelada' as NfseNacStatus, cor: 'bg-red-100 text-red-700' },
            { label: 'ISS Total', valor: resumo.valorIssTotal, isMoney: true, clave: '' },
        ];
    }, [resumo]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">📑 NFS-e Nacional</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Padrão Nacional CGSN 189/2026 — obrigatório a partir de 1º setembro 2026
                        {resumo && (
                            <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${resumo.mode === 'mock' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {resumo.mode === 'mock' ? 'MODO TESTE' : 'PRODUÇÃO'}
                            </span>
                        )}
                    </p>
                </div>
            </div>

            <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-4 text-sm">
                <p className="text-sky-800 dark:text-sky-200 font-bold">ⓘ Onde emitir NFSe?</p>
                <p className="text-sky-700 dark:text-sky-300 mt-1">
                    A emissão acontece na tela de cada empresa Simples Nacional —
                    procure o botão <strong>"Emitir NFSe"</strong>. Esta tela é para gestão e visualização.
                </p>
            </div>

            {/* Cards */}
            {resumo && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {cards.map(c => (
                        <button
                            key={c.label}
                            onClick={() => c.clave && setFiltroStatus(filtroStatus === c.clave ? '' : (c.clave as NfseNacStatus))}
                            className={`text-left p-4 rounded-lg border-2 transition-all ${
                                c.clave && filtroStatus === c.clave
                                    ? 'border-sky-500 ' + (c.cor || '')
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-sky-300'
                            }`}
                        >
                            <div className="text-3xl font-bold">
                                {c.isMoney ? formatBRL(c.valor as number) : c.valor}
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">{c.label}</div>
                        </button>
                    ))}
                </div>
            )}

            {/* Tabela */}
            {loading ? (
                <div className="text-center py-12 text-slate-500">Carregando...</div>
            ) : docs.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                    Nenhuma NFSe emitida ainda. Use a tela da empresa Simples pra emitir.
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900/50 text-left">
                            <tr>
                                <th className="px-4 py-2 font-medium">Número</th>
                                <th className="px-4 py-2 font-medium">Data</th>
                                <th className="px-4 py-2 font-medium">Tomador</th>
                                <th className="px-4 py-2 font-medium">Serviço</th>
                                <th className="px-4 py-2 font-medium text-right">Valor</th>
                                <th className="px-4 py-2 font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {docs.map(d => (
                                <tr
                                    key={d.id}
                                    onClick={() => setSelecionada(d)}
                                    className="border-t border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50"
                                >
                                    <td className="px-4 py-2 font-mono text-xs">{d.numero}</td>
                                    <td className="px-4 py-2 font-mono text-xs">{d.emitidaEm?.slice(0, 10)}</td>
                                    <td className="px-4 py-2 max-w-[200px] truncate">{d.tomador?.nome || '-'}</td>
                                    <td className="px-4 py-2 max-w-[300px] truncate">{d.servico?.descricao}</td>
                                    <td className="px-4 py-2 text-right font-mono">{formatBRL(d.servico?.valor || 0)}</td>
                                    <td className="px-4 py-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${statusBadgeClass(d.status)}`}>
                                            {d.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Modal detalhe */}
            {selecionada && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[70]" onClick={() => setSelecionada(null)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex items-center justify-between mb-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusBadgeClass(selecionada.status)}`}>
                                    {selecionada.status}
                                </span>
                                <span className="text-xs text-slate-500">NFSe Nº {selecionada.numero}</span>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                                {selecionada.servico?.descricao}
                            </h3>
                            <p className="text-xs text-slate-500 mt-1 font-mono break-all">{formatChave(selecionada.chave)}</p>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-sm">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <div className="text-xs text-slate-500">Bruto</div>
                                    <div className="text-lg font-bold">{formatBRL(selecionada.valores?.bruto || 0)}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">ISS ({selecionada.servico?.aliquotaIss}%)</div>
                                    <div className="text-lg font-bold">{formatBRL(selecionada.servico?.issValor || 0)}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">ISS Retido</div>
                                    <div className="text-lg font-bold">{formatBRL(selecionada.valores?.issRetido || 0)}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">Líquido</div>
                                    <div className="text-lg font-bold text-emerald-600">{formatBRL(selecionada.valores?.liquido || 0)}</div>
                                </div>
                            </div>

                            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                                <div className="text-xs text-slate-500 mb-1">Prestador</div>
                                <div>{selecionada.prestador?.nome} ({selecionada.prestador?.cnpj})</div>
                                <div className="text-xs text-slate-500 mb-1 mt-3">Tomador</div>
                                <div>{selecionada.tomador?.nome} {selecionada.tomador?.cnpj && `(${selecionada.tomador?.cnpj})`}</div>
                                <div className="text-xs text-slate-500 mb-1 mt-3">NBS</div>
                                <div className="font-mono">{selecionada.servico?.codigoNbs}</div>
                            </div>

                            {selecionada.modeUsado === 'mock' && (
                                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                                    ⓘ NFSe gerada em modo TESTE — não vale fiscalmente. Pra produção real:
                                    cadastro no Emissor Nacional gov.br/nfse + NFSE_NAC_MODE=serpro.
                                </div>
                            )}

                            {selecionada.status === 'cancelada' && (
                                <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                                    Cancelada em {selecionada.canceladaEm?.slice(0, 10)} — Motivo: {selecionada.motivoCancelamento}
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2 flex-wrap">
                            <button
                                onClick={() => setSelecionada(null)}
                                className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100"
                            >
                                Fechar
                            </button>
                            <button
                                onClick={() => baixarDanfse(selecionada, true)}
                                className="btn-press px-4 py-2 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-800 flex items-center gap-2"
                                title="Baixar DANFSe (PDF representação simplificada da NFSe)"
                            >
                                📄 Baixar DANFSe
                            </button>
                            {selecionada.status === 'autorizada' && (
                                <button
                                    onClick={() => handleCancelar(selecionada)}
                                    className="btn-press px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                                >
                                    Cancelar NFSe
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NfseNacionalDashboard;
