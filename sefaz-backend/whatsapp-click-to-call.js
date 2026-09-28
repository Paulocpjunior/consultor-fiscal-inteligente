// ============================================================================
// sefaz-backend/whatsapp-click-to-call.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// ☎️ A SAÍDA DA LIGAÇÃO DE WHATSAPP — o colaborador clica, o SBC disca.
//
// Paulo (28/09): *"quanto ao cliente autorizar já estamos cientes e
// funcionamos do, precisamos ativar o resto das funções"*. O desenho é o de
// 25/08 (docs/sbc-whatsapp-hitphone.md, "SAÍDA — botão na conversa"):
//
//   [☎️ Ligar] na conversa → o app grava um PEDIDO → o agente na VM do SBC
//   pega o pedido → o Asterisk toca o RAMAL do colaborador → ele atende →
//   o Asterisk liga a outra perna à Meta → toca no WhatsApp do cliente.
//
// 🚨 POR QUE NÃO É A API DA META: o número está em modo SIP e ela recusa
// chamada iniciada por API — "Graph API calls are not allowed for SIP enabled
// numbers" (131055, provado em 24/08). Quem disca é o tronco. A rota antiga
// que tentava pela API foi substituída por esta; `iniciarChamadaParaCliente`
// em whatsapp-cloud.js fica só como prova do que a Meta respondeu.
//
// 🚨 POR QUE O SBC PERGUNTA AO APP (e não o app manda no SBC): a VM não
// expõe porta nenhuma além da 5061 da Meta. Abrir a API do Asterisk (ARI/AMI)
// para a internet, com o Cloud Run sem IP fixo, seria uma porta a mais para
// proteger. O agente na VM faz GET a cada poucos segundos com um segredo
// compartilhado (`SBC_SHARED_SECRET`) — mesma família do `x-cron-secret`.
//
// DECISÕES QUE MANDAM:
//  · **As travas da Meta são do BACKEND**: só liga com o "Permitir" ACEITO e
//    NÃO vencido; recusa do cliente não vira "peça de novo"; conversa em
//    condução por outra pessoa não recebe segunda voz. São as mesmas frases
//    da rota antiga, de propósito — a tela já as conhece.
//  · **Sem ramal, sem ligação — e a recusa diz ONDE cadastrar.** O ramal é
//    do colaborador (⚙️ → 👥 Atendentes), nunca deduzido do nome nem do 221.
//  · **Pedido tem VALIDADE.** Agente parado não pode discar um pedido de
//    ontem quando voltar: com mais de 2 min sem ser pego, o pedido expira, e
//    a tela diz "o agente na VM não pegou" em vez de "discando…" para sempre.
//  · **Quem responde "atendeu?" é o CDR do Asterisk**, não a nossa vontade:
//    o agente lê a linha com o `accountcode` = id do pedido e devolve a
//    disposição crua traduzida. Sem linha, é "sem resposta do tronco".
//  · **O call file é TEXTO e nasce aqui** para a trava poder provar cada
//    linha (canal do ramal, contexto da saída, accountcode) sem Asterisk.
// ============================================================================

/** Coleção dos pedidos de ligação de saída. */
export const COLECAO_PEDIDOS_LIGACAO = 'whatsapp_ligacoes_saida';

/** Documento de presença do agente da VM (`whatsapp_config/sbc_agente`). */
export const DOC_AGENTE_SBC = 'sbc_agente';

/** Pedido que ninguém pegou em 2 min está morto — o agente está parado. */
export const VALIDADE_PEDIDO_MS = 2 * 60 * 1000;

/** Sem contato do agente há mais que isto, a tela diz "parado". */
export const AGENTE_SILENCIO_MAX_MS = 30 * 1000;

/** Quanto o Asterisk espera o RAMAL atender antes de desistir (segundos). */
export const ESPERA_RAMAL_S = 40;

/** Quanto o Asterisk espera o CLIENTE atender no WhatsApp (segundos). */
export const ESPERA_CLIENTE_S = 60;

/** Contexto do dialplan que o call file executa quando o ramal atende. */
export const CONTEXTO_SAIDA = 'saida-whatsapp';

/** Endpoint pjsip do HitPhone (o mesmo da entrada). */
export const ENDPOINT_HIT = 'hit';

/** Ramal: só dígitos, 2 a 6. `221`, `211`, `1042` — nunca um telefone. */
export function validarRamal(bruto) {
    const r = String(bruto ?? '').trim();
    if (!r) return { ok: false, erro: 'Ramal vazio.' };
    if (!/^\d{2,6}$/.test(r)) return { ok: false, erro: `Ramal "${r}" inválido — use só dígitos (2 a 6), ex.: 221.` };
    return { ok: true, ramal: r };
}

