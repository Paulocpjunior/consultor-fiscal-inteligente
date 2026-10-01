// ============================================================================
// 📣 CAMPANHAS EM LOTE POR TEMPLATE — o núcleo puro (29/09)
// ----------------------------------------------------------------------------
// Item 1 da comparação com o Clerk Chat (Paulo, 29/09: "vamos implementar 1,
// 2 e 3"): aviso de prazo (DAS, DCTFWeb, parcelamento) para todas as empresas
// de um regime, com personalização, opt-out e registro em cada conversa.
//
// O que mora aqui é DECISÃO, sem banco e sem rede: validar a campanha,
// montar o PÚBLICO a partir dos contatos (com o motivo de cada um que ficou
// de fora), personalizar as variáveis por destinatário e recortar o lote de
// cada tick. Quem envia é a rota.
//
// ⚠️ REGRAS QUE NÃO SE CONTORNAM:
//  · Campanha sai SÓ por template aprovado pela Meta (fora da janela de 24h
//    texto livre não existe — e campanha é, por definição, fora da janela).
//  · MARKETING exige consentimento registrado (LGPD art. 7º, I): só sai para
//    etiqueta cuja base legal pede consentimento, e só para quem o tem. A
//    régua é a MESMA de `podeEnviarPorEtiqueta` — não há segunda régua.
//  · Quem pediu PARAR/SAIR não recebe mais nada em lote. Nunca.
//  · Número inválido, contato repetido, sem empresa no regime: fica de fora
//    NOMEADO. "N destinatários" sem os pulados seria farol falso.
// ============================================================================
import { podeEnviarPorEtiqueta, BASES_LEGAIS } from './whatsapp-etiquetas.js';
import { normalizarNumeroBr } from './whatsapp-cloud.js';

export const COLECAO_CAMPANHAS = 'whatsapp_campanhas';
export const TIPOS_PUBLICO = ['etiqueta', 'regime', 'numeros'];
export const REGIMES_CAMPANHA = ['simples', 'lucro'];
export const STATUS_CAMPANHA = ['rascunho', 'enviando', 'pausada', 'concluida'];
export const CATEGORIAS_CAMPANHA = ['UTILITY', 'MARKETING'];
/** Destinatários enviados por rodada (o cron roda a cada 5 min ⇒ ~300/h). */
export const LOTE_CAMPANHA = 25;
/** Teto de destinatários por campanha — acima disso é outra ferramenta. */
export const MAX_DESTINATARIOS = 2000;
export const PALAVRAS_OPT_OUT = ['parar', 'sair', 'cancelar', 'stop', 'descadastrar', 'nao quero receber', 'não quero receber'];
/** Tokens de personalização aceitos nas variáveis. */
export const TOKENS_PERSONALIZACAO = ['{empresa}', '{nome}'];

/** "PARAR", "Sair.", "não quero receber" ⇒ opt-out. Frase longa não é. */
export function ehPedidoDeOptOut(texto) {
    const t = String(texto || '').trim().toLowerCase().replace(/[.!\s]+$/g, '');
    if (!t || t.length > 30) return false;
    return PALAVRAS_OPT_OUT.includes(t);
}

