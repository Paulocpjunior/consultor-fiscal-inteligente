/**
 * GuiaDoMes — o NORTE do colaborador durante o mês fiscal.
 *
 * Paulo, 07/08: a Carteira de Clientes "deve ser o guia, o norte do colaborador
 * durante o mês fiscal de acordo com as obrigações e vencimentos das empresas
 * que a ele respondem".
 *
 * Uma linha por cliente, na cor certa, ordenada por quem precisa de atenção
 * primeiro — e dentro da mesma cor, por quem vence antes. O colaborador não
 * escolhe por onde começar: pega o de cima.
 *
 * A verdade vem TODA de `/api/admin/rotina-fiscal/painel`, que já é a fonte
 * das cinco etapas, do prazo e do ISS, e que já respeita o escopo de carteira
 * (colaborador vê os dele, admin vê todos). Esta tela não recalcula nada —
 * painel com conta própria diverge sozinho e ninguém percebe até um cliente
 * pagar errado.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import { carregarRotinaFiscal, type PainelRotina } from '../../services/rotinaFiscalService';
import { montarGuiaDoMes, guiaParaPdf, type LinhaGuia, type CorGuia } from '../../services/guiaDoMes';
import { carregarObservacoes, salvarObservacao, type ObservacaoCliente } from '../../services/carteiraObservacoesService';
import { gerarRelatorioPdf } from '../../services/relatorioPdf';

interface Props {
    currentUser: User;
    onShowToast?: (m: string) => void;
    /**
     * ADMIN: de quem é este guia. O backend já entrega TODAS as empresas pro
     * admin, então quem recorta aqui é a tela — e o recorte precisa existir,
     * senão o admin só consegue imprimir a carteira inteira e nunca a de UM
     * colaborador, que é justamente o papel que se entrega pra pessoa.
     *
     * Colaborador não recebe estas props: pra ele a rota já devolve só os
     * clientes dele (getEmpresaIdsDaCarteira), sem filtro de tela nenhum.
     */
    colaboradores?: { uid: string; nome: string }[];
    /** empresaId → uids que respondem por ela (principal e backup). */
    donosPorEmpresa?: Map<string, string[]>;
}

const competenciaAtual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const fmtComp = (c: string) => c.split('-').reverse().join('/');
const fmtCnpj = (c: string) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

