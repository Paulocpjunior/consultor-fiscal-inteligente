// ============================================================================
// sefaz-backend/nfse-nacional-dfe-orchestrator.js
// ----------------------------------------------------------------------------
// Orquestra a captura de DF-e da NFSe Nacional pra uma empresa:
//   1. Lock (mesma mecânica do SEFAZ — evita duas sincronizações simultâneas)
//   2. Lê último NSU conhecido em nfse_nacional_dfe_state/{cnpj}
//   3. Loop: chama ADN, importa cada item, atualiza NSU, repete até maxNSU
//   4. Para se atingir limite, rate-limit, ou cStat inesperado
//
// Coleções Firestore criadas:
//   nfse_nacional_dfe_state/{cnpj}    — ultNSU, ultimaSync, maxNSU
//   nfse_nacional_dfe_locks/{cnpj}    — startedAt, expiresAt
//   nfse_nacional_dfe_log/{auto}      — auditoria de execuções
//   nfse_nacional_dfe_erros/{auto}    — erros (criado pelo importer)
// ============================================================================

import admin from 'firebase-admin';
import { consultarDFe } from './nfse-nacional-dfe-client.js';
import { importarDfeNfseNacional, registrarErroNfseNacionalDfe } from './nfse-nacional-dfe-importer.js';

const LOCK_TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_PAGINAS = 10;             // 10 * 50 = 500 docs/empresa por execução

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

async function acquireLock(cnpj, lockedBy) {
    const cnpjNum = String(cnpj).replace(/\D/g, '');
    const ref = fa().firestore().collection('nfse_nacional_dfe_locks').doc(cnpjNum);
    const now = Date.now();
    const expiresAt = now + LOCK_TTL_MS;

    const result = await fa().firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
            const data = snap.data();
            const exp = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : data.expiresAt;
            if (exp > now) {
                const minutos = Math.ceil((exp - now) / 60000);
                return {
                    ok: false,
                    motivo: `Já sincronizado recentemente. Próxima janela em ${minutos} min.`,
                };
            }
        }
        tx.set(ref, {
            startedAt: fa().firestore.Timestamp.fromMillis(now),
            expiresAt: fa().firestore.Timestamp.fromMillis(expiresAt),
            lockedBy,
        });
        return { ok: true };
    });
    return result;
}

/**
 * Libera o lock manualmente (em caso de excecao). Em sucesso, o lock e
 * mantido ate TTL pra preservar o rate-limit do SERPRO (evita 2 syncs
 * concorrentes na mesma empresa).
 */
async function releaseLock(cnpj) {
    const cnpjNum = String(cnpj).replace(/\D/g, '');
    const ref = fa().firestore().collection('nfse_nacional_dfe_locks').doc(cnpjNum);
    try {
        await ref.delete();
    } catch (e) {
        console.warn('[nfse-nac-dfe orch] erro liberando lock:', e.message);
    }
}

/**
 * Limpa locks orfaos (expirados). Util pra cobrir caso raro de processo
 * morto antes do catch (ex: OOM kill no Cloud Run) — sem isso o lock
 * fica ate o TTL natural de 1h. Chamada no inicio do cron noturno e
 * tambem exposta como rota admin pra cleanup manual.
 *
 * Retorna { total: locks varridos, removidos: locks orfaos apagados }.
 */
export async function limparLocksOrfaos() {
    const db = fa().firestore();
    const now = Date.now();
    const snap = await db.collection('nfse_nacional_dfe_locks').get();
    let total = 0, removidos = 0;
    // Chunking de delete pra nao estourar batch de 500
    const refsParaApagar = [];
    snap.forEach(doc => {
        total++;
        const exp = doc.data().expiresAt?.toMillis?.() ?? doc.data().expiresAt;
        if (exp && exp < now) refsParaApagar.push(doc.ref);
    });
    const CHUNK = 450;
    for (let i = 0; i < refsParaApagar.length; i += CHUNK) {
        const batch = db.batch();
        const slice = refsParaApagar.slice(i, i + CHUNK);
        for (const ref of slice) batch.delete(ref);
        await batch.commit();
        removidos += slice.length;
    }
    return { total, removidos };
}

async function carregaUltNSU(cnpj) {
    const cnpjNum = String(cnpj).replace(/\D/g, '');
    const ref = fa().firestore().collection('nfse_nacional_dfe_state').doc(cnpjNum);
    const snap = await ref.get();
    return snap.exists ? (snap.data().ultNSU || '0') : '0';
}

