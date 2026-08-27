/**
 * RotinaFiscalPainel — a LINHA do mês, cliente a cliente.
 *
 * Paulo, 28/07/2026: "o colaborador não está seguindo uma linha de processo:
 * captura notas, valida as nfs, cálculo de impostos, entrega de obrigações e
 * emissão de guias". O app tinha todas as telas e nenhuma ordem — cada um
 * começava por onde achava.
 *
 * Aqui a ordem é a tela. Cada etapa nasce de dado REAL (documento capturado,
 * ficha da competência, tarefa entregue, envio com o rito completo): não
 * existe "marcar como feito". O PRÓXIMO PASSO é sempre a primeira etapa não
 * fechada — e vem com a ação e o botão que leva à tela certa.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { carregarRotinaFiscal, type PainelRotina, type RotinaEmpresa, type EtapaRotina } from '../services/rotinaFiscalService';
import FronteiraProcessoPanel from './FronteiraProcessoPanel';
import FimDeMesBloco from './FimDeMesBloco';

interface Props {
    /** Leva o colaborador à tela da etapa (App resolve o SearchType). */
    onIrPara?: (etapaId: string, empresa: RotinaEmpresa['empresa']) => void;
    /** Só admin REABRE competência fechada (decisão do Paulo, 26/08) — sem
     *  isso o botão nem aparece, e botão que não faz nada é pior que botão
     *  nenhum. Fechar continua sendo do colaborador. */
    ehAdmin?: boolean;
}

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

const fmtComp = (c: string) => c.split('-').reverse().join('/');
const fmtCnpj = (c: string) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PONTO: Record<string, string> = {
    concluida: 'bg-emerald-500 border-emerald-500',
    na: 'bg-slate-300 border-slate-300 dark:bg-slate-600 dark:border-slate-600',
    atencao: 'bg-amber-400 border-amber-400',
    pendente: 'bg-red-500 border-red-500',
};
const ICONE: Record<string, string> = { concluida: '✓', na: '–', atencao: '!', pendente: '•' };

const FAROL_CARD: Record<string, string> = {
    // 🔒 FECHADO é FATO (o carimbo), e a página virou: borda discreta, sem cor
    // de alarme. `ok` é "pronto para fechar" — ainda pede um clique, então
    // continua verde para chamar quem vai dá-lo.
    fechado: 'border-slate-200 dark:border-slate-700 opacity-75',
    ok: 'border-emerald-300 dark:border-emerald-700',
    atencao: 'border-amber-300 dark:border-amber-700',
    pendente: 'border-red-300 dark:border-red-700',
};

/**
 * As etapas ABERTAS viram os bloqueios do fim de mês.
 *
 * ⚠️ Isto NÃO é uma segunda cópia da régua: quem decide o que é "fechada" é o
 * backend, e ele já mandou o `status` de cada etapa pronto. Aqui é só o
 * recorte das que não fecharam — e é o que evita uma requisição por card
 * (o HTTP 429 de 27/08).
 */
const FECHADAS_NA_TELA = new Set(['concluida', 'na']);
export const bloqueiosDasEtapas = (etapas: EtapaRotina[]) =>
    (etapas || []).filter((e) => !FECHADAS_NA_TELA.has(e.status)).map((e) => ({
        id: e.id, ordem: e.ordem, nome: e.nome, status: e.status,
        resumo: e.resumo || null, acao: e.acao || null, onde: e.onde || null,
    }));

