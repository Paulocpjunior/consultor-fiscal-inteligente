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

import { montarMensagemMidia } from './whatsapp-midia.js';

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
 * 🚨 NÚMERO QUE VEIO DA META JÁ ESTÁ PRONTO — NORMALIZAR É QUE ESTRAGA
 * (17/08, ao ler o backup da Ultra Fox: entre as conversas há `244922121422`,
 * `258849044321` e `14074950699`. Paulo confirmou o fato: *"temos clientes
 * fora do brasil"*).
 *
 * O `wa_id` que chega no webhook, o id da conversa e o nome da pasta do
 * backup são o MESMO identificador, escrito pela própria Meta em E.164 sem
 * "+". Passar isso pela régua brasileira produzia duas coisas, e a segunda é
 * a cara:
 *
 *  · `244922121422` (Angola) → ganha um 55 na frente, vira 14 dígitos e é
 *    RECUSADO: o colaborador não consegue responder o cliente. Falha visível.
 *  · `14074950699` (EUA) → ganha o 55, vira 13 dígitos com DDD 14 **válido**,
 *    e a mensagem sai para **+55 14 07495-0699**, um número brasileiro de
 *    OUTRA pessoa — com o app dizendo "enviado". Plausível e errado, que é
 *    sempre o desfecho mais caro.
 *
 * Por isso a régua de ENVIO é esta: dígitos, e o comprimento de E.164 (o
 * máximo do padrão é 15). Ela não inventa DDI nem julga país — quem escreveu
 * o identificador foi a Meta.
 */
export function numeroCanonicoWhatsapp(numero) {
    const d = String(numero || '').replace(/\D/g, '');
    // 8 é o piso de um número nacional curto com DDI; 15 é o teto do E.164.
    if (d.length < 8 || d.length > 15) return null;
    return d;
}

/**
 * Normaliza número BR pro formato E.164 sem "+" (como a Cloud API espera).
 * Aceita com/sem +55, com/sem máscara. Devolve null quando não dá pra
 * afirmar que é um número válido — número torto é ALERTA, nunca chute.
 *
 * ⚠️ **É para número DIGITADO POR GENTE** (cadastro do cliente, ✚ Nova
 * conversa) — nunca para `wa_id`. A conveniência de completar o 55 só existe
 * porque quem digita "11 99999-0000" quer dizer Brasil; aplicada a um
 * identificador que já veio pronto, ela reescreve o destino.
 *
 * 🌍 **Internacional se declara com "+"**: quem digita `+244 922 121 422`
 * está dizendo o país, e aí a régua brasileira sai da frente. Sem o "+", 10 e
 * 11 dígitos continuam sendo lidos como brasileiros — é o que a pessoa quis
 * dizer, e adivinhar o contrário faria o telefone do cadastro virar outro
 * país por acidente.
 */
export function normalizarNumeroBr(numero) {
    const bruto = String(numero || '').trim();
    if (bruto.startsWith('+')) return numeroCanonicoWhatsapp(bruto);
    let d = bruto.replace(/\D/g, '');
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
 * 📤 CARTÃO DE CONTATO — compartilhar um contato dentro da conversa.
 *
 * Paulo, 17/08: *"compartilhar novos contatos"*. É o tipo `contacts` do mesmo
 * endpoint /messages, e ele chega no cliente como cartão salvável (não como
 * texto com um número solto que a pessoa precisa copiar à mão).
 *
 * O `wa_id` é o número EM DÍGITOS e é o que faz o botão "Conversar" aparecer
 * no cartão — sem ele o WhatsApp mostra um cartão morto, que é pior que um
 * texto, porque parece que vai funcionar.
 */
export function montarMensagemContato({ para, contatos = [] }) {
    const lista = (Array.isArray(contatos) ? contatos : []).map((c) => {
        const digitos = String(c.numero || '').replace(/\D/g, '');
        const nome = String(c.nome || '').trim() || digitos;
        // A Meta exige formatted_name E pelo menos um dos campos de nome:
        // mandar só o formatado é recusa do payload inteiro.
        const [primeiro, ...resto] = nome.split(/\s+/);
        return {
            name: {
                formatted_name: nome.slice(0, 120),
                first_name: primeiro.slice(0, 60),
                ...(resto.length ? { last_name: resto.join(' ').slice(0, 60) } : {}),
            },
            phones: [{ phone: `+${digitos}`, type: 'CELL', wa_id: digitos }],
            ...(c.empresa ? { org: { company: String(c.empresa).slice(0, 120) } } : {}),
        };
    });
    return { messaging_product: 'whatsapp', to: para, type: 'contacts', contacts: lista };
}

export async function enviarContatoWhatsapp({ para, contatos }, deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const doFetch = deps.fetchImpl || fetch;
    if (!cfg.token || !cfg.phoneNumberId) {
        return { ok: false, erro: 'Canal WhatsApp não configurado.', configuracaoIncompleta: true };
    }
    const corpoEnvio = montarMensagemContato({ para, contatos });
    if (!corpoEnvio.contacts.length) return { ok: false, erro: 'Nenhum contato para compartilhar.' };
    const r = await doFetch(`${GRAPH_BASE}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpoEnvio),
    });
    const corpo = await r.json().catch(() => ({}));
    return interpretarRespostaWhatsapp(r.status, corpo);
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

/** Deriva a WABA a partir do número (mesma lógica do listarTemplatesAprovados). */
async function descobrirWabaId(cfg, doFetch) {
    if (cfg.wabaId) return { ok: true, wabaId: cfg.wabaId };
    const r = await doFetch(
        `${GRAPH_BASE}/${cfg.phoneNumberId}?fields=whatsapp_business_account`,
        { headers: { Authorization: `Bearer ${cfg.token}` } },
    );
    const c = await r.json().catch(() => ({}));
    const wabaId = c?.whatsapp_business_account?.id || '';
    if (!wabaId) return { ok: false, erro: c?.error?.message || `HTTP ${r.status}` };
    return { ok: true, wabaId };
}

/**
 * ═══ ASSINATURA DA WABA — a segunda amarração do webhook ════════════════════
 *
 * Configurar Callback URL + verify token no APP resolve o canal; mas evento
 * REAL só chega se o app estiver ASSINADO na WABA (subscribed_apps). O teste
 * do painel da Meta NÃO passa por essa amarração — foi exatamente assim que o
 * teste chegou e a mensagem real não (16/08). WABA conectada por plataforma
 * de atendimento costuma ter SÓ o app dela assinado.
 */
export async function listarAppsAssinadosNaWaba(deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const doFetch = deps.fetchImpl || fetch;
    if (!cfg.token || !cfg.phoneNumberId) return { ok: false, erro: 'Canal não configurado.' };
    const w = await descobrirWabaId(cfg, doFetch);
    if (!w.ok) return { ok: false, erro: `Não achei a WABA: ${w.erro}` };
    const r = await doFetch(`${GRAPH_BASE}/${w.wabaId}/subscribed_apps`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, erro: corpo?.error?.message || `HTTP ${r.status}` };
    return { ok: true, wabaId: w.wabaId, apps: interpretarAppsAssinados(corpo) };
}

/** Assina O NOSSO app (o dono do token) na WABA — é isto que liga o fluxo real. */
export async function assinarWaba(deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const doFetch = deps.fetchImpl || fetch;
    if (!cfg.token || !cfg.phoneNumberId) return { ok: false, erro: 'Canal não configurado.' };
    const w = await descobrirWabaId(cfg, doFetch);
    if (!w.ok) return { ok: false, erro: `Não achei a WABA: ${w.erro}` };
    const r = await doFetch(`${GRAPH_BASE}/${w.wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}` },
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok || corpo?.success !== true) {
        return { ok: false, erro: corpo?.error?.message || `HTTP ${r.status}`, acao: 'O token precisa ter a permissão whatsapp_business_management.' };
    }
    return { ok: true, wabaId: w.wabaId };
}

/**
 * ═══ TEXTO LIVRE — a resposta DENTRO da janela de 24h ══════════════════════
 * Fora da janela a Meta recusa (131047) e o SP Connect nem tenta: a trava é
 * no backend, antes da rede. Texto livre é a alma do atendimento — é o que a
 * plataforma substituída faz o dia todo.
 */
export async function enviarTextoLivre({ para, texto }, deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    if (!cfg.token || !cfg.phoneNumberId) {
        return { ok: false, erro: 'Canal WhatsApp não configurado.', configuracaoIncompleta: true };
    }
    // `para` chega CANÔNICO (wa_id da Meta / id da conversa). Normalizar aqui
    // reescreveria o destino de cliente de fora do Brasil — ver a nota de
    // `numeroCanonicoWhatsapp`. Quem digita normaliza na porta de entrada.
    const numero = numeroCanonicoWhatsapp(para);
    if (!numero) return { ok: false, erro: `Número de WhatsApp inválido: "${para}".` };
    const corpo = String(texto ?? '').trim();
    if (!corpo) return { ok: false, erro: 'Mensagem vazia não sai.' };
    const doFetch = deps.fetchImpl || fetch;
    let resp;
    try {
        resp = await doFetch(`${GRAPH_BASE}/${cfg.phoneNumberId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messaging_product: 'whatsapp', to: numero, type: 'text',
                text: { body: corpo.slice(0, 4096), preview_url: false },
            }),
        });
    } catch (e) {
        return { ok: false, indeterminado: true, erro: `Rede caiu durante o envio (${e.message}) — a mensagem PODE ter saído.`, acao: 'Confira a conversa antes de reenviar: reenviar duplica.' };
    }
    const json = await resp.json().catch(() => ({}));
    const r = interpretarRespostaWhatsapp(resp.status, json);
    return { ...r, numeroEnviado: numero };
}

