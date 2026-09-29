// ============================================================================
// ⏰ MENSAGEM AGENDADA E FOLLOW-UP — o núcleo puro (29/09)
// ----------------------------------------------------------------------------
// Paulo, 29/09, ao comparar com o Clerk Chat: "Concordo, vamos implementar
// 1, 2 e 3". O item 2 é este: "enviar às 08:00 de segunda" e "se o cliente
// não responder em N horas, lembrar".
//
// O que mora aqui é DECISÃO, sem banco e sem rede: validar o pedido, dizer o
// que fazer com cada agendamento no tick (esperar, enviar, dispensar, falhar)
// e formatar as linhas que a conversa mostra. Quem executa é a rota.
//
// ⚠️ REGRAS QUE NÃO SE CONTORNAM:
//  · Texto livre só sai com a janela de 24h ABERTA (regra da Meta). Um
//    agendamento para depois da janela FALHA nomeado ("janela fechada — use
//    template"), nunca sai como template escolhido por dedução.
//  · Follow-up é condicional: se o cliente escreveu DEPOIS do pedido, o
//    lembrete é DISPENSADO (mandar "ainda aguardo sua resposta" para quem
//    respondeu é o dano que a régua existe para evitar).
//  · Hora e fuso entram por parâmetro. Nada aqui lê o relógio.
// ============================================================================

export const COLECAO_AGENDAMENTOS = 'whatsapp_agendamentos';
export const TIPOS_AGENDAMENTO = ['mensagem', 'follow-up'];
export const STATUS_AGENDAMENTO = ['agendado', 'enviado', 'cancelado', 'dispensado', 'falhou'];
/** Teto de antecedência: 60 dias. Mais que isso é calendário, não conversa. */
export const MAX_DIAS_AGENDAMENTO = 60;
/** Follow-up: de 1 h a 14 dias. */
export const MAX_HORAS_FOLLOW_UP = 24 * 14;
/** Antecedência mínima: 1 min (menos que isso é "enviar agora"). */
export const MIN_ANTECEDENCIA_MS = 60 * 1000;
/** Quantos agendamentos um tick processa (o cron roda a cada 5 min). */
export const LOTE_TICK_AGENDA = 25;
export const FUSO_SP = 'America/Sao_Paulo';

const MS_HORA = 60 * 60 * 1000;

/**
 * Valida o pedido de agendamento e devolve o documento pronto para gravar.
 * `agora` é Date (injetado). `enviarEm` chega como ISO (o navegador manda
 * `new Date(input).toISOString()`). Para follow-up, `aposHoras` decide.
 */
export function validarAgendamento({ conversaId, texto, tipo = 'mensagem', enviarEm, aposHoras, agora, criadoPor } = {}) {
    const numero = String(conversaId || '').trim();
    if (!numero) return { ok: false, erro: 'conversa inválida' };
    const t = String(texto ?? '').trim();
    if (!t) return { ok: false, erro: 'Escreva a mensagem antes de agendar.' };
    if (t.length > 4096) return { ok: false, erro: 'Mensagem longa demais (máx. 4096 caracteres).' };
    if (!TIPOS_AGENDAMENTO.includes(tipo)) return { ok: false, erro: `tipo inválido (use ${TIPOS_AGENDAMENTO.join(' ou ')})` };
    const ref = agora instanceof Date ? agora.getTime() : Date.parse(agora || '');
    if (!Number.isFinite(ref)) return { ok: false, erro: 'agora inválido' };

    let quando;
    let horas = null;
    if (tipo === 'follow-up') {
        horas = Number(aposHoras);
        if (!Number.isFinite(horas) || horas < 1 || horas > MAX_HORAS_FOLLOW_UP || horas !== Math.floor(horas)) {
            return { ok: false, erro: `Follow-up: informe de 1 a ${MAX_HORAS_FOLLOW_UP} horas (inteiras).` };
        }
        quando = ref + horas * MS_HORA;
    } else {
        quando = Date.parse(enviarEm || '');
        if (!Number.isFinite(quando)) return { ok: false, erro: 'Informe a data e a hora do envio.' };
        if (quando - ref < MIN_ANTECEDENCIA_MS) return { ok: false, erro: 'A hora do envio já passou (ou é agora) — para enviar agora, use o botão Enviar.' };
        if (quando - ref > MAX_DIAS_AGENDAMENTO * 24 * MS_HORA) return { ok: false, erro: `Agendamento só até ${MAX_DIAS_AGENDAMENTO} dias à frente.` };
    }
    const criadoEm = new Date(ref).toISOString();
    const enviarEmIso = new Date(quando).toISOString();
    return {
        ok: true,
        agendamento: {
            id: idDoAgendamento(numero, enviarEmIso),
            conversaId: numero,
            tipo,
            texto: t,
            enviarEm: enviarEmIso,
            aposHoras: horas,
            status: 'agendado',
            criadoEm,
            criadoPor: criadoPor || null,
            tentativas: 0,
            ultimoErro: null,
            enviadoEm: null,
            messageId: null,
            desfecho: null,
        },
    };
}

