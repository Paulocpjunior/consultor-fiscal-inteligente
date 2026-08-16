// ============================================================================
// 💬 SP CONNECT — o app de atendimento (substitui a Ultra Fox)
// ----------------------------------------------------------------------------
// A régua é a do Paulo (16/08): "parecido e MELHOR que a Ultra Fox". Isto é a
// tela do mockup aprovado: 3 colunas — conversas (busca + filtros) · thread
// (balões com status real de entrega) · cliente — com RESPOSTA de texto livre
// dentro da janela de 24h (PR 2). Fora da janela o composer vira aviso de
// template: a trava é do backend, a tela só a mostra.
//
// MOBILE-FIRST: no celular vira pilha (lista → conversa, com voltar); a
// coluna do cliente aparece só em telas largas (xl).
// A lista se atualiza sozinha a cada 30s — atendimento não vive de F5.
// ============================================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listarConversas, listarMensagens, marcarLida, responderConversa } from '../../services/spConnectService';
import {
    ConversaResumo, MensagemInbox, estadoJanela, carimboStatus,
    nomeExibicao, formatarNumeroBr, horaCurta, rotuloMidia,
    filtrarConversas, iniciais,
} from '../../services/spConnect';

const TOM_TICK: Record<string, string> = {
    ok: 'text-emerald-600 dark:text-emerald-400',
    lido: 'text-sky-500 dark:text-sky-400',
    falha: 'text-red-600 dark:text-red-400',
    neutro: 'text-slate-400',
};

type Aba = 'todas' | 'nao-lidas' | 'recepcao';

