/**
 * QuotasDoMesPanel — as quotas do IRPJ/CSLL trimestral que se GERAM neste mês.
 *
 * Paulo, 13/08: *"as cotas devem ser enviadas todos os meses pois sofrem
 * atualização da SELIC"*.
 *
 * ═══ POR QUE ESTA TELA PRECISA EXISTIR ══════════════════════════════════════
 *
 * Até hoje, escolher "3 cotas" emitia as TRÊS no mesmo clique. Duas coisas
 * quebravam de uma vez:
 *
 *   1. a quota 3 saía A MENOR — o acréscimo dela é SELIC acumulada até o mês
 *      anterior ao pagamento + 1% (Lei 9.430 art. 5º §3º), e essa SELIC ainda
 *      não tinha sido publicada no dia da emissão;
 *   2. as guias 2 e 3 ficavam na mão de quem clicou, para vencer dali a um e
 *      dois meses — sem nada no app cobrando o envio.
 *
 * Agora a quota nasce no MÊS dela, e é aqui que ela aparece. Guia gerada aqui
 * já sai com o número certo, porque quem calcula é o SICALC na data de hoje.
 *
 * ═══ ATRASADA NÃO SOME ══════════════════════════════════════════════════════
 *
 * A lista traz `mesRef <= mês pedido`, então quota que ninguém emitiu continua
 * aparecendo depois que o mês vira — é justamente ela que está gerando multa.
 * Sumir no dia 1º seria o farol mentindo no pior momento.
 */
import { useEmpresaAtiva } from '../../services/empresaAtivaContext';
import React, { useCallback, useEffect, useState } from 'react';
import type { User, DctfwebQuotaAgendada } from '../../types';
import { listarQuotasAgendadas, emitirQuotaAgendada, downloadPdfFromBase64, openPdfFromBase64 } from '../../services/dctfwebService';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

const brl = (n?: number | null) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso?: string | null) =>
    iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso || '—');