/** Achata a resposta do subscribed_apps pra lista de nomes/ids (puro, testável). */
export function interpretarAppsAssinados(corpo) {
    return (Array.isArray(corpo?.data) ? corpo.data : []).map((d) => ({
        id: d?.whatsapp_business_api_data?.id || null,
        nome: d?.whatsapp_business_api_data?.name || null,
    }));
}

/**
 * Sobe o PDF pro media endpoint e devolve o media id. O PDF nunca vai por
 * link público — sobe direto pra Meta, mesmo desenho do anexo do Graph.
 */
/**
 * Sobe QUALQUER arquivo à Meta e devolve o media id. É a régua ÚNICA de
 * upload — o `subirPdf` da guia chama esta função (segunda cópia de upload
 * divergiria no dia em que a Meta mudasse o endpoint).
 */
export async function subirMidiaWhatsapp({ base64, nomeArquivo, mime }, deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const doFetch = deps.fetchImpl || fetch;
    const tipoMime = String(mime || 'application/octet-stream').split(';')[0].trim();
    const bin = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', tipoMime);
    form.append('file', new Blob([bin], { type: tipoMime }), nomeArquivo || 'arquivo');
    const resp = await doFetch(`${GRAPH_BASE}/${cfg.phoneNumberId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}` },
        body: form,
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok || !corpo.id) {
        const det = corpo?.error?.message || `HTTP ${resp.status}`;
        throw new Error(`Upload do arquivo ao WhatsApp falhou: ${det}`);
    }
    return corpo.id;
}