/** Trilha das 5 etapas de uma empresa. */
const Trilha: React.FC<{ etapas: EtapaRotina[]; destaque?: string }> = ({ etapas, destaque }) => (
    <div className="flex items-center gap-0 flex-wrap">
        {etapas.map((e, i) => (
            <React.Fragment key={e.id}>
                {i > 0 && <div className="w-4 h-px bg-slate-300 dark:bg-slate-600" />}
                <div
                    title={`${e.nome}: ${e.resumo}${e.acao ? `\n→ ${e.acao}` : ''}`}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${
                        destaque === e.id
                            ? 'ring-2 ring-offset-1 ring-blue-400 dark:ring-offset-slate-800'
                            : ''
                    } ${PONTO[e.status]} text-white`}
                >
                    <span>{ICONE[e.status]}</span>
                    <span className="hidden sm:inline">{e.nome}</span>
                </div>
            </React.Fragment>
        ))}
    </div>
);

const RotinaFiscalPainel: React.FC<Props> = ({ onIrPara, ehAdmin }) => {
    const [competencia, setCompetencia] = useState(competenciaAtual());
    const [dados, setDados] = useState<PainelRotina | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [etapaFiltro, setEtapaFiltro] = useState<string | null>(null);
    const [busca, setBusca] = useState('');

    const carregar = useCallback(async (comp: string) => {
        setCarregando(true);
        try {
            setDados(await carregarRotinaFiscal(comp));
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => { carregar(competencia); }, [carregar, competencia]);

    const rotinas = dados?.rotinas || [];
    const visiveis = useMemo(() => {
        const termo = busca.trim().toLowerCase();
        return rotinas.filter((r) => {
            if (etapaFiltro && r.proximoPasso?.id !== etapaFiltro) return false;
            if (!termo) return true;
            const alvo = `${r.empresa?.nome || ''} ${r.empresa?.cnpj || ''}`.toLowerCase();
            return alvo.includes(termo);
        });
    }, [rotinas, etapaFiltro, busca]);

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">🧭 Rotina do mês</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                            A ordem do departamento: <strong>capturar as notas → validar → apurar → entregar as
                            obrigações → emitir e enviar as guias</strong>. Cada etapa só fecha com prova no sistema —
                            nada aqui se marca à mão. Comece pelo cliente que está mais atrás na lista.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={competencia}
                            onChange={(e) => setCompetencia(e.target.value)}
                            className="text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700"
                        >
                            {ultimasCompetencias().map((c) => <option key={c} value={c}>{fmtComp(c)}</option>)}
                        </select>
                        <button
                            onClick={() => carregar(competencia)}
                            disabled={carregando}
                            className="text-xs px-3 py-1.5 rounded bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
                        >
                            {carregando ? 'Lendo…' : '⟲ Atualizar'}
                        </button>
                    </div>
                </div>
            </div>

            {/* O CORTE oficial CFI × e-Fiscal — o colaborador decide "onde fazer"
                aqui mesmo, antes de escolher o próximo passo (Paulo, 30/07). */}
            <FronteiraProcessoPanel />

            {carregando && !dados && <p className="text-sm text-slate-400">Montando a rotina de {fmtComp(competencia)}…</p>}
            {dados && !dados.ok && (
                <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
                    {dados.error}
                </div>
            )}

            {dados?.ok && dados.funil && (
                <>
                    {/* FUNIL — onde a carteira está travada hoje. */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{dados.funil.resumo}</p>
                            <span className="text-[11px] text-slate-400">
                                {dados.escopo === 'carteira' ? 'Sua carteira' : 'Todas as empresas'} ·
                                {' '}{dados.lidos?.documentos ?? 0} doc(s) lidos
                            </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                            {dados.funil.etapas.map((e) => (
                                <button
                                    key={e.id}
                                    onClick={() => setEtapaFiltro(etapaFiltro === e.id ? null : e.id)}
                                    className={`rounded-lg border p-2 text-left transition-colors ${
                                        etapaFiltro === e.id
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40'
                                    }`}
                                >
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">{e.ordem}. {e.nome}</p>
                                    <p className={`text-lg font-bold ${e.qtd > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                                        {e.qtd}
                                    </p>
                                </button>
                            ))}
                            {/* 🚨 ESTE NÚMERO ERA DEDUÇÃO — "não tem próximo
                                passo ⇒ mês fechado". Agora ele é o CARIMBO, e
                                "pronta para fechar" saiu para um contador
                                PRÓPRIO: as duas pedem ações opostas (uma não
                                pede nada, a outra pede um clique), e juntas
                                faziam empresa pronta passar por entregue. */}
                            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/10 p-2">
                                <p className="text-[10px] text-emerald-700 dark:text-emerald-400">Mês FECHADO</p>
                                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{dados.funil.fechados ?? 0}</p>
                                {(dados.funil.prontos ?? 0) > 0 && (
                                    <p className="text-[10px] text-blue-600 dark:text-blue-400">
                                        + {dados.funil.prontos} pronta(s) para fechar
                                    </p>
                                )}
                            </div>
                        </div>
                        {etapaFiltro && (
                            <p className="text-[11px] text-blue-600 dark:text-blue-400">
                                Mostrando só quem está parado em “{dados.funil.etapas.find((e) => e.id === etapaFiltro)?.nome}”.
                                <button onClick={() => setEtapaFiltro(null)} className="underline ml-1">limpar</button>
                            </p>
                        )}
                    </div>

                    {/* ISS DE SP CAPITAL — a onda 1 são 157 empresas de serviço
                        puro, que NÃO fecham o mês no DAS. A rotina era cega pro
                        ISS e elas apareciam com "mês fechado". */}
                    {dados.iss && dados.iss.empresas > 0 && (
                        <div className={`rounded-xl border p-4 space-y-2 ${
                            dados.iss.farol === 'ok'
                                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10'
                                : 'border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/10'
                        }`}>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                    🏛️ ISS de São Paulo capital · {dados.iss.empresas} empresa(s) na seleção
                                </p>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    guia do município — não é o DAS nem o DARF
                                </span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <div className="rounded-lg bg-white/70 dark:bg-slate-800/60 p-2">
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">ISS próprio a recolher</p>
                                    <p className="text-base font-bold text-slate-800 dark:text-slate-100">{fmtBRL(dados.iss.totalARecolher)}</p>
                                    <p className="text-[10px] text-slate-500">{dados.iss.aRecolher} empresa(s)</p>
                                </div>
                                <div className="rounded-lg bg-white/70 dark:bg-slate-800/60 p-2">
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">ISS retido como tomadora</p>
                                    <p className="text-base font-bold text-slate-800 dark:text-slate-100">{fmtBRL(dados.iss.totalIssTomado)}</p>
                                    <p className="text-[10px] text-slate-500">{dados.iss.comIssTomado} empresa(s) · outra guia</p>
                                </div>
                                <div className="rounded-lg bg-white/70 dark:bg-slate-800/60 p-2">
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Dentro do DAS (Simples)</p>
                                    <p className="text-base font-bold text-slate-500 dark:text-slate-400">{fmtBRL(dados.iss.totalIssNoDas)}</p>
                                    <p className="text-[10px] text-slate-500">{dados.iss.issNoDas} empresa(s) · fora do total</p>
                                </div>
                                <div className="rounded-lg bg-white/70 dark:bg-slate-800/60 p-2">
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Bloqueadas / a conferir</p>
                                    <p className="text-base font-bold text-amber-700 dark:text-amber-400">
                                        {dados.iss.semCcm + dados.iss.capturaIncerta + dados.iss.issZerado}
                                    </p>
                                    <p className="text-[10px] text-slate-500">
                                        {dados.iss.semCcm} sem CCM · {dados.iss.capturaIncerta} captura incerta · {dados.iss.issZerado} ISS zerado
                                    </p>
                                </div>
                            </div>
                            {(dados.iss.avisos || []).map((a, i) => (
                                <p key={i} className="text-[11px] text-amber-800 dark:text-amber-300">⚠ {a}</p>
                            ))}
                            {dados.issSaudeCaptura && !dados.issSaudeCaptura.zeroConfiavel && (
                                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                                    ⚠ {dados.issSaudeCaptura.motivo} {dados.issSaudeCaptura.acao}
                                </p>
                            )}
                        </div>
                    )}

                    {/* O QUE O CATÁLOGO ADMITE NÃO SABER.
                        Esta lista existia pronta e testada desde 11/08 e
                        NENHUMA tela chamava — função sem botão é código morto
                        com cara de entrega. Ela fica AQUI, junto do funil, e
                        não numa aba de admin: é o número desta tela que ela
                        qualifica. Sem ela o painel diz "N obrigações" sem dizer
                        que M ficaram fora da conta, e é assim que nasce o "mês
                        fechado" com obrigação que nunca foi listada. */}
                    {!!dados.catalogoPendencias?.length && (
                        <details className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl">
                            <summary className="px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-300 cursor-pointer">
                                ⚠ {dados.catalogoPendencias.length} obrigação(ões) do catálogo ainda não confirmadas —
                                o que este painel NÃO garante
                            </summary>
                            <div className="px-3 pb-3 space-y-1.5">
                                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                                    Prazo de obrigação é definido por órgão, e o catálogo só carimba o que foi conferido.
                                    O que está aqui <strong>não vira tarefa automática</strong> — logo não aparece em
                                    Vencimentos nem na trilha abaixo. Entregue por fora e não dê o mês por fechado
                                    pela lista.
                                </p>
                                {dados.catalogoPendencias.map((p2) => (
                                    <div key={p2.obrigacao} className="text-[11px] text-slate-700 dark:text-slate-300">
                                        <strong>{p2.label}</strong>
                                        <span className="ml-1 px-1 rounded bg-slate-200 dark:bg-slate-700 text-[10px] uppercase">
                                            {p2.esfera}
                                        </span>
                                        <span className="ml-1 font-mono text-[10px] text-slate-500">{p2.abrangencia}</span>
                                        <span className="block text-slate-500 dark:text-slate-400">{p2.motivo}</span>
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}

                    <input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Filtrar por empresa ou CNPJ…"
                        className="w-full text-sm p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                    />

                    {/* FILA DO DIA — quem está mais atrás aparece primeiro. */}
                    <div className="space-y-2">
                        {visiveis.map((r) => {
                            const p = r.proximoPasso;
                            return (
                                <div
                                    key={r.empresa?.id || r.empresa?.cnpj}
                                    className={`bg-white dark:bg-slate-800 rounded-xl border p-3 space-y-2 ${FAROL_CARD[r.farol]}`}
                                >
                                    <div className="flex items-start justify-between gap-2 flex-wrap">
                                        <div>
                                            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{r.empresa?.nome}</p>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                {fmtCnpj(r.empresa?.cnpj || '')} · {r.empresa?.regime === 'simples' ? 'Simples Nacional' : 'Lucro Presumido/Real'}
                                                {' '}· {r.progresso.concluidas}/{r.progresso.total} etapas
                                            </p>
                                        </div>
                                        <Trilha etapas={r.etapas} destaque={p?.id} />
                                    </div>

                                    {/* ISS de SP capital: guia do município, que
                                        não fecha no DAS nem no DARF. Aparece
                                        SEMPRE que a empresa é de SP capital —
                                        inclusive quando não há nada a recolher,
                                        senão ausência vira silêncio. */}
                                    {r.iss && (
                                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                            🏛️ ISS SP:{' '}
                                            {r.iss.pendencias.length > 0 ? (
                                                <span className="text-amber-700 dark:text-amber-400 font-semibold">
                                                    {r.iss.pendencias.join(' · ')} — guia do município, ainda sem envio registrado.
                                                </span>
                                            ) : r.iss.situacao === 'iss-no-das' ? (
                                                <span>
                                                    {r.iss.foraDoTotal > 0
                                                        ? `${fmtBRL(r.iss.foraDoTotal)} nas notas, recolhido dentro do DAS`
                                                        : `${r.iss.notas} nota(s) com ISS zerado — no optante do Simples é o esperado`}
                                                    {' '}— sem guia do município.
                                                </span>
                                            ) : r.iss.situacao === 'sem-ccm' ? (
                                                <span className="text-amber-700 dark:text-amber-400">
                                                    empresa sem CCM — a captura da NFS-e nem roda, então não se sabe se há ISS.
                                                </span>
                                            ) : r.iss.situacao === 'captura-incerta' ? (
                                                <span className="text-amber-700 dark:text-amber-400">
                                                    captura do mês sem sucesso — “zero nota” aqui não significa “sem ISS”.
                                                </span>
                                            ) : r.iss.situacao === 'iss-zerado' ? (
                                                <span className="text-amber-700 dark:text-amber-400">
                                                    {r.iss.notas} nota(s) com ISS zerado — confira isenção/imunidade antes de fechar.
                                                </span>
                                            ) : r.iss.proprioEnviado || r.iss.retidoEnviado ? (
                                                <span className="text-emerald-700 dark:text-emerald-400">guia registrada pelo rito.</span>
                                            ) : (
                                                <span>nada a recolher nesta competência.</span>
                                            )}
                                        </p>
                                    )}

                                    {p ? (
                                        <div className="rounded-lg bg-slate-50 dark:bg-slate-700/40 p-2 flex items-start justify-between gap-3 flex-wrap">
                                            <div className="min-w-[240px] flex-1">
                                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                                                    Próximo passo · {p.ordem}. {p.nome}
                                                </p>
                                                <p className="text-[11px] text-slate-600 dark:text-slate-300">{p.resumo}</p>
                                                {p.acao && <p className="text-[11px] text-blue-700 dark:text-blue-300 mt-0.5">→ {p.acao}</p>}
                                            </div>
                                            <button
                                                onClick={() => onIrPara?.(p.id, r.empresa)}
                                                className="text-[11px] px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
                                            >
                                                Ir para {p.onde.split('→')[0].trim()}
                                            </button>
                                        </div>
                                    ) : null}

                                    {/* 🔒 DAR FIM DE MÊS (26/08).
                                        ⚠️ AQUI ESTAVA O "✓ Mês fechado" — uma DEDUÇÃO: as 5
                                        etapas fecharam, logo o mês fechou. Agora "fechado" é
                                        FATO (quem, quando, qual acervo, quais valores), e as 5
                                        etapas viram a PRÉ-CONDIÇÃO do ato. O booleano mudou de
                                        significado e o leitor entrou no MESMO PR — a régua de
                                        23/08, senão uma tela diria fechado e a outra aberto.

                                        E ele aparece SEMPRE, não só quando não há próximo passo:
                                        com etapa aberta o bloco DIZ o que bloqueia e leva lá —
                                        com a decisão de BLOQUEAR, essa lista é a única saída. */}
                                    {r.empresa?.id && (
                                        <FimDeMesBloco
                                            empresaId={r.empresa.id}
                                            competencia={competencia}
                                            // 📋 Para a declaração de envio fora do app: a
                                            // auditoria de `impostos_enviados` é por CNPJ.
                                            empresaCnpj={r.empresa.cnpj}
                                            empresaNome={r.empresa.nome}
                                            // 🚨 O carimbo e os bloqueios vêm do PAINEL, que já leu
                                            // tudo numa requisição. Cada card buscando o seu era
                                            // ~400 requisições simultâneas — o HTTP 429 de 27/08.
                                            fechamento={r.fechamento || null}
                                            bloqueios={bloqueiosDasEtapas(r.etapas)}
                                            ehAdmin={ehAdmin}
                                            onIrPara={(etapaId) => onIrPara?.(etapaId, r.empresa)}
                                            onMudou={() => carregar(competencia)}
                                        />
                                    )}
                                </div>
                            );
                        })}
                        {visiveis.length === 0 && (
                            <p className="text-sm text-slate-400 text-center py-6">
                                {rotinas.length === 0
                                    ? 'Nenhuma empresa na sua carteira para esta competência.'
                                    : 'Nenhuma empresa com esse filtro.'}
                            </p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default RotinaFiscalPainel;
