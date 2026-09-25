// ============================================================================
// sefaz-backend/adn-erro-catalogo.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 📖 CATÁLOGO DAS RECUSAS DO ADN (NFS-e Nacional, API DFe).
//
// Paulo, 25/09 (Diagnóstico de Captura, card ADN): dois CNPJs voltavam com
// `HTTP 400: {"StatusProcessamento":"REJEICAO","Erros":[{"Codigo":"E999",
// "Descricao":"Erro não catalogado"}]}` — o JSON cru na tela, sem dizer de
// quem é a falha nem o que fazer. *"pode catalogar E999 do ADN"*.
//
// A régua: o código do ADN é a ASSINATURA; o app traduz em (1) de quem é
// (serviço × CNPJ × cadastro), (2) o que fazer, (3) uma frase estável para o
// card AGRUPAR os CNPJs com a mesma causa. Código que o app não conhece sai
// DITO como desconhecido, com o código e a descrição do ADN — nunca some.
//
// ⚠️ E999 é o genérico do provedor ("erro não catalogado" lá, não aqui): o
// ADN não processou a consulta DESTE CNPJ. Quando algumas empresas passam e
// estas não, a causa é do CNPJ/município, não do serviço — e as causas
// conhecidas são cadastrais (município fora do ADN, empresa não habilitada
// no ambiente nacional). O app NÃO afirma qual delas é: diz as duas e onde
// conferir. Só quando TODAS falham igual é o serviço (deQuemEhAFalha).
// ============================================================================

/** Códigos que o app conhece. `escopo`: 'servico' | 'cnpj' | 'sucesso-vazio'. */
export const CATALOGO_ADN = {
    E999: {
        titulo: 'ADN recusou a consulta deste CNPJ (E999 — "erro não catalogado" no provedor nacional)',
        escopo: 'cnpj',
        acao: 'Não é certificado. As causas conhecidas são cadastrais: (1) o município do CNPJ não está no '
            + 'ADN (não aderiu ou saiu) — confira em nfse.gov.br → municípios aderentes; se não está, a tabela de '
            + 'caminhos do app está desatualizada para esse município: me avise com o código IBGE; (2) a empresa '
            + 'não está habilitada no ambiente nacional — confira no portal nacional com o certificado dela. '
            + 'Se TODAS as empresas do trilho falharem com E999 ao mesmo tempo, é o serviço: aguarde a próxima '
            + 'rodada. Reincidência conta ao lado.',
    },
    E2243: {
        titulo: 'ADN recusou o certificado (E2243 — CNPJ-base divergente)',
        escopo: 'cnpj',
        acao: 'O certificado usado não é da raiz do CNPJ consultado. Suba o A1 próprio da empresa (ou da matriz, '
            + 'mesma raiz) em Empresas → Certificado.',
    },
    E2220: {
        titulo: 'ADN sem documento novo (E2220 — nenhum documento encontrado)',
        escopo: 'sucesso-vazio',
        acao: 'Não é falha: o cursor está no fim. Nada a fazer.',
    },
};

/**
 * Extrai os erros do texto que o cliente/orquestrador gravou
 * ("pagina 1: HTTP 400: {json}"). Nunca lança.
 * @returns {Array<{codigo: string, descricao: string, mensagem: string}>}
 */
export function extrairErrosAdn(motivo) {
    const texto = String(motivo || '');
    const ini = texto.indexOf('{');
    const fim = texto.lastIndexOf('}');
    if (ini >= 0 && fim > ini) {
        try {
            const j = JSON.parse(texto.slice(ini, fim + 1));
            const lista = Array.isArray(j?.Erros) ? j.Erros : (Array.isArray(j?.erros) ? j.erros : []);
            const out = lista.map((e) => ({
                codigo: String(e?.Codigo || e?.codigo || '').toUpperCase().trim(),
                descricao: String(e?.Descricao || e?.descricao || '').trim(),
                mensagem: typeof (e?.Mensagem ?? e?.mensagem) === 'string' ? String(e.Mensagem ?? e.mensagem).trim() : '',
            })).filter((e) => e.codigo);
            if (out.length) return out;
        } catch { /* cai para a regex */ }
    }
    const m = /\b(E\d{3,4})\b/.exec(texto);
    return m ? [{ codigo: m[1].toUpperCase(), descricao: '', mensagem: '' }] : [];
}

/** Só o código HTTP, se houver. */
function httpDoMotivo(motivo) {
    const m = /HTTP\s+(\d{3})/.exec(String(motivo || ''));
    return m ? Number(m[1]) : null;
}

/**
 * Traduz um motivo de falha do ADN.
 *
 * @returns {{
 *   codigo: string|null, conhecido: boolean, escopo: 'servico'|'cnpj'|'sucesso-vazio'|'indeterminado',
 *   titulo: string, acao: string|null, frase: string, http: number|null
 * }}
 * `frase` é estável por CAUSA (sem CNPJ, sem trace): é a chave de agrupamento do card.
 */