async function persisteUltNSU(cnpj, ultNSU, info = {}) {
    const cnpjNum = String(cnpj).replace(/\D/g, '');
    const ref = fa().firestore().collection('nfse_nacional_dfe_state').doc(cnpjNum);
    await ref.set({
        cnpj: cnpjNum,
        ultNSU,
        ultimaSync: fa().firestore.FieldValue.serverTimestamp(),
        ...info,
    }, { merge: true });
}

async function registrarLog(cnpj, payload) {
    try {
        const db = fa().firestore();
        await db.collection('nfse_nacional_dfe_log').add({
            cnpj: String(cnpj || '').replace(/\D/g, ''),
            ...payload,
            registradoEm: fa().firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        console.warn('[nfse-nac-dfe orch] erro registrando log:', e.message);
    }
}

/**
 * Captura DF-e de uma empresa.
 *
 * @param {object} args - { empresaId, empresaCnpj, capturadoPor }
 * @returns {Promise<{ok, novos, duplicados, erros, ultNSU, paginas, motivo?}>}
 */
export async function sincronizarEmpresaNfseNacionalDfe({ empresaId, empresaCnpj, capturadoPor }) {
    const cnpjNum = String(empresaCnpj).replace(/\D/g, '');
    if (cnpjNum.length !== 14) return { ok: false, motivo: `CNPJ inválido: ${empresaCnpj}` };

    const lock = await acquireLock(cnpjNum, capturadoPor?.email || capturadoPor?.uid || 'system');
    if (!lock.ok) return { ok: false, motivo: lock.motivo, locked: true };

    let ultNSU = await carregaUltNSU(cnpjNum);
    let maxNSU = null;
    let novos = 0;
    let duplicados = 0;
    let erros = 0;
    let paginas = 0;
    let motivoFinal = null;
    let fonteCert = null;

    try {
        while (paginas < MAX_PAGINAS) {
            paginas++;
            const r = await consultarDFe({ empresaId, empresaCnpj: cnpjNum, nsu: ultNSU });
            fonteCert = r.fonte;

            if (!r.ok) {
                motivoFinal = `pagina ${paginas}: ${r.motivo}`;
                erros++;
                await registrarErroNfseNacionalDfe({
                    empresaId, empresaCnpj: cnpjNum,
                    motivo: motivoFinal,
                    contexto: { statusCode: r.statusCode, nsu: ultNSU },
                });
                break;
            }

            const lote = r.lote || [];
            maxNSU = r.maxNSU || maxNSU;

            for (const item of lote) {
                try {
                    const result = await importarDfeNfseNacional({
                        empresaId,
                        empresaCnpj: cnpjNum,
                        item,
                        capturadoPor,
                    });
                    if (result.status === 'novo') novos++;
                    else if (result.status === 'duplicado') duplicados++;
                    else erros++;
                } catch (e) {
                    erros++;
                    await registrarErroNfseNacionalDfe({
                        empresaId, empresaCnpj: cnpjNum,
                        motivo: e.message,
                        contexto: { nsu: item?.nsu },
                    });
                }
            }

            // Avança o cursor — ADN devolve o novo ultNSU
            if (r.ultNSU && r.ultNSU !== ultNSU) {
                ultNSU = r.ultNSU;
            }

            // Acabou: NSU bateu o máximo ou lote veio vazio
            if (lote.length === 0 || (maxNSU && ultNSU >= maxNSU)) break;
        }

        // Persiste cursor final
        await persisteUltNSU(cnpjNum, ultNSU, {
            maxNSU,
            ultimaSyncFonte: 'nfse-nacional-dfe-adn',
            ultimaSyncCert: fonteCert,
        });

        await registrarLog(cnpjNum, {
            empresaId,
            sucesso: !motivoFinal,
            novos, duplicados, erros, paginas,
            ultNSU, maxNSU, fonteCert,
            motivo: motivoFinal,
        });

        return {
            ok: !motivoFinal,
            novos, duplicados, erros, paginas,
            ultNSU, maxNSU,
            fonteCert,
            motivo: motivoFinal,
        };
    } catch (e) {
        motivoFinal = `exceção: ${e.message}`;
        // Libera o lock em caso de excecao pra nao bloquear retry por 1h.
        // Sucesso mantem o lock ate TTL pra preservar rate-limit SERPRO.
        await releaseLock(cnpjNum);
        await registrarLog(cnpjNum, {
            empresaId, sucesso: false,
            novos, duplicados, erros, paginas, motivo: motivoFinal,
        });
        return { ok: false, motivo: motivoFinal };
    }
}
