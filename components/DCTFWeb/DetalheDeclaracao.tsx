/**
 * components/DCTFWeb/DetalheDeclaracao.tsx
 *
 * Modal de detalhe — 3 tabs (Declaração / Recibo / DARF).
 * PDFs sao lazy (so busca quando tab abrir) pra economizar custo SERPRO.
 */
import React, { useState, useEffect, useRef } from 'react';
import type {
    User, DctfwebDeclaracao, DctfwebDarfResult, DctfwebPdfResult,
    DctfwebDarfsSeparadosResult,
} from '../../types';
import {
    consultarDeclaracaoCompleta,
    consultarRecibo,
    gerarDarf,
    gerarDarfsSeparados,
    createPdfObjectUrlFromBase64,
    downloadPdfFromBase64,
    formatPaLabel,
    openPdfFromBase64,
    revokePdfObjectUrl,
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

function formatCurrency(value?: number | null): string {
    if (value == null || !Number.isFinite(value)) return 'Não retornado no resumo';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const PdfPreview: React.FC<{
    pdfBase64: string;
    filename: string;
    title: string;
}> = ({ pdfBase64, filename, title }) => {
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);

    useEffect(() => {
        const url = createPdfObjectUrlFromBase64(pdfBase64);
        setPdfUrl(url);
        return () => revokePdfObjectUrl(url);
    }, [pdfBase64]);

    return (
        <div>
            {pdfUrl ? (
                <iframe
                    src={pdfUrl}
                    className="w-full h-[500px] border rounded"
                    title={title}
                />
            ) : (
                <div className="text-center text-slate-500 py-12">Preparando PDF...</div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
                <button
                    onClick={() => openPdfFromBase64(pdfBase64)}
                    className="text-sm px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-800"
                >
                    Abrir em nova aba
                </button>
                <button
                    onClick={() => downloadPdfFromBase64(pdfBase64, filename)}
                    className="text-sm px-3 py-1 bg-sky-600 text-white rounded hover:bg-sky-700"
                >
                    Baixar PDF
                </button>
            </div>
        </div>
    );
};

const DetalheDeclaracao: React.FC<Props> = ({ declaracao, user, onClose, onShowToast }) => {
    const [tab, setTab] = useState<Tab>('declaracao');
    const [pdfDeclaracao, setPdfDeclaracao] = useState<DctfwebPdfResult | null>(null);
    const [pdfRecibo, setPdfRecibo] = useState<DctfwebPdfResult | null>(null);
    const [darfResult, setDarfResult] = useState<DctfwebDarfResult | null>(null);
    const [darfsSeparados, setDarfsSeparados] = useState<DctfwebDarfsSeparadosResult | null>(null);
    const [loadingSeparados, setLoadingSeparados] = useState(false);
    const [quotasTrimestrais, setQuotasTrimestrais] = useState<1 | 2 | 3>(1);
    // Loadings SEPARADOS por fluxo — um único `loading` fazia a aba Declaração
    // mostrar "Carregando..." enquanto o DARF era gerado, etc. (varredura 09/07).
    const [loadingDeclaracao, setLoadingDeclaracao] = useState(false);
    const [loadingRecibo, setLoadingRecibo] = useState(false);
    const [loadingDarf, setLoadingDarf] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Guarda SÍNCRONA contra fetch duplicado (custo SERPRO): setState de loading
    // é assíncrono, então um re-render antes dele atualizar dispararia 2ª busca.
    // A ref marca "já iniciado" na hora; reseta quando muda a declaração.
    const declKey = `${declaracao.empresaCnpj}_${declaracao.anoPA}_${declaracao.mesPA}_${declaracao.categoria}`;
    const buscadoRef = useRef<{ key: string; decl: boolean; recibo: boolean }>({ key: declKey, decl: false, recibo: false });
    if (buscadoRef.current.key !== declKey) {
        buscadoRef.current = { key: declKey, decl: false, recibo: false };
    }
    const montadoRef = useRef(true);
    useEffect(() => {
        montadoRef.current = true;
        return () => { montadoRef.current = false; };
    }, []);

    useEffect(() => {
        if (!user || declaracao.situacao !== 'ATIVA') return;

        if (tab === 'declaracao' && pdfDeclaracao === null && !buscadoRef.current.decl) {
            buscadoRef.current.decl = true;
            setLoadingDeclaracao(true); setError(null);
            consultarDeclaracaoCompleta(user, {
                empresaCnpj: declaracao.empresaCnpj, anoPA: declaracao.anoPA,
                mesPA: declaracao.mesPA, categoria: declaracao.categoria,
            }).then((r) => { if (montadoRef.current) setPdfDeclaracao(r); })
              .catch((err) => { if (montadoRef.current) { setError(`Declaração: ${err.message}`); buscadoRef.current.decl = false; } })
              .finally(() => { if (montadoRef.current) setLoadingDeclaracao(false); });
        }

        if (tab === 'recibo' && pdfRecibo === null && !buscadoRef.current.recibo) {
            buscadoRef.current.recibo = true;
            setLoadingRecibo(true); setError(null);
            consultarRecibo(user, {
                empresaCnpj: declaracao.empresaCnpj, anoPA: declaracao.anoPA,
                mesPA: declaracao.mesPA, categoria: declaracao.categoria,
            }).then((r) => { if (montadoRef.current) setPdfRecibo(r); })
              .catch((err) => { if (montadoRef.current) { setError(`Recibo: ${err.message}`); buscadoRef.current.recibo = false; } })
              .finally(() => { if (montadoRef.current) setLoadingRecibo(false); });
        }
    }, [tab, user, declKey, pdfDeclaracao, pdfRecibo, declaracao.situacao,
        declaracao.empresaCnpj, declaracao.anoPA, declaracao.mesPA, declaracao.categoria]);

    const handleGerarDarf = async () => {
        if (!user) return;
        if (!confirm(`Gerar DARF para ${declaracao.empresaCnpj} ref ${formatPaLabel(declaracao.anoPA, declaracao.mesPA)}?\n\nCusto SERPRO: ~R$ 0,75`)) return;
        setLoadingDarf(true); setError(null);
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
        } finally { setLoadingDarf(false); }
    };

    const handleGerarDarfsSeparados = async () => {
        if (!user) return;
        const infoQuotas = quotasTrimestrais > 1
            ? `\n\nIRPJ/CSLL trimestrais em ${quotasTrimestrais} quotas — quota 1 no vencimento normal; `
              + 'quotas 2/3 no último dia útil dos meses seguintes, com juros SELIC+1% calculados pelo SICALC.'
            : '';
        if (!confirm(
            `Emitir guias separadas por vencimento para ${declaracao.empresaCnpj} ref ${formatPaLabel(declaracao.anoPA, declaracao.mesPA)}?\n\n`
            + 'Será emitido 1 DARF avulso por tributo da declaração (PIS/COFINS no dia 25 antecipado; '
            + 'IRPJ/CSLL trimestrais no último dia útil do mês seguinte ao trimestre).'
            + infoQuotas
            + '\n\nCusto SERPRO: 1 chamada SICALC por guia + consulta do XML da declaração.'
        )) return;
        setLoadingSeparados(true); setError(null);
        try {
            const r = await gerarDarfsSeparados(user, {
                empresaCnpj: declaracao.empresaCnpj,
                anoPA: declaracao.anoPA,
                mesPA: declaracao.mesPA,
                categoria: declaracao.categoria,
                quotasTrimestrais,
            });
            setDarfsSeparados(r);
            onShowToast?.(`${r.guias.length} guia(s) emitida(s).`);
        } catch (err: any) {
            setError(`Guias separadas: ${err.message}`);
        } finally { setLoadingSeparados(false); }
    };

    const formatDataBr = (iso: string) =>
        /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;

    const renderPdfPreview = (resultado: DctfwebPdfResult | null, filenamePrefix: string, isLoading: boolean) => {
        if (isLoading) return <div className="text-center text-slate-500 py-12">Carregando...</div>;
        if (!resultado?.pdfBase64) {
            const mensagens = (resultado?.mensagens || []).filter(m => m?.texto);
            return (
                <div className="text-center text-slate-500 py-12">
                    <p>
                        {declaracao.situacao !== 'ATIVA'
                            ? 'PDF disponível apenas após transmissão.'
                            : 'Nenhum PDF retornado pelo SERPRO.'}
                    </p>
                    {/* Motivo do SERPRO (sem isso o "vazio" é indiagnosticável) */}
                    {mensagens.length > 0 && (
                        <ul className="mt-3 text-xs text-left inline-block bg-slate-50 border rounded p-3 space-y-1">
                            {mensagens.map((m, i) => (
                                <li key={i} className="font-mono">
                                    {m.codigo ? `${m.codigo} — ` : ''}{m.texto}
                                </li>
                            ))}
                        </ul>
                    )}
                    {mensagens.length === 0 && resultado?._camposRetornados && resultado._camposRetornados.length > 0 && (
                        <p className="mt-3 text-xs font-mono">
                            Campos retornados: {resultado._camposRetornados.join(', ')}
                        </p>
                    )}
                </div>
            );
        }
        const filename = `${filenamePrefix}_${declaracao.empresaCnpj}_${declaracao.anoPA}${String(declaracao.mesPA).padStart(2, '0')}.pdf`;
        return (
            <PdfPreview
                pdfBase64={resultado.pdfBase64}
                filename={filename}
                title={`${filenamePrefix} PDF`}
            />
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

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                        <div className="rounded border bg-slate-50 p-3">
                            <p className="text-xs text-slate-500">Valor do resumo SERPRO</p>
                            <p className="mt-1 font-semibold text-slate-800">{formatCurrency(declaracao.valorTotal)}</p>
                            {declaracao.valorTotal == null && (
                                <p className="mt-1 text-xs text-slate-500">Valide pelo PDF da declaração abaixo.</p>
                            )}
                        </div>
                        <div className="rounded border bg-slate-50 p-3">
                            <p className="text-xs text-slate-500">Recibo</p>
                            <p className="mt-1 font-mono text-xs text-slate-800">{declaracao.numeroRecibo || 'Não informado'}</p>
                        </div>
                        <div className="rounded border bg-slate-50 p-3">
                            <p className="text-xs text-slate-500">Última sincronização</p>
                            <p className="mt-1 text-slate-800">{declaracao.ultimaSincronizacao || 'Não informada'}</p>
                        </div>
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

                    {tab === 'declaracao' && renderPdfPreview(pdfDeclaracao, 'dctfweb_declaracao', loadingDeclaracao)}
                    {tab === 'recibo' && renderPdfPreview(pdfRecibo, 'dctfweb_recibo', loadingRecibo)}

                    {tab === 'darf' && (
                        <div className="space-y-4">
                            {!darfResult && (
                                <div className="bg-amber-50 border border-amber-200 rounded p-4">
                                    <p className="text-sm text-amber-800 mb-3">
                                        Geração de DARF consome ~R$ 0,75 da SERPRO. Apenas para declarações que ainda não tiveram DARF gerado.
                                    </p>
                                    <button
                                        onClick={handleGerarDarf}
                                        disabled={loadingDarf}
                                        className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                        {loadingDarf ? 'Gerando...' : 'Gerar DARF'}
                                    </button>
                                </div>
                            )}
                            {darfResult && (
                                <div className="bg-white border rounded-lg p-4 space-y-2">
                                    {/* O SERPRO (GERARGUIA31) retorna só o PDF do DARF —
                                        valor/vencimento/código de barras constam nele. */}
                                    {darfResult.valor == null && darfResult.pdfBase64 && (
                                        <p className="text-xs text-slate-500 bg-slate-50 border rounded p-2">
                                            O SERPRO retorna o DARF apenas em PDF — valor, vencimento e
                                            código de barras estão no documento abaixo.
                                        </p>
                                    )}
                                    {darfResult.valor != null && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500">Valor:</span>
                                            <span className="font-semibold">R$ {darfResult.valor.toFixed(2)}</span>
                                        </div>
                                    )}
                                    {darfResult.vencimento && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500">Vencimento:</span>
                                            <span>{darfResult.vencimento}</span>
                                        </div>
                                    )}
                                    {darfResult.codigoBarras && (
                                        <div className="text-xs">
                                            <p className="text-slate-500 mb-1">Código de barras:</p>
                                            <p className="font-mono bg-slate-50 p-2 rounded break-all">
                                                {darfResult.codigoBarras}
                                            </p>
                                        </div>
                                    )}
                                    {!darfResult.pdfBase64 && (
                                        <p className="text-sm text-slate-500">
                                            O SERPRO não retornou o PDF do DARF.
                                            {(darfResult.mensagens || []).filter(m => m?.texto).map((m, i) => (
                                                <span key={i} className="block font-mono text-xs mt-1">
                                                    {m.codigo ? `${m.codigo} — ` : ''}{m.texto}
                                                </span>
                                            ))}
                                        </p>
                                    )}
                                    {darfResult.pdfBase64 && (
                                        <div className="flex flex-wrap gap-2 pt-2">
                                            <button
                                                onClick={() => openPdfFromBase64(darfResult.pdfBase64)}
                                                className="text-sm px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-800"
                                            >
                                                Abrir PDF DARF
                                            </button>
                                            <button
                                                onClick={() => downloadPdfFromBase64(darfResult.pdfBase64, `darf_${declaracao.empresaCnpj}_${declaracao.anoPA}${String(declaracao.mesPA).padStart(2, '0')}.pdf`)}
                                                className="text-sm px-3 py-1 bg-sky-600 text-white rounded hover:bg-sky-700"
                                            >
                                                Baixar PDF DARF
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Guias separadas por vencimento: o DARF unificado da
                                DCTFWeb usa o MENOR vencimento entre os débitos —
                                aqui sai 1 DARF avulso por tributo, cada um na
                                SUA data. Só para declarações transmitidas. */}
                            {declaracao.situacao === 'ATIVA' && (
                                <div className="bg-white border rounded-lg p-4 space-y-3">
                                    <div>
                                        <p className="text-sm font-medium text-slate-700">Guias separadas por vencimento</p>
                                        <p className="text-xs text-slate-500 mt-1">
                                            Segue a regra da Receita: cada vencimento gera sua cobrança, com os códigos
                                            daquela data e o total consolidado. O DARF unificado acima junta tudo na data
                                            mais cedo; aqui PIS/COFINS ficam no dia 25 e IRPJ/CSLL trimestrais no fim do mês.
                                        </p>
                                    </div>
                                    {!darfsSeparados && (
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label className="text-sm text-slate-600 flex items-center gap-2">
                                                IRPJ/CSLL trimestrais em:
                                                <select
                                                    value={quotasTrimestrais}
                                                    onChange={(e) => setQuotasTrimestrais(Number(e.target.value) as 1 | 2 | 3)}
                                                    className="border rounded px-2 py-1 text-sm"
                                                >
                                                    <option value={1}>Quota única</option>
                                                    <option value={2}>2 quotas</option>
                                                    <option value={3}>3 quotas</option>
                                                </select>
                                            </label>
                                            <button
                                                onClick={handleGerarDarfsSeparados}
                                                disabled={loadingSeparados}
                                                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 text-sm"
                                            >
                                                {loadingSeparados ? 'Emitindo guias...' : 'Emitir guias separadas'}
                                            </button>
                                            {quotasTrimestrais > 1 && (
                                                <p className="w-full text-xs text-slate-500">
                                                    Quotas valem só para IRPJ/CSLL trimestrais acima de R$ 2.000 (mínimo
                                                    R$ 1.000 por quota — Lei 9.430). Quotas 2 e 3 saem com juros SELIC+1%
                                                    calculados pelo SICALC. PIS/COFINS não têm quota.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    {darfsSeparados && Object.entries(darfsSeparados.grupos)
                                        .sort(([a], [b]) => a.localeCompare(b))
                                        .map(([vencimento, guias]) => {
                                            const totalDia = guias.reduce((s, g) => s + (g.valor || 0), 0);
                                            const comPdf = guias.filter(g => g.pdfBase64);
                                            return (
                                            <div key={vencimento} className="border rounded p-3">
                                                {/* Cabeçalho da data = "Valor Total do Documento" da RFB:
                                                    mesmo vencimento, vários códigos, total consolidado. */}
                                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b">
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-700">
                                                            Cobrança — vencimento {formatDataBr(vencimento)}
                                                        </p>
                                                        <p className="text-xs text-slate-500">
                                                            {guias.length} código(s): {guias.map(g => `${g.codigo}-${g.extensao}`).join(', ')}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-xs text-slate-500">Total a pagar nesta data</p>
                                                        <p className="text-base font-bold text-slate-800">
                                                            R$ {totalDia.toFixed(2)}
                                                        </p>
                                                        {comPdf.length > 1 && (
                                                            <button
                                                                onClick={() => comPdf.forEach(g => downloadPdfFromBase64(
                                                                    g.pdfBase64,
                                                                    `darf_${g.codigo}${g.extensao}${g.cota != null ? `_quota${g.cota}` : ''}_${declaracao.empresaCnpj}_${declaracao.anoPA}${String(declaracao.mesPA).padStart(2, '0')}.pdf`,
                                                                ))}
                                                                className="mt-1 text-xs px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                                                            >
                                                                Baixar as {comPdf.length} guias desta data
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    {guias.map((g, i) => (
                                                        <div key={`${g.codigo}-${i}`} className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 rounded p-2">
                                                            <div className="text-sm">
                                                                <span className="font-mono text-xs text-slate-500 mr-2">{g.codigo}-{g.extensao}</span>
                                                                <span className="text-slate-700">{g.descricao || 'DARF'}</span>
                                                                {g.cota != null && (
                                                                    <span className="ml-2 text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded">
                                                                        quota {g.cota}/{g.totalCotas}
                                                                    </span>
                                                                )}
                                                                <span className="ml-2 font-semibold">
                                                                    R$ {g.valor.toFixed(2)}
                                                                </span>
                                                                {(g.multa > 0 || g.juros > 0) && (
                                                                    <span className="ml-2 text-xs text-amber-700">
                                                                        (principal R$ {g.valorPrincipal.toFixed(2)} + multa/juros)
                                                                    </span>
                                                                )}
                                                                {g.aviso && (
                                                                    <span className="block text-xs text-amber-700 mt-0.5">{g.aviso}</span>
                                                                )}
                                                            </div>
                                                            <div className="flex gap-2">
                                                                {g.pdfBase64 ? (
                                                                    <>
                                                                        <button
                                                                            onClick={() => openPdfFromBase64(g.pdfBase64)}
                                                                            className="text-xs px-2 py-1 bg-slate-700 text-white rounded hover:bg-slate-800"
                                                                        >
                                                                            Abrir PDF
                                                                        </button>
                                                                        <button
                                                                            onClick={() => downloadPdfFromBase64(g.pdfBase64, `darf_${g.codigo}${g.extensao}${g.cota != null ? `_quota${g.cota}` : ''}_${declaracao.empresaCnpj}_${declaracao.anoPA}${String(declaracao.mesPA).padStart(2, '0')}.pdf`)}
                                                                            className="text-xs px-2 py-1 bg-sky-600 text-white rounded hover:bg-sky-700"
                                                                        >
                                                                            Baixar
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <span className="text-xs text-rose-700">
                                                                        Sem PDF{(g.mensagens || []).filter(m => m?.texto).map(m => ` — ${m.codigo ? `${m.codigo}: ` : ''}${m.texto}`).join('')}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            );
                                        })}
                                    {darfsSeparados && darfsSeparados.naoEmitidos.length > 0 && (
                                        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
                                            <p className="font-medium">Débitos não emitidos em guia separada:</p>
                                            {darfsSeparados.naoEmitidos.map((n, i) => (
                                                <p key={i}>
                                                    <span className="font-mono">{n.codigo}-{n.extensao}</span> {n.descricao}
                                                    {' '}(R$ {n.valor.toFixed(2)}) — {n.motivo}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                    {darfsSeparados && (
                                        <p className="text-xs text-slate-500">
                                            Mesmos códigos, períodos e vencimentos da Receita. Como a API do Integra
                                            Contador emite 1 código por DARF comum, cada data traz uma guia por código —
                                            some o total acima e pague as guias da data juntas. Para o DARF único
                                            multi-código (vários códigos num só documento), a emissão é pelo e-CAC da
                                            DCTFWeb. Confira depois no e-CAC a baixa dos débitos.
                                        </p>
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
