/**
 * ProvaCapturaPanel — "esta empresa está com a captura completa?", respondido
 * pelo CFI, com dado da SEFAZ.
 *
 * Paulo, 28/07/2026 (NOVA ERA: 79 no CFI × 502 na SIEG): enquanto o app não
 * souber dizer sozinho se falta documento, a equipe vai continuar conferindo
 * no concorrente. A prova é o cursor do DistDFe — ultNSU (o que lemos) contra
 * maxNSU (o que a SEFAZ tem). E ela sai por CNPJ da raiz, porque matriz e
 * filial são cadastros e cursores diferentes.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
    provarCaptura, provarCapturaDaCarteira,
    type ProvaCaptura, type LinhaProva, type ProvaCarteira,
} from '../../services/provaCapturaService';

const fmtCnpj = (c: string) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtData = (ms?: number | null) => (ms ? new Date(ms).toLocaleString('pt-BR') : '—');
const fmtComp = (c: string) => c.split('-').reverse().join('/');

const FAROL_BOX: Record<string, string> = {
    ok: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300',
    atencao: 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300',
    falha: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300',
};
const FAROL_ICONE: Record<string, string> = { ok: '✓', atencao: '!', falha: '✕' };

const LinhaCnpj: React.FC<{ l: LinhaProva }> = ({ l }) => {
    const comps = Object.entries(l.docs.porCompetencia).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
    return (
        <div className={`rounded-lg border p-3 space-y-2 ${FAROL_BOX[l.veredito.farol]}`}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                    <p className="text-sm font-bold">
                        {FAROL_ICONE[l.veredito.farol]} {fmtCnpj(l.cnpj)}
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 align-middle">
                            {l.matriz ? 'MATRIZ' : 'FILIAL'}
                        </span>
                    </p>
                    <p className="text-[11px] opacity-80">{l.cadastro?.nome || 'sem cadastro no CFI'}</p>
                </div>
                <div className="text-right text-[11px] opacity-90">
                    <p><strong>{l.docs.total}</strong> doc(s) · {l.docs.entradas} entrada · {l.docs.saidas} saída</p>
                    {l.docs.resumosSemCompleta > 0 && <p>{l.docs.resumosSemCompleta} só resumo</p>}
                </div>
            </div>

            <p className="text-xs font-semibold">{l.veredito.motivo}</p>
            {l.veredito.acao && <p className="text-[11px]">→ {l.veredito.acao}</p>}

            <div className="text-[11px] opacity-90 grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-0.5">
                <span>Lido até NSU <strong>{l.state?.ultNSU ?? '—'}</strong></span>
                <span>SEFAZ tem até <strong>{l.state?.maxNSU ?? '—'}</strong></span>
                <span>Última consulta: {fmtData(l.state?.ultimaSyncMs)}</span>
                <span>cStat: {l.state?.cStatUltimaSync || '—'}</span>
            </div>

            {comps.length > 0 && (
                <p className="text-[11px] opacity-90">
                    Por competência: {comps.map(([c, n]) => `${fmtComp(c)} (${n})`).join(' · ')}
                </p>
            )}
        </div>
    );
};

/**
 * A CARTEIRA INTEIRA — "como estão as capturas?" (Paulo, 15/08).
 *
 * Agrupada POR VEREDITO, não por empresa: veredito é o que tem AÇÃO. "12
 * travadas no NSU" e "3 com certificado bloqueado" se resolvem de jeitos
 * diferentes, e uma lista de 390 nomes não diz por onde começar.
 */
