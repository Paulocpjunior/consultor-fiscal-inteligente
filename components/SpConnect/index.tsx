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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    listarConversas, listarMensagens, marcarLida, responderConversa, iniciarConversa,
    procurarConversas,
    importarUltrafoxLote,
    atendimentoConfig, salvarAtendimentoConfig, subirImagemFila, removerImagemFila, transferirFila, assumirConversa,
    mudarSituacao, criarNota, vincularCliente, buscarClientes,
    listarAtendentes, salvarFilasAtendente, salvarPapelAtendente, importarUltrafox,
    listarAvaliacoes, clienteDaConversa, abrirMidia, enviarAnexo,
    listarCanais, salvarCanal, registrarCanal, statusDoCanal, pedirPermissaoLigacao, Atendente, ImportPreview, AvaliacaoAtendimento,
    ClienteDaConversa, CanalWhatsapp, sondarChamadas, SondaChamada, configurarChamadas, HorariosChamada,
    sondarSbc, SondaSbc,
    eventosCrusDeChamada,
    sondarInstagram, SondaInstagram,
    estadoInstagram, ligarInstagram, EstadoInstagram, EventosInstagram, AssinaturasInstagram, VerificacaoWebhook,
    listarContatos, criarContato, atualizarContato, excluirContato, salvarEtiqueta,
    Contato, Etiqueta, relatorioTitular, eliminarDadosTitular,
    RelatorioTitular, PlanoEliminacao,
    arquivarMidiasNoSharePoint, ResultadoArquivoSp,
    relatorioAtendimento, RelatorioAtendimento, testarAvisoTeams,
} from '../../services/spConnectService';
import { listarTemplates, listarTemplatesDaMeta, WhatsappTemplate, TemplateDaMeta } from '../../services/whatsappTemplatesService';
import {
    suporteDeGravacao, nomeDoAudio, duracaoLegivel, traduzirErroDeMicrofone,
    atingiuLimite, LIMITE_SEGUNDOS, duracaoSuficiente, DURACAO_MINIMA_SEGUNDOS,
    converterGravacaoParaMp3,
} from '../../services/gravacaoAudio';
import {
    avisosDeNovasMensagens, tituloComContador, estadoDaPermissao, faltaNosAvisos,
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
    rotuloMidia, filtrarConversas, filtrarMensagensDaThread, iniciais, rotuloCurtoFila, dentroDeIframe,
} from '../../services/spConnect';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '../../services/firebaseConfig';
import { conferirEscalaNaMensagem, coberturaDasFilas, dentroDoHorario } from '../../sefaz-backend/whatsapp-atendimento.js';
import { saiuPorOutraPlataforma } from '../../sefaz-backend/whatsapp-webhook.js';
import { mapearArquivosDoBackup, resumoDaVarredura, consolidarPrevia, dividirEmBlocos, avisoDeAnexos } from '../../sefaz-backend/whatsapp-import-lote.js';
import { interpretarConversaTxt } from '../../sefaz-backend/whatsapp-import-ultrafox.js';

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
    const [limiteConversas, setLimiteConversas] = useState<number | null>(null);
    const [respostasRapidas, setRespostasRapidas] = useState<string[]>([]);
    const [filas, setFilas] = useState<FilaAtendimento[]>([]);
    const [minhasFilas, setMinhasFilas] = useState<string[] | null>(null);
    const [papel, setPapel] = useState<'admin' | 'gestor' | 'colaborador'>('colaborador');
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [busca, setBusca] = useState('');
    // 🔎 Resultado da busca NO BANCO — estado próprio, nunca misturado com
    // `conversas`: a lista se renova a cada 30s e apagaria o que a pessoa
    // acabou de achar. `null` = mostrando a lista normal.
    const [achados, setAchados] = useState<{
        termo: string; conversas: ConversaResumo[]; total: number; truncado: boolean;
        contatosTruncados: boolean;
    } | null>(null);
    const [procurando, setProcurando] = useState(false);
    const [erroBusca, setErroBusca] = useState<string | null>(null);
    // 🔍 Busca DENTRO da conversa aberta (pendência 🟡 do de-para — a busca
    // só alcançava a lista). Limpa ao trocar de conversa, senão a próxima
    // abriria filtrada por um termo de outra thread.
    const [buscaThread, setBuscaThread] = useState('');
    const [aba, setAba] = useState<string>('todas');
    const [sel, setSel] = useState<ConversaResumo | null>(null);
    const [mensagens, setMensagens] = useState<MensagemInbox[]>([]);
    const [carregandoMsgs, setCarregandoMsgs] = useState(false);
    // ⬆️ HISTÓRICO puxado à mão fica em estado PRÓPRIO. Se ele entrasse em
    // `mensagens`, a renovação de 30s (que traz só a fatia recente) apagaria o
    // que a pessoa acabou de carregar — e ela clicaria de novo, e de novo.
    const [antigas, setAntigas] = useState<MensagemInbox[]>([]);
    const [temMaisAntigas, setTemMaisAntigas] = useState(false);
    const [carregandoAntigas, setCarregandoAntigas] = useState(false);
    const [threadSemOrdem, setThreadSemOrdem] = useState(false);
    const [texto, setTexto] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [erroEnvio, setErroEnvio] = useState<string | null>(null);
    const fimDaThread = useRef<HTMLDivElement>(null);
    const selRef = useRef<ConversaResumo | null>(null);
    selRef.current = sel;
    const antigasRef = useRef<MensagemInbox[]>([]);
    antigasRef.current = antigas;
    const mensagensRef = useRef<MensagemInbox[]>([]);
    mensagensRef.current = mensagens;

    // A thread que a tela mostra = histórico puxado + fatia recente, sem
    // repetir id (as duas fatias podem se tocar numa borda).
    const thread = useMemo(() => {
        const vistos = new Set<string>();
        return [...antigas, ...mensagens]
            .filter((m) => (m.id && vistos.has(m.id) ? false : (m.id && vistos.add(m.id), true)))
            .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    }, [antigas, mensagens]);

    // 📧 E-mail NÃO verificado (caso recepcao@, 24/08): o backend RECUSA o
    // token com "Email não verificado" — trava de segurança correta (sem ela,
    // e-mail do domínio registrado em outro projeto Firebase alcançaria dado
    // SERPRO). O que faltava era o CAMINHO: conta de login por SENHA nunca
    // teve onde clicar para verificar. O banner só aparece para quem está
    // barrado; SSO já chega verificado e nunca o vê.
    const [emailNaoVerificado, setEmailNaoVerificado] = useState(false);
    const [verifStatus, setVerifStatus] = useState<string | null>(null);
    useEffect(() => {
        setEmailNaoVerificado(Boolean(auth?.currentUser && auth.currentUser.emailVerified === false));
    }, []);
    const enviarVerificacao = async () => {
        const u = auth?.currentUser;
        if (!u) return;
        try {
            await sendEmailVerification(u);
            setVerifStatus(`✉️ Enviado para ${u.email}. Abra a caixa de entrada (e o lixo eletrônico), clique no link e volte aqui.`);
        } catch (e: any) {
            setVerifStatus(String(e?.code || '').includes('too-many-requests')
                ? '⏳ Muitos pedidos seguidos — o e-mail anterior ainda vale. Procure-o na caixa (e no lixo eletrônico) e aguarde alguns minutos antes de pedir outro.'
                : `Falha ao enviar: ${e?.message || e}`);
        }
    };
    const confirmarVerificacao = async () => {
        const u = auth?.currentUser;
        if (!u) return;
        setVerifStatus('Conferindo…');
        await u.reload();
        if (u.emailVerified) {
            // O token do Firebase cacheia ~1h e a verificação só entra em token
            // NOVO (lição do plano-contas-iob v3.4.92) — forçar e recarregar.
            await u.getIdToken(true);
            window.location.reload();
        } else {
            setVerifStatus('Ainda consta como NÃO verificado — o link do e-mail precisa ser aberto (no navegador, logado nesta conta) antes deste botão.');
        }
    };

    const recarregar = useCallback(async (silencioso = false) => {
        if (!silencioso) setCarregando(true);
        try {
            const r = await listarConversas();
            if (!r.ok) { if (!silencioso) setErro(r.error || 'Falha ao carregar as conversas.'); return; }
            setErro(null);
            setConversas(r.conversas || []);
            // 🚨 A CONVERSA ABERTA TAMBÉM SE ATUALIZA (24/08). A lista se
            // renovava a cada 30s e o painel da conversa aberta NÃO: ele vivia
            // do patch local, então virava foto velha. Foi assim que o cliente
            // AUTORIZOU a ligação (a linha apareceu na thread, o banco gravou
            // 'aceita') e o painel continuou dizendo "aguardando" com o botão
            // de pedir de pé — o segundo pedido bateu no limite da Meta
            // (138009). Vale pro resto também: fila, dono, situação e janela
            // mudam pelo webhook e por outro atendente. O SERVIDOR é quem diz.
            const abertaAgora = (r.conversas || []).find((c) => c.numero === selRef.current?.numero);
            if (abertaAgora) setSel(abertaAgora);
            setLimiteConversas(r.limiteLeitura ?? null);
            if (r.respostasRapidas) setRespostasRapidas(r.respostasRapidas);
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
            if (r.ok && selRef.current?.numero === numero) {
                setMensagens(r.mensagens || []);
                setThreadSemOrdem(Boolean(r.semOrdem));
                // ⚠️ A renovação de 30s NÃO pode apagar o "carregar mais" que a
                // pessoa já usou: ela recarrega só a FATIA RECENTE, e a
                // resposta dela fala sobre essa fatia. Quem já puxou histórico
                // mantém o que tem — o `temMais` daquela página é que manda.
                if (!antigasRef.current.length) setTemMaisAntigas(Boolean(r.temMais));
            }
        } finally {
            if (!silencioso) setCarregandoMsgs(false);
        }
    }, []);

    // ⬆️ As 500 ANTERIORES à mais antiga que já está na tela. Cursor por
    // VALOR (timestamp), nunca por número de página: mensagem que chega no
    // meio do caminho não desloca a janela nem faz linha repetir.
    const carregarAntigas = useCallback(async () => {
        const numero = selRef.current?.numero;
        if (!numero || carregandoAntigas) return;
        const primeira = antigasRef.current[0] || mensagensRef.current[0];
        if (!primeira?.timestamp) return;
        setCarregandoAntigas(true);
        try {
            const r = await listarMensagens(numero, primeira.timestamp);
            if (!r.ok || selRef.current?.numero !== numero) return;
            setAntigas((a) => [...(r.mensagens || []), ...a]);
            setTemMaisAntigas(Boolean(r.temMais));
        } finally {
            setCarregandoAntigas(false);
        }
    }, [carregandoAntigas]);

    // Atendimento não vive de F5: lista e thread aberta se renovam a cada 30s.
    useEffect(() => {
        recarregar();
        const timer = setInterval(() => {
            recarregar(true);
            if (selRef.current) carregarThread(selRef.current.numero, true);
        }, 30_000);
        return () => clearInterval(timer);
    }, [recarregar, carregarThread]);

    // ⚠️ A rolagem para o fim segue presa à FATIA RECENTE, de propósito:
    // carregar histórico acrescenta linhas ACIMA e não pode jogar a pessoa
    // de volta pro rodapé — ela acabou de pedir pra ver o começo.
    useEffect(() => {
        fimDaThread.current?.scrollIntoView({ block: 'end' });
    }, [mensagens.length]);

    const abrir = async (c: ConversaResumo) => {
        setSel(c);
        setMensagens([]);
        setAntigas([]);
        setTemMaisAntigas(false);
        setThreadSemOrdem(false);
        setBuscaThread('');
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
    // 🚨 CONFIRMAÇÃO É DO APP, NUNCA `window.confirm` (Paulo, 24/08: clicou
    // no ☎️ Pedir permissão de ligação e "nada aconteceu"). O webview do
    // Teams — onde TODO colaborador usa o Connect — SUPRIME window.confirm
    // sem erro nenhum: a função devolve false e a ação simplesmente não
    // acontece. O Safari faz o mesmo depois que alguém marca "impedir novos
    // diálogos". Botão que não faz nada é pior que botão nenhum, então a
    // pergunta passa a ser uma caixa NOSSA, que existe em qualquer casca.
    const [confirmPendente, setConfirmPendente] = useState<
        { texto: string; rotuloOk: string; campo: boolean; placeholder: string; resolver: (v: string | boolean | null) => void } | null
    >(null);
    const [confirmTexto, setConfirmTexto] = useState('');
    const pedirConfirmacao = (texto: string, rotuloOk = 'Confirmar') =>
        new Promise<boolean>((resolver) => {
            setConfirmTexto('');
            setConfirmPendente({ texto, rotuloOk, campo: false, placeholder: '', resolver: resolver as (v: string | boolean | null) => void });
        });
    /** Mesma caixa, com CAMPO — substitui o window.prompt (LGPD e consentimento). */
    const pedirTexto = (texto: string, rotuloOk = 'Gravar', placeholder = '') =>
        new Promise<string | null>((resolver) => {
            setConfirmTexto('');
            setConfirmPendente({ texto, rotuloOk, campo: true, placeholder, resolver: resolver as (v: string | boolean | null) => void });
        });
    const responderConfirmacao = (v: boolean) => {
        const c = confirmPendente;
        setConfirmPendente(null);
        // Cancelar devolve o "não" na forma que quem pediu espera: `false` pra
        // confirmação, `null` pro campo — senão um `false` viraria texto vazio
        // e gravaria motivo em branco num registro de LGPD. E resolve SEMPRE:
        // promessa pendente trava o handler pra sempre, que é o defeito de
        // origem (o botão volta a "não fazer nada").
        if (c) c.resolver(c.campo ? (v ? confirmTexto : null) : v);
    };

    // Encerrar/reabrir: admin e gestor, qualquer; colaborador, só o que conduz.
    const podeEncerrarSel = papel === 'admin' || papel === 'gestor' || (sel?.atribuidoA != null && sel.atribuidoA === meuEmail);
    const [situacaoAviso, setSituacaoAviso] = useState<string | null>(null);
    // ☎️ Pedir a permissão de ligação (fase 2 da chamada). Confirmação antes:
    // é uma MENSAGEM real chegando no cliente, não um ajuste interno.
    const [permLigAviso, setPermLigAviso] = useState<string | null>(null);
    const [permLigErro, setPermLigErro] = useState<string | null>(null);
    const [permLigConducao, setPermLigConducao] = useState(false);
    const acaoPermissaoLigacao = async () => {
        if (!sel) return;
        setPermLigAviso(null); setPermLigErro(null); setPermLigConducao(false);
        const ok = await pedirConfirmacao(
            'O cliente vai receber AGORA um cartão do WhatsApp pedindo permissão para ligações da SP. '
            + 'Se ele tocar em "Permitir", a ligação de saída fica autorizada por tempo limitado (regra da Meta).',
            'Enviar pedido',
        );
        if (!ok) return;
        setPermLigAviso('⏳ Enviando o pedido…');
        const r = await pedirPermissaoLigacao(sel.numero);
        if (!r.ok) {
            // A recusa aparece em VERMELHO e com o CÓDIGO da Meta: em 24/08 o
            // pedido saiu daqui, não chegou no cliente, e a única pista morava
            // numa linha âmbar de 10px que ninguém viu — "nada aconteceu".
            const cod = (r as any).code != null ? ` (código ${(r as any).code})` : '';
            setPermLigErro(`${r.error}${cod}${(r as any).acao ? ` — ${(r as any).acao}` : ''}`);
            // Trava COM caminho: conversa conduzida por outra pessoa é o caso
            // que se resolve num clique — parede sem porta é o que faz a
            // equipe concluir que o app está quebrado.
            setPermLigConducao(Boolean((r as any).emConducaoPor));
            setPermLigAviso(null);
            return;
        }
        setPermLigErro(null);
        setMensagens((m) => [...m, r.mensagem]);
        patchSel({ permissaoLigacao: { status: 'pendente', pedidoEm: new Date().toISOString() } });
        setPermLigAviso('☎️ Pedido enviado — a resposta do cliente aparece na conversa.');
    };

    // ☎️ NÃO EXISTE AÇÃO DE LIGAR AQUI, e o motivo é a resposta da própria Meta
    // (24/08, código 131055): "Graph API calls are not allowed for SIP enabled
    // numbers". Em modo SIP a saída não sai por API — quem disca é o tronco.
    // A ação existia e ficou ÓRFÃ quando o botão saiu: código morto com cara de
    // entrega é a isca para alguém religar um caminho que a Meta recusa por
    // desenho, então ela foi DELETADA em 25/08 junto com a porta de fetch.
    // A rota do backend (`/conversas/:numero/ligar`) fica de pé com as travas
    // dela (permissão do cliente, validade, condução) — ela é a régua do dia em
    // que este número sair do modo SIP, e não é ela que promete botão.

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

    // 🔔 Aviso nativo do Teams — o toggle salva NA HORA (a aba 👥 não tem o
    // botão 💾 da 🤖, e chave que parece ligada sem estar gravada é a pior
    // combinação). O teste manda um aviso pro PRÓPRIO usuário logado.
    const [teamsTestando, setTeamsTestando] = useState(false);
    const [teamsTeste, setTeamsTeste] = useState<{
        resultado: { ok: true } | { ok: false; etapa: string; erro: string };
        status: { graphConfigurado: boolean; clientId: string | null; teamsAppId: string };
    } | null>(null);
    const alternarAvisoTeams = async () => {
        if (!cfg || cfgSalvando) return;
        const novo = { ...cfg, avisoTeamsAtivo: !cfg.avisoTeamsAtivo };
        setCfg(novo);
        setCfgSalvando(true);
        try {
            const r = await salvarAtendimentoConfig(novo);
            if (r.ok) setCfg(r.config); else setCfgErro(r.error || 'Falha ao salvar.');
        } finally { setCfgSalvando(false); }
    };
    const rodarTesteTeams = async () => {
        setTeamsTestando(true); setTeamsTeste(null);
        try {
            const r = await testarAvisoTeams();
            if (r.ok) setTeamsTeste({ resultado: r.resultado, status: r.status });
            else setTeamsTeste({ resultado: { ok: false, etapa: 'rota', erro: r.error || 'A rota não respondeu.' }, status: { graphConfigurado: false, clientId: null, teamsAppId: '' } });
        } finally { setTeamsTestando(false); }
    };

    // ── 🖼️ Imagem por fila: sobe/grava na hora (não fica pendente do
    // "Salvar configuração" — senão trocar de aba sem salvar perderia o
    // upload que já foi pro Storage).
    const [imgFilaEnviando, setImgFilaEnviando] = useState<string | null>(null);
    const [imgFilaErro, setImgFilaErro] = useState<string | null>(null);
    const subirImgFila = async (fila: string, arquivo: File | null) => {
        if (!arquivo || imgFilaEnviando) return;
        setImgFilaEnviando(fila);
        setImgFilaErro(null);
        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const leitor = new FileReader();
                leitor.onload = () => resolve(String(leitor.result || '').split(',')[1] || '');
                leitor.onerror = () => reject(new Error('não deu pra ler o arquivo'));
                leitor.readAsDataURL(arquivo);
            });
            const r = await subirImagemFila(fila, base64, arquivo.type || 'application/octet-stream');
            if (!r.ok) { setImgFilaErro(`${fila}: ${r.error}`); return; }
            setCfg(r.config);
        } catch (e: any) {
            setImgFilaErro(`${fila}: ${e.message || 'falha ao ler o arquivo'}`);
        } finally { setImgFilaEnviando(null); }
    };
    const tirarImgFila = async (fila: string) => {
        if (imgFilaEnviando) return;
        setImgFilaEnviando(fila);
        setImgFilaErro(null);
        try {
            const r = await removerImagemFila(fila);
            if (!r.ok) { setImgFilaErro(`${fila}: ${r.error}`); return; }
            setCfg(r.config);
        } finally { setImgFilaEnviando(null); }
    };

    // ── ⚙️ aba 👥 Atendentes ↔ filas (users.filasAtendimento, só admin grava)
    const [cfgAba, setCfgAba] = useState<'bot' | 'atendentes' | 'importar' | 'canais' | 'chamadas' | 'instagram' | 'arquivo'>('bot');

    // ── 🗄 Arquivo de mídia no SharePoint (o cron roda sozinho; o botão antecipa)
    const [arqRodando, setArqRodando] = useState(false);
    const [arqErro, setArqErro] = useState<string | null>(null);
    const [arqResultado, setArqResultado] = useState<ResultadoArquivoSp | null>(null);
    const rodarArquivoSp = async () => {
        setArqRodando(true); setArqErro(null);
        try {
            const r = await arquivarMidiasNoSharePoint();
            if (!r.ok) { setArqErro(r.error || 'O arquivamento falhou.'); return; }
            setArqResultado(r);
        } finally { setArqRodando(false); }
    };

    // ── ☎️ Sonda de voz/vídeo: PERGUNTA à Meta, não liga nada.
    const [sonda, setSonda] = useState<{
        conclusao: { veredito: string; motivo: string; acao?: string; respondeuPor?: string | null };
        sondas: SondaChamada[]; antesDeLigar: { titulo: string; texto: string }[];
        horarios?: HorariosChamada | null;
    } | null>(null);
    const [sondando, setSondando] = useState(false);
    const [sondaErro, setSondaErro] = useState<string | null>(null);
    const rodarSonda = async () => {
        setSondando(true); setSondaErro(null);
        const r = await sondarChamadas();
        setSondando(false);
        if (r.ok) setSonda({ conclusao: r.conclusao, sondas: r.sondas, antesDeLigar: r.antesDeLigar, horarios: r.horarios ?? null });
        else setSondaErro(r.error || 'A sonda não respondeu.');
    };

    // 🛠 Escrita explícita na Meta (Paulo, 23/08): horários = os das mensagens;
    // ícone do ☎️ do cliente; tronco SIP (a resposta do HitPhone). Cada ação
    // pede confirmação COM a consequência, e o resultado mostrado é o que a
    // Meta GUARDOU (a rota re-lê) — validação por resultado, não por status.
    const [aplicandoChamada, setAplicandoChamada] = useState<string | null>(null);
    const [chamadaErro, setChamadaErro] = useState<string | null>(null);
    const [chamadaResultado, setChamadaResultado] = useState<{ acao: string; calling: Record<string, unknown> | null } | null>(null);
    const [sipHost, setSipHost] = useState('');
    const [sipPorta, setSipPorta] = useState('5061');
    // 🔌 Medição do caminho até o SBC — estado PRÓPRIO, nunca misturado com o
    // da sonda de settings: as duas respondem perguntas diferentes e juntá-las
    // faria "gravado na Meta" passar por "a Meta alcança".
    const [sbc, setSbc] = useState<SondaSbc | null>(null);
    // 🔎 Eventos de chamada CRUS — a tela da Meta promete "peça um retorno de
    // ligação e entraremos em contato", e o leiaute desse pedido não está
    // provado. Isto ACHA o evento real; a régua nasce dele, nunca de dedução.
    const [crus, setCrus] = useState<{ achados: { em: string | null; rotulo: string; payload: unknown }[]; amostra: number } | null>(null);
    const [lendoCrus, setLendoCrus] = useState(false);
    const [sondandoSbc, setSondandoSbc] = useState(false);
    const aplicarChamada = async (p: Parameters<typeof configurarChamadas>[0], confirmacao: string) => {
        if (!await pedirConfirmacao(confirmacao, 'Gravar na Meta')) return;
        setAplicandoChamada(p.acao); setChamadaErro(null); setChamadaResultado(null);
        try {
            const r = await configurarChamadas(p);
            if (!r.ok) { setChamadaErro(r.error || 'A Meta recusou a gravação.'); return; }
            setChamadaResultado({ acao: r.acao, calling: r.calling });
            await rodarSonda(); // a tela volta a dizer o estado REAL, relido da Meta
        } finally { setAplicandoChamada(null); }
    };

    // ── 📷 Sonda do Instagram: PERGUNTA à Meta, não linka nada.
    const [sondaIg, setSondaIg] = useState<{
        conclusao: { veredito: string; motivo: string; acao?: string; pagina?: { id: string; nome: string }; instagram?: { id: string; username: string | null } };
        sondas: SondaInstagram[]; sobreRestringirAtendentes: { titulo: string; texto: string };
    } | null>(null);
    const [sondandoIg, setSondandoIg] = useState(false);
    const [sondaIgErro, setSondaIgErro] = useState<string | null>(null);
    const rodarSondaIg = async () => {
        setSondandoIg(true); setSondaIgErro(null);
        const r = await sondarInstagram();
        setSondandoIg(false);
        if (r.ok) setSondaIg({ conclusao: r.conclusao, sondas: r.sondas, sobreRestringirAtendentes: r.sobreRestringirAtendentes });
        else setSondaIgErro(r.error || 'A sonda não respondeu.');
    };
    // 📡 Recebimento das DMs — nasce DESLIGADO; o botão assina o webhook na
    // Meta e o estado persistido é o que diz "ligado em …, por …".
    const [igEstado, setIgEstado] = useState<EstadoInstagram | null>(null);
    const [igEventos, setIgEventos] = useState<EventosInstagram | null | undefined>(undefined);
    const [igAssinaturas, setIgAssinaturas] = useState<AssinaturasInstagram | null>(null);
    const [igVerificacao, setIgVerificacao] = useState<VerificacaoWebhook | null>(null);
    const [igPostRecusado, setIgPostRecusado] = useState<{ em: string; motivo: string; objeto: string | null } | null>(null);
    const [igEnvs, setIgEnvs] = useState<{ instagramAppSecret: boolean; instagramAccessToken: boolean } | null>(null);
    const [igEstadoLido, setIgEstadoLido] = useState(false);
    const [igLigando, setIgLigando] = useState(false);
    const [igLigarErro, setIgLigarErro] = useState<string | null>(null);
    useEffect(() => {
        if (!cfgAberta || cfgAba !== 'instagram' || igEstadoLido) return;
        (async () => {
            const r = await estadoInstagram();
            if (r.ok) { setIgEstado(r.estado || null); setIgEventos(r.eventos ?? null); setIgAssinaturas(r.assinaturas ?? null); setIgVerificacao(r.verificacao ?? null); setIgPostRecusado(r.postRecusado ?? null); setIgEnvs(r.envs ?? null); setIgEstadoLido(true); }
        })();
    }, [cfgAberta, cfgAba, igEstadoLido]);
    const ligarIg = async () => {
        setIgLigando(true); setIgLigarErro(null);
        const r = await ligarInstagram();
        setIgLigando(false);
        if (r.ok) setIgEstado({ ligadoEm: r.ligadoEm, ligadoPor: r.ligadoPor, appId: r.appId, callback: r.callback, pageId: r.pageId, igId: r.igId, igUsername: r.igUsername });
        else setIgLigarErro(r.error || 'A Meta recusou a assinatura.');
    };
    const [atendentes, setAtendentes] = useState<Atendente[]>([]);
    const [atdErro, setAtdErro] = useState<string | null>(null);
    const [atdCarregado, setAtdCarregado] = useState(false);
    useEffect(() => {
        // Carrega também na aba do BOT: é lá que se decide o alcance, e a
        // pergunta "tem gente em cada fila do menu?" não pode depender de a
        // pessoa ter passado pela aba 👥 antes.
        if (!cfgAberta || !(cfgAba === 'atendentes' || cfgAba === 'bot') || atdCarregado) return;
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
    // 🖼️ Zoom DENTRO do app, nunca aba nova: no Teams do Windows o webview não
    // abre `blob:` em aba — ele entrega o link pro SISTEMA, que responde
    // "você precisa de um novo app para abrir este link blob" (colaborador,
    // 24/08). O visualizador é nosso, então funciona no Teams e no navegador.
    const [zoom, setZoom] = useState<{ url: string; nome: string } | null>(null);
    const [midiaErro, setMidiaErro] = useState<Record<string, string>>({});
    // Virou mapa (era um id só) — imagem/gif carrega SOZINHA (abaixo), então
    // várias podem estar baixando ao mesmo tempo; um mutex de string só
    // travaria a segunda enquanto a primeira ainda está em voo.
    const [midiaCarregando, setMidiaCarregando] = useState<Record<string, boolean>>({});
    const midiasRef = useRef<Record<string, { url: string; mime: string }>>({});
    midiasRef.current = midias;
    useEffect(() => () => { Object.values(midiasRef.current).forEach((m) => URL.revokeObjectURL(m.url)); }, []);

    const verMidia = async (m: MensagemInbox) => {
        if (!sel || midias[m.id] || midiaCarregando[m.id]) return;
        setMidiaCarregando((c) => ({ ...c, [m.id]: true }));
        setMidiaErro((e) => ({ ...e, [m.id]: '' }));
        try {
            const r = await abrirMidia(sel.numero, m.id);
            if (!r.ok) { setMidiaErro((e) => ({ ...e, [m.id]: `${r.error}${r.acao ? ` ${r.acao}` : ''}` })); return; }
            setMidias((x) => ({ ...x, [m.id]: { url: r.url, mime: r.mime } }));
        } finally { setMidiaCarregando((c) => { const n = { ...c }; delete n[m.id]; return n; }); }
    };

    // 🖼️ Imagem/figurinha (inclusive GIF) aparece SOZINHA, como na Ultra Fox —
    // Paulo, 21/08, comparando print a print: lá o comprovante fotografado já
    // vinha na tela; aqui exigia clicar em "abrir anexo" pra cada uma. A mídia
    // já foi baixada da Meta pro NOSSO Storage assim que chegou (F1 do
    // webhook, 16/08) — então mostrar sozinha não é buscar de novo na Meta,
    // é só puxar do bucket. Documento/vídeo continuam por clique: são
    // maiores e o clique ali já é o comportamento esperado (baixar/abrir).
    useEffect(() => {
        // Lê a THREAD inteira: a foto do histórico puxado à mão tem que
        // aparecer igual à da fatia recente — senão "carregar mais antigas"
        // devolveria uma conversa de balões vazios.
        thread
            .filter((m) => (m.tipo === 'image' || m.tipo === 'sticker') && m.midia?.baixada !== false)
            .forEach((m) => { verMidia(m); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thread]);

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
    // Duração REAL por timestamp, não pelo state `segundos` — o `onstop` é
    // fechado no início da gravação e leria um `segundos` congelado em 0.
    const iniciadoEmRef = useRef<number | null>(null);
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
                const duracaoReal = iniciadoEmRef.current ? (Date.now() - iniciadoEmRef.current) / 1000 : 0;
                const blob = new Blob(pedacosRef.current, { type: suporte.mime });
                // Gravação vazia (clique sem falar) NÃO vira arquivo de 0 byte.
                if (!blob.size) { setGravando(false); setSegundos(0); return; }
                // 🚨 Curta demais produz um .m4a que a Meta aceita no upload e
                // recusa no processamento (131053) — caso real, 20/08 (ver
                // gravacaoAudio.ts). Barrar aqui poupa o round-trip até falhar lá.
                if (!duracaoSuficiente(duracaoReal)) {
                    setGravando(false); setSegundos(0);
                    setErroEnvio(`Gravação muito curta (${duracaoReal.toFixed(1)}s) — grave por pelo menos ${DURACAO_MINIMA_SEGUNDOS}s. Áudios muito curtos costumam falhar no envio pelo WhatsApp.`);
                    return;
                }
                // 🎙️→MP3 ANTES da prévia: o MP4 do Safari a Meta aceita no
                // upload e recusa no processamento (131053 — caso real,
                // audio-2108-1430.m4a), e o webm do Chrome vira "documento"
                // sem player. Convertido, todo navegador manda audio/mpeg.
                // Falha na conversão NÃO perde a gravação: vai o original.
                setGravando(false);
                converterGravacaoParaMp3(blob).then((mp3) => {
                    const escolhido = mp3 || blob;
                    const ext = mp3 ? 'mp3' : suporte.extensao;
                    setPrevia({ url: URL.createObjectURL(escolhido), blob: escolhido, nome: nomeDoAudio(new Date(), ext) });
                    if (!mp3) setErroEnvio(`Não deu pra converter a gravação pra MP3 — vai no formato original (${suporte.mime}); se o WhatsApp recusar, grave de novo.`);
                });
            };
            recorderRef.current = rec;
            iniciadoEmRef.current = Date.now();
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
            const t = traduzirErroDeMicrofone(e as { name?: string; message?: string }, dentroDeIframe());
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

    // ── 📈 Relatório de atendimento (admin/gestor) — item 3 de 21/08, o
    // último 🔴 do de-para. A CONTA é do backend; aqui só o desenho.
    const [relAberto, setRelAberto] = useState(false);
    const [relDias, setRelDias] = useState(7);
    const [relDados, setRelDados] = useState<RelatorioAtendimento | null>(null);
    const [relErro, setRelErro] = useState<string | null>(null);
    const [relCarregando, setRelCarregando] = useState(false);
    const abrirRelatorio = async (dias = relDias) => {
        setRelAberto(true); setRelDias(dias); setRelCarregando(true); setRelErro(null);
        const r = await relatorioAtendimento(dias);
        setRelCarregando(false);
        if (r.ok) setRelDados(r);
        else setRelErro(r.error || 'Falha ao montar o relatório.');
    };

    // ── 📇 CONTATOS: a agenda que faltava. O importador da Ultra Fox grava em
    // `whatsapp_contatos` e, até aqui, NENHUMA tela lia — 800 contatos
    // importados ficavam invisíveis até alguém escrever pro número.
    const [contatosAberto, setContatosAberto] = useState(false);
    const [contatos, setContatos] = useState<Contato[]>([]);
    const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
    const [ctResumo, setCtResumo] = useState<{
        total: number; totalFiltrado: number; truncado: boolean; limiteLeitura: number | null;
        semEtiquetaTotal: number; porEtiqueta: Record<string, number>;
    } | null>(null);
    const [ctBusca, setCtBusca] = useState('');
    const [ctFiltro, setCtFiltro] = useState<string>('');   // '' = todos · '__sem' = sem etiqueta
    const [ctCarregando, setCtCarregando] = useState(false);
    const [ctErro, setCtErro] = useState<string | null>(null);
    const [ctSel, setCtSel] = useState<Contato | null>(null);
    // ✏️ Rascunho da edição do cadastro — TEXTO no estado, gravado só no
    // Salvar. Editar direto no objeto faria a lista mudar antes de o servidor
    // ter aceitado, e um erro deixaria a tela mostrando o que não foi gravado.
    const [ctEdit, setCtEdit] = useState<{ nome: string; observacao: string } | null>(null);
    const [ctSalvando, setCtSalvando] = useState(false);
    const [ctNovo, setCtNovo] = useState<{ numero: string; nome: string; categoria: string } | null>(null);
    const [ctMsg, setCtMsg] = useState<string | null>(null);

    const carregarContatos = async (opts: { busca?: string; filtro?: string } = {}) => {
        setCtCarregando(true); setCtErro(null);
        const filtro = opts.filtro !== undefined ? opts.filtro : ctFiltro;
        const r = await listarContatos({
            busca: opts.busca !== undefined ? opts.busca : ctBusca,
            etiqueta: filtro && filtro !== '__sem' ? filtro : '',
            semEtiqueta: filtro === '__sem',
        });
        setCtCarregando(false);
        if (!r.ok) { setCtErro(r.error || 'Falha ao carregar os contatos.'); return; }
        setContatos(r.contatos); setEtiquetas(r.etiquetas);
        setCtResumo({
            total: r.total, totalFiltrado: r.totalFiltrado, truncado: r.truncado,
            limiteLeitura: r.limiteLeitura, semEtiquetaTotal: r.semEtiquetaTotal, porEtiqueta: r.porEtiqueta,
        });
    };
    const abrirContatos = () => { setContatosAberto(true); setCtMsg(null); carregarContatos(); };

    const alternarEtiqueta = async (c: Contato, id: string) => {
        const novas = c.etiquetas.includes(id) ? c.etiquetas.filter((x) => x !== id) : [...c.etiquetas, id];
        const r = await atualizarContato(c.numero, { etiquetas: novas });
        if (!r.ok) { setCtMsg(r.error || 'Não deu para etiquetar.'); return; }
        const atualizado = { ...c, etiquetas: novas, pendenciasLgpd: r.pendenciasLgpd };
        setCtSel(atualizado);
        setContatos((l) => l.map((x) => (x.numero === c.numero ? atualizado : x)));
        setCtMsg(null);
    };

    // ✏️ EDITAR O CADASTRO (Paulo, 25/08: "não possuímos a opção de EDITAR
    // contato, para que assim possamos usar os flags, se cliente, ou não
    // salvar e completar o necessário").
    // 🚨 O backend ACEITA `nome` e `observacao` no PATCH desde que os contatos
    // nasceram — e nenhum botão os mandava. Campo que o servidor grava e
    // ninguém pode preencher é a "rota sem botão" na versão CAMPO: parece
    // entrega, e a pessoa que precisa dele conclui que o app não faz.
    const salvarCadastroDoContato = async (c: Contato, nome: string, observacao: string) => {
        setCtSalvando(true);
        try {
            const r = await atualizarContato(c.numero, { nome: nome.trim(), observacao: observacao.trim() });
            if (!r.ok) { setCtMsg(r.error || 'Não deu para salvar o contato.'); return; }
            // O nome do PERFIL é o que o WhatsApp manda; o que se digita aqui
            // é o mesmo campo, e a lista tem que concordar na hora — senão a
            // pessoa salva e vê o nome velho, e salva de novo.
            const atualizado = { ...c, nomePerfil: nome.trim() || null, observacao: observacao.trim() || null };
            setCtSel(atualizado);
            setContatos((l) => l.map((x) => (x.numero === c.numero ? atualizado : x)));
            setCtEdit(null);
            setCtMsg('✓ Contato salvo.');
        } finally { setCtSalvando(false); }
    };

    const registrarConsentimento = async (c: Contato, etiqueta: string) => {
        const como = await pedirTexto(
            'Como o titular consentiu? Isto fica gravado com a data e o seu nome — é a prova de que houve consentimento.',
            'Registrar consentimento',
            'ex.: pediu no WhatsApp em 10/08 · assinou no contrato',
        );
        if (como == null || !como.trim()) return;
        const r = await atualizarContato(c.numero, { consentimento: { etiqueta, como } });
        if (!r.ok) { setCtMsg(r.error || 'Não deu para registrar.'); return; }
        setCtMsg('✓ Consentimento registrado.');
        carregarContatos();
        setCtSel(null);
    };

    // ── 🔒 Direitos do titular (LGPD art. 18). É o mecanismo que dá lastro à
    // frase do rodapé — sem ele, o selo seria afirmação enganosa ao titular.
    const [lgpd, setLgpd] = useState<{ relatorio?: RelatorioTitular; plano?: PlanoEliminacao } | null>(null);
    const [lgpdOcupado, setLgpdOcupado] = useState(false);

    const exportarDadosTitular = async (numero: string) => {
        setLgpdOcupado(true); setCtMsg(null);
        const r = await relatorioTitular(numero);
        setLgpdOcupado(false);
        if (!r.ok) { setCtMsg(r.error || 'Não deu para gerar o relatório.'); return; }
        setLgpd({ relatorio: r.relatorio });
        // Baixar é o direito à PORTABILIDADE (art. 18, V): o titular precisa
        // levar o arquivo, não só ver na tela de quem atende.
        const blob = new Blob([JSON.stringify(r.relatorio, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `dados-titular-${numero}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const pedirPlanoEliminacao = async (numero: string) => {
        setLgpdOcupado(true); setCtMsg(null);
        const r = await eliminarDadosTitular(numero);
        setLgpdOcupado(false);
        if (!r.ok) { setCtMsg(r.error || 'Não deu para montar o plano.'); return; }
        setLgpd({ plano: r.plano });
    };

    const confirmarEliminacao = async (numero: string) => {
        const motivo = await pedirTexto(
            'Registre o pedido do titular — fica gravado com o seu nome e a data.',
            'Eliminar dados', 'ex.: titular pediu a exclusão por e-mail em 24/08',
        );
        if (motivo == null) return;
        setLgpdOcupado(true);
        const r = await eliminarDadosTitular(numero, { confirmar: true, motivo });
        setLgpdOcupado(false);
        if (!r.ok) { setCtMsg(r.error || 'Não deu para eliminar.'); return; }
        setLgpd(null); setCtSel(null);
        setCtMsg(`✓ Dados eliminados (${r.removidas || 0} mensagens). O registro da solicitação ficou gravado.`);
        carregarContatos();
    };

    const criarNovoContato = async () => {
        if (!ctNovo) return;
        // Categoria OBRIGATÓRIA (Paulo, 24/08) — o backend também recusa;
        // conferir aqui poupa a ida e diz o que falta na hora.
        if (!ctNovo.categoria) { setCtMsg('Escolha a categoria — ela é obrigatória.'); return; }
        const r = await criarContato({ numero: ctNovo.numero, nome: ctNovo.nome, etiquetas: [ctNovo.categoria] });
        if (!r.ok) { setCtMsg(`${r.error}${(r as any).acao ? ` ${(r as any).acao}` : ''}`); return; }
        setCtNovo(null); setCtMsg('✓ Contato criado.');
        carregarContatos();
    };

    const excluirContatoSelecionado = async (numero: string, nome: string) => {
        // Só gestor/admin chegam aqui (o botão não aparece pros demais) e o
        // backend confere de novo. O confirm diz o ALCANCE: cadastro sai,
        // conversa e mensagens FICAM (eliminação LGPD é o fluxo 🔒).
        const ok = await pedirConfirmacao(
            `Excluir o contato "${nome}"? Sai o CADASTRO (nome, categoria, observação). A conversa e as mensagens continuam — apagar dados do titular é o fluxo 🔒 LGPD. Se a pessoa escrever de novo, o contato renasce sem categoria.`,
            'Excluir contato',
        );
        if (!ok) return;
        const r = await excluirContato(numero);
        if (!r.ok) { setCtMsg(r.error || 'Não deu para excluir.'); return; }
        setCtSel(null); setCtMsg('✓ Contato excluído.');
        carregarContatos();
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
    // 📱 Ativar na Cloud API: PIN de 6 dígitos, por canal. Ele NÃO é guardado —
    // some do estado assim que a Meta responde.
    const [pinCanal, setPinCanal] = useState<Record<string, string>>({});
    const [canalMsg, setCanalMsg] = useState<Record<string, string>>({});
    const [registrando, setRegistrando] = useState<string | null>(null);
    const conferirCanal = async (id: string) => {
        setCanalMsg((m) => ({ ...m, [id]: '🔬 Perguntando à Meta…' }));
        const r = await statusDoCanal(id);
        if (!r.ok) { setCanalMsg((m) => ({ ...m, [id]: `⛔ ${r.error}` })); return; }
        const n: any = r.numero || {};
        // O status vem CRU da Meta de propósito: traduzir escondendo o termo
        // dela faria a próxima busca no suporte não achar nada.
        const partes = [
            n.status ? `status: ${n.status}` : null,
            n.code_verification_status ? `verificação: ${n.code_verification_status}` : null,
            n.platform_type ? `plataforma: ${n.platform_type}` : null,
            n.quality_rating ? `qualidade: ${n.quality_rating}` : null,
        ].filter(Boolean).join(' · ');
        const dica = String(n.status || '').toUpperCase() === 'CONNECTED'
            ? ' ✅ CONECTADO na Meta — se o WhatsApp ainda disser "não está no WhatsApp", é cache do app: tente do celular ou aguarde alguns minutos.'
            : ' ⚠️ Enquanto não estiver CONNECTED, o número não recebe mensagem.';
        setCanalMsg((m) => ({ ...m, [id]: `${partes || 'a Meta respondeu sem os campos de status'}${dica}` }));
    };

    const ativarCanal = async (id: string, rotulo: string) => {
        const pin = (pinCanal[id] || '').trim();
        if (!/^\d{6}$/.test(pin)) { setCanalMsg((m) => ({ ...m, [id]: 'O PIN tem 6 dígitos.' })); return; }
        const ok = await pedirConfirmacao(
            `Ativar "${rotulo}" na Cloud API com este PIN? Anote o PIN no cofre de senhas — a Meta pode pedi-lo de novo, e nós NÃO o guardamos.`,
            'Ativar número',
        );
        if (!ok) return;
        setRegistrando(id);
        setCanalMsg((m) => ({ ...m, [id]: '⏳ Registrando na Meta…' }));
        try {
            const r = await registrarCanal(id, pin);
            if (!r.ok) {
                const cod = (r as any).code != null ? ` (código ${(r as any).code})` : '';
                setCanalMsg((m) => ({ ...m, [id]: `⛔ ${r.error}${cod}${(r as any).acao ? ` — ${(r as any).acao}` : ''}` }));
                return;
            }
            setCanalMsg((m) => ({ ...m, [id]: '✅ Número ATIVADO na Cloud API — mande uma mensagem de teste para ele.' }));
            setPinCanal((p) => ({ ...p, [id]: '' }));
            const lista = await listarCanais();
            if (lista.ok) setCanais(lista.canais || []);
        } finally { setRegistrando(null); }
    };
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

    // ── 📦 PASTA INTEIRA do backup (o export tem ~800 MB e centenas de pastas)
    //
    // O navegador LÊ e INTERPRETA aqui, na máquina de quem importa: o zip
    // inteiro não passa numa requisição (teto de 20 MB) e a mídia não precisa
    // sair do computador nesta etapa. Quem decide entrada × saída e quem
    // calcula o id de cada mensagem é o SERVIDOR — ver a rota do lote.
    const [loteVarredura, setLoteVarredura] = useState<ReturnType<typeof resumoDaVarredura> | null>(null);
    const [loteLidas, setLoteLidas] = useState<{ numero: string; mensagens: any[]; descartadas?: any[] }[]>([]);
    const [lotePrevia, setLotePrevia] = useState<ReturnType<typeof consolidarPrevia> | null>(null);
    const [loteAutores, setLoteAutores] = useState<string[]>([]);
    const [loteLendo, setLoteLendo] = useState<string | null>(null);
    const [loteResultado, setLoteResultado] = useState<{ gravadas: number; conversas: number; recusadas: number } | null>(null);
    const [loteErro, setLoteErro] = useState<string | null>(null);

    const escolherPastaBackup = async (arquivos: FileList | null) => {
        setLoteErro(null); setLoteResultado(null); setLotePrevia(null); setLoteLidas([]); setLoteAutores([]);
        const lista = Array.from(arquivos || []);
        if (!lista.length) return;
        // O caminho relativo é o que diz de QUEM é cada arquivo — o nome
        // sozinho ("_full-chat.txt") é igual em todas as pastas.
        const porCaminho = new Map(lista.map((f) => [(f as any).webkitRelativePath || f.name, f]));
        const mapa = mapearArquivosDoBackup([...porCaminho.keys()]);
        const resumo = resumoDaVarredura(mapa);
        setLoteVarredura(resumo);
        if (!resumo.arquivosParaLer) return;

        const lidas: { numero: string; mensagens: any[]; descartadas?: any[] }[] = [];
        const aLer = [...mapa.conversas, ...mapa.semDono];
        for (let i = 0; i < aLer.length; i += 1) {
            const item = aLer[i];
            setLoteLendo(`Lendo ${i + 1} de ${aLer.length}…`);
            const f = porCaminho.get(item.caminho);
            if (!f) continue;
            try {
                const r = interpretarConversaTxt(await f.text());
                lidas.push({ numero: item.numero, mensagens: r.mensagens, descartadas: r.descartadas });
            } catch {
                // Arquivo ilegível não derruba a varredura inteira: ele some
                // da conta e aparece no contador de "sem mensagem".
                lidas.push({ numero: item.numero, mensagens: [], descartadas: [] });
            }
        }
        setLoteLendo(null);
        setLoteLidas(lidas);
        setLotePrevia(consolidarPrevia(lidas));
    };

    const gravarLote = async () => {
        if (!lotePrevia || !loteAutores.length) return;
        setLoteErro(null); setLoteLendo('Gravando…');
        let gravadas = 0; let conversas = 0; let recusadas = 0;
        try {
            const blocos = dividirEmBlocos(loteLidas as any);
            for (let i = 0; i < blocos.length; i += 1) {
                setLoteLendo(`Gravando bloco ${i + 1} de ${blocos.length}…`);
                const r = await importarUltrafoxLote({ conversas: blocos[i] as any, autoresEscritorio: loteAutores });
                if (!r.ok) {
                    // PARA no primeiro erro e diz onde parou: seguir em frente
                    // deixaria metade gravada sem ninguém saber qual metade.
                    setLoteErro(`${r.error} (parou no bloco ${i + 1} de ${blocos.length}; o que já entrou está gravado e reimportar não duplica)`);
                    break;
                }
                gravadas += r.gravadas || 0;
                conversas += r.conversas || 0;
                recusadas += r.totalRecusadas || 0;
            }
            setLoteResultado({ gravadas, conversas, recusadas });
        } finally {
            setLoteLendo(null);
        }
    };

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
        // O default 'fiscal' só vale pra quem VÊ o Fiscal — colaborador de
        // outra fila abre já na fila DELE (um select cujo valor não está
        // entre as opções renderiza vazio e o envio falharia sem causa).
        setNc((f) => (filasChip.some((x) => x.id === f.departamento)
            ? f
            : { ...f, departamento: filasChip[0]?.id || f.departamento, escolha: '', variaveis: {} }));
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

    const procurarNoBanco = useCallback(async () => {
        const termo = busca.trim();
        if (termo.length < 2 || procurando) return;
        setProcurando(true); setErroBusca(null);
        try {
            const r = await procurarConversas(termo);
            if (!r.ok) { setErroBusca(r.error || 'Falha ao procurar.'); return; }
            setAchados({
                termo: r.termo, conversas: r.conversas || [], total: r.total || 0,
                truncado: Boolean(r.truncado), contatosTruncados: Boolean(r.contatosTruncados),
            });
        } finally { setProcurando(false); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [busca, procurando]);

    const agora = new Date();
    const janela = sel ? estadoJanela(sel.janela24hAte, agora) : null;
    const conduzidaPorOutro = Boolean(sel?.atribuidoA && sel.atribuidoA !== meuEmail);
    // 🔎 Com resultado do banco na mão, a lista MOSTRA O RESULTADO — e o filtro
    // de aba não se aplica: a pessoa pediu "procure no banco", não "procure no
    // banco dentro da aba Fiscal". Filtrar de novo aqui faria a conversa
    // achada SUMIR depois de encontrada, que é o pior desfecho de uma busca.
    const visiveis = achados ? achados.conversas : filtrarConversas(conversas, { busca, aba });
    const naoLidasTotal = conversas.reduce((s, c) => s + (c.naoLidas || 0), 0);
    // O que falta nos avisos sai do NÚCLEO (três camadas numa pergunta só).
    const avisoDoTopo = faltaNosAvisos({
        permissao: permissaoAviso,
        somOk,
        pushDisponivel: pushConfigurado().ok,
        pushLigado: push.ligado,
        emIframe: dentroDeIframe(),
    });
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
            {/* ── 📧 E-mail não verificado: sem isto o envio é RECUSADO ("Token
                inválido: Email não verificado"). A trava do backend fica; o
                banner é o caminho que faltava para a conta de senha. ───────── */}
            {emailNaoVerificado && (
                <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 py-2.5">
                    <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-200">
                        📧 Seu e-mail ainda não foi verificado — o envio de mensagens é recusado até verificar
                    </p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                        É uma trava de segurança do sistema (contas de login por senha nascem sem verificação).
                        Peça o e-mail, abra o link que chegar em <strong>{currentUser.email || 'sua caixa'}</strong> e volte aqui.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                        <button onClick={enviarVerificacao}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded bg-amber-600 hover:bg-amber-700 text-white btn-press">
                            📧 Enviar e-mail de verificação
                        </button>
                        <button onClick={confirmarVerificacao}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded border border-amber-400 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 btn-press">
                            ↻ Já cliquei no link
                        </button>
                    </div>
                    {verifStatus && <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5">{verifStatus}</p>}
                </div>
            )}
            {/* ── ❓ Confirmação DO APP (window.confirm não existe no Teams) ───── */}
            {confirmPendente && (
                <div className="fixed inset-0 bg-black/60 z-[95] flex items-center justify-center p-4 overflow-y-auto"
                    onClick={() => responderConfirmacao(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm my-auto p-4 space-y-3"
                        onClick={(e) => e.stopPropagation()}>
                        <p className="text-[12px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{confirmPendente.texto}</p>
                        {confirmPendente.campo && (
                            <input value={confirmTexto} onChange={(e) => setConfirmTexto(e.target.value)}
                                placeholder={confirmPendente.placeholder} autoFocus className={CAMPO} />
                        )}
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => responderConfirmacao(false)}
                                className="px-3 py-1.5 text-[11px] font-semibold rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 btn-press">
                                Cancelar
                            </button>
                            <button onClick={() => responderConfirmacao(true)}
                                autoFocus={!confirmPendente.campo}
                                // Campo obrigatório: gravar consentimento/motivo
                                // em BRANCO seria registro de LGPD sem conteúdo.
                                disabled={confirmPendente.campo && !confirmTexto.trim()}
                                className="px-3 py-1.5 text-[11px] font-semibold rounded bg-[#0e3bfa] text-white btn-press disabled:opacity-40 disabled:cursor-not-allowed">
                                {confirmPendente.rotuloOk}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* ── 🖼️ Visualizador de imagem (zoom no app — Teams não abre blob:) ── */}
            {zoom && (
                <div className="fixed inset-0 bg-black/80 z-[90] flex items-center justify-center p-4 overflow-y-auto" onClick={() => setZoom(null)}>
                    <div className="max-w-[92vw] max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-1.5">
                            <a href={zoom.url} download={zoom.nome}
                                className="text-[11px] font-semibold text-white/90 underline">⬇ Baixar</a>
                            <button onClick={() => setZoom(null)} className="text-white/90 hover:text-white text-lg px-2" title="fechar">✕</button>
                        </div>
                        <img src={zoom.url} alt={zoom.nome} className="max-w-[92vw] max-h-[85vh] rounded-lg object-contain" />
                    </div>
                </div>
            )}
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
                                {/* 🌍 Cliente de fora do Brasil se declara com "+": sem o sinal,
                                    10 e 11 dígitos são lidos como brasileiros — que é o que a
                                    pessoa quis dizer ao digitar "11 99999-0000". */}
                                <span className="block text-[9px] text-slate-400">fora do Brasil, comece com + e o código do país (+244 …)</span>
                                <input value={nc.para} onChange={(e) => setNc((f) => ({ ...f, para: e.target.value }))} placeholder="(11) 99999-9999 ou +244 922 121 422"
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
                                    {/* As 8 FILAS de atendimento, não só os 5 módulos do SaaS — a
                                        Recepção (e RH/Jurídico) também iniciam conversa; só não têm
                                        template do CADASTRO (⚙️), então usam um Aprovado na Meta.
                                        🔒 Colaborador de fila só vê AS DELE (Paulo, 24/08): iniciar
                                        conversa por outra fila criaria um atendimento que ele mesmo
                                        não conseguiria ver depois. */}
                                    {filasChip.map((f) => <option key={f.id} value={f.id}>{rotuloCurtoFila(f.id)}</option>)}
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

            {/* ── Modal 📈 Relatório de atendimento (admin/gestor) ──────────── */}
            {relAberto && (
                <div className="fixed inset-0 bg-black/60 z-[80] flex items-start justify-center p-4 overflow-y-auto" onClick={() => setRelAberto(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl my-8 p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">📈 Relatório de atendimento</h3>
                            <button onClick={() => setRelAberto(false)} className="text-slate-400 hover:text-slate-600 px-1">✕</button>
                        </div>
                        <div className="flex gap-1.5">
                            {[7, 30, 90].map((d) => (
                                <button key={d} onClick={() => abrirRelatorio(d)}
                                    className={`text-[10px] font-bold px-2 py-1 rounded-full ${relDias === d
                                        ? 'bg-[#0e3bfa] text-white'
                                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                                    {d} dias
                                </button>
                            ))}
                        </div>
                        {relErro && <p className="text-[11px] text-red-600 dark:text-red-400">{relErro}</p>}
                        {relCarregando && <p className="text-[11px] text-slate-400">Montando…</p>}
                        {relDados && !relCarregando && (
                            <>
                                {relDados.parcial != null && (
                                    <p className="text-[10px] text-amber-700 dark:text-amber-400">
                                        ⚠️ O período tem mais de {relDados.parcial} mensagens — os números abaixo são PISO, não total. Encurte o período.
                                    </p>
                                )}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                                    {[
                                        ['Conversas', relDados.conversasComMovimento],
                                        ['Recebidas', relDados.recebidas],
                                        ['Respondidas (humano)', relDados.enviadasHumanas],
                                        ['Sem resposta humana', relDados.semRespostaHumana],
                                    ].map(([rotulo, v]) => (
                                        <div key={String(rotulo)} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                                            <p className="text-xl font-black text-slate-800 dark:text-slate-100">{v as number}</p>
                                            <p className="text-[9px] text-slate-500">{rotulo}</p>
                                        </div>
                                    ))}
                                </div>
                                {relDados.semRespostaHumana > 0 && (
                                    <p className="text-[10px] text-amber-700 dark:text-amber-400">
                                        ⚠️ {relDados.semRespostaHumana} conversa(s) com mensagem de cliente e NENHUMA resposta humana no período — o bot não conta como atendimento.
                                    </p>
                                )}
                                <div className="overflow-x-auto">
                                    <table className="w-full text-[10px]">
                                        <thead><tr className="text-left text-slate-400">
                                            <th className="py-1">Fila</th><th>Conversas</th><th>Recebidas</th><th>Resp. humanas</th><th>Bot</th><th>Sem resposta</th><th>1ª resposta (média)</th>
                                        </tr></thead>
                                        <tbody>
                                            {relDados.porFila.map((f) => (
                                                <tr key={f.fila} className="border-t border-slate-100 dark:border-slate-700/50 text-slate-600 dark:text-slate-300">
                                                    <td className="py-1 font-semibold">{rotuloCurtoFila(f.fila)}</td>
                                                    <td>{f.conversas}</td><td>{f.recebidas}</td><td>{f.enviadasHumanas}</td><td>{f.enviadasBot}</td>
                                                    <td className={f.semRespostaHumana ? 'text-amber-600 font-bold' : ''}>{f.semRespostaHumana}</td>
                                                    <td>{f.tempoMedio1aRespostaMin != null ? `${f.tempoMedio1aRespostaMin} min` : '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-[10px]">
                                        <thead><tr className="text-left text-slate-400">
                                            <th className="py-1">Atendente</th><th>Mensagens enviadas</th><th>Conversas em que atuou</th>
                                        </tr></thead>
                                        <tbody>
                                            {relDados.porAtendente.map((a) => (
                                                <tr key={a.atendente} className="border-t border-slate-100 dark:border-slate-700/50 text-slate-600 dark:text-slate-300">
                                                    <td className="py-1 font-semibold">{a.atendente.split('@')[0]}</td>
                                                    <td>{a.enviadas}</td><td>{a.conversas}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="text-[9px] text-slate-400">
                                    "1ª resposta" mede da mensagem do cliente até a primeira resposta HUMANA — a média é só das respondidas; as sem resposta saem contadas ao lado, nunca dissolvidas na média.
                                </p>
                            </>
                        )}
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

            {/* ── Modal 📇 CONTATOS (agenda, etiquetas, LGPD) ────────────────── */}
            {contatosAberto && (
                <div className="fixed inset-0 bg-black/60 z-[80] flex items-start justify-center p-4 overflow-y-auto" onClick={() => setContatosAberto(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                            <div className="min-w-0">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">📇 Contatos</h3>
                                <p className="text-[10px] text-slate-400">
                                    {ctResumo ? `${ctResumo.total} no total` : 'carregando…'}
                                    {ctResumo?.limiteLeitura ? ` · lendo os primeiros ${ctResumo.limiteLeitura} (há mais no banco)` : ''}
                                </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <button onClick={() => { setCtNovo({ numero: '', nome: '', categoria: '' }); setCtMsg(null); }}
                                    className="text-[10px] font-bold px-2 py-1 rounded bg-[#0e3bfa] hover:bg-[#091d8d] text-white">
                                    ➕ Novo
                                </button>
                                {ehAdmin && (
                                    <button onClick={() => { setContatosAberto(false); setCfgAba('importar'); setCfgAberta(true); }}
                                        title="Importar o backup da Ultra Fox (contatos e mensagens)"
                                        className="text-[10px] px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600">
                                        📥 Importar
                                    </button>
                                )}
                                <button onClick={() => setContatosAberto(false)} className="text-slate-400 hover:text-slate-600 px-1">✕</button>
                            </div>
                        </div>

                        <div className="p-4 space-y-2">
                            <input value={ctBusca}
                                onChange={(e) => { setCtBusca(e.target.value); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') carregarContatos(); }}
                                onBlur={() => carregarContatos()}
                                placeholder="🔎 Nome, empresa ou número… (Enter para buscar)"
                                className="w-full px-2.5 py-1.5 text-[12px] rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400" />

                            {/* Cada etiqueta com a CONTAGEM do conjunto inteiro — número do
                                filtro seria circular ("mostra 3 de 3"). */}
                            <div className="flex gap-1.5 flex-wrap">
                                {([['', `Todos · ${ctResumo?.total ?? 0}`], ['__sem', `Sem etiqueta · ${ctResumo?.semEtiquetaTotal ?? 0}`]] as const).map(([id, rot]) => (
                                    <button key={id || 'todos'} onClick={() => { setCtFiltro(id); carregarContatos({ filtro: id }); }}
                                        className={`text-[10px] font-bold px-2 py-1 rounded-full ${ctFiltro === id
                                            ? 'bg-[#0e3bfa] text-white'
                                            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                        {rot}
                                    </button>
                                ))}
                                {etiquetas.map((e) => (
                                    <button key={e.id} onClick={() => { setCtFiltro(e.id); carregarContatos({ filtro: e.id }); }}
                                        title={`${e.finalidade} (base legal: ${e.baseLegal})`}
                                        className={`text-[10px] font-bold px-2 py-1 rounded-full ${ctFiltro === e.id
                                            ? 'bg-[#0e3bfa] text-white'
                                            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                        {e.rotulo} · {ctResumo?.porEtiqueta?.[e.id] ?? 0}
                                    </button>
                                ))}
                            </div>

                            {ctMsg && <p className="text-[11px] text-slate-600 dark:text-slate-300">{ctMsg}</p>}
                            {ctErro && <p className="text-[11px] text-red-600 dark:text-red-400">{ctErro}</p>}

                            {/* ➕ Novo contato */}
                            {ctNovo && (
                                <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-2.5 space-y-1.5">
                                    <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">➕ Novo contato</p>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        <input value={ctNovo.numero} onChange={(e) => setCtNovo({ ...ctNovo, numero: e.target.value })}
                                            placeholder="(11) 99999-0000 · fora do Brasil: +244 …" className={CAMPO} />
                                        <input value={ctNovo.nome} onChange={(e) => setCtNovo({ ...ctNovo, nome: e.target.value })}
                                            placeholder="Nome" className={CAMPO} />
                                    </div>
                                    <label className="block text-[11px] text-slate-500">
                                        Categoria <span className="text-red-500 font-bold">*</span>
                                        <select value={ctNovo.categoria} onChange={(e) => setCtNovo({ ...ctNovo, categoria: e.target.value })} className={CAMPO}>
                                            <option value="">Escolha… (obrigatória)</option>
                                            {etiquetas.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
                                        </select>
                                    </label>
                                    <div className="flex gap-1.5">
                                        <button onClick={criarNovoContato} disabled={!ctNovo.categoria}
                                            title={ctNovo.categoria ? undefined : 'escolha a categoria — ela é obrigatória'}
                                            className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">Criar</button>
                                        <button onClick={() => setCtNovo(null)}
                                            className="text-[12px] px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300">Cancelar</button>
                                    </div>
                                    <p className="text-[10px] text-slate-400">
                                        A categoria é obrigatória (Paulo, 24/08). Mais etiquetas podem ser somadas depois, clicando no contato — ficam gravadas com o seu nome.
                                    </p>
                                </div>
                            )}

                            {/* Lista */}
                            <div className="space-y-1 max-h-[45vh] overflow-y-auto">
                                {ctCarregando && <p className="text-[11px] text-slate-400">Carregando…</p>}
                                {!ctCarregando && contatos.length === 0 && (
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        {ctResumo?.total === 0
                                            ? 'Nenhum contato ainda. Eles nascem sozinhos quando alguém escreve — e o backup da Ultra Fox entra pelo 📥 Importar.'
                                            : 'Nenhum contato com este filtro. (O total da casa continua acima.)'}
                                    </p>
                                )}
                                {contatos.map((c) => (
                                    <button key={c.numero} onClick={() => { setCtSel(ctSel?.numero === c.numero ? null : c); setCtEdit(null); setCtMsg(null); }}
                                        className={`w-full text-left rounded-lg border px-2.5 py-1.5 ${ctSel?.numero === c.numero
                                            ? 'border-[#0e3bfa] bg-[#0e3bfa]/5'
                                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                                                {c.nomePerfil || formatarNumeroBr(c.numero)}
                                                {c.empresaNome && <span className="ml-1.5 text-[10px] font-normal text-slate-400">· {c.empresaNome}</span>}
                                            </p>
                                            <div className="flex gap-1 shrink-0">
                                                {c.etiquetas.map((id) => {
                                                    const e = etiquetas.find((x) => x.id === id);
                                                    return (
                                                        <span key={id} className="text-[9px] font-bold px-1.5 py-px rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                                            {e?.rotulo || id}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-slate-400">
                                            {formatarNumeroBr(c.numero)}
                                            {c.origem ? ` · ${c.origem === 'ultrafox-import' ? 'veio do backup' : c.origem}` : ''}
                                        </p>
                                        {/* Pendência de LGPD fica NA LINHA da pessoa a que ela se
                                            refere — numa aba de auditoria, ninguém abriria. */}
                                        {(c.pendenciasLgpd || []).map((p, i) => (
                                            <p key={i} className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 leading-snug">
                                                ⚠️ {p.motivo} <span className="text-amber-600 dark:text-amber-500">{p.acao}</span>
                                            </p>
                                        ))}
                                    </button>
                                ))}
                            </div>

                            {ctResumo?.truncado && (
                                <p className="text-[10px] text-slate-400">
                                    Mostrando 500 de {ctResumo.totalFiltrado} — refine a busca para ver o resto.
                                </p>
                            )}

                            {/* Painel do contato escolhido */}
                            {ctSel && (
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100 truncate">
                                            {ctSel.nomePerfil || formatarNumeroBr(ctSel.numero)}
                                        </p>
                                        {!ctEdit && (
                                            <button
                                                onClick={() => { setCtEdit({ nome: ctSel.nomePerfil || '', observacao: ctSel.observacao || '' }); setCtMsg(null); }}
                                                className="shrink-0 text-[10px] font-bold px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 btn-press whitespace-nowrap">
                                                ✏️ Editar
                                            </button>
                                        )}
                                    </div>
                                    {/* ✏️ O cadastro: nome e observação. O backend aceitava os dois
                                        desde sempre e nenhum botão os mandava — campo que o servidor
                                        grava e ninguém pode preencher parece entrega, e quem precisa
                                        dele conclui que o app não faz. */}
                                    {ctEdit && (
                                        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-2.5 space-y-1.5">
                                            <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                                                Nome
                                                <input value={ctEdit.nome} onChange={(e) => setCtEdit({ ...ctEdit, nome: e.target.value })}
                                                    placeholder="como esta pessoa aparece na lista" className={CAMPO} />
                                            </label>
                                            <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                                                Observação
                                                <input value={ctEdit.observacao} onChange={(e) => setCtEdit({ ...ctEdit, observacao: e.target.value })}
                                                    placeholder="ex.: falar só à tarde · sócio da empresa X" className={CAMPO} />
                                            </label>
                                            <div className="flex gap-1.5">
                                                <button onClick={() => salvarCadastroDoContato(ctSel, ctEdit.nome, ctEdit.observacao)}
                                                    disabled={ctSalvando}
                                                    className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40 btn-press">
                                                    {ctSalvando ? 'Salvando…' : 'Salvar'}
                                                </button>
                                                <button onClick={() => setCtEdit(null)}
                                                    className="text-[12px] px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 btn-press">
                                                    Cancelar
                                                </button>
                                            </div>
                                            {/* A categoria fica logo abaixo, nas etiquetas: dizer isso
                                                aqui evita a pessoa procurar um campo "categoria" que
                                                não existe neste bloco. */}
                                            <p className="text-[10px] text-slate-400">
                                                A <strong>categoria</strong> (Cliente, Lead…) se troca nas 🏷 etiquetas logo abaixo — ela é
                                                obrigatória, então marque a nova antes de desmarcar a velha.
                                            </p>
                                        </div>
                                    )}
                                    {!ctEdit && ctSel.observacao && (
                                        <p className="text-[11px] text-slate-600 dark:text-slate-300">📝 {ctSel.observacao}</p>
                                    )}
                                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">🏷 Etiquetas</p>
                                    <div className="flex gap-1.5 flex-wrap">
                                        {etiquetas.map((e) => {
                                            const ativa = ctSel.etiquetas.includes(e.id);
                                            return (
                                                <button key={e.id} onClick={() => alternarEtiqueta(ctSel, e.id)}
                                                    title={`${e.finalidade}\nBase legal: ${e.baseLegal}`}
                                                    className={`text-[10px] font-bold px-2 py-1 rounded-full ${ativa
                                                        ? 'bg-[#0e3bfa] text-white'
                                                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                                    {ativa ? '✓ ' : ''}{e.rotulo}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {(ctSel.pendenciasLgpd || []).filter((p) => p.tipo === 'sem-consentimento').map((p) => (
                                        <div key={p.etiqueta} className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1.5">
                                            <p className="text-[10px] text-amber-800 dark:text-amber-300 leading-snug">{p.motivo}</p>
                                            <button onClick={() => registrarConsentimento(ctSel, p.etiqueta)}
                                                className="mt-1 text-[10px] font-bold px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white">
                                                ✍️ Registrar consentimento
                                            </button>
                                        </div>
                                    ))}
                                    <p className="text-[10px] text-slate-400">
                                        A etiqueta é classificação de pessoa: fica gravado quem etiquetou e quando.
                                    </p>
                                    {(ehAdmin || papel === 'gestor') && (
                                        <button onClick={() => excluirContatoSelecionado(ctSel.numero, ctSel.nomePerfil || formatarNumeroBr(ctSel.numero))}
                                            className="text-[10px] font-bold px-2 py-1 rounded bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40">
                                            🗑 Excluir contato
                                        </button>
                                    )}

                                    {/* 🔒 Direitos do titular. Só admin — o relatório traz a
                                        conversa INTEIRA da pessoa, que o colaborador da fila X
                                        não teria por que ver de um contato da fila Y. */}
                                    {ehAdmin && (
                                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                                            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">🔒 Pedido do titular (LGPD)</p>
                                            <div className="flex gap-1.5 flex-wrap mt-1">
                                                <button onClick={() => exportarDadosTitular(ctSel.numero)} disabled={lgpdOcupado}
                                                    title="Art. 18, II e V: gera e baixa tudo o que guardamos desta pessoa"
                                                    className="text-[10px] font-bold px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40">
                                                    📄 Exportar os dados dele
                                                </button>
                                                <button onClick={() => pedirPlanoEliminacao(ctSel.numero)} disabled={lgpdOcupado}
                                                    title="Art. 18, VI: mostra o que sai e o que fica ANTES de apagar"
                                                    className="text-[10px] font-bold px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40">
                                                    🗑 Eliminar os dados dele
                                                </button>
                                            </div>

                                            {lgpd?.relatorio && (
                                                <p className="mt-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                                                    ✓ Relatório gerado e baixado · {lgpd.relatorio.mensagens.total} mensagem(ns) ·
                                                    {' '}{lgpd.relatorio.etiquetas.length} etiqueta(s). O pedido ficou registrado.
                                                </p>
                                            )}

                                            {/* O plano vem ANTES do apagamento: o que fica vem
                                                NOMEADO, porque prometer "apagamos tudo" e guardar
                                                comprovante seria informação enganosa. */}
                                            {lgpd?.plano && (
                                                <div className="mt-1.5 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-2.5 py-2 space-y-1">
                                                    <p className="text-[11px] font-bold text-red-800 dark:text-red-300">O que será APAGADO</p>
                                                    {lgpd.plano.remove.length === 0
                                                        ? <p className="text-[10px] text-red-700 dark:text-red-400">Nada — não há dado deste número no app.</p>
                                                        : lgpd.plano.remove.map((r, i) => (
                                                            <p key={i} className="text-[10px] text-red-700 dark:text-red-400">• {r.item} ({r.quantidade})</p>
                                                        ))}
                                                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 pt-1">O que NÃO pode ser apagado — e por quê</p>
                                                    {lgpd.plano.mantem.map((m, i) => (
                                                        <p key={i} className="text-[10px] text-slate-600 dark:text-slate-300 leading-snug">
                                                            • <strong>{m.item}</strong>: {m.motivo}
                                                        </p>
                                                    ))}
                                                    <p className="text-[10px] text-red-800 dark:text-red-300 pt-0.5">{lgpd.plano.aviso}</p>
                                                    <div className="flex gap-1.5 pt-0.5">
                                                        {!lgpd.plano.nadaARemover && (
                                                            <button onClick={() => confirmarEliminacao(ctSel.numero)} disabled={lgpdOcupado}
                                                                className="text-[10px] font-bold px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-40">
                                                                Confirmar eliminação
                                                            </button>
                                                        )}
                                                        <button onClick={() => setLgpd(null)}
                                                            className="text-[10px] px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300">
                                                            Cancelar
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
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
                            {([['bot', '🤖 Bot e mensagens'], ['atendentes', '👥 Atendentes e filas'], ['canais', '📞 Números'], ['chamadas', '☎️ Voz e vídeo'], ['instagram', '📷 Instagram'], ['arquivo', '🗄 SharePoint'], ['importar', '📥 Importar Ultra Fox']] as const).map(([id, rotulo]) => (
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
                                    Clique nas filas de cada pessoa — salva na hora. Cada um vê e é avisado <strong>só das
                                    filas marcadas</strong>. Quem precisa ver TODAS: <strong>⭐ Gestor</strong> ou a fila
                                    <strong>Recepção</strong>. Sem nenhuma fila marcada, a pessoa só vê o que ela mesma
                                    conduz. <em>Ser admin do CFI configura o app, mas não dá visão do inbox inteiro.</em>
                                </p>
                                {/* 🔔 Aviso nativo do Teams (Paulo, 23/08): o webview do Teams
                                    não deixa a página mostrar popup do sistema — quem avisa lá é
                                    o PRÓPRIO Teams (sino de Atividade, com som, aba fechada e
                                    celular). Mesma audiência do push: filas, horário, IG restrito. */}
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">🔔 Aviso dentro do Teams (sino de Atividade)</p>
                                        <button onClick={alternarAvisoTeams} disabled={!cfg || cfgSalvando}
                                            className={`text-[10px] font-bold px-2.5 py-1 rounded-full disabled:opacity-40 ${cfg?.avisoTeamsAtivo
                                                ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                            {cfg?.avisoTeamsAtivo ? 'LIGADO' : 'desligado'}
                                        </button>
                                    </div>
                                    <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                        O popup do navegador <strong>não funciona dentro do Teams</strong> — quem avisa lá é o
                                        próprio Teams (banner + som, mesmo com a aba fechada, inclusive no celular). Quem
                                        recebe segue a <strong>mesma régua do push</strong>: filas, horário e a lista do 📷.
                                        <strong>Nasce ligado</strong> (alerta para a equipe nasce ativo — regra da casa); o
                                        teste avisa <strong>só você</strong> e diz o que falta se o aviso ainda não sai.
                                    </p>
                                    <button onClick={rodarTesteTeams} disabled={teamsTestando}
                                        className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                        {teamsTestando ? 'Enviando…' : '🧪 Testar no meu Teams'}
                                    </button>
                                    {teamsTeste && (teamsTeste.resultado.ok ? (
                                        <p className="text-[10.5px] text-emerald-700 dark:text-emerald-300">
                                            ✅ O Graph aceitou — confira o <strong>sino de Atividade</strong> do seu Teams. Chegou lá? Pode ligar a chave.
                                        </p>
                                    ) : (
                                        <div className="text-[10.5px] text-amber-800 dark:text-amber-300 space-y-0.5">
                                            <p>⚠️ Não foi ({teamsTeste.resultado.etapa}): {teamsTeste.resultado.erro}</p>
                                            {/* A recusa diz o que falta — os três suspeitos, na ordem: */}
                                            <p className="text-slate-500 dark:text-slate-400">
                                                Suspeitos: 1) permissão <strong>TeamsActivity.Send</strong> (aplicação) sem admin consent no
                                                app Graph do Azure{teamsTeste.status.clientId ? <> (client id <code>{teamsTeste.status.clientId}</code>)</> : null};
                                                2) o pacote do Teams instalado é anterior ao <code>activities</code> —
                                                baixe o atual em <a href="/sp-connect-teams.zip" className="underline">/sp-connect-teams.zip</a> e reenvie;
                                                3) o SP Connect não instalado no seu Teams.
                                            </p>
                                        </div>
                                    ))}
                                </div>

                                {atdErro && <p className="text-[11px] text-red-600 dark:text-red-400">{atdErro}</p>}
                                {!atdCarregado && !atdErro && <p className="text-[11px] text-slate-400">Carregando usuários…</p>}

                                {/* O MESMO farol da aba 🤖, aqui na forma de placar: lá ele diz que
                                    existe o problema, aqui ele mostra quantos faltam por fila —
                                    que é a informação de quem está resolvendo. Régua única: os dois
                                    leem `coberturaDasFilas`. */}
                                {atdCarregado && (() => {
                                    const cob = coberturaDasFilas({ menu: cfg?.menu || [], atendentes });
                                    return (
                                        <div className="flex flex-wrap gap-1">
                                            {cob.filas.map((f) => (
                                                <span key={f.fila}
                                                    title={f.situacao === 'coberta'
                                                        ? `${f.doDepartamento} pessoa(s) do departamento`
                                                        : `ninguém do departamento — ${f.tambemVeem} pessoa(s) veem tudo`}
                                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${f.situacao === 'coberta'
                                                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300'
                                                        : f.situacao === 'invisivel'
                                                            ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'
                                                            : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'}`}>
                                                    {rotuloCurtoFila(f.fila)} · {f.doDepartamento}
                                                </span>
                                            ))}
                                        </div>
                                    );
                                })()}
                                <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                                    {atendentes.map((a) => (
                                        <div key={a.uid} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                                                    {a.nome || a.email || a.uid}
                                                    {/* 🚨 O selo dizia "admin · tudo" e virou MENTIRA em 24/08: administrar
                                                        o CFI deixou de dar visão do inbox inteiro. Ele agora diz o que o
                                                        papel FAZ (configura, encerra qualquer atendimento) — a visão sai
                                                        das filas ao lado, como em todo mundo. */}
                                                    {a.role === 'admin' && <span className="ml-1.5 text-[9px] font-bold text-emerald-600" title="Administra o app (⚙️, cadastros) e pode encerrar qualquer atendimento. A VISÃO das conversas segue as filas marcadas — marque ⭐ Gestor ou a fila Recepção para ver todas.">admin do app</span>}
                                                    {/* 👑 O dono vê tudo por CONSTRUÇÃO — o selo existe pra ninguém
                                                        tentar "arrumar" o acesso dele mexendo em fila ou papel. */}
                                                    {a.dono && <span className="ml-1.5 text-[9px] font-bold text-violet-600" title="Dono do escritório: vê e atende TODAS as filas sempre, sem depender de marcação. Não há o que configurar aqui.">👑 dono · tudo</span>}
                                                </p>
                                                {/* 🚨 O ⭐ era ESCONDIDO justo para o admin — herança de quando
                                                    admin via tudo de graça. Com a separação de 24/08 isso virou
                                                    beco: o admin que precisa do inbox inteiro não tinha o botão
                                                    que resolve. Só o DONO fica sem ele, porque nele não muda nada. */}
                                                {!a.dono && (
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
                        {/* ── aba ☎️ Voz e vídeo (SONDA — não liga nada) ──── */}
                        {cfgAba === 'chamadas' && (
                            <div className="space-y-2">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    A <strong>sonda pergunta à Meta</strong> como está a chamada de voz/vídeo —
                                    ela não muda nada. O que muda alguma coisa fica no bloco <strong>🛠 Gravar na
                                    Meta</strong> abaixo, cada ação com a consequência escrita antes do clique.
                                    Ligar a chamada faz aparecer o botão de ligar no WhatsApp de <strong>todos os
                                    clientes</strong>: é decisão sua, com o destino de atendimento definido antes,
                                    não efeito de um clique de diagnóstico.
                                </p>

                                <button onClick={rodarSonda} disabled={sondando}
                                    className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                    {sondando ? 'Perguntando à Meta…' : '🔎 Sondar o estado na Meta'}
                                </button>
                                {sondaErro && <p className="text-[11px] text-red-600 dark:text-red-400">{sondaErro}</p>}

                                {sonda && (
                                    <>
                                        {/* O veredito nunca diz "desligado" por omissão: sem resposta
                                            conclusiva ele fica INDETERMINADO, com a ação do lado. */}
                                        <div className={`rounded-lg border px-3 py-2 ${sonda.conclusao.veredito === 'ligado'
                                            ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
                                            : sonda.conclusao.veredito === 'desligado'
                                                ? 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40'
                                                : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'}`}>
                                            <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">
                                                {sonda.conclusao.veredito === 'ligado' ? '✅ A chamada está LIGADA para este número'
                                                    : sonda.conclusao.veredito === 'desligado' ? '⚪ A chamada está DESLIGADA'
                                                        : `⚠️ ${sonda.conclusao.veredito}`}
                                            </p>
                                            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">{sonda.conclusao.motivo}</p>
                                            {sonda.conclusao.acao && (
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{sonda.conclusao.acao}</p>
                                            )}
                                        </div>

                                        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide pt-1">
                                            Antes de ligar — o que muda para o cliente
                                        </p>
                                        {sonda.antesDeLigar.map((a) => (
                                            <div key={a.titulo} className="rounded-lg border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5">
                                                <p className="text-[11px] font-bold text-amber-900 dark:text-amber-200">{a.titulo}</p>
                                                <p className="text-[10.5px] text-amber-800 dark:text-amber-300 leading-snug">{a.texto}</p>
                                            </div>
                                        ))}

                                        {/* ── 🛠 Gravar na Meta (Paulo, 23/08: caminho 1 — SIP → HitPhone;
                                            "as ligações devem obedecer os mesmos horários das mensagens").
                                            O que aparece depois de gravar é o que a Meta GUARDOU: a rota
                                            re-lê as settings — validação por resultado, não por status. */}
                                        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide pt-1">
                                            🛠 Gravar na Meta
                                        </p>
                                        {chamadaErro && (
                                            <p className="text-[11px] text-red-600 dark:text-red-400">
                                                ⛔ A Meta recusou a gravação: {chamadaErro}
                                            </p>
                                        )}
                                        {chamadaResultado && (
                                            <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                                                ✓ Gravado ({chamadaResultado.acao}) — o estado abaixo já é o RELIDO da Meta.
                                            </p>
                                        )}

                                        {/* 🕒 Horários — a grade é UMA: a das mensagens, projetada. */}
                                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 space-y-1">
                                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">🕒 Horários da chamada</p>
                                            <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                                Regra da casa: a ligação obedece os <strong>mesmos horários das mensagens</strong> —
                                                fora deles o botão ☎️ do cliente fica indisponível, em vez de tocar no vazio.
                                                Não existe grade própria da chamada: mudou o horário na aba 🤖, reaplique aqui
                                                (a Meta não lê nossa configuração sozinha).
                                            </p>
                                            {sonda.horarios?.mensagens && (
                                                <p className="text-[10.5px] text-slate-600 dark:text-slate-300">
                                                    Horário das mensagens hoje: dias {(sonda.horarios.mensagens.dias || [])
                                                        .map((d) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d]).join(', ')} ·{' '}
                                                    {(sonda.horarios.mensagens.turnos || []).map((t) => `${t.inicio}–${t.fim}`).join(' e ')}
                                                </p>
                                            )}
                                            {sonda.horarios?.conferencia && (
                                                <p className={`text-[10.5px] font-semibold ${sonda.horarios.conferencia.situacao === 'igual'
                                                    ? 'text-emerald-700 dark:text-emerald-300'
                                                    : 'text-amber-700 dark:text-amber-300'}`}>
                                                    {sonda.horarios.conferencia.situacao === 'igual' ? '✅ ' : '⚠️ '}
                                                    {sonda.horarios.conferencia.motivo}
                                                </p>
                                            )}
                                            {/* 🚨 AGORA ESTAMOS DENTRO DA JANELA? (24/08)
                                                Testamos a ligação às 19:51 — FORA de 08:00–12:00 e 13:00–17:30 —
                                                e o painel não disse uma palavra. Fora da grade a Meta recusa a
                                                chamada com a MESMA frase que se lê como defeito ("SP Assessoria
                                                não pode receber ligações do WhatsApp"), então o teste fora da
                                                hora responde sobre o HORÁRIO e parece resposta sobre o TRONCO.
                                                O painel tem a grade e tem o relógio: calar aqui é deixar quem
                                                testa concluir a causa errada. */}
                                            {sonda.horarios?.mensagens && (() => {
                                                const agora = new Date();
                                                const dentro = dentroDoHorario(sonda.horarios.mensagens, agora);
                                                const hora = agora.toLocaleTimeString('pt-BR',
                                                    { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
                                                return (
                                                    <p className={`text-[10.5px] font-semibold rounded px-2 py-1 ${dentro
                                                        ? 'text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/30'
                                                        : 'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30'}`}>
                                                        {dentro
                                                            ? `✅ Agora (${hora}) está DENTRO da janela — um teste de ligação vale como teste.`
                                                            : `⛔ Agora (${hora}) está FORA da janela. Um teste de ligação AGORA é recusado pela Meta com "não pode receber ligações do WhatsApp" — e essa recusa é do HORÁRIO, não do tronco. Teste dentro da grade acima.`}
                                                    </p>
                                                );
                                            })()}
                                            <button
                                                onClick={() => aplicarChamada({ acao: 'horarios' },
                                                    'Aplicar à CHAMADA os mesmos horários das mensagens?\n\nFora desses horários o botão ☎️ do cliente fica indisponível. Se um dia o horário das mensagens mudar, é preciso voltar aqui e reaplicar — a Meta não acompanha sozinha.')}
                                                disabled={aplicandoChamada !== null}
                                                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                                {aplicandoChamada === 'horarios' ? 'Gravando…' : '🕒 Aplicar os horários das mensagens à chamada'}
                                            </button>
                                        </div>

                                        {/* 👁 Botão ☎️ do cliente — ocultar é a saída enquanto não há destino. */}
                                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 space-y-1">
                                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">👁 Botão ☎️ no WhatsApp do cliente</p>
                                            <p className="text-[10.5px] text-slate-600 dark:text-slate-300">
                                                Estado na Meta:{' '}
                                                {sonda.horarios?.calling?.call_icon_visibility === 'DISABLE_ALL'
                                                    ? '🙈 OCULTO — os clientes não veem o botão de ligar.'
                                                    : sonda.horarios?.calling?.call_icon_visibility
                                                        ? `👁 VISÍVEL (${String(sonda.horarios.calling.call_icon_visibility)}) — o cliente pode ver o ☎️ na conversa.`
                                                        : 'não declarado pela Meta — rode a sonda.'}
                                            </p>
                                            {sonda.horarios?.calling?.call_icon_visibility === 'DISABLE_ALL' ? (
                                                <button
                                                    onClick={() => aplicarChamada({ acao: 'icone', iconeVisivel: true },
                                                        'MOSTRAR o botão ☎️ para os clientes?\n\nSem um destino de atendimento (tronco SIP) cadastrado, quem ligar vai chamar no vazio — e a leitura do cliente é "a SP não me atende".')}
                                                    disabled={aplicandoChamada !== null}
                                                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 disabled:opacity-40">
                                                    {aplicandoChamada === 'icone' ? 'Gravando…' : '👁 Mostrar o botão'}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => aplicarChamada({ acao: 'icone', iconeVisivel: false },
                                                        'OCULTAR o botão ☎️ dos clientes?\n\nEles deixam de ver a opção de ligar — e cliente que já usou o botão entende o sumiço como serviço retirado. Use enquanto o destino (tronco SIP → HitPhone) não estiver cadastrado; ao cadastrar, volte aqui e mostre de novo.')}
                                                    disabled={aplicandoChamada !== null}
                                                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 disabled:opacity-40">
                                                    {aplicandoChamada === 'icone' ? 'Gravando…' : '🙈 Ocultar o botão (até o destino existir)'}
                                                </button>
                                            )}
                                        </div>

                                        {/* 📞 Tronco SIP — a resposta do HitPhone preenche aqui. */}
                                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 space-y-1">
                                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">📞 Destino da chamada (tronco SIP → HitPhone)</p>
                                            {(() => {
                                                const servidores = (sonda.horarios?.calling as { sip?: { servers?: { hostname?: string; port?: number }[] } } | null)?.sip?.servers;
                                                const sipLigado = sonda.horarios?.interruptores?.estado.sip === 'ENABLED';
                                                return Array.isArray(servidores) && servidores.length > 0 ? (
                                                    // 🚨 O verde AFIRMAVA "tronco gravado" só porque o
                                                    // endereço existia — e endereço guardado NÃO é tronco
                                                    // LIGADO. Foi essa frase que ficou verde enquanto o
                                                    // cliente ouvia "não pode receber ligações".
                                                    <p className={`text-[10.5px] ${sipLigado
                                                        ? 'text-emerald-700 dark:text-emerald-300'
                                                        : 'text-amber-700 dark:text-amber-300'}`}>
                                                        {sipLigado ? '✅ Tronco LIGADO na Meta: ' : '⚠️ Servidor gravado, mas o SIP NÃO está ligado: '}
                                                        {servidores.map((s) => `${s.hostname}:${s.port}`).join(' · ')}
                                                        {!sipLigado && ` (sip.status = ${sonda.horarios?.interruptores?.estado.sip || 'não declarado'})`}
                                                    </p>
                                                ) : (
                                                    <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                                        Nenhum servidor SIP gravado — a chamada ainda não tem onde cair. É a resposta
                                                        do <strong>suporte do HitPhone</strong> (hostname + porta, com TLS/SRTP) que
                                                        preenche estes campos.
                                                    </p>
                                                );
                                            })()}
                                            <div className="flex gap-2 items-center flex-wrap">
                                                <input value={sipHost} onChange={(e) => setSipHost(e.target.value)}
                                                    placeholder="hostname SIP (ex.: sip.hitphone.com.br)"
                                                    className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 w-64" />
                                                <input value={sipPorta} onChange={(e) => setSipPorta(e.target.value)}
                                                    placeholder="porta" inputMode="numeric"
                                                    className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 w-20" />
                                                <button
                                                    onClick={() => aplicarChamada({ acao: 'sip', hostname: sipHost.trim(), porta: Number(sipPorta) },
                                                        `Cadastrar o tronco SIP "${sipHost.trim()}:${sipPorta}" na Meta?\n\nA partir daí as chamadas de WhatsApp são entregues nesse servidor (o HitPhone), como uma linha própria — confira lá a rota/fila desse tronco antes de mostrar o botão aos clientes.`)}
                                                    disabled={aplicandoChamada !== null || !sipHost.trim()}
                                                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                                    {aplicandoChamada === 'sip' ? 'Gravando…' : '📞 Cadastrar tronco SIP'}
                                                </button>
                                            </div>
                                        </div>

                                        {/* 🚦 OS INTERRUPTORES (25/08) — o que a Meta tem LIGADO.
                                            O painel mostrava ícone, horário e servidores, e nunca
                                            leu `calling.status` nem `sip.status`. A escrita manda
                                            `status: ENABLED` e ninguém RE-LIA se ela guardou ligado:
                                            status passando por resultado dentro do nosso próprio
                                            painel de diagnóstico. Foi por isso que tudo ficou verde
                                            com a ligação recusada às 09:15, DENTRO da janela. */}
                                        {sonda.horarios?.interruptores && (
                                            <div className={`rounded-lg px-3 py-2 space-y-1 ${sonda.horarios.interruptores.ok
                                                ? 'bg-emerald-50 dark:bg-emerald-900/30'
                                                : 'bg-red-50 dark:bg-red-900/30'}`}>
                                                <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                                                    🚦 O que a Meta tem LIGADO
                                                </p>
                                                <ul className="text-[10.5px] text-slate-700 dark:text-slate-200 space-y-0.5">
                                                    {([
                                                        ['Chamada do número', sonda.horarios.interruptores.estado.chamada, 'calling.status'],
                                                        ['SIP (o tronco)', sonda.horarios.interruptores.estado.sip, 'sip.status'],
                                                        ['Botão ☎️ do cliente', sonda.horarios.interruptores.estado.icone, 'call_icon_visibility'],
                                                        ['Horários da chamada', sonda.horarios.interruptores.estado.horarios, 'call_hours.status'],
                                                    ] as const).map(([rot, valor, campo]) => (
                                                        <li key={campo}>
                                                            {valor === 'ENABLED' || valor === 'DEFAULT' ? '✓' : '⚠'} {rot}:{' '}
                                                            <strong>{valor}</strong>{' '}
                                                            <span className="text-slate-400">({campo})</span>
                                                        </li>
                                                    ))}
                                                    <li>· servidores SIP gravados: <strong>{sonda.horarios.interruptores.estado.servidores}</strong></li>
                                                </ul>
                                                {/* ⚠️ "não-declarado" NUNCA é lido como ligado: assumir o
                                                    que não foi medido é o que produziu o verde falso. */}
                                                {sonda.horarios.interruptores.impedimentos.map((im) => (
                                                    <div key={im.campo} className="text-[10.5px] text-red-800 dark:text-red-200">
                                                        <p className="font-bold">⛔ {im.motivo}</p>
                                                        <p>{im.acao}</p>
                                                    </div>
                                                ))}
                                                {sonda.horarios.interruptores.ok && (
                                                    <p className="text-[10.5px] text-emerald-800 dark:text-emerald-200">
                                                        Os quatro estão como devem. Se a ligação ainda for recusada, a causa não
                                                        está em nenhum interruptor daqui.
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {/* 🔌 A META CONSEGUE FALAR COM O NOSSO SBC?
                                            🚨 A sonda de cima é toda verde e a ligação é recusada na ORIGEM —
                                            porque ela responde OUTRA pergunta: "o que a Meta tem GRAVADO?".
                                            Ter gravado o hostname não é ela CONSEGUIR abrir TLS nele. Em modo
                                            SIP quem liga para o nosso servidor é a Meta; se o aperto de mão não
                                            fecha, se o certificado não é público ou se o nome não bate, ela
                                            recusa antes de mandar INVITE nenhum — e por isso o log do Asterisk
                                            fica mudo. Este botão faz o que ela faz: ABRE A CONEXÃO. */}
                                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 space-y-1.5">
                                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">🔌 A Meta consegue falar com o nosso SBC?</p>
                                            <p className="text-[10.5px] text-slate-600 dark:text-slate-300">
                                                A sonda acima diz o que a Meta tem <strong>gravado</strong>. Esta abre a conexão do
                                                jeito que ela abre — DNS, TLS, certificado e um <em>SIP OPTIONS</em>. É o que separa
                                                "tudo verde e a ligação recusada" de uma causa com nome.
                                            </p>
                                            <button
                                                onClick={async () => {
                                                    setSondandoSbc(true); setSbc(null);
                                                    try {
                                                        const r = await sondarSbc(sipHost.trim() ? { hostname: sipHost.trim(), porta: Number(sipPorta) || 5061 } : undefined);
                                                        setSbc(r.ok ? r : ({ conclusao: { veredito: 'indeterminado', motivo: r.error || 'Falha ao sondar.', acao: 'Tente de novo; se persistir, é falha do próprio app.' } } as SondaSbc));
                                                    } finally { setSondandoSbc(false); }
                                                }}
                                                disabled={sondandoSbc}
                                                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-800 dark:bg-slate-600 text-white disabled:opacity-40 btn-press whitespace-nowrap">
                                                {sondandoSbc ? 'Medindo… (até 8s)' : '🔌 Testar o caminho até o SBC'}
                                            </button>
                                            {sbc && (
                                                <div className={`rounded-lg px-2.5 py-2 text-[10.5px] ${sbc.conclusao.veredito === 'aprovado'
                                                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200'
                                                    : sbc.conclusao.veredito === 'reprovado'
                                                        ? 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                                                        : 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200'}`}>
                                                    <p className="font-bold">
                                                        {sbc.conclusao.veredito === 'aprovado' ? '✅' : sbc.conclusao.veredito === 'reprovado' ? '⛔' : '⚠️'}{' '}
                                                        {sbc.conclusao.motivo}
                                                    </p>
                                                    <p className="mt-0.5">{sbc.conclusao.acao}</p>
                                                    {sbc.conclusao.ressalvas?.map((r) => <p key={r} className="mt-0.5">• {r}</p>)}
                                                    {/* As etapas ficam à vista: é a lista que diz ONDE parou, e é
                                                        ela que vai junto no chamado do suporte da Meta. */}
                                                    <ul className="mt-1.5 space-y-0.5 text-slate-600 dark:text-slate-300">
                                                        <li>{sbc.dns?.ok ? '✓' : '✕'} DNS {sbc.hostname} {sbc.dns?.enderecos?.length ? `→ ${sbc.dns.enderecos.join(', ')}` : (sbc.dns?.erro || '')}</li>
                                                        <li>{sbc.tcp?.ok ? '✓' : '✕'} porta {sbc.porta} {sbc.tcp?.erro || ''}</li>
                                                        <li>{sbc.tls?.ok ? '✓' : '✕'} TLS {sbc.tls?.protocolo || sbc.tls?.erro || ''}</li>
                                                        {sbc.certificado && (
                                                            <li>{sbc.certificado.grave ? '✕' : '✓'} certificado — {sbc.certificado.motivo}
                                                                {sbc.cert?.emissor ? ` (emissor: ${sbc.cert.emissor})` : ''}</li>
                                                        )}
                                                        <li>{sbc.sip?.respondeu ? '✓' : '✕'} SIP {sbc.sip?.respondeu
                                                            ? `${sbc.sip.codigo}${sbc.sip.frase ? ` ${sbc.sip.frase}` : ''}${sbc.sip.servidor ? ` · ${sbc.sip.servidor}` : ''}`
                                                            : (sbc.sip?.motivo || '')}</li>
                                                    </ul>
                                                    {sbc.origemDoAlvo && (
                                                        <p className="mt-1 text-slate-500 dark:text-slate-400">
                                                            Alvo veio de: {sbc.origemDoAlvo}.
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* 🔎 O PEDIDO DE RETORNO — promessa feita EM NOSSO NOME.
                                            Fora do horário, a tela da Meta oferece ao cliente "Pedir
                                            retorno de ligação" e diz "entraremos em contato assim que
                                            possível". Se esse pedido chega ao webhook e ninguém lê, o
                                            cliente espera um retorno que não vem.
                                            ⚠️ Isto NÃO processa nada: o leiaute não está provado, e
                                            escrever handler de payload que ninguém viu é inventar
                                            leiaute. Ele ACHA o evento real. */}
                                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 space-y-1.5">
                                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">🔎 O que a Meta já mandou sobre chamada</p>
                                            <p className="text-[10.5px] text-slate-600 dark:text-slate-300">
                                                Fora do horário o cliente vê <strong>"Pedir retorno de ligação"</strong> e a promessa
                                                de que entraremos em contato. Peça um retorno pelo celular e clique aqui: é deste
                                                evento que sai a régua para o pedido virar tarefa de alguém.
                                            </p>
                                            <button
                                                onClick={async () => {
                                                    setLendoCrus(true);
                                                    try {
                                                        const r = await eventosCrusDeChamada();
                                                        setCrus(r.ok ? { achados: r.achados || [], amostra: r.amostra || 0 } : null);
                                                    } finally { setLendoCrus(false); }
                                                }}
                                                disabled={lendoCrus}
                                                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 btn-press whitespace-nowrap">
                                                {lendoCrus ? 'Lendo…' : '🔎 Ver eventos de chamada (crus)'}
                                            </button>
                                            {crus && (
                                                <div className="text-[10.5px] text-slate-600 dark:text-slate-300 space-y-1">
                                                    <p>
                                                        {crus.achados.length === 0
                                                            ? `Nenhum evento de chamada entre os ${crus.amostra} eventos mais recentes do webhook.`
                                                            : `${crus.achados.length} evento(s) de chamada entre os ${crus.amostra} mais recentes:`}
                                                    </p>
                                                    {crus.achados.map((a, i) => (
                                                        <details key={i} className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1">
                                                            <summary className="cursor-pointer font-semibold">
                                                                {a.em ? new Date(a.em).toLocaleString('pt-BR') : 'sem data'} — {a.rotulo}
                                                            </summary>
                                                            <pre className="mt-1 text-[9px] bg-slate-900 text-slate-200 rounded p-2 overflow-x-auto max-h-48">
                                                                {JSON.stringify(a.payload, null, 2)}
                                                            </pre>
                                                        </details>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide pt-1">
                                            O que cada caminho respondeu
                                        </p>
                                        {sonda.sondas.map((s) => (
                                            <details key={s.candidato} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
                                                <summary className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                                                    {s.rotulo} — <span className="font-normal">{s.situacao}</span>
                                                </summary>
                                                <p className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-1">
                                                    <strong>Hipótese:</strong> {s.hipotese}
                                                </p>
                                                <p className="text-[10.5px] text-slate-600 dark:text-slate-300 mt-0.5">{s.motivo}</p>
                                                {s.acao && <p className="text-[10.5px] text-slate-500 dark:text-slate-400">{s.acao}</p>}
                                                {/* A resposta CRUA vai junto: é dela que sai a régua no dia em
                                                    que a Meta mudar o formato — nunca de suposição. */}
                                                {s.bruto != null && (
                                                    <pre className="mt-1 text-[9px] bg-slate-900 text-slate-200 rounded p-2 overflow-x-auto max-h-40">
                                                        {JSON.stringify(s.bruto, null, 2)}
                                                    </pre>
                                                )}
                                            </details>
                                        ))}
                                    </>
                                )}
                            </div>
                        )}

                        {/* ── aba 📷 Instagram (SONDA — não linka nada) ───── */}
                        {cfgAba === 'instagram' && (
                            <div className="space-y-2">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    A <strong>sonda</strong> pergunta à Meta se o token enxerga uma Página com o
                                    Instagram vinculado — ela <strong>não liga nada</strong>. Quem liga o
                                    recebimento das DMs é o botão <strong>📡</strong> logo abaixo, e só ele.
                                </p>

                                {/* 👤 Restrição POR USUÁRIO (Paulo, 22/08: "o instagram sera
                                    limitado por usuario e nao por dpto"). A régua real é do
                                    BACKEND (listagem, thread, resposta, anexo e push) — aqui é
                                    só a edição da lista. */}
                                {cfg && (
                                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
                                        <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">👤 Quem atende as DMs (um e-mail por linha)</p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                            Com e-mails aqui, <strong>SÓ eles</strong> veem, abrem e respondem conversa 📷 — vale
                                            também pro push, e vale até pra admin fora da lista (admin edita aqui e pode se
                                            incluir). <strong>Lista vazia = sem restrição</strong> (vale a regra de filas de sempre).
                                        </p>
                                        <textarea
                                            value={(cfg.instagramAtendentes || []).join('\n')}
                                            onChange={(e) => setCfg((c) => (c ? { ...c, instagramAtendentes: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) } : c))}
                                            rows={4}
                                            placeholder={'juliana.gomes@spassessoriacontabil.com.br\nrhsp@spassessoriacontabil.com.br'}
                                            className="w-full px-2 py-1.5 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-mono"
                                        />
                                        <div className="flex items-center gap-2">
                                            <button onClick={salvarCfg} disabled={cfgSalvando}
                                                className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                                {cfgSalvando ? 'Salvando…' : '💾 Salvar lista'}
                                            </button>
                                            {cfgOk && <span className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ salvo</span>}
                                            {cfgErro && <span className="text-[11px] text-red-600 dark:text-red-400">{cfgErro}</span>}
                                        </div>
                                    </div>
                                )}

                                <button onClick={rodarSondaIg} disabled={sondandoIg}
                                    className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                    {sondandoIg ? 'Perguntando à Meta…' : '🔎 Sondar o estado na Meta'}
                                </button>
                                {sondaIgErro && <p className="text-[11px] text-red-600 dark:text-red-400">{sondaIgErro}</p>}

                                {/* ── 📡 Recebimento das DMs (nasce DESLIGADO, como o bot) ── */}
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
                                    <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">📡 Recebimento das DMs no inbox</p>
                                    {igEstado ? (
                                        <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                                            ✅ Ligado em {new Date(igEstado.ligadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                                            {igEstado.ligadoPor ? ` por ${igEstado.ligadoPor}` : ''} — Página {igEstado.pageId}
                                            {igEstado.igUsername ? ` · @${igEstado.igUsername}` : ''}. Religar só re-afirma a assinatura (não duplica nada).
                                        </p>
                                    ) : (
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                            Desligado. O botão assina o webhook do Instagram na Meta: a DM passa a
                                            entrar aqui como conversa <strong>📷 Instagram</strong>, na triagem da
                                            Recepção — <strong>o bot não roda nas DMs</strong> (menu numérico é
                                            contrato do WhatsApp); quem conduz é gente. Nesta fase a resposta é
                                            por <strong>texto</strong>, dentro da janela que a Meta dá.
                                        </p>
                                    )}
                                    <button onClick={ligarIg} disabled={igLigando}
                                        className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                        {igLigando ? 'Assinando na Meta…' : igEstado ? '📡 Religar (re-afirmar assinatura)' : '📡 Ligar recebimento das DMs'}
                                    </button>
                                    {igLigarErro && <p className="text-[11px] text-red-600 dark:text-red-400">{igLigarErro}</p>}

                                    {/* 📨 A entrega tem DUAS metades e este bloco diz em qual
                                        o problema está: os eventos CRUS são gravados ANTES de
                                        qualquer processamento, então "zero cru" = a Meta não
                                        entregou (conserto do lado de LÁ); "tem cru e não tem
                                        conversa" = o processamento é NOSSO. */}
                                    {igEstado && igEventos !== undefined && (
                                        igEventos === null ? (
                                            <p className="text-[11px] text-amber-700 dark:text-amber-300">
                                                ⚠️ Não deu pra conferir os eventos recebidos (a leitura falhou) — recarregue; sem conferir, não dá pra afirmar de que lado está o problema.
                                            </p>
                                        ) : igEventos.doInstagram > 0 ? (
                                            <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                                                📨 A Meta ESTÁ entregando: {igEventos.doInstagram} evento(s) do Instagram entre os {igEventos.amostra} webhooks mais recentes
                                                {igEventos.ultimoEm ? ` (último em ${new Date(igEventos.ultimoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})` : ''}.
                                                Se a conversa 📷 não aparece na lista, o problema é do NOSSO processamento — reporte com este print.
                                            </p>
                                        ) : (
                                            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 space-y-1">
                                                <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
                                                    🚫 Nenhum evento do Instagram chegou (conferido nos {igEventos.amostra} webhooks mais recentes) — a Meta não está entregando a DM.
                                                </p>
                                                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                                                    O conserto é do lado de LÁ, nesta ordem:
                                                </p>
                                                <ol className="text-[11px] text-amber-800 dark:text-amber-300 list-decimal ml-4 space-y-0.5">
                                                    <li><strong>No app do Instagram</strong> (@spassessoriacontabil, no celular): Configurações → Mensagens e respostas a stories → Controles de mensagem → ligar <strong>"Permitir acesso às mensagens"</strong> (ferramentas conectadas). Esse interruptor nasce DESLIGADO e sem ele a Meta não manda NENHUMA DM ao webhook — é a causa nº 1.</li>
                                                    <li><strong>No painel de developers</strong> (developers.facebook.com → app API_Oficial → Webhooks): no seletor de objeto, escolha <strong>Instagram</strong> e confira se o campo <strong>messages</strong> aparece como assinado.</li>
                                                    <li>Depois de mexer, mande OUTRA DM de teste e recarregue esta aba — este contador é a prova.</li>
                                                </ol>
                                            </div>
                                        )
                                    )}

                                    {/* 🔑 As DUAS envs do modo "login do Instagram" — presença na
                                        revisão que está SERVINDO ("adicionei no console" ≠ "está
                                        no ar", lição de 17/08). */}
                                    {igEstado && igEnvs && (
                                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                            🔑 Envs no ar: INSTAGRAM_APP_SECRET {igEnvs.instagramAppSecret ? '✅' : '🔴 AUSENTE'} · INSTAGRAM_ACCESS_TOKEN {igEnvs.instagramAccessToken ? '✅' : '🔴 AUSENTE'}
                                            {igEnvs.instagramAppSecret && igEnvs.instagramAccessToken && (
                                                <span className="font-bold"> — tudo pronto: mande a DM de teste e recarregue esta aba.</span>
                                            )}
                                            {(!igEnvs.instagramAppSecret || !igEnvs.instagramAccessToken) && (
                                                <span className="block text-red-700 dark:text-red-300 font-bold">
                                                    Env ausente na revisão que está servindo — se você já adicionou no console, falta o deploy da esteira levá-la a 100% (peça o "pode disparar").
                                                </span>
                                            )}
                                        </p>
                                    )}

                                    {/* 📋 Último POST recusado por assinatura: "a Meta bateu e a
                                        chave não conferiu" ≠ "a Meta nunca bateu". */}
                                    {igEstado && igPostRecusado && (
                                        <p className="text-[11px] font-bold text-red-700 dark:text-red-300">
                                            📮 A Meta BATEU no webhook ({new Date(igPostRecusado.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}{igPostRecusado.objeto ? ` · objeto "${igPostRecusado.objeto}"` : ''}) e a ASSINATURA não conferiu — o valor em INSTAGRAM_APP_SECRET não é a "Chave secreta do app do Instagram" (ou a env não está no ar). Corrija a chave e peça nova DM.
                                        </p>
                                    )}

                                    {/* 📋 Último aperto de mão no GET do webhook: navegador ×
                                        Meta com token errado × Meta ok — os três viram o mesmo
                                        "Forbidden" pra quem olha de fora (caso de 22/08). */}
                                    {igEstado && igVerificacao && (
                                        <p className={`text-[11px] ${igVerificacao.ok ? 'text-emerald-700 dark:text-emerald-300' : igVerificacao.pareceNavegador ? 'text-slate-500 dark:text-slate-400' : 'text-red-700 dark:text-red-300 font-bold'}`}>
                                            📋 Último aperto de mão no webhook ({new Date(igVerificacao.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}):{' '}
                                            {igVerificacao.ok
                                                ? '✅ verificado com sucesso — o token colado na Meta confere.'
                                                : igVerificacao.pareceNavegador
                                                    ? 'foi um NAVEGADOR abrindo a URL (sem os parâmetros da Meta) — o "Forbidden" aí é o comportamento certo, não é erro.'
                                                    : `🔴 a Meta tentou verificar e foi RECUSADA — ${igVerificacao.motivo || 'motivo não registrado'}. Se o motivo é o verify_token, o valor colado no painel não é o da env WHATSAPP_WEBHOOK_VERIFY_TOKEN (confira espaço no fim e se não copiou o NOME do secret em vez do VALOR).`}
                                        </p>
                                    )}

                                    {/* 🔬 O que a META diz que está assinado — pergunta à fonte,
                                        não à nossa memória do clique no 📡. */}
                                    {igEstado && (() => {
                                        if (!igAssinaturas) {
                                            return (
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                    🔬 Não deu pra perguntar à Meta o que está assinado (a consulta falhou) — recarregue pra tentar de novo.
                                                </p>
                                            );
                                        }
                                        const subIg = igAssinaturas.doApp.find((s) => s.objeto === 'instagram');
                                        const cobre = Boolean(subIg && subIg.ativa && subIg.campos.includes('messages'));
                                        return (
                                            <div className={`rounded-lg border px-3 py-2 space-y-1 ${cobre
                                                ? 'border-slate-200 dark:border-slate-700'
                                                : 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'}`}>
                                                <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                                                    🔬 O que a Meta diz que está assinado (app {igAssinaturas.appId}):
                                                </p>
                                                {igAssinaturas.doApp.length === 0 && (
                                                    <p className="text-[11px] text-red-700 dark:text-red-300">Nenhuma assinatura de webhook no app — clique o 📡 de novo.</p>
                                                )}
                                                {igAssinaturas.doApp.map((s) => (
                                                    <p key={s.objeto} className="text-[11px] text-slate-600 dark:text-slate-300">
                                                        • <strong>{s.objeto}</strong> → campos: {s.campos.join(', ') || '—'} · {s.ativa ? '✅ ativa' : '🔴 INATIVA'}
                                                        {s.callback ? ` · callback …${s.callback.slice(-40)}` : ''}
                                                    </p>
                                                ))}
                                                {igAssinaturas.daPagina && (
                                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                        Página assinada por: {igAssinaturas.daPagina.map((a) => `app ${a.appId} (${a.campos.join(', ') || 'sem campos'})`).join(' · ') || 'nenhum app'}
                                                    </p>
                                                )}
                                                {!cobre ? (
                                                    <p className="text-[11px] font-bold text-red-700 dark:text-red-300">
                                                        A assinatura do objeto instagram com o campo <code>messages</code> NÃO está de pé do lado da Meta — clique o 📡 de novo; se persistir, o painel de Webhooks do app é quem resolve.
                                                    </p>
                                                ) : (igEventos && igEventos.doInstagram === 0 && (
                                                    <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                                                        <p className="font-bold">A assinatura está de pé e mesmo assim nada chega. Suspeitos, na ordem:</p>
                                                        <p>• <strong>Caso de uso "login do Instagram"</strong> (descoberto em 22/08): o app tem um app do Instagram PRÓPRIO (API_Oficial-IG) e o webhook desse modo se configura NA TELA DO CASO DE USO (seção "Configurar webhooks"), com a URL <code>…run.app/api/whatsapp/webhook</code> e o MESMO verify token do Cloud Run — e a chave secreta DELE precisa estar no Cloud Run como <code>INSTAGRAM_APP_SECRET</code>, senão a DM chega e é recusada com 401 antes do evento cru.</p>
                                                        <p>• <strong>Solicitações de mensagem</strong>: DM de quem a conta não segue cai em "Message requests" — abra o Instagram oficial, ACEITE a solicitação e peça OUTRA mensagem.</p>
                                                        <p>• <strong>App publicado</strong>: o próprio painel avisa que o app precisa estar com status de publicado para receber webhooks.</p>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                </div>

                                {sondaIg && (
                                    <>
                                        {/* "conta-encontrada" prova IDENTIDADE, não prova MENSAGEM — o
                                            texto da ação já diz isso, então a cor não pode gritar "pronto". */}
                                        <div className={`rounded-lg border px-3 py-2 ${sondaIg.conclusao.veredito === 'conta-encontrada'
                                            ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
                                            : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'}`}>
                                            <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">
                                                {sondaIg.conclusao.veredito === 'conta-encontrada'
                                                    ? `✅ Achei: Página "${sondaIg.conclusao.pagina?.nome}" · Instagram @${sondaIg.conclusao.instagram?.username || sondaIg.conclusao.instagram?.id}`
                                                    : `⚠️ ${sondaIg.conclusao.veredito}`}
                                            </p>
                                            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">{sondaIg.conclusao.motivo}</p>
                                            {sondaIg.conclusao.acao && (
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{sondaIg.conclusao.acao}</p>
                                            )}
                                        </div>

                                        <div className="rounded-lg border-l-4 border-sky-400 bg-sky-50 dark:bg-sky-900/20 px-3 py-1.5">
                                            <p className="text-[11px] font-bold text-sky-900 dark:text-sky-200">{sondaIg.sobreRestringirAtendentes.titulo}</p>
                                            <p className="text-[10.5px] text-sky-800 dark:text-sky-300 leading-snug">{sondaIg.sobreRestringirAtendentes.texto}</p>
                                        </div>

                                        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide pt-1">
                                            O que cada caminho respondeu
                                        </p>
                                        {sondaIg.sondas.map((s) => (
                                            <details key={s.candidato} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
                                                <summary className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                                                    {s.rotulo} — <span className="font-normal">{s.situacao}</span>
                                                </summary>
                                                <p className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-1">
                                                    <strong>Hipótese:</strong> {s.hipotese}
                                                </p>
                                                <p className="text-[10.5px] text-slate-600 dark:text-slate-300 mt-0.5">{s.motivo}</p>
                                                {s.acao && <p className="text-[10.5px] text-slate-500 dark:text-slate-400">{s.acao}</p>}
                                                {s.bruto != null && (
                                                    <pre className="mt-1 text-[9px] bg-slate-900 text-slate-200 rounded p-2 overflow-x-auto max-h-40">
                                                        {JSON.stringify(s.bruto, null, 2)}
                                                    </pre>
                                                )}
                                            </details>
                                        ))}
                                    </>
                                )}
                            </div>
                        )}

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
                                            {/* 📱 Número aprovado ainda NÃO está no WhatsApp: sem o
                                                `/register` da Cloud API ele não recebe mensagem, e o
                                                painel da Meta não faz esse passo — ela mesma manda
                                                usar a API (Paulo, 24/08, no 3155-1554). */}
                                            {c.pronto && c.origem !== 'env' && (
                                                <div className="mt-1.5 border-t border-slate-200 dark:border-slate-700 pt-1.5 space-y-1">
                                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                                        📱 Número novo só recebe mensagem depois de <strong>ativado na Cloud API</strong>.
                                                        Escolha um PIN de 6 dígitos (verificação em duas etapas do número) e guarde-o no cofre — nós não o guardamos.
                                                    </p>
                                                    <div className="flex gap-1.5">
                                                        <input value={pinCanal[c.id] || ''} inputMode="numeric" maxLength={6}
                                                            onChange={(e) => setPinCanal((p) => ({ ...p, [c.id]: e.target.value.replace(/\D/g, '') }))}
                                                            placeholder="PIN (6 dígitos)" className={`${CAMPO} !w-36`} />
                                                        <button onClick={() => conferirCanal(c.id)}
                                                            className="px-2 py-1 text-[11px] font-semibold rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 btn-press">
                                                            🔬 Conferir na Meta
                                                        </button>
                                                        <button onClick={() => ativarCanal(c.id, c.rotulo)} disabled={registrando === c.id}
                                                            className="px-2 py-1 text-[11px] font-semibold rounded bg-[#0e3bfa] hover:bg-[#091d8d] disabled:opacity-60 text-white btn-press">
                                                            {registrando === c.id ? '⏳ Ativando…' : '📱 Ativar na Cloud API'}
                                                        </button>
                                                    </div>
                                                    {canalMsg[c.id] && <p className="text-[10px] text-slate-600 dark:text-slate-300">{canalMsg[c.id]}</p>}
                                                </div>
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

                        {/* ── aba 🗄 SharePoint (arquivo de mídia) ──────────── */}
                        {cfgAba === 'arquivo' && (
                            <div className="space-y-2">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Regra do manual: <strong>tudo que não for texto</strong> (foto, áudio, vídeo, documento)
                                    é salvo no SharePoint. Isso roda <strong>sozinho</strong>, de carona no ciclo do arquivo
                                    fiscal — este botão só antecipa a rodada e mostra o resultado.
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    A pasta é <strong>genérica de propósito</strong> (muito contato não é cliente — currículo,
                                    lead): <code className="text-[10px]">SP Connect/{'{ano}'}/{'{mês}'}/{'{nome ou empresa}'} - {'{número}'}</code>.
                                    Contato vinculado a cliente ganha o nome da empresa no rótulo da pasta.
                                </p>
                                <button onClick={rodarArquivoSp} disabled={arqRodando}
                                    className="text-[11px] font-bold px-3 py-1.5 rounded bg-[#0e3bfa] text-white disabled:opacity-60">
                                    {arqRodando ? '⏳ arquivando…' : '🗄 Arquivar agora'}
                                </button>
                                {arqErro && <p className="text-[11px] text-red-600 dark:text-red-400">{arqErro}</p>}
                                {arqResultado && (
                                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                                        <p><strong>{arqResultado.arquivados ?? 0}</strong> arquivo(s) subiram nesta rodada · {arqResultado.lidos ?? 0} mensagens conferidas.</p>
                                        {(arqResultado.erros ?? 0) > 0 && (
                                            <p className="text-red-600 dark:text-red-400">{arqResultado.erros} falha(s) de upload — elas voltam na próxima rodada. {(arqResultado.errosDetalhe || []).slice(0, 3).join(' · ')}</p>
                                        )}
                                        {arqResultado.pausadoPorTeto
                                            ? <p>Parou no teto da rodada — <strong>ainda há mídia esperando</strong>: rode de novo (ou deixe o ciclo automático continuar).</p>
                                            : arqResultado.cicloCompleto
                                                ? <p>✓ Varredura completa — tudo que tinha mídia gravada está arquivado.</p>
                                                : <p>Rodada parcial — o ciclo continua sozinho.</p>}
                                    </div>
                                )}
                            </div>
                        )}

                        {cfgAba === 'importar' && (
                            <div className="space-y-2">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Restaura o backup da Ultra Fox. <strong>Nada é gravado sem o preview</strong>: primeiro
                                    a leitura, depois a confirmação. Contato que já existe no SP Connect
                                    <strong> não é sobrescrito</strong>, e reimportar o mesmo arquivo não duplica mensagem.
                                </p>
                                {/* 📦 PASTA INTEIRA — o caminho normal para o backup de verdade.
                                    Os botões abaixo continuam para arquivo avulso. */}
                                <div className="rounded-lg border border-[#0e3bfa]/30 dark:border-[#0e3bfa]/50 bg-[#0e3bfa]/5 p-2.5 space-y-1.5">
                                    <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">📦 Pasta inteira do backup</p>
                                    <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-snug">
                                        Escolha a pasta que contém <strong>uma pasta por número</strong> (dentro de
                                        <code className="mx-1">whatsapp/</code>, a pasta do número do escritório). O navegador lê
                                        tudo <strong>aqui na sua máquina</strong> — a mídia não sai do computador nesta etapa.
                                    </p>
                                    <input type="file" multiple
                                        // @ts-expect-error atributo de diretório não está no tipo do React
                                        webkitdirectory=""
                                        onChange={(e) => escolherPastaBackup(e.target.files)}
                                        className="text-[11px] text-slate-500" />
                                    {loteLendo && <p className="text-[11px] text-slate-500">⏳ {loteLendo}</p>}
                                    {loteVarredura && (
                                        <div className="space-y-0.5">
                                            <p className="text-[11px] text-slate-700 dark:text-slate-200">
                                                {loteVarredura.contatos} contato(s) · {loteVarredura.arquivosParaLer} arquivo(s) de conversa
                                            </p>
                                            {loteVarredura.avisos.map((a, i) => (
                                                <p key={i} className="text-[10px] text-amber-700 dark:text-amber-400">⚠️ {a}</p>
                                            ))}
                                            {loteVarredura.foraDoPadrao > 0 && (
                                                <p className="text-[10px] text-slate-500">{loteVarredura.foraDoPadrao} arquivo(s) fora do padrão do export (ignorados).</p>
                                            )}
                                        </div>
                                    )}
                                    {lotePrevia && (
                                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-2 space-y-1.5">
                                            <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">
                                                {lotePrevia.mensagens} mensagens em {lotePrevia.conversas} conversa(s)
                                                {lotePrevia.descartadas > 0 ? ` · ${lotePrevia.descartadas} linha(s) descartada(s)` : ''}
                                            </p>
                                            {(() => {
                                                const av = avisoDeAnexos({ midias: loteVarredura?.midias || 0, comAnexo: lotePrevia.comAnexo });
                                                if (!av) return null;
                                                return (
                                                    <p className={`text-[10px] ${av.grave ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-300'}`}>
                                                        📎 {av.texto}
                                                    </p>
                                                );
                                            })()}
                                            {lotePrevia.arquivosSemMensagem > 0 && (
                                                <p className="text-[10px] text-amber-700 dark:text-amber-400">
                                                    ⚠️ {lotePrevia.arquivosSemMensagem} arquivo(s) foram lidos e <strong>nenhuma mensagem foi reconhecida</strong> —
                                                    sinal de que o formato daqueles é diferente. Me diga se este número for grande.
                                                </p>
                                            )}
                                            {lotePrevia.mensagens === 0 ? (
                                                <p className="text-[11px] text-red-600 dark:text-red-400">
                                                    Nenhuma mensagem reconhecida. Não grave — o formato do export não é o que o leitor espera.
                                                </p>
                                            ) : (
                                                <>
                                                    {/* A DIREÇÃO É ESCOLHA HUMANA e continua sendo: sem saber
                                                        quem é do escritório, "enviada" e "recebida" seriam chute. */}
                                                    <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                                        Quais autores são do ESCRITÓRIO? (viram mensagens ENVIADAS)
                                                    </p>
                                                    <div className="flex gap-1.5 flex-wrap max-h-32 overflow-y-auto">
                                                        {lotePrevia.autores.slice(0, 60).map((a) => (
                                                            <button key={a.autor}
                                                                onClick={() => setLoteAutores((l) => (l.includes(a.autor) ? l.filter((x) => x !== a.autor) : [...l, a.autor]))}
                                                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${loteAutores.includes(a.autor)
                                                                    ? 'bg-emerald-600 text-white'
                                                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                                                                {loteAutores.includes(a.autor) ? '🏢 ' : ''}{a.autor} · {a.total}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    {lotePrevia.autores.length > 60 && (
                                                        <p className="text-[10px] text-slate-500">
                                                            mostrando 60 de {lotePrevia.autores.length} autores (os de maior volume) — os demais entram como CLIENTE.
                                                        </p>
                                                    )}
                                                    {!loteAutores.length && (
                                                        <p className="text-[10px] text-amber-700 dark:text-amber-400">
                                                            Marque ao menos um: sem isso a direção das mensagens seria chute, e o servidor recusa.
                                                        </p>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                    {loteErro && <p className="text-[11px] text-red-600 dark:text-red-400">{loteErro}</p>}
                                    {loteResultado && (
                                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                            ✓ {loteResultado.gravadas} mensagens gravadas em {loteResultado.conversas} conversa(s)
                                            {loteResultado.recusadas > 0 ? ` · ${loteResultado.recusadas} recusada(s) por data ou texto ilegível` : ''}
                                        </p>
                                    )}
                                    <div className="flex justify-end">
                                        <button onClick={gravarLote}
                                            disabled={Boolean(loteLendo) || !lotePrevia || !lotePrevia.mensagens || !loteAutores.length}
                                            className="text-[12px] font-bold px-4 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                                            Confirmar e gravar o lote
                                        </button>
                                    </div>
                                </div>

                                <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">Ou um arquivo avulso:</p>
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
                                    {/* 🚨 ALCANCE — é o que deixa os DOIS apps de pé.
                                        A Ultra Fox continua assinada na WABA de propósito
                                        (é a rede de segurança); os dois recebem a mesma
                                        mensagem, então quem limita o menu em dobro é a
                                        lista daqui. */}
                                    {cfg.botAtivo && (
                                        <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 space-y-1.5">
                                            <div className="flex gap-1.5 flex-wrap">
                                                {([['piloto', '🧪 Só os números de teste'], ['todos', '🌐 Todos os clientes']] as const).map(([id, rot]) => (
                                                    <button key={id}
                                                        onClick={() => setCfg((c) => (c ? { ...c, botAlcance: id } : c))}
                                                        className={`text-[10px] font-bold px-2 py-1 rounded-full ${cfg.botAlcance === id
                                                            ? (id === 'todos' ? 'bg-red-600 text-white' : 'bg-[#0e3bfa] text-white')
                                                            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                                        {rot}
                                                    </button>
                                                ))}
                                            </div>

                                            {cfg.botAlcance === 'piloto' ? (
                                                <>
                                                    <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-snug">
                                                        O bot responde <strong>só</strong> a estes números. É assim que dá para testar
                                                        com a Ultra Fox ainda de pé: os dois apps continuam recebendo, e
                                                        <strong> nenhum cliente vê menu em dobro</strong>.
                                                    </p>
                                                    <textarea
                                                        value={(cfg.botNumerosPiloto || []).join('\n')}
                                                        onChange={(e) => setCfg((c) => (c ? {
                                                            ...c,
                                                            botNumerosPiloto: e.target.value.split('\n').map((n) => n.trim()).filter(Boolean),
                                                        } : c))}
                                                        rows={3}
                                                        placeholder={'Um número por linha, com DDD\n11 99999-0000'}
                                                        className={`${CAMPO} font-mono`} />
                                                    {/* Lista vazia = bot LIGADO e mudo. Dizer isso evita a
                                                        conclusão de que o app quebrou. */}
                                                    {(cfg.botNumerosPiloto || []).length === 0 ? (
                                                        <p className="text-[10px] text-amber-700 dark:text-amber-400">
                                                            ⚠️ Lista vazia: o bot está ligado e <strong>não responde a ninguém</strong>.
                                                            Isso é de propósito — some um número para começar o teste.
                                                        </p>
                                                    ) : (
                                                        <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                                                            ✓ {(cfg.botNumerosPiloto || []).length} número(s) no piloto. O resto da carteira
                                                            segue só com a plataforma antiga.
                                                        </p>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    <p className="text-[10px] text-red-700 dark:text-red-400 leading-snug">
                                                        🚨 <strong>O bot vai responder a TODOS os clientes.</strong> É o dia do corte.
                                                    </p>
                                                    {/* Este texto dizia "quem escrever recebe DOIS menus". O teste
                                                        real de 17/08 desmentiu: a Ultra Fox segue assinada na WABA e
                                                        o bot dela NÃO respondeu. Manter o aviso velho mandaria remover
                                                        o app dela antes da hora — o contrário da decisão do Paulo de
                                                        ficar com os dois de pé. Fica o FATO, com a origem e o limite. */}
                                                    <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-snug">
                                                        No teste de 17/08 a Ultra Fox continuava assinada na WABA e o bot dela
                                                        <strong> não respondeu</strong> — então não houve menu em dobro. Isso foi
                                                        <strong> observado num número</strong>, não é garantia: se aparecer resposta
                                                        dela na carteira, volte para 🧪 e avise.
                                                    </p>
                                                    <p className="text-[10px] text-emerald-700 dark:text-emerald-400 leading-snug">
                                                        ✓ Conversa que já tem <strong>atendente conduzindo</strong> não recebe
                                                        saudação nem menu por cima — o bot só faz a triagem de quem ainda
                                                        não tem dono.
                                                    </p>
                                                </>
                                            )}

                                            {/* 🚨 O MENU PROMETE 8 DEPARTAMENTOS — TEM GENTE EM CADA UM?
                                                O bot MOVE a conversa para a fila escolhida, e dali em diante
                                                quem enxerga é quem atende aquela fila. Sem vínculo, o cliente
                                                é encaminhado para um lugar sem dono e fica esperando — e ele
                                                não tem como perceber. Este aviso mora AQUI, junto da chave
                                                que causa o efeito, e não numa aba que ninguém abre. */}
                                            {(() => {
                                                const cob = coberturaDasFilas({ menu: cfg.menu, atendentes: atdCarregado ? atendentes : null });
                                                if (cob.indeterminado) {
                                                    // Lista não carregada NÃO vira "ninguém vinculado": alarme
                                                    // falso justo quando pode estar tudo certo.
                                                    return (
                                                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                                            ⏳ Conferindo quem atende cada fila do menu…
                                                        </p>
                                                    );
                                                }
                                                if (!cob.opcoesSemDono.length) {
                                                    return (
                                                        <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                                                            ✓ Todas as opções do menu têm alguém do departamento vinculado.
                                                        </p>
                                                    );
                                                }
                                                return (
                                                    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2 space-y-1">
                                                        <p className="text-[10px] font-bold text-amber-800 dark:text-amber-300">
                                                            ⚠️ {cob.opcoesSemDono.length} opção(ões) do menu levam a fila sem ninguém do departamento
                                                        </p>
                                                        <ul className="text-[10px] text-amber-900 dark:text-amber-200 space-y-0.5">
                                                            {cob.opcoesSemDono.map((o) => (
                                                                <li key={o.opcao}>
                                                                    <strong>{o.opcao}</strong> — {o.rotulo}:{' '}
                                                                    {o.situacao === 'invisivel'
                                                                        ? <span className="font-bold text-red-700 dark:text-red-400">ninguém enxerga esta fila</span>
                                                                        : <>só {o.tambemVeem} pessoa(s) que veem tudo (Recepção/gestor/admin)</>}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                        <p className="text-[10px] text-amber-800 dark:text-amber-300">
                                                            O cliente escolhe, a conversa <strong>sai da Recepção</strong> e vai para lá —
                                                            ele acha que foi encaminhado e espera. Vincule em{' '}
                                                            <button onClick={() => setCfgAba('atendentes')} className="underline font-bold">
                                                                👥 Atendentes e filas
                                                            </button>
                                                            {' '}ou tire a opção do menu.
                                                        </p>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
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
                                            📊 Pedir AVALIAÇÃO ao encerrar o atendimento
                                            <span className="block text-[9px] text-slate-400">só sai com a janela aberta; só a PRIMEIRA resposta vale como nota — não insiste</span>
                                        </span>
                                    </label>
                                    {/* 🚨 ESCALA — nasceu do defeito de 17/08: a mensagem
                                        pedia "1 a 10" e a régua aceitava 1-5, então a nota
                                        do cliente era descartada em silêncio. */}
                                    {cfg.avaliacaoAtiva && (
                                        <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                                            <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300">Escala da nota</p>
                                            <div className="flex gap-1.5 mt-1">
                                                {[10, 5].map((n) => (
                                                    <button key={n}
                                                        onClick={() => setCfg((c) => (c ? { ...c, avaliacaoEscala: n } : c))}
                                                        className={`text-[10px] font-bold px-2 py-1 rounded-full ${cfg.avaliacaoEscala === n
                                                            ? 'bg-[#0e3bfa] text-white'
                                                            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                                        1 a {n}
                                                    </button>
                                                ))}
                                            </div>
                                            {/* A divergência é dita ANTES de salvar — depois, o
                                                sintoma seria o painel dizendo "0 avaliações". */}
                                            {(() => {
                                                const c = conferirEscalaNaMensagem(cfg.mensagens?.avaliacao, cfg.avaliacaoEscala);
                                                return c.ok ? (
                                                    <p className="text-[10px] text-slate-400 mt-1">
                                                        A mensagem lá embaixo precisa pedir a mesma faixa. Nota fora da escala é
                                                        registrada como descartada — não some calada.
                                                    </p>
                                                ) : (
                                                    <p className="text-[10px] text-red-700 dark:text-red-400 mt-1 leading-snug">
                                                        🚨 {c.erro}
                                                    </p>
                                                );
                                            })()}
                                        </div>
                                    )}
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
                                        <div key={i} className="space-y-1">
                                            <div className="flex items-center gap-1.5">
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
                                                <button onClick={() => setCfg((c) => c ? {
                                                    ...c, menu: c.menu.map((x, j) => (j === i
                                                        ? { ...x, submenu: [...(x.submenu || []), { opcao: String((x.submenu?.length || 0) + 1), fila: x.fila, rotulo: '' }] }
                                                        : x)),
                                                } : c)} title="Adicionar sub-opção (a opção vira uma PORTA: escolher abre este sub-menu)"
                                                    className="text-[10px] text-[#0e3bfa] font-bold px-1 whitespace-nowrap">↳ sub</button>
                                                <button onClick={() => setCfg((c) => c ? { ...c, menu: c.menu.filter((_, j) => j !== i) } : c)}
                                                    className="text-slate-400 hover:text-red-600 px-1">✕</button>
                                            </div>
                                            {/* ↳ Sub-opções (item 5 de 21/08): a opção acima vira PORTA —
                                                o cliente escolhe, vê este sub-menu (com "0 - Voltar"), e a
                                                fila só se define aqui. Esvaziar as sub-opções devolve a
                                                opção ao comportamento direto. */}
                                            {(m.submenu?.length || 0) > 0 && (m.submenu || []).map((s, k) => (
                                                <div key={k} className="flex items-center gap-1.5 pl-8">
                                                    <span className="text-[10px] text-slate-400">↳</span>
                                                    <input value={s.opcao} onChange={(e) => setCfg((c) => c ? {
                                                        ...c, menu: c.menu.map((x, j) => (j === i
                                                            ? { ...x, submenu: (x.submenu || []).map((y, l) => (l === k ? { ...y, opcao: e.target.value } : y)) } : x)),
                                                    } : c)} className={`${CAMPO} !w-10 text-center`} />
                                                    <input value={s.rotulo} onChange={(e) => setCfg((c) => c ? {
                                                        ...c, menu: c.menu.map((x, j) => (j === i
                                                            ? { ...x, submenu: (x.submenu || []).map((y, l) => (l === k ? { ...y, rotulo: e.target.value } : y)) } : x)),
                                                    } : c)} className={CAMPO} placeholder="Sub-opção que o cliente lê" />
                                                    <select value={s.fila} onChange={(e) => setCfg((c) => c ? {
                                                        ...c, menu: c.menu.map((x, j) => (j === i
                                                            ? { ...x, submenu: (x.submenu || []).map((y, l) => (l === k ? { ...y, fila: e.target.value } : y)) } : x)),
                                                    } : c)} className={`${CAMPO} !w-32`}>
                                                        {filas.map((f) => <option key={f.id} value={f.id}>{rotuloCurtoFila(f.id)}</option>)}
                                                    </select>
                                                    <button onClick={() => setCfg((c) => c ? {
                                                        ...c, menu: c.menu.map((x, j) => (j === i
                                                            ? { ...x, submenu: (x.submenu || []).filter((_, l) => l !== k) } : x)),
                                                    } : c)} className="text-slate-400 hover:text-red-600 px-1">✕</button>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                    <button onClick={() => setCfg((c) => c ? {
                                        ...c, menu: [...c.menu, { opcao: String(c.menu.length + 1), fila: 'recepcao', rotulo: '' }],
                                    } : c)} className="text-[11px] text-[#0e3bfa] font-bold">＋ opção</button>
                                    <p className="text-[10px] text-slate-400">Menu vazio ou só com fila inválida volta ao padrão na gravação — triagem morta em silêncio não passa.</p>
                                </div>
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5">
                                    <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">⚡ Respostas rápidas do composer</p>
                                    <p className="text-[10px] text-slate-400">
                                        Uma frase por linha — viram os chips ⚡ acima da caixa de resposta, pra equipe inteira.
                                        Apagar todas tira os chips (é escolha, não erro).
                                    </p>
                                    <textarea value={(cfg.respostasRapidas || []).join('\n')}
                                        onChange={(e) => setCfg((c) => c ? { ...c, respostasRapidas: e.target.value.split('\n') } : c)}
                                        rows={4} className={CAMPO} placeholder={'Bom dia! Tudo bem?\nRecebido, já estamos verificando.'} />
                                </div>
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5">
                                    <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">🖼️ Imagem por fila (opcional)</p>
                                    <p className="text-[10px] text-slate-400">Enviada JUNTO da confirmação, quando o cliente escolhe a opção — a arte do departamento, como a Ultra Fox manda hoje. Sobe/troca na hora (não depende de "Salvar configuração"). Fila sem imagem segue só com o texto.</p>
                                    {filas.map((f) => {
                                        const url = cfg.imagensPorFila?.[f.id];
                                        return (
                                            <div key={f.id} className="flex items-center gap-2">
                                                {url ? (
                                                    <img src={url} alt={f.rotulo} className="w-9 h-9 rounded object-cover border border-slate-200 dark:border-slate-700 shrink-0" />
                                                ) : (
                                                    <span className="w-9 h-9 rounded bg-slate-100 dark:bg-slate-700 shrink-0" />
                                                )}
                                                <span className="text-[11px] text-slate-600 dark:text-slate-300 flex-1 min-w-0 truncate">{f.rotulo}</span>
                                                <label className={`text-[10px] font-bold px-2 py-1 rounded cursor-pointer ${imgFilaEnviando === f.id ? 'opacity-40 pointer-events-none' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                                    {imgFilaEnviando === f.id ? 'enviando…' : url ? 'trocar' : 'subir'}
                                                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                                                        onChange={(e) => { subirImgFila(f.id, e.target.files?.[0] || null); e.target.value = ''; }} />
                                                </label>
                                                {url && (
                                                    <button onClick={() => tirarImgFila(f.id)} disabled={imgFilaEnviando === f.id}
                                                        className="text-slate-400 hover:text-red-600 px-1 disabled:opacity-40">✕</button>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {imgFilaErro && <p className="text-[11px] text-red-600 dark:text-red-400">{imgFilaErro}</p>}
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
                            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide shrink-0">Conversas</p>
                            {/* flex-wrap: a fileira passou de 3 pra 5 botões, e em coluna
                                estreita ela transborda — é a lição de 13/08, aplicada antes
                                de o Paulo mandar o print. */}
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                <button onClick={abrirNova} title="Iniciar conversa por template aprovado"
                                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#0e3bfa] hover:bg-[#091d8d] text-white">
                                    ✚ Nova
                                </button>
                                <button onClick={abrirContatos} title="Contatos: agenda, etiquetas (Lead, Cliente, Marketing…) e importação do backup"
                                    className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600">
                                    📇
                                </button>
                                <button onClick={abrirAvaliacoes} title="Avaliações dos atendimentos (nota do cliente)"
                                    className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600">
                                    📊
                                </button>
                                {(papel === 'admin' || papel === 'gestor') && (
                                    <button onClick={() => abrirRelatorio()} title="Relatório de atendimento: volume por fila/atendente e tempo de 1ª resposta"
                                        className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600">
                                        📈
                                    </button>
                                )}
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
                            onChange={(e) => { setBusca(e.target.value); if (achados) setAchados(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') procurarNoBanco(); }}
                            placeholder="🔎 Nome, número ou mensagem…"
                            className="w-full px-2.5 py-1.5 text-[12px] rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                        />
                        {/* 🔎 A OUTRA METADE DO TETO MENOR (Paulo, 25/08).
                            A lista carrega 300 para a página abrir rápido; a busca
                            do campo filtra só o que está carregado. Sem esta porta,
                            procurar conversa de dois meses atrás não acharia nada —
                            e "não achei" se lê como "não existe". */}
                        {busca.trim().length >= 2 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                    onClick={procurarNoBanco}
                                    disabled={procurando}
                                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-50 btn-press whitespace-nowrap">
                                    {procurando ? 'Procurando…' : '🔎 Procurar no banco inteiro'}
                                </button>
                                {achados && (
                                    <button onClick={() => setAchados(null)}
                                        className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 whitespace-nowrap">
                                        ✕ voltar à lista
                                    </button>
                                )}
                            </div>
                        )}
                        {achados && (
                            <div className="rounded-lg bg-slate-100 dark:bg-slate-700/50 px-2.5 py-1.5 text-[10px] text-slate-600 dark:text-slate-300 leading-snug">
                                {/* Recorte DITO, sempre: "12 de 40" é resposta, "12" é armadilha. */}
                                🔎 Busca no banco por <strong>"{achados.termo}"</strong>:{' '}
                                {achados.total === 0 ? 'nenhuma conversa encontrada' : (
                                    <>{achados.truncado ? `mostrando ${achados.conversas.length} de ${achados.total}` : `${achados.total} conversa(s)`}</>
                                )}.
                                {/* ⚠️ Dizer o que ela NÃO faz é parte da resposta: fingir
                                    que procurou no texto faria concluir que a frase não
                                    existe na carteira. */}
                                <span className="block text-slate-500 dark:text-slate-400">
                                    Procura por <strong>número</strong> e <strong>nome</strong> — não procura dentro do
                                    texto das mensagens.
                                    {achados.contatosTruncados && ' A carteira de contatos passou do teto da varredura: se o nome não apareceu, procure pelo número, que é completo.'}
                                </span>
                            </div>
                        )}
                        {/* 🔔 Avisos: quem decide o que falta é o núcleo
                            `faltaNosAvisos` — as TRÊS camadas numa pergunta só.
                            🚨 Antes a barra olhava permissão e som; com os dois
                            ligados ela sumia, e o botão que liga o PUSH morava
                            dentro dela. A ação desaparecia junto com o alerta, e o
                            aviso no celular não tinha como ser ligado (print do
                            Paulo, 17/08). */}
                        {avisoDoTopo.falta && (
                            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1.5">
                                <p className="text-[10px] text-amber-800 dark:text-amber-300 leading-snug">
                                    {avisoDoTopo.texto}
                                </p>
                                {avisoDoTopo.acao && (
                                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                                        {avisoDoTopo.acao}
                                    </p>
                                )}
                                {permissaoAviso === 'nao-pedida' && (
                                    <button onClick={pedirPermissaoAviso}
                                        className="mt-1 text-[10px] font-bold px-2 py-1 rounded bg-[#0e3bfa] hover:bg-[#091d8d] text-white">
                                        🔔 Ligar avisos
                                    </button>
                                )}
                                {avisoDoTopo.oferecerPush && (
                                    <button onClick={ligarPush}
                                        className="mt-1 ml-1 text-[10px] font-bold px-2 py-1 rounded bg-[#0e3bfa] hover:bg-[#091d8d] text-white">
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
                        {/* Lista cortada SEMPRE diz (farol honesto): sem isto, "Todas · 2000"
                            seria lido como a carteira inteira. */}
                        {/* ⚠️ A frase MUDOU com o teto (25/08): ela dizia "a busca acha só
                            o que está na lista", e isso deixou de ser verdade — dizer que
                            não dá, quando dá, faz a pessoa não procurar. Agora ela aponta
                            a porta, que é o que o teto menor exige em troca. */}
                        {limiteConversas != null && !achados && (
                            <p className="text-[10px] text-amber-700 dark:text-amber-400">
                                ⚠️ Mostrando as {limiteConversas} conversas mais recentes — a página abre rápido assim.
                                Para as outras, digite no campo acima e use <strong>🔎 Procurar no banco inteiro</strong>.
                            </p>
                        )}
                        {erroBusca && (
                            <p className="text-[10px] text-red-700 dark:text-red-400">⛔ {erroBusca}</p>
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
                                                {c.canal === 'instagram' && <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-fuchsia-100 dark:bg-fuchsia-900/40 text-fuchsia-700 dark:text-fuchsia-300">📷 Instagram</span>}
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
                                        {sel.canal === 'instagram' ? '📷 DM do Instagram' : formatarNumeroBr(sel.numero)} · {rotuloCurtoFila(sel.fila)}
                                        {sel.protocolo ? ` · protocolo ${sel.protocolo}` : ''}
                                        {multiCanal && sel.canal !== 'instagram' ? ` · 📞 ${rotuloCanal(sel.canalId)}` : ''}
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

                            {/* 🔍 Busca dentro da conversa — filtra os balões carregados. */}
                            <div className="px-3 pt-1.5 flex items-center gap-1.5">
                                <input value={buscaThread} onChange={(e) => setBuscaThread(e.target.value)}
                                    placeholder="🔍 Buscar nesta conversa…"
                                    className="flex-1 px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200" />
                                {buscaThread.trim() && (
                                    <>
                                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                            {filtrarMensagensDaThread(thread, buscaThread).length} de {thread.length}
                                        </span>
                                        <button onClick={() => setBuscaThread('')} className="text-slate-400 hover:text-slate-600 px-1 text-[11px]">✕</button>
                                    </>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1.5">
                                {/* ⬆️ O teto de 500 cortava a conversa CALADO: a pessoa rolava
                                    até o topo e concluía que o histórico não existia. Agora a
                                    parede DIZ que é parede e tem porta. */}
                                {!carregandoMsgs && temMaisAntigas && !buscaThread.trim() && (
                                    <div className="text-center pb-1">
                                        <button
                                            onClick={carregarAntigas}
                                            disabled={carregandoAntigas}
                                            className="text-[11px] font-semibold px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 btn-press whitespace-nowrap">
                                            {carregandoAntigas ? 'Carregando…' : '⬆️ Carregar mais antigas'}
                                        </button>
                                        <p className="text-[9px] text-slate-400 mt-0.5">
                                            Esta conversa tem mais histórico — a tela mostra {thread.length} mensagem(ns).
                                        </p>
                                    </div>
                                )}
                                {/* Índice construindo: a fatia veio SEM ORDEM, então paginar
                                    devolveria as mesmas linhas. Dizer é melhor que esconder. */}
                                {!carregandoMsgs && threadSemOrdem && (
                                    <p className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded px-2 py-1 text-center">
                                        ⚠️ O índice das mensagens ainda está sendo construído — esta conversa pode aparecer
                                        fora de ordem e não dá para carregar o histórico agora. Costuma levar alguns minutos.
                                    </p>
                                )}
                                {carregandoMsgs ? (
                                    <p className="text-xs text-slate-400 text-center mt-4">Carregando…</p>
                                ) : thread.length === 0 ? (
                                    <p className="text-xs text-slate-400 text-center mt-4">Nenhuma mensagem gravada nesta conversa.</p>
                                ) : filtrarMensagensDaThread(thread, buscaThread).length === 0 ? (
                                    <p className="text-xs text-slate-400 text-center mt-4">
                                        Nada com "{buscaThread}" nas mensagens carregadas desta conversa.
                                        {temMaisAntigas && ' Há histórico mais antigo ainda não carregado — limpe a busca e use ⬆️ Carregar mais antigas.'}
                                    </p>
                                ) : (
                                    filtrarMensagensDaThread(thread, buscaThread).map((m) => {
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
                                                        {m.midia?.link ? (
                                                            // Banner de fila: URL PÚBLICA nossa — abre direto, sem o
                                                            // clique de baixar da Meta (que nem se aplica aqui, não
                                                            // veio da Meta pra este app baixar).
                                                            <a href={m.midia.link} target="_blank" rel="noreferrer">
                                                                <img src={m.midia.link} alt="imagem" className="rounded-lg max-h-64 w-auto" />
                                                            </a>
                                                        ) : midias[m.id] ? (
                                                            midias[m.id].mime.startsWith('image/') ? (
                                                                <button type="button" onClick={() => setZoom({ url: midias[m.id].url, nome: m.midia?.nomeArquivo || 'imagem' })}
                                                                    className="block cursor-zoom-in" title="ampliar">
                                                                    <img src={midias[m.id].url} alt={m.midia?.nomeArquivo || 'imagem'}
                                                                        className="rounded-lg max-h-64 w-auto" />
                                                                </button>
                                                            ) : midias[m.id].mime.startsWith('audio/') ? (
                                                                <audio controls src={midias[m.id].url} className="max-w-full" />
                                                            ) : midias[m.id].mime.startsWith('video/') ? (
                                                                <video controls src={midias[m.id].url} className="rounded-lg max-h-64" />
                                                            ) : (
                                                                // Sem target="_blank": com o atributo download o clique
                                                                // BAIXA na hora — aba nova com blob: é o que o webview
                                                                // do Teams manda pro sistema (o erro do "novo app").
                                                                <a href={midias[m.id].url}
                                                                    download={m.midia?.nomeArquivo || 'anexo'}
                                                                    className="text-[11px] font-semibold underline">
                                                                    {midia} — baixar
                                                                </a>
                                                            )
                                                        ) : (
                                                            <button
                                                                onClick={() => verMidia(m)}
                                                                disabled={m.midia?.baixada === false || Boolean(midiaCarregando[m.id])}
                                                                title={m.midia?.baixada === false ? 'ainda não baixado da Meta' : 'abrir anexo'}
                                                                className="text-[11px] font-semibold underline disabled:no-underline disabled:opacity-60">
                                                                {midiaCarregando[m.id] ? '⏳ abrindo…' : midia}
                                                            </button>
                                                        )}
                                                        {midiaErro[m.id] && <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">{midiaErro[m.id]}</p>}
                                                    </div>
                                                )}
                                                {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
                                                {/* 📎 Anexo que ficou no backup (decisão de 18/08: texto no app,
                                                    arquivo no SharePoint). Sem esta linha a mensagem viraria um
                                                    "<anexado: x.pdf>" enigmático e alguém procuraria no app um
                                                    arquivo que ele nunca teve. */}
                                                {(m as any).anexoNoBackup && (
                                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                        📎 anexo <strong>não importado</strong> — está no backup da Ultra Fox
                                                        guardado no SharePoint
                                                        {(m as any).anexoNoBackup.arquivo
                                                            ? <> (pasta <code>{(m as any).anexoNoBackup.pasta || '_files'}</code>, arquivo <code>{(m as any).anexoNoBackup.arquivo}</code>)</>
                                                            : <> (pasta <code>{(m as any).anexoNoBackup.pasta || '_files'}</code> — o export não trouxe o nome do arquivo)</>}
                                                    </p>
                                                )}
                                                {!m.texto && !midia && (
                                                    <p className="italic text-slate-400 text-[11px]">
                                                        {/* A MESMA régua que o backend usa pra decidir de quem é a
                                                            falha de entrega. Tinha aqui uma cópia (`saida` + sem
                                                            conteúdo) — duas réguas pro mesmo fato divergem, e aqui
                                                            elas apareceriam LADO A LADO no mesmo balão: a linha
                                                            dizendo "de outra plataforma" e o erro logo abaixo
                                                            mandando o colaborador converter o arquivo. */}
                                                        {saiuPorOutraPlataforma(m as any)
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
                                {/* ⚡ As frases vêm da CONFIG (⚙️ → 🤖), não mais cravadas aqui —
                                    era a pendência 🟡 do de-para (pergunta 2). Lista vazia é
                                    escolha do admin: os chips somem sem quebrar nada. */}
                                {janela?.aberta && !conduzidaPorOutro && respostasRapidas.length > 0 && (
                                    <div className="flex gap-1.5 flex-wrap mb-1.5">
                                        {respostasRapidas.map((q) => (
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
                                        {/* 📷 DM do Instagram: esta fase responde TEXTO — áudio e
                                            anexo saem por outra API e ainda não foram construídos.
                                            Botão que não faz nada é pior que botão nenhum. */}
                                        {sel.canal !== 'instagram' && (
                                            <>
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
                                            </>
                                        )}
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
                                ) : sel.canal === 'instagram' ? (
                                    <div className="rounded-xl border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                                        📷 Janela do Instagram fechada — no Instagram <strong>não há template</strong>: aguarde o cliente escrever de novo (isso reabre a janela).
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
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">{sel.canal === 'instagram' ? '📷 DM do Instagram' : formatarNumeroBr(sel.numero)}</p>
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
                                    {sel.canal !== 'instagram' && (
                                        <div className="space-y-1">
                                            {sel.permissaoLigacao?.status === 'aceita' ? (
                                                <>
                                                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                                                        ✅ Ligações AUTORIZADAS pelo cliente
                                                        {sel.permissaoLigacao.expiraEm ? ` · até ${new Date(sel.permissaoLigacao.expiraEm).toLocaleDateString('pt-BR')}` : ''}
                                                    </p>
                                                    {/* 🚨 NADA DE BOTÃO DE LIGAR AQUI, e o motivo é a resposta da
                                                        Meta (24/08, código 131055): "Graph API calls are not
                                                        allowed for SIP enabled numbers". Em modo SIP a saída NÃO
                                                        sai por API — quem disca é o tronco. Botão que a Meta
                                                        recusa por desenho é botão que não faz nada. */}
                                                    {/* ⚠️ A frase diz o ESTADO MEDIDO, não a promessa. Até 25/08
                                                        ela dizia "falta a primeira ligação RECEBIDA" — o que fazia
                                                        parecer que bastava alguém ligar. A medição desmentiu: com o
                                                        gravador do SBC PROVADO ligado, a chamada das 14h52 (dentro
                                                        da janela) saiu "Não atendida" no celular e o tronco não
                                                        registrou CDR nem INVITE em três conferências seguidas. Ou
                                                        seja: a Meta ACEITA a chamada e NÃO a entrega no tronco.
                                                        Mandar esperar a primeira ligação seria mandar esperar o que
                                                        não vai acontecer sozinho — quem destrava é o chamado. */}
                                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                                        📞 A ligação de saída sai pelo <strong>tronco SIP</strong> (ramal 221 no HitPhone),
                                                        não por aqui — a Meta recusa chamada por API em número SIP.
                                                        <span className="block text-red-600 dark:text-red-400">
                                                            🛑 Ligação ainda NÃO funciona nos dois sentidos: medido em 25/08, a Meta aceita
                                                            a chamada e não entrega no nosso tronco (sem INVITE, sem CDR) — chamado aberto com ela.
                                                            Fale por mensagem enquanto isso.
                                                        </span>
                                                    </p>
                                                </>
                                            ) : sel.permissaoLigacao?.status === 'recusada' ? (
                                                <p className="text-[10px] text-red-500">🚫 O cliente recusou ligações — dá pra pedir de novo.</p>
                                            ) : sel.permissaoLigacao?.status === 'pendente' ? (
                                                <p className="text-[10px] text-amber-600 dark:text-amber-400">☎️ Pedido enviado — aguardando o cliente tocar em “Permitir”.</p>
                                            ) : null}
                                            {sel.permissaoLigacao?.status !== 'aceita' && (
                                                <button onClick={acaoPermissaoLigacao}
                                                    className="w-full text-left text-[11px] px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
                                                    ☎️ Pedir permissão de ligação
                                                </button>
                                            )}
                                            {permLigAviso && <p className="text-[10px] text-amber-600 dark:text-amber-400">{permLigAviso}</p>}
                                            {permLigErro && (
                                                <div className="text-[11px] font-semibold rounded px-2 py-1.5 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 space-y-1.5">
                                                    <p>⛔ {permLigErro}</p>
                                                    {permLigConducao && (
                                                        <button onClick={() => { acaoAssumir(); setPermLigErro(null); setPermLigConducao(false); }}
                                                            className="w-full px-2 py-1 rounded bg-[#0e3bfa] text-white btn-press">
                                                            🙋 Assumir a conversa e tentar de novo
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
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