export async function subirPdf({ pdfBase64, nomeArquivo }, deps = {}) {
    return subirMidiaWhatsapp(
        { base64: pdfBase64, nomeArquivo: nomeArquivo || 'guia.pdf', mime: 'application/pdf' },
        deps,
    );
}

/**
 * Envia MÍDIA já subida (media id) dentro da janela de 24h. Mesma régua do
 * `enviarTextoLivre`: falha de REDE é indeterminado (a mensagem pode ter
 * saído) e NUNCA se repete sozinho — duplicar anexo no cliente é pior.
 */
export async function enviarMidiaWhatsapp({ para, tipo, mediaId, nomeArquivo, legenda }, deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const faltas = faltasDaConfig(cfg);
    if (faltas.length) {
        return { ok: false, configuracaoIncompleta: true, erro: `Canal do WhatsApp não configurado: ${faltas.join('; ')}.`, acao: 'Configure as credenciais no Cloud Run.' };
    }
    const numero = numeroCanonicoWhatsapp(para);
    if (!numero) return { ok: false, erro: `Número inválido: ${para}`, acao: 'Confira DDD e número.' };
    const doFetch = deps.fetchImpl || fetch;
    const corpoMsg = montarMensagemMidia({ para: numero, tipo, mediaId, nomeArquivo, legenda });
    try {
        const resp = await doFetch(`${GRAPH_BASE}/${cfg.phoneNumberId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(corpoMsg),
        });
        const corpo = await resp.json().catch(() => ({}));
        const r = interpretarRespostaWhatsapp(resp.status, corpo);
        return r.ok ? { ...r, numeroEnviado: numero } : r;
    } catch (e) {
        return {
            ok: false, indeterminado: true,
            erro: `Falha de rede ao enviar o anexo: ${e.message}`,
            acao: 'NÃO reenvie por reflexo — confira na conversa se o arquivo chegou antes de tentar de novo.',
        };
    }
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
