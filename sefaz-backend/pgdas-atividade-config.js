// ============================================================================
// sefaz-backend/pgdas-atividade-config.js
// ----------------------------------------------------------------------------
// Código OFICIAL da atividade "ISS fixo (SUP)" do PGDAS-D, guardado no banco.
//
// POR QUE ISSO EXISTE: o número da atividade
//   "Prestação de Serviços, exceto para o exterior — Escritórios de serviços
//    contábeis autorizados pela legislação municipal a pagar o ISS em valor
//    fixo em guia do Município"  (LC 123 art. 18 §22-A)
// não está na tela do PGDAS-D nem na doc do SERPRO acessível deste ambiente,
// e o DAS dessas empresas fica BLOQUEADO até ele existir (Paulo, 03/08:
// "leva errado pro SIMPLES"). Deixar o número numa constante do código
// significa esperar um deploy pra destravar um cliente — então ele mora no
// banco e o admin cadastra pela tela, no minuto em que descobrir.
//
// A REGRA QUE NÃO PODE CAIR: o número tem que vir de uma DECLARAÇÃO REAL da
// própria empresa (botão "🔎 Atividades declaradas" → CONSULTIMADECREC14) ou
// da tela do e-CAC. Por isso a origem é obrigatória e fica auditada com quem
// cadastrou. Código fiscal não se chuta — mesma regra do código de tributo do
// MIT e do código de receita da GNRE.
// ============================================================================

const COLECAO = 'pgdas_atividades_codigos';
const DOC_ID = 'iss_fixo_contabil';

/**
 * Ids que JÁ significam "ISS retido/substituído pelo tomador" (Anexo III, V e
 * IV). Cadastrar um deles como SUP recriaria exatamente o defeito que a trava
 * existe pra impedir: natureza "o tomador reteve" numa receita que não teve
 * retenção nenhuma.
 */
export const IDS_RETENCAO_ISS = [12, 15, 18];

/** Ids de atividade que o app já monta sozinho — cadastrar um deles é engano. */
export const IDS_JA_MAPEADOS = [1, 2, 3, 4, 5, 6, 11, 12, 14, 15, 17, 18, 29, 30, 31];

export const ORIGENS_ACEITAS = ['declaracao', 'ecac'];

/**
 * Valida o número antes de gravar (PURO).
 *
 * @param {unknown} id            número informado
 * @param {object}  [p]
 * @param {string}  [p.origem]    'declaracao' (lido pelo 🔎) | 'ecac' (tela)
 * @param {number[]} [p.idsDeclarados] ids lidos de uma declaração aceita —
 *        quando vierem, o número PRECISA estar entre eles.
 * @returns {{ok: boolean, id?: number, erro?: string}}
 */
export function validarIdAtividadeSup(id, { origem, idsDeclarados } = {}) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0 || n > 999) {
        return { ok: false, erro: 'O código da atividade é um número inteiro entre 1 e 999.' };
    }

    if (IDS_RETENCAO_ISS.includes(n)) {
        return {
            ok: false,
            erro: `O código ${n} significa "ISS retido/substituído pelo tomador" — é justamente `
                + 'a natureza errada que o bloqueio impede. O ISS fixo (SUP) tem código próprio.',
        };
    }

    if (IDS_JA_MAPEADOS.includes(n)) {
        return {
            ok: false,
            erro: `O código ${n} já é usado pelo app para outra atividade. Confira o número na `
                + 'declaração antes de cadastrar.',
        };
    }

    if (origem !== undefined && !ORIGENS_ACEITAS.includes(String(origem))) {
        return {
            ok: false,
            erro: 'Informe de onde veio o código: "declaracao" (lido pelo 🔎 Atividades '
                + 'declaradas) ou "ecac" (tela do PGDAS-D). Código fiscal não se cadastra de memória.',
        };
    }

    if (Array.isArray(idsDeclarados) && idsDeclarados.length > 0) {
        const encontrados = idsDeclarados.map(Number);
        if (!encontrados.includes(n)) {
            return {
                ok: false,
                erro: `O código ${n} não aparece na declaração lida (${encontrados.join(', ')}). `
                    + 'Cadastre um código que a própria empresa já declarou.',
            };
        }
    }

    return { ok: true, id: n };
}

/** Lê o código cadastrado. Devolve null quando ainda não existe (= DAS bloqueado). */
export async function lerCodigoAtividadeSup(db) {
    try {
        const snap = await db.collection(COLECAO).doc(DOC_ID).get();
        if (!snap.exists) return null;
        const d = snap.data() || {};
        return Number.isInteger(d.idAtividade) ? d : null;
    } catch (e) {
        // Falha de leitura NÃO libera a emissão — quem decide é o bloqueio.
        console.error('[pgdas-atividade-config] leitura falhou:', e.message);
        return null;
    }
}

/** Grava o código com a auditoria de quem cadastrou e de onde tirou. */
export async function gravarCodigoAtividadeSup(db, { id, origem, cnpjOrigem, competenciaOrigem, usuario }) {
    const doc = {
        idAtividade: id,
        origem: origem || null,
        cnpjOrigem: cnpjOrigem || null,
        competenciaOrigem: competenciaOrigem || null,
        atualizadoPor: usuario || null,
        atualizadoEm: new Date().toISOString(),
    };
    await db.collection(COLECAO).doc(DOC_ID).set(doc, { merge: false });
    return doc;
}

export const COLECAO_ATIVIDADES_CODIGOS = COLECAO;
