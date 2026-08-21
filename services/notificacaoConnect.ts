// ============================================================================
// services/notificacaoConnect.ts — REGRAS da notificação de mensagem nova
// ----------------------------------------------------------------------------
// Paulo, 16/08: *"quanto mais notificação melhor, evita desculpa que o
// colaborador não viu, não recebeu, e o cliente reclama"*. A Ultra Fox faz
// som + pop-up + notificação no celular; aqui vão os TRÊS.
//
// A parte PURA (o que notificar e o que NÃO) fica aqui, porque é onde estão
// as decisões que estragam tudo se erradas:
//
// - **Nunca notificar o que EU acabei de mandar** (mensagem de saída) — a
//   lista se atualiza sozinha a cada 30s e a própria resposta voltaria como
//   "mensagem nova".
// - **Nunca notificar duas vezes a mesma mensagem.** A lista é relida em
//   ciclo; sem idempotência por id, cada atualização repetiria os pop-ups
//   antigos e a pessoa desligaria tudo — matando a notificação que importa.
// - **A conversa ABERTA na tela não notifica.** A pessoa está olhando; um
//   pop-up do que ela acabou de ler é o ruído que ensina a ignorar.
// - **Só notifica o que a pessoa PODE atender.** O recorte de fila é do
//   backend (a lista já vem filtrada), então notificar tudo que chega na
//   lista é justamente o certo — mas a régua fica escrita pra não se perder.
// - **A primeira carga NÃO notifica.** Abrir o app e receber 20 pop-ups do
//   que já estava lá é o jeito mais rápido de a equipe desligar o recurso.
// ============================================================================

export interface ConversaParaAviso {
    numero: string;
    nome: string | null;
    naoLidas: number;
    ultimaMensagem: { resumo: string; direcao: string; em: string } | null;
}

export interface AvisoNovaMensagem {
    numero: string;
    titulo: string;
    corpo: string;
    /** Chave de idempotência — o mesmo momento não notifica duas vezes. */
    chave: string;
}

/**
 * Compara a lista nova com o que já foi avistado e devolve o que MERECE
 * aviso. `jaAvisados` é o mapa {numero: chave} do que já apitou.
 */
export function avisosDeNovasMensagens(p: {
    conversas: ConversaParaAviso[];
    jaAvisados: Record<string, string>;
    /** Conversa aberta na tela agora — não apita. */
    abertaNumero?: string | null;
    /** Primeira carga da sessão: aprende o estado SEM apitar. */
    primeiraCarga?: boolean;
    nomeExibicao?: (c: ConversaParaAviso) => string;
}): { avisos: AvisoNovaMensagem[]; novoEstado: Record<string, string> } {
    const nome = p.nomeExibicao || ((c: ConversaParaAviso) => c.nome || c.numero);
    const novoEstado: Record<string, string> = { ...p.jaAvisados };
    const avisos: AvisoNovaMensagem[] = [];

    for (const c of p.conversas) {
        const ultima = c.ultimaMensagem;
        // Sem mensagem, ou a última é NOSSA: nada a avisar.
        if (!ultima || ultima.direcao !== 'entrada') continue;
        const chave = `${c.numero}|${ultima.em}`;
        const mudou = novoEstado[c.numero] !== chave;
        novoEstado[c.numero] = chave;

        if (p.primeiraCarga) continue;               // aprende, não apita
        if (!mudou) continue;                        // já avisou esta mesma
        if (!(c.naoLidas > 0)) continue;             // já lida em outro lugar
        if (p.abertaNumero && c.numero === p.abertaNumero) continue;  // está na tela

        avisos.push({
            numero: c.numero,
            titulo: `💬 ${nome(c)}`,
            corpo: (ultima.resumo || 'nova mensagem').slice(0, 120),
            chave,
        });
    }
    return { avisos, novoEstado };
}

/** Título da aba com o contador — o pop-up some, o título fica. */
export function tituloComContador(naoLidas: number, base = 'SP Connect'): string {
    return naoLidas > 0 ? `(${naoLidas}) ${base}` : base;
}

export type EstadoPermissao = 'concedida' | 'negada' | 'nao-pedida' | 'sem-suporte';

/** Estado da permissão de notificação do navegador (sem pedir nada). */
export function estadoDaPermissao(deps?: { permission?: string; temApi?: boolean }): EstadoPermissao {
    const temApi = deps?.temApi ?? (typeof window !== 'undefined' && 'Notification' in window);
    if (!temApi) return 'sem-suporte';
    const p = deps?.permission ?? (typeof Notification !== 'undefined' ? Notification.permission : 'default');
    if (p === 'granted') return 'concedida';
    if (p === 'denied') return 'negada';
    return 'nao-pedida';
}

/**
 * O que a tela diz em cada estado — recusa sempre com CAMINHO.
 * `emIframe` muda o conselho: dentro do Teams não há cadeado nem barra de
 * endereço (Paulo, 21/08), e o pop-up do navegador não é do nosso controle
 * lá — o caminho honesto é o som (que funciona) e o app fora do Teams.
 */
