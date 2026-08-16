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
import {
    listarConversas, listarMensagens, marcarLida, responderConversa, iniciarConversa,
    atendimentoConfig, salvarAtendimentoConfig, transferirFila, assumirConversa,
    mudarSituacao, criarNota, vincularCliente, buscarClientes,
    listarAtendentes, salvarFilasAtendente, importarUltrafox,
    Atendente, ImportPreview,
} from '../../services/spConnectService';
import { listarTemplates, listarTemplatesDaMeta, WhatsappTemplate, TemplateDaMeta } from '../../services/whatsappTemplatesService';
import {
    ConversaResumo, MensagemInbox, FilaAtendimento, ConfigAtendimento,
    estadoJanela, carimboStatus, nomeExibicao, formatarNumeroBr, horaCurta,
    rotuloMidia, filtrarConversas, iniciais, rotuloCurtoFila,
} from '../../services/spConnect';

const TOM_TICK: Record<string, string> = {
    ok: 'text-emerald-600 dark:text-emerald-400',
    lido: 'text-sky-500 dark:text-sky-400',
    falha: 'text-red-600 dark:text-red-400',
    neutro: 'text-slate-400',
};

const CAMPO = 'w-full px-2 py-1.5 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100';

/** aba = 'todas' | 'nao-lidas' | id de fila. */
const SpConnect: React.FC<{ currentUser: { role: string; email?: string } }> = ({ currentUser }) => {
    const [conversas, setConversas] = useState<ConversaResumo[]>([]);
    const [filas, setFilas] = useState<FilaAtendimento[]>([]);
    const [minhasFilas, setMinhasFilas] = useState<string[] | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [busca, setBusca] = useState('');
    const [aba, setAba] = useState<string>('todas');
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
            setFilas(r.filas || []);
            setMinhasFilas(r.minhasFilas === undefined ? null : r.minhasFilas);
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
                // Conversa em condução por outro: o backend recusa (409) — a
                // tela atualiza o dono pra guarda aparecer no composer.
                if ((r as any).emConducaoPor) patchSel({ atribuidoA: (r as any).emConducaoPor });
                setErroEnvio(`${r.error}${(r as any).acao ? ` ${(r as any).acao}` : ''}`);
                return;
            }
            setMensagens((m) => [...m, r.mensagem]);
            if (r.autoAssumida) patchSel({ atribuidoA: meuEmail, transferidaDe: null });
            setTexto('');
        } finally {
            setEnviando(false);
        }
    };

    // ── F3: ações da conversa (transferir · assumir · nota · resolver · vincular)
    const [acaoErro, setAcaoErro] = useState<string | null>(null);
    const [notaTexto, setNotaTexto] = useState('');
    const [notaAberta, setNotaAberta] = useState(false);
    const meuEmail = currentUser?.email || '';

    /** Aplica o patch na conversa selecionada E na lista — a tela responde na hora. */
    const patchSel = (patch: Partial<ConversaResumo>) => {
        setSel((s) => (s ? { ...s, ...patch } : s));
        setConversas((lst) => lst.map((c) => (c.numero === selRef.current?.numero ? { ...c, ...patch } : c)));
    };

    const rodarAcao = async (fn: () => Promise<{ ok: boolean; error?: string }>, patch: Partial<ConversaResumo>) => {
        setAcaoErro(null);
        const r = await fn();
        if (!r.ok) { setAcaoErro(r.error || 'A ação falhou.'); return false; }
        patchSel(patch);
        return true;
    };

    // Transferência entre departamentos: escolhe a fila, recado opcional, e o
    // resultado volta com a nota automática (entra na thread na hora).
    const [transFila, setTransFila] = useState('');
    const [transRecado, setTransRecado] = useState('');
    const [transAviso, setTransAviso] = useState<string | null>(null);
    const acaoTransferir = async () => {
        if (!sel || !transFila || transFila === (sel.fila || 'recepcao')) return;
        setAcaoErro(null);
        setTransAviso(null);
        const r = await transferirFila(sel.numero, transFila, transRecado.trim() || undefined);
        if (!r.ok) { setAcaoErro(r.error || 'A transferência falhou.'); return; }
        patchSel({ fila: r.fila, atribuidoA: null, transferidaDe: r.transferidaDe });
        if (r.nota) setMensagens((m) => [...m, r.nota]);
        setTransFila('');
        setTransRecado('');
        setTransAviso({
            enviado: '✓ Transferida — o cliente foi avisado.',
            'janela-fechada': '✓ Transferida. O aviso ao cliente NÃO saiu (janela de 24h fechada).',
            falhou: '✓ Transferida. O aviso ao cliente falhou — a transferência valeu mesmo assim.',
            desligado: '✓ Transferida (aviso ao cliente desligado na ⚙️).',
        }[r.avisoCliente] || '✓ Transferida.');
    };
    const acaoAssumir = () => {
        if (!sel) return;
        const liberar = sel.atribuidoA === meuEmail;
        rodarAcao(() => assumirConversa(sel.numero, liberar),
            liberar ? { atribuidoA: null } : { atribuidoA: meuEmail, transferidaDe: null });
    };
    const acaoSituacao = () => {
        if (!sel) return;
        const nova = sel.situacao === 'resolvida' ? 'aberta' : 'resolvida';
        rodarAcao(() => mudarSituacao(sel.numero, nova), { situacao: nova });
    };
    const acaoNota = async () => {
        if (!sel || !notaTexto.trim()) return;
        setAcaoErro(null);
        const r = await criarNota(sel.numero, notaTexto.trim());
        if (!r.ok) { setAcaoErro(r.error || 'A nota não foi gravada.'); return; }
        setMensagens((m) => [...m, r.mensagem]);
        setNotaTexto('');
        setNotaAberta(false);
    };

    // ── F3: vincular contato ↔ cliente (busca nas duas coleções, via backend)
    const [vincAberto, setVincAberto] = useState(false);
    const [vincBusca, setVincBusca] = useState('');
    const [vincResultados, setVincResultados] = useState<{ id: string; nome: string; cnpj: string; origem: string }[]>([]);
    const [vincBuscando, setVincBuscando] = useState(false);
    useEffect(() => {
        if (!vincAberto || vincBusca.trim().length < 3) { setVincResultados([]); return; }
        const t = setTimeout(async () => {
            setVincBuscando(true);
            try {
                const r = await buscarClientes(vincBusca.trim());
                if (r.ok) setVincResultados(r.clientes || []);
            } finally { setVincBuscando(false); }
        }, 350);
        return () => clearTimeout(t);
    }, [vincAberto, vincBusca]);

    const acaoVincular = async (empresaId: string, empresaNome: string) => {
        if (!sel) return;
        const ok = await rodarAcao(() => vincularCliente(sel.numero, empresaId, empresaNome),
            { empresaId: empresaId || null, empresaNome: empresaId ? empresaNome : null });
        if (ok) { setVincAberto(false); setVincBusca(''); setVincResultados([]); }
    };

    // ── F3: ⚙️ config do atendimento (admin — bot, horário, mensagens, menu)
    const ehAdmin = currentUser?.role === 'admin';
    const [cfgAberta, setCfgAberta] = useState(false);
    const [cfg, setCfg] = useState<ConfigAtendimento | null>(null);
    const [cfgSalvando, setCfgSalvando] = useState(false);
    const [cfgErro, setCfgErro] = useState<string | null>(null);
    const [cfgOk, setCfgOk] = useState(false);

    const abrirCfg = async () => {
        setCfgAberta(true);
        setCfgErro(null);
        setCfgOk(false);
        const r = await atendimentoConfig();
        if (r.ok) setCfg(r.config);
        else setCfgErro(r.error || 'Falha ao carregar a configuração.');
    };
    const salvarCfg = async () => {
        if (!cfg || cfgSalvando) return;
        setCfgSalvando(true);
        setCfgErro(null);
        setCfgOk(false);
        try {
            const r = await salvarAtendimentoConfig(cfg);
            if (!r.ok) { setCfgErro(r.error || 'Falha ao salvar.'); return; }
            setCfg(r.config);
            setCfgOk(true);
        } finally { setCfgSalvando(false); }
    };
    const setMsgCfg = (chave: string, valor: string) =>
        setCfg((c) => (c ? { ...c, mensagens: { ...c.mensagens, [chave]: valor } } : c));

    // ── ⚙️ aba 👥 Atendentes ↔ filas (users.filasAtendimento, só admin grava)
    const [cfgAba, setCfgAba] = useState<'bot' | 'atendentes' | 'importar'>('bot');
    const [atendentes, setAtendentes] = useState<Atendente[]>([]);
    const [atdErro, setAtdErro] = useState<string | null>(null);
    const [atdCarregado, setAtdCarregado] = useState(false);
    useEffect(() => {
        if (!cfgAberta || cfgAba !== 'atendentes' || atdCarregado) return;
        (async () => {
            const r = await listarAtendentes();
            if (r.ok) { setAtendentes(r.atendentes || []); setAtdCarregado(true); setAtdErro(null); }
            else setAtdErro(r.error || 'Falha ao listar os usuários.');
        })();
    }, [cfgAberta, cfgAba, atdCarregado]);

    const alternarFilaAtendente = async (a: Atendente, fila: string) => {
        const novas = a.filasAtendimento.includes(fila)
            ? a.filasAtendimento.filter((f) => f !== fila)
            : [...a.filasAtendimento, fila];
        setAtdErro(null);
        const r = await salvarFilasAtendente(a.uid, novas);
        if (!r.ok) { setAtdErro(r.error || 'Falha ao salvar.'); return; }
        setAtendentes((lst) => lst.map((x) => (x.uid === a.uid ? { ...x, filasAtendimento: r.filas } : x)));
    };

    // ── ⚙️ aba 📥 Importar backup da Ultra Fox (preview antes de gravar)
    const [impTipo, setImpTipo] = useState<'contatos' | 'mensagens-txt' | 'mensagens-csv'>('contatos');
    const [impConteudo, setImpConteudo] = useState('');
    const [impNumero, setImpNumero] = useState('');
    const [impAutores, setImpAutores] = useState<string[]>([]);
    const [impPreview, setImpPreview] = useState<ImportPreview | null>(null);
    const [impResultado, setImpResultado] = useState<ImportPreview | null>(null);
    const [impErro, setImpErro] = useState<string | null>(null);
    const [impRodando, setImpRodando] = useState(false);

    const lerArquivoImport = (f: File | null) => {
        if (!f) return;
        const leitor = new FileReader();
        leitor.onload = () => { setImpConteudo(String(leitor.result || '')); setImpPreview(null); setImpResultado(null); };
        leitor.readAsText(f);
    };
    const rodarImport = async (confirmar: boolean) => {
        if (!impConteudo.trim() || impRodando) return;
        setImpRodando(true);
        setImpErro(null);
        try {
            const r = await importarUltrafox({
                tipo: impTipo, conteudo: impConteudo, confirmar,
                ...(impTipo === 'mensagens-txt' ? { numero: impNumero, autoresEscritorio: impAutores } : {}),
            });
            if (!r.ok) { setImpErro(r.error || 'A importação falhou.'); return; }
            if (confirmar) { setImpResultado(r); setImpPreview(null); }
            else { setImpPreview(r); setImpResultado(null); setImpAutores([]); }
        } finally { setImpRodando(false); }
    };

    // ── ✚ Nova conversa (template aprovado — a porta de fora da janela) ─────
    // DUAS fontes de template: o cadastro da ⚙️ (variáveis nomeadas) e os
    // APROVADOS direto da Meta (o corpo aparece e preenche-se {{1}},{{2}}…) —
    // linkar na ⚙️ é opção, não pré-requisito (lição de 16/08: os templates
    // existiam na Meta e o dropdown vazio culpava a pessoa errada).
    const [novaAberta, setNovaAberta] = useState(false);
    const [templates, setTemplates] = useState<WhatsappTemplate[]>([]);
    const [daMeta, setDaMeta] = useState<TemplateDaMeta[]>([]);
    const [carregandoTpl, setCarregandoTpl] = useState(false);
    const [nc, setNc] = useState({
        para: '', nomeContato: '', departamento: 'fiscal', escolha: '',
        variaveis: {} as Record<string, string>, posicionais: [] as string[],
    });
    const [enviandoNova, setEnviandoNova] = useState(false);
    const [erroNova, setErroNova] = useState<string | null>(null);

    const abrirNova = async () => {
        setNovaAberta(true);
        setErroNova(null);
        if (templates.length === 0 && daMeta.length === 0) {
            setCarregandoTpl(true);
            try {
                const [cad, meta] = await Promise.all([listarTemplates(), listarTemplatesDaMeta()]);
                if (cad.ok) setTemplates((cad.templates || []).filter((t) => t.ativo !== false && !t.temDocumento));
                if (meta.ok) setDaMeta((meta.templates || []).filter((t) => t.status === 'APPROVED' && !t.temDocumento));
                if (!cad.ok && !meta.ok) setErroNova(cad.error || 'Falha ao carregar os templates.');
            } finally {
                setCarregandoTpl(false);
            }
        }
    };

    const templatesDoDep = templates.filter((t) => t.departamento === nc.departamento);
    const cadastroSel = nc.escolha.startsWith('c:') ? templatesDoDep.find((t) => t.id === nc.escolha.slice(2)) : undefined;
    const metaSel = nc.escolha.startsWith('m:') ? daMeta.find((t) => `${t.nome}|${t.idioma}` === nc.escolha.slice(2)) : undefined;
    const prontoPraEnviar = Boolean(nc.para.trim()) && (
        (cadastroSel && (cadastroSel.variaveis || []).every((v) => (nc.variaveis[v.chave] || '').trim()))
        || (metaSel && Array.from({ length: metaSel.variaveis }, (_, i) => nc.posicionais[i] || '').every((v) => v.trim()))
    );

    const enviarNova = async () => {
        if (!prontoPraEnviar || enviandoNova) return;
        setEnviandoNova(true);
        setErroNova(null);
        try {
            const r = await iniciarConversa({
                para: nc.para, nomeContato: nc.nomeContato || undefined, departamento: nc.departamento,
                ...(cadastroSel
                    ? { template: cadastroSel.nome, variaveis: nc.variaveis }
                    : { templateDireto: { nome: metaSel!.nome, idioma: metaSel!.idioma }, variaveisPosicionais: nc.posicionais.slice(0, metaSel!.variaveis) }),
            });
            if (!r.ok) { setErroNova(`${r.error}${(r as any).acao ? ` ${(r as any).acao}` : ''}`); return; }
            setNovaAberta(false);
            setNc({ para: '', nomeContato: '', departamento: nc.departamento, escolha: '', variaveis: {}, posicionais: [] });
            await recarregar(true);
            const nova = { numero: r.numero, nome: nc.nomeContato || null, empresaId: null, fila: null, atribuidoA: null, situacao: 'aberta', janela24hAte: null, ultimaMensagem: null, naoLidas: 0, atualizadoEm: null } as ConversaResumo;
            abrir(nova);
        } finally {
            setEnviandoNova(false);
        }
    };

    // Build visível na tela: print sem versão não é evidência (regra da casa)
    // — foi a falta disto que fez o tema "não subir" virar debate às cegas.
    const [buildInfo, setBuildInfo] = useState<string>('');
    useEffect(() => {
        fetch('/version.json', { cache: 'no-store' })
            .then((r) => r.json())
            .then((v) => setBuildInfo(String(v?.version || v?.v || '')))
            .catch(() => setBuildInfo(''));
    }, []);

    const agora = new Date();
    const janela = sel ? estadoJanela(sel.janela24hAte, agora) : null;
    const conduzidaPorOutro = Boolean(sel?.atribuidoA && sel.atribuidoA !== meuEmail);
    const visiveis = filtrarConversas(conversas, { busca, aba });
    const naoLidasTotal = conversas.reduce((s, c) => s + (c.naoLidas || 0), 0);
    // Chips por fila: só as que o usuário ENXERGA (o backend já filtrou as
    // conversas; os chips seguem o MESMO recorte, senão é leitura dupla).
    const filasChip = filas.filter((f) => minhasFilas === null || minhasFilas.includes(f.id));
    const contagemFila = (id: string) => conversas.filter((c) => (c.fila || 'recepcao') === id).length;

    const chip = (a: string, rotulo: string) => (
        <button
            key={a}
            onClick={() => setAba(a)}
            className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${aba === a
                ? 'bg-[#0e3bfa] text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
        >
            {rotulo}
        </button>
    );

    return (
        <div className="max-w-[1400px] mx-auto animate-fade-in">
            {/* ── Modal ✚ Nova conversa (template aprovado) ─────────────────── */}
            {novaAberta && (
                <div className="fixed inset-0 bg-black/60 z-[80] flex items-start justify-center p-4 overflow-y-auto" onClick={() => setNovaAberta(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md my-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">✚ Nova conversa</h3>
                            <button onClick={() => setNovaAberta(false)} className="text-slate-400 hover:text-slate-600 px-1">✕</button>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Conversa nova sai por <strong>template aprovado</strong> (regra da Meta). Quando o cliente
                            responder, a janela de 24h abre e o papo vira texto livre.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <label className="text-[11px] text-slate-500 col-span-2 sm:col-span-1">
                                WhatsApp (DDD + número)
                                <input value={nc.para} onChange={(e) => setNc((f) => ({ ...f, para: e.target.value }))} placeholder="(11) 99999-9999"
                                    className="w-full px-2 py-1.5 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100" />
                            </label>
                            <label className="text-[11px] text-slate-500 col-span-2 sm:col-span-1">
                                Nome do contato (opcional)
                                <input value={nc.nomeContato} onChange={(e) => setNc((f) => ({ ...f, nomeContato: e.target.value }))} placeholder="Ricardo (ACME)"
                                    className="w-full px-2 py-1.5 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100" />
                            </label>
                            <label className="text-[11px] text-slate-500">
                                Departamento
                                <select value={nc.departamento} onChange={(e) => setNc((f) => ({ ...f, departamento: e.target.value, escolha: f.escolha.startsWith('c:') ? '' : f.escolha, variaveis: {} }))}
                                    className="w-full px-2 py-1.5 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
                                    <option value="fiscal">🧾 Fiscal</option>
                                    <option value="contabil">📊 Contábil</option>
                                    <option value="dp-folha">👥 DP / Folha</option>
                                    <option value="legalizacao">📋 Legalização</option>
                                    <option value="financeiro">💰 Financeiro</option>
                                </select>
                            </label>
                            <label className="text-[11px] text-slate-500">
                                Template
                                <select value={nc.escolha} onChange={(e) => setNc((f) => ({ ...f, escolha: e.target.value, variaveis: {}, posicionais: [] }))}
                                    className="w-full px-2 py-1.5 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
                                    <option value="">{carregandoTpl ? 'Carregando…' : 'Escolha…'}</option>
                                    {templatesDoDep.length > 0 && (
                                        <optgroup label="Do cadastro (variáveis nomeadas)">
                                            {templatesDoDep.map((t) => <option key={t.id} value={`c:${t.id}`}>{t.nome}</option>)}
                                        </optgroup>
                                    )}
                                    {daMeta.length > 0 && (
                                        <optgroup label="Aprovados na Meta">
                                            {daMeta.map((t) => <option key={`${t.nome}|${t.idioma}`} value={`m:${t.nome}|${t.idioma}`}>{t.nome} ({t.idioma})</option>)}
                                        </optgroup>
                                    )}
                                </select>
                            </label>
                        </div>
                        {metaSel && metaSel.corpo && (
                            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 px-2.5 py-2 text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                                {metaSel.corpo}
                            </div>
                        )}
                        {cadastroSel && (cadastroSel.variaveis || []).length > 0 && (
                            <div className="space-y-1.5">
                                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Variáveis do template</p>
                                {(cadastroSel.variaveis || []).map((v) => (
                                    <label key={v.chave} className="block text-[11px] text-slate-500">
                                        {v.rotulo || v.chave}
                                        <input
                                            value={nc.variaveis[v.chave] || ''}
                                            onChange={(e) => setNc((f) => ({ ...f, variaveis: { ...f.variaveis, [v.chave]: e.target.value } }))}
                                            className="w-full px-2 py-1.5 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                                        />
                                    </label>
                                ))}
                            </div>
                        )}
                        {metaSel && metaSel.variaveis > 0 && (
                            <div className="space-y-1.5">
                                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Preencha as variáveis (na ordem do texto acima)</p>
                                {Array.from({ length: metaSel.variaveis }, (_, i) => (
                                    <label key={i} className="block text-[11px] text-slate-500">
                                        {`{{${i + 1}}}`}
                                        <input
                                            value={nc.posicionais[i] || ''}
                                            onChange={(e) => setNc((f) => {
                                                const pos = [...f.posicionais]; pos[i] = e.target.value;
                                                return { ...f, posicionais: pos };
                                            })}
                                            className="w-full px-2 py-1.5 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                                        />
                                    </label>
                                ))}
                            </div>
                        )}
                        {erroNova && <p className="text-[11px] text-red-600 dark:text-red-400">{erroNova}</p>}
                        <div className="flex items-center justify-end gap-2 pt-1">
                            <button onClick={() => setNovaAberta(false)} className="text-[12px] px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancelar</button>
                            <button onClick={enviarNova} disabled={enviandoNova || !prontoPraEnviar}
                                className="text-[12px] font-bold px-4 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                {enviandoNova ? 'Enviando…' : 'Enviar template ➤'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* ── Modal 🔗 Vincular ao cliente (busca no cadastro central) ──── */}
            {vincAberto && sel && (
                <div className="fixed inset-0 bg-black/60 z-[80] flex items-start justify-center p-4 overflow-y-auto" onClick={() => setVincAberto(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md my-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">🔗 Vincular {nomeExibicao(sel)} a um cliente</h3>
                            <button onClick={() => setVincAberto(false)} className="text-slate-400 hover:text-slate-600 px-1">✕</button>
                        </div>
                        <input autoFocus value={vincBusca} onChange={(e) => setVincBusca(e.target.value)}
                            placeholder="🔎 Nome ou CNPJ (mín. 3 caracteres)" className={CAMPO} />
                        {vincBuscando && <p className="text-[11px] text-slate-400">Buscando…</p>}
                        {!vincBuscando && vincBusca.trim().length >= 3 && vincResultados.length === 0 && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Nenhum cliente casa com essa busca.</p>
                        )}
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                            {vincResultados.map((cl) => (
                                <button key={`${cl.origem}:${cl.id}`} onClick={() => acaoVincular(cl.id, cl.nome)}
                                    className="w-full text-left px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">{cl.nome}</p>
                                    <p className="text-[10px] text-slate-400">{cl.cnpj || 'sem CNPJ'} · {cl.origem === 'simples' ? 'Simples' : 'Lucro'}</p>
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-slate-400">O vínculo fica gravado com quem vinculou — é uma afirmação sobre quem o contato é.</p>
                    </div>
                </div>
            )}

            {/* ── Modal ⚙️ Config do atendimento (admin) ─────────────────────── */}
            {cfgAberta && (
                <div className="fixed inset-0 bg-black/60 z-[80] flex items-start justify-center p-4 overflow-y-auto" onClick={() => setCfgAberta(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl my-8 p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">⚙️ SP Connect — configurações</h3>
                            <button onClick={() => setCfgAberta(false)} className="text-slate-400 hover:text-slate-600 px-1">✕</button>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                            {([['bot', '🤖 Bot e mensagens'], ['atendentes', '👥 Atendentes e filas'], ['importar', '📥 Importar Ultra Fox']] as const).map(([id, rotulo]) => (
                                <button key={id} onClick={() => setCfgAba(id)}
                                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${cfgAba === id
                                        ? 'bg-[#0e3bfa] text-white'
                                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                    {rotulo}
                                </button>
                            ))}
                        </div>

                        {/* ── aba 👥 Atendentes ↔ filas ─────────────────────── */}
                        {cfgAba === 'atendentes' && (
                            <div className="space-y-2">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Clique nas filas de cada pessoa — salva na hora. Quem tem <strong>Recepção</strong> vê
                                    TODAS as conversas; sem atribuição, valem os departamentos de módulo; os demais veem
                                    a própria fila + Recepção.
                                </p>
                                {atdErro && <p className="text-[11px] text-red-600 dark:text-red-400">{atdErro}</p>}
                                {!atdCarregado && !atdErro && <p className="text-[11px] text-slate-400">Carregando usuários…</p>}
                                <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                                    {atendentes.map((a) => (
                                        <div key={a.uid} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                                            <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                                                {a.nome || a.email || a.uid}
                                                {a.role === 'admin' && <span className="ml-1.5 text-[9px] font-bold text-emerald-600">admin · vê tudo</span>}
                                            </p>
                                            {a.email && a.nome && <p className="text-[10px] text-slate-400">{a.email}</p>}
                                            <div className="flex gap-1 flex-wrap mt-1">
                                                {filas.map((f) => (
                                                    <button key={f.id} onClick={() => alternarFilaAtendente(a, f.id)}
                                                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.filasAtendimento.includes(f.id)
                                                            ? 'bg-[#0e3bfa] text-white'
                                                            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                                        {rotuloCurtoFila(f.id)}
                                                    </button>
                                                ))}
                                            </div>
                                            {a.filasAtendimento.length === 0 && a.departamentos.length > 0 && (
                                                <p className="text-[9px] text-slate-400 mt-1">sem atribuição — hoje vale o departamento: {a.departamentos.join(', ')}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── aba 📥 Importar backup da Ultra Fox ───────────── */}
                        {cfgAba === 'importar' && (
                            <div className="space-y-2">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Restaura o backup da Ultra Fox. <strong>Nada é gravado sem o preview</strong>: primeiro
                                    a leitura, depois a confirmação. Contato que já existe no SP Connect
                                    <strong> não é sobrescrito</strong>, e reimportar o mesmo arquivo não duplica mensagem.
                                </p>
                                <div className="flex gap-1.5 flex-wrap">
                                    {([['contatos', '👥 Contatos (CSV)'], ['mensagens-csv', '💬 Mensagens (CSV)'], ['mensagens-txt', '📄 Conversa (.txt do WhatsApp)']] as const).map(([id, rotulo]) => (
                                        <button key={id} onClick={() => { setImpTipo(id); setImpPreview(null); setImpResultado(null); }}
                                            className={`text-[10px] font-bold px-2 py-1 rounded-full ${impTipo === id
                                                ? 'bg-[#0e3bfa] text-white'
                                                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                                            {rotulo}
                                        </button>
                                    ))}
                                </div>
                                <input type="file" accept=".csv,.txt,.tsv" onChange={(e) => lerArquivoImport(e.target.files?.[0] || null)}
                                    className="text-[11px] text-slate-500" />
                                <textarea value={impConteudo} onChange={(e) => { setImpConteudo(e.target.value); setImpPreview(null); setImpResultado(null); }}
                                    rows={5} placeholder="…ou cole aqui o conteúdo do arquivo exportado da Ultra Fox"
                                    className={`${CAMPO} font-mono !text-[10px]`} />
                                {impTipo === 'mensagens-txt' && (
                                    <label className="block text-[11px] text-slate-500">
                                        Número do WhatsApp do CONTATO desta conversa
                                        <input value={impNumero} onChange={(e) => setImpNumero(e.target.value)} placeholder="(11) 96444-0000" className={CAMPO} />
                                    </label>
                                )}
                                {impErro && <p className="text-[11px] text-red-600 dark:text-red-400">{impErro}</p>}
                                {impPreview && (
                                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-2.5 space-y-1.5">
                                        <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">
                                            Preview: {impPreview.total} {impTipo === 'contatos' ? 'contatos' : 'mensagens'} legíveis
                                            {(impPreview.totalDescartados || impPreview.totalDescartadas) ? ` · ${impPreview.totalDescartados || impPreview.totalDescartadas} descartadas (motivo abaixo)` : ''}
                                        </p>
                                        {(impPreview.avisos || []).map((a, i) => <p key={i} className="text-[10px] text-amber-700 dark:text-amber-400">⚠️ {a}</p>)}
                                        {[...(impPreview.descartados || []), ...(impPreview.descartadas || [])].slice(0, 8).map((d, i) => (
                                            <p key={i} className="text-[10px] text-slate-500">• {d.motivo}{'linha' in d && d.linha ? ` (linha ${d.linha})` : ''}</p>
                                        ))}
                                        {impTipo === 'mensagens-txt' && (impPreview.autores || []).length > 0 && (
                                            <div>
                                                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Quais autores são do ESCRITÓRIO? (viram mensagens enviadas)</p>
                                                <div className="flex gap-1.5 flex-wrap mt-1">
                                                    {(impPreview.autores || []).map((a) => (
                                                        <button key={a} onClick={() => setImpAutores((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]))}
                                                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${impAutores.includes(a)
                                                                ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                                                            {impAutores.includes(a) ? '🏢 ' : ''}{a}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <pre className="text-[9px] text-slate-500 overflow-x-auto max-h-32 overflow-y-auto">{JSON.stringify(impPreview.amostra, null, 1)}</pre>
                                    </div>
                                )}
                                {impResultado && (
                                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                        ✓ Importado: {impResultado.criados != null
                                            ? `${impResultado.criados} contatos novos · ${impResultado.jaExistiam} já existiam (não sobrescritos)`
                                            : `${impResultado.gravadas} mensagens em ${impResultado.conversas} conversa(s)`}
                                    </p>
                                )}
                                <div className="flex items-center justify-end gap-2">
                                    <button onClick={() => rodarImport(false)} disabled={impRodando || !impConteudo.trim()}
                                        className="text-[12px] px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40">
                                        {impRodando ? '…' : '🔎 Ler (preview)'}
                                    </button>
                                    <button onClick={() => rodarImport(true)} disabled={impRodando || !impPreview || impPreview.total === 0}
                                        className="text-[12px] font-bold px-4 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                        Confirmar e gravar
                                    </button>
                                </div>
                            </div>
                        )}

                        {cfgAba === 'bot' && (!cfg ? (
                            <p className="text-[11px] text-slate-400">{cfgErro || 'Carregando…'}</p>
                        ) : (
                            <>
                                <div className={`rounded-lg border p-2.5 ${cfg.botAtivo
                                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
                                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40'}`}>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={cfg.botAtivo}
                                            onChange={(e) => setCfg((c) => (c ? { ...c, botAtivo: e.target.checked } : c))} />
                                        <span className="text-[12px] font-bold text-slate-800 dark:text-slate-100">
                                            🤖 Bot de triagem {cfg.botAtivo ? 'LIGADO' : 'desligado'}
                                        </span>
                                    </label>
                                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">
                                        ⚠️ Enquanto a Ultra Fox estiver de pé respondendo, ligar o bot aqui = DOIS bots
                                        no mesmo cliente (menu em dobro). Ligue só no dia do corte.
                                    </p>
                                    <label className="flex items-center gap-2 cursor-pointer mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                                        <input type="checkbox" checked={cfg.avisarClienteTransferencia}
                                            onChange={(e) => setCfg((c) => (c ? { ...c, avisarClienteTransferencia: e.target.checked } : c))} />
                                        <span className="text-[11px] text-slate-700 dark:text-slate-200">
                                            ↪️ Avisar o CLIENTE quando a conversa for transferida de fila
                                            <span className="block text-[9px] text-slate-400">só sai com a janela de 24h aberta; independente do bot</span>
                                        </span>
                                    </label>
                                </div>
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5">
                                    <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">🕐 Horário de funcionamento (fuso de São Paulo)</p>
                                    <div className="flex gap-1.5 flex-wrap">
                                        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d, i) => (
                                            <label key={d} className={`text-[10px] font-bold px-2 py-0.5 rounded-full cursor-pointer ${cfg.horario.dias.includes(i)
                                                ? 'bg-[#0e3bfa] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                                                <input type="checkbox" className="hidden" checked={cfg.horario.dias.includes(i)}
                                                    onChange={() => setCfg((c) => c ? {
                                                        ...c,
                                                        horario: {
                                                            ...c.horario,
                                                            dias: c.horario.dias.includes(i)
                                                                ? c.horario.dias.filter((x) => x !== i)
                                                                : [...c.horario.dias, i].sort(),
                                                        },
                                                    } : c)} />
                                                {d}
                                            </label>
                                        ))}
                                    </div>
                                    <div className="flex gap-3 flex-wrap">
                                        {cfg.horario.turnos.map((t, i) => (
                                            <div key={i} className="flex items-center gap-1 text-[11px] text-slate-500">
                                                <span>{i === 0 ? 'Manhã' : 'Tarde'}:</span>
                                                <input value={t.inicio} onChange={(e) => setCfg((c) => c ? {
                                                    ...c, horario: { ...c.horario, turnos: c.horario.turnos.map((x, j) => (j === i ? { ...x, inicio: e.target.value } : x)) },
                                                } : c)} className={`${CAMPO} !w-16 text-center`} />
                                                <span>às</span>
                                                <input value={t.fim} onChange={(e) => setCfg((c) => c ? {
                                                    ...c, horario: { ...c.horario, turnos: c.horario.turnos.map((x, j) => (j === i ? { ...x, fim: e.target.value } : x)) },
                                                } : c)} className={`${CAMPO} !w-16 text-center`} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5">
                                    <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">💬 Mensagens automáticas</p>
                                    {([
                                        ['saudacao', 'Saudação (1º contato) — aceita {nome} e {protocolo}'],
                                        ['menuCabecalho', 'Cabeçalho do menu'],
                                        ['confirmacaoFila', 'Confirmação de fila — aceita {fila}'],
                                        ['foraDeHorario', 'Fora do horário'],
                                        ['sair', 'Resposta ao #sair'],
                                    ] as [string, string][]).map(([chave, rotulo]) => (
                                        <label key={chave} className="block text-[10px] text-slate-400">
                                            {rotulo}
                                            <textarea value={cfg.mensagens[chave] || ''} onChange={(e) => setMsgCfg(chave, e.target.value)}
                                                rows={chave === 'menuCabecalho' ? 1 : 2} className={CAMPO} />
                                        </label>
                                    ))}
                                </div>
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5">
                                    <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">🔢 Menu de triagem (opção → fila)</p>
                                    {cfg.menu.map((m, i) => (
                                        <div key={i} className="flex items-center gap-1.5">
                                            <input value={m.opcao} onChange={(e) => setCfg((c) => c ? {
                                                ...c, menu: c.menu.map((x, j) => (j === i ? { ...x, opcao: e.target.value } : x)),
                                            } : c)} className={`${CAMPO} !w-10 text-center`} />
                                            <input value={m.rotulo} onChange={(e) => setCfg((c) => c ? {
                                                ...c, menu: c.menu.map((x, j) => (j === i ? { ...x, rotulo: e.target.value } : x)),
                                            } : c)} className={CAMPO} placeholder="O que o cliente lê" />
                                            <select value={m.fila} onChange={(e) => setCfg((c) => c ? {
                                                ...c, menu: c.menu.map((x, j) => (j === i ? { ...x, fila: e.target.value } : x)),
                                            } : c)} className={`${CAMPO} !w-32`}>
                                                {filas.map((f) => <option key={f.id} value={f.id}>{rotuloCurtoFila(f.id)}</option>)}
                                            </select>
                                            <button onClick={() => setCfg((c) => c ? { ...c, menu: c.menu.filter((_, j) => j !== i) } : c)}
                                                className="text-slate-400 hover:text-red-600 px-1">✕</button>
                                        </div>
                                    ))}
                                    <button onClick={() => setCfg((c) => c ? {
                                        ...c, menu: [...c.menu, { opcao: String(c.menu.length + 1), fila: 'recepcao', rotulo: '' }],
                                    } : c)} className="text-[11px] text-[#0e3bfa] font-bold">＋ opção</button>
                                    <p className="text-[10px] text-slate-400">Menu vazio ou só com fila inválida volta ao padrão na gravação — triagem morta em silêncio não passa.</p>
                                </div>
                                {cfgErro && <p className="text-[11px] text-red-600 dark:text-red-400">{cfgErro}</p>}
                                {cfgOk && <p className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ Configuração salva.</p>}
                                <div className="flex items-center justify-end gap-2">
                                    <button onClick={() => setCfgAberta(false)} className="text-[12px] px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Fechar</button>
                                    <button onClick={salvarCfg} disabled={cfgSalvando}
                                        className="text-[12px] font-bold px-4 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                        {cfgSalvando ? 'Salvando…' : 'Salvar configuração'}
                                    </button>
                                </div>
                            </>
                        ))}
                    </div>
                </div>
            )}

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden md:grid md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_280px]" style={{ height: 'calc(100vh - 140px)', minHeight: '480px' }}>

                {/* ═══ COLUNA 1 — CONVERSAS ═══════════════════════════════════ */}
                <div className={`${sel ? 'hidden md:flex' : 'flex'} flex-col md:border-r border-slate-200 dark:border-slate-700 min-h-0`}>
                    <div className="p-2.5 space-y-2 border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Conversas</p>
                            <div className="flex items-center gap-1.5">
                                <button onClick={abrirNova} title="Iniciar conversa por template aprovado"
                                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#0e3bfa] hover:bg-[#091d8d] text-white">
                                    ✚ Nova
                                </button>
                                {ehAdmin && (
                                    <button onClick={abrirCfg} title="Configurar atendimento (bot, horário, mensagens, menu)"
                                        className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600">
                                        ⚙️
                                    </button>
                                )}
                                <button onClick={() => recarregar()} disabled={carregando} title="Atualizar agora (a lista também se atualiza sozinha a cada 30s)"
                                    className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50">
                                    {carregando ? '…' : '🔄'}
                                </button>
                            </div>
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
                            {filasChip.map((f) => chip(f.id, `${rotuloCurtoFila(f.id)} · ${contagemFila(f.id)}`))}
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
                                        className={`w-full text-left px-3 py-2.5 border-b border-slate-100 dark:border-slate-700/60 flex gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 ${ativa ? 'bg-[#e7ecff] dark:bg-sky-900/20 border-l-[3px] border-l-[#0e3bfa]' : 'border-l-[3px] border-l-transparent'}`}
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
                                                    <span className="shrink-0 text-[10px] font-bold bg-[#0e3bfa] text-white rounded-full min-w-[18px] text-center px-1 py-0.5">{c.naoLidas}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                                <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300">{rotuloCurtoFila(c.fila)}</span>
                                                {c.situacao === 'resolvida' && <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">✅ resolvida</span>}
                                                {c.transferidaDe && !c.atribuidoA && c.situacao !== 'resolvida' && (
                                                    <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">↪ de {rotuloCurtoFila(c.transferidaDe)}</span>
                                                )}
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
                                    <p className="text-[10px] text-slate-400 truncate">
                                        {formatarNumeroBr(sel.numero)} · {rotuloCurtoFila(sel.fila)}
                                        {sel.protocolo ? ` · protocolo ${sel.protocolo}` : ''}
                                    </p>
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
                                        // Nota interna: vive na thread e o cliente NUNCA vê — a cara
                                        // tem que dizer isso, senão alguém confia que "foi enviado".
                                        if (m.direcao === 'interna') {
                                            return (
                                                <div key={m.id} className="max-w-[85%] w-fit mx-auto rounded-lg border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 text-[12px] text-amber-800 dark:text-amber-200">
                                                    <p className="text-[9px] font-bold uppercase tracking-wide">
                                                        {m.tipo === 'transferencia' ? '↪ transferência — o cliente não vê esta nota' : '📝 nota interna — o cliente não vê'}
                                                    </p>
                                                    <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                                                    <p className="text-[9px] text-amber-600/80 dark:text-amber-400/80 text-right mt-0.5 leading-none">
                                                        {(m as any).enviadoPor ? `${String((m as any).enviadoPor).split('@')[0]} · ` : ''}{horaCurta(m.timestamp, agora)}
                                                    </p>
                                                </div>
                                            );
                                        }
                                        return (
                                            <div key={m.id} className={`max-w-[78%] w-fit rounded-xl px-3 py-1.5 text-[13px] shadow-sm ${saida
                                                ? 'ml-auto bg-[#e2e9ff] dark:bg-[#24335e] text-slate-800 dark:text-slate-100 rounded-br-sm'
                                                : 'mr-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm'}`}>
                                                {midia && <p className="text-[11px] font-semibold mb-0.5">{midia}</p>}
                                                {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
                                                {!m.texto && !midia && (
                                                    <p className="italic text-slate-400 text-[11px]">
                                                        {saida
                                                            ? 'mensagem enviada por outra plataforma (a Meta não compartilha o texto)'
                                                            : `(${m.tipo || 'mensagem'})`}
                                                    </p>
                                                )}
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
                                {conduzidaPorOutro && (
                                    <div className="rounded-xl border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/20 px-3 py-2 mb-1.5 flex items-center justify-between gap-2">
                                        <p className="text-[11px] text-sky-800 dark:text-sky-300">
                                            🙋 Em condução por <strong>{sel.atribuidoA!.split('@')[0]}</strong> — duas vozes na
                                            mesma conversa confundem o cliente. Assuma pra responder, ou deixe uma nota interna.
                                        </p>
                                        <button onClick={acaoAssumir}
                                            className="shrink-0 text-[11px] font-bold px-3 py-1 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white">
                                            Assumir
                                        </button>
                                    </div>
                                )}
                                {janela?.aberta && !conduzidaPorOutro && (
                                    <div className="flex gap-1.5 flex-wrap mb-1.5">
                                        {['Bom dia! Tudo bem?', 'Recebido, já estamos verificando.', 'Pode nos enviar o comprovante, por favor?', 'Ficamos à disposição!'].map((q) => (
                                            <button key={q} onClick={() => setTexto((t) => (t ? `${t} ${q}` : q))}
                                                className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600">
                                                ⚡ {q}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {conduzidaPorOutro ? null : janela?.aberta ? (
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
                                            className="shrink-0 px-4 py-2 rounded-xl bg-[#0e3bfa] hover:bg-[#091d8d] text-white text-[13px] font-bold disabled:opacity-40"
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
                                    <>
                                        <p className="text-[11px] text-slate-600 dark:text-slate-300 font-semibold">{sel.empresaNome || sel.empresaId}</p>
                                        <button onClick={() => acaoVincular('', '')} className="text-[10px] text-slate-400 hover:text-red-600 mt-1">✕ desvincular</button>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-[11px] text-amber-700 dark:text-amber-400 mb-1">Sem vínculo com o cadastro.</p>
                                        <button onClick={() => setVincAberto(true)}
                                            className="w-full text-[11px] font-bold px-2 py-1 rounded bg-[#0e3bfa] hover:bg-[#091d8d] text-white">
                                            🔗 Vincular ao cliente
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-2.5">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Conversa</p>
                                <p className="text-[11px] text-slate-600 dark:text-slate-300">Fila: <strong>{rotuloCurtoFila(sel.fila)}</strong></p>
                                <p className="text-[11px] text-slate-600 dark:text-slate-300">Atribuída a: <strong>{sel.atribuidoA ? sel.atribuidoA.split('@')[0] : 'ninguém ainda'}</strong></p>
                                <p className="text-[11px] text-slate-600 dark:text-slate-300">Situação: <strong>{sel.situacao}</strong></p>
                                {sel.protocolo && <p className="text-[11px] text-slate-600 dark:text-slate-300">Protocolo: <strong>{sel.protocolo}</strong></p>}
                            </div>
                            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-2.5">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Ações</p>
                                {acaoErro && <p className="text-[10px] text-red-600 dark:text-red-400 mb-1.5">{acaoErro}</p>}
                                <div className="space-y-1.5">
                                    <button onClick={acaoAssumir}
                                        className="w-full text-left text-[11px] px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
                                        {sel.atribuidoA === meuEmail ? '↩️ Liberar a conversa' : '🙋 Assumir pra mim'}
                                    </button>
                                    <label className="block text-[10px] text-slate-400">
                                        ↪️ Transferir de fila
                                        <select value={transFila} onChange={(e) => { setTransFila(e.target.value); setTransAviso(null); }} className={CAMPO}>
                                            <option value="">Transferir para…</option>
                                            {(filas.length ? filas : [{ id: 'recepcao', rotulo: 'Recepção / Front Desk' }])
                                                .filter((f) => f.id !== (sel.fila || 'recepcao'))
                                                .map((f) => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
                                        </select>
                                    </label>
                                    {transFila && (
                                        <div className="space-y-1">
                                            <input value={transRecado} onChange={(e) => setTransRecado(e.target.value)}
                                                placeholder="Recado pra fila destino (opcional — vira nota interna)" className={CAMPO} />
                                            <button onClick={acaoTransferir}
                                                className="w-full text-[11px] font-bold px-2 py-1 rounded bg-[#0e3bfa] hover:bg-[#091d8d] text-white">
                                                ↪️ Transferir pra {rotuloCurtoFila(transFila)} (sai da sua condução)
                                            </button>
                                        </div>
                                    )}
                                    {transAviso && <p className="text-[10px] text-emerald-600 dark:text-emerald-400">{transAviso}</p>}
                                    {notaAberta ? (
                                        <div className="space-y-1">
                                            <textarea value={notaTexto} onChange={(e) => setNotaTexto(e.target.value)} rows={2}
                                                placeholder="Nota interna — o cliente NÃO vê" className={CAMPO} />
                                            <div className="flex gap-1.5">
                                                <button onClick={acaoNota} disabled={!notaTexto.trim()}
                                                    className="flex-1 text-[11px] font-bold px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40">📝 Gravar nota</button>
                                                <button onClick={() => { setNotaAberta(false); setNotaTexto(''); }}
                                                    className="text-[11px] px-2 py-1 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">✕</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button onClick={() => setNotaAberta(true)}
                                            className="w-full text-left text-[11px] px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
                                            📝 Nota interna
                                        </button>
                                    )}
                                    <button onClick={acaoSituacao}
                                        className={`w-full text-left text-[11px] px-2 py-1 rounded border ${sel.situacao === 'resolvida'
                                            ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                                            : 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white font-bold'}`}>
                                        {sel.situacao === 'resolvida' ? '↺ Reabrir conversa' : '✅ Resolver conversa'}
                                    </button>
                                </div>
                            </div>
                            <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-2.5 text-[10px] text-slate-400">
                                Em breve nesta coluna: guias enviadas ao cliente (rito #293) quando o contato
                                estiver vinculado, e o responsável da carteira.
                            </div>
                        </>
                    )}
                </div>
            </div>
            <p className="text-right text-[9px] text-slate-400 mt-1 pr-1">
                SP Connect{buildInfo ? ` · build ${buildInfo}` : ''} — o build no print diz qual versão você está vendo.
            </p>
        </div>
    );
};

export default SpConnect;
