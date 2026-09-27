// ============================================================================
// sefaz-backend/graph-remetente.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Quem aparece como REMETENTE do e-mail de imposto ao cliente.
//
// Paulo, 05/08: *"o e-mail enviado seja de cada remetente = colaborador e não
// somente o meu e-mail, pois o cliente tende a entender que eu que enviei e
// acaba me questionando"*.
//
// Até aqui todo envio pelo servidor saía de uma caixa fixa (GRAPH_REMETENTE,
// junior@) — então o cliente respondia ao Paulo um assunto que era do
// colaborador da carteira. Agora sai da caixa de QUEM CLICOU, e a resposta do
// cliente volta pra pessoa certa.
//
// GUARDA: não se envia "como" qualquer endereço. Só caixas do próprio tenant
// (domínio do escritório) — um login com e-mail pessoal cairia no remetente
// padrão em vez de virar uma tentativa de falsificar origem, que o Graph
// recusaria de qualquer jeito.
// ============================================================================

const DOMINIO_PADRAO = 'spassessoriacontabil.com.br';

/** Domínios cujas caixas o app pode usar como remetente. */
export function dominiosPermitidos(env = process.env) {
    const extra = String(env.GRAPH_DOMINIOS_REMETENTE || '')
        .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    return [...new Set([DOMINIO_PADRAO, ...extra])];
}

/**
 * Escolhe a caixa de origem do envio.
 *
 * @param {object} p
 * @param {string} [p.emailColaborador] e-mail de quem clicou (req.user.email)
 * @param {string} [p.padrao]           GRAPH_REMETENTE (fallback institucional)
 * @param {string[]} [p.dominios]       domínios aceitos
 * @returns {{remetente: string, fonte: 'colaborador'|'padrao', motivo: string|null}}
 */
export function escolherRemetente({ emailColaborador, padrao, dominios } = {}) {
    const lista = (dominios && dominios.length ? dominios : [DOMINIO_PADRAO])
        .map((d) => String(d || '').trim().toLowerCase()).filter(Boolean);
    const fallback = String(padrao || '').trim().toLowerCase();
    const email = String(emailColaborador || '').trim().toLowerCase();

    if (!email || !email.includes('@')) {
        return { remetente: fallback, fonte: 'padrao', motivo: 'sessão sem e-mail identificado' };
    }
    const dominio = email.split('@')[1] || '';
    if (!lista.includes(dominio)) {
        return {
            remetente: fallback,
            fonte: 'padrao',
            motivo: `o e-mail do colaborador (${dominio}) não é uma caixa do escritório`,
        };
    }
    return { remetente: email, fonte: 'colaborador', motivo: null };
}

/**
 * O erro do Graph é "essa caixa não existe / não posso enviar por ela"?
 *
 * Quando é, o envio deve ser REFEITO pela caixa institucional em vez de
 * falhar: a guia do cliente não pode ficar presa porque o colaborador ainda
 * não tem mailbox. Erro de outra natureza (anexo grande, destinatário
 * inválido, credencial) NÃO entra aqui — repetir só duplicaria a mensagem.
 */
export function ehErroDeCaixaInexistente(erro) {
    const t = String(erro || '').toLowerCase();
    if (!t) return false;
    return t.includes('errorinvaliduser')
        || t.includes('resource could not be discovered')
        || t.includes('mailboxnotenabledforrestapi')
        || t.includes('object was not found')
        || (t.includes('404') && t.includes('sendmail'));
}
