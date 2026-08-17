// ============================================================================
// sefaz-backend/whatsapp-canais.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// SEGUNDO NÚMERO / SEGUNDA WABA (Paulo, 16/08: "deixar o app apto"). Hoje o
// escritório tem UM número; este módulo é o que permite ligar o segundo sem
// refazer o app — e sem quebrar nada enquanto ele não existe.
//
// DECISÕES QUE MANDAM:
// - **O canal de hoje continua vindo do ENV e é o PADRÃO.** Zero migração,
//   zero cadastro obrigatório: sem canal extra cadastrado, o app se comporta
//   exatamente como antes.
// - **A ENTRADA roteia pelo `phone_number_id` do PRÓPRIO PAYLOAD** (a Meta
//   diz em qual número a mensagem caiu). É FONTE, não dedução — deduzir pelo
//   destinatário seria adivinhar.
// - **Mensagem antiga sem `canalId` é do canal PADRÃO — e isso é FATO, não
//   suposição**: até o 2º número existir, só havia um. O carimbo passa a
//   existir daqui pra frente; o histórico se lê pela regra, que fica escrita.
// - **Número desconhecido NÃO é descartado nem atribuído ao padrão.** Um
//   `phone_number_id` que não está no catálogo é evento de OUTRA conta (ou
//   canal novo que ninguém cadastrou): entra NOMEADO, para alguém decidir.
//   Jogar no padrão misturaria conversa de dois números na mesma caixa.
// - **Token do canal extra NUNCA fica no Firestore.** O cadastro guarda o
//   NOME da variável/segredo; o valor vive no Cloud Run, como o do canal de
//   hoje (a régua do cofre: leva-se a operação, nunca a chave).
// ============================================================================

export const CANAL_PADRAO_ID = 'principal';

/**
 * Canal padrão a partir do ENV (o de hoje). `pronto:false` quando falta
 * credencial — o painel mostra o motivo em vez de fingir que existe.
 */
export function canalDoEnv(env = process.env) {
    const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    return {
        id: CANAL_PADRAO_ID,
        rotulo: String(env.WHATSAPP_ROTULO || 'Número principal').trim(),
        numeroExibicao: String(env.WHATSAPP_NUMERO_EXIBICAO || '').trim() || null,
        phoneNumberId: phoneNumberId || null,
        wabaId: String(env.WHATSAPP_WABA_ID || '').trim() || null,
        // O canal do env usa a credencial padrão; canal extra diz QUAL env
        // guarda a dele (o valor nunca passa pelo banco).
        envToken: 'WHATSAPP_CLOUD_TOKEN',
        origem: 'env',
        pronto: Boolean(phoneNumberId && String(env.WHATSAPP_CLOUD_TOKEN || '').trim()),
    };
}

/** Normaliza um canal EXTRA vindo do cadastro (`whatsapp_canais`). */
export function normalizarCanalCadastrado(id, d = {}) {
    const phoneNumberId = String(d.phoneNumberId || '').trim();
    return {
        id: String(id),
        rotulo: String(d.rotulo || id).trim(),
        numeroExibicao: String(d.numeroExibicao || '').trim() || null,
        phoneNumberId: phoneNumberId || null,
        wabaId: String(d.wabaId || '').trim() || null,
        envToken: String(d.envToken || '').trim() || null,
        origem: 'cadastro',
        ativo: d.ativo !== false,
        // `pronto` aqui responde pelo CADASTRO; se o token existe no Cloud
        // Run, só a rota sabe (ela injeta o env na hora).
        pronto: Boolean(phoneNumberId && String(d.envToken || '').trim()),
    };
}

/**
 * Catálogo completo: o padrão do env + os cadastrados. Canal cadastrado que
 * repita o `phoneNumberId` do padrão é DUPLICATA — vem marcado, nunca
 * silenciosamente ignorado (dois canais no mesmo número roteariam ao acaso).
 */