/** Cores do farol — as MESMAS do resto do app. */
const CARD: Record<CorGuia, string> = {
    vermelho: 'border-red-300 dark:border-red-700 bg-red-50/40 dark:bg-red-900/10',
    ambar: 'border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-900/10',
    verde: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10',
    cinza: 'border-slate-300 dark:border-slate-600',
};
const SELO: Record<CorGuia, { txt: string; cls: string }> = {
    vermelho: { txt: 'PRECISA DE AÇÃO', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
    ambar: { txt: 'COM RESSALVA', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
    verde: { txt: 'MÊS FECHADO', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
    cinza: { txt: 'SEM DADO', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};
const PONTO: Record<string, string> = {
    concluida: 'bg-emerald-500', na: 'bg-slate-300 dark:bg-slate-600',
    atencao: 'bg-amber-400', pendente: 'bg-red-500',
};
const PRAZO_CLS: Record<string, string> = {
    vermelho: 'text-red-700 dark:text-red-400 font-bold',
    ambar: 'text-amber-700 dark:text-amber-400 font-semibold',
    verde: 'text-slate-500 dark:text-slate-400',
    cinza: 'text-slate-400',
};

const GuiaDoMes: React.FC<Props> = ({ currentUser, onShowToast, colaboradores, donosPorEmpresa }) => {
    const [competencia, setCompetencia] = useState(competenciaAtual());
    const [painel, setPainel] = useState<PainelRotina | null>(null);
    const [obs, setObs] = useState<Record<string, ObservacaoCliente>>({});
    const [carregando, setCarregando] = useState(false);
    const [busca, setBusca] = useState('');
    const [soPendentes, setSoPendentes] = useState(false);
    const [editando, setEditando] = useState<string | null>(null);
    const [rascunho, setRascunho] = useState('');
    // '' = carteira inteira · 'sem' = sem responsável · uid = a carteira de um.
    const [deQuem, setDeQuem] = useState('');
    const podeEscolherDono = !!colaboradores?.length && !!donosPorEmpresa;

    const carregar = useCallback(async (comp: string) => {
        setCarregando(true);
        try {
            const [p, o] = await Promise.all([carregarRotinaFiscal(comp), carregarObservacoes(comp)]);
            setPainel(p);
            setObs(o);
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => { carregar(competencia); }, [carregar, competencia]);

    const guia = useMemo(() => montarGuiaDoMes(painel?.rotinas), [painel]);
    const visiveis = useMemo(() => {
        const termo = busca.trim().toLowerCase();
        return guia.linhas.filter((l) => {
            if (soPendentes && l.cor === 'verde') return false;
            if (podeEscolherDono && deQuem) {
                const donos = donosPorEmpresa!.get(l.empresaId) || [];
                // 'sem' existe pra empresa sem responsável não SUMIR de todas
                // as visões — ela é pendência de atribuição, não invisível.
                if (deQuem === 'sem' ? donos.length > 0 : !donos.includes(deQuem)) return false;
            }
            if (!termo) return true;
            return `${l.nome} ${l.cnpj}`.toLowerCase().includes(termo);
        });
    }, [guia.linhas, busca, soPendentes, deQuem, podeEscolherDono, donosPorEmpresa]);

    /**
     * DE QUEM é o papel impresso. Sem isto o PDF sairia com o nome de quem
     * clicou — o admin imprimiria a carteira da Sandra com o nome dele no
     * cabeçalho, e o papel mentiria sobre a quem aquilo responde.
     */
    const donoDoGuia = !podeEscolherDono
        ? (currentUser.name || currentUser.email || 'minha carteira')
        : deQuem === 'sem'
            ? 'Empresas SEM responsável'
            : deQuem
                ? (colaboradores!.find((c) => c.uid === deQuem)?.nome || deQuem)
                : 'Todos os colaboradores';

    const gravarObs = async (l: LinhaGuia) => {
        const r = await salvarObservacao(l.empresaId, competencia, rascunho);
        if (!r.ok) { onShowToast?.(r.error || 'Falha ao salvar a observação.'); return; }
        setObs((atual) => {
            const copia = { ...atual };
            if (r.apagada) delete copia[l.empresaId];
            else copia[l.empresaId] = { texto: rascunho.trim(), autorNome: currentUser.name || currentUser.email || null, atualizadoEm: new Date().toISOString() };
            return copia;
        });
        setEditando(null);
        onShowToast?.(r.apagada ? 'Observação removida.' : 'Observação salva.');
    };

    const exportarPdf = async () => {
        if (!visiveis.length) { onShowToast?.('Nada para imprimir com este filtro.'); return; }
        try {
            await gerarRelatorioPdf({
                titulo: `Guia do mês — ${podeEscolherDono && !deQuem ? 'todas as carteiras' : 'carteira de clientes'}`,
                subtitulo: `Competência ${fmtComp(competencia)} · ${donoDoGuia} · ${visiveis.length} cliente(s)`,
                colunas: [
                    { titulo: 'Cliente', largura: 16 },
                    { titulo: 'Regime', largura: 6 },
                    { titulo: 'Situação', largura: 8 },
                    { titulo: 'Etapas', largura: 5 },
                    { titulo: 'Prazo', largura: 13 },
                    { titulo: 'Obrigações', largura: 16 },
                    { titulo: 'Captura', largura: 14 },
                    { titulo: 'Próximo passo', largura: 22 },
                ],
                linhas: guiaParaPdf(visiveis),
                observacoes: [
                    'Cada etapa nasce de dado real do sistema — nada aqui se marca como feito à mão.',
                    'Situação: ATENÇÃO = alguma etapa pendente ou obrigação atrasada · RESSALVA = etapa feita pela metade · FECHADO = as cinco etapas com prova.',
                    ...(guia.resumo.atrasadas > 0
                        ? [`ATENÇÃO: ${guia.resumo.atrasadas} obrigação(ões) já vencida(s) nesta carteira.`] : []),
                    // Papel cortado SEMPRE diz o que ficou de fora — senão
                    // quem recebe lê a folha como se fosse a carteira inteira.
                    ...(visiveis.length < guia.linhas.length
                        ? [`Recorte: ${donoDoGuia} — ${visiveis.length} de ${guia.linhas.length} cliente(s) da seleção.`] : []),
                ],
                orientacao: 'landscape',
                fileName: `guia-do-mes-${competencia}${podeEscolherDono && deQuem ? `-${donoDoGuia.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}.pdf`,
            });
        } catch (e: any) {
            onShowToast?.(`Falha ao gerar o PDF: ${e.message}`);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">🧭 Guia do mês</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                            Seus clientes, na ordem de quem precisa de atenção primeiro — e, dentro da mesma cor,
                            por quem <strong>vence antes</strong>. Cada linha traz o prazo, a captura, as obrigações
                            e a única coisa a fazer agora. Comece pelo de cima.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                            className="text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700" />
                        <button onClick={() => carregar(competencia)} disabled={carregando}
                            className="text-xs px-3 py-1.5 rounded bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50">
                            {carregando ? 'Lendo…' : '⟲ Atualizar'}
                        </button>
                        <button onClick={exportarPdf} disabled={carregando || !visiveis.length}
                            className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                            🖨 Imprimir em PDF
                        </button>
                    </div>
                </div>
            </div>

            {painel && !painel.ok && (
                <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
                    {painel.error}
                </div>
            )}

            {painel?.ok && (
                <>
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{guia.resumo.frase}</p>
                        {/* Os números acima são da SELEÇÃO INTEIRA. Com filtro
                            ligado, dizer isso evita que o admin leia "12
                            precisam de ação" como se fosse da Sandra. */}
                        {podeEscolherDono && deQuem && (
                            <p className="text-[11px] text-blue-600 dark:text-blue-400">
                                Mostrando <strong>{donoDoGuia}</strong>: {visiveis.length} cliente(s).
                                Os números abaixo continuam sendo da carteira inteira —
                                o PDF sai só com o que está filtrado.
                                <button onClick={() => setDeQuem('')} className="underline ml-1">ver todos</button>
                            </p>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div className="rounded-lg border border-red-200 dark:border-red-800 p-2">
                                <p className="text-[10px] uppercase font-bold text-red-700 dark:text-red-400">Precisam de ação</p>
                                <p className="text-lg font-bold text-red-700 dark:text-red-400">{guia.resumo.vermelhas}</p>
                            </div>
                            <div className="rounded-lg border border-amber-200 dark:border-amber-800 p-2">
                                <p className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">Com ressalva</p>
                                <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{guia.resumo.ambares}</p>
                            </div>
                            <div className="rounded-lg border border-amber-200 dark:border-amber-800 p-2">
                                <p className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">Vencem nesta semana</p>
                                <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{guia.resumo.naSemana}</p>
                                {guia.resumo.atrasadas > 0 && (
                                    <p className="text-[10px] font-bold text-red-700 dark:text-red-400">
                                        {guia.resumo.atrasadas} já vencida(s)
                                    </p>
                                )}
                            </div>
                            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 p-2">
                                <p className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">Mês fechado</p>
                                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{guia.resumo.fechadas}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                            {/* ADMIN escolhe DE QUEM é o guia. Sem isto ele só
                                consegue ver e imprimir a carteira inteira, e
                                nunca a de UM colaborador — que é justamente o
                                papel que se entrega pra pessoa. */}
                            {podeEscolherDono && (
                                <select value={deQuem} onChange={(e) => setDeQuem(e.target.value)}
                                    className="text-sm p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
                                    <option value="">Guia de: todos os colaboradores</option>
                                    {colaboradores!.map((c) => (
                                        <option key={c.uid} value={c.uid}>Guia de: {c.nome}</option>
                                    ))}
                                    <option value="sem">Empresas SEM responsável</option>
                                </select>
                            )}
                            <input value={busca} onChange={(e) => setBusca(e.target.value)}
                                placeholder="Filtrar por cliente ou CNPJ…"
                                className="flex-1 min-w-[220px] text-sm p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" />
                            <label className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} />
                                Só os que precisam de mim
                            </label>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {visiveis.map((l) => {
                            const o = obs[l.empresaId];
                            return (
                                <div key={l.empresaId} className={`rounded-xl border p-3 space-y-2 ${CARD[l.cor]}`}>
                                    <div className="flex items-start justify-between gap-2 flex-wrap">
                                        <div>
                                            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{l.nome}</p>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                {fmtCnpj(l.cnpj)} · {l.regime === 'simples' ? 'Simples Nacional' : 'Lucro Presumido/Real'} · {l.progresso} etapas
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${SELO[l.cor].cls}`}>{SELO[l.cor].txt}</span>
                                            {/* Trilha das 5 etapas — a mesma da Rotina do mês. */}
                                            <div className="flex items-center gap-1">
                                                {l.etapas.map((e) => (
                                                    <span key={e.id} title={`${e.nome}: ${e.status}`}
                                                        className={`w-2.5 h-2.5 rounded-full ${PONTO[e.status] || 'bg-slate-300'}`} />
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid md:grid-cols-3 gap-2 text-[11px]">
                                        <p className={PRAZO_CLS[l.prazo?.cor || 'cinza']}>
                                            ⏱ {l.prazo ? `${l.prazo.obrigacao} — ${l.prazo.rotulo}` : 'Sem obrigação aberta com data.'}
                                            {l.atrasadas > 0 && <span className="text-red-700 dark:text-red-400"> · {l.atrasadas} atrasada(s)</span>}
                                        </p>
                                        <p className="text-slate-600 dark:text-slate-300">📄 {l.captura}</p>
                                        <p className="text-slate-600 dark:text-slate-300">📋 {l.obrigacoes}</p>
                                    </div>

                                    {l.iss && (
                                        <p className="text-[11px] text-amber-700 dark:text-amber-400">🏛️ ISS: {l.iss}</p>
                                    )}

                                    {l.proximoPasso ? (
                                        <p className="text-[11px] text-blue-700 dark:text-blue-300">
                                            → <strong>{l.proximoPasso}</strong>{l.onde ? ` (${l.onde})` : ''}
                                        </p>
                                    ) : (
                                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">
                                            ✓ Mês fechado: capturado, validado, apurado, obrigações entregues e guia enviada com o rito.
                                        </p>
                                    )}

                                    {/* OBSERVAÇÃO: o que só a pessoa sabe. Não conserta
                                        cadastro — cadastro torto continua acendendo
                                        alerta na tela dele. */}
                                    {editando === l.empresaId ? (
                                        <div className="space-y-1">
                                            <textarea value={rascunho} onChange={(e) => setRascunho(e.target.value)}
                                                rows={2} maxLength={2000}
                                                placeholder="Ex.: cliente pediu prazo até dia 20 · aguardando XML do contador dele"
                                                className="w-full text-[11px] p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" />
                                            <div className="flex gap-2">
                                                <button onClick={() => gravarObs(l)}
                                                    className="text-[11px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Salvar</button>
                                                <button onClick={() => setEditando(null)}
                                                    className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600">Cancelar</button>
                                                <span className="text-[10px] text-slate-400 self-center">Vazio apaga a observação.</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <button onClick={() => { setEditando(l.empresaId); setRascunho(o?.texto || ''); }}
                                            className="text-left w-full text-[11px] text-slate-600 dark:text-slate-300 hover:underline">
                                            {o?.texto
                                                ? <>📝 {o.texto} <span className="text-slate-400">— {o.autorNome || 'alguém'}</span></>
                                                : <span className="text-slate-400">📝 Anotar uma observação deste cliente…</span>}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                        {visiveis.length === 0 && (
                            <p className="text-sm text-slate-400 text-center py-6">
                                {guia.linhas.length === 0
                                    ? 'Nenhuma empresa na sua carteira nesta competência.'
                                    : 'Nenhum cliente com esse filtro.'}
                            </p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default GuiaDoMes;
