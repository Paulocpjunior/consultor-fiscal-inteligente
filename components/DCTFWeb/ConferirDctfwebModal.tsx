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
import { preencherEncerrarMit, retificarMit, type MitPreencherResult, type MitRetificarResult } from '../../services/dctfwebService';

interface Props {
    empresaCnpj: string;
    empresaNome?: string;
    /** id do cadastro (lucro_empresas) — usado no log de auditoria do MIT */
    empresaId?: string;
    competencia: string; // YYYY-MM
    detalhamento: DetalheImposto[];
    /** Retificação do MIT é EXCLUSIVA de admin (requisito inegociável 23/07):
     *  o botão só aparece pra admin e o backend revalida o role (403). */
    isAdmin?: boolean;
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

const ConferirDctfwebModal: React.FC<Props> = ({ empresaCnpj, empresaNome, empresaId, competencia, detalhamento, isAdmin, onClose }) => {
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [data, setData] = useState<ConferenciaCompleta | null>(null);

    // ── Preenchimento automático do MIT (proposta → confirmação → transmissão)
    const [mitProposta, setMitProposta] = useState<MitPreencherResult | null>(null);
    const [mitPreparando, setMitPreparando] = useState(false);
    const [mitTransmitindo, setMitTransmitindo] = useState(false);
    const [mitResultado, setMitResultado] = useState<MitPreencherResult | null>(null);
    const [mitErro, setMitErro] = useState<string | null>(null);
    /** Famílias marcadas pra transmitir (pedido do colaborador 03/08: escolher
     *  quais débitos do app vão no MIT deste mês). Nasce com tudo marcado. */
    const [mitSelecao, setMitSelecao] = useState<string[]>([]);

    // ── Retificação (apuração JÁ transmitida, valores mudaram no app — admin)
    const [retProposta, setRetProposta] = useState<MitRetificarResult | null>(null);
    const [retPreparando, setRetPreparando] = useState(false);
    const [retTransmitindo, setRetTransmitindo] = useState(false);
    const [retResultado, setRetResultado] = useState<MitRetificarResult | null>(null);
    const [retErro, setRetErro] = useState<string | null>(null);

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
        ? (['IRPJ', 'CSLL', 'PIS', 'COFINS', 'IPI'] as const).reduce((s, t) => s + (data.tributosApp[t] || 0), 0)
        : 0;
    // Oferece o preenchimento quando o app tem valores e o MIT está sem débitos
    // OU tem família apurada sem débito correspondente (modo complemento —
    // caso PEC PRONTA: PIS/COFINS lançados, IRPJ/CSLL faltando). Débitos já
    // lançados são SEMPRE preservados; o backend revalida tudo.
    const mitPodePreencher = !!data && totalApp > 0 && (
        (!data.mitLido)
        || (data.resultado?.divergencias || []).some(d => d.status === 'sem-dctfweb')
    );

    const totalSelecionado = (mitProposta?.proposta?.mapeamento || [])
        .filter(m => mitSelecao.includes(m.familia))
        .reduce((s, m) => s + (m.valor || 0), 0);

    // Tributo que o PRÓPRIO app marcou como trimestral (o nome da linha traz
    // "(Trimestral…)") numa competência que NÃO encerra trimestre (mar/jun/set/
    // dez). Débito trimestral declarado no PA errado vira cobrança indevida e
    // duplica quando o trimestre fechar de verdade.
    const familiaDoNome = (nome: string): string | null => {
        const n = nome.toUpperCase().trim();
        if (n.startsWith('COFINS')) return 'COFINS';
        if (n.startsWith('PIS')) return 'PIS';
        if (n.startsWith('IRPJ')) return 'IRPJ';
        if (n.startsWith('CSLL')) return 'CSLL';
        if (n.startsWith('IPI')) return 'IPI';
        return null;
    };
    const familiasTrimestrais = new Set(
        (detalhamento || [])
            .filter(d => /\(trimestral/i.test(String(d?.imposto || '')))
            .map(d => familiaDoNome(String(d?.imposto || '')))
            .filter((f): f is string => !!f),
    );
    const mesFechaTrimestre = mesPA % 3 === 0;
    const alertaTrimestral = !mesFechaTrimestre
        && (mitProposta?.proposta?.mapeamento || []).some(m => familiasTrimestrais.has(m.familia));

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
            // transmitir=false nunca dispara a trava (é só conferência).
            if ('travaInsumos' in r) return;
            if (r.ok) {
                setMitProposta(r);
                setMitSelecao((r.proposta?.mapeamento || []).map(m => m.familia));
            } else setMitErro(r.motivo || 'Não foi possível montar a proposta.');
        } catch (e: any) {
            setMitErro(e?.message || 'Falha ao preparar o preenchimento do MIT.');
        } finally {
            setMitPreparando(false);
        }
    };

