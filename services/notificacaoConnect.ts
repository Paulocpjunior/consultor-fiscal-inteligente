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

/** O que a tela diz em cada estado — recusa sempre com CAMINHO. */
export function textoDaPermissao(estado: EstadoPermissao): { texto: string; acao: string | null } {
    switch (estado) {
        case 'concedida':
            return { texto: '🔔 Avisos ligados neste navegador.', acao: null };
        case 'negada':
            return {
                texto: '🔕 Este navegador BLOQUEOU os avisos — mensagem nova não vai aparecer na tela.',
                // O "não" fica guardado: sem dizer onde reverter, a pessoa
                // acha que o app não avisa e o cliente é quem reclama.
                acao: 'Clique no cadeado 🔒 ao lado do endereço → Notificações → Permitir, e recarregue.',
            };
        case 'sem-suporte':
            return { texto: '🔕 Este navegador não mostra avisos.', acao: 'O som continua funcionando; para o pop-up, use um navegador atualizado.' };
        default:
            return { texto: '🔔 Ligue os avisos para não depender de olhar a tela.', acao: 'Clique em "Ligar avisos" (o navegador vai perguntar).' };
    }
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