export function validarCampanha(p = {}) {
    const nome = String(p.nome || '').trim();
    if (!nome) return { ok: false, erro: 'Dê um nome à campanha (ex.: "DAS 10/2026 — vencimento 20/10").' };
    if (nome.length > 120) return { ok: false, erro: 'Nome longo demais (máx. 120).' };
    const template = p.template || {};
    const tNome = String(template.nome || '').trim();
    const tIdioma = String(template.idioma || 'pt_BR').trim();
    if (!tNome) return { ok: false, erro: 'Escolha o template aprovado na Meta.' };
    const categoria = String(template.categoria || '').toUpperCase();
    if (!CATEGORIAS_CAMPANHA.includes(categoria)) return { ok: false, erro: `Categoria do template desconhecida ("${template.categoria || '?'}") — só UTILITY e MARKETING saem em campanha.` };
    const esperadas = Number(template.variaveis);
    const variaveis = Array.isArray(p.variaveis) ? p.variaveis.map((v) => String(v ?? '').trim()) : [];
    if (Number.isFinite(esperadas) && esperadas >= 0 && variaveis.length !== esperadas) {
        return { ok: false, erro: `O template "${tNome}" tem ${esperadas} variável(is); vieram ${variaveis.length}.` };
    }
    if (variaveis.some((v) => !v)) return { ok: false, erro: 'Preencha todas as variáveis — a Meta recusa envio meio preenchido.' };

    const publico = p.publico || {};
    const tipo = String(publico.tipo || '');
    if (!TIPOS_PUBLICO.includes(tipo)) return { ok: false, erro: `Público inválido (use ${TIPOS_PUBLICO.join(', ')}).` };
    if (tipo === 'etiqueta' && !String(publico.etiqueta || '').trim()) return { ok: false, erro: 'Escolha a etiqueta do público.' };
    if (tipo === 'regime' && !REGIMES_CAMPANHA.includes(String(publico.regime || ''))) return { ok: false, erro: `Regime inválido (use ${REGIMES_CAMPANHA.join(' ou ')}).` };
    if (tipo === 'numeros') {
        const lista = Array.isArray(publico.numeros) ? publico.numeros : [];
        if (!lista.length) return { ok: false, erro: 'Informe ao menos um número.' };
        if (lista.length > MAX_DESTINATARIOS) return { ok: false, erro: `No máximo ${MAX_DESTINATARIOS} números por campanha.` };
    }
    if (categoria === 'MARKETING' && tipo !== 'etiqueta') {
        return { ok: false, erro: 'Campanha de MARKETING só sai para uma ETIQUETA cuja base legal seja consentimento — é a LGPD (art. 7º, I).', acao: 'Escolha o público "etiqueta" com consentimento registrado, ou use um template UTILITY (aviso de prazo/obrigação).' };
    }
    return {
        ok: true,
        campanha: {
            nome,
            template: { nome: tNome, idioma: tIdioma, categoria, corpo: template.corpo ? String(template.corpo) : null, departamento: template.departamento ? String(template.departamento) : null },
            variaveis,
            publico: {
                tipo,
                etiqueta: tipo === 'etiqueta' ? String(publico.etiqueta).trim() : null,
                regime: tipo === 'regime' ? String(publico.regime) : null,
                numeros: tipo === 'numeros' ? publico.numeros.map((n) => String(n)) : null,
            },
        },
    };
}

/**
 * Monta o público. Entrada: os contatos (docs de whatsapp_contatos com
 * `numero`, `nomePerfil`, `empresaId`, `empresaNome`, `etiquetas`,
 * `consentimentos`, `optOutCampanhas`), o catálogo de etiquetas e um Map
 * empresaId → { nome, regime }. Saída: quem recebe e quem fica de fora,
 * cada um com o motivo.
 */
export function montarPublico({ campanha, contatos = [], catalogoEtiquetas = [], empresas = new Map(), bloqueados = new Set() } = {}) {
    const pub = campanha?.publico || {};
    const categoria = campanha?.template?.categoria || 'UTILITY';
    const destinatarios = [];
    const pulados = [];
    const vistos = new Set();
    const empresaDe = (c) => (c.empresaId && empresas.get(c.empresaId)) || null;

    const considerar = (c, origem) => {
        const numero = normalizarNumeroBr(c.numero);
        if (!numero) { pulados.push({ numero: String(c.numero || '?'), motivo: 'numero-invalido' }); return; }
        if (vistos.has(numero)) return;                      // repetido: nem conta como pulado
        vistos.add(numero);
        // 🚫 Lista negra (01/10): bloqueado não recebe NADA, nem em lote.
        if (bloqueados.has(numero)) { pulados.push({ numero, motivo: 'bloqueado' }); return; }
        if (c.optOutCampanhas?.em) { pulados.push({ numero, motivo: 'opt-out', em: c.optOutCampanhas.em }); return; }
        if (pub.tipo === 'etiqueta') {
            const p = podeEnviarPorEtiqueta(c, pub.etiqueta, catalogoEtiquetas);
            if (!p.pode) { pulados.push({ numero, motivo: 'sem-consentimento', detalhe: p.motivo }); return; }
        }
        if (categoria === 'MARKETING') {
            const e = catalogoEtiquetas.find((x) => x.id === pub.etiqueta);
            if (!BASES_LEGAIS[e?.baseLegal]?.pedeConsentimento) { pulados.push({ numero, motivo: 'etiqueta-sem-base-de-consentimento' }); return; }
        }
        const emp = empresaDe(c);
        destinatarios.push({
            numero,
            nome: c.nomePerfil || null,
            empresaId: c.empresaId || null,
            empresaNome: emp?.nome || c.empresaNome || null,
            origem,
            status: 'pendente', motivo: null, messageId: null, em: null,
        });
    };

    if (pub.tipo === 'etiqueta') {
        for (const c of contatos) if (Array.isArray(c.etiquetas) && c.etiquetas.includes(pub.etiqueta)) considerar(c, 'etiqueta');
    } else if (pub.tipo === 'regime') {
        for (const c of contatos) {
            const emp = empresaDe(c);
            if (emp && emp.regime === pub.regime) considerar(c, 'regime');
        }
    } else if (pub.tipo === 'numeros') {
        const porNumero = new Map(contatos.map((c) => [normalizarNumeroBr(c.numero), c]).filter(([n]) => n));
        for (const n of pub.numeros || []) {
            const norm = normalizarNumeroBr(n);
            considerar(porNumero.get(norm) || { numero: n }, 'lista');
        }
    }
    if (destinatarios.length > MAX_DESTINATARIOS) {
        return { destinatarios: destinatarios.slice(0, MAX_DESTINATARIOS), pulados, truncado: true, limite: MAX_DESTINATARIOS };
    }
    return { destinatarios, pulados, truncado: false, limite: MAX_DESTINATARIOS };
}