export function textoDaPermissao(estado: EstadoPermissao, emIframe = false): { texto: string; acao: string | null } {
    switch (estado) {
        case 'concedida':
            return { texto: '🔔 Avisos ligados neste navegador.', acao: null };
        case 'negada':
            if (emIframe) {
                return {
                    texto: '🔕 Dentro do Teams o pop-up de mensagem nova não aparece.',
                    acao: 'O som de mensagem nova continua tocando aqui. Para pop-up e push, abra o SP Connect direto no navegador (mesmo endereço, fora do Teams).',
                };
            }
            return {
                texto: '🔕 Este navegador BLOQUEOU os avisos — mensagem nova não vai aparecer na tela.',
                // O "não" fica guardado: sem dizer onde reverter, a pessoa
                // acha que o app não avisa e o cliente é quem reclama.
                acao: 'Clique no cadeado 🔒 ao lado do endereço → Notificações → Permitir, e recarregue.',
            };
        case 'sem-suporte':
            return { texto: '🔕 Este navegador não mostra avisos.', acao: 'O som continua funcionando; para o pop-up, use um navegador atualizado.' };
        default:
            if (emIframe) {
                return {
                    texto: '🔔 Avisos no Teams dependem da permissão do Teams.',
                    acao: 'Clique em "Ligar avisos" — se o Teams não perguntar, o som continua avisando; para pop-up e push, use o SP Connect no navegador.',
                };
            }
            return { texto: '🔔 Ligue os avisos para não depender de olhar a tela.', acao: 'Clique em "Ligar avisos" (o navegador vai perguntar).' };
    }
}

/**
 * 🚨 O QUE FALTA NOS AVISOS — considerando as TRÊS camadas.
 *
 * Nasceu de um defeito real (17/08, print do Paulo): a barra de aviso só
 * olhava permissão e som. Com os dois ligados ela sumia — e o botão que liga
 * o **push do celular** morava DENTRO dela. Resultado: a terceira camada não
 * tinha como ser ligada, e nada na tela dizia por quê. A ação desapareceu
 * junto com o alerta.
 *
 * Por isso a pergunta agora é uma só e mora aqui, testável: *"falta alguma
 * camada?"*. E ela é ordenada pelo que BLOQUEIA mais — permissão negada
 * impede tudo; push desligado só impede o app fechado.
 */
export function faltaNosAvisos(p: {
    permissao: EstadoPermissao;
    somOk: boolean;
    pushDisponivel: boolean;
    pushLigado: boolean;
    /** Rodando emoldurado (Teams)? O conselho de permissão muda — ver textoDaPermissao. */
    emIframe?: boolean;
}): { falta: boolean; texto: string; acao: string | null; oferecerPush: boolean } {
    // Sem permissão (ou negada/sem suporte) manda: é o que impede o pop-up.
    if (p.permissao !== 'concedida') {
        const t = textoDaPermissao(p.permissao, Boolean(p.emIframe));
        return { falta: true, texto: t.texto, acao: t.acao, oferecerPush: false };
    }
    if (!p.somOk) {
        return {
            falta: true,
            texto: '🔔 Avisos ligados — falta liberar o SOM.',
            acao: 'O navegador só libera som depois do primeiro clique nesta aba.',
            // Mesmo faltando som, se o push estiver disponível e desligado o
            // botão dele aparece: são camadas independentes, e esconder uma
            // atrás da outra foi exatamente o defeito.
            oferecerPush: p.pushDisponivel && !p.pushLigado,
        };
    }
    if (p.pushDisponivel && !p.pushLigado) {
        return {
            falta: true,
            texto: '🔔 Som e pop-up ligados. Falta o aviso no CELULAR — é o que avisa com o app fechado.',
            acao: null,
            oferecerPush: true,
        };
    }
    // Tudo ligado: nada de ruído fixo na tela.
    return { falta: false, texto: '', acao: null, oferecerPush: false };
}

/**
 * Preferências por pessoa. Tudo LIGADO por padrão — a decisão do Paulo é
 * "quanto mais notificação melhor"; quem se incomodar desliga, e aí é
 * escolha dela, não omissão do app.
 */
export interface PreferenciasAviso {
    som: boolean;
    popup: boolean;
    push: boolean;
    /** Push no celular fora do expediente (o resto avisa sempre). */
    pushForaDoExpediente: boolean;
}

export const PREFERENCIAS_PADRAO: PreferenciasAviso = {
    som: true,
    popup: true,
    push: true,
    // Nasce DESLIGADO por uma razão prática: celular apitando de madrugada
    // faz a pessoa desligar TUDO — e aí o app perde também o aviso do
    // horário comercial, que é o que o Paulo quer garantir. Quem precisar
    // de 24h liga na tela.
    pushForaDoExpediente: false,
};

export function lerPreferencias(bruto: unknown): PreferenciasAviso {
    const p = (bruto && typeof bruto === 'object' ? bruto : {}) as Partial<PreferenciasAviso>;
    return {
        som: typeof p.som === 'boolean' ? p.som : PREFERENCIAS_PADRAO.som,
        popup: typeof p.popup === 'boolean' ? p.popup : PREFERENCIAS_PADRAO.popup,
        push: typeof p.push === 'boolean' ? p.push : PREFERENCIAS_PADRAO.push,
        pushForaDoExpediente: typeof p.pushForaDoExpediente === 'boolean'
            ? p.pushForaDoExpediente : PREFERENCIAS_PADRAO.pushForaDoExpediente,
    };
}
