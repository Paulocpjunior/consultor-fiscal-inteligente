/**
 * components/DCTFWeb/MitApuracao.tsx
 *
 * Modal MIT — apuração, encerramento, status, histórico anual.
 */
import React, { useState, useEffect } from 'react';
import type { User, DctfwebDeclaracao } from '../../types';
import {
    encerrarApuracaoMit,
    consultarStatusEncerramentoMit,
    consultarApuracaoMit,
    consultarApuracoesAno,
    formatPaLabel,
} from '../../services/dctfwebService';
import { getMitEncerramentoEstado } from './mitApuracaoStatus';
import { pickDadosApuracaoMit, analisarApuracaoMitParaEncerramento } from './mitApuracaoPayload';

interface Props {
    declaracao: DctfwebDeclaracao;
    user: User | null;
    onClose: () => void;
    onShowToast?: (msg: string) => void;
}

const MitApuracao: React.FC<Props> = ({ declaracao, user, onClose, onShowToast }) => {
    const [apuracao, setApuracao] = useState<any>(null);
    const [apuracaoResumo, setApuracaoResumo] = useState<any>(null);
    const [apuracaoMotivo, setApuracaoMotivo] = useState<string | null>(null);
    const [status, setStatus] = useState<{ statusEncerramento: string; protocolo: string } | null>(null);
    const [historico, setHistorico] = useState<any[]>([]);
    const [loadingApur, setLoadingApur] = useState(false);
    const [loadingEnc, setLoadingEnc] = useState(false);
    const [loadingHist, setLoadingHist] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const carregarApuracao = async () => {
        if (!user) return;
        setLoadingApur(true); setError(null);
        try {
            const r = await consultarApuracaoMit(user, {
                empresaCnpj: declaracao.empresaCnpj,
                anoPA: declaracao.anoPA,
                mesPA: declaracao.mesPA,
            });
            setApuracao(r.apuracaoMit);
            setApuracaoResumo(r.apuracaoResumo || null);
            setApuracaoMotivo(r.motivo || null);
        } catch (err: any) {
            setError(`Apuração: ${err.message}`);
        } finally { setLoadingApur(false); }
    };

    const carregarHistorico = async () => {
        if (!user) return;
        setLoadingHist(true); setError(null);
        try {
            const r = await consultarApuracoesAno(user, {
                empresaCnpj: declaracao.empresaCnpj,
                anoPA: declaracao.anoPA,
            });
            setHistorico(r.apuracoes || []);
        } catch (err: any) {
            setError(`Histórico: ${err.message}`);
        } finally { setLoadingHist(false); }
    };

    useEffect(() => {
        carregarApuracao();
        carregarHistorico();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleEncerrar = async () => {
        if (!user) return;
        const dadosApuracaoMit = pickDadosApuracaoMit(apuracao);
        const analiseClick = analisarApuracaoMitParaEncerramento(apuracao);
        if (!analiseClick.completa) {
            setError(`Encerrar: ${analiseClick.motivo || 'não há apuração MIT completa carregada para transmitir.'}`);
            return;
        }
        if (!confirm(`Encerrar apuração MIT de ${declaracao.empresaCnpj} ref ${formatPaLabel(declaracao.anoPA, declaracao.mesPA)}?`)) return;
        setLoadingEnc(true); setError(null);
        try {
            const r = await encerrarApuracaoMit(user, {
                empresaId: declaracao.empresaId,
                empresaCnpj: declaracao.empresaCnpj,
                anoPA: declaracao.anoPA,
                mesPA: declaracao.mesPA,
                dadosApuracaoMit,
            });
            setStatus({ statusEncerramento: r.statusEncerramento, protocolo: r.protocolo });
            onShowToast?.(`Encerramento solicitado (${r.statusEncerramento}).`);
        } catch (err: any) {
            setError(`Encerrar: ${err.message}`);
        } finally { setLoadingEnc(false); }
    };

    const checarStatus = async () => {
        if (!user) return;
        try {
            const r = await consultarStatusEncerramentoMit(user, {
                empresaCnpj: declaracao.empresaCnpj,
                protocolo: status?.protocolo,
                anoPA: declaracao.anoPA,
                mesPA: declaracao.mesPA,
            });
            setStatus({ statusEncerramento: r.statusEncerramento, protocolo: r.protocolo });
        } catch (err: any) {
            setError(`Status: ${err.message}`);
        }
    };

    const analiseEncerramento = analisarApuracaoMitParaEncerramento(apuracao);
    const dadosApuracaoMitCompleta = analiseEncerramento.completa;
    const estadoEncerramento = getMitEncerramentoEstado(apuracao, apuracaoResumo);
    const encerramentoBloqueado = !dadosApuracaoMitCompleta || estadoEncerramento.bloqueiaEncerramento;
    let mensagemBloqueioEncerramento = 'Encerramento indisponível para a situação retornada pelo SERPRO.';
    if (!apuracao) {
        mensagemBloqueioEncerramento = apuracaoMotivo || 'Encerramento indisponível: nenhuma apuração MIT foi carregada para esta competência.';
    } else if (estadoEncerramento.encerrada) {
        mensagemBloqueioEncerramento =
            `MIT já encerrado${estadoEncerramento.dataEncerramentoLabel ? ` em ${estadoEncerramento.dataEncerramentoLabel}` : ''}. ` +
            'Não é necessário encerrar novamente; siga com a transmissão ou sincronização da DCTFWeb.';
    } else if (estadoEncerramento.emProcessamento) {
        mensagemBloqueioEncerramento = 'Encerramento MIT em processamento no SERPRO. Aguarde alguns minutos e atualize a apuração antes de tentar transmitir a DCTFWeb.';
    } else if (!dadosApuracaoMitCompleta) {
        // Motivo específico (ex.: apuração em edição sem débitos lançados)
        // vindo da análise do payload — antes era um texto genérico e o clique
        // ia ao SERPRO só pra voltar 400 MIT-MSG_0003.
        mensagemBloqueioEncerramento = analiseEncerramento.motivo
            || 'Encerramento indisponível: a apuração MIT foi encontrada, mas o SERPRO não retornou DadosIniciais e Débitos completos para retransmissão.';
    }
    const botaoEncerrarLabel = estadoEncerramento.encerrada
        ? 'MIT já encerrado'
        : estadoEncerramento.emProcessamento
            ? 'Aguardando SERPRO'
            : (loadingEnc ? 'Encerrando...' : 'Encerrar Apuração');
    const loadingRefresh = loadingApur || loadingHist;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto">
                <div className="p-6 border-b">
                    <div className="flex items-start justify-between">
                        <div>
                            <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Apuração MIT</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-mono">
                                {declaracao.empresaCnpj} · {formatPaLabel(declaracao.anoPA, declaracao.mesPA)}
                            </p>
                        </div>
                        <button onClick={onClose} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 text-xl">×</button>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {error && (
                        <div className="bg-rose-50 border dark:border-slate-700 border-rose-200 text-rose-800 rounded p-3 text-sm">{error}</div>
                    )}

                    {/* Apuração */}
                    <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-4">
                        <h4 className="font-medium text-slate-700 dark:text-slate-200 mb-2">Detalhes da Apuração</h4>
                        {loadingApur && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>}
                        {!loadingApur && apuracao && (
                            <pre className="text-xs bg-slate-50 dark:bg-slate-900/50 p-3 rounded overflow-auto max-h-60">
                                {JSON.stringify(apuracao, null, 2)}
                            </pre>
                        )}
                        {!loadingApur && !apuracao && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {apuracaoMotivo || 'Sem dados de apuração.'}
                            </p>
                        )}
                    </div>

                    {/* Encerramento */}
                    <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-lg p-4">
                        <h4 className="font-medium text-violet-800 dark:text-violet-300 mb-2">Encerramento MIT</h4>
                        <p className="text-sm text-violet-700 dark:text-violet-300 mb-3">
                            Encerrar a apuração antes da transmissão da DCTFWeb. O SERPRO exige a apuração MIT completa; a operação é assíncrona.
                        </p>
                        {encerramentoBloqueado && (
                            <div className={`mb-3 rounded border p-3 text-sm ${
                                estadoEncerramento.encerrada
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                    : 'border-amber-200 bg-amber-50 text-amber-800'
                            }`}>
                                {mensagemBloqueioEncerramento}
                                {estadoEncerramento.situacao !== null && (
                                    <span className="mt-1 block text-xs opacity-75">
                                        Situação MIT SERPRO: {estadoEncerramento.situacao}
                                    </span>
                                )}
                            </div>
                        )}
                        <div className="flex gap-2">
                            <button
                                onClick={handleEncerrar}
                                disabled={loadingEnc || encerramentoBloqueado}
                                className="px-4 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 text-sm"
                            >
                                {botaoEncerrarLabel}
                            </button>
                            <button
                                onClick={() => { carregarApuracao(); carregarHistorico(); }}
                                disabled={loadingRefresh}
                                className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded disabled:opacity-50 text-sm"
                            >
                                {loadingRefresh ? 'Atualizando...' : 'Atualizar MIT'}
                            </button>
                            {status && (
                                <button
                                    onClick={checarStatus}
                                    className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded text-sm"
                                >
                                    Atualizar status
                                </button>
                            )}
                        </div>
                        {status && (
                            <div className="mt-3 text-sm">
                                <p><span className="text-slate-500 dark:text-slate-400">Status:</span> <strong>{status.statusEncerramento}</strong></p>
                                {status.protocolo && (
                                    <p><span className="text-slate-500 dark:text-slate-400">Protocolo:</span> <span className="font-mono text-xs">{status.protocolo}</span></p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Histórico */}
                    <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-4">
                        <h4 className="font-medium text-slate-700 dark:text-slate-200 mb-2">Histórico {declaracao.anoPA}</h4>
                        {loadingHist && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>}
                        {!loadingHist && historico.length === 0 && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma apuração registrada para o ano.</p>
                        )}
                        {!loadingHist && historico.length > 0 && (
                            <pre className="text-xs bg-slate-50 dark:bg-slate-900/50 p-3 rounded overflow-auto max-h-60">
                                {JSON.stringify(historico, null, 2)}
                            </pre>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MitApuracao;
