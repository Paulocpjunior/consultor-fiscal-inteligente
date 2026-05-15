/**
 * components/DCTFWeb/DetalheDeclaracao.tsx
 *
 * Modal de detalhe — 3 tabs (Declaração / Recibo / DARF).
 * PDFs sao lazy (so busca quando tab abrir) pra economizar custo SERPRO.
 */
import React, { useState, useEffect } from 'react';
import type { User, DctfwebDeclaracao, DctfwebDarfResult } from '../../types';
import {
    consultarDeclaracaoCompleta,
    consultarRecibo,
    gerarDarf,
    downloadPdfFromBase64,
    formatPaLabel,
    situacaoLabel,
    situacaoColorClass,
} from '../../services/dctfwebService';

interface Props {
    declaracao: DctfwebDeclaracao;
    user: User | null;
    onClose: () => void;
    onShowToast?: (msg: string) => void;
}

type Tab = 'declaracao' | 'recibo' | 'darf';

const DetalheDeclaracao: React.FC<Props> = ({ declaracao, user, onClose, onShowToast }) => {
    const [tab, setTab] = useState<Tab>('declaracao');
    const [pdfDeclaracao, setPdfDeclaracao] = useState<string | null>(null);
    const [pdfRecibo, setPdfRecibo] = useState<string | null>(null);
    const [darfResult, setDarfResult] = useState<DctfwebDarfResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;
        if (tab === 'declaracao' && pdfDeclaracao === null && declaracao.situacao === 'ATIVA') {
            (async () => {
                setLoading(true); setError(null);
                try {
                    const r = await consultarDeclaracaoCompleta(user, {
                        empresaCnpj: declaracao.empresaCnpj,
                        anoPA: declaracao.anoPA,
                        mesPA: declaracao.mesPA,
                        categoria: declaracao.categoria,
                    });
                    setPdfDeclaracao(r.pdfBase64);
                } catch (err: any) {
                    setError(`Declaração: ${err.message}`);
                } finally { setLoading(false); }
            })();
        }
        if (tab === 'recibo' && pdfRecibo === null && declaracao.situacao === 'ATIVA') {
            (async () => {
                setLoading(true); setError(null);
                try {
                    const r = await consultarRecibo(user, {
                        empresaCnpj: declaracao.empresaCnpj,
                        anoPA: declaracao.anoPA,
                        mesPA: declaracao.mesPA,
                        categoria: declaracao.categoria,
                    });
                    setPdfRecibo(r.pdfBase64);
                } catch (err: any) {
                    setError(`Recibo: ${err.message}`);
                } finally { setLoading(false); }
            })();
        }
    }, [tab, user, declaracao, pdfDeclaracao, pdfRecibo]);

    const handleGerarDarf = async () => {
        if (!user) return;
        if (!confirm(`Gerar DARF para ${declaracao.empresaCnpj} ref ${formatPaLabel(declaracao.anoPA, declaracao.mesPA)}?\n\nCusto SERPRO: ~R$ 0,75`)) return;
        setLoading(true); setError(null);
        try {
            const r = await gerarDarf(user, {
                empresaId: declaracao.empresaId,
                empresaCnpj: declaracao.empresaCnpj,
                anoPA: declaracao.anoPA,
                mesPA: declaracao.mesPA,
                categoria: declaracao.categoria,
                emAndamento: declaracao.situacao === 'EM_ANDAMENTO',
            });
            setDarfResult(r);
            onShowToast?.('DARF gerado.');
        } catch (err: any) {
            setError(`DARF: ${err.message}`);
        } finally { setLoading(false); }
    };

    const renderPdfPreview = (pdfBase64: string | null, filenamePrefix: string) => {
        if (loading) return <div className="text-center text-slate-500 py-12">Carregando...</div>;
        if (!pdfBase64) {
            return (
                <div className="text-center text-slate-500 py-12">
                    {declaracao.situacao !== 'ATIVA'
                        ? 'PDF disponível apenas após transmissão.'
                        : 'Nenhum PDF retornado pelo SERPRO.'}
                </div>
            );
        }
        return (
            <div>
                <iframe
                    src={`data:application/pdf;base64,${pdfBase64}`}
                    className="w-full h-[500px] border rounded"
                    title="PDF"
                />
                <button
                    onClick={() => downloadPdfFromBase64(pdfBase64, `${filenamePrefix}_${declaracao.empresaCnpj}_${declaracao.anoPA}${String(declaracao.mesPA).padStart(2, '0')}.pdf`)}
                    className="mt-2 text-sm px-3 py-1 bg-sky-600 text-white rounded hover:bg-sky-700"
                >
                    Baixar PDF
                </button>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-auto">
                <div className="p-6 border-b">
                    <div className="flex items-start justify-between">
                        <div>
                            <h3 className="text-xl font-semibold text-slate-800">DCTFWeb — Detalhe</h3>
                            <p className="text-sm text-slate-500 mt-1 font-mono">
                                {declaracao.empresaCnpj} · {formatPaLabel(declaracao.anoPA, declaracao.mesPA)} · {declaracao.categoria}
                            </p>
                            <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded ${situacaoColorClass(declaracao.situacao)}`}>
                                {situacaoLabel(declaracao.situacao)}
                            </span>
                        </div>
                        <button onClick={onClose} className="text-slate-500 hover:text-slate-800 text-xl">×</button>
                    </div>

                    <div className="flex gap-1 mt-4 border-b">
                        {(['declaracao', 'recibo', 'darf'] as Tab[]).map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={`px-4 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-sky-600 text-sky-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {t === 'declaracao' ? 'Declaração' : t === 'recibo' ? 'Recibo' : 'DARF'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="p-6">
                    {error && (
                        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded p-3 text-sm mb-4">{error}</div>
                    )}

                    {tab === 'declaracao' && renderPdfPreview(pdfDeclaracao, 'dctfweb_declaracao')}
                    {tab === 'recibo' && renderPdfPreview(pdfRecibo, 'dctfweb_recibo')}

                    {tab === 'darf' && (
                        <div className="space-y-4">
                            {!darfResult && (
                                <div className="bg-amber-50 border border-amber-200 rounded p-4">
                                    <p className="text-sm text-amber-800 mb-3">
                                        Geração de DARF consome ~R$ 0,75 da SERPRO. Apenas para declarações que ainda não tiveram DARF gerado.
                                    </p>
                                    <button
                                        onClick={handleGerarDarf}
                                        disabled={loading}
                                        className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                        {loading ? 'Gerando...' : 'Gerar DARF'}
                                    </button>
                                </div>
                            )}
                            {darfResult && (
                                <div className="bg-white border rounded-lg p-4 space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Valor:</span>
                                        <span className="font-semibold">R$ {darfResult.valor.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Vencimento:</span>
                                        <span>{darfResult.vencimento || '—'}</span>
                                    </div>
                                    <div className="text-xs">
                                        <p className="text-slate-500 mb-1">Código de barras:</p>
                                        <p className="font-mono bg-slate-50 p-2 rounded break-all">
                                            {darfResult.codigoBarras || '—'}
                                        </p>
                                    </div>
                                    {darfResult.pdfBase64 && (
                                        <button
                                            onClick={() => downloadPdfFromBase64(darfResult.pdfBase64, `darf_${declaracao.empresaCnpj}_${declaracao.anoPA}${String(declaracao.mesPA).padStart(2, '0')}.pdf`)}
                                            className="mt-2 text-sm px-3 py-1 bg-sky-600 text-white rounded hover:bg-sky-700"
                                        >
                                            Baixar PDF DARF
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DetalheDeclaracao;
