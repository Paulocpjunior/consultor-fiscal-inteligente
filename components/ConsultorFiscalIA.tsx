import React, { useState, useRef, useEffect } from 'react';
import { SearchIcon } from './Icons';
import { FormattedText } from './FormattedText';
import LoadingSpinner from './LoadingSpinner';
import type { User } from '../types';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

interface ConsultorFiscalIAProps {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const SUGESTOES = [
    'Qual a diferenca entre Lucro Presumido e Lucro Real?',
    'Como calcular o DAS do Simples Nacional?',
    'Quais obrigacoes acessorias do Lucro Presumido?',
    'Como funciona a retencao de ISS?',
    'O que muda com a Reforma Tributaria (IBS/CBS)?',
    'Como calcular IRPJ e CSLL no Lucro Presumido?',
    'Quais atividades podem optar pelo Simples Nacional?',
    'Como funciona o Fator R no Simples Nacional?',
];

const CATEGORIAS = [
    { label: 'Geral', emoji: '📋', desc: 'Perguntas gerais sobre tributacao' },
    { label: 'Simples Nacional', emoji: '🟢', desc: 'DAS, anexos, fator R, limites' },
    { label: 'Lucro Presumido', emoji: '🔵', desc: 'IRPJ, CSLL, PIS, COFINS' },
    { label: 'Retencoes', emoji: '🟡', desc: 'ISS, IRRF, PIS/COFINS/CSLL' },
    { label: 'Reforma Tributaria', emoji: '🚀', desc: 'IBS, CBS, transicao' },
    { label: 'Obrigacoes', emoji: '📅', desc: 'DCTF, EFD, SPED, prazos' },
];

const MODEL_NAME = 'gemini-2.0-flash';
const API_BASE = '/api/gemini/v1beta/models';

async function callGeminiChat(messages: ChatMessage[], categoria: string): Promise<string> {
    const raw = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
    const apiKey = String(raw).replace(/[\s\r\n]+/g, '').trim();

    if (!apiKey || apiKey === 'undefined') {
        throw new Error('Chave de API nao configurada.');
    }

    const systemPrompt = `Voce e um consultor tributario senior brasileiro, especialista em legislacao fiscal.
Seu nome e "Consultor Fiscal IA" da SP Assessoria Contabil.

REGRAS:
- Responda SEMPRE em Portugues do Brasil
- Seja tecnico, objetivo e pratico
- Cite a legislacao aplicavel (CTN, IN RFB, Leis, Decretos)
- Use exemplos numericos quando possivel
- Formate a resposta em Markdown (titulos, listas, negrito)
- Se a pergunta estiver fora do escopo tributario/fiscal, redirecione educadamente
- Categoria do contexto atual: ${categoria}
- Seja conciso mas completo`;

    const contents = [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Entendido. Sou o Consultor Fiscal IA da SP Assessoria Contabil. Estou pronto para ajudar com questoes tributarias e fiscais brasileiras. Como posso ajudar?' }] },
    ];

    const recent = messages.slice(-10);
    for (const msg of recent) {
        contents.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }],
        });
    }

    const url = `${API_BASE}/${MODEL_NAME}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents,
            generationConfig: { temperature: 0.4 },
        }),
    });

    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Erro ${res.status}`);
    }

    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta.';
}

