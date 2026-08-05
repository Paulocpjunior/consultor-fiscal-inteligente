// ============================================================================
// sefaz-backend/dare-antecipacao-config.js
// ----------------------------------------------------------------------------
// Código de serviço DARE da ANTECIPAÇÃO do art. 426-A (Simples Nacional),
// guardado no banco — nunca numa constante do código.
//
// POR QUE ISSO EXISTE: a antecipação do 426-A é uma RUBRICA PRÓPRIA. Recolher
// no 04602 (DIFAL do Simples), que é o código que o app já conhece, colocaria
// o dinheiro na receita errada — o mesmo defeito que a guarda anti-rubrica da
// conversão GNRE→DARE existe pra impedir (24/07). E código de tributo não se
// chuta: é a regra do idAtividade do PGDAS-D, do COD_AJ da tabela 5.3 e do
// código de receita da GNRE.
//
// A FONTE QUE NÃO MENTE é a própria SEFAZ: a API DARE-ICMS credenciada tem o
// endpoint GET /receitas, que devolve os serviços aceitos. O admin cadastra
// ESCOLHENDO da lista real (botão "Serviços da SEFAZ" no modal), e fica
// auditado quem cadastrou e de qual ambiente veio.
//
// Enquanto não existir código cadastrado, a guia da antecipação é RECUSADA
// com a ação prática — nunca sai no código errado.
// ============================================================================

const COLECAO = 'dare_codigos_servico';
const DOC_ID = 'antecipacao_426a';

/**
 * Códigos que o app JÁ usa para outra coisa. Cadastrar um deles como
 * antecipação recriaria exatamente o erro que a trava impede: a guia sairia
 * com a natureza de outro tributo (DIFAL, ICMS próprio, ST do RPA).
 */
export const CODIGOS_JA_USADOS = ['04601', '14601', '04602'];

export const AMBIENTES_ACEITOS = ['homologacao', 'producao'];

/**
 * Valida o código antes de gravar (PURO).
 *
 * @param {string} codigo            código de serviço digitado/escolhido
 * @param {{receitasSefaz?: Array}} ctx  lista do GET /receitas, quando houver
 * @returns {{ok:true, codigo:string}|{ok:false, erro:string}}
 */
export function validarCodigoAntecipacao(codigo, ctx = {}) {
    const c = String(codigo ?? '').trim();
    if (!/^\d{4,6}$/.test(c)) {
        return {
            ok: false,
            erro: `Código de serviço inválido ("${codigo}"). É o número que a SEFAZ usa no DARE `
                + '(4 a 6 dígitos) — pegue na lista "Serviços da SEFAZ", não digite de memória.',
        };
    }
    if (CODIGOS_JA_USADOS.includes(c)) {
        const oQueE = c === '04602' ? 'o DIFAL do Simples'
            : c === '04601' ? 'o ICMS próprio do RPA' : 'o ICMS-ST do RPA';
        return {
            ok: false,
            erro: `O código ${c} é ${oQueE} — a antecipação do art. 426-A tem rubrica PRÓPRIA. `
                + 'Recolher nesse código põe o valor na receita errada e a SEFAZ não desfaz.',
        };
    }
    // Quando a lista real veio junto, o código TEM que estar nela: é a prova
    // de que existe na SEFAZ, e não um número parecido.
    const lista = Array.isArray(ctx.receitasSefaz) ? ctx.receitasSefaz : null;
    if (lista && lista.length > 0) {
        const achou = lista.some((r) => String(
            r?.codigoServicoDARE ?? r?.codigoServico ?? r?.codigo ?? '',
        ).replace(/\D/g, '').padStart(c.length, '0') === c);
        if (!achou) {
            return {
                ok: false,
                erro: `O código ${c} não aparece na lista de serviços que a SEFAZ devolveu. `
                    + 'Escolha um da lista — se a antecipação não estiver lá, o credenciamento '
                    + 'daquele ambiente não cobre esse serviço.',
            };
        }
    }
    return { ok: true, codigo: c };
}

/**
 * Monta a entrada no MESMO formato de CODIGOS_DARE_ICMS, pra `montarDare`
 * validar e o modal listar sem tratamento especial.
 */
export function servicoAntecipacao(cfg) {
    const c = cfg?.codigoServico;
    if (!c) return null;
    return {
        codigoServico: String(c),
        codigoReceita: String(cfg.codigoReceita || '').trim() || null,
        sefaz: cfg.sefaz || null,
        descricao: 'ICMS – Antecipação tributária (art. 426-A) – Simples Nacional',
        derivacao: 'antecipacao',
        regimes: ['simples'],
    };
}

/** Leitura (null quando nunca cadastrado — a guia fica bloqueada). */
export async function lerCodigoAntecipacao(db) {
    const snap = await db.collection(COLECAO).doc(DOC_ID).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    return d.codigoServico ? d : null;
}

export async function gravarCodigoAntecipacao(db, { codigo, codigoReceita, sefaz, ambiente, usuario }) {
    const doc = {
        codigoServico: String(codigo),
        codigoReceita: String(codigoReceita || '').trim() || null,
        sefaz: sefaz || null,
        ambienteOrigem: AMBIENTES_ACEITOS.includes(String(ambiente)) ? String(ambiente) : null,
        cadastradoPor: usuario || null,
        cadastradoEm: new Date().toISOString(),
    };
    await db.collection(COLECAO).doc(DOC_ID).set(doc, { merge: true });
    return doc;
}
