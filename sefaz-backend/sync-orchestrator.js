// ============================================================================
// sefaz-backend/sync-orchestrator.js  (ESM)
// Coordena 1 sincronização SEFAZ: lock + cliente + importer + cursor NSU.
// ============================================================================

import admin from 'firebase-admin';
import { consultaDistDFe, consultaDistDFeComCert } from './sefaz-client.js';
import { loadCertEmpresa } from './cert-storage.js';
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

// Carrega UF da empresa (de dadosFiscais.uf) consultando coleções
// simples_empresas e lucro_empresas (tenta as duas).
async function carregarUfEmpresa(empresaId) {
  if (!empresaId) return null;
  const db = fa().firestore();
  for (const col of ['simples_empresas', 'lucro_empresas']) {
    try {
      const snap = await db.collection(col).doc(empresaId).get();
      if (snap.exists) {
        const uf = snap.data()?.dadosFiscais?.uf;
        if (uf) return String(uf).trim().toUpperCase();
      }
    } catch (e) {
      console.warn(`[sync-orchestrator] erro lendo ${col}/${empresaId}:`, e.message);
    }
  }
  return null;
}

export async function sincronizarEmpresa({ empresaId, empresaCnpj, capturadoPor }) {
  const cnpjNum = String(empresaCnpj).replace(/\D/g, '');
  if (cnpjNum.length !== 14) return { ok: false, motivo: `CNPJ inválido: ${empresaCnpj}` };

  // Carrega UF da empresa — necessária pro envelope cUFAutor.
  const uf = await carregarUfEmpresa(empresaId);
  if (!uf) {
    return {
      ok: false,
      motivo: `UF não cadastrada para a empresa. Acesse a tela de configuração e preencha dadosFiscais.uf (ex: SP).`,
    };
  }

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

  // Tenta carregar cert especifico da empresa.
  // Se não houver, ABORTA antes de chamar SEFAZ (evita cStat=593 garantido +
  // protege quota do IP do escritório).
  let certOverride = null;
  try {
    certOverride = await loadCertEmpresa(empresaId);
  } catch (e) {
    console.warn(`[sync-orchestrator] erro carregando cert empresa ${empresaId}:`, e.message);
  }
  if (!certOverride) {
    console.log(`[sync-orchestrator] empresa=${empresaId} cnpj=${cnpjNum} SEM cert próprio — aguardando upload`);
    // Libera o lock pra não ficar reservado por 1h
    try {
      await fa().firestore().collection('sefaz_locks').doc(cnpjNum).delete();
    } catch (e) { /* lock já foi liberado ou erro: ignora */ }
    return {
      ok: false,
      motivo: 'Empresa aguardando cert A1 próprio. Suba o certificado pela tela Empresas Monitoradas → coluna Certificado.',
      semCert: true,
    };
  }
  // Sanity check: CNPJ-Base do cert tem que bater com o CNPJ consultado.
  const certCnpjBase = String(certOverride.cnpj || '').replace(/\D/g, '').slice(0, 8);
  const empresaCnpjBase = cnpjNum.slice(0, 8);
  if (certCnpjBase && empresaCnpjBase !== certCnpjBase) {
    console.warn(`[sync-orchestrator] empresa=${empresaId} cert tem CNPJ-Base ${certCnpjBase}, esperado ${empresaCnpjBase}`);
    try {
      await fa().firestore().collection('sefaz_locks').doc(cnpjNum).delete();
    } catch (e) {}
    return {
      ok: false,
      motivo: `CNPJ-Base do cert (${certCnpjBase}) difere do CNPJ da empresa (${empresaCnpjBase}). Suba o cert A1 correto dessa empresa.`,
      certInvalido: true,
    };
  }
  console.log(`[sync-orchestrator] empresa=${empresaId} cnpj=${cnpjNum} cert=empresa`);

  try {
    while (pagina < MAX_PAGINAS) {
      pagina++;
      const result = await consultaDistDFeComCert({ cnpj: cnpjNum, ultNSU, certOverride, uf });
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