const VisaoCarteira: React.FC = () => {
    const [dados, setDados] = useState<ProvaCarteira | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [aberto, setAberto] = useState<string | null>(null);

    const rodar = async () => {
        setCarregando(true);
        try { setDados(await provarCapturaDaCarteira()); } finally { setCarregando(false); }
    };
    useEffect(() => { rodar(); }, []);

    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-3 bg-white dark:bg-slate-800">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    📡 Como está a captura da carteira
                </h3>
                <button onClick={rodar} disabled={carregando}
                    className="btn-press text-[11px] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 disabled:opacity-50 whitespace-nowrap">
                    {carregando ? '⏳ conferindo…' : '↻ Atualizar'}
                </button>
            </div>

            {dados?.error && <p className="text-xs text-red-600 dark:text-red-400">{dados.error}</p>}

            {dados?.ok && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Kpi rotulo="Empresas conferidas" valor={String(dados.total ?? 0)} />
                        <Kpi rotulo="Cursor em dia" valor={String(dados.emDia ?? 0)} cor="ok" />
                        <Kpi rotulo="Exigem ação" valor={String(dados.comFalha ?? 0)} cor={(dados.comFalha ?? 0) > 0 ? 'falha' : 'ok'} />
                        {/* O NÚMERO QUE DIMENSIONA: "incompleta" sozinho não diz
                            se é 1 nota ou 500. */}
                        <Kpi rotulo="Documentos que a SEFAZ tem e não lemos"
                            valor={String(dados.documentosPendentes ?? 0)}
                            cor={(dados.documentosPendentes ?? 0) > 0 ? 'falha' : 'ok'} />
                    </div>

                    {(dados.grupos || []).map((g) => (
                        <div key={g.codigo} className={`rounded-lg border p-2.5 ${FAROL_BOX[g.farol]}`}>
                            <button onClick={() => setAberto(aberto === g.codigo ? null : g.codigo)}
                                className="w-full text-left">
                                <p className="text-xs font-bold">
                                    {FAROL_ICONE[g.farol]} {g.total} empresa(s) · {g.codigo}
                                    {g.documentosPendentes > 0 && ` · ${g.documentosPendentes} documento(s) faltando`}
                                </p>
                                <p className="text-[11px] opacity-90">{g.motivo}</p>
                                {g.acao && <p className="text-[11px] mt-0.5">→ {g.acao}</p>}
                            </button>
                            {aberto === g.codigo && (
                                <div className="mt-2 space-y-0.5">
                                    {g.empresas.map((e) => (
                                        <p key={e.cnpj} className="text-[11px] opacity-90">
                                            {fmtCnpj(e.cnpj)} · {e.nome}
                                            {!e.matriz && ' (filial)'}
                                            {!!e.pendenciaNSU && ` · faltam ${e.pendenciaNSU}`}
                                        </p>
                                    ))}
                                    {/* LISTA CORTADA SEMPRE DIZ QUANTOS FICARAM. */}
                                    {g.truncado && (
                                        <p className="text-[11px] font-semibold">
                                            mostrando {g.mostrando} de {g.total} — as demais estão no mesmo estado.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}

                    {/* O RECORTE E O ESCOPO VÃO DITOS: recorte que não se declara
                        faz alguém ler o número de uma carteira como o do
                        escritório, e escopo omitido faz "em dia" parecer
                        "nada a fazer neste cliente". */}
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        Recorte: <strong>{dados.recorte}</strong>. {dados.escopo}
                    </p>
                </>
            )}
        </div>
    );
};

const Kpi: React.FC<{ rotulo: string; valor: string; cor?: 'ok' | 'falha' }> = ({ rotulo, valor, cor }) => (
    <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{rotulo}</p>
        <p className={`text-lg font-bold ${cor === 'falha' ? 'text-red-600 dark:text-red-400'
            : cor === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'}`}>
            {valor}
        </p>
    </div>
);

const ProvaCapturaPanel: React.FC<{ cnpjInicial?: string }> = ({ cnpjInicial = '' }) => {
    const [cnpj, setCnpj] = useState(cnpjInicial);
    const [dados, setDados] = useState<ProvaCaptura | null>(null);
    const [carregando, setCarregando] = useState(false);

    const rodar = useCallback(async (valor: string) => {
        const limpo = valor.replace(/\D/g, '');
        if (limpo.length !== 14) {
            setDados({ ok: false, error: 'Informe o CNPJ completo (14 dígitos).' });
            return;
        }
        setCarregando(true);
        try { setDados(await provarCaptura(limpo)); } finally { setCarregando(false); }
    }, []);

    // Veio da lista de XMLs com o CNPJ do filtro: já roda a prova, sem pedir
    // que o colaborador digite de novo o que ele acabou de selecionar.
    useEffect(() => {
        const limpo = (cnpjInicial || '').replace(/\D/g, '');
        if (limpo.length !== 14) return;
        setCnpj(limpo);
        rodar(limpo);
    }, [cnpjInicial, rodar]);

    return (
        <div className="space-y-3">
            {/* A VISÃO DO CONJUNTO VEM PRIMEIRO: a pergunta "como estão as
                capturas?" é a que se faz antes de escolher um CNPJ. A prova
                individual continua logo abaixo, para o caso já escolhido. */}
            <VisaoCarteira />

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">🔎 Prova de captura (contra a SEFAZ)</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-3xl">
                    Responde se falta documento <strong>segundo a própria SEFAZ</strong>: comparamos até onde já lemos
                    (<em>ultNSU</em>) com até onde ela diz ter documento (<em>maxNSU</em>). Se sobrar, a captura está
                    incompleta — sem precisar conferir em nenhum outro sistema. A prova sai por <strong>CNPJ</strong>:
                    matriz e filial têm cadastro, certificado e cursor próprios.
                </p>
                <div className="flex gap-2 flex-wrap">
                    <input
                        value={cnpj}
                        onChange={(e) => setCnpj(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') rodar(cnpj); }}
                        placeholder="CNPJ da empresa (matriz ou filial)"
                        className="flex-1 min-w-[220px] text-sm p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                    />
                    <button
                        onClick={() => rodar(cnpj)}
                        disabled={carregando}
                        className="text-sm px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {carregando ? 'Consultando…' : 'Provar'}
                    </button>
                </div>
            </div>

            {dados && !dados.ok && (
                <p className="text-sm text-red-600 dark:text-red-400">{dados.error}</p>
            )}

            {dados?.ok && (
                <>
                    <div className={`rounded-lg border p-3 ${FAROL_BOX[dados.farol || 'atencao']}`}>
                        <p className="text-sm font-bold">{dados.resumo}</p>
                        <p className="text-[11px] mt-1">
                            {dados.totalDocs} documento(s) na raiz {dados.raiz}
                            {(dados.docsSemDono ?? 0) > 0 && ` · ${dados.docsSemDono} sem dono definido`}
                            {(dados.docsAntesDoCorte ?? 0) > 0 && ` · ${dados.docsAntesDoCorte} anteriores à janela do DistDFe (vieram de importação)`}
                        </p>
                    </div>

                    {(dados.linhas || []).map((l) => <LinhaCnpj key={l.cnpj} l={l} />)}

                    {/* As ressalvas ficam SEMPRE visíveis: sem elas, comparar o
                        total com o de outro sistema leva à conclusão errada. */}
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3">
                        <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            Antes de comparar este total com o de outro sistema:
                        </p>
                        <ul className="mt-1 space-y-1 text-[11px] text-slate-600 dark:text-slate-400 list-disc pl-4">
                            {(dados.ressalvas || []).map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                    </div>
                </>
            )}
        </div>
    );
};

export default ProvaCapturaPanel;
