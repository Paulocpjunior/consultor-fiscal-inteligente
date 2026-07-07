/**
 * Modal de conferência DCTFWeb × apuração do app.
 *
 * Recebe o detalhamento já calculado (calcularLucro) + empresa + competência,
 * busca a apuração MIT normalizada no backend e mostra as divergências por
 * tributo. Se a MIT não pôde ser lida, mostra aviso honesto — não inventa
 * divergência.
 */
import React, { useEffect, useState } from 'react';
import type { DetalheImposto } from '../../types';
import { conferirDctfweb, type ConferenciaCompleta } from '../../services/dctfwebConferenceService';
import { preencherEncerrarMit, type MitPreencherResult } from '../../services/dctfwebService';

interface Props {
    empresaCnpj: string;
    empresaNome?: string;
    /** id do cadastro (lucro_empresas) — usado no log de auditoria do MIT */
    empresaId?: string;
    competencia: string; // YYYY-MM
    detalhamento: DetalheImposto[];
    onClose: () => void;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const sevCor: Record<string, string> = {
    ok: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300',
    baixa: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300',
    media: 'text-orange-700 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-300',
    alta: 'text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-300',
};

const statusLabel: Record<string, string> = {
    ok: 'OK',
    divergente: 'Divergente',
    'sem-dctfweb': 'Apurado, não declarado',
    'sem-apuracao-app': 'Declarado, sem apuração',
};

const ConferirDctfwebModal: React.FC<Props> = ({ empresaCnpj, empresaNome, empresaId, competencia, detalhamento, onClose }) => {
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [data, setData] = useState<ConferenciaCompleta | null>(null);

    // ── Preenchimento automático do MIT (proposta → confirmação → transmissão)
    const [mitProposta, setMitProposta] = useState<MitPreencherResult | null>(null);
    const [mitPreparando, setMitPreparando] = useState(false);
    const [mitTransmitindo, setMitTransmitindo] = useState(false);
    const [mitResultado, setMitResultado] = useState<MitPreencherResult | null>(null);
    const [mitErro, setMitErro] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setErro(null);
        conferirDctfweb(empresaCnpj, competencia, detalhamento)
            .then(r => { if (alive) setData(r); })
            .catch(e => { if (alive) setErro(e.message || 'Falha na conferência'); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [empresaCnpj, competencia, detalhamento]);

    const [anoPA, mesPA] = competencia.split('-').map(Number);
    const totalApp = data
        ? (['IRPJ', 'CSLL', 'PIS', 'COFINS'] as const).reduce((s, t) => s + (data.tributosApp[t] || 0), 0)
        : 0;
    // Oferece o preenchimento quando o app tem valores e o MIT está sem débitos
    // (não lido por estar vazio OU lido com total zero). O backend revalida tudo.
    const mitSemDebitos = !!data && totalApp > 0 && (
        (!data.mitLido) || (data.resultado ? data.resultado.totalDctfweb === 0 : false)
    );

    const prepararMit = async () => {
        if (!data) return;
        setMitPreparando(true);
        setMitErro(null);
        setMitProposta(null);
        try {
            const r = await preencherEncerrarMit(null, {
                empresaId, empresaCnpj,
                anoPA, mesPA,
                tributosApp: data.tributosApp,
                transmitir: false,
            });
            if (r.ok) setMitProposta(r);
            else setMitErro(r.motivo || 'Não foi possível montar a proposta.');
        } catch (e: any) {
            setMitErro(e?.message || 'Falha ao preparar o preenchimento do MIT.');
        } finally {
            setMitPreparando(false);
        }
    };

    const transmitirMit = async () => {
        if (!data || !mitProposta?.proposta) return;
        const p = mitProposta.proposta;
        const linhas = p.mapeamento.map(m => `${m.familia} (cód. ${m.codigo}): ${brl(m.valor)}`).join('\n');
        if (!confirm(
            `Transmitir o encerramento do MIT ${competencia} de ${empresaNome || empresaCnpj} com os débitos abaixo?\n\n`
            + `${linhas}\n\nTotal: ${brl(p.totalProposto)}\n\n`
            + 'Os valores serão declarados à Receita Federal via SERPRO.'
        )) return;
        setMitTransmitindo(true);
        setMitErro(null);
        try {
            const r = await preencherEncerrarMit(null, {
                empresaId, empresaCnpj,
                anoPA, mesPA,
                tributosApp: data.tributosApp,
                transmitir: true,
            });
            if (r.ok) setMitResultado(r);
            else setMitErro(r.motivo || 'Transmissão não aceita.');
        } catch (e: any) {
            setMitErro(e?.message || 'Falha na transmissão do encerramento.');
        } finally {
            setMitTransmitindo(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-slate-800 dark:text-slate-100">Conferência DCTFWeb × Apuração</h3>
                        <p className="text-xs text-slate-500">{empresaNome || empresaCnpj} · competência {competencia}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
                </div>

                <div className="p-5">
                    {loading && <p className="text-sm text-slate-500 py-8 text-center">Consultando DCTFWeb MIT…</p>}

                    {erro && (
                        <div className="p-3 rounded border border-red-200 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
                            {erro}
                        </div>
                    )}

                    {!loading && !erro && data && !data.mitLido && (
                        <div className="p-3 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-300">
                            <b>DCTFWeb MIT não pôde ser lida para esta competência.</b>
                            <p className="mt-1 text-xs">{data.motivoMit}</p>
                            <p className="mt-2 text-xs text-slate-500">
                                Os tributos apurados pelo app estão abaixo. A comparação só aparece quando o
                                Emissor/SEFIN retorna a apuração MIT. Se isto persistir, o shape do response
                                MIT pode diferir do esperado — rode o serpro-smoke com MIT/LISTAAPURACOES317
                                e consulte o detalhe com MIT/CONSAPURACAO316 usando o idApuracao.
                            </p>
                            <table className="w-full text-xs mt-3">
                                <tbody>
                                    {(['IRPJ', 'CSLL', 'PIS', 'COFINS'] as const).map(t => (
                                        <tr key={t} className="border-t border-amber-200/50">
                                            <td className="py-1">{t} (apurado app)</td>
                                            <td className="py-1 text-right font-mono">{brl(data.tributosApp[t])}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {!loading && !erro && data?.resultado && (
                        <>
                            <div className="flex gap-2 mb-3 text-xs">
                                <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-700">App: <b>{brl(data.resultado.totalApp)}</b></span>
                                <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-700">DCTFWeb: <b>{brl(data.resultado.totalDctfweb)}</b></span>
                                {!data.resultado.temDivergencia
                                    ? <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">✓ Sem divergências</span>
                                    : <span className="px-2 py-1 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                        {data.resultado.resumo.alta} alta · {data.resultado.resumo.media} média · {data.resultado.resumo.baixa} baixa
                                      </span>}
                            </div>

                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                        <th className="py-2">Tributo</th>
                                        <th className="py-2 text-right">App</th>
                                        <th className="py-2 text-right">DCTFWeb</th>
                                        <th className="py-2 text-right">Diferença</th>
                                        <th className="py-2 text-center">Situação</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.resultado.divergencias.map(d => (
                                        <tr key={d.tributo} className="border-b border-slate-100 dark:border-slate-700/50">
                                            <td className="py-2 font-medium">{d.tributo}</td>
                                            <td className="py-2 text-right font-mono">{brl(d.valorApp)}</td>
                                            <td className="py-2 text-right font-mono">{brl(d.valorDctfweb)}</td>
                                            <td className="py-2 text-right font-mono">{d.diferenca === 0 ? '—' : brl(d.diferenca)}{d.diferencaPct !== 0 && <span className="text-[10px] text-slate-400 ml-1">({d.diferencaPct}%)</span>}</td>
                                            <td className="py-2 text-center">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sevCor[d.severidade]}`}>
                                                    {statusLabel[d.status] || d.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {data.outrosDctfweb.length > 0 && (
                                <div className="mt-3 text-xs text-slate-500">
                                    <b>Outros débitos na DCTFWeb</b> (não IRPJ/CSLL/PIS/COFINS — ex: INSS, não cruzados):
                                    <ul className="mt-1 space-y-0.5">
                                        {data.outrosDctfweb.map((o, i) => (
                                            <li key={i} className="font-mono">{o.codigo || '?'} · {o.descricao || '—'} · {brl(o.valor)}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <p className="mt-4 text-[10px] text-slate-400">
                                Cruzamento por família de tributo (IRPJ/CSLL/PIS/COFINS). INSS patronal não é
                                cruzado (o app não calcula INSS). Valores app = soma do detalhamento de
                                calcularLucro; DCTFWeb = apuração MIT normalizada pelo fluxo oficial MIT.
                            </p>
                        </>
                    )}

                    {/* ── Preenchimento automático do MIT ─────────────────────
                        Aparece quando o app apurou valores e o MIT da competência
                        está sem débitos (apuração criada vazia no e-CAC). Fluxo em
                        duas fases: proposta (códigos do mês-modelo × valores do
                        app) → confirmação explícita → transmissão do encerramento. */}
                    {!loading && !erro && data && mitSemDebitos && (
                        <div className="mt-4 p-4 rounded-lg border border-violet-200 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-800">
                            <h4 className="font-bold text-sm text-violet-800 dark:text-violet-300">
                                Preencher MIT com os valores do app
                            </h4>
                            <p className="text-xs text-violet-700 dark:text-violet-300 mt-1">
                                A apuração MIT de {competencia} está sem débitos. O app pode montar os débitos
                                com os valores apurados acima, usando os códigos de débito do último mês desta
                                empresa no MIT, e transmitir o encerramento — com sua confirmação.
                            </p>

                            {mitErro && (
                                <div className="mt-2 p-2 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-300">
                                    {mitErro}
                                </div>
                            )}

                            {mitResultado?.transmitido ? (
                                <div className="mt-3 p-3 rounded border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 text-sm text-emerald-800 dark:text-emerald-300">
                                    <b>✓ Encerramento transmitido.</b>
                                    <p className="text-xs mt-1">
                                        Status: <b>{mitResultado.statusEncerramento || 'PROCESSANDO'}</b>
                                        {mitResultado.protocolo && <> · Protocolo: <span className="font-mono">{mitResultado.protocolo}</span></>}
                                    </p>
                                    <p className="text-[10px] mt-1 opacity-80">
                                        O SERPRO processa o encerramento de forma assíncrona. Acompanhe pelo botão
                                        MIT no Painel DCTFWeb; depois siga com a transmissão da DCTFWeb.
                                    </p>
                                </div>
                            ) : mitProposta?.proposta ? (
                                <div className="mt-3">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-left text-violet-700 dark:text-violet-300 border-b border-violet-200 dark:border-violet-800">
                                                <th className="py-1">Tributo</th>
                                                <th className="py-1">Código de débito</th>
                                                <th className="py-1 text-right">Valor a declarar</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {mitProposta.proposta.mapeamento.map(m => (
                                                <tr key={m.familia} className="border-b border-violet-100 dark:border-violet-900/40">
                                                    <td className="py-1 font-medium">{m.familia}</td>
                                                    <td className="py-1 font-mono">{m.codigo}</td>
                                                    <td className="py-1 text-right font-mono">{brl(m.valor)}</td>
                                                </tr>
                                            ))}
                                            <tr>
                                                <td className="py-1 font-bold" colSpan={2}>Total</td>
                                                <td className="py-1 text-right font-mono font-bold">{brl(mitProposta.proposta.totalProposto)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                    <p className="text-[10px] text-violet-600 dark:text-violet-400 mt-1">
                                        Códigos copiados da apuração {mitProposta.proposta.modeloPeriodo || '—'} desta empresa no MIT.
                                        Confira antes de transmitir — os valores serão declarados à Receita Federal.
                                    </p>
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={transmitirMit}
                                            disabled={mitTransmitindo}
                                            className="px-3 py-1.5 text-xs font-semibold bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
                                        >
                                            {mitTransmitindo ? 'Transmitindo…' : 'Confirmar e transmitir encerramento'}
                                        </button>
                                        <button
                                            onClick={() => { setMitProposta(null); setMitErro(null); }}
                                            disabled={mitTransmitindo}
                                            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-violet-200 dark:border-violet-800 rounded disabled:opacity-50"
                                        >
                                            Cancelar
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={prepararMit}
                                    disabled={mitPreparando}
                                    className="mt-3 px-3 py-1.5 text-xs font-semibold bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
                                >
                                    {mitPreparando ? 'Montando proposta…' : 'Preparar débitos com os valores do app'}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ConferirDctfwebModal;