/**
 * Pode ligar? Devolve `{ ok: true }` ou a recusa PRONTA para a rota
 * (`status` HTTP + `error` + `acao` + campos que a tela lê).
 *
 * A ordem importa e é a mesma da rota antiga: Instagram → permissão →
 * expiração → condução → ramal → agente. Cada recusa nomeia o caminho.
 */
export function avaliarPedidoDeLigacao({ conversa = {}, numero, eu, ramal, agora = new Date(), agenteConfigurado = true }) {
    if (conversa.canal === 'instagram') {
        return { ok: false, status: 422, error: 'Ligação é do WhatsApp — DM do Instagram não tem chamada.' };
    }
    const perm = conversa.permissaoLigacao || null;
    if (perm?.status !== 'aceita') {
        return {
            ok: false, status: 422,
            error: perm?.status === 'pendente'
                ? 'O cliente ainda não respondeu ao pedido de permissão.'
                : perm?.status === 'recusada'
                    ? 'O cliente RECUSOU ligações — respeite a recusa.'
                    : 'Este cliente ainda não autorizou ligações da SP.',
            acao: perm?.status === 'recusada'
                ? 'Fale por mensagem; insistir na ligação é o que faz o cliente bloquear o número.'
                : 'Use ☎️ Pedir permissão de ligação e aguarde ele tocar em "Permitir".',
            permissao: perm?.status || 'sem-pedido',
        };
    }
    // A autorização VENCE (a Meta diz até quando). Ligar depois disso é
    // recusa dela — e a tela tem que dizer isso ANTES do telefone tocar.
    const expira = Date.parse(perm?.expiraEm || '');
    if (Number.isFinite(expira) && expira <= agora.getTime()) {
        return {
            ok: false, status: 422,
            error: 'A autorização de ligação deste cliente EXPIROU.',
            acao: 'Peça a permissão de novo (☎️) e aguarde o "Permitir".',
            permissao: 'expirada',
        };
    }
    const dono = conversa.atribuidoA || null;
    if (dono && dono !== eu) {
        return {
            ok: false, status: 409,
            error: `Esta conversa está em condução por ${dono}.`,
            acao: 'Assuma a conversa (🙋) antes de ligar.', emConducaoPor: dono,
        };
    }
    const r = validarRamal(ramal);
    if (!r.ok) {
        return {
            ok: false, status: 422,
            error: 'Você ainda não tem RAMAL cadastrado — é nele que a ligação toca primeiro.',
            acao: 'Peça a um admin para cadastrar seu ramal em ⚙️ → 👥 Atendentes e filas.',
            semRamal: true,
        };
    }
    if (!agenteConfigurado) {
        return {
            ok: false, status: 503,
            error: 'O SBC ainda não está ligado ao SP Connect: falta SBC_SHARED_SECRET no Cloud Run.',
            acao: 'É configuração do servidor (Secret Manager `sbc-shared-secret` + o mesmo valor na VM). Sem isso o agente da VM não consegue pegar pedidos.',
            agenteNaoConfigurado: true,
        };
    }
    if (!/^\d{10,15}$/.test(String(numero || ''))) {
        return { ok: false, status: 400, error: `Número do cliente inválido para discar: "${numero}".` };
    }
    return { ok: true, ramal: r.ramal };
}

/** Id do pedido: legível, único por milissegundo e por número. */
export function idDoPedido({ numero, agora = new Date() }) {
    const carimbo = new Date(agora).toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
    return `lig_${numero}_${carimbo}`;
}

/** O documento que a rota grava e o agente lê. */
export function montarPedido({ id, numero, conversaId = numero, ramal, eu, nomeContato = null, canalId = null, agora = new Date() }) {
    const em = new Date(agora).toISOString();
    return {
        id, numero, conversaId, ramal, canalId,
        nomeContato: nomeContato || null,
        solicitadoPor: eu || null,
        solicitadoEm: em,
        expiraEm: new Date(new Date(agora).getTime() + VALIDADE_PEDIDO_MS).toISOString(),
        status: 'pendente',           // pendente → pegou → (atendida | nao-atendida | ocupado | falhou) | expirado
        pegouEm: null, terminouEm: null,
        resultado: null,              // { disposicao, billsec, detalhe } — o que o CDR disse
    };
}

/**
 * O estado de um pedido AGORA. Pedido pendente além da validade é
 * `expirado` — o agente não pega, a tela não espera.
 */