    // Retificação em duas fases: proposta (antes → depois por tributo) →
    // confirmação explícita → reencerramento. A oferta aparece quando o MIT
    // foi LIDO e há divergência — o backend decide se a apuração está mesmo
    // ENCERRADA (senão devolve o motivo e orienta o fluxo normal).
    const retPodeOferecer = !!isAdmin && !!data?.mitLido && !!data?.resultado?.temDivergencia;

    const prepararRetificacao = async () => {
        if (!data) return;
        setRetPreparando(true);
        setRetErro(null);
        setRetProposta(null);
        try {
            const r = await retificarMit(null, {
                empresaId, empresaCnpj,
                anoPA, mesPA,
                tributosApp: data.tributosApp,
                transmitir: false,
            });
            if (r.ok) setRetProposta(r);
            else setRetErro(r.motivo || 'Não foi possível montar a retificação.');
        } catch (e: any) {
            setRetErro(e?.message || 'Falha ao preparar a retificação.');
        } finally {
            setRetPreparando(false);
        }
    };

    const transmitirRetificacao = async () => {
        if (!data || !retProposta?.proposta) return;
        const p = retProposta.proposta;
        const linhas = p.mapeamento
            .map(m => `${m.familia}: ${brl(m.antes)} → ${brl(m.depois)}${m.acao === 'mantido' ? ' (mantido)' : ` (${m.diferenca > 0 ? '+' : ''}${brl(m.diferenca)})`}`)
            .join('\n');
        if (!confirm(
            `RETIFICAR o MIT ${competencia} de ${empresaNome || empresaCnpj}?\n\n`
            + `${linhas}\n\nTotal: ${brl(p.totalAntes)} → ${brl(p.totalDepois)}\n\n`
            + 'A apuração será REENCERRADA com os valores acima e a Receita Federal '
            + 'gerará automaticamente a DCTFWeb RETIFICADORA. Esta ação é registrada em auditoria.'
        )) return;
        setRetTransmitindo(true);
        setRetErro(null);
        try {
            const r = await retificarMit(null, {
                empresaId, empresaCnpj,
                anoPA, mesPA,
                tributosApp: data.tributosApp,
                transmitir: true,
            });
            if (r.ok) setRetResultado(r);
            else setRetErro(r.motivo || 'Retificação não aceita.');
        } catch (e: any) {
            setRetErro(e?.message || 'Falha na transmissão da retificação.');
        } finally {
            setRetTransmitindo(false);
        }
    };

    const transmitirMit = async () => {
        if (!data || !mitProposta?.proposta) return;
        const p = mitProposta.proposta;
        const selecionados = p.mapeamento.filter(m => mitSelecao.includes(m.familia));
        if (selecionados.length === 0) {
            setMitErro('Marque ao menos um débito para transmitir.');
            return;
        }
        const linhas = selecionados.map(m => `${m.familia} (cód. ${m.codigo}): ${brl(m.valor)}`).join('\n');
        const desmarcados = p.mapeamento.filter(m => !mitSelecao.includes(m.familia));
        const foraDaTransmissao = desmarcados.length > 0
            ? `\n\nNÃO serão transmitidos (desmarcados): ${desmarcados.map(m => `${m.familia} ${brl(m.valor)}`).join(', ')}`
            : '';
        const preservados = (p.jaDeclarados || []).length > 0
            ? `\n\nJá lançados no MIT (preservados): ${(p.jaDeclarados || []).map(j => `${j.familia} ${brl(j.valor)}`).join(', ')}`
            : '';
        const criacao = p.modo === 'criacao'
            ? `\n\nA apuração ${competencia} NÃO existe no MIT — será CRIADA e encerrada com os dados iniciais copiados de ${p.modeloPeriodo || 'mês anterior'}.`
            : '';
        if (!confirm(
            `Transmitir o encerramento do MIT ${competencia} de ${empresaNome || empresaCnpj} com os débitos abaixo?\n\n`
            + `${linhas}\n\nTotal a adicionar: ${brl(totalSelecionado)}${foraDaTransmissao}${preservados}${criacao}\n\n`
            + 'Os valores serão declarados à Receita Federal via SERPRO.'
        )) return;
        await executarEncerramento(false);
    };

