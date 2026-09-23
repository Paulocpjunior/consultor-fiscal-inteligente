// ============================================================================
// sefaz-backend/whatsapp-webhook.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// F1 DO MÓDULO 💬 COMUNICAÇÃO (desenho em docs/desenho-modulo-comunicacao.md):
// o CFI passa a RECEBER o que a Meta manda — mensagens dos clientes e STATUS
// de entrega dos nossos envios — em paralelo com a Ultra Fox, só gravando.
//
// POR QUE ISSO IMPORTA JÁ NA F1: hoje a auditoria de envio para em "a Meta
// aceitou" (messageId), e aceito ≠ entregue — o filtro de marketing (131049)
// descarta a mensagem EM SILÊNCIO e ninguém vê. O status do webhook é o farol
// honesto do canal: entregue/lido/falhou COM o motivo.
//
// REGRAS QUE MANDAM:
// - A assinatura X-Hub-Signature-256 é VALIDADA sobre o corpo CRU (HMAC com o
//   app secret). Sem assinatura válida, nada entra no banco — a rota é
//   pública e qualquer um pode dar POST nela.
// - Comparação em tempo constante (timingSafeEqual) — mesma regra do
//   cron-secret.
// - Tipo de mensagem desconhecido NÃO é descartado: entra com o tipo nomeado
//   e texto nulo (ausência não é prova; descartar em silêncio é a armadilha
//   do parser de checkbox do Jotform).
// - Nenhuma função aqui toca banco ou rede — quem grava é a rota.
// ============================================================================

import { createHmac } from 'crypto';
import { secretsMatch } from './cron-secret.js';
import { respostaDePermissaoLigacao } from './whatsapp-chamadas.js';
import { saiuPorOutraPlataforma } from '../services/sp-connect-message-origin.js';
export { saiuPorOutraPlataforma } from '../services/sp-connect-message-origin.js';

