import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, ExternalLink, LoaderCircle, RotateCcw, Search, X } from 'lucide-react';
import { useEmpresaAtiva } from '../../services/empresaAtivaContext';
import { consultarFisca, type FiscaMensagem, type FiscaResposta } from '../../services/fiscaService';
import SafeMarkdown from '../SafeMarkdown';
import './fisca.css';

type Mensagem = FiscaMensagem & { resposta?: FiscaResposta };

function Evidencias({ resposta }: { resposta: FiscaResposta }) {
    const { contexto, fontes } = resposta;
    return <div className="fisca-evidence">
        {contexto.acervo && <details>
            <summary><Search size={13} /> Conferência do acervo · {contexto.acervo.registrosConsultados} registros{contexto.acervo.limitado ? ' · parcial' : ''}</summary>
            <div className="fisca-evidence-body">
                <p>{contexto.acervo.escopo}</p>
                {contexto.acervo.limitado && <p><strong>Limite de {contexto.acervo.limite} registros atingido. Há registros não analisados.</strong></p>}
                <p>Retirados ou mesclados (sem alertas): {contexto.acervo.retirados.length}.</p>
                <p>Direção não informada ou inválida: {contexto.acervo.semDirecao.length}.</p>
                {contexto.acervo.semDirecao.length > 0 && <p>IDs: {contexto.acervo.semDirecao.join(', ')}</p>}
                <p>Grupos com possível repetição de chave: {contexto.acervo.possiveisRepeticoes.length}.</p>
                {contexto.acervo.possiveisRepeticoes.map((ids, i) => <p key={i}>IDs: {ids.join(', ')}</p>)}
                <p>Status dos registros: {Object.entries(contexto.acervo.status).map(([k, v]) => `${k}: ${v}`).join('; ') || 'nenhum registro encontrado'}.</p>
                <p>Fonte: documentos_fiscais · empresa {contexto.empresa?.id} · competência {contexto.competencia}.</p>
            </div>
        </details>}
        {fontes.length > 0 && <details><summary><ExternalLink size={13} /> Fontes da pesquisa ({fontes.length})</summary>
            <ul>{fontes.map(f => /^https?:\/\//i.test(f.url) && <li key={f.url}><a href={f.url} target="_blank" rel="noopener noreferrer">{f.titulo} <ExternalLink size={11} /></a></li>)}</ul>
        </details>}
        <p className="fisca-stamp">{contexto.fonteCadastro ? `Cadastro: ${contexto.fonteCadastro} · ` : ''}{new Date(contexto.consultadoEm).toLocaleString('pt-BR')}</p>
    </div>;
}

export default function FiscaAssistant() {
    const { empresa } = useEmpresaAtiva();
    const [aberta, setAberta] = useState(false);
    const [competencia, setCompetencia] = useState('');
    const [mensagens, setMensagens] = useState<Mensagem[]>([]);
    const [texto, setTexto] = useState('');
    const [ocupada, setOcupada] = useState(false);
    const [erro, setErro] = useState('');
    const controller = useRef<AbortController | null>(null);
    const launcher = useRef<HTMLButtonElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);
    const fim = useRef<HTMLDivElement>(null);

    useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
    useEffect(() => { if (aberta) input.current?.focus(); }, [aberta]);
    useEffect(() => { if (aberta) fim.current?.scrollIntoView?.({ block: 'nearest' }); }, [mensagens, ocupada, aberta]);
    const fechar = () => { setAberta(false); launcher.current?.focus(); };
    const limpar = () => {
        controller.current?.abort(); controller.current = null;
        setMensagens([]); setErro(''); setOcupada(false); setTexto('');
    };
    const enviar = async (mensagem: string, analisarAcervo = false) => {
        if (controller.current || !mensagem.trim()) return;
        const abort = new AbortController(); controller.current = abort;
        setOcupada(true); setErro(''); setTexto('');
        const anteriores = mensagens;
        setMensagens([...anteriores, { role: 'user', text: mensagem }]);
        const timeout = window.setTimeout(() => abort.abort(), 60000);
        try {
            const resposta = await consultarFisca({ mensagem, empresaId: empresa?.id, fonte: empresa?.fonte,
                competencia: competencia || undefined, analisarAcervo,
                historico: anteriores.slice(-12).map(m => ({ role: m.role, text: m.text.slice(0, 8000) })),
            }, abort.signal);
            if (abort.signal.aborted) return;
            setMensagens([...anteriores, { role: 'user', text: mensagem }, { role: 'assistant', text: resposta.texto, resposta }]);
        } catch (e) {
            if (controller.current !== abort) return;
            setMensagens(anteriores); setTexto(mensagem);
            setErro(abort.signal.aborted ? 'A consulta demorou mais que o esperado. Tente novamente.' : e instanceof Error ? e.message : 'Não foi possível concluir a consulta.');
        } finally {
            window.clearTimeout(timeout);
            if (controller.current === abort) { controller.current = null; setOcupada(false); }
        }
    };

    return <div className="fisca-root">
        {aberta && <section className="fisca-panel" role="region" aria-label="Conversa com a Físca" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } }}>
            <header className="fisca-header">
                <img src="/fisca-corujinha.svg" alt="" className={ocupada ? 'fisca-avatar fisca-thinking' : 'fisca-avatar'} />
                <div className="fisca-heading"><h2>Físca <span>IA</span></h2><p>Sua assistente fiscal</p></div>
                <button type="button" aria-label="Limpar conversa" title="Limpar conversa" onClick={limpar}><RotateCcw size={17} /></button>
                <button type="button" aria-label="Fechar Físca" onClick={fechar}><X size={20} /></button>
            </header>
            <div className="fisca-context">
                <div><span className="fisca-dot" /><span title={empresa?.nome}>{empresa?.nome || 'Orientação geral · sem empresa ativa'}</span></div>
                <label>Competência da conversa<input type="month" aria-label="Competência da conversa" min="2000-01" max="2099-12" value={competencia} onChange={e => { limpar(); setCompetencia(e.target.value); }} /></label>
            </div>
            <div className="fisca-conversation" role="log" aria-label="Mensagens da conversa" aria-live="polite" aria-relevant="additions">
                {mensagens.length === 0 && <div className="fisca-welcome">
                    <img src="/fisca-corujinha.svg" alt="Físca, uma corujinha azul e turquesa com lupa" />
                    <span className="fisca-eyebrow">UM OLHAR ATENTO À SUA ROTINA</span>
                    <h3>Olá, sou a Físca!</h3>
                    <p>Posso ajudar com dúvidas fiscais e conferir os registros da empresa que você ativou.</p>
                    <div className="fisca-suggestions">
                        <button onClick={() => void enviar('Como você pode me ajudar no CFI?')}>O que você pode fazer? <span>↗</span></button>
                        <button onClick={() => { setTexto('Preciso entender uma divergência fiscal: '); input.current?.focus(); }}>Entender uma divergência <span>↗</span></button>
                    </div>
                </div>}
                {mensagens.map((m, i) => <article key={i} className={`fisca-message fisca-message-${m.role}`}>
                    <span className="fisca-message-author">{m.role === 'user' ? 'Você' : 'Físca'}</span>
                    <div className="fisca-message-text"><SafeMarkdown text={m.text} /></div>
                    {m.resposta && <Evidencias resposta={m.resposta} />}
                </article>)}
                {ocupada && <div className="fisca-loading" role="status"><LoaderCircle size={16} className="fisca-spin" /> Consultando as informações…</div>}
                <div ref={fim} />
            </div>
            <div className="fisca-compose">
                {erro && <p className="fisca-error" role="alert">{erro}</p>}
                <button className="fisca-check" disabled={ocupada || !empresa || !competencia} title={!empresa ? 'Ative uma empresa para conferir o acervo.' : !competencia ? 'Informe a competência da conversa.' : 'Conferir até 200 registros gravados desta empresa e mês.'}
                    onClick={() => void enviar('Confira o acervo desta competência. Explique os achados, os limites da consulta e o que preciso revisar.', true)}><Search size={14} /> Conferir acervo {empresa && competencia && <Check size={13} />}</button>
                <form onSubmit={e => { e.preventDefault(); void enviar(texto); }}>
                    <textarea ref={input} aria-label="Mensagem para a Físca" placeholder="Como posso ajudar?" rows={2} maxLength={4000} value={texto} onChange={e => setTexto(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void enviar(texto); } }} />
                    <button type="submit" aria-label="Enviar mensagem" disabled={ocupada || !texto.trim()}><ArrowUp size={20} /></button>
                </form>
                <p className="fisca-footnote">Análise e orientação · confira as fontes antes de decidir.</p>
            </div>
        </section>}
        <button type="button" ref={launcher} className={`fisca-launcher ${aberta ? 'fisca-launcher-open' : ''}`} aria-expanded={aberta} aria-label={aberta ? 'Minimizar Físca' : 'Conversar com a Físca'} onClick={() => aberta ? fechar() : setAberta(true)}>
            {aberta ? <ChevronDown size={23} /> : <><img src="/fisca-corujinha.svg" alt="" /><span>Físca<small>Posso ajudar?</small></span><span className="fisca-launcher-dot" /></>}
        </button>
    </div>;
}
