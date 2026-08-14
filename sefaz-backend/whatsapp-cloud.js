// ============================================================================
// sefaz-backend/whatsapp-cloud.js  (ESM)
// ----------------------------------------------------------------------------
// Envio de guia por WHATSAPP OFICIAL (Cloud API da Meta) — pedido do Paulo
// (09/08): mais um canal de saída ao cliente, com AS MESMAS regras do e-mail
// (rito #293: SharePoint + gestor + baixa + auditoria). A diferença de classe:
// o wa.me só ABRE a composição (não comprova envio); aqui o SERVIDOR envia e
// a Meta devolve o id da mensagem — prova de envio, como o email-graph.
//
// A WABA é da PRÓPRIA S&P (BM "SP Assessoria Contábil", conferido no Business
// Manager em 09/08) — o token é nosso, direto da Meta, sem depender da
// plataforma de atendimento (Ultra Fox segue recebendo as RESPOSTAS: o
// webhook é dela e não mexemos nele).
//
// REGRAS QUE MANDAM:
// - Mensagem iniciada pela empresa SÓ SAI POR TEMPLATE aprovado pela Meta
//   (fora da janela de 24h). O nome do template vem de env — não se chuta.
// - Config ausente NÃO é erro mudo: faltasDaConfig() lista o que falta e a
//   rota devolve isso pro botão EXPLICAR (farol honesto).
// - Recusa da Meta sai TRADUZIDA com a ação (padrão interpretarCstat).
// ============================================================================

// Exportada: o webhook baixa mídia recebida pela MESMA base (segunda cópia
// da URL divergiria de versão em silêncio).
export const GRAPH_BASE = 'https://graph.facebook.com/v20.0';

/** Lê a configuração do canal a partir do ambiente. */
export function configWhatsapp(env = process.env) {
    return {
        token: String(env.WHATSAPP_CLOUD_TOKEN || '').trim(),
        phoneNumberId: String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
        template: String(env.WHATSAPP_TEMPLATE_GUIA || '').trim(),
        idioma: String(env.WHATSAPP_TEMPLATE_IDIOMA || 'pt_BR').trim(),
        // Opcional: sem ela a WABA é derivada do phoneNumberId.
        wabaId: String(env.WHATSAPP_WABA_ID || '').trim(),
    };
}

/**
 * O que falta pra o canal funcionar — em português e com a ação, porque o
 * botão da tela mostra isto quando o canal não está pronto (nunca some).
 */
export function faltasDaConfig(cfg) {
    const faltas = [];
    if (!cfg.token) faltas.push('token da Cloud API (secret whatsapp-cloud-token ligado na env WHATSAPP_CLOUD_TOKEN)');
    if (!cfg.phoneNumberId) faltas.push('id do número (env WHATSAPP_PHONE_NUMBER_ID)');
    if (!cfg.template) faltas.push('nome do template aprovado (env WHATSAPP_TEMPLATE_GUIA)');
    return faltas;
}

/**
 * Normaliza número BR pro formato E.164 sem "+" (como a Cloud API espera).
 * Aceita com/sem +55, com/sem máscara. Devolve null quando não dá pra
 * afirmar que é um número válido — número torto é ALERTA, nunca chute.
 */
export function normalizarNumeroBr(numero) {
    let d = String(numero || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('0')) d = d.replace(/^0+/, '');
    if (!d.startsWith('55')) d = `55${d}`;
    // 55 + DDD(2) + fixo(8) = 12 · 55 + DDD(2) + celular 9xxxx(9) = 13
    if (d.length !== 12 && d.length !== 13) return null;
    const ddd = Number(d.slice(2, 4));
    if (ddd < 11 || ddd > 99) return null;
    return d;
}

/**
 * Monta o payload de TEMPLATE da Cloud API. `variaveis` preenche o corpo na
 * ordem ({{1}}, {{2}}, …); `documentoId` (media id do upload) vai no cabeçalho
 * como documento com o nome do arquivo — é o PDF da guia.
 */
export function montarMensagemTemplate({ para, template, idioma, variaveis = [], documentoId = null, nomeArquivo = null }) {
    const components = [];
    if (documentoId) {
        components.push({
            type: 'header',
            parameters: [{
                type: 'document',
                document: { id: documentoId, filename: nomeArquivo || 'guia.pdf' },
            }],
        });
    }
    if (variaveis.length) {
        components.push({
            type: 'body',
            parameters: variaveis.map((v) => ({ type: 'text', text: String(v ?? '').slice(0, 1024) })),
        });
    }
    return {
        messaging_product: 'whatsapp',
        to: para,
        type: 'template',
        template: {
            name: template,
            language: { code: idioma || 'pt_BR' },
            ...(components.length ? { components } : {}),
        },
    };
}

/**
 * Traduz a resposta da Graph API pra frase COM AÇÃO. 200 com messages[0].id é
 * a prova de aceite; erro vem em corpo.error {message, code, error_data}.
 */
