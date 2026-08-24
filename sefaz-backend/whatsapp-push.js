// ============================================================================
// sefaz-backend/whatsapp-push.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// PUSH NO CELULAR com o app FECHADO — a última bloqueante do corte da Ultra
// Fox (Paulo, 16/08: "quanto mais notificação melhor, evita desculpa que o
// colaborador não viu").
//
// DECISÕES QUE MANDAM:
// - **O push respeita a FILA.** Quem não enxerga a conversa no inbox não
//   pode recebê-la no bolso: seria vazar conversa de cliente pra quem o
//   próprio app esconde. A régua é a MESMA do inbox (`conversaVisivel`), não
//   uma segunda cópia.
// - **Ninguém recebe push da própria mensagem** nem de conversa que ele
//   acabou de responder — o celular apitando com a própria voz é o tipo de
//   ruído que faz desinstalar.
// - **Fora do expediente o push é OPT-IN.** Celular apitando de madrugada
//   faz a pessoa desligar TUDO — e aí o app perde também o aviso do horário
//   comercial, que é justamente o que o Paulo quer garantir.
// - **Token que a Meta/FCM diz estar morto é REMOVIDO** (não fica tentando
//   pra sempre); qualquer outra falha é apenas registrada — token some por
//   troca de celular, e apagar por erro de rede tiraria o aviso de alguém
//   que está esperando.
// ============================================================================

import { filasVisiveis, conversaVisivel, dentroDoHorario, podeAtenderInstagram } from './whatsapp-atendimento.js';

/** Erros do FCM que significam "este token não existe mais". */
const TOKENS_MORTOS = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
]);

export function tokenMorreu(codigoErro) {
    return TOKENS_MORTOS.has(String(codigoErro || ''));
}

/**
 * Quem recebe o push de UMA conversa.
 * `usuarios` = [{uid, email, role, papelAtendimento, departamentos,
 * filasAtendimento, prefs, tokens[]}].
 * Devolve [{uid, tokens}] — e a razão de cada exclusão fica no `fora`, pra
 * o painel poder explicar "por que fulano não recebeu".
 */
export function destinatariosDoPush({
    usuarios = [], conversa = {}, autorDaMensagem = null, config = null, agora = new Date(),
}) {
    const alvos = [];
    const fora = [];
    const noExpediente = config?.horario ? dentroDoHorario(config.horario, agora) : true;

    for (const u of usuarios) {
        const prefs = u.prefs || {};
        const motivo = (m) => fora.push({ uid: u.uid, email: u.email || null, motivo: m });

        if (!(u.tokens || []).length) { motivo('sem celular registrado'); continue; }
        if (prefs.push === false) { motivo('push desligado por ele'); continue; }
        const veto = vetoDoAviso(u, { conversa, autorDaMensagem, config, noExpediente });
        if (veto) { motivo(veto); continue; }

        alvos.push({ uid: u.uid, email: u.email || null, tokens: [...new Set(u.tokens)] });
    }
    return { alvos, fora, noExpediente };
}

/**
 * As regras de AUDIÊNCIA que valem para QUALQUER aviso (push FCM ou Teams) —
 * uma régua só, senão o celular e o Teams avisariam pessoas diferentes da
 * mesma mensagem. Devolve o MOTIVO do veto, ou null quando pode avisar.
 */
function vetoDoAviso(u, { conversa, autorDaMensagem, config, noExpediente }) {
    const prefs = u.prefs || {};
    // A própria mensagem nunca volta como aviso.
    if (autorDaMensagem && u.email && u.email === autorDaMensagem) return 'é o autor da mensagem';
    // A MESMA régua do inbox — nunca uma segunda cópia.
    const filas = filasVisiveis({
        role: u.role, papelAtendimento: u.papelAtendimento,
        departamentos: u.departamentos || [], filasAtendimento: u.filasAtendimento || [],
    });
    if (!conversaVisivel(filas, conversa.fila || null)) return 'a conversa é de uma fila que ele não atende';
    // 📷 DM do Instagram é POR USUÁRIO (a mesma régua do inbox) — avisar
    // quem não pode abrir a conversa é convite pra um 403.
    if (conversa.canal === 'instagram' && !podeAtenderInstagram(config, u.email)) return 'o Instagram é atendido por lista restrita e ele não está nela';
    if (!noExpediente && prefs.pushForaDoExpediente !== true) return 'fora do expediente (aviso 24h desligado)';
    return null;
}

/**
 * 🔔 Quem recebe o aviso NATIVO DO TEAMS (Paulo, 23/08: "ativar popup de
 * notificações e audio de msg" dentro do Teams — o webview não deixa a página
 * mostrar popup do sistema; quem mostra é o PRÓPRIO Teams, via Graph).
 * Mesmas regras de audiência do push; o que muda é a porta: não exige token
 * FCM (o endereço é o e-mail do tenant) e o opt-out é `prefs.avisoTeams`.
 */
export function destinatariosDoAvisoTeams({
    usuarios = [], conversa = {}, autorDaMensagem = null, config = null, agora = new Date(),
}) {
    const alvos = [];
    const fora = [];
    const noExpediente = config?.horario ? dentroDoHorario(config.horario, agora) : true;
    for (const u of usuarios) {
        const motivo = (m) => fora.push({ uid: u.uid, email: u.email || null, motivo: m });
        if (!u.email) { motivo('sem e-mail no cadastro (o Teams é endereçado por e-mail do tenant)'); continue; }
        if ((u.prefs || {}).avisoTeams === false) { motivo('aviso no Teams desligado por ele'); continue; }
        const veto = vetoDoAviso(u, { conversa, autorDaMensagem, config, noExpediente });
        if (veto) { motivo(veto); continue; }
        alvos.push({ uid: u.uid, email: u.email });
    }
    return { alvos, fora, noExpediente };
}

/**
 * Corpo da notificação. O texto é CURTO de propósito: a prévia aparece na
 * tela bloqueada do celular, e conversa de cliente não precisa vazar
 * inteira ali.
 */
export function montarPushMensagem({ nomeContato, numero, resumo, canalRotulo }) {
    const quem = String(nomeContato || '').trim() || numero;
    return {
        titulo: `💬 ${quem}${canalRotulo ? ` · ${canalRotulo}` : ''}`,
        corpo: String(resumo || 'nova mensagem').slice(0, 100),
        // `tag` por conversa: 5 mensagens seguidas ATUALIZAM o mesmo aviso
        // em vez de encher a barra de notificações.
        tag: `spconnect-${numero}`,
        link: `/connect?conversa=${encodeURIComponent(numero)}`,
    };
}

/** Um token novo entra sem duplicar e a lista não cresce sem limite. */
export function registrarToken(tokensAtuais = [], token, limite = 10) {
    const t = String(token || '').trim();
    if (!t) return { ok: false, erro: 'token vazio' };
    const sem = (tokensAtuais || []).filter((x) => x !== t);
    // Mais recente primeiro: o corte por limite tira o celular mais velho.
    return { ok: true, tokens: [t, ...sem].slice(0, limite) };
}