/** Id determinístico: um agendamento por conversa por minuto de envio. */
export function idDoAgendamento(conversaId, enviarEmIso) {
    const carimbo = String(enviarEmIso).replace(/[^0-9]/g, '').slice(0, 12); // AAAAMMDDHHMM
    return `ag_${String(conversaId).replace(/[^0-9A-Za-z_]/g, '')}_${carimbo}`;
}

/** A janela de 24h da conversa está aberta em `agora`? */
export function janelaAberta(conversa, agora) {
    const ate = Date.parse(conversa?.janela24hAte || '');
    const ref = agora instanceof Date ? agora.getTime() : typeof agora === 'number' ? agora : Date.parse(agora || '');
    return Number.isFinite(ate) && Number.isFinite(ref) && ate > ref;
}

/**
 * O que o tick faz com ESTE agendamento agora. Puro: lê o doc e a conversa.
 *  · 'nada'      — já saiu, foi cancelado etc.
 *  · 'esperar'   — ainda não é hora
 *  · 'dispensar' — follow-up cujo cliente já respondeu, ou conversa encerrada
 *  · 'falhar'    — não dá para enviar (janela fechada, canal Instagram sem janela)
 *  · 'enviar'    — manda
 */
export function decidirAgendamento(ag, conversa, agora) {
    if (!ag || ag.status !== 'agendado') return { acao: 'nada', motivo: `status ${ag?.status || '?'}` };
    const ref = agora instanceof Date ? agora.getTime() : Date.parse(agora || '');
    const quando = Date.parse(ag.enviarEm || '');
    if (!Number.isFinite(quando)) return { acao: 'falhar', motivo: 'enviarEm ilegível' };
    if (quando > ref) return { acao: 'esperar', motivo: 'ainda não é hora' };

    if (ag.tipo === 'follow-up') {
        const ult = conversa?.ultimaMensagem;
        const emCliente = ult?.direcao === 'entrada' ? Date.parse(ult.em || '') : NaN;
        const criado = Date.parse(ag.criadoEm || '');
        if (Number.isFinite(emCliente) && Number.isFinite(criado) && emCliente > criado) {
            return { acao: 'dispensar', motivo: 'cliente-respondeu' };
        }
        if (conversa?.status === 'resolvida') return { acao: 'dispensar', motivo: 'conversa-encerrada' };
    }
    if (!janelaAberta(conversa, ref)) {
        return {
            acao: 'falhar',
            motivo: 'janela-fechada',
            detalhe: 'A janela de 24h fechou antes da hora do envio — texto livre não sai. Envie por template aprovado, ou aguarde o cliente escrever.',
        };
    }
    return { acao: 'enviar', motivo: 'na hora, janela aberta' };
}

/** `DD/MM HH:MM` em São Paulo — a hora do escritório, nunca a do navegador. */
export function formatarQuando(iso, fuso = FUSO_SP) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '?';
    const p = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date(t)).reduce((acc, x) => ({ ...acc, [x.type]: x.value }), {});
    return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/** A nota interna que entra na conversa quando alguém agenda. */
export function notaDoAgendamento(ag, fuso = FUSO_SP) {
    const quem = ag.criadoPor ? String(ag.criadoPor).split('@')[0] : 'alguém';
    if (ag.tipo === 'follow-up') {
        return `⏰ Follow-up agendado por ${quem}: se o cliente não responder até ${formatarQuando(ag.enviarEm, fuso)} (${ag.aposHoras} h), sai: "${String(ag.texto).slice(0, 120)}"`;
    }
    return `⏰ Mensagem agendada por ${quem} para ${formatarQuando(ag.enviarEm, fuso)}: "${String(ag.texto).slice(0, 120)}"`;
}

/** A nota interna do desfecho que NÃO foi envio (dispensa/falha). */
export function notaDoDesfecho(ag, decisao, fuso = FUSO_SP) {
    const rotulo = ag.tipo === 'follow-up' ? 'Follow-up' : 'Mensagem agendada';
    if (decisao.acao === 'dispensar') {
        const por = decisao.motivo === 'cliente-respondeu' ? 'o cliente respondeu antes' : 'a conversa foi encerrada';
        return `⏰ ${rotulo} de ${formatarQuando(ag.enviarEm, fuso)} dispensado: ${por}.`;
    }
    return `⏰ ${rotulo} de ${formatarQuando(ag.enviarEm, fuso)} NÃO saiu: ${decisao.detalhe || decisao.motivo}`;
}

/** Só o que a tela mostra de um agendamento. */
export function resumoDoAgendamento(ag) {
    return {
        id: ag.id, tipo: ag.tipo, texto: ag.texto, enviarEm: ag.enviarEm, aposHoras: ag.aposHoras ?? null,
        status: ag.status, criadoPor: ag.criadoPor || null, criadoEm: ag.criadoEm || null,
        desfecho: ag.desfecho || null, ultimoErro: ag.ultimoErro || null,
    };
}