export function catalogarErroAdn(motivo) {
    const erros = extrairErrosAdn(motivo);
    const http = httpDoMotivo(motivo);
    if (!erros.length) {
        const cru = String(motivo || '').replace(/^pagina \d+:\s*/i, '').slice(0, 140);
        return { codigo: null, conhecido: false, escopo: 'indeterminado', titulo: cru || 'falha sem motivo', acao: null, frase: cru || 'falha sem motivo', http };
    }
    const e = erros[0];
    const cat = CATALOGO_ADN[e.codigo];
    if (cat) {
        return { codigo: e.codigo, conhecido: true, escopo: cat.escopo, titulo: cat.titulo, acao: cat.acao, frase: cat.titulo, http };
    }
    const titulo = `ADN recusou com ${e.codigo}${e.descricao ? ` — "${e.descricao}"` : ''} (código que o app ainda não cataloga)`;
    return {
        codigo: e.codigo, conhecido: false, escopo: 'indeterminado', titulo,
        acao: `Leve o código ${e.codigo}${e.descricao ? ` ("${e.descricao}")` : ''} ao manual da API DFe do ADN e me avise para catalogar com a ação certa.`,
        frase: titulo, http,
    };
}

const dataBr = (ms) => {
    const d = new Date(Number(ms));
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

/**
 * O que gravar no estado do CNPJ depois de uma rodada — PURO.
 * Falha com código: conta execuções seguidas e guarda desde quando.
 * Sucesso: limpa. `anterior` é o `erroAtual` já gravado (ou null).
 */
export function proximoErroAtual({ anterior = null, motivo = null, agoraMs = Date.now() } = {}) {
    if (!motivo) return null;
    const cat = catalogarErroAdn(motivo);
    if (cat.escopo === 'sucesso-vazio') return null;
    const mesmo = anterior && anterior.codigo === cat.codigo && anterior.codigo != null;
    return {
        codigo: cat.codigo,
        frase: cat.frase,
        motivo: String(motivo).slice(0, 300),
        primeiraEm: mesmo && anterior.primeiraEm ? anterior.primeiraEm : agoraMs,
        ultimaEm: agoraMs,
        execucoes: mesmo ? Number(anterior.execucoes || 0) + 1 : 1,
    };
}

/** "há 3 execuções seguidas desde 23/09" — ou '' se não há reincidência. */
export function textoDaReincidencia(erroAtual) {
    if (!erroAtual || !(erroAtual.execucoes > 1)) return '';
    return `há ${erroAtual.execucoes} execuções seguidas desde ${dataBr(erroAtual.primeiraEm)}`;
}

/**
 * Agrupa os erros registrados por CAUSA (frase do catálogo), com os CNPJs.
 * @param {Array<{empresaCnpj?: string, motivo?: string}>} registros
 * @param {{maxMotivos?: number, maxCnpjs?: number, reincidenciaPorCnpj?: Object<string, object>}} [p]
 * @returns {Array<{motivo: string, quantidade: number, codigo: string|null, acao: string|null, cnpjs: string[]}>}
 */
export function agruparFalhasAdn(registros, { maxMotivos = 3, maxCnpjs = 5, reincidenciaPorCnpj = {} } = {}) {
    const grupos = new Map();
    for (const r of registros || []) {
        const cat = catalogarErroAdn(r?.motivo);
        if (cat.escopo === 'sucesso-vazio') continue;
        const g = grupos.get(cat.frase) || { frase: cat.frase, codigo: cat.codigo, acao: cat.acao, quantidade: 0, cnpjs: new Set() };
        g.quantidade += 1;
        const c = String(r?.empresaCnpj || '').replace(/\D/g, '');
        if (c) g.cnpjs.add(c);
        grupos.set(cat.frase, g);
    }
    return [...grupos.values()]
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, maxMotivos)
        .map((g) => {
            const cnpjs = [...g.cnpjs];
            const mostrados = cnpjs.slice(0, maxCnpjs);
            const reinc = cnpjs
                .map((c) => ({ c, t: textoDaReincidencia(reincidenciaPorCnpj[c]) }))
                .filter((x) => x.t)
                .map((x) => `${x.c}: ${x.t}`);
            const partes = [];
            if (mostrados.length) partes.push(`CNPJ ${mostrados.join(', ')}${cnpjs.length > mostrados.length ? ` e mais ${cnpjs.length - mostrados.length}` : ''}`);
            if (reinc.length) partes.push(reinc.join('; '));
            return {
                motivo: `${g.frase}${partes.length ? ` — ${partes.join(' · ')}` : ''}`,
                quantidade: g.quantidade,
                codigo: g.codigo,
                acao: g.acao,
                cnpjs,
            };
        });
}
