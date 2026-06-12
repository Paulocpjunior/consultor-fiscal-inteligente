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

interface Props {
    declaracao: DctfwebDeclaracao;
    user: User | null;
    onClose: () => void;
    onShowToast?: (msg: string) => void;
}

function pickDadosApuracaoMit(input: any): any | null {
    if (!input || typeof input !== 'object') return null;
    if (input.PeriodoApuracao) return input;
    const direct = input.dadosApuracaoMit ?? input.dadosApuracaoMIT ?? input.DadosApuracaoMit ?? input.DadosApuracaoMIT;
    if (Array.isArray(direct)) return direct[0] || null;
    if (direct && typeof direct === 'object') return direct;
    const nested = input.apuracaoMit ?? input.apuracao ?? input.dados;
    return nested && nested !== input ? pickDadosApuracaoMit(nested) : null;
}

function isDadosApuracaoMitCompleta(input: any): boolean {
    const payload = pickDadosApuracaoMit(input);
    if (!payload) return false;
    const dadosIniciais = payload.DadosIniciais || payload.dadosIniciais;
    if (!dadosIniciais) return false;
    const semMovimento = dadosIniciais.SemMovimento ?? dadosIniciais.semMovimento;
    if (semMovimento === true || semMovimento === 'true') return true;
    return !!(payload.Debitos || payload.debitos);
}

function situacaoMitBloqueiaEncerramento(apuracao: any, resumo: any): boolean {
    const situacao = Number(
        resumo?.situacao
        ?? resumo?.situacaoApuracao
        ?? apuracao?.situacaoApuracao
        ?? apuracao?.SituacaoApuracao
    );
    return situacao === 3 || situacao === 4;
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
        if (!isDadosApuracaoMitCompleta(apuracao)) {
            setError('Encerrar: não há apuração MIT completa carregada para transmitir. Primeiro gere/importe a apuração MIT com DadosIniciais e débitos.');
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

    const dadosApuracaoMitCompleta = isDadosApuracaoMitCompleta(apuracao);
    const encerramentoBloqueado = !dadosApuracaoMitCompleta || situacaoMitBloqueiaEncerramento(apuracao, apuracaoResumo);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto">
                <div className="p-6 border-b">
                    <div className="flex items-start justify-between">
                        <div>
                            <h3 className="text-xl font-semibold text-slate-800">Apuração MIT</h3>
                            <p className="text-sm text-slate-500 mt-1 font-mono">
                                {declaracao.empresaCnpj} · {formatPaLabel(declaracao.anoPA, declaracao.mesPA)}
                            </p>
                        </div>
                        <button onClick={onClose} className="text-slate-500 hover:text-slate-800 text-xl">×</button>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {error && (
                        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded p-3 text-sm">{error}</div>
                    )}

                    {/* Apuração */}
                    <div className="bg-white border rounded-lg p-4">
                        <h4 className="font-medium text-slate-700 mb-2">Detalhes da Apuração</h4>
                        {loadingApur && <p className="text-sm text-slate-500">Carregando...</p>}
                        {!loadingApur && apuracao && (
                            <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-60">
                                {JSON.stringify(apuracao, null, 2)}
                            </pre>
                        )}
                        {!loadingApur && !apuracao && (
                            <p className="text-sm text-slate-500">
                                {apuracaoMotivo || 'Sem dados de apuração.'}
                            </p>
                        )}
                    </div>

                    {/* Encerramento */}
                    <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
                        <h4 className="font-medium text-violet-800 mb-2">Encerramento MIT</h4>
                        <p className="text-sm text-violet-700 mb-3">
                            Encerrar a apuração antes da transmissão da DCTFWeb. O SERPRO exige a apuração MIT completa; a operação é assíncrona.
                        </p>
                        {encerramentoBloqueado && (
                            <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                                {!dadosApuracaoMitCompleta
                                    ? 'Encerramento indisponível: não há payload MIT completo para esta competência.'
                                    : 'Encerramento indisponível: a apuração já está encerrada ou em processamento.'}
                            </div>
                        )}
                        <div className="flex gap-2">
                            <button
                                onClick={handleEncerrar}
                                disabled={loadingEnc || encerramentoBloqueado}
                                className="px-4 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 text-sm"
                            >
                                {loadingEnc ? 'Encerrando...' : 'Encerrar Apuração'}
                            </button>
                            {status && (
                                <button
                                    onClick={checarStatus}
                                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm"
                                >
                                    Atualizar status
                                </button>
                            )}
                        </div>
                        {status && (
                            <div className="mt-3 text-sm">
                                <p><span className="text-slate-500">Status:</span> <strong>{status.statusEncerramento}</strong></p>
                                {status.protocolo && (
                                    <p><span className="text-slate-500">Protocolo:</span> <span className="font-mono text-xs">{status.protocolo}</span></p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Histórico */}
                    <div className="bg-white border rounded-lg p-4">
                        <h4 className="font-medium text-slate-700 mb-2">Histórico {declaracao.anoPA}</h4>
                        {loadingHist && <p className="text-sm text-slate-500">Carregando...</p>}
                        {!loadingHist && historico.length === 0 && (
                            <p className="text-sm text-slate-500">Nenhuma apuração registrada para o ano.</p>
                        )}
                        {!loadingHist && historico.length > 0 && (
                            <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-60">
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
