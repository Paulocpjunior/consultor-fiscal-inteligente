// ============================================================================
// sefaz-backend/sync-orchestrator.js  (ESM)
// Coordena 1 sincronização SEFAZ: lock + cliente + importer + cursor NSU.
// ============================================================================

import admin from 'firebase-admin';
import { consultaDistDFe } from './sefaz-client.js';
import { importarXmlSefaz, registrarErroSefaz } from './xml-importer.js';

const LOCK_TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_PAGINAS = 5;

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

async function acquireLock(cnpj, lockedBy) {
  const cnpjNum = String(cnpj).replace(/\D/g, '');
  const ref = fa().firestore().collection('sefaz_locks').doc(cnpjNum);
  const now = Date.now();
  const expiresAt = now + LOCK_TTL_MS;

  const result = await fa().firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data();
      const exp = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : data.expiresAt;
      if (exp > now) {
        const minutosRestantes = Math.ceil((exp - now) / 60000);
        const startedMs = data.startedAt?.toMillis?.() || data.startedAt;
        return {
          ok: false,
          motivo: `Já sincronizado às ${new Date(startedMs).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Próxima janela em ${minutosRestantes} min.`,
          lockedBy: data.lockedBy,
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

async function carregaUltNSU(cnpj) {
  const cnpjNum = String(cnpj).replace(/\D/g, '');
  const ref = fa().firestore().collection('sefaz_state').doc(cnpjNum);
  const snap = await ref.get();
  return snap.exists ? (snap.data().ultNSU || '0') : '0';
}

async function persisteUltNSU(cnpj, ultNSU, info = {}) {
  const cnpjNum = String(cnpj).replace(/\D/g, '');
  const ref = fa().firestore().collection('sefaz_state').doc(cnpjNum);
  await ref.set({
    cnpj: cnpjNum,
    ultNSU,
    ultimaSync: fa().firestore.FieldValue.serverTimestamp(),
    ...info,
  }, { merge: true });
}

export async function sincronizarEmpresa({ empresaId, empresaCnpj, capturadoPor }) {
  const cnpjNum = String(empresaCnpj).replace(/\D/g, '');
  if (cnpjNum.length !== 14) return { ok: false, motivo: `CNPJ inválido: ${empresaCnpj}` };

  const lockResult = await acquireLock(cnpjNum, capturadoPor?.email || capturadoPor?.uid || 'system');
  if (!lockResult.ok) return { ok: false, motivo: lockResult.motivo, locked: true };

  let ultNSU = await carregaUltNSU(cnpjNum);
  let novosXmls = 0;
  let duplicados = 0;
  let erros = 0;
  let pagina = 0;
  let cStatFinal = null;
  let xMotivoFinal = null;
  let rateLimited = false;

  try {
    while (pagina < MAX_PAGINAS) {
      pagina++;
      const result = await consultaDistDFe({ cnpj: cnpjNum, ultNSU });
      cStatFinal = result.cStat;
      xMotivoFinal = result.xMotivo;

      if (result.rateLimited) { rateLimited = true; break; }
      if (result.cStat === '137') break;

      if (result.cStat === '138' && result.xmls.length > 0) {
        for (const docZip of result.xmls) {
          if (!docZip.xml) {
            erros++;
            await registrarErroSefaz({
              empresaId, empresaCnpj: cnpjNum,
              motivo: 'Falha ao descomprimir docZip',
              contexto: { nsu: docZip.nsu, schema: docZip.schema, erro: docZip.erroDescompressao },
              capturadoPor,
            });
            continue;
          }
          try {
            const r = await importarXmlSefaz({
              empresaId, empresaCnpj: cnpjNum,
              xml: docZip.xml, schema: docZip.schema, nsu: docZip.nsu,
              capturadoPor,
            });
            if (r.status === 'ok') novosXmls++;
            else if (r.status === 'duplicado') duplicados++;
            else { erros++; console.warn('[orchestrator] import retornou erro:', r); }
          } catch (e) {
            erros++;
            console.error('[orchestrator] exceção no import:', e.message);
            await registrarErroSefaz({
              empresaId, empresaCnpj: cnpjNum,
              motivo: e.message, contexto: { nsu: docZip.nsu, schema: docZip.schema },
              capturadoPor,
            });
          }
        }
      }

      if (result.ultNSU) ultNSU = result.ultNSU;
      if (result.maxNSU && result.ultNSU && result.maxNSU === result.ultNSU) break;
      if (result.cStat !== '138') break;
    }

    await persisteUltNSU(cnpjNum, ultNSU, {
      cStatUltimaSync: cStatFinal,
      xMotivoUltimaSync: xMotivoFinal,
      paginas: pagina,
      ultimoColaborador: capturadoPor?.email || null,
      fonteUltimaSync: capturadoPor?.fonte || 'desconhecido',
    });

    if (rateLimited) {
      return {
        ok: false, rateLimited: true,
        motivo: 'SEFAZ retornou cStat 656 (Consumo Indevido) — aguarde 1h.',
        novosXmls, duplicados, erros, ultNSU, paginas: pagina,
      };
    }

    return {
      ok: true, novosXmls, duplicados, erros, ultNSU, paginas: pagina,
      cStat: cStatFinal, xMotivo: xMotivoFinal,
    };
  } catch (e) {
    console.error('[orchestrator] erro fatal:', e);
    await registrarErroSefaz({
      empresaId, empresaCnpj: cnpjNum,
      motivo: e.message, contexto: { ultNSU, pagina }, capturadoPor,
    });
    return { ok: false, motivo: e.message, novosXmls, duplicados, erros, ultNSU, paginas: pagina };
  }
}
