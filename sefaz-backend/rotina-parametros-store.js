/**
 * rotina-parametros-store.js — ⚙️ Parâmetros da Rotina do escritório (28/09).
 *
 * Um documento: `parametros_rotina/escritorio`. A régua (o que cada valor
 * faz e o padrão) mora em `rotina-fiscal.js`; aqui é só leitura/gravação.
 * Ausente = padrão. Valor ilegível no doc = padrão (normalizar é do dono).
 */
import { normalizarParametrosRotina, OPCOES_CIENCIA_APOS_COMPLETA_MANUAL } from './rotina-fiscal.js';

export const COLECAO_PARAMETROS_ROTINA = 'parametros_rotina';
export const DOC_PARAMETROS_ESCRITORIO = 'escritorio';

/** @returns {Promise<{parametros: object, gravado: object|null}>} */
export async function lerParametrosRotina(db) {
    let gravado = null;
    try {
        const snap = await db.collection(COLECAO_PARAMETROS_ROTINA).doc(DOC_PARAMETROS_ESCRITORIO).get();
        gravado = snap.exists ? (snap.data() || null) : null;
    } catch (e) {
        // Falhar em LER não pode derrubar a Rotina inteira: cai no padrão, dito.
        console.warn('[rotina-parametros] leitura falhou, usando o padrão:', e?.message || e);
        gravado = null;
    }
    return { parametros: normalizarParametrosRotina(gravado), gravado };
}

/** Confere o corpo vindo da tela; devolve {ok, erro?, valores?}. PURO. */
export function conferirParametrosRotina(body) {
    const b = body || {};
    const valores = {};
    if (b.cienciaAposCompletaManual !== undefined) {
        if (!OPCOES_CIENCIA_APOS_COMPLETA_MANUAL.includes(b.cienciaAposCompletaManual)) {
            return { ok: false, erro: `cienciaAposCompletaManual precisa ser ${OPCOES_CIENCIA_APOS_COMPLETA_MANUAL.join(' ou ')}.` };
        }
        valores.cienciaAposCompletaManual = b.cienciaAposCompletaManual;
    }
    if (Object.keys(valores).length === 0) return { ok: false, erro: 'Nenhum parâmetro reconhecido no pedido.' };
    return { ok: true, valores };
}

export async function gravarParametrosRotina(db, { valores, por }) {
    const patch = { ...valores, atualizadoEm: new Date().toISOString(), atualizadoPor: por || null };
    await db.collection(COLECAO_PARAMETROS_ROTINA).doc(DOC_PARAMETROS_ESCRITORIO).set(patch, { merge: true });
    return lerParametrosRotina(db);
}
