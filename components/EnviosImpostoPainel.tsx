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
import { painelEnviosImposto, type PainelEnvios } from '../services/envioImpostoService';

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

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtComp = (c: string) => c.split('-').reverse().join('/');

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

export default EnviosImpostoPainel;