/** Config do webhook — envs próprias, separadas das do envio. */
export function configWebhook(env = process.env) {
    return {
        verifyToken: String(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim(),
        appSecret: String(env.WHATSAPP_APP_SECRET || '').trim(),
        // 📷 O caso de uso "API do Instagram com login do Instagram" tem um
        // app do Instagram PRÓPRIO (descoberto no painel em 22/08:
        // API_Oficial-IG), com CHAVE SECRETA PRÓPRIA — o webhook dele assina
        // com ela, não com a do app principal. Sem esta env a DM chegaria e
        // seria recusada com 401 ANTES do evento cru, invisível pro
        // diagnóstico. Vazia = modo não usado, nada muda.
        instagramAppSecret: String(env.INSTAGRAM_APP_SECRET || '').trim(),
    };
}

/** O que falta pro webhook funcionar — em português e com a ação (farol honesto). */
export function faltasDaConfigWebhook(cfg) {
    const faltas = [];
    if (!cfg.verifyToken) faltas.push('token de verificação (env WHATSAPP_WEBHOOK_VERIFY_TOKEN — você inventa o valor e repete no painel da Meta)');
    if (!cfg.appSecret) faltas.push('app secret da Meta (env WHATSAPP_APP_SECRET — App da Meta → Configurações → Básico)');
    return faltas;
}

// Comparação em tempo constante: a MESMA do cron-secret (régua única — uma
// segunda cópia aqui foi barrada em revisão no próprio PR que a escreveu).

/**
 * GET de verificação da Meta: ela manda hub.mode=subscribe + hub.verify_token
 * + hub.challenge, e espera o challenge de volta (200) SÓ se o token bater.
 */
export function responderVerificacao(query, cfg) {
    const q = query || {};
    const modo = q['hub.mode'];
    const token = q['hub.verify_token'];
    const challenge = q['hub.challenge'];
    if (modo !== 'subscribe') return { ok: false, motivo: `hub.mode "${modo}" não é subscribe` };
    if (!cfg.verifyToken) return { ok: false, motivo: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN não configurado' };
    if (!secretsMatch(token, cfg.verifyToken)) return { ok: false, motivo: 'verify_token não confere' };
    return { ok: true, challenge: String(challenge ?? '') };
}

/**
 * Valida a assinatura do POST. O header vem como "sha256=<hex>" e o HMAC é
 * calculado sobre o corpo CRU (bytes como chegaram — por isso o server.js
 * guarda req.rawBody; re-serializar o JSON mudaria a ordem das chaves e a
 * assinatura nunca bateria).
 */
export function assinaturaValida(rawBody, headerAssinatura, appSecret) {
    // Aceita UMA chave ou uma LISTA (o app principal e o app do Instagram
    // assinam com chaves diferentes no mesmo endpoint) — qualquer uma que
    // bater vale; nenhuma configurada continua sendo recusa.
    const chaves = (Array.isArray(appSecret) ? appSecret : [appSecret]).filter(Boolean);
    if (!chaves.length || !rawBody) return false;
    const header = String(headerAssinatura || '');
    if (!header.startsWith('sha256=')) return false;
    const recebida = header.slice('sha256='.length);
    return chaves.some((chave) => {
        const esperada = createHmac('sha256', chave).update(rawBody).digest('hex');
        return secretsMatch(recebida, esperada);
    });
}

/** Timestamp da Meta (segundos, string) → ISO. Torto vira null, nunca chute. */
function tsParaIso(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n * 1000).toISOString();
}

/** Fim da janela de 24h aberta por uma mensagem do cliente. */
export function janela24hAte(timestampIso) {
    const t = Date.parse(timestampIso || '');
    if (!Number.isFinite(t)) return null;
    return new Date(t + 24 * 60 * 60 * 1000).toISOString();
}

// Tipos que carregam mídia (o binário fica na Meta; o download é da F2 —
// aqui guardamos o media id, que é o que permite baixar depois).
const TIPOS_MIDIA = new Set(['image', 'document', 'audio', 'video', 'sticker']);

/** Extrai o texto "legível" de uma mensagem, conforme o tipo. */
function textoDaMensagem(m) {
    switch (m.type) {
        case 'text': return m.text?.body ?? null;
        case 'button': return m.button?.text ?? null;
        case 'interactive':
            return m.interactive?.button_reply?.title
                ?? m.interactive?.list_reply?.title ?? null;
        case 'reaction': return m.reaction?.emoji ?? null;
        case 'image': case 'document': case 'video':
            return m[m.type]?.caption ?? null;
        case 'location': {
            const l = m.location || {};
            return (l.latitude != null && l.longitude != null)
                ? `📍 ${l.latitude},${l.longitude}${l.name ? ` (${l.name})` : ''}` : null;
        }
        case 'contacts': return '👤 cartão de contato';
        default: return null;
    }
}

/**
 * Extrai o que interessa do payload do webhook (campo "messages").
 * Devolve { valido, mensagens[], statuses[] } — mensagens são o que o CLIENTE
 * mandou; statuses são o destino dos NOSSOS envios.
 */
export function extrairEventos(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (p.object !== 'whatsapp_business_account') {
        return { valido: false, motivo: `object "${p.object}" não é whatsapp_business_account`, mensagens: [], statuses: [] };
    }
    const mensagens = [];
    const statuses = [];
    for (const entry of (Array.isArray(p.entry) ? p.entry : [])) {
        for (const change of (Array.isArray(entry?.changes) ? entry.changes : [])) {
            if (change?.field !== 'messages') continue;
            const value = change.value || {};
            const phoneNumberId = value.metadata?.phone_number_id || null;
            const nomes = new Map((Array.isArray(value.contacts) ? value.contacts : [])
                .map((c) => [c?.wa_id, c?.profile?.name || null]));

            for (const m of (Array.isArray(value.messages) ? value.messages : [])) {
                if (!m?.id || !m?.from) continue; // sem id não há idempotência; sem from não há conversa
                const midiaBruta = TIPOS_MIDIA.has(m.type) ? (m[m.type] || {}) : null;
                mensagens.push({
                    metaMessageId: String(m.id),
                    de: String(m.from),
                    nomePerfil: nomes.get(m.from) || null,
                    tipo: String(m.type || 'desconhecido'),
                    texto: textoDaMensagem(m),
                    midia: midiaBruta ? {
                        metaMediaId: midiaBruta.id || null,
                        mime: midiaBruta.mime_type || null,
                        nomeArquivo: midiaBruta.filename || null,
                        sha256: midiaBruta.sha256 || null,
                    } : null,
                    respostaA: m.context?.id || null,
                    timestamp: tsParaIso(m.timestamp),
                    phoneNumberId,
                    // ☎️ resposta ao cartão "Permitir" (null em mensagem comum)
                    permissaoLigacao: respostaDePermissaoLigacao(m),
                });
            }

            for (const s of (Array.isArray(value.statuses) ? value.statuses : [])) {
                if (!s?.id) continue;
                const erro = Array.isArray(s.errors) && s.errors[0] ? s.errors[0] : null;
                statuses.push({
                    metaMessageId: String(s.id),
                    destinatario: s.recipient_id ? String(s.recipient_id) : null,
                    status: String(s.status || 'desconhecido'),
                    timestamp: tsParaIso(s.timestamp),
                    erro: erro ? {
                        codigo: erro.code ?? null,
                        titulo: erro.title || null,
                        detalhe: erro.error_data?.details || erro.message || null,
                    } : null,
                    phoneNumberId,
                });
            }
        }
    }
    return { valido: true, mensagens, statuses };
}

/** Status da Meta → português da tela. Desconhecido fica como veio, nomeado. */
export function traduzirStatusEntrega(status) {
    const mapa = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou', deleted: 'apagado', warning: 'aviso' };
    return mapa[String(status || '').toLowerCase()] || String(status || 'desconhecido');
}

/**
 * 🚨 ESTA MENSAGEM SAIU DAQUI OU DE OUTRA PLATAFORMA?
 *
 * Pergunta que só existe por causa da CONVIVÊNCIA (decisão do Paulo: os dois
 * apps ficam assinados na WABA). A Meta entrega o **status** de TODA mensagem
 * do número para TODOS os apps assinados — inclusive das que a Ultra Fox
 * mandou. Dessas nós recebemos só o status: sem texto (a Meta não compartilha
 * o conteúdo de mensagem de outro app) e sem mídia.
 *
 * A régua é o REGISTRO PRÓPRIO: tudo que sai daqui grava `enviadoPor` (o
 * e-mail de quem clicou, ou `'bot'`) e grava texto ou mídia. Documento que só
 * nasceu do status não tem nada disso.
 *
 * ⚠️ **NA DÚVIDA, NÃO AFIRMA QUE É DE OUTRO.** Sem o documento em mãos a
 * resposta é `false`: dizer "saiu por outra plataforma" sobre um envio NOSSO
 * faria o colaborador ignorar uma falha que é dele — erro na direção cara. O
 * contrário só custa uma frase inútil.
 */
/**
 * 🚨 O DOCUMENTO QUE `interpretarErroEntrega` DEVE ENXERGAR, dado o que a
 * rota leu do Firestore para este `metaMessageId` (caso real, print do
 * Paulo, 20/08: mensagem da P. Leal — o balão já dizia "outra plataforma" e
 * o erro 131053 mandava o colaborador converter um arquivo que ele nunca
 * enviou, o MESMO defeito que o caso Agatha de 17/08 tinha corrigido).
 *
 * A causa era esta: todo envio NOSSO grava o documento (com `enviadoPor` e
 * texto/mídia) ANTES de a rota responder — ou seja, antes que a Meta
 * pudesse sequer chamar nosso webhook com um status daquele `metaMessageId`
 * (as 9 rotas de envio seguem essa ordem, varridas por
 * `whatsappWebhookDocAusente.test.ts`). Se o documento SIMPLESMENTE NÃO
 * EXISTE quando o status chega, a mensagem não pode ser nossa — é uma
 * certeza ESTRUTURAL, mais forte que "campos vazios": aqui não sobrou nem o
 * documento. `saiuPorOutraPlataforma(null)` continua devolvendo `false` de
 * propósito (é a resposta certa quando a dúvida é de verdade); quem decide
 * que aqui a dúvida NÃO existe é este helper, na FRONTEIRA com o Firestore.
 */
export function mensagemDoStatus(existeDoc, dadosDoDoc) {
    if (existeDoc) return dadosDoDoc || null;
    return { direcao: 'saida' };
}

/**
 * Falha de entrega → frase COM AÇÃO (padrão interpretarCstat). O 131049 é o
 * protagonista: é o filtro que hoje faz o escritório LIGAR pro cliente sem
 * saber por quê.
 *
 * `mensagem` é o DOCUMENTO da mensagem que falhou (o mesmo que a rota já leu):
 * dele saem a mídia enviada e a resposta de quem mandou.
 */
export function interpretarErroEntrega(codigo, detalhe = '', mensagem = null) {
    const c = Number(codigo);
    const midia = mensagem?.midia || null;
    const deOutro = saiuPorOutraPlataforma(mensagem);
    // Toda frase abaixo prescreve algo a QUEM MANDOU. Quando a mensagem não é
    // nossa, isso é ação impossível: o colaborador não tem o arquivo, não tem
    // o texto e não mandou nada. O aviso continua aparecendo — o cliente não
    // recebeu, e a Recepção precisa saber —, mas dizendo DE QUEM é a ação.
    const deOutroSufixo = ' ⚠️ Esta mensagem saiu pela OUTRA plataforma, não pelo SP Connect: '
        + 'aqui só chega o status dela, e quem reenvia é quem mandou.';
    const comDono = (frase) => (deOutro ? frase + deOutroSufixo : frase);
    if (c === 131049 || c === 130472) {
        return comDono('A Meta NÃO entregou para preservar o engajamento (filtro de marketing). Ação: template na categoria UTILITY e/ou pedir ao cliente que inicie a conversa (a resposta dele abre a janela de 24h).');
    }
    if (c === 131047) return comDono('Fora da janela de 24h — reenvie por template aprovado.');
    if (c === 131026) return 'O número não tem WhatsApp ou não pode receber — confira o número no cadastro do cliente.';
    if (c === 131053) {
        // 🚨 "TENTE REENVIAR" NÃO SERVE QUANDO JÁ FALHOU TRÊS VEZES (caso real
        // de 17/08, no painel do Paulo: três 131053 seguidos para o mesmo
        // número). Este erro chega no webhook DEPOIS de a Meta ter aceitado o
        // envio — o upload deu certo e o processamento da mídia é que falhou.
        // Logo, repetir o MESMO arquivo tende a falhar de novo, e a ação útil
        // é sobre o ARQUIVO. Por isso ele vai DESCRITO na frase: sem dizer o
        // que foi tentado, quem lê não tem por onde começar.
        // 🚨 E A AÇÃO TEM QUE SER DE QUEM PODE AGIR (print do Paulo, 17/08,
        // conversa da Agatha): a falha apareceu numa mensagem que a OUTRA
        // plataforma mandou, e a frase pedia ao nosso colaborador que
        // convertesse um arquivo que ele nunca enviou — e que este app nem
        // tem. Mandar alguém consertar o que não é dele é a mesma família do
        // "tente reenviar": ação impossível ocupando o lugar da útil.
        if (deOutro) {
            return 'Esta mensagem NÃO saiu pelo SP Connect — foi enviada pela outra plataforma, '
                + 'e a Meta só nos manda o status dela (não o arquivo nem o texto). '
                + 'A mídia falhou no processamento, então o cliente NÃO recebeu: quem reenvia é quem mandou, '
                + 'convertendo o arquivo (o mesmo tende a falhar de novo). Reenviando por aqui, o anexo fica guardado no histórico.';
        }
        if (!midia) return 'Falha no processamento da mídia pela Meta. Reenviar o MESMO arquivo tende a falhar de novo — converta (PDF → imagem, áudio → mp3) ou reduza o tamanho.';
        const mb = midia.tamanhoBytes ? (midia.tamanhoBytes / (1024 * 1024)).toFixed(1).replace('.', ',') : null;
        const oque = [midia.nomeArquivo, midia.mime, mb ? `${mb} MB` : null].filter(Boolean).join(' · ');
        const porTipo = {
            document: 'Converta para PDF simples (sem senha, sem formulário) ou reduza o tamanho.',
            image: 'Salve de novo como JPG ou PNG comum — imagem com perfil de cor incomum costuma falhar aqui.',
            audio: 'Converta para mp3 ou ogg/opus.',
            video: 'Converta para mp4 (H.264) e reduza a duração.',
        };
        return `Falha no processamento da mídia pela Meta: ${oque}. `
            + `Reenviar o MESMO arquivo tende a falhar de novo. ${porTipo[midia.tipo] || 'Converta o arquivo ou reduza o tamanho.'} `
            + 'A cópia continua guardada no histórico da conversa.';
    }
    return comDono(detalhe ? `Falha na entrega: ${detalhe}` : 'Falha na entrega — confira o número e tente novamente.');
}

// Extensão por mime quando o WhatsApp não manda nome de arquivo (áudio e
// figurinha nunca mandam; imagem quase nunca).
const EXT_POR_MIME = {
    'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png',
    'image/webp': '.webp', 'image/gif': '.gif', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a', 'audio/amr': '.amr', 'video/mp4': '.mp4', 'video/3gpp': '.3gp',
};

/**
 * Caminho da mídia no Cloud Storage — mesmo desenho do XML cru: binário no
 * bucket, `storagePath` no documento. O wamid entra saneado (ele carrega
 * '=' e '.') e o nome original do arquivo fica DEPOIS do wamid, então dois
 * clientes mandando "comprovante.pdf" nunca colidem.
 */
export function caminhoStorageMidia(msg) {
    const wamid = String(msg.metaMessageId || '').replace(/[^A-Za-z0-9_-]/g, '_');
    const nome = String(msg.midia?.nomeArquivo || '').replace(/[^A-Za-z0-9._-]/g, '_');
    const ext = nome ? '' : (EXT_POR_MIME[String(msg.midia?.mime || '').split(';')[0]] || '.bin');
    return `whatsapp/${msg.de}/${wamid}${nome ? `_${nome}` : ext}`;
}

/** Resumo curto de uma mensagem pra "última mensagem" da conversa. */
export function resumoParaConversa(msg) {
    if (msg.texto) return String(msg.texto).slice(0, 140);
    if (msg.midia?.nomeArquivo) return `📎 ${msg.midia.nomeArquivo}`;
    const rotulos = { image: '🖼️ imagem', document: '📎 documento', audio: '🎙️ áudio', video: '🎬 vídeo', sticker: '🩹 figurinha' };
    return rotulos[msg.tipo] || `(${msg.tipo})`;
}

export const _internals = { tsParaIso, textoDaMensagem };
