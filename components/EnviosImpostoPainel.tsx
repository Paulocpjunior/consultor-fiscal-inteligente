/**
 * EnviosImpostoPainel — farol da ORDEM TÉCNICA do envio de imposto (#293).
 *
 * A auditoria já registrava cada etapa (cópia no SharePoint, gestor em cópia,
 * baixa da obrigação), mas ninguém via o agregado: dava para o mês inteiro
 * passar com metade dos envios sem arquivo na pasta do cliente e sem baixa,
 * e a equipe só descobrir na cobrança. Aqui o mês aparece inteiro, e cada
 * pendência vem agrupada POR CAUSA — que é como se resolve.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { painelEnviosImposto, refazerRitoDosEnvios, type PainelEnvios } from '../services/envioImpostoService';
import { fmtBRL, fmtComp } from '../services/formatos';

const competenciaAtual = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const ultimasCompetencias = (n = 12): string[] => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < n; i++) {
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        d.setMonth(d.getMonth() - 1);
    }
    return out;
};


const CORES: Record<string, string> = {
    ok: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300',
    atencao: 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300',
    vazio: 'bg-slate-50 dark:bg-slate-800/40 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300',
};

const EnviosImpostoPainel: React.FC = () => {
    const [competencia, setCompetencia] = useState(competenciaAtual());
    const [dados, setDados] = useState<PainelEnvios | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [oculto, setOculto] = useState(false);

    const carregar = useCallback(async (comp: string) => {
        setCarregando(true);
        try {
            const r = await painelEnviosImposto(comp);
            // 403 = não é admin: o painel some sem ruído (é visão de gestão).
            if (!r.ok && /admin/i.test(String(r.error || ''))) setOculto(true);
            setDados(r);
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => { carregar(competencia); }, [carregar, competencia]);

    if (oculto) return null;

    const pendencias = Object.entries(dados?.pendencias || {});

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">📤 Envios de imposto — ordem técnica</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Todo imposto enviado deve ter <strong>cópia na pasta IMPOSTOS do cliente</strong>, gestor em cópia e
                        <strong> baixa da obrigação</strong>. Envio pela metade não conta como feito.
                    </p>
                </div>
                <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                    className="text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700">
                    {ultimasCompetencias().map(c => <option key={c} value={c}>{fmtComp(c)}</option>)}
                </select>
            </div>

            {carregando && !dados && <p className="text-xs text-slate-400 py-2">Carregando…</p>}
            {dados && !dados.ok && <p className="text-xs text-red-600 dark:text-red-400">{dados.error}</p>}

            {dados?.ok && (
                <>
                    <div className={`rounded-lg border p-3 text-sm font-bold ${CORES[dados.farol || 'vazio']}`}>
                        {dados.resumo}
                        {(dados.valorTotal ?? 0) > 0 && (
                            <span className="font-normal"> · {fmtBRL(dados.valorTotal || 0)} em guias</span>
                        )}
                    </div>

                    {Object.keys(dados.porTipo || {}).length > 0 && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {Object.entries(dados.porTipo || {}).map(([t, q]) => `${q} ${t}`).join(' · ')}
                        </p>
                    )}

                    {/* Pendências POR CAUSA: 12 empresas sem pasta é UMA tarefa. */}
                    {pendencias.map(([causa, info]) => (
                        <div key={causa} className="border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/10 rounded-lg p-3">
                            <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                                {info.qtd}× {causa}
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">{info.acao}</p>
                            {/* ♻️ A SAÍDA NASCE ONDE A TRAVA APARECE — e aqui ela
                                é POR CAUSA, porque é assim que o trabalho se faz:
                                consertada a pasta (ou o proxy), estes envios
                                precisam ser tentados de novo, senão o carimbo
                                antigo trava o fim de mês para sempre. */}
                            <RefazerRito
                                causa={causa}
                                ids={info.envioIds || []}
                                onFeito={() => carregar(competencia)}
                            />
                            <details className="mt-1">
                                <summary className="text-[11px] cursor-pointer text-slate-500 dark:text-slate-400">
                                    Ver empresas ({info.empresas.length})
                                </summary>
                                <ul className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5 max-h-40 overflow-y-auto">
                                    {info.empresas.map((e, i) => <li key={i}>{e}</li>)}
                                </ul>
                            </details>
                        </div>
                    ))}

                    {/* 🚨 NÃO CONFERIDO ≠ COMPLETO. Envio sem registro das
                        etapas entrava em "completos" e o resumo afirmava
                        "todos completos" — o que a rodada nunca estabeleceu.
                        Ausência de alarme não pode parecer "está tudo certo". */}
                    {(dados.naoConferidos?.length ?? 0) > 0 && (
                        <div className="border border-sky-300 dark:border-sky-700 bg-sky-50/60 dark:bg-sky-900/10 rounded-lg p-3">
                            <p className="text-xs font-bold text-sky-800 dark:text-sky-300">
                                {dados.naoConferidos?.length}× envio sem registro das etapas do rito
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                                Não é pendência nem envio completo: a auditoria destes não guarda o resultado do
                                arquivamento ou da baixa — é o caso dos envios anteriores ao rito. Confira na pasta
                                IMPOSTOS do cliente e na aba Vencimentos antes de dar a competência por fechada.
                            </p>
                            <details className="mt-1">
                                <summary className="text-[11px] cursor-pointer text-slate-500 dark:text-slate-400">
                                    Ver envios ({dados.naoConferidos?.length})
                                </summary>
                                <ul className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5 max-h-40 overflow-y-auto">
                                    {(dados.naoConferidos || []).map((e, i) => <li key={i}>{e}</li>)}
                                </ul>
                            </details>
                        </div>
                    )}

                    {(dados.semGestorEmCopia?.length ?? 0) > 0 && (
                        <div className="border border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-900/10 rounded-lg p-3">
                            <p className="text-xs font-bold text-red-800 dark:text-red-300">
                                {dados.semGestorEmCopia?.length}× envio sem o gestor em cópia
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                A ordem técnica manda {dados.gestor} em TODO envio. Estes saíram fora do padrão:
                            </p>
                            <ul className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5 max-h-32 overflow-y-auto">
                                {(dados.semGestorEmCopia || []).map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

/**
 * ♻️ REFAZER O RITO desta causa.
 *
 * Paulo, 28/08 (VINCENZO GUERRA): *"Já criei a pasta e continua assim, o que eu
 * faço?"*. O status do rito é um CARIMBO do instante do envio — consertar a
 * causa depois não o move.
 *
 * ⚠️ **A tela DIZ, antes do clique, que nada é reenviado ao cliente.** Sem isso
 * o botão parece "mandar a guia de novo", que é exatamente o que ninguém pode
 * fazer sem duplicar a cobrança.
 *
 * ⚠️ E nenhuma régua mora aqui: o que é refazível, o teto e a frase do
 * resultado vêm do backend.
 */
const RefazerRito: React.FC<{ causa: string; ids: string[]; onFeito: () => void }> = ({ causa, ids, onFeito }) => {
    const [rodando, setRodando] = useState(false);
    const [saida, setSaida] = useState<string | null>(null);

    if (!ids.length) return null;

    const rodar = async () => {
        if (!window.confirm(
            `Refazer o rito de ${ids.length} envio(s) — "${causa}"?\n\n`
            + 'NADA é reenviado ao cliente. O app só tenta de novo a cópia na pasta IMPOSTOS e a baixa '
            + 'da obrigação. Faz sentido depois de você ter corrigido a causa (cadastrar a pasta, gerar '
            + 'a tarefa, consertar a conexão).',
        )) return;
        setRodando(true); setSaida(null);
        try {
            const r = await refazerRitoDosEnvios(ids);
            if (!r.ok) { setSaida(`Erro: ${r.error}`); return; }
            // O resultado sai por PARTES, e o que NÃO deu vai junto: "12
            // refeitos" sobre uma rodada em que o arquivamento falhou de novo
            // seria a meia-verdade de sempre.
            const partes = [
                `${r.arquivados ?? 0} arquivado(s)`,
                `${r.baixados ?? 0} baixado(s)`,
                (r.semPdf ?? 0) > 0 ? `${r.semPdf} sem o PDF guardado (o app não guarda a guia depois do envio)` : null,
                (r.falhas ?? 0) > 0 ? `${r.falhas} falhou/falharam` : null,
            ].filter(Boolean);
            setSaida(`De ${r.total} envio(s): ${partes.join(' · ')}.`);
            onFeito();
        } catch (e: any) {
            setSaida(`Erro: ${e?.message || 'falha'}`);
        } finally { setRodando(false); }
    };

    return (
        <div className="mt-1.5 space-y-1">
            <button
                onClick={rodar} disabled={rodando}
                className="text-[11px] px-2 py-1 rounded border border-amber-500 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50"
            >
                {rodando ? 'Refazendo…' : `♻️ Refazer o rito destes ${ids.length}`}
            </button>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Não reenvia guia ao cliente — só tenta de novo a cópia na pasta e a baixa.
                Use depois de corrigir a causa acima.
            </p>
            {saida && <p className="text-[11px] text-slate-700 dark:text-slate-200">{saida}</p>}
        </div>
    );
};

export default EnviosImpostoPainel;