export function estadoDoPedido(pedido, agora = new Date()) {
    if (!pedido) return 'inexistente';
    if (pedido.status === 'pendente') {
        const exp = Date.parse(pedido.expiraEm || '');
        if (Number.isFinite(exp) && exp <= new Date(agora).getTime()) return 'expirado';
    }
    return pedido.status || 'pendente';
}

/**
 * O CALL FILE do Asterisk. É o jeito mais simples e provado de originar sem
 * AMI/ARI: um arquivo em /var/spool/asterisk/outgoing/ que o pbx consome.
 *
 * Perna 1: Channel = o RAMAL, pelo endpoint `hit` (o mesmo INVITE direto que
 * a entrada já usa, só que ao contrário). Quando o ramal ATENDE, o Asterisk
 * executa Context/Extension — o contexto `saida-whatsapp` disca o cliente
 * pela perna Meta. O `Account` vira `accountcode` no CDR: é por ele que o
 * agente acha a linha desta ligação.
 */
export function montarCallFile({ ramal, numero, pedidoId, nomeContato = null }) {
    const r = validarRamal(ramal);
    if (!r.ok) throw new Error(r.erro);
    if (!/^\d{10,15}$/.test(String(numero || ''))) throw new Error(`Número inválido no call file: "${numero}".`);
    if (!/^[A-Za-z0-9_]{6,80}$/.test(String(pedidoId || ''))) throw new Error(`Id de pedido inválido no call file: "${pedidoId}".`);
    // CallerID no ramal: o colaborador vê QUEM está sendo chamado antes de
    // atender. Só dígitos e letras simples — aspas e CR/LF quebrariam o
    // arquivo (e nome vem do cliente, não é confiável).
    const nome = String(nomeContato || '').replace(/[^\p{L}\p{N} .-]/gu, '').trim().slice(0, 30);
    const rotulo = nome ? `WhatsApp ${nome}` : `WhatsApp ${numero}`;
    return [
        `Channel: PJSIP/${r.ramal}@${ENDPOINT_HIT}`,
        `CallerID: "${rotulo}" <${numero}>`,
        'MaxRetries: 0',
        'RetryTime: 0',
        `WaitTime: ${ESPERA_RAMAL_S}`,
        `Context: ${CONTEXTO_SAIDA}`,
        `Extension: ${numero}`,
        'Priority: 1',
        `Account: ${pedidoId}`,
        `Set: PEDIDO=${pedidoId}`,
        'Archive: no',
        '',
    ].join('\n');
}

/**
 * Lê UMA linha do Master.csv do cdr_csv (campos entre aspas, vírgula).
 * Ordem do cdr_csv padrão: accountcode, src, dst, dcontext, clid, channel,
 * dstchannel, lastapp, lastdata, start, answer, end, duration, billsec,
 * disposition, amaflags, uniqueid.
 */
export function lerLinhaCdr(linha) {
    const campos = [];
    let atual = ''; let dentro = false;
    const s = String(linha || '');
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '"') {
            if (dentro && s[i + 1] === '"') { atual += '"'; i++; }
            else dentro = !dentro;
        } else if (ch === ',' && !dentro) {
            campos.push(atual); atual = '';
        } else atual += ch;
    }
    campos.push(atual);
    if (campos.length < 15) return null;
    return {
        accountcode: campos[0], src: campos[1], dst: campos[2], dcontext: campos[3],
        clid: campos[4], channel: campos[5], dstchannel: campos[6], lastapp: campos[7],
        lastdata: campos[8], start: campos[9], answer: campos[10], end: campos[11],
        duration: Number(campos[12]) || 0, billsec: Number(campos[13]) || 0,
        disposition: String(campos[14] || '').trim().toUpperCase(),
        uniqueid: campos[16] || null,
    };
}

/**
 * Acha no CDR o que aconteceu com o pedido. Pode haver mais de uma linha
 * (o ramal e a perna do cliente); vale a que chegou MAIS LONGE:
 * ANSWERED > BUSY > NO ANSWER > FAILED/CONGESTION.
 */
export function lerResultadoDoCdr(linhasCsv, pedidoId) {
    const peso = { ANSWERED: 4, BUSY: 3, 'NO ANSWER': 2, FAILED: 1, CONGESTION: 1 };
    let melhor = null;
    for (const linha of String(linhasCsv || '').split(/\r?\n/)) {
        if (!linha.trim()) continue;
        const cdr = lerLinhaCdr(linha);
        if (!cdr || cdr.accountcode !== pedidoId) continue;
        if (!melhor || (peso[cdr.disposition] || 0) > (peso[melhor.disposition] || 0)) melhor = cdr;
    }
    if (!melhor) return { encontrado: false };
    return {
        encontrado: true,
        disposicao: melhor.disposition,
        billsec: melhor.billsec,
        // A perna do cliente existiu? Sem dstchannel o ramal nem chegou a
        // discar para fora (ramal não atendeu, ou saída bloqueada).
        pernaCliente: Boolean(melhor.dstchannel),
        lastdata: melhor.lastdata || null,
    };
}