export function interpretarRespostaWhatsapp(status, corpo) {
    const id = corpo?.messages?.[0]?.id || null;
    if (status >= 200 && status < 300 && id) {
        return { ok: true, messageId: id, contato: corpo?.contacts?.[0]?.wa_id || null };
    }
    const err = corpo?.error || {};
    const code = err.code ?? null;
    const detalhe = err.error_data?.details || err.message || `HTTP ${status}`;
    let acao = 'Confira o erro e tente novamente.';
    if (status === 401 || code === 190) acao = 'Token inválido ou expirado — gere um novo token de usuário do sistema no Business Manager e atualize o secret whatsapp-cloud-token.';
    else if (code === 132001) acao = 'O template não existe nesse idioma ou não está APROVADO — confira o nome exato e o idioma no Gerenciador do WhatsApp.';
    else if (code === 132000 || code === 132012) acao = 'O número de variáveis não bate com o template aprovado — o texto do template mudou ou a ordem das variáveis está errada.';
    else if (code === 131047) acao = 'Fora da janela de 24h e o template não foi aceito — o envio inicial ao cliente PRECISA ser template aprovado.';
    else if (code === 131026) acao = 'Número não tem WhatsApp ou não pode receber — confira o número do cliente no cadastro.';
    else if (code === 100 && /param/i.test(detalhe)) acao = 'Parâmetro inválido no payload — confira template e variáveis.';
    return { ok: false, messageId: null, code, erro: detalhe, acao };
}

/**
 * ═══ LISTAR OS TEMPLATES APROVADOS NA META ══════════════════════════════════
 *
 * Paulo errou o nome do template TRÊS vezes seguidas (13/08) — não por
 * desatenção: `sp_assessoria_contabil_impostos` × `..._imposto` ×
 * `..._guia_imposto` são quase iguais, e o campo era digitação livre. Cada
 * tentativa custou um envio recusado pela Meta e uma volta no chat.
 *
 * Nome de template aprovado NÃO é opinião: a Meta tem a lista. Digitar o que
 * dá pra ESCOLHER é criar erro que não precisava existir — e é a mesma régua do
 * seletor de empresa (achar cliente em `<select>` de 400 é rolar a lista).
 *
 * De quebra, a resposta traz os COMPONENTES: se há cabeçalho de DOCUMENTO e
 * quantas variáveis o corpo tem. Os dois eram preenchidos a dedo, e errar
 * qualquer um recusa o envio (132000/132012).
 *
 * A WABA é DERIVADA do phoneNumberId — assim não nasce mais uma env pra
 * alguém preencher errado.
 */
export async function listarTemplatesAprovados(deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const doFetch = deps.fetchImpl || fetch;
    if (!cfg.token || !cfg.phoneNumberId) {
        return { ok: false, erro: 'Canal do WhatsApp não configurado.', faltas: faltasDaConfig(cfg) };
    }

    const auth = { Authorization: `Bearer ${cfg.token}` };
    let wabaId = String(cfg.wabaId || '').trim();
    if (!wabaId) {
        const r = await doFetch(
            `${GRAPH_BASE}/${cfg.phoneNumberId}?fields=whatsapp_business_account`,
            { headers: auth },
        );
        const c = await r.json().catch(() => ({}));
        wabaId = c?.whatsapp_business_account?.id || '';
        if (!wabaId) {
            return {
                ok: false,
                erro: `Não foi possível descobrir a conta (WABA) a partir do número: ${c?.error?.message || `HTTP ${r.status}`}`,
                acao: 'O token precisa ter permissão de leitura da conta do WhatsApp Business.',
            };
        }
    }

    const resp = await doFetch(
        `${GRAPH_BASE}/${wabaId}/message_templates?limit=200&fields=name,language,status,category,components`,
        { headers: auth },
    );
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        return { ok: false, erro: corpo?.error?.message || `HTTP ${resp.status}` };
    }
    return { ok: true, wabaId, templates: (corpo.data || []).map(lerTemplateDaMeta) };
}

/**
 * Traduz UM template da Meta para o que o cadastro precisa saber.
 *
 * `variaveis` é a CONTAGEM lida do corpo ({{1}}, {{2}}…), não um palpite: é ela
 * que tem de bater com o schema, senão a Meta recusa o envio.
 */
export function lerTemplateDaMeta(t) {
    const componentes = Array.isArray(t?.components) ? t.components : [];
    const header = componentes.find((c) => String(c?.type).toUpperCase() === 'HEADER');
    const body = componentes.find((c) => String(c?.type).toUpperCase() === 'BODY');
    const texto = String(body?.text || '');
    const posicoes = new Set((texto.match(/\{\{\s*(\d+)\s*\}\}/g) || [])
        .map((m) => m.replace(/\D/g, '')));
    return {
        nome: t?.name || null,
        idioma: t?.language || null,
        status: String(t?.status || '').toUpperCase(),
        categoria: String(t?.category || '').toUpperCase(),
        // Só cabeçalho de DOCUMENTO carrega o PDF da guia.
        temDocumento: String(header?.format || '').toUpperCase() === 'DOCUMENT',
        formatoCabecalho: String(header?.format || '').toUpperCase() || 'NENHUM',
        variaveis: posicoes.size,
        corpo: texto,
    };
}