const SpConnect: React.FC<{ currentUser: { role: string; email?: string } }> = () => {
    const [conversas, setConversas] = useState<ConversaResumo[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [busca, setBusca] = useState('');
    const [aba, setAba] = useState<Aba>('todas');
    const [sel, setSel] = useState<ConversaResumo | null>(null);
    const [mensagens, setMensagens] = useState<MensagemInbox[]>([]);
    const [carregandoMsgs, setCarregandoMsgs] = useState(false);
    const [texto, setTexto] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [erroEnvio, setErroEnvio] = useState<string | null>(null);
    const fimDaThread = useRef<HTMLDivElement>(null);
    const selRef = useRef<ConversaResumo | null>(null);
    selRef.current = sel;

    const recarregar = useCallback(async (silencioso = false) => {
        if (!silencioso) setCarregando(true);
        try {
            const r = await listarConversas();
            if (!r.ok) { if (!silencioso) setErro(r.error || 'Falha ao carregar as conversas.'); return; }
            setErro(null);
            setConversas(r.conversas || []);
        } finally {
            if (!silencioso) setCarregando(false);
        }
    }, []);

    const carregarThread = useCallback(async (numero: string, silencioso = false) => {
        if (!silencioso) setCarregandoMsgs(true);
        try {
            const r = await listarMensagens(numero);
            if (r.ok && selRef.current?.numero === numero) setMensagens(r.mensagens || []);
        } finally {
            if (!silencioso) setCarregandoMsgs(false);
        }
    }, []);

    // Atendimento não vive de F5: lista e thread aberta se renovam a cada 30s.
    useEffect(() => {
        recarregar();
        const timer = setInterval(() => {
            recarregar(true);
            if (selRef.current) carregarThread(selRef.current.numero, true);
        }, 30_000);
        return () => clearInterval(timer);
    }, [recarregar, carregarThread]);

    useEffect(() => {
        fimDaThread.current?.scrollIntoView({ block: 'end' });
    }, [mensagens.length]);

    const abrir = async (c: ConversaResumo) => {
        setSel(c);
        setMensagens([]);
        setErroEnvio(null);
        carregarThread(c.numero);
        if (c.naoLidas > 0) {
            marcarLida(c.numero); // abrir É ler
            setConversas((lst) => lst.map((x) => (x.numero === c.numero ? { ...x, naoLidas: 0 } : x)));
        }
    };

    const enviar = async () => {
        if (!sel || !texto.trim() || enviando) return;
        setEnviando(true);
        setErroEnvio(null);
        try {
            const r = await responderConversa(sel.numero, texto.trim());
            if (!r.ok) {
                setErroEnvio(`${r.error}${(r as any).acao ? ` ${(r as any).acao}` : ''}`);
                return;
            }
            setMensagens((m) => [...m, r.mensagem]);
            setTexto('');
        } finally {
            setEnviando(false);
        }
    };

    const agora = new Date();
    const janela = sel ? estadoJanela(sel.janela24hAte, agora) : null;
    const visiveis = filtrarConversas(conversas, { busca, aba });
    const naoLidasTotal = conversas.reduce((s, c) => s + (c.naoLidas || 0), 0);

    const chip = (a: Aba, rotulo: string) => (
        <button
            key={a}
            onClick={() => setAba(a)}
            className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${aba === a
                ? 'bg-sky-600 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
        >
            {rotulo}
        </button>
    );

    return (
        <div className="max-w-[1400px] mx-auto animate-fade-in">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden md:grid md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_280px]" style={{ height: 'calc(100vh - 140px)', minHeight: '480px' }}>

                {/* ═══ COLUNA 1 — CONVERSAS ═══════════════════════════════════ */}
                <div className={`${sel ? 'hidden md:flex' : 'flex'} flex-col md:border-r border-slate-200 dark:border-slate-700 min-h-0`}>
                    <div className="p-2.5 space-y-2 border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Conversas</p>
                            <button onClick={() => recarregar()} disabled={carregando} title="Atualizar agora (a lista também se atualiza sozinha a cada 30s)"
                                className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50">
                                {carregando ? '…' : '🔄'}
                            </button>
                        </div>
                        <input
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="🔎 Nome, número ou mensagem…"
                            className="w-full px-2.5 py-1.5 text-[12px] rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                        />
                        <div className="flex gap-1.5 flex-wrap">
                            {chip('todas', `Todas · ${conversas.length}`)}
                            {chip('nao-lidas', `Não lidas · ${naoLidasTotal}`)}
                            {chip('recepcao', 'Recepção')}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0">
                        {visiveis.length === 0 && !carregando ? (
                            <div className="p-4 text-[11px] text-slate-500 dark:text-slate-400 space-y-1.5">
                                {conversas.length === 0 ? (
                                    <>
                                        <p className="font-semibold">Nenhuma conversa ainda.</p>
                                        <p>Elas aparecem aqui quando um cliente escrever pro número do escritório.
                                            Lista vazia não prova ausência de mensagens — só que nada chegou por este trilho.</p>
                                    </>
                                ) : (
                                    <p>Nada casa com esse filtro/busca.</p>
                                )}
                            </div>
                        ) : (
                            visiveis.map((c) => {
                                const j = estadoJanela(c.janela24hAte, agora);
                                const ativa = sel?.numero === c.numero;
                                return (
                                    <button
                                        key={c.numero}
                                        onClick={() => abrir(c)}
                                        className={`w-full text-left px-3 py-2.5 border-b border-slate-100 dark:border-slate-700/60 flex gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 ${ativa ? 'bg-sky-50 dark:bg-sky-900/20 border-l-[3px] border-l-sky-500' : 'border-l-[3px] border-l-transparent'}`}
                                    >
                                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white grid place-items-center text-[12px] font-bold shrink-0 mt-0.5">
                                            {iniciais(c)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{nomeExibicao(c)}</span>
                                                <span className="text-[10px] text-slate-400 shrink-0">{horaCurta(c.ultimaMensagem?.em || c.atualizadoEm, agora)}</span>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                                    {c.ultimaMensagem?.direcao === 'saida' ? '↩ ' : ''}{c.ultimaMensagem?.resumo || '—'}
                                                </span>
                                                {c.naoLidas > 0 && (
                                                    <span className="shrink-0 text-[10px] font-bold bg-emerald-500 text-white rounded-full min-w-[18px] text-center px-1 py-0.5">{c.naoLidas}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                                <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300">{c.fila || 'Recepção'}</span>
                                                {j.aberta && <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">janela aberta</span>}
                                                {!c.empresaId && <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">vincular</span>}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* ═══ COLUNA 2 — THREAD ══════════════════════════════════════ */}
                <div className={`${sel ? 'flex' : 'hidden md:flex'} flex-col min-h-0 min-w-0 bg-slate-50/70 dark:bg-slate-900/40`}>
                    {!sel ? (
                        <div className="flex-1 grid place-items-center p-6 text-center">
                            <div className="text-slate-400">
                                <p className="text-3xl mb-2">💬</p>
                                <p className="text-sm font-semibold">Escolha uma conversa ao lado</p>
                                <p className="text-[11px] mt-1">Responda na janela de 24h; fora dela, template aprovado.</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center gap-2.5 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                                <button onClick={() => setSel(null)} className="md:hidden text-slate-500 px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700" title="voltar">←</button>
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white grid place-items-center text-[11px] font-bold shrink-0">{iniciais(sel)}</div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100 truncate">{nomeExibicao(sel)}</p>
                                    <p className="text-[10px] text-slate-400 truncate">{formatarNumeroBr(sel.numero)} · {sel.fila || 'Recepção'}</p>
                                </div>
                            </div>

                            {janela && (
                                <div className={`px-3 py-1 text-[11px] font-semibold flex items-center gap-1.5 ${janela.aberta
                                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${janela.aberta ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                    {janela.rotulo}
                                </div>
                            )}

                            <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1.5">
                                {carregandoMsgs ? (
                                    <p className="text-xs text-slate-400 text-center mt-4">Carregando…</p>
                                ) : mensagens.length === 0 ? (
                                    <p className="text-xs text-slate-400 text-center mt-4">Nenhuma mensagem gravada nesta conversa.</p>
                                ) : (
                                    mensagens.map((m) => {
                                        const tick = carimboStatus(m.statusEntrega);
                                        const midia = rotuloMidia(m.midia, m.tipo);
                                        const saida = m.direcao === 'saida';
                                        return (
                                            <div key={m.id} className={`max-w-[78%] w-fit rounded-xl px-3 py-1.5 text-[13px] shadow-sm ${saida
                                                ? 'ml-auto bg-emerald-100 dark:bg-emerald-900/50 text-slate-800 dark:text-slate-100 rounded-br-sm'
                                                : 'mr-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm'}`}>
                                                {midia && <p className="text-[11px] font-semibold mb-0.5">{midia}</p>}
                                                {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
                                                {!m.texto && !midia && <p className="italic text-slate-400">({m.tipo || 'mensagem'})</p>}
                                                <p className="text-[9px] text-slate-400 text-right mt-0.5 leading-none">
                                                    {(m as any).enviadoPor ? `${(m as any).enviadoPor.split('@')[0]} · ` : ''}
                                                    {horaCurta(m.timestamp, agora)}
                                                    {saida && <span className={`ml-1 font-bold ${TOM_TICK[tick.tom]}`}>{tick.simbolo}</span>}
                                                </p>
                                                {m.erroEntrega?.acao && (
                                                    <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">
                                                        {m.erroEntrega.codigo ? `(${m.erroEntrega.codigo}) ` : ''}{m.erroEntrega.acao}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={fimDaThread} />
                            </div>

                            {/* Composer: livre com a janela aberta; fora dela, o caminho é dito. */}
                            <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-800">
                                {erroEnvio && <p className="text-[11px] text-red-600 dark:text-red-400 mb-1.5">{erroEnvio}</p>}
                                {janela?.aberta ? (
                                    <div className="flex items-end gap-2">
                                        <textarea
                                            value={texto}
                                            onChange={(e) => setTexto(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                                            placeholder="Escreva a resposta… (Enter envia, Shift+Enter quebra linha)"
                                            rows={Math.min(4, Math.max(1, texto.split('\n').length))}
                                            className="flex-1 resize-none px-3 py-2 text-[13px] rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                                        />
                                        <button
                                            onClick={enviar}
                                            disabled={enviando || !texto.trim()}
                                            className="shrink-0 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold disabled:opacity-40"
                                        >
                                            {enviando ? '…' : 'Enviar ➤'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="rounded-xl border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                                        📋 Janela de 24h fechada — o envio inicial sai por <strong>template aprovado</strong> (regra da Meta).
                                        O envio de template direto daqui chega na próxima etapa; por enquanto use o envio de guia/template das telas do módulo.
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* ═══ COLUNA 3 — CLIENTE (só telas largas) ═══════════════════ */}
                <div className="hidden xl:flex flex-col border-l border-slate-200 dark:border-slate-700 p-3 gap-2.5 overflow-y-auto min-h-0">
                    {!sel ? (
                        <p className="text-[11px] text-slate-400 mt-2">Os dados do cliente aparecem aqui quando uma conversa estiver aberta.</p>
                    ) : (
                        <>
                            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-2.5">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Contato</p>
                                <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{nomeExibicao(sel)}</p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">{formatarNumeroBr(sel.numero)}</p>
                            </div>
                            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-2.5">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Cliente · cadastro central</p>
                                {sel.empresaId ? (
                                    <p className="text-[11px] text-slate-600 dark:text-slate-300">Vinculado (empresa {sel.empresaId}).</p>
                                ) : (
                                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                        Sem vínculo com o cadastro — o botão de vincular chega na próxima etapa,
                                        junto da importação de contatos.
                                    </p>
                                )}
                            </div>
                            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-2.5">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Conversa</p>
                                <p className="text-[11px] text-slate-600 dark:text-slate-300">Fila: <strong>{sel.fila || 'Recepção'}</strong></p>
                                <p className="text-[11px] text-slate-600 dark:text-slate-300">Atribuída a: <strong>{sel.atribuidoA || 'ninguém ainda'}</strong></p>
                                <p className="text-[11px] text-slate-600 dark:text-slate-300">Situação: <strong>{sel.situacao}</strong></p>
                            </div>
                            <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-2.5 text-[10px] text-slate-400">
                                Próximas etapas nesta coluna: guias enviadas ao cliente (rito #293), transferir de fila,
                                notas internas e resolver conversa.
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SpConnect;
