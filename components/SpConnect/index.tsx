// ============================================================================
// 💬 SP CONNECT — inbox do WhatsApp (F2, PR 1: LEITURA)
// ----------------------------------------------------------------------------
// Nesta fase a tela LÊ e não responde (responder é o PR 2) — a Ultra Fox
// segue sendo onde a equipe responde. O valor daqui já é real: ver a conversa
// com o STATUS honesto de entrega (entregue/lido/falhou + motivo) e o estado
// da janela de 24h, que nenhuma outra tela mostra.
//
// MOBILE-FIRST (a Ultra Fox vive no bolso da equipe): no celular/tablet a
// navegação é em PILHA (lista → conversa, com voltar); no desktop, duas
// colunas. O composer aparece DESABILITADO dizendo o porquê — botão que some
// faz a equipe achar que a função não existe.
// ============================================================================
import React, { useCallback, useEffect, useState } from 'react';
import { listarConversas, listarMensagens, marcarLida } from '../../services/spConnectService';
import {
    ConversaResumo, MensagemInbox, estadoJanela, carimboStatus,
    nomeExibicao, formatarNumeroBr, horaCurta, rotuloMidia,
} from '../../services/spConnect';

const TOM_TICK: Record<string, string> = {
    ok: 'text-emerald-600 dark:text-emerald-400',
    lido: 'text-sky-600 dark:text-sky-400',
    falha: 'text-red-600 dark:text-red-400',
    neutro: 'text-slate-400',
};

