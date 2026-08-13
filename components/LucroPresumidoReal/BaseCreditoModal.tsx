import React, { useState } from 'react';
import {
    consultarBaseCredito,
    reprocessarCst,
    type BaseCreditoResposta,
    type BackfillResposta,
} from '../../services/pisCofinsCreditoService';

/**
 * Conferência da BASE DE CRÉDITO de PIS/COFINS contra os documentos.
 *
 * Fica DENTRO da ficha, ao lado de onde a pessoa marca "Crédito PIS/COFINS" nas
 * despesas — é ali que o número é decidido, e ferramenta longe da decisão não é
 * usada.
 *
 * O QUE ELA NÃO FAZ: não altera a ficha. O crédito continua sendo o que o
 * colaborador marcou; esta tela mostra o que os DOCUMENTOS provam, para ele
 * conferir. Sobrescrever aqui seria trocar um número não conferido por outro.
 *
 * Caso de origem: WALDESA (docs/achados-apuracao-piscofins-planilha.md) — a
 * apuração vivia em planilha aplicando 1,65%/7,6% sobre a conta contábil
 * inteira de compras.
 */
interface Props {
    empresaId: string;
    empresaNome: string;
    /** 'AAAA-MM' */
    competencia: string;
    onClose: () => void;
}

const brl = (v?: number | null) =>
    (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const CORES: Record<string, string> = {
    credita: '#059669',
    'nao-credita': '#64748b',
    presumido: '#0284c7',
    indefinido: '#b45309',
};

export const BaseCreditoModal: React.FC<Props> = ({ empresaId, empresaNome, competencia, onClose }) => {
    const [baseUsada, setBaseUsada] = useState('');
    const [dados, setDados] = useState<BaseCreditoResposta | null>(null);
    const [backfill, setBackfill] = useState<BackfillResposta | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const rodar = async (fn: () => Promise<void>) => {
        setCarregando(true); setErro(null);
        try { await fn(); } catch (e: any) { setErro(e?.message || 'Falha inesperada'); }
        finally { setCarregando(false); }
    };

    const conferir = () => rodar(async () => {
        const n = baseUsada.trim() ? Number(baseUsada.replace(/\./g, '').replace(',', '.')) : undefined;
        setDados(await consultarBaseCredito(empresaId, competencia, n));
    });

    const reprocessar = () => rodar(async () => {
        setBackfill(await reprocessarCst(empresaId, [competencia]));
        setDados(await consultarBaseCredito(empresaId, competencia,
            baseUsada.trim() ? Number(baseUsada.replace(/\./g, '').replace(',', '.')) : undefined));
    });

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
            <div className="w-full max-w-3xl rounded-xl bg-white dark:bg-slate-800 shadow-xl my-8 my-auto">
                <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700 p-5">
                    <div>
                        <h3 className="font-bold text-slate-800 dark:text-slate-100">
                            Base de crédito PIS/COFINS — o que os documentos provam
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {empresaNome} · competência {competencia}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                        Esta tela <strong>não altera a ficha</strong>. Ela deriva a base das notas de entrada
                        capturadas, item a item, pelo CST de PIS — e mostra o que credita, o que não credita e
                        o que o documento <strong>não diz</strong>.
                    </p>

                    <div className="flex flex-wrap items-end gap-3">
                        <div>
                            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                Base usada na apuração (opcional)
                            </label>
                            <input
                                value={baseUsada}
                                onChange={(e) => setBaseUsada(e.target.value)}
                                placeholder="ex: 4882290,45"
                                className="w-48 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm"
                            />
                        </div>
                        <button
                            onClick={conferir}
                            disabled={carregando}
                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            🔎 Conferir pelos documentos
                        </button>
                        <button
                            onClick={reprocessar}
                            disabled={carregando}
                            title="Relê os XMLs já guardados para preencher o CST que faltava. Não fala com a SEFAZ e não altera valores já gravados."
                            className="rounded-md border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                        >
                            ♻️ Reprocessar CST dos XMLs
                        </button>
                    </div>

                    {carregando && <p className="text-sm text-slate-500">Processando…</p>}
                    {erro && (
                        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                            {erro}
                        </div>
                    )}

                    {backfill && (
                        <div className="rounded-md border border-slate-200 dark:border-slate-600 p-3 text-xs text-slate-600 dark:text-slate-300">
                            <strong>Reprocessamento:</strong> {backfill.atualizados} documento(s) completado(s)
                            {' '}({backfill.camposPreenchidos} campo(s)) · {backfill.jaCompletos} já estavam completos.
                            {backfill.naoReprocessados > 0 && (
                                <span className="block mt-1 text-amber-700 dark:text-amber-400">
                                    ⚠ {backfill.naoReprocessados} documento(s) não puderam ser relidos
                                    ({backfill.semStoragePath} sem arquivo guardado, {backfill.xmlNaoLido} com XML ilegível).
                                    É por isso que pode sobrar “indefinido” abaixo.
                                </span>
                            )}
                        </div>
                    )}

                    {dados?.semDados && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                            {dados.aviso}
                        </div>
                    )}

                    {dados && !dados.semDados && (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {([
                                    ['Credita (provado)', dados.baseConfirmada, 'credita'],
                                    ['Não credita', dados.baseNaoCredita, 'nao-credita'],
                                    ['Crédito presumido', dados.basePresumido, 'presumido'],
                                    ['Indefinido', dados.baseIndefinida, 'indefinido'],
                                ] as const).map(([rot, val, cor]) => (
                                    <div key={rot} className="rounded-lg border border-slate-200 dark:border-slate-600 p-3">
                                        <div className="text-[10px] uppercase tracking-wide text-slate-500">{rot}</div>
                                        <div className="font-bold text-sm" style={{ color: CORES[cor] }}>{brl(val)}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-lg border border-slate-200 dark:border-slate-600 p-3 text-sm">
                                Crédito sobre a base <strong>provada</strong>:{' '}
                                PIS {brl(dados.creditoPis)} + COFINS {brl(dados.creditoCofins)} ={' '}
                                <strong>{brl(dados.creditoTotal)}</strong>
                                <span className="block text-xs text-slate-500 mt-1">
                                    {dados.documentos} documento(s) de entrada · {dados.totalItens} item(ns) ·{' '}
                                    {dados.itensSemCst} sem CST gravado
                                </span>
                            </div>

                            {!dados.confiavel && (
                                <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                                    <strong>Este número ainda não fecha a apuração.</strong> Há {brl(dados.baseIndefinida)}{' '}
                                    que o documento não permite classificar. Rode “Reprocessar CST dos XMLs” e confira de novo.
                                    “Não sei” nunca entra como crédito.
                                </div>
                            )}

                            {dados.comparacao && (
                                <div className={`rounded-md border-l-4 p-3 text-sm ${
                                    dados.comparacao.leitura === 'bate'
                                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                                        : 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
                                }`}>
                                    <div className="font-semibold">
                                        Base usada {brl(dados.comparacao.baseUsada)} × provada {brl(dados.comparacao.baseConfirmada)}
                                        {' '}→ diferença {brl(dados.comparacao.diferenca)}
                                        {' '}({brl(dados.comparacao.diferencaCredito)} de crédito)
                                    </div>
                                    <div className="mt-1 text-xs">{dados.comparacao.acao}</div>
                                </div>
                            )}

                            {!!dados.porMotivo?.length && (
                                <div>
                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                        Por motivo — a causa junto do número
                                    </h4>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="text-left text-slate-500">
                                                    <th className="py-1">Motivo</th>
                                                    <th className="py-1 text-right">Itens</th>
                                                    <th className="py-1 text-right">Valor</th>
                                                    <th className="py-1">Prova</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {dados.porMotivo.map((m) => (
                                                    <tr key={m.motivo} className="border-t border-slate-100 dark:border-slate-700">
                                                        <td className="py-1" style={{ color: CORES[m.veredito] }}>{m.motivo}</td>
                                                        <td className="py-1 text-right">{m.itens}</td>
                                                        <td className="py-1 text-right font-mono">{brl(m.valor)}</td>
                                                        <td className="py-1">
                                                            {m.prova === 'documento'
                                                                ? <span title="O CST do próprio documento decide">documento</span>
                                                                : <span className="text-amber-600" title="Deduzido de CSOSN/CFOP — prova a negativa, nunca a positiva">indício</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {!!dados.naoIncluido?.length && (
                                <div className="rounded-md border border-slate-200 dark:border-slate-600 p-3">
                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                        O que esta conta NÃO inclui
                                    </h4>
                                    <p className="text-[11px] text-slate-500 mb-2">
                                        Geram crédito e não chegam como documento capturável. A diferença acima pode ser
                                        exatamente isto — não conclua crédito indevido antes de checar.
                                    </p>
                                    <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                                        {dados.naoIncluido.map((n) => (
                                            <li key={n.item}>
                                                <strong>{n.item}</strong> — {n.porque}{' '}
                                                <span className="text-slate-400">({n.baseLegal})</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BaseCreditoModal;