export function montarCatalogoCanais({ env = process.env, cadastrados = [] } = {}) {
    const padrao = canalDoEnv(env);
    const extras = [];
    const conflitos = [];
    const vistos = new Set([padrao.phoneNumberId].filter(Boolean));
    for (const c of cadastrados) {
        const canal = normalizarCanalCadastrado(c.id, c.dados || c);
        if (canal.phoneNumberId && vistos.has(canal.phoneNumberId)) {
            conflitos.push({ id: canal.id, phoneNumberId: canal.phoneNumberId, motivo: 'já existe outro canal com este número' });
            continue;
        }
        if (canal.phoneNumberId) vistos.add(canal.phoneNumberId);
        extras.push(canal);
    }
    const canais = [padrao, ...extras];
    return {
        canais,
        conflitos,
        // `multiCanal` decide se a TELA mostra seletor: com um número só,
        // seletor é clique a mais por nada.
        multiCanal: canais.filter((c) => c.origem === 'env' || c.ativo).length > 1,
        padraoId: padrao.id,
    };
}

/**
 * De qual canal veio o evento? Roteia pelo `phone_number_id` que a Meta
 * mandou. Sem o campo (payload antigo/parcial) o canal é o PADRÃO — não é
 * chute: enquanto existir um número só, é o único que pode ter recebido.
 * Número que não está no catálogo vira `desconhecido` NOMEADO.
 */
export function canalDoEvento(catalogo, phoneNumberId) {
    const pnid = String(phoneNumberId || '').trim();
    if (!pnid) return { canalId: catalogo.padraoId, conhecido: true, motivo: 'evento sem phone_number_id — atribuído ao canal padrão' };
    const achado = catalogo.canais.find((c) => c.phoneNumberId === pnid);
    if (achado) return { canalId: achado.id, conhecido: true, motivo: null };
    return {
        canalId: null,
        conhecido: false,
        phoneNumberId: pnid,
        motivo: `o número ${pnid} não está cadastrado como canal — a mensagem foi gravada, mas SEM canal (não vai pro padrão: misturaria conversas de números diferentes na mesma caixa)`,
    };
}

/** Canal de SAÍDA de uma conversa: o mesmo por onde o cliente falou. */
export function canalDaConversa(catalogo, conversa = {}) {
    const id = conversa.canalId || catalogo.padraoId;
    return catalogo.canais.find((c) => c.id === id) || catalogo.canais.find((c) => c.id === catalogo.padraoId) || null;
}

/**
 * Credenciais efetivas de um canal (o valor do token vem do ENV, sempre).
 * Canal sem token no Cloud Run devolve `pronto:false` com a env que falta —
 * "não configurado" sem dizer O QUE falta manda a pessoa adivinhar.
 */
export function credenciaisDoCanal(canal, env = process.env) {
    if (!canal) return { pronto: false, faltas: ['canal não encontrado'] };
    const token = String(env[canal.envToken || ''] || '').trim();
    const faltas = [];
    if (!canal.phoneNumberId) faltas.push('phoneNumberId do canal');
    if (!canal.envToken) faltas.push('nome da variável do token (envToken)');
    else if (!token) faltas.push(`a variável ${canal.envToken} no Cloud Run`);
    return {
        pronto: faltas.length === 0,
        faltas,
        cfg: { token, phoneNumberId: canal.phoneNumberId, wabaId: canal.wabaId },
    };
}

/** Validação do cadastro de canal novo (o que a rota recusa). */
export function validarCanal(d = {}) {
    const erros = [];
    const id = String(d.id || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{2,24}$/.test(id)) erros.push('id do canal: use 2 a 24 letras minúsculas, números ou hífen');
    if (id === CANAL_PADRAO_ID) erros.push(`"${CANAL_PADRAO_ID}" é o canal do ENV e não se cadastra aqui`);
    if (!/^\d{5,}$/.test(String(d.phoneNumberId || '').trim())) erros.push('phoneNumberId: só dígitos, como a Meta mostra no painel');
    if (!String(d.rotulo || '').trim()) erros.push('rótulo: como a equipe vai chamar este número');
    // O NOME da env é obrigatório e o VALOR nunca entra aqui.
    const envToken = String(d.envToken || '').trim();
    if (!/^[A-Z][A-Z0-9_]{5,60}$/.test(envToken)) erros.push('envToken: o NOME da variável do Cloud Run (ex.: WHATSAPP_CLOUD_TOKEN_2)');
    if (/^EA[A-Za-z0-9]{20,}/.test(envToken)) erros.push('envToken parece o TOKEN em si — aqui vai o NOME da variável; o valor fica só no Cloud Run');
    return erros.length ? { ok: false, erros } : { ok: true, id, envToken };
}
