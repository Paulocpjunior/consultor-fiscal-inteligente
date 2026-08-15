/**
 * IpiVarreduraPanel — varredura de IPI por competência (motivação: Experte
 * 06/2026). Fase 1 (local, grátis): quem tem IPI apurado na ficha. Fase 2
 * (botão, consulta SERPRO): o MIT de cada uma tem mês-modelo com IPI?
 *   - pronta            → preenchimento automático transmite sozinho
 *   - precisa_lancamento→ lançar IPI 1x no e-CAC (vira modelo)
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    getIpiVarredura, relerItensFiscais,
    type IpiVarreduraResposta, type IpiVarreduraLinha, type RelerItensResposta,
} from '../../services/ipiVarreduraService';
import { useEmpresaAtiva } from '../../services/empresaAtivaContext';

interface Props { onShowToast?: (msg: string) => void; }

const brl = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const competenciaDefault = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1); // competência sendo declarada agora
    return d.toISOString().slice(0, 7);
};

const CORES: Record<string, { badge: string; label: string }> = {
    pronta: { badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', label: '✅ Pronta' },
    precisa_lancamento: { badge: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', label: '🔴 Lançar 1x no e-CAC' },
    erro_consulta: { badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', label: '⚠️ Erro na consulta' },
    verificar_mit: { badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300', label: '🔎 Verificar MIT' },
    sem_ipi: { badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', label: 'Sem IPI' },
};

const IpiVarreduraPanel: React.FC<Props> = ({ onShowToast }) => {
    // ─── VER a carteira é livre; AGIR num cliente exige que ele seja o ATIVO ─
    //
    // Paulo, 15/08, com a EXPERTE ativa e a FASTWELD listada logo abaixo:
    // *"agora pensa cmg, se um colaborador desatento faz algo na empresa
    // errada"*. A varredura é TRIAGEM da carteira e continua mostrando todo
    // mundo — mas o ♻️ ESCREVE em documento fiscal, e escrever no cliente
    // errado é silencioso. Ação em linha de outra empresa só depois de
    // ATIVÁ-LA, pelo mesmo caminho único de troca da sessão.
    const { empresa: empresaAtivaSessao, ativar: ativarEmpresaSessao } = useEmpresaAtiva();
    const [competencia, setCompetencia] = useState(competenciaDefault());
    const [data, setData] = useState<IpiVarreduraResposta | null>(null);
    const [loading, setLoading] = useState(false);
    const [consultandoMit, setConsultandoMit] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    // ♻️ RELER CST DOS ITENS — o E510 não sai sem `cstIpi`, e o extrator só
    // passou a lê-lo em 11/08. O XML cru está no Storage, então o campo se
    // RECUPERA da fonte; ninguém digita e não se pede arquivo ao cliente.
    const [relendo, setRelendo] = useState<string | null>(null);
    const [relido, setRelido] = useState<Record<string, RelerItensResposta>>({});

    const relerCst = async (l: IpiVarreduraLinha) => {
        setRelendo(l.empresaId);
        try {
            const r = await relerItensFiscais(l.empresaId, competencia);
            setRelido(prev => ({ ...prev, [l.empresaId]: r }));
            const ganhos = Object.entries(r.porCampo).map(([c, n]) => `${c}: ${n}`).join(' · ');
            onShowToast?.(r.atualizadas
                ? `${l.nome}: ${r.atualizadas} nota(s) recuperada(s) — ${ganhos}.`
                : `${l.nome}: nada a recuperar (${r.jaRelidas} já relidas · ${r.semDadoNoXml} sem o dado no XML · ${r.semXml} sem arquivo).`);
        } catch (e: any) {
            onShowToast?.(`Falha ao reler ${l.nome}: ${e?.message || 'erro desconhecido'}`);
        } finally {
            setRelendo(null);
        }
    };

    const carregar = async (consultarMit: boolean) => {
        consultarMit ? setConsultandoMit(true) : setLoading(true);
        setErro(null);
        try {
            const r = await getIpiVarredura(competencia, consultarMit);
            setData(r);
            if (consultarMit) {
                onShowToast?.(`Varredura MIT concluída: ${r.resumo.pronta} pronta(s), ${r.resumo.precisaLancamento} precisando de lançamento no e-CAC.`);
            }
        } catch (e: any) {
            setErro(e?.message || 'Falha ao carregar');
        } finally {
            setLoading(false); setConsultandoMit(false);
        }
    };
    useEffect(() => { carregar(false); /* eslint-disable-next-line */ }, [competencia]);

    // ─── ATÉ A VISÃO É DA EMPRESA ATIVA — decisão do Paulo, reafirmada ──────
    //
    // Eu tinha deixado a lista da carteira inteira e travado só a AÇÃO; ele
    // repetiu com o print: *"mesmo problema: empresa ativa EXPERTE, e você
    // traz FASTWELD"*. Dentro de um módulo por cliente, a tela responde pelo
    // cliente ativo — ponto. O que fica das outras é a CONTAGEM (some da
    // tela, nunca da conta): esconder sem dizer faria "0 com IPI" parecer
    // resposta da carteira, e ela é só da ativa.
    const todas = useMemo(() => data?.linhas || [], [data]);
    const linhas = useMemo(
        () => (empresaAtivaSessao ? todas.filter(l => l.empresaId === empresaAtivaSessao.id) : todas),
        [todas, empresaAtivaSessao],
    );
    const foraDaAtiva = todas.length - linhas.length;
    // Os KPIs seguem o MESMO recorte da lista — número de um recorte com
    // lista de outro foi a leitura dupla que já mordeu este projeto.
    const resumoDaTela = useMemo(() => ({
        comIpi: linhas.filter(l => l.ipiApurado > 0).length,
        ipiTotalApurado: linhas.reduce((s2, l) => s2 + (l.ipiApurado || 0), 0),
        pronta: linhas.filter(l => l.status === 'pronta').length,
        precisaLancamento: linhas.filter(l => l.status === 'precisa_lancamento').length,
        ipiTotalEmRisco: linhas.filter(l => l.status === 'precisa_lancamento').reduce((s2, l) => s2 + (l.ipiApurado || 0), 0),
    }), [linhas]);
    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>🏭 Varredura de IPI</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Empresas Lucro com <b>IPI apurado</b> na competência e o que falta para o MIT
                    transmitir sozinho. <b>Pronta</b> = já existe mês-modelo com IPI no MIT (o app monta
                    e transmite). <b>Lançar 1x no e-CAC</b> = primeiro IPI da empresa — lance manualmente
                    uma vez; a partir do mês seguinte o app assume (caso Experte 06/2026).
                </p>
                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                        <Kpi label="Com IPI na competência" value={String(resumoDaTela.comIpi)} />
                        <Kpi label="IPI total apurado" value={brl(resumoDaTela.ipiTotalApurado)} />
                        <Kpi label="Prontas" value={String(resumoDaTela.pronta)} accent={resumoDaTela.pronta > 0 ? 'success' : undefined} />
                        <Kpi label="Precisam e-CAC 1x" value={String(resumoDaTela.precisaLancamento)} accent={resumoDaTela.precisaLancamento > 0 ? 'danger' : 'success'} />
                        <Kpi label="IPI em risco" value={brl(resumoDaTela.ipiTotalEmRisco)} accent={resumoDaTela.ipiTotalEmRisco > 0 ? 'danger' : 'success'} />
                    </div>
                )}
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Competência:</label>
                <input
                    type="month" value={competencia}
                    onChange={e => setCompetencia(e.target.value)}
                    className="px-3 py-1.5 text-sm border rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-slate-600"
                />
                <button
                    onClick={() => carregar(true)}
                    disabled={consultandoMit || loading || (data?.resumo.comIpi || 0) === 0}
                    title="Consulta o MIT (SERPRO) das empresas com IPI — 2 chamadas por empresa"
                    className="px-3 py-1.5 text-sm font-semibold bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
                >
                    {consultandoMit ? '⏳ Consultando MIT…' : '🔎 Verificar modelo no MIT (SERPRO)'}
                </button>
                <button
                    onClick={() => carregar(false)}
                    disabled={loading || consultandoMit}
                    className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-100 dark:text-gray-100 rounded"
                >
                    ↻ Atualizar
                </button>
                {data && (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {data.consultouMit ? 'Com consulta ao MIT' : 'Somente fase local (ficha) — sem SERPRO'} · gerado {new Date(data.geradoEm).toLocaleString('pt-BR')}
                    </span>
                )}
            </div>

            {erro && (
                <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 dark:bg-red-950/40 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300">{erro}</div>
            )}
            {loading && <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Carregando…</div>}

            {/* O estado vazio responde pela ATIVA — "nenhuma empresa" quando a
                tela só olha uma seria mentira de recorte. E o que ficou fora
                vai CONTADO: some da tela, nunca da conta. */}
            {!loading && data && linhas.length === 0 && (
                <div className="p-6 text-center text-sm rounded-xl" style={card}>
                    {empresaAtivaSessao
                        ? <><strong>{empresaAtivaSessao.nome}</strong> não tem IPI apurado em {competencia}. 🎉</>
                        : <>Nenhuma empresa Lucro com IPI apurado em {competencia}. 🎉</>}
                </div>
            )}
            {!loading && data && foraDaAtiva > 0 && (
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                    {foraDaAtiva} outra(s) empresa(s) da carteira têm IPI em {competencia} e ficam fora desta tela —
                    ela responde pela <strong>empresa ativa</strong>. Para vê-las, troque a empresa no topo
                    (⇄) ou use a Rotina do Mês, que é a visão da carteira.
                </p>
            )}

            {!loading && linhas.length > 0 && (
                <div className="rounded-xl overflow-x-auto" style={card}>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                                <th className="px-4 py-2">Empresa</th>
                                <th className="px-4 py-2">Regime</th>
                                <th className="px-4 py-2 text-right">IPI apurado</th>
                                <th className="px-4 py-2">Status</th>
                                <th className="px-4 py-2">Modelo</th>
                                <th className="px-4 py-2">Ação</th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.map((l: IpiVarreduraLinha) => {
                                const cor = CORES[l.status] || CORES.sem_ipi;
                                return (
                                    <tr key={l.cnpj} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                                        <td className="px-4 py-2">
                                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{l.nome}</div>
                                            <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                                                {fmtCnpj(l.cnpj)}
                                                {empresaAtivaSessao?.id === l.empresaId && (
                                                    <span className="ml-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ ativa</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>{l.regime}</td>
                                        <td className="px-4 py-2 text-right font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{brl(l.ipiApurado)}</td>
                                        <td className="px-4 py-2">
                                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cor.badge}`}>{cor.label}</span>
                                        </td>
                                        <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                            {l.modeloPeriodo || (l.temModeloIpi === false ? '—' : '?')}
                                        </td>
                                        <td className="px-4 py-2 text-xs max-w-md" style={{ color: 'var(--text-secondary)' }}>
                                            {l.acao}
                                            {/* O E510 depende do CST do IPI por item, e nota
                                                capturada antes de 11/08 não tem o campo. Aqui
                                                ele volta do XML-fonte. */}
                                            <div className="mt-1">
                                                {/* AGIR exige que a empresa da linha seja a ATIVA. O ♻️
                                                    escreve em documento fiscal — na linha de outra empresa
                                                    ele vira o convite de ativação, pelo caminho único da
                                                    sessão. Um desatento não roda nada no cliente errado:
                                                    o primeiro clique só TROCA, visível no topo. */}
                                                {empresaAtivaSessao?.id === l.empresaId ? (
                                                    <button
                                                        onClick={() => relerCst(l)}
                                                        disabled={relendo !== null}
                                                        title="Relê o XML guardado e preenche os CST de IPI/PIS/COFINS que faltam nos itens. Não sobrescreve o que já está gravado."
                                                        className="btn-press text-[10px] px-1.5 py-0.5 rounded border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 disabled:opacity-50 whitespace-nowrap"
                                                    >
                                                        {relendo === l.empresaId ? '⏳ relendo…' : '♻️ Reler CST dos itens'}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => ativarEmpresaSessao({
                                                            id: l.empresaId, nome: l.nome,
                                                            cnpj: String(l.cnpj || '').replace(/\D/g, ''),
                                                            fonte: 'lucro',
                                                        })}
                                                        title={`Esta linha é da ${l.nome} — não da empresa ativa. Para agir nela, primeiro ative-a: a troca vale para a sessão inteira e aparece no topo.`}
                                                        className="btn-press text-[10px] px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 whitespace-nowrap"
                                                    >
                                                        ⚡ Ativar {l.nome.split(' ')[0]} para agir aqui
                                                    </button>
                                                )}
                                                {relido[l.empresaId] && (
                                                    <RelerResultado r={relido[l.empresaId]} />
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

/**
 * O resultado responde POR CAUSA — três números com ações OPOSTAS.
 *
 * "0 recuperadas" sozinho foi o alarme sem ação de 13/08: não dizia se o clique
 * já tinha sido dado, se o XML não tem o dado, ou se o arquivo nem foi guardado.
 */
const RelerResultado: React.FC<{ r: RelerItensResposta }> = ({ r }) => (
    <div className="mt-1 text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {r.atualizadas > 0 && (
            <div className="text-emerald-600 dark:text-emerald-400">
                ✓ {r.atualizadas} nota(s) recuperada(s) — {Object.entries(r.porCampo).map(([c, n]) => `${c} ${n}`).join(' · ')}
            </div>
        )}
        {r.jaRelidas > 0 && <div>{r.jaRelidas} já relidas nesta versão — clicar de novo não muda nada.</div>}
        {r.semDadoNoXml > 0 && <div>{r.semDadoNoXml} relidas e o XML realmente não traz o campo.</div>}
        {r.semXml > 0 && (
            <div className="text-amber-600 dark:text-amber-400">
                {r.semXml} sem o XML guardado — é buraco de CAPTURA, não de leitura.
            </div>
        )}
        {r.naoPareadas > 0 && (
            <div className="text-amber-600 dark:text-amber-400">
                {r.naoPareadas} com itens que não pareiam com o XML — ficaram INTACTAS de propósito
                (gravar por posição escreveria o CST de um produto em outro).
                {r.naoPareadasDetalhe.slice(0, 3).map(d => (
                    <div key={d.chave}>· nº {d.numero || '—'}: {d.motivo}</div>
                ))}
            </div>
        )}
        {!r.atualizadas && !r.jaRelidas && !r.semDadoNoXml && !r.semXml && !r.naoPareadas && (
            <div>Nenhum documento com itens nesta competência.</div>
        )}
    </div>
);

const Kpi: React.FC<{ label: string; value: string; accent?: 'danger' | 'success' | 'warning' }> = ({ label, value, accent }) => (
    <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
        <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
        <div className={`text-lg font-bold ${
            accent === 'danger' ? 'text-red-600 dark:text-red-400'
            : accent === 'success' ? 'text-emerald-600 dark:text-emerald-400'
            : accent === 'warning' ? 'text-amber-600 dark:text-amber-400' : ''
        }`} style={accent ? undefined : { color: 'var(--text-primary)' }}>{value}</div>
    </div>
);

export default IpiVarreduraPanel;
