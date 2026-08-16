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
    listarAtendentes, salvarFilasAtendente, salvarPapelAtendente, importarUltrafox,
    listarAvaliacoes, clienteDaConversa, abrirMidia, enviarAnexo,
    listarCanais, salvarCanal, Atendente, ImportPreview, AvaliacaoAtendimento,
    ClienteDaConversa, CanalWhatsapp,
} from '../../services/spConnectService';
import { listarTemplates, listarTemplatesDaMeta, WhatsappTemplate, TemplateDaMeta } from '../../services/whatsappTemplatesService';
import {
    suporteDeGravacao, nomeDoAudio, duracaoLegivel, traduzirErroDeMicrofone,
    atingiuLimite, LIMITE_SEGUNDOS,
} from '../../services/gravacaoAudio';
import {
    avisosDeNovasMensagens, tituloComContador, estadoDaPermissao, textoDaPermissao,
} from '../../services/notificacaoConnect';
import { destravarSom, somDestravado, tocarAviso } from '../../services/somAviso';
import { pushConfigurado, registrarDispositivo } from '../../services/pushConnect';
import {
    SOBRE_VERSAO, POR_QUE, O_QUE_FAZ, DIFERENCIAIS, MANUAL, REVISOES,
    temSobreNaoLido, marcarSobreComoLido, dataBr,
} from '../../services/sobreConnect';
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
    const [papel, setPapel] = useState<'admin' | 'gestor' | 'colaborador'>('colaborador');
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
            if (r.papel) setPapel(r.papel);
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
        setAcaoErro(null);
        setSituacaoAviso(null);
        setTransAviso(null);
        setTransFila('');
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
    // Encerrar/reabrir: admin e gestor, qualquer; colaborador, só o que conduz.
    const podeEncerrarSel = papel === 'admin' || papel === 'gestor' || (sel?.atribuidoA != null && sel.atribuidoA === meuEmail);
    const [situacaoAviso, setSituacaoAviso] = useState<string | null>(null);
    const acaoSituacao = async () => {
        if (!sel) return;
        const nova = sel.situacao === 'resolvida' ? 'aberta' : 'resolvida';
        setAcaoErro(null);
        setSituacaoAviso(null);
        const r = await mudarSituacao(sel.numero, nova);
        if (!r.ok) { setAcaoErro(`${r.error}${(r as any).acao ? ` ${(r as any).acao}` : ''}`); return; }
        patchSel({ situacao: nova });
        if (nova === 'resolvida') {
            setSituacaoAviso({
                enviada: '✓ Encerrado — pesquisa de avaliação enviada ao cliente.',
                'janela-fechada': '✓ Encerrado. A pesquisa NÃO saiu (janela de 24h fechada).',
                falhou: '✓ Encerrado. A pesquisa falhou ao enviar.',
                desligada: '✓ Encerrado (pesquisa de avaliação desligada na ⚙️).',
            }[r.avaliacao || 'desligada'] || '✓ Encerrado.');
        }
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
    const [cfgAba, setCfgAba] = useState<'bot' | 'atendentes' | 'importar' | 'canais'>('bot');
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

    // ── 📎 Anexos: abrir o recebido e enviar o novo ─────────────────────────
    // Object URLs abertos ficam guardados por mensagem (a mesma foto não
    // baixa duas vezes) e são REVOGADOS ao trocar de conversa — sem isso o
    // navegador segura os blobs até o F5.
    const [midias, setMidias] = useState<Record<string, { url: string; mime: string }>>({});
    const [midiaErro, setMidiaErro] = useState<Record<string, string>>({});
    const [midiaCarregando, setMidiaCarregando] = useState<string | null>(null);
    const midiasRef = useRef<Record<string, { url: string; mime: string }>>({});
    midiasRef.current = midias;
    useEffect(() => () => { Object.values(midiasRef.current).forEach((m) => URL.revokeObjectURL(m.url)); }, []);

    const verMidia = async (m: MensagemInbox) => {
        if (!sel || midias[m.id] || midiaCarregando) return;
        setMidiaCarregando(m.id);
        setMidiaErro((e) => ({ ...e, [m.id]: '' }));
        try {
            const r = await abrirMidia(sel.numero, m.id);
            if (!r.ok) { setMidiaErro((e) => ({ ...e, [m.id]: `${r.error}${r.acao ? ` ${r.acao}` : ''}` })); return; }
            setMidias((x) => ({ ...x, [m.id]: { url: r.url, mime: r.mime } }));
        } finally { setMidiaCarregando(null); }
    };

    const [anexando, setAnexando] = useState(false);
    const inputAnexo = useRef<HTMLInputElement>(null);
    const mandarAnexo = async (arquivo: File | null) => {
        if (!arquivo || !sel || anexando) return;
        setAnexando(true);
        setErroEnvio(null);
        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const leitor = new FileReader();
                leitor.onload = () => resolve(String(leitor.result || '').split(',')[1] || '');
                leitor.onerror = () => reject(new Error('não deu pra ler o arquivo'));
                leitor.readAsDataURL(arquivo);
            });
            const r = await enviarAnexo(sel.numero, {
                base64, nomeArquivo: arquivo.name,
                mime: arquivo.type || 'application/octet-stream',
                legenda: texto.trim() || undefined,
            });
            if (!r.ok) {
                if ((r as any).emConducaoPor) patchSel({ atribuidoA: (r as any).emConducaoPor });
                setErroEnvio(`${r.error}${(r as any).acao ? ` ${(r as any).acao}` : ''}`);
                return;
            }
            setMensagens((m) => [...m, r.mensagem]);
            setTexto('');
            if (r.legendaIgnorada) setErroEnvio('Anexo enviado — mas a legenda NÃO foi junto: áudio não aceita legenda no WhatsApp.');
            if (r.copiaGuardada === false) setErroEnvio('Anexo enviado ao cliente, mas a cópia no histórico falhou — ele pode não abrir aqui depois.');
            if (!sel.atribuidoA) patchSel({ atribuidoA: meuEmail });
        } catch (e) {
            setErroEnvio((e as Error).message);
        } finally {
            setAnexando(false);
            if (inputAnexo.current) inputAnexo.current.value = '';
        }
    };

    // ── 🎤 Gravar áudio e mandar (a Ultra Fox faz; agora sai por nós) ───────
    // O arquivo gravado entra pela MESMA rota /anexo — nada de segundo
    // caminho de envio (que divergiria da trava de janela e de condução).
    const [gravando, setGravando] = useState(false);
    const [segundos, setSegundos] = useState(0);
    const [previa, setPrevia] = useState<{ url: string; blob: Blob; nome: string } | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const pedacosRef = useRef<BlobPart[]>([]);
    const timerRef = useRef<number | null>(null);
    const suporte = suporteDeGravacao();

    const pararCronometro = () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    // Solta o microfone SEMPRE que o componente sai — luz de gravação acesa
    // depois de fechar a tela é o tipo de coisa que destrói confiança.
    useEffect(() => () => {
        pararCronometro();
        recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
        if (previa) URL.revokeObjectURL(previa.url);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const comecarGravacao = async () => {
        if (!suporte.suportado || gravando) return;
        setErroEnvio(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const rec = new MediaRecorder(stream, { mimeType: suporte.mime });
            pedacosRef.current = [];
            rec.ondataavailable = (e) => { if (e.data.size) pedacosRef.current.push(e.data); };
            rec.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());   // solta o microfone
                pararCronometro();
                const blob = new Blob(pedacosRef.current, { type: suporte.mime });
                // Gravação vazia (clique sem falar) NÃO vira arquivo de 0 byte.
                if (!blob.size) { setGravando(false); setSegundos(0); return; }
                setPrevia({ url: URL.createObjectURL(blob), blob, nome: nomeDoAudio(new Date(), suporte.extensao) });
                setGravando(false);
            };
            recorderRef.current = rec;
            rec.start();
            setGravando(true);
            setSegundos(0);
            timerRef.current = window.setInterval(() => {
                setSegundos((s) => {
                    const novo = s + 1;
                    // Para sozinho no teto — estourar depois de 5 minutos de
                    // fala jogaria o áudio inteiro fora.
                    if (atingiuLimite(novo)) {
                        try { recorderRef.current?.stop(); } catch { /* já parado */ }
                        setErroEnvio(`Gravação encerrada no limite de ${LIMITE_SEGUNDOS / 60} minutos.`);
                    }
                    return novo;
                });
            }, 1000);
        } catch (e) {
            const t = traduzirErroDeMicrofone(e as { name?: string; message?: string });
            setErroEnvio(`${t.erro} ${t.acao}`);
            setGravando(false);
        }
    };

    const pararGravacao = () => { try { recorderRef.current?.stop(); } catch { /* já parado */ } };

    const descartarPrevia = () => {
        if (previa) URL.revokeObjectURL(previa.url);
        setPrevia(null);
        setSegundos(0);
    };

    const enviarAudioGravado = async () => {
        if (!previa || !sel || anexando) return;
        setAnexando(true);
        setErroEnvio(null);
        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const leitor = new FileReader();
                leitor.onload = () => resolve(String(leitor.result || '').split(',')[1] || '');
                leitor.onerror = () => reject(new Error('não deu pra ler o áudio gravado'));
                leitor.readAsDataURL(previa.blob);
            });
            const r = await enviarAnexo(sel.numero, { base64, nomeArquivo: previa.nome, mime: previa.blob.type });
            if (!r.ok) {
                if ((r as any).emConducaoPor) patchSel({ atribuidoA: (r as any).emConducaoPor });
                setErroEnvio(`${r.error}${(r as any).acao ? ` ${(r as any).acao}` : ''}`);
                return;
            }
            setMensagens((m) => [...m, r.mensagem]);
            descartarPrevia();
            if (!sel.atribuidoA) patchSel({ atribuidoA: meuEmail });
        } catch (e) {
            setErroEnvio((e as Error).message);
        } finally { setAnexando(false); }
    };

    // ── Cliente 360 (pós-vínculo): responsável da carteira + guias do rito.
    // NENHUMA conta nova — a rota só lê carteiras e impostos_enviados.
    const [cliente360, setCliente360] = useState<ClienteDaConversa | null>(null);
    useEffect(() => {
        setCliente360(null);
        const numero = sel?.numero;
        if (!numero || !sel?.empresaId) return;
        let vivo = true;
        clienteDaConversa(numero).then((r) => { if (vivo && r.ok) setCliente360(r); });
        return () => { vivo = false; };
    }, [sel?.numero, sel?.empresaId]);

    // ── 📊 Avaliações (admin/gestor: todas · colaborador: as próprias — o
    // recorte é do backend; a tela só DIZ qual escopo está vendo)
    const [avAberto, setAvAberto] = useState(false);
    const [avDados, setAvDados] = useState<{
        escopo: string; total: number; media: number | null;
        porNota: { nota: number; quantidade: number }[]; avaliacoes: AvaliacaoAtendimento[];
    } | null>(null);
    const [avErro, setAvErro] = useState<string | null>(null);
    const abrirAvaliacoes = async () => {
        setAvAberto(true);
        setAvErro(null);
        const r = await listarAvaliacoes();
        if (r.ok) setAvDados({ escopo: r.escopo, total: r.total, media: r.media, porNota: r.porNota, avaliacoes: r.avaliacoes });
        else setAvErro(r.error || 'Falha ao carregar as avaliações.');
    };

    // ── ℹ️ SOBRE: manual, o que o app faz, por que existe e o que mudou.
    // O selo vermelho é a única coisa que diz à equipe que há o que ler — e
    // ele só apaga quando ALGUÉM ABRE (apagar sozinho seria mentira).
    const [sobreAberto, setSobreAberto] = useState(false);
    const [sobreAba, setSobreAba] = useState<'manual' | 'novidades' | 'sobre'>('manual');
    const [sobreNovo, setSobreNovo] = useState(false);
    useEffect(() => { setSobreNovo(temSobreNaoLido()); }, []);
    const abrirSobre = (aba: 'manual' | 'novidades' | 'sobre' = 'manual') => {
        setSobreAba(aba);
        setSobreAberto(true);
        marcarSobreComoLido();
        setSobreNovo(false);
    };

    // ── 📞 Canais (2º número): o seletor/selo só aparece com mais de um.
    const [canais, setCanais] = useState<CanalWhatsapp[]>([]);
    const [multiCanal, setMultiCanal] = useState(false);
    const [canalErro, setCanalErro] = useState<string | null>(null);
    const [canalForm, setCanalForm] = useState({ id: '', rotulo: '', phoneNumberId: '', envToken: '', numeroExibicao: '', wabaId: '' });
    const [salvandoCanal, setSalvandoCanal] = useState(false);
    const carregarCanais = useCallback(async () => {
        const r = await listarCanais();
        if (r.ok) { setCanais(r.canais || []); setMultiCanal(Boolean(r.multiCanal)); }
    }, []);
    useEffect(() => { carregarCanais(); }, [carregarCanais]);
    const rotuloCanal = (id: string | null | undefined) =>
        canais.find((c) => c.id === (id || 'principal'))?.rotulo || 'Número principal';
    const cadastrarCanal = async () => {
        setSalvandoCanal(true);
        setCanalErro(null);
        try {
            const r = await salvarCanal(canalForm);
            if (!r.ok) { setCanalErro(r.error || 'Falha ao salvar o canal.'); return; }
            setCanalForm({ id: '', rotulo: '', phoneNumberId: '', envToken: '', numeroExibicao: '', wabaId: '' });
            await carregarCanais();
        } finally { setSalvandoCanal(false); }
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

    // ── 🔔 AVISO DE MENSAGEM NOVA (a última bloqueante do corte) ────────────
    // Paulo, 16/08: "quanto mais notificação melhor, evita desculpa que o
    // colaborador não viu". São TRÊS camadas: som, pop-up do navegador e o
    // título da aba com contador (o pop-up some, o título fica).
    const [permissaoAviso, setPermissaoAviso] = useState(() => estadoDaPermissao());
    const [somOk, setSomOk] = useState(false);
    const avisadosRef = useRef<Record<string, string>>({});
    const primeiraCargaRef = useRef(true);

    // O navegador só deixa tocar som depois de um GESTO. Destrava no
    // primeiro clique/tecla — sem isso o som seria engolido em silêncio e o
    // atendente acharia que o app avisa quando não avisa.
    useEffect(() => {
        const destravar = async () => { setSomOk(await destravarSom()); };
        window.addEventListener('pointerdown', destravar, { once: true });
        window.addEventListener('keydown', destravar, { once: true });
        return () => {
            window.removeEventListener('pointerdown', destravar);
            window.removeEventListener('keydown', destravar);
        };
    }, []);

    // 📱 Push no celular (app FECHADO): só depois da permissão concedida —
    // pedir permissão dentro da função técnica esconderia o gesto do usuário.
    const [push, setPush] = useState<{ ligado: boolean; msg: string | null; acao?: string }>({ ligado: false, msg: null });
    const ligarPush = async () => {
        const r = await registrarDispositivo();
        if (r.pronto) setPush({ ligado: true, msg: `📱 Push ligado neste aparelho (${r.dispositivos} registrado(s)).` });
        else setPush({ ligado: false, msg: r.motivo, acao: r.acao });
    };

    const pedirPermissaoAviso = async () => {
        if (!('Notification' in window)) { setPermissaoAviso('sem-suporte'); return; }
        setSomOk(await destravarSom());        // o clique daqui também destrava o som
        try {
            await Notification.requestPermission();
        } finally {
            const novo = estadoDaPermissao();
            setPermissaoAviso(novo);
            // Permissão concedida ⇒ já registra o celular pro push, senão o
            // aviso só valeria com o app aberto (e a promessa era o celular).
            if (novo === 'concedida' && pushConfigurado().ok) await ligarPush();
        }
    };

    // Dispara os avisos quando a lista muda (a lista já vem filtrada pelas
    // filas da pessoa — o recorte é do backend).
    useEffect(() => {
        const { avisos, novoEstado } = avisosDeNovasMensagens({
            conversas: conversas.map((c) => ({ numero: c.numero, nome: c.nome, naoLidas: c.naoLidas, ultimaMensagem: c.ultimaMensagem })),
            jaAvisados: avisadosRef.current,
            abertaNumero: selRef.current?.numero || null,
            primeiraCarga: primeiraCargaRef.current,
            nomeExibicao: (c) => nomeExibicao({ nome: c.nome, numero: c.numero }),
        });
        avisadosRef.current = novoEstado;
        if (primeiraCargaRef.current) { primeiraCargaRef.current = false; return; }
        if (!avisos.length) return;

        tocarAviso();
        if (permissaoAviso === 'concedida') {
            for (const a of avisos.slice(0, 3)) {   // 3 pop-ups bastam; o resto está na lista
                try {
                    const n = new Notification(a.titulo, {
                        body: a.corpo, icon: '/connect-icon-192.png',
                        tag: `spconnect-${a.numero}`,   // mesma conversa ATUALIZA, não empilha
                    });
                    n.onclick = () => {
                        window.focus();
                        const alvo = conversas.find((c) => c.numero === a.numero);
                        if (alvo) abrir(alvo);
                        n.close();
                    };
                } catch { /* o pop-up é conforto; o som e o título já avisaram */ }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversas]);

    // Título da aba com o contador — sobrevive ao pop-up que some.
    const naoLidasTotalAviso = conversas.reduce((s, c) => s + (c.naoLidas || 0), 0);
    useEffect(() => {
        document.title = tituloComContador(naoLidasTotalAviso, 'SP Connect — Atendimento WhatsApp');
    }, [naoLidasTotalAviso]);

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

            {/* ── Modal 📊 Avaliações dos atendimentos ──────────────────────── */}
            {avAberto && (
                <div className="fixed inset-0 bg-black/60 z-[80] flex items-start justify-center p-4 overflow-y-auto" onClick={() => setAvAberto(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md my-8 p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">📊 Avaliações dos atendimentos</h3>
                            <button onClick={() => setAvAberto(false)} className="text-slate-400 hover:text-slate-600 px-1">✕</button>
                        </div>
                        {avErro && <p className="text-[11px] text-red-600 dark:text-red-400">{avErro}</p>}
                        {!avDados && !avErro && <p className="text-[11px] text-slate-400">Carregando…</p>}
                        {avDados && (
                            <>
                                <p className="text-[10px] text-slate-400">
                                    {avDados.escopo === 'todas' ? 'Todas as avaliações da casa (você é gestor/admin).' : 'Só as SUAS avaliações — gestor e admin veem todas.'}
                                </p>
                                <div className="flex items-baseline gap-3">
                                    <span className="text-3xl font-black text-slate-800 dark:text-slate-100">{avDados.media != null ? avDados.media.toFixed(2) : '—'}</span>
                                    <span className="text-[11px] text-slate-500">média · {avDados.total} avaliação(ões)</span>
                                </div>
                                <div className="space-y-1">
                                    {[...avDados.porNota].reverse().map((p) => (
                                        <div key={p.nota} className="flex items-center gap-2">
                                            <span className="text-[10px] w-8 text-slate-500">{p.nota} ⭐</span>
                                            <div className="flex-1 h-2 rounded bg-slate-100 dark:bg-slate-700 overflow-hidden">
                                                <div className="h-full bg-[#0e3bfa]" style={{ width: avDados.total ? `${(p.quantidade / avDados.total) * 100}%` : '0%' }} />
                                            </div>
                                            <span className="text-[10px] w-6 text-right text-slate-500">{p.quantidade}</span>
                                        </div>
                                    ))}
                                </div>
                                {avDados.total === 0 && (
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Nenhuma avaliação ainda. A pesquisa é enviada no ENCERRAMENTO do atendimento —
                                        e a chave dela nasce desligada (⚙️ → 🤖).
                                    </p>
                                )}
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                    {avDados.avaliacoes.map((a) => (
                                        <div key={a.id} className="flex items-center justify-between text-[10px] text-slate-500 border-b border-slate-100 dark:border-slate-700/50 py-1">
                                            <span>{'⭐'.repeat(a.nota)} · {formatarNumeroBr(a.numero)}{a.atendente ? ` · ${a.atendente.split('@')[0]}` : ''}</span>
                                            <span>{horaCurta(a.em, agora)}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ── Modal ℹ️ SOBRE (manual · novidades · o app) ────────────────── */}
            {sobreAberto && (
                // items-start + overflow-y-auto: com o manual inteiro, `items-center`
                // esconderia o fim da lista (a trava de layout do projeto).
                <div className="fixed inset-0 bg-black/60 z-[80] flex items-start justify-center p-4 overflow-y-auto" onClick={() => setSobreAberto(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                            <div className="min-w-0">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">ℹ️ Sobre o SP Connect</h3>
                                <p className="text-[10px] text-slate-400">
                                    O atendimento por WhatsApp da SP Assessoria Contábil · última atualização {dataBr(SOBRE_VERSAO)}
                                </p>
                            </div>
                            <button onClick={() => setSobreAberto(false)} className="text-slate-400 hover:text-slate-600 px-1 shrink-0">✕</button>
                        </div>

                        <div className="flex gap-1.5 px-4 pt-3 flex-wrap">
                            {([
                                ['manual', '📖 Manual de uso'],
                                ['novidades', '✨ O que mudou'],
                                ['sobre', '💡 O que é e por quê'],
                            ] as const).map(([id, rotulo]) => (
                                <button key={id} onClick={() => setSobreAba(id)}
                                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${sobreAba === id
                                        ? 'bg-[#0e3bfa] text-white'
                                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                    {rotulo}
                                </button>
                            ))}
                        </div>

                        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
                            {sobreAba === 'manual' && (
                                <>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Passo a passo do dia a dia. Se algo na tela não bater com o que está escrito
                                        aqui, o errado é o manual — avise o Paulo.
                                    </p>
                                    {/* Guia de instalação: quem atende todo dia tem que INSTALAR
                                        (aba fechada não toca som nem pop-up). Guia sem caminho na
                                        tela é guia que ninguém acha. */}
                                    <a href="/guia-instalar-sp-connect.html" target="_blank" rel="noreferrer"
                                        className="block rounded-lg border border-[#0e3bfa]/30 bg-[#0e3bfa]/5 px-3 py-2 hover:bg-[#0e3bfa]/10">
                                        <p className="text-[11px] font-bold text-[#0e3bfa] dark:text-sky-300">
                                            📲 Instalar o SP Connect no Teams, no celular, no tablet e no computador →
                                        </p>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                            Guia com o passo a passo de cada um. Quem atende todo dia deve instalar:
                                            com a aba fechada, som e pop-up não tocam.
                                        </p>
                                    </a>
                                    {MANUAL.map((s) => (
                                        <div key={s.titulo} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                            <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">{s.titulo}</p>
                                            <ul className="mt-1.5 space-y-1">
                                                {s.passos.map((p, i) => (
                                                    <li key={i} className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug flex gap-1.5">
                                                        <span className="text-slate-300 dark:text-slate-600 shrink-0">•</span>
                                                        <span>{p}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                            {s.atencao && (
                                                <p className="mt-2 text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1 leading-snug">
                                                    ⚠️ {s.atencao}
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                        <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">As filas que existem hoje</p>
                                        {/* A lista sai do catálogo CARREGADO, nunca de uma cópia
                                            escrita aqui: fila nova apareceria só num dos dois. */}
                                        {filas.length === 0 ? (
                                            <p className="text-[11px] text-slate-400 mt-1">Carregando as filas…</p>
                                        ) : (
                                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                {filas.map((f) => (
                                                    <span key={f.id} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                                        {f.rotulo}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
                                            Você atende {minhasFilas === null ? '—' : minhasFilas.length === 0 ? 'nenhuma fila ainda' : `${minhasFilas.length} fila(s)`}
                                            {papel !== 'colaborador' ? ` · seu perfil é ${papel} (vê e atende tudo)` : ''}.
                                        </p>
                                    </div>
                                </>
                            )}

                            {sobreAba === 'novidades' && (
                                <>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        O ponto vermelho no ℹ️ acende quando entra revisão nova e some quando você abre aqui.
                                    </p>
                                    {REVISOES.map((r) => (
                                        <div key={r.data} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                            <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">
                                                {dataBr(r.data)}
                                                {r.data === SOBRE_VERSAO && (
                                                    <span className="ml-2 text-[9px] font-bold px-1.5 py-px rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                                                        mais recente
                                                    </span>
                                                )}
                                            </p>
                                            <ul className="mt-1.5 space-y-1">
                                                {r.itens.map((i, k) => (
                                                    <li key={k} className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug flex gap-1.5">
                                                        <span className="text-slate-300 dark:text-slate-600 shrink-0">•</span>
                                                        <span>{i}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </>
                            )}

                            {sobreAba === 'sobre' && (
                                <>
                                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                        <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">Por que ele foi criado</p>
                                        <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">{POR_QUE}</p>
                                    </div>

                                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide pt-1">O que ele faz</p>
                                    <div className="grid sm:grid-cols-2 gap-2">
                                        {O_QUE_FAZ.map((b) => (
                                            <div key={b.titulo} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
                                                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">{b.titulo}</p>
                                                <p className="mt-1 text-[10.5px] text-slate-600 dark:text-slate-300 leading-snug">{b.texto}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide pt-1">
                                        O que ele tem que os apps de mercado não têm
                                    </p>
                                    <div className="space-y-2">
                                        {DIFERENCIAIS.map((b) => (
                                            <div key={b.titulo} className="rounded-lg border-l-4 border-[#0e3bfa] bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                                                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">{b.titulo}</p>
                                                <p className="mt-0.5 text-[10.5px] text-slate-600 dark:text-slate-300 leading-snug">{b.texto}</p>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
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
                            {([['bot', '🤖 Bot e mensagens'], ['atendentes', '👥 Atendentes e filas'], ['canais', '📞 Números'], ['importar', '📥 Importar Ultra Fox']] as const).map(([id, rotulo]) => (
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
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                                                    {a.nome || a.email || a.uid}
                                                    {a.role === 'admin' && <span className="ml-1.5 text-[9px] font-bold text-emerald-600">admin · tudo</span>}
                                                </p>
                                                {a.role !== 'admin' && (
                                                    <button
                                                        onClick={async () => {
                                                            const novo = a.papelAtendimento === 'gestor' ? 'colaborador' : 'gestor';
                                                            const r = await salvarPapelAtendente(a.uid, novo);
                                                            if (!r.ok) { setAtdErro(r.error || 'Falha ao salvar o papel.'); return; }
                                                            setAtendentes((lst) => lst.map((x) => (x.uid === a.uid ? { ...x, papelAtendimento: r.papel } : x)));
                                                        }}
                                                        title="Gestor: vê e atende tudo, encerra qualquer atendimento — só não altera a ⚙️"
                                                        className={`shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full ${a.papelAtendimento === 'gestor'
                                                            ? 'bg-amber-500 text-white'
                                                            : 'bg-slate-100 dark:bg-slate-700 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                                        ⭐ {a.papelAtendimento === 'gestor' ? 'Gestor' : 'tornar gestor'}
                                                    </button>
                                                )}
                                            </div>
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
                        {/* ── aba 📞 Números (2º número / 2ª WABA) ────────── */}
                        {cfgAba === 'canais' && (
                            <div className="space-y-2">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    O número de hoje vem do Cloud Run e é o <strong>padrão</strong> — nada a fazer aqui
                                    enquanto for um só. Para ligar um segundo número, cadastre-o abaixo e coloque o
                                    token dele no Cloud Run com o NOME que você informar.
                                    <strong> O token nunca é digitado aqui</strong> (ele não pode ficar no banco).
                                </p>
                                <div className="space-y-1.5">
                                    {canais.map((c) => (
                                        <div key={c.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                                                    {c.rotulo}
                                                    {c.origem === 'env' && <span className="ml-1.5 text-[9px] font-bold text-slate-400">padrão · Cloud Run</span>}
                                                </p>
                                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${c.pronto
                                                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                                    : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'}`}>
                                                    {c.pronto ? 'pronto' : 'incompleto'}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-slate-400">
                                                {c.numeroExibicao || 'número não informado'} · id {c.phoneNumberId || '—'}
                                                {c.envToken ? ` · token em ${c.envToken}` : ''}
                                            </p>
                                            {!c.pronto && (c.faltas || []).length > 0 && (
                                                <p className="text-[10px] text-red-600 dark:text-red-400">falta: {(c.faltas || []).join(' · ')}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-2.5 space-y-1.5">
                                    <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">➕ Novo número</p>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        <input value={canalForm.id} onChange={(e) => setCanalForm((f) => ({ ...f, id: e.target.value }))} placeholder="id (ex.: rh)" className={CAMPO} />
                                        <input value={canalForm.rotulo} onChange={(e) => setCanalForm((f) => ({ ...f, rotulo: e.target.value }))} placeholder="Rótulo (ex.: RH)" className={CAMPO} />
                                        <input value={canalForm.phoneNumberId} onChange={(e) => setCanalForm((f) => ({ ...f, phoneNumberId: e.target.value }))} placeholder="phone number ID (painel da Meta)" className={CAMPO} />
                                        <input value={canalForm.numeroExibicao} onChange={(e) => setCanalForm((f) => ({ ...f, numeroExibicao: e.target.value }))} placeholder="+55 11 ..." className={CAMPO} />
                                        <input value={canalForm.envToken} onChange={(e) => setCanalForm((f) => ({ ...f, envToken: e.target.value }))} placeholder="NOME da env do token (ex.: WHATSAPP_CLOUD_TOKEN_RH)" className={`${CAMPO} col-span-2`} />
                                        <input value={canalForm.wabaId} onChange={(e) => setCanalForm((f) => ({ ...f, wabaId: e.target.value }))} placeholder="WABA id (opcional)" className={`${CAMPO} col-span-2`} />
                                    </div>
                                    {canalErro && <p className="text-[11px] text-red-600 dark:text-red-400">{canalErro}</p>}
                                    <button onClick={cadastrarCanal} disabled={salvandoCanal}
                                        className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                        {salvandoCanal ? 'Salvando…' : 'Cadastrar número'}
                                    </button>
                                    <p className="text-[10px] text-slate-400">
                                        Depois de cadastrar: no Cloud Run, crie a variável com esse NOME e o token do número.
                                        A entrada é roteada pelo próprio aviso da Meta — nada de adivinhar de quem é a mensagem.
                                    </p>
                                </div>
                            </div>
                        )}

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
                                    <label className="flex items-center gap-2 cursor-pointer mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                                        <input type="checkbox" checked={cfg.avaliacaoAtiva}
                                            onChange={(e) => setCfg((c) => (c ? { ...c, avaliacaoAtiva: e.target.checked } : c))} />
                                        <span className="text-[11px] text-slate-700 dark:text-slate-200">
                                            📊 Pedir AVALIAÇÃO (nota 1-5) ao encerrar o atendimento
                                            <span className="block text-[9px] text-slate-400">só sai com a janela aberta; só a PRIMEIRA resposta vale como nota — não insiste</span>
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
                                        ['transferencia', 'Aviso de transferência — aceita {fila}'],
                                        ['avaliacao', 'Convite de avaliação (pós-encerramento)'],
                                        ['avaliacaoObrigado', 'Agradecimento da avaliação'],
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
                                <button onClick={abrirAvaliacoes} title="Avaliações dos atendimentos (nota 1-5 do cliente)"
                                    className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600">
                                    📊
                                </button>
                                <button onClick={() => abrirSobre(sobreNovo ? 'novidades' : 'manual')}
                                    title="Sobre o SP Connect: manual de uso, o que mudou e por que ele existe"
                                    className="relative text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600">
                                    ℹ️
                                    {/* O ponto vermelho é o que faz a equipe SABER que houve
                                        entrega. Sem ele, atualizar é quase não atualizar. */}
                                    {sobreNovo && (
                                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-800" />
                                    )}
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
                        {/* 🔔 Avisos: a barra só aparece quando FALTA alguma
                            camada — com tudo ligado, nada de ruído fixo. */}
                        {(permissaoAviso !== 'concedida' || !somOk) && (
                            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1.5">
                                <p className="text-[10px] text-amber-800 dark:text-amber-300 leading-snug">
                                    {textoDaPermissao(permissaoAviso).texto}
                                    {!somOk && permissaoAviso === 'concedida' && ' O som liga no primeiro clique nesta aba.'}
                                </p>
                                {textoDaPermissao(permissaoAviso).acao && (
                                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                                        {textoDaPermissao(permissaoAviso).acao}
                                    </p>
                                )}
                                {permissaoAviso === 'nao-pedida' && (
                                    <button onClick={pedirPermissaoAviso}
                                        className="mt-1 text-[10px] font-bold px-2 py-1 rounded bg-[#0e3bfa] hover:bg-[#091d8d] text-white">
                                        🔔 Ligar avisos
                                    </button>
                                )}
                                {permissaoAviso === 'concedida' && !push.ligado && pushConfigurado().ok && (
                                    <button onClick={ligarPush}
                                        className="mt-1 text-[10px] font-bold px-2 py-1 rounded bg-[#0e3bfa] hover:bg-[#091d8d] text-white">
                                        📱 Avisar também no celular
                                    </button>
                                )}
                                {push.msg && (
                                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                                        {push.msg}{push.acao ? ` ${push.acao}` : ''}
                                    </p>
                                )}
                            </div>
                        )}
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
                                        {multiCanal ? ` · 📞 ${rotuloCanal(sel.canalId)}` : ''}
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
                                                {midia && (
                                                    <div className="mb-1">
                                                        {midias[m.id] ? (
                                                            midias[m.id].mime.startsWith('image/') ? (
                                                                <a href={midias[m.id].url} target="_blank" rel="noreferrer">
                                                                    <img src={midias[m.id].url} alt={m.midia?.nomeArquivo || 'imagem'}
                                                                        className="rounded-lg max-h-64 w-auto" />
                                                                </a>
                                                            ) : midias[m.id].mime.startsWith('audio/') ? (
                                                                <audio controls src={midias[m.id].url} className="max-w-full" />
                                                            ) : midias[m.id].mime.startsWith('video/') ? (
                                                                <video controls src={midias[m.id].url} className="rounded-lg max-h-64" />
                                                            ) : (
                                                                <a href={midias[m.id].url} target="_blank" rel="noreferrer"
                                                                    download={m.midia?.nomeArquivo || 'anexo'}
                                                                    className="text-[11px] font-semibold underline">
                                                                    {midia} — abrir
                                                                </a>
                                                            )
                                                        ) : (
                                                            <button
                                                                onClick={() => verMidia(m)}
                                                                disabled={m.midia?.baixada === false || midiaCarregando === m.id}
                                                                title={m.midia?.baixada === false ? 'ainda não baixado da Meta' : 'abrir anexo'}
                                                                className="text-[11px] font-semibold underline disabled:no-underline disabled:opacity-60">
                                                                {midiaCarregando === m.id ? '⏳ abrindo…' : midia}
                                                            </button>
                                                        )}
                                                        {midiaErro[m.id] && <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">{midiaErro[m.id]}</p>}
                                                    </div>
                                                )}
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
                                {/* 🎤 Gravando / prévia — ocupa o lugar do composer:
                                    mandar áudio é uma ação só, não um campo a mais. */}
                                {!conduzidaPorOutro && janela?.aberta && gravando && (
                                    <div className="flex items-center gap-2 rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse shrink-0" />
                                        <p className="text-[12px] font-bold text-red-700 dark:text-red-300 flex-1">
                                            Gravando… {duracaoLegivel(segundos)}
                                            <span className="font-normal text-[10px] block">máx. {LIMITE_SEGUNDOS / 60} min · o áudio só sai depois que você ouvir e confirmar</span>
                                        </p>
                                        <button onClick={pararGravacao}
                                            className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white">
                                            ⏹ Parar
                                        </button>
                                    </div>
                                )}
                                {!conduzidaPorOutro && janela?.aberta && previa && (
                                    <div className="flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                                        <audio controls src={previa.url} className="h-8 flex-1 min-w-0" />
                                        <button onClick={descartarPrevia} disabled={anexando}
                                            className="text-[11px] px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40">
                                            ✕ descartar
                                        </button>
                                        <button onClick={enviarAudioGravado} disabled={anexando}
                                            className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                            {anexando ? 'Enviando…' : 'Enviar áudio ➤'}
                                        </button>
                                    </div>
                                )}
                                {conduzidaPorOutro || gravando || previa ? null : janela?.aberta ? (
                                    <div className="flex items-end gap-2">
                                        <input ref={inputAnexo} type="file" className="hidden"
                                            onChange={(e) => mandarAnexo(e.target.files?.[0] || null)} />
                                        <button
                                            onClick={suporte.suportado ? comecarGravacao : () => setErroEnvio(`${suporte.motivo} ${suporte.acao}`)}
                                            title={suporte.suportado ? 'Gravar áudio' : suporte.motivo}
                                            className={`shrink-0 px-3 py-2 rounded-xl border ${suporte.suportado
                                                ? 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                                                : 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600'}`}>
                                            🎤
                                        </button>
                                        <button
                                            onClick={() => inputAnexo.current?.click()}
                                            disabled={anexando}
                                            title="Anexar arquivo, foto ou documento (o texto escrito vira legenda)"
                                            className="shrink-0 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40">
                                            {anexando ? '⏳' : '📎'}
                                        </button>
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
                                        <p className="text-[11px] text-slate-600 dark:text-slate-300 font-semibold">
                                            {cliente360?.empresa?.nome || sel.empresaNome || sel.empresaId}
                                        </p>
                                        {cliente360?.empresa && (
                                            <p className="text-[10px] text-slate-400">
                                                {cliente360.empresa.cnpj || 'CNPJ não gravado'}{cliente360.empresa.regime ? ` · ${cliente360.empresa.regime}` : ''}
                                            </p>
                                        )}
                                        {cliente360?.empresa?.naoEncontrada && (
                                            <p className="text-[10px] text-amber-700 dark:text-amber-400">⚠️ Empresa não achada no cadastro — o vínculo pode apontar pra cadastro excluído.</p>
                                        )}
                                        {cliente360?.vinculado && (cliente360.responsaveis || []).length > 0 && (
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                                                👤 Carteira: {(cliente360.responsaveis || []).map((r) => `${r.nome}${r.papel !== 'principal' ? ` (${r.papel})` : ''}`).join(' · ')}
                                            </p>
                                        )}
                                        {cliente360?.vinculado && (cliente360.responsaveis || []).length === 0 && (
                                            <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">Sem responsável de carteira atribuído.</p>
                                        )}
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
                                    <button onClick={acaoSituacao} disabled={!podeEncerrarSel}
                                        title={podeEncerrarSel ? '' : 'Só quem conduz (ou gestor/admin) encerra — assuma a conversa primeiro'}
                                        className={`w-full text-left text-[11px] px-2 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed ${sel.situacao === 'resolvida'
                                            ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                                            : 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white font-bold'}`}>
                                        {sel.situacao === 'resolvida' ? '↺ Reabrir atendimento' : '✅ Encerrar atendimento'}
                                    </button>
                                    {!podeEncerrarSel && (
                                        <p className="text-[9px] text-slate-400">Encerrar: quem conduz, gestor ou admin. Assuma (🙋) pra encerrar.</p>
                                    )}
                                    {situacaoAviso && <p className="text-[10px] text-emerald-600 dark:text-emerald-400">{situacaoAviso}</p>}
                                </div>
                            </div>
                            {sel.empresaId && cliente360?.vinculado && (
                                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-2.5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                                        Guias enviadas · rito #293
                                    </p>
                                    {(cliente360.guias || []).length === 0 ? (
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                            Nenhum envio registrado pra esta empresa — a lista nasce dos envios
                                            feitos pelo app (DAS/DARF/DARE), não prova ausência de guia.
                                        </p>
                                    ) : (
                                        <div className="space-y-1">
                                            {(cliente360.guias || []).map((g, i) => (
                                                <div key={i} className="flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-700/50 pb-1">
                                                    <span className="font-semibold">
                                                        {g.tipo || 'guia'}{g.competencia ? ` ${g.competencia}` : ''}
                                                        {g.valor != null && (
                                                            <span className="font-normal text-slate-400"> · {g.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                                        )}
                                                    </span>
                                                    <span className="text-slate-400 shrink-0">{horaCurta(g.enviadoEm, agora)}</span>
                                                </div>
                                            ))}
                                            {(cliente360.totalGuias || 0) > (cliente360.guias || []).length && (
                                                <p className="text-[9px] text-slate-400">mostrando {(cliente360.guias || []).length} de {cliente360.totalGuias} — o histórico completo fica no módulo Fiscal</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
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