    // A trava de insumos (Paulo, 10/08) devolve 409 quando um insumo de OUTRO
    // departamento (eSocial do DP, Reinf do Contábil) está pendente. Aí a
    // pessoa vê o que falta e decide: confirmar mesmo assim fica AUDITADO.
    const executarEncerramento = async (confirmarInsumosPendentes: boolean) => {
        setMitTransmitindo(true);
        setMitErro(null);
        try {
            const r = await preencherEncerrarMit(null, {
                empresaId, empresaCnpj,
                anoPA, mesPA,
                tributosApp: data!.tributosApp,
                familiasSelecionadas: mitSelecao,
                transmitir: true,
                confirmarInsumosPendentes,
            });
            if ('travaInsumos' in r) {
                const t = r.travaInsumos;
                const pend = t.selos.filter(s => s.estado === 'pendente')
                    .map(s => `• ${s.rotulo}: ${s.detalhe}`).join('\n');
                const seguir = confirm(
                    `⚠ INSUMO PENDENTE — encerrar a DCTFWeb agora vira retificação depois.\n\n`
                    + `${t.frase}\n\n${pend}\n\n`
                    + 'Confirmar o encerramento MESMO ASSIM? Fica registrado que você seguiu com pendência.'
                );
                if (seguir) { await executarEncerramento(true); return; }
                setMitErro('Encerramento não realizado — confira os insumos pendentes com o departamento responsável.');
                return;
            }
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
                        <p className="text-xs text-slate-500 dark:text-slate-400">{empresaNome || empresaCnpj} · competência {competencia}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none">×</button>
                </div>

                <div className="p-5">
                    {loading && <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">Consultando DCTFWeb MIT…</p>}

                    {erro && (
                        <div className="p-3 rounded border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
                            {erro}
                        </div>
                    )}

                    {!loading && !erro && data && !data.mitLido && (
                        <div className="p-3 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-300">
                            <b>DCTFWeb MIT não pôde ser lida para esta competência.</b>
                            <p className="mt-1 text-xs">{data.motivoMit}</p>
                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                Os tributos apurados pelo app estão abaixo. A comparação só aparece quando o
                                Emissor/SEFIN retorna a apuração MIT. Se isto persistir, o shape do response
                                MIT pode diferir do esperado — rode o serpro-smoke com MIT/LISTAAPURACOES317
                                e consulte o detalhe com MIT/CONSAPURACAO316 usando o idApuracao.
                            </p>
                            <table className="w-full text-xs mt-3">
                                <tbody>
                                    {(['IRPJ', 'CSLL', 'PIS', 'COFINS', 'IPI'] as const).map(t => (
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
                                    ? <span className="px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">✓ Sem divergências</span>
                                    : <span className="px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                        {data.resultado.resumo.alta} alta · {data.resultado.resumo.media} média · {data.resultado.resumo.baixa} baixa
                                      </span>}
                            </div>

                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
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
                                            <td className="py-2 text-right font-mono">{d.diferenca === 0 ? '—' : brl(d.diferenca)}{d.diferencaPct !== 0 && <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-1">({d.diferencaPct}%)</span>}</td>
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
                                <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                                    <b>Outros débitos na DCTFWeb</b> (não IRPJ/CSLL/PIS/COFINS/IPI — ex: INSS, não cruzados):
                                    <ul className="mt-1 space-y-0.5">
                                        {data.outrosDctfweb.map((o, i) => (
                                            <li key={i} className="font-mono">{o.codigo || '?'} · {o.descricao || '—'} · {brl(o.valor)}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <p className="mt-4 text-[10px] text-slate-400 dark:text-slate-500">
                                Cruzamento por família de tributo (IRPJ/CSLL/PIS/COFINS/IPI). INSS patronal não é
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
                    {!loading && !erro && data && mitPodePreencher && (
                        <div className="mt-4 p-4 rounded-lg border border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-800">
                            <h4 className="font-bold text-sm text-violet-800 dark:text-violet-300">
                                Preencher MIT com os valores do app
                            </h4>
                            <p className="text-xs text-violet-700 dark:text-violet-300 mt-1">
                                Há tributo apurado no app sem débito correspondente no MIT de {competencia}. O app
                                pode montar os débitos faltantes com os valores acima (códigos copiados do último
                                mês desta empresa no MIT), <b>preservando os débitos já lançados</b>, e transmitir
                                o encerramento — com sua confirmação.
                            </p>

                            {mitErro && (
                                <div className="mt-2 p-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-300">
                                    {mitErro}
                                </div>
                            )}

                            {mitResultado?.transmitido ? (
                                <div className="mt-3 p-3 rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-sm text-emerald-800 dark:text-emerald-300">
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
                                    {mitProposta.proposta.modo === 'criacao' && (
                                        <div className="mb-2 p-2 rounded border border-violet-300 dark:border-violet-700 bg-white/60 dark:bg-slate-800/40 text-xs text-violet-800 dark:text-violet-300">
                                            <b>A apuração {competencia} não existe no MIT — será criada e encerrada agora.</b>{' '}
                                            Dados iniciais copiados de {mitProposta.proposta.modeloPeriodo || '—'}
                                            {mitProposta.proposta.dadosIniciaisResumo && (
                                                <> (qualificação PJ {mitProposta.proposta.dadosIniciaisResumo.qualificacaoPj ?? '—'} ·
                                                tributação {mitProposta.proposta.dadosIniciaisResumo.tributacaoLucro ?? '—'} ·
                                                responsável CPF {mitProposta.proposta.dadosIniciaisResumo.cpfResponsavel || '—'})</>
                                            )}.
                                        </div>
                                    )}
                                    {alertaTrimestral && (
                                        <div className="mb-2 p-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-300">
                                            <b>A competência {competencia} não encerra trimestre.</b> A apuração do app
                                            traz IRPJ/CSLL como <b>trimestrais</b> — esses débitos pertencem ao MIT do mês
                                            de fechamento (março/junho/setembro/dezembro), não a este. Desmarque-os aqui
                                            se está declarando apenas os tributos do mês.
                                        </div>
                                    )}
                                    <p className="text-[10px] text-violet-700 dark:text-violet-300 mb-1">
                                        Marque o que entra <b>nesta</b> transmissão — o desmarcado não é declarado agora
                                        e continua disponível na próxima conferência.
                                    </p>
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-left text-violet-700 dark:text-violet-300 border-b border-violet-200 dark:border-violet-700 dark:border-violet-800">
                                                <th className="py-1 w-6">✓</th>
                                                <th className="py-1">Tributo</th>
                                                <th className="py-1">Código de débito</th>
                                                <th className="py-1 text-right">Valor a adicionar</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {mitProposta.proposta.mapeamento.map(m => {
                                                const marcado = mitSelecao.includes(m.familia);
                                                return (
                                                    <tr key={m.familia} className={`border-b border-violet-100 dark:border-violet-900/40 ${marcado ? '' : 'opacity-50'}`}>
                                                        <td className="py-1">
                                                            <input
                                                                type="checkbox"
                                                                checked={marcado}
                                                                onChange={() => setMitSelecao(prev => marcado
                                                                    ? prev.filter(f => f !== m.familia)
                                                                    : [...prev, m.familia])}
                                                                aria-label={`Transmitir ${m.familia}`}
                                                                className="accent-violet-600"
                                                            />
                                                        </td>
                                                        <td className="py-1 font-medium">
                                                            {m.familia}
                                                            {familiasTrimestrais.has(m.familia) && !mesFechaTrimestre && (
                                                                <span className="ml-1 text-[9px] text-amber-600 dark:text-amber-400">(trimestral)</span>
                                                            )}
                                                        </td>
                                                        <td className="py-1 font-mono">{m.codigo}</td>
                                                        <td className={`py-1 text-right font-mono ${marcado ? '' : 'line-through'}`}>{brl(m.valor)}</td>
                                                    </tr>
                                                );
                                            })}
                                            <tr>
                                                <td className="py-1 font-bold" colSpan={3}>Total a adicionar (selecionado)</td>
                                                <td className="py-1 text-right font-mono font-bold">{brl(totalSelecionado)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                    {totalSelecionado !== mitProposta.proposta.totalProposto && (
                                        <p className="text-[10px] text-amber-700 dark:text-amber-300 dark:text-amber-400 mt-1">
                                            Transmissão parcial: {brl(mitProposta.proposta.totalProposto - totalSelecionado)} em
                                            débitos ficam de fora desta apuração.
                                        </p>
                                    )}
                                    {(mitProposta.proposta.jaDeclarados || []).length > 0 && (
                                        <p className="text-[10px] text-violet-700 dark:text-violet-300 mt-1">
                                            Já lançados no MIT e <b>preservados sem alteração</b>: {(mitProposta.proposta.jaDeclarados || [])
                                                .map(j => `${j.familia} ${brl(j.valor)}`).join(' · ')}
                                        </p>
                                    )}
                                    {(mitProposta.proposta as any).ipiDiag && (
                                        <details className="mt-2 text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 dark:border-amber-800 rounded p-2">
                                            <summary className="cursor-pointer font-semibold">
                                                IPI · diagnóstico do estabelecimento (envie print se o SERPRO recusar)
                                            </summary>
                                            <div className="mt-1">
                                                CNPJ estab. enviado: <b className="font-mono">{(mitProposta.proposta as any).ipiDiag.cnpjEstabEnviado || '—'}</b>
                                                {' '}· fonte: <b>{(mitProposta.proposta as any).ipiDiag.fonteCnpjEstab || '—'}</b>
                                                {' '}· modelo: {(mitProposta.proposta as any).ipiDiag.modeloPeriodo || '—'}
                                            </div>
                                            <pre className="mt-1 whitespace-pre-wrap break-all text-[9px] leading-tight">
{JSON.stringify({
    modeloIpiRaw: (mitProposta.proposta as any).ipiDiag.modeloIpiRaw,
    modeloDebitosNumeracao: (mitProposta.proposta as any).ipiDiag.modeloDebitosNumeracao,
    debitosEnviadosNumeracao: (mitProposta.proposta as any).ipiDiag.debitosEnviadosNumeracao,
    modeloDadosIniciais: (mitProposta.proposta as any).ipiDiag.modeloDadosIniciais,
}, null, 1)}
                                            </pre>
                                        </details>
                                    )}
                                    <p className="text-[10px] text-violet-600 dark:text-violet-400 mt-1">
                                        Códigos copiados da apuração {mitProposta.proposta.modeloPeriodo || '—'} desta empresa no MIT.
                                        Confira antes de transmitir — os valores serão declarados à Receita Federal.
                                    </p>
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={transmitirMit}
                                            disabled={mitTransmitindo || mitSelecao.length === 0}
                                            className="px-3 py-1.5 text-xs font-semibold bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
                                        >
                                            {mitTransmitindo ? 'Transmitindo…' : 'Confirmar e transmitir encerramento'}
                                        </button>
                                        <button
                                            onClick={() => { setMitProposta(null); setMitErro(null); }}
                                            disabled={mitTransmitindo}
                                            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-800 dark:bg-slate-700 border border-violet-200 dark:border-violet-700 dark:border-violet-800 rounded disabled:opacity-50"
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

                    {/* ── Retificação (ADMIN) ─────────────────────────────────
                        Apuração JÁ transmitida cujos valores mudaram no app
                        (caso CLINICA MANTOAN 06/2026: aplicações financeiras
                        lançadas depois). Reencerra o MIT (ENCAPURACAO314) e a
                        Receita gera a DCTFWeb RETIFICADORA automaticamente.
                        Botão só para admin; backend exige role admin (403). */}
                    {!loading && !erro && data && retPodeOferecer && (
                        <div className="mt-4 p-4 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800">
                            <h4 className="font-bold text-sm text-rose-800 dark:text-rose-300">
                                Retificar com os valores do app <span className="text-[10px] font-normal">(admin)</span>
                            </h4>
                            <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
                                Se a apuração de {competencia} <b>já foi transmitida</b> e os valores mudaram no app
                                (ex.: aplicações financeiras lançadas depois), o app reencerra o MIT com os débitos
                                ajustados e a Receita gera a <b>DCTFWeb retificadora automaticamente</b>. Débitos de
                                tributos que o app não apura são preservados.
                            </p>

                            {retErro && (
                                <div className="mt-2 p-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-300">
                                    {retErro}
                                </div>
                            )}

                            {retResultado?.transmitido ? (
                                <div className="mt-3 p-3 rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-sm text-emerald-800 dark:text-emerald-300">
                                    <b>✓ Retificação transmitida.</b>
                                    <p className="text-xs mt-1">
                                        Status: <b>{retResultado.statusEncerramento || 'PROCESSANDO'}</b>
                                        {retResultado.protocolo && <> · Protocolo: <span className="font-mono">{retResultado.protocolo}</span></>}
                                    </p>
                                    <p className="text-[10px] mt-1 opacity-80">
                                        O SERPRO processa o reencerramento de forma assíncrona e a Receita gera a
                                        DCTFWeb retificadora na sequência. Acompanhe pelo botão MIT no Painel DCTFWeb.
                                    </p>
                                </div>
                            ) : retProposta?.proposta ? (
                                <div className="mt-3">
                                    {/* PREVIEW OBRIGATÓRIO antes → depois, tributo a tributo. */}
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-left text-rose-700 dark:text-rose-300 border-b border-rose-200 dark:border-rose-800">
                                                <th className="py-1">Tributo</th>
                                                <th className="py-1">Código</th>
                                                <th className="py-1 text-right">Antes (MIT)</th>
                                                <th className="py-1 text-right">Depois (app)</th>
                                                <th className="py-1 text-right">Diferença</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {retProposta.proposta.mapeamento.map(m => (
                                                <tr key={m.familia} className="border-b border-rose-100 dark:border-rose-900/40">
                                                    <td className="py-1 font-medium">
                                                        {m.familia}
                                                        {m.acao === 'mantido' && <span className="ml-1 text-[9px] text-slate-400 dark:text-slate-500">(mantido)</span>}
                                                        {m.acao === 'incluido' && <span className="ml-1 text-[9px] text-rose-500">(novo)</span>}
                                                    </td>
                                                    <td className="py-1 font-mono">{m.codigo}</td>
                                                    <td className="py-1 text-right font-mono">{brl(m.antes)}</td>
                                                    <td className="py-1 text-right font-mono font-bold">{brl(m.depois)}</td>
                                                    <td className={`py-1 text-right font-mono ${m.diferenca > 0 ? 'text-rose-700 dark:text-rose-300' : m.diferenca < 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400'}`}>
                                                        {m.diferenca === 0 ? '—' : `${m.diferenca > 0 ? '+' : ''}${brl(m.diferenca)}`}
                                                    </td>
                                                </tr>
                                            ))}
                                            <tr>
                                                <td className="py-1 font-bold" colSpan={2}>Total</td>
                                                <td className="py-1 text-right font-mono font-bold">{brl(retProposta.proposta.totalAntes)}</td>
                                                <td className="py-1 text-right font-mono font-bold">{brl(retProposta.proposta.totalDepois)}</td>
                                                <td className="py-1 text-right font-mono font-bold">
                                                    {`${retProposta.proposta.totalDepois - retProposta.proposta.totalAntes > 0 ? '+' : ''}${brl(retProposta.proposta.totalDepois - retProposta.proposta.totalAntes)}`}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                    <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1">
                                        Confira ANTES de transmitir — o reencerramento substitui os débitos na Receita
                                        Federal e gera a DCTFWeb retificadora. A ação fica registrada em auditoria
                                        (quem, quando, antes → depois).
                                    </p>
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={transmitirRetificacao}
                                            disabled={retTransmitindo}
                                            className="px-3 py-1.5 text-xs font-semibold bg-rose-600 text-white rounded hover:bg-rose-700 disabled:opacity-50"
                                        >
                                            {retTransmitindo ? 'Transmitindo…' : 'Confirmar e transmitir retificação'}
                                        </button>
                                        <button
                                            onClick={() => { setRetProposta(null); setRetErro(null); }}
                                            disabled={retTransmitindo}
                                            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-800 dark:bg-slate-700 border border-rose-200 dark:border-rose-800 rounded disabled:opacity-50"
                                        >
                                            Cancelar
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={prepararRetificacao}
                                    disabled={retPreparando}
                                    className="mt-3 px-3 py-1.5 text-xs font-semibold bg-rose-600 text-white rounded hover:bg-rose-700 disabled:opacity-50"
                                >
                                    {retPreparando ? 'Montando antes → depois…' : 'Preparar retificação (preview obrigatório)'}
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