/**
 * Do CDR cru para o que a tela diz. `encontrado:false` depois da espera é
 * "o tronco não registrou" — e isso é falha nomeada, não "atendida".
 */
export function traduzirResultado(r) {
    if (!r || !r.encontrado) {
        return { status: 'falhou', detalhe: 'O tronco não registrou a ligação (nenhuma linha no CDR com este pedido) — o ramal existe? o Asterisk está de pé?' };
    }
    if (r.disposicao === 'ANSWERED') {
        if (r.pernaCliente) return { status: 'atendida', detalhe: `Cliente atendeu — ${r.billsec}s de conversa.` };
        return { status: 'falhou', detalhe: 'O ramal atendeu, mas a perna do cliente não foi discada — confira META_SIP_DESTINO no SBC (saída bloqueada?).' };
    }
    if (r.disposicao === 'BUSY') return { status: 'ocupado', detalhe: r.pernaCliente ? 'O cliente estava ocupado (ou recusou no WhatsApp).' : 'O ramal estava ocupado.' };
    if (r.disposicao === 'NO ANSWER') return { status: 'nao-atendida', detalhe: r.pernaCliente ? 'O cliente não atendeu no WhatsApp.' : 'O ramal não atendeu — a ligação nem saiu para o cliente.' };
    return { status: 'falhou', detalhe: `O tronco devolveu ${r.disposicao || 'sem disposição'}${r.lastdata ? ` (${r.lastdata})` : ''} — o log do Asterisk (asterisk -rvvv) diz em que perna parou.` };
}

/** A frase de status da tela, para cada estado do pedido. */
export function resumoDoPedido(pedido, agora = new Date()) {
    const estado = estadoDoPedido(pedido, agora);
    const ramal = pedido?.ramal ? ` ${pedido.ramal}` : '';
    switch (estado) {
        case 'pendente': return { estado, texto: `⏳ Pedido gravado — aguardando o SBC pegar (o ramal${ramal} toca em seguida)…`, final: false };
        case 'pegou': return { estado, texto: `📞 O SBC está tocando o seu ramal${ramal}. Atenda: a ligação para o cliente sai quando você atender.`, final: false };
        case 'atendida': return { estado, texto: `✅ Ligação atendida pelo cliente${pedido?.resultado?.detalhe ? ` — ${pedido.resultado.detalhe}` : ''}`, final: true };
        case 'nao-atendida': return { estado, texto: `📵 ${pedido?.resultado?.detalhe || 'Não atendida.'}`, final: true };
        case 'ocupado': return { estado, texto: `🔴 ${pedido?.resultado?.detalhe || 'Ocupado.'}`, final: true };
        case 'falhou': return { estado, texto: `⛔ Falhou — ${pedido?.resultado?.detalhe || 'sem detalhe'}`, final: true };
        case 'expirado': return { estado, texto: '⛔ O agente da VM do SBC NÃO pegou o pedido em 2 minutos — ele está parado? (⚙️ → ☎️ mostra quando foi visto pela última vez).', final: true };
        default: return { estado, texto: 'Pedido não encontrado.', final: true };
    }
}

/** O agente da VM está vivo? Lê o carimbo que o GET /sbc/pedidos deixa. */
export function situacaoDoAgente(doc, agora = new Date()) {
    const visto = Date.parse(doc?.ultimoContatoEm || '');
    if (!Number.isFinite(visto)) return { vivo: false, texto: 'nunca falou com o SP Connect — instale/ligue o agente na VM (setup-sbc-whatsapp.sh com SBC_SHARED_SECRET).', haMs: null };
    const haMs = new Date(agora).getTime() - visto;
    if (haMs > AGENTE_SILENCIO_MAX_MS) {
        return { vivo: false, texto: `parado — último contato há ${Math.round(haMs / 1000)} s (esperado a cada poucos segundos).`, haMs };
    }
    return { vivo: true, texto: `no ar — visto há ${Math.max(0, Math.round(haMs / 1000))} s${doc?.versao ? ` (agente ${doc.versao})` : ''}.`, haMs };
}