const SpConnect: React.FC<{ currentUser: { role: string } }> = () => {
    const [conversas, setConversas] = useState<ConversaResumo[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [sel, setSel] = useState<ConversaResumo | null>(null);
    const [mensagens, setMensagens] = useState<MensagemInbox[]>([]);
    const [carregandoMsgs, setCarregandoMsgs] = useState(false);

    const recarregar = useCallback(async () => {
        setCarregando(true);
        setErro(null);
        try {
            const r = await listarConversas();
            if (!r.ok) { setErro(r.error || 'Falha ao carregar as conversas.'); return; }
            setConversas(r.conversas || []);
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => { recarregar(); }, [recarregar]);

    const abrir = async (c: ConversaResumo) => {
        setSel(c);
        setMensagens([]);
        setCarregandoMsgs(true);
        try {
            const r = await listarMensagens(c.numero);
            if (r.ok) setMensagens(r.mensagens || []);
            if (c.naoLidas > 0) {
                marcarLida(c.numero); // fire-and-forget: abrir É ler
                setConversas((lst) => lst.map((x) => (x.numero === c.numero ? { ...x, naoLidas: 0 } : x)));
            }
        } finally {
            setCarregandoMsgs(false);
        }
    };

    const agora = new Date();
    const janela = sel ? estadoJanela(sel.janela24hAte, agora) : null;

    return (
        <div className="max-w-6xl mx-auto animate-fade-in">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">💬 SP Connect</h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Conversas do WhatsApp oficial do escritório — nesta fase a tela é de LEITURA;
                        a resposta ao cliente continua na plataforma atual até a próxima etapa.
                    </p>
                </div>
                <button
                    onClick={recarregar}
                    disabled={carregando}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold disabled:opacity-50 whitespace-nowrap btn-press"
                >
                    {carregando ? 'Atualizando…' : '🔄 Atualizar'}
                </button>
            </div>

            {erro && (
                <p className="text-xs px-3 py-2 rounded bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 mb-2">{erro}</p>
            )}

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden md:grid md:grid-cols-[320px_minmax(0,1fr)]" style={{ minHeight: '60vh' }}>

                {/* ── Lista de conversas (no celular some quando uma está aberta) ── */}
                <div className={`${sel ? 'hidden md:block' : ''} md:border-r border-slate-200 dark:border-slate-700 overflow-y-auto`} style={{ maxHeight: '75vh' }}>
                    {conversas.length === 0 && !carregando ? (
                        <div className="p-4 text-xs text-slate-500 dark:text-slate-400 space-y-2">
                            <p className="font-semibold">Nenhuma conversa ainda.</p>
                            <p>As conversas aparecem aqui quando o recebimento (webhook da Meta) estiver
                                ligado e o primeiro cliente escrever. O status do recebimento está em
                                ⚙️ Config Admin → 📡 (admin).</p>
                            <p>Lista vazia NÃO prova ausência de mensagens no WhatsApp — só que nada
                                chegou por este trilho.</p>
                        </div>
                    ) : (
                        conversas.map((c) => {
                            const j = estadoJanela(c.janela24hAte, agora);
                            return (
                                <button
                                    key={c.numero}
                                    onClick={() => abrir(c)}
                                    className={`w-full text-left px-3 py-2.5 border-b border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/40 ${sel?.numero === c.numero ? 'bg-sky-50 dark:bg-sky-900/20 border-l-2 border-l-sky-500' : ''}`}
                                >
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{nomeExibicao(c)}</span>
                                        <span className="text-[10px] text-slate-400 shrink-0">{horaCurta(c.ultimaMensagem?.em || c.atualizadoEm, agora)}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 mt-0.5">
                                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                            {c.ultimaMensagem?.resumo || '—'}
                                        </span>
                                        {c.naoLidas > 0 && (
                                            <span className="shrink-0 text-[10px] font-bold bg-sky-600 text-white rounded-full px-1.5 py-0.5">{c.naoLidas}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300">
                                            {c.fila ? c.fila : 'Recepção'}
                                        </span>
                                        {j.aberta && (
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">janela aberta</span>
                                        )}
                                        {!c.empresaId && (
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">vincular ao cliente</span>
                                        )}
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>

                {/* ── Thread (no celular ocupa a tela; botão voltar) ─────────────── */}
                <div className={`${sel ? '' : 'hidden md:flex'} flex flex-col`} style={{ maxHeight: '75vh' }}>
                    {!sel ? (
                        <div className="flex-1 grid place-items-center text-xs text-slate-400 p-6">
                            Escolha uma conversa ao lado.
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                                <button onClick={() => setSel(null)} className="md:hidden text-slate-500 px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 btn-press" title="voltar">←</button>
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{nomeExibicao(sel)}</p>
                                    <p className="text-[10px] text-slate-400">{formatarNumeroBr(sel.numero)}{sel.empresaId ? '' : ' · sem vínculo com o cadastro'}</p>
                                </div>
                            </div>

                            {janela && (
                                <div className={`px-3 py-1.5 text-[11px] font-semibold ${janela.aberta
                                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'}`}>
                                    {janela.rotulo}
                                </div>
                            )}

                            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/60 dark:bg-slate-900/30">
                                {carregandoMsgs ? (
                                    <p className="text-xs text-slate-400 text-center">Carregando…</p>
                                ) : mensagens.length === 0 ? (
                                    <p className="text-xs text-slate-400 text-center">Nenhuma mensagem gravada nesta conversa.</p>
                                ) : (
                                    mensagens.map((m) => {
                                        const tick = carimboStatus(m.statusEntrega);
                                        const midia = rotuloMidia(m.midia, m.tipo);
                                        return (
                                            <div key={m.id} className={`max-w-[80%] rounded-xl px-3 py-2 text-[13px] shadow-sm ${m.direcao === 'saida'
                                                ? 'ml-auto bg-sky-100 dark:bg-sky-900/40 text-slate-800 dark:text-slate-100 rounded-tr-sm'
                                                : 'mr-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-tl-sm'}`}>
                                                {midia && <p className="text-[11px] font-semibold mb-0.5">{midia}</p>}
                                                {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
                                                {!m.texto && !midia && <p className="italic text-slate-400">({m.tipo || 'mensagem'})</p>}
                                                <p className="text-[10px] text-slate-400 text-right mt-0.5">
                                                    {horaCurta(m.timestamp, agora)}
                                                    {m.direcao === 'saida' && (
                                                        <span className={`ml-1 font-bold ${TOM_TICK[tick.tom]}`}>{tick.simbolo} {tick.rotulo}</span>
                                                    )}
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
                            </div>

                            {/* Composer desabilitado COM o porquê — some seria pior. */}
                            <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-800">
                                <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-2 text-[11px] text-slate-400">
                                    ✍️ Responder por aqui chega na próxima etapa do SP Connect — por enquanto,
                                    a resposta ao cliente continua na plataforma de atendimento atual.
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SpConnect;