/** `{empresa}` e `{nome}` viram o dado do destinatário; sem dado, o token NÃO sai. */
export function variaveisDoDestinatario(variaveis = [], dest = {}) {
    const empresa = String(dest.empresaNome || '').trim();
    const nome = String(dest.nome || '').trim();
    const faltando = [];
    const saida = variaveis.map((v) => {
        let s = String(v ?? '');
        if (s.includes('{empresa}')) { if (!empresa) faltando.push('{empresa}'); s = s.split('{empresa}').join(empresa); }
        if (s.includes('{nome}')) { if (!nome) faltando.push('{nome}'); s = s.split('{nome}').join(nome); }
        return s.trim();
    });
    if (faltando.length) return { ok: false, motivo: `sem dado para ${[...new Set(faltando)].join(', ')}` };
    if (saida.some((s) => !s)) return { ok: false, motivo: 'variável vazia depois da personalização' };
    return { ok: true, variaveis: saida };
}

/** Os índices dos próximos `tamanho` destinatários pendentes. */
export function proximoLote(destinatarios = [], tamanho = LOTE_CAMPANHA) {
    const idx = [];
    for (let i = 0; i < destinatarios.length && idx.length < tamanho; i += 1) {
        if (destinatarios[i]?.status === 'pendente') idx.push(i);
    }
    return idx;
}

export function totaisDaCampanha(destinatarios = []) {
    const t = { total: destinatarios.length, pendentes: 0, enviados: 0, falhas: 0, pulados: 0 };
    for (const d of destinatarios) {
        if (d.status === 'enviado') t.enviados += 1;
        else if (d.status === 'falhou') t.falhas += 1;
        else if (d.status === 'pulado') t.pulados += 1;
        else t.pendentes += 1;
    }
    return t;
}

/** Campanha terminou quando não sobra pendente. */
export function campanhaConcluida(destinatarios = []) {
    return totaisDaCampanha(destinatarios).pendentes === 0;
}

/** Só o que a lista da ⚙️ mostra (sem os destinatários inteiros). */
export function resumoDaCampanha(c) {
    const totais = totaisDaCampanha(c.destinatarios || []);
    return {
        id: c.id, nome: c.nome, status: c.status, template: c.template, variaveis: c.variaveis || [],
        publico: c.publico, totais, puladosNoPublico: Array.isArray(c.puladosNoPublico) ? c.puladosNoPublico.length : 0,
        criadoPor: c.criadoPor || null, criadoEm: c.criadoEm || null, iniciadoEm: c.iniciadoEm || null,
        concluidoEm: c.concluidoEm || null, ultimoLoteEm: c.ultimoLoteEm || null,
    };
}

/** A linha que entra na conversa de cada destinatário. */
export function textoDaMensagemDeCampanha({ campanha, corpoRenderizado }) {
    if (corpoRenderizado) return `📣 ${corpoRenderizado}`;
    return `📣 Campanha "${campanha.nome}" (template ${campanha.template?.nome})`;
}