const fmtCnpj = (c?: string) => {
    const d = String(c || '').replace(/\D/g, '').padStart(14, '0');
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

type Emitida = DctfwebQuotaAgendada & {
    valor: number; juros: number; multa: number; numeroDocumento: string; codigoBarras: string; pdfBase64: string;
};

const QuotasDoMesPanel: React.FC<Props> = ({ currentUser, onShowToast }) => {
    // VER a carteira é livre; EMITIR exige que a empresa da linha seja a ATIVA
    // (Paulo, 15/08 — caso EXPERTE×FASTWELD na Varredura IPI; e ninguém emite
    // em série: guia sai UMA A UMA com preview, regra de 28/07). A linha de
    // outra empresa não ganha botão de emissão: ganha o caminho de ativar.
    const { empresa: empresaAtivaSessao, trocar: trocarEmpresaSessao } = useEmpresaAtiva();
    const ehDaAtiva = (cnpj: string | undefined) =>
        !!empresaAtivaSessao && String(cnpj || '').replace(/\D/g, '') === empresaAtivaSessao.cnpj;
    const [quotas, setQuotas] = useState<DctfwebQuotaAgendada[]>([]);
    const [atrasadas, setAtrasadas] = useState(0);
    // ATÉ A VISÃO é da ativa (regra reafirmada na Varredura IPI): dentro de
    // módulo por-cliente a lista responde pelo cliente da sessão. O que fica
    // de fora vai CONTADO — e cota ATRASADA de outra empresa GRITA na
    // contagem, porque some-em-silêncio sobre multa correndo é o pior calar.
    const cotasDaTela = empresaAtivaSessao ? quotas.filter(q => ehDaAtiva(q.empresaCnpj)) : quotas;
    const foraDaAtiva = quotas.length - cotasDaTela.length;
    const atrasadasFora = empresaAtivaSessao ? quotas.filter(q => !ehDaAtiva(q.empresaCnpj) && q.atrasada).length : 0;

    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [emitindo, setEmitindo] = useState<string | null>(null);
    const [emitidas, setEmitidas] = useState<Record<string, Emitida>>({});

    const carregar = useCallback(async () => {
        setCarregando(true); setErro(null);
        try {
            const r = await listarQuotasAgendadas(currentUser);
            setQuotas(r.quotas || []);
            setAtrasadas(r.atrasadas || 0);
        } catch (e: any) {
            setErro(e.message || 'Falha ao ler as cotas agendadas.');
        }
        setCarregando(false);
    }, [currentUser]);

    useEffect(() => { carregar(); }, [carregar]);

    const emitir = async (q: DctfwebQuotaAgendada) => {
        if (!q.id) return;
        // Imposto sai UMA A UMA, com confirmação — a RFB não desfaz emissão.
        if (!window.confirm(
            `Gerar a guia da cota ${q.cota}/${q.totalCotas} de ${fmtCnpj(q.empresaCnpj)}?\n\n`
            + `Código ${q.codigo}-${q.extensao} · principal ${brl(q.valorPrincipal)} · vence ${fmtData(q.vencimento)}.\n\n`
            + 'Ação real no SERPRO. O acréscimo (SELIC + 1%) é calculado agora, na data de hoje.',
        )) return;
        setEmitindo(q.id); setErro(null);
        try {
            const r = await emitirQuotaAgendada(currentUser, q.id);
            setEmitidas((p) => ({ ...p, [q.id!]: r as Emitida }));
            setQuotas((p) => p.filter((x) => x.id !== q.id));
            onShowToast?.(`Cota ${q.cota}/${q.totalCotas} gerada — ${brl(r.valor)}`);
        } catch (e: any) {
            setErro(e.message || 'Falha ao gerar a cota.');
        }
        setEmitindo(null);
    };

    return (
        <div className="space-y-3 animate-fade-in">
            <div className="rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20 p-3">
                <p className="text-xs text-sky-900 dark:text-sky-200">
                    <strong>A cota se gera no mês dela — a partir do dia 1º, não no dia do vencimento.</strong> Quem
                    vence no fim de agosto pode ser gerado e enviado ao cliente já no primeiro dia útil de agosto: é o
                    mês inteiro de folga. O que não dá é gerar ANTES do mês, porque o acréscimo da 2ª e da 3ª é a SELIC
                    acumulada até o mês anterior ao pagamento mais 1% (Lei 9.430 art. 5º §3º) e essa SELIC ainda não foi
                    publicada — a guia sairia <strong>a menor</strong>, o cliente pagaria e ficaria com débito residual.
                </p>
            </div>

            {erro && (
                <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-800 dark:text-red-200">
                    {erro}
                </div>
            )}

            {carregando ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">Lendo as cotas agendadas…</p>
            ) : quotas.length === 0 ? (
                /* LISTA VAZIA NÃO É RESPOSTA — ela precisa dizer o que NÃO sabe.
                   A primeira versão desta frase afirmava "ninguém escolheu
                   parcelar", e isso é falso por construção: a agenda nasceu em
                   13/08, e tudo que foi parcelado ANTES saiu de uma vez pelo
                   caminho antigo, sem passar por aqui. Vazio dizendo "ninguém
                   escolheu" mandaria a pessoa parar de procurar justamente as
                   cotas que estão soltas. */
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Nenhuma cota agendada para este mês.
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Isso quer dizer <strong>só uma coisa</strong>: nenhuma emissão em 2 ou 3 cotas passou por esta
                        agenda com vencimento até agora. <strong>Não</strong> quer dizer que o trimestre está pago, nem
                        que ninguém parcelou.
                    </p>
                    {/* DECISÃO DO PAULO, 13/08: *"só a partir da próxima cota"*.
                        A agenda vale daqui pra frente — parcelamento feito pelo
                        caminho antigo fica como está, e a tela NÃO manda ninguém
                        auditar o passado. Aviso que pede varredura de histórico
                        sem dizer em quem é alarme sem alvo, e alarme sem alvo é
                        o que faz a equipe parar de ler os avisos que importam. */}
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        A agenda vale <strong>da próxima cota em diante</strong>: toda emissão em 2 ou 3 cotas feita
                        daqui pra frente deixa as seguintes marcadas aqui, cada uma no mês dela.
                    </p>
                </div>
            ) : (
                <>
                    {atrasadas > 0 && (
                        <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-2">
                            <p className="text-xs text-red-800 dark:text-red-200">
                                <strong>{atrasadas} cota(s) com o mês já vencido.</strong> Elas continuam na lista de
                                propósito: some no dia 1º seria o app calando justamente sobre o que está gerando multa.
                            </p>
                        </div>
                    )}
                    {foraDaAtiva > 0 && (
                        <p className={`text-[11px] ${atrasadasFora > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}
                           style={atrasadasFora > 0 ? undefined : { color: 'var(--text-muted)' }}>
                            {foraDaAtiva} cota(s) de outras empresas ficam fora desta tela — ela responde pela empresa ativa.
                            {atrasadasFora > 0 && <> Dessas, <strong>{atrasadasFora} estão ATRASADAS, gerando multa</strong> — troque a empresa no topo (⇄) para emiti-las.</>}
                        </p>
                    )}
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                                <tr className="text-left">
                                    <th className="p-2">Empresa</th>
                                    <th className="p-2">Tributo</th>
                                    <th className="p-2">Cota</th>
                                    <th className="p-2">Principal</th>
                                    <th className="p-2">Vence</th>
                                    <th className="p-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {cotasDaTela.map((q) => (
                                    <tr key={q.id} className="border-t border-slate-100 dark:border-slate-700">
                                        <td className="p-2 font-mono text-slate-700 dark:text-slate-200">{fmtCnpj(q.empresaCnpj)}</td>
                                        <td className="p-2">
                                            {q.codigo}-{q.extensao}
                                            {q.descricao ? <span className="text-slate-500 dark:text-slate-400 ml-1">{q.descricao}</span> : null}
                                            <div className="text-[10px] text-slate-400 dark:text-slate-500">
                                                apuração {String(q.mesPA).padStart(2, '0')}/{q.anoPA}
                                            </div>
                                        </td>
                                        <td className="p-2 whitespace-nowrap">{q.cota}/{q.totalCotas}</td>
                                        <td className="p-2 whitespace-nowrap">{brl(q.valorPrincipal)}</td>
                                        <td className={`p-2 whitespace-nowrap ${q.atrasada ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>
                                            {fmtData(q.vencimento)}
                                        </td>
                                        <td className="p-2">
                                            {ehDaAtiva(q.empresaCnpj) ? (
                                                <button
                                                    onClick={() => emitir(q)}
                                                    disabled={emitindo === q.id}
                                                    className="btn-press text-[11px] px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50 whitespace-nowrap"
                                                >
                                                    {emitindo === q.id ? '⏳…' : 'Gerar guia'}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={trocarEmpresaSessao}
                                                    title="Esta cota é de OUTRA empresa — não da ativa. Emitir guia é ação no cliente: ative-o primeiro (a troca vale para a sessão e aparece no topo)."
                                                    className="btn-press text-[11px] px-2 py-1 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 whitespace-nowrap"
                                                >
                                                    ⚡ ativar p/ emitir
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {Object.values(emitidas).length > 0 && (
                <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-3 space-y-2">
                    <p className="text-xs font-bold text-emerald-800 dark:text-emerald-200">Geradas agora</p>
                    {Object.values(emitidas).map((g) => (
                        <div key={g.id} className="text-[11px] text-slate-700 dark:text-slate-200">
                            <span className="font-semibold">
                                {fmtCnpj(g.empresaCnpj)} · {g.codigo}-{g.extensao} · cota {g.cota}/{g.totalCotas}
                            </span>
                            {' — '}principal {brl(g.valorPrincipal)}
                            {g.juros ? ` + juros ${brl(g.juros)}` : ''}
                            {g.multa ? ` + multa ${brl(g.multa)}` : ''}
                            {' = '}<strong>{brl(g.valor)}</strong> · vence {fmtData(g.vencimento)}
                            {g.pdfBase64 && (
                                <span className="ml-2 inline-flex gap-2">
                                    <button onClick={() => openPdfFromBase64(g.pdfBase64)} className="underline">abrir</button>
                                    <button
                                        onClick={() => downloadPdfFromBase64(g.pdfBase64, `darf_${g.codigo}${g.extensao}_cota${g.cota}_${String(g.empresaCnpj || '').replace(/\D/g, '')}_${g.anoPA}${String(g.mesPA).padStart(2, '0')}.pdf`)}
                                        className="underline"
                                    >
                                        baixar
                                    </button>
                                </span>
                            )}
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                O envio ao cliente é o mesmo rito das outras guias: arquivo na pasta IMPOSTOS, gestor em
                                cópia e baixa da obrigação.
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default QuotasDoMesPanel;
