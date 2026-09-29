// ============================================================================
// 📝 RESUMO DA CONVERSA POR IA — o núcleo puro (29/09)
// ----------------------------------------------------------------------------
// Item 3 da comparação com o Clerk Chat: quem assume uma conversa lê três
// linhas em vez de rolar. O Gemini já está no circuito (triagem); aqui ele
// LÊ e RESUME — nunca responde ao cliente, nunca aplica etiqueta sozinho.
// Os "assuntos" que ele sugere são texto para a pessoa ler; classificar é
// decisão de gente (alerta, nunca contorno).
//
// O que mora aqui: qual fatia da conversa vai para o modelo, o prompt, e a
// leitura da resposta (JSON tolerante, com recusa nomeada quando não parse).
// Quem chama o modelo e grava é a rota.
// ============================================================================

export const MAX_MENSAGENS_RESUMO = 60;
export const MAX_CHARS_POR_MENSAGEM = 400;
export const TEMPO_MAX_RESUMO_MS = 15000;
export const MAX_CHARS_RESUMO = 900;

const ROTULO_TIPO = { image: '[imagem]', document: '[documento]', audio: '[áudio]', video: '[vídeo]', sticker: '[figurinha]', template: '[template]', chamada: '[ligação]' };

/**
 * Recorta as últimas N mensagens que o CLIENTE viu (entrada/saída). Nota
 * interna e transferência ficam de fora: são conversa da equipe, e o resumo
 * é sobre o que se combinou com o cliente.
 */
export function selecionarMensagensParaResumo(mensagens = [], limite = MAX_MENSAGENS_RESUMO) {
    const validas = (mensagens || [])
        .filter((m) => m && (m.direcao === 'entrada' || m.direcao === 'saida'))
        .filter((m) => Number.isFinite(Date.parse(m.timestamp || '')))
        .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const ultimas = validas.slice(-limite);
    return ultimas.map((m) => ({
        quem: m.direcao === 'entrada' ? 'cliente' : 'SP',
        quando: String(m.timestamp).slice(0, 16).replace('T', ' '),
        texto: (String(m.texto || '').trim() || ROTULO_TIPO[m.tipo] || `[${m.tipo || 'mensagem'}]`).slice(0, MAX_CHARS_POR_MENSAGEM),
    }));
}

/** O prompt. Sem grounding, sem "responda ao cliente": só ler e resumir. */
export function montarPromptResumo({ mensagens = [], nomeCliente = null, empresaNome = null } = {}) {
    const cabecalho = [
        'Você resume conversas de WhatsApp entre um escritório de contabilidade (SP) e um cliente, para o atendente que vai assumir.',
        `Cliente: ${nomeCliente || 'não informado'}${empresaNome ? ` · Empresa: ${empresaNome}` : ''}.`,
        'Responda SOMENTE um JSON com as chaves:',
        '  "resumo": 3 a 6 frases em português do Brasil, no passado, dizendo o que o cliente pediu, o que a SP respondeu e em que pé ficou (máx. 900 caracteres);',
        '  "pendencias": lista de até 5 itens curtos com o que ainda está em aberto (vazia se nada);',
        '  "assuntos": lista de até 4 palavras-chave (ex.: "DAS", "certificado digital", "folha");',
        '  "tom": "ok" ou "atencao" (atencao = cliente insatisfeito, prazo estourando, ou pedido sem resposta).',
        'Não invente fato que não está nas mensagens. Não dê orientação fiscal. Não escreva nada fora do JSON.',
        '',
        'MENSAGENS (mais antiga primeiro):',
    ];
    const linhas = mensagens.map((m) => `[${m.quando}] ${m.quem}: ${m.texto}`);
    return [...cabecalho, ...linhas].join('\n');
}

/** Lê o JSON do modelo (tolera ```json ... ``` e texto em volta). */
export function interpretarResumo(bruto) {
    const s = String(bruto ?? '').trim();
    if (!s) return { ok: false, motivo: 'resposta vazia' };
    const semCerca = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const ini = semCerca.indexOf('{');
    const fim = semCerca.lastIndexOf('}');
    if (ini < 0 || fim <= ini) return { ok: false, motivo: 'sem JSON na resposta' };
    let obj;
    try { obj = JSON.parse(semCerca.slice(ini, fim + 1)); } catch { return { ok: false, motivo: 'JSON ilegível' }; }
    const resumo = String(obj.resumo || '').trim().slice(0, MAX_CHARS_RESUMO);
    if (!resumo) return { ok: false, motivo: 'resumo vazio' };
    const lista = (v, n, tam) => (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, n).map((x) => x.slice(0, tam));
    return {
        ok: true,
        resumo: {
            texto: resumo,
            pendencias: lista(obj.pendencias, 5, 160),
            assuntos: lista(obj.assuntos, 4, 40),
            tom: obj.tom === 'atencao' ? 'atencao' : 'ok',
        },
    };
}

/**
 * O resumo guardado ainda cobre a conversa? Compara a última mensagem
 * resumida com a última da conversa. Sem resumo ⇒ 'nenhum'.
 */
export function estadoDoResumo(conversa) {
    const r = conversa?.resumoIa;
    if (!r?.texto) return 'nenhum';
    const ate = Date.parse(r.ateMensagemEm || '');
    const ult = Date.parse(conversa?.ultimaMensagem?.em || '');
    if (Number.isFinite(ult) && (!Number.isFinite(ate) || ult > ate)) return 'desatualizado';
    return 'atual';
}