const ConsultorFiscalIA: React.FC<ConsultorFiscalIAProps> = ({ currentUser, onShowToast }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [categoria, setCategoria] = useState('Geral');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async (text?: string) => {
        const msg = (text || input).trim();
        if (!msg || loading) return;

        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: msg,
            timestamp: new Date(),
        };

        const updatedMessages = [...messages, userMsg];
        setMessages(updatedMessages);
        setInput('');
        setLoading(true);

        try {
            const resposta = await callGeminiChat(updatedMessages, categoria);
            setMessages(prev => [...prev, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: resposta,
                timestamp: new Date(),
            }]);
        } catch (err: any) {
            setMessages(prev => [...prev, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `**Erro:** ${err.message || 'Nao foi possivel processar sua pergunta. Tente novamente.'}`,
                timestamp: new Date(),
            }]);
        } finally {
            setLoading(false);
        }
    };

    const handleClear = () => {
        setMessages([]);
        onShowToast?.('Conversa limpa');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="space-y-4 animate-fade-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-sky-600 to-indigo-600 p-5 rounded-xl text-white">
                <div className="flex items-center gap-3 mb-2">
                    <div className="bg-white/20 p-2.5 rounded-lg">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold">Consultor Fiscal IA</h2>
                        <p className="text-sky-200 text-sm">Tire duvidas sobre tributacao, legislacao e obrigacoes fiscais</p>
                    </div>
                </div>
            </div>

            {/* Categorias */}
            <div className="flex gap-2 overflow-x-auto pb-1">
                {CATEGORIAS.map(cat => (
                    <button
                        key={cat.label}
                        onClick={() => setCategoria(cat.label)}
                        title={cat.desc}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                            categoria === cat.label
                                ? 'bg-sky-600 text-white shadow-md'
                                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-sky-300'
                        }`}
                    >
                        <span>{cat.emoji}</span>
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Chat Area */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                {/* Messages */}
                <div className="h-[500px] overflow-y-auto p-4 space-y-4">
                    {messages.length === 0 && (
                        <div className="text-center py-10">
                            <div className="bg-sky-50 dark:bg-sky-900/30 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <svg className="w-8 h-8 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                                </svg>
                            </div>
                            <h3 className="text-base font-bold text-slate-700 dark:text-slate-300 mb-1">Como posso ajudar?</h3>
                            <p className="text-sm text-slate-400 dark:text-slate-500 mb-6 max-w-md mx-auto">
                                Pergunte sobre tributacao, legislacao fiscal, calculos de impostos, obrigacoes acessorias e mais.
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto">
                                {SUGESTOES.slice(0, 6).map((s, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleSend(s)}
                                        className="text-left px-3 py-2.5 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:text-sky-600 rounded-lg transition-colors border border-slate-100 dark:border-slate-600"
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {messages.map(msg => (
                        <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'assistant' && (
                                <div className="w-8 h-8 rounded-full bg-sky-100 dark:bg-sky-900/50 flex items-center justify-center shrink-0 mt-1">
                                    <svg className="w-4 h-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                    </svg>
                                </div>
                            )}
                            <div className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                                msg.role === 'user'
                                    ? 'bg-sky-600 text-white rounded-br-md'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-bl-md'
                            }`}>
                                {msg.role === 'user' ? (
                                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                                ) : (
                                    <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                                        <FormattedText text={msg.content} />
                                    </div>
                                )}
                                <p className={`text-[10px] mt-1.5 ${msg.role === 'user' ? 'text-sky-200' : 'text-slate-400'}`}>
                                    {msg.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                            {msg.role === 'user' && (
                                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center shrink-0 mt-1">
                                    <svg className="w-4 h-4 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                </div>
                            )}
                        </div>
                    ))}

                    {loading && (
                        <div className="flex gap-3 justify-start">
                            <div className="w-8 h-8 rounded-full bg-sky-100 dark:bg-sky-900/50 flex items-center justify-center shrink-0">
                                <svg className="w-4 h-4 text-sky-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                </svg>
                            </div>
                            <div className="bg-slate-100 dark:bg-slate-700 px-4 py-3 rounded-2xl rounded-bl-md">
                                <div className="flex items-center gap-2">
                                    <div className="flex gap-1">
                                        <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                        <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                        <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                    </div>
                                    <span className="text-xs text-slate-500 dark:text-slate-400">Analisando...</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="border-t border-slate-200 dark:border-slate-700 p-3">
                    <div className="flex items-end gap-2">
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Pergunte sobre tributacao, legislacao fiscal..."
                            rows={1}
                            className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm resize-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 focus:outline-none dark:text-slate-200"
                            disabled={loading}
                            style={{ minHeight: '42px', maxHeight: '120px' }}
                            onInput={(e) => {
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = 'auto';
                                target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                            }}
                        />
                        <button
                            onClick={() => handleSend()}
                            disabled={!input.trim() || loading}
                            className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 font-bold text-sm flex items-center gap-2"
                        >
                            <SearchIcon className="w-4 h-4" />
                            Enviar
                        </button>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                        <p className="text-[10px] text-slate-400">
                            Pressione Enter para enviar, Shift+Enter para nova linha
                        </p>
                        {messages.length > 0 && (
                            <button
                                onClick={handleClear}
                                className="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
                            >
                                Limpar conversa
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConsultorFiscalIA;