/**
 * Sobe o PDF pro media endpoint e devolve o media id. O PDF nunca vai por
 * link público — sobe direto pra Meta, mesmo desenho do anexo do Graph.
 */
export async function subirPdf({ pdfBase64, nomeArquivo }, deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const doFetch = deps.fetchImpl || fetch;
    const bin = Buffer.from(pdfBase64, 'base64');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([bin], { type: 'application/pdf' }), nomeArquivo || 'guia.pdf');
    const resp = await doFetch(`${GRAPH_BASE}/${cfg.phoneNumberId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}` },
        body: form,
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok || !corpo.id) {
        const det = corpo?.error?.message || `HTTP ${resp.status}`;
        throw new Error(`Upload do PDF ao WhatsApp falhou: ${det}`);
    }
    return corpo.id;
}

/**
 * Envia a guia por template. Devolve {ok, messageId} ou {ok:false, erro, acao}.
 * NUNCA reenvia sozinho: falha de rede aqui é INDETERMINADO (a mensagem pode
 * ter saído) — quem decide repetir é a pessoa, avisada.
 */
/**
 * Envio GENÉRICO por template (Paulo, 10/08): qualquer template aprovado da
 * WABA, não só a guia fiscal. O token e o phoneNumberId continuam vindo da
 * config (a credencial compartilhada mora no CFI) — o que varia é o TEMPLATE
 * e o IDIOMA, passados pelo chamador (a rota resolve pelo cadastro por
 * departamento). Só isto muda em relação ao enviarGuiaWhatsapp: o nome do
 * template deixa de ser o do env.
 */
export async function enviarTemplateWhatsapp({ para, template, idioma, variaveis, pdfBase64, nomeArquivo }, deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    // Aqui NÃO exigimos cfg.template (o env da guia) — o template vem do
    // chamador. Só token + phoneNumberId precisam estar configurados.
    if (!cfg.token || !cfg.phoneNumberId) {
        return { ok: false, erro: 'Canal WhatsApp não configurado: falta o token da Cloud API e/ou o id do número.', acao: 'Configure o secret e as envs no CFI.', configuracaoIncompleta: true };
    }
    if (!template) return { ok: false, erro: 'Template do WhatsApp não informado.', acao: 'Escolha um template aprovado do departamento.' };
    const numero = normalizarNumeroBr(para);
    if (!numero) return { ok: false, erro: `Número de WhatsApp inválido: "${para}".`, acao: 'Corrija o número no cadastro (DDD + número).' };
    const doFetch = deps.fetchImpl || fetch;

    let documentoId = null;
    if (pdfBase64) documentoId = await subirPdf({ pdfBase64, nomeArquivo }, { ...deps, cfg });

    const payload = montarMensagemTemplate({
        para: numero, template, idioma: idioma || cfg.idioma,
        variaveis, documentoId, nomeArquivo,
    });
    let resp;
    try {
        resp = await doFetch(`${GRAPH_BASE}/${cfg.phoneNumberId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (e) {
        return { ok: false, indeterminado: true, erro: `Rede caiu durante o envio (${e.message}) — a mensagem PODE ter saído.`, acao: 'Confira no WhatsApp do número oficial antes de reenviar: reenviar duplica a mensagem.' };
    }
    const corpo = await resp.json().catch(() => ({}));
    const r = interpretarRespostaWhatsapp(resp.status, corpo);
    return { ...r, numeroEnviado: numero };
}

export async function enviarGuiaWhatsapp({ para, variaveis, pdfBase64, nomeArquivo }, deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const faltas = faltasDaConfig(cfg);
    if (faltas.length) return { ok: false, erro: `Canal WhatsApp não configurado: falta ${faltas.join('; ')}.`, acao: 'Configure e tente de novo.', configuracaoIncompleta: true };
    const numero = normalizarNumeroBr(para);
    if (!numero) return { ok: false, erro: `Número de WhatsApp inválido: "${para}".`, acao: 'Corrija o número no cadastro do cliente (DDD + número).' };
    const doFetch = deps.fetchImpl || fetch;

    let documentoId = null;
    if (pdfBase64) documentoId = await subirPdf({ pdfBase64, nomeArquivo }, { ...deps, cfg });

    const payload = montarMensagemTemplate({
        para: numero, template: cfg.template, idioma: cfg.idioma,
        variaveis, documentoId, nomeArquivo,
    });
    let resp;
    try {
        resp = await doFetch(`${GRAPH_BASE}/${cfg.phoneNumberId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (e) {
        return { ok: false, indeterminado: true, erro: `Rede caiu durante o envio (${e.message}) — a mensagem PODE ter saído.`, acao: 'Confira no WhatsApp do número oficial antes de reenviar: reenviar duplica a mensagem no cliente.' };
    }
    const corpo = await resp.json().catch(() => ({}));
    const r = interpretarRespostaWhatsapp(resp.status, corpo);
    return { ...r, numeroEnviado: numero };
}
