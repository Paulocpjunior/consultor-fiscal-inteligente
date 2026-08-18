// ============================================================================
// sefaz-backend/sync-orchestrator-cte.js  (ESM)
// Coordena 1 sincronização de CT-e: lock + cliente + importer + cursor NSU —
// espelha `sync-orchestrator.js` (NF-e), com estado e lock PRÓPRIOS.
//
// Paulo, 18/08 (caso EDUARDO GUERRA — tomadora de frete, 0 CT-e capturado):
// "como automatizar as CTeS então". O NFe DistDFe nunca trouxe CT-e — é
// webservice diferente (`CTeDistribuicaoDFe`, cte-client.js) — então a
// captura de CT-e precisa do MESMO desenho de cursor/lock/anti-656 que já
// existe pro NF-e, só que numa coleção PRÓPRIA:
//
//   sefaz_state_cte / sefaz_locks_cte  (nunca sefaz_state / sefaz_locks)
//
// Um cursor SÓ resolveria pra um dos dois documentos e o outro ficaria
// "sincronizado" com o NSU do lado errado — a mesma armadilha das "duas
// formas" que já mordeu este projeto várias vezes, agora entre NF-e e CT-e
// em vez de entre dois formatos do mesmo documento.
//
// A régua de cursor seguro (`calcularCursorSeguro`) é REUSADA do orquestrador
// de NF-e — é pura, já testada, e reescrevê-la aqui seria a segunda cópia
// exatamente do tipo que a casa proíbe.
// ============================================================================

import { randomUUID } from 'crypto';
import admin from 'firebase-admin';
import { consultaDistDFeCteComCert } from './cte-client.js';
import { loadCertEmpresa, loadCertEmpresaPorCnpjBase } from './cert-storage.js';
import { loadCertificate } from './secret-loader.js';
import { importarXmlSefaz, registrarErroSefaz } from './xml-importer.js';
import { carregarFlagsEmpresa, CNPJ_ESCRITORIO } from './empresa-flags.js';
import { calcularCursorSeguro } from './sync-orchestrator.js';

const LOCK_TTL_MS = 60 * 60 * 1000; // 1 hora — mesmo TTL do NF-e
const MAX_PAGINAS = 50;
const MAX_TENTATIVAS_NSU = 3;

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

async function acquireLockCte(cnpj, lockedBy, lockToken) {
  const cnpjNum = String(cnpj).replace(/\D/g, '');
  const ref = fa().firestore().collection('sefaz_locks_cte').doc(cnpjNum);
  const now = Date.now();
  const expiresAt = now + LOCK_TTL_MS;

  return fa().firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data();
      const exp = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : data.expiresAt;
      if (exp > now) {
        const minutosRestantes = Math.ceil((exp - now) / 60000);
        return { ok: false, motivo: `CT-e já sincronizado. Próxima janela em ${minutosRestantes} min.` };
      }
    }
    tx.set(ref, {
      startedAt: fa().firestore.Timestamp.fromMillis(now),
      expiresAt: fa().firestore.Timestamp.fromMillis(expiresAt),
      lockedBy, lockToken,
    });
    return { ok: true };
  });
}

async function carregaEstadoNSUCte(cnpj) {
  const cnpjNum = String(cnpj).replace(/\D/g, '');
  const snap = await fa().firestore().collection('sefaz_state_cte').doc(cnpjNum).get();
  const d = snap.exists ? snap.data() : {};
  return {
    ultNSU: d.ultNSU || '0',
    travado: d.nsuTravado ? { nsu: d.nsuTravado, tentativas: d.tentativasTravado || 1 } : null,
  };
}

async function persisteUltNSUCte(cnpj, ultNSU, info = {}, lockToken = null) {
  const cnpjNum = String(cnpj).replace(/\D/g, '');
  const db = fa().firestore();
  const stateRef = db.collection('sefaz_state_cte').doc(cnpjNum);
  const payload = { cnpj: cnpjNum, ultNSU, ultimaSync: fa().firestore.FieldValue.serverTimestamp(), ...info };
  if (!lockToken) {
    await stateRef.set(payload, { merge: true });
    return { persistido: true };
  }
  const lockRef = db.collection('sefaz_locks_cte').doc(cnpjNum);
  return db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef);
    if (!lockSnap.exists || lockSnap.data().lockToken !== lockToken) return { persistido: false };
    tx.set(stateRef, payload, { merge: true });
    return { persistido: true };
  });
}

/**
 * Sincroniza CT-e de UMA empresa. Mesmo contrato de retorno de
 * `sincronizarEmpresa` (NF-e) — `{ ok, novosXmls, duplicados, erros, ... }` —
 * pra reaproveitar o MESMO tipo de leitura no painel/rota, sem inventar um
 * segundo vocabulário de resultado.
 *
 * DIFERENÇAS DE PROPÓSITO em relação ao NF-e:
 *  - Sem fila de Ciência: a "Manifestação do Destinatário" de CT-e é outro
 *    evento (não pedido nesta rodada) — não construir por analogia sem prova.
 *  - Sem fallback de A3/agente local: CT-e nasce só pro caminho A1 por ora.
 */
export async function sincronizarEmpresaCte({ empresaId, empresaCnpj, capturadoPor }) {
  const cnpjNum = String(empresaCnpj).replace(/\D/g, '');
  if (cnpjNum.length !== 14) return { ok: false, motivo: `CNPJ inválido: ${empresaCnpj}` };

  const { uf } = await carregarFlagsEmpresa(empresaId, cnpjNum);
  if (!uf) {
    return { ok: false, motivo: 'UF não cadastrada para a empresa — preencha em dadosFiscais.uf.' };
  }

  const lockToken = randomUUID();
  const lockResult = await acquireLockCte(cnpjNum, capturadoPor?.email || capturadoPor?.uid || 'system', lockToken);
  if (!lockResult.ok) return { ok: false, motivo: lockResult.motivo, locked: true };

  const estadoAnterior = await carregaEstadoNSUCte(cnpjNum);
  let ultNSU = estadoAnterior.ultNSU;
  const nsusFalhosSet = new Set();
  const marcarFalha = (nsu) => {
    const n = parseInt(nsu, 10);
    if (Number.isFinite(n)) nsusFalhosSet.add(n);
  };
  let novosXmls = 0, duplicados = 0, erros = 0, pagina = 0;
  let cStatFinal = null, xMotivoFinal = null, rateLimited = false, maxNSUFinal = null;
  const documentosProcessados = [];

  // Mesma resolução de certificado do NF-e: A1 próprio → A1 da mesma raiz →
  // (só pra S&P) cert do escritório. CT-e ainda não tem trilho A3/agente
  // local, então empresa só-A3 fica sem captura de CT-e por ora — igual ao
  // ponto em que o NF-e estava antes do agente cfi-a3 existir.
  let certOverride = null;
  try {
    certOverride = await loadCertEmpresa(empresaId);
    const notAfterMs = certOverride?.notAfter ? Date.parse(certOverride.notAfter) : null;
    if (notAfterMs && notAfterMs <= Date.now()) certOverride = null;
  } catch { /* segue pra raiz */ }
  if (!certOverride && cnpjNum !== CNPJ_ESCRITORIO) {
    try { certOverride = await loadCertEmpresaPorCnpjBase(cnpjNum, empresaId); } catch { /* sem cert */ }
  }
  if (!certOverride && cnpjNum === CNPJ_ESCRITORIO) {
    try {
      const escritorio = await loadCertificate();
      certOverride = { pfxBuffer: escritorio.pfxBuffer, password: escritorio.password, cnpj: CNPJ_ESCRITORIO };
    } catch { /* sem cert do escritório */ }
  }
  if (!certOverride) {
    try { await fa().firestore().collection('sefaz_locks_cte').doc(cnpjNum).delete(); } catch { /* já liberado */ }
    return {
      ok: false, semCert: true,
      motivo: 'Empresa aguardando certificado A1 próprio ou A1 de outra empresa da mesma raiz CNPJ — CT-e '
        + 'usa o mesmo certificado do NF-e, mas ainda não tem fallback de A3/agente local.',
    };
  }

  try {
    while (pagina < MAX_PAGINAS) {
      pagina++;
      const result = await consultaDistDFeCteComCert({ cnpj: cnpjNum, ultNSU, certOverride, uf });
      cStatFinal = result.cStat;
      xMotivoFinal = result.xMotivo;

      if (result.rateLimited) { rateLimited = true; break; }
      if (result.cStat === '137') break;

      if (result.cStat === '138' && result.xmls.length > 0) {
        for (const docZip of result.xmls) {
          if (!docZip.xml) {
            erros++;
            marcarFalha(docZip.nsu);
            documentosProcessados.push({
              nsu: docZip.nsu, schema: docZip.schema, chave: null,
              status: 'erro-descompressao', motivo: docZip.erroDescompressao || 'docZip vazio',
            });
            await registrarErroSefaz({
              empresaId, empresaCnpj: cnpjNum,
              motivo: 'Falha ao descomprimir docZip (CT-e)',
              contexto: { nsu: docZip.nsu, schema: docZip.schema, erro: docZip.erroDescompressao },
              capturadoPor,
            });
            continue;
          }
          const chaveMatch = docZip.xml.match(/Id="(?:CTe|ID)?(\d{44})"/i)
            || docZip.xml.match(/<chCTe>(\d{44})<\/chCTe>/i);
          const chave = chaveMatch ? chaveMatch[1] : null;
          try {
            // MESMO importer do NF-e — ele já reconhece infCte/chCTe/vTPrest
            // e os schemas resCTe/procCTe (armadilha das duas formas, 11/08:
            // reimplementar leitura de documento aqui seria a segunda cópia).
            const r = await importarXmlSefaz({
              empresaId, empresaCnpj: cnpjNum,
              xml: docZip.xml, schema: docZip.schema, nsu: docZip.nsu,
              capturadoPor,
            });
            if (r.status === 'ok' || r.status === 'atualizado') {
              novosXmls++;
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: r.status });
            } else if (r.status === 'duplicado') {
              duplicados++;
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'duplicado', motivo: r.motivo || null });
            } else if (r.status === 'evento_anexado' || r.status === 'evento_stub_criado') {
              novosXmls++;
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'evento-ok', motivo: r.tipo || null });
            } else if (r.status === 'duplicado_evento' || r.status === 'evento_skip_vazio') {
              duplicados++;
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'evento-dup', motivo: r.tipo || null });
            } else {
              erros++;
              marcarFalha(docZip.nsu);
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'erro-import', motivo: r.motivo || JSON.stringify(r).slice(0, 200) });
            }
          } catch (e) {
            erros++;
            marcarFalha(docZip.nsu);
            documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'excecao-import', motivo: e.message });
            await registrarErroSefaz({
              empresaId, empresaCnpj: cnpjNum,
              motivo: e.message, contexto: { nsu: docZip.nsu, schema: docZip.schema, chave },
              capturadoPor,
            });
          }
        }
      }

      if (result.ultNSU) ultNSU = result.ultNSU;
      if (result.maxNSU) maxNSUFinal = result.maxNSU;
      if (result.maxNSU && result.ultNSU && result.maxNSU === result.ultNSU) break;
      if (result.cStat !== '138') break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const nsusFalhos = [...nsusFalhosSet];
    const cursorInfo = calcularCursorSeguro({
      reachedNSU: ultNSU, nsusFalhos, travadoAnterior: estadoAnterior.travado,
    });
    const cursorPersistir = cursorInfo.cursor;
    if (cursorInfo.desistiu) {
      await registrarErroSefaz({
        empresaId, empresaCnpj: cnpjNum,
        motivo: `CT-e: NSU ${cursorInfo.nsuDesistido} falhou ${MAX_TENTATIVAS_NSU}x ao importar; cursor avançado (documento pulado).`,
        contexto: { nsuDesistido: cursorInfo.nsuDesistido, maxNSU: maxNSUFinal },
        capturadoPor,
      });
    }

    const pendenciaNSU = (maxNSUFinal && cursorPersistir)
      ? Math.max(0, parseInt(maxNSUFinal, 10) - parseInt(cursorPersistir, 10))
      : 0;

    await persisteUltNSUCte(cnpjNum, cursorPersistir, {
      cStatUltimaSync: cStatFinal, xMotivoUltimaSync: xMotivoFinal,
      paginas: pagina, maxNSUUltimaSync: maxNSUFinal, pendenciaNSU,
      nsuAlcancado: ultNSU,
      nsuTravado: cursorInfo.travado?.nsu || null,
      tentativasTravado: cursorInfo.travado?.tentativas || null,
      ultimoColaborador: capturadoPor?.email || null,
      fonteUltimaSync: capturadoPor?.fonte || 'desconhecido',
    }, lockToken);

    if (rateLimited) {
      return {
        ok: false, rateLimited: true,
        motivo: 'SEFAZ retornou cStat 656 (Consumo Indevido) na captura de CT-e — aguarde ~1h e sincronize de novo.',
        novosXmls, duplicados, erros, ultNSU, paginas: pagina, maxNSU: maxNSUFinal, pendenciaNSU,
        documentosProcessados,
      };
    }
    return {
      ok: true, novosXmls, duplicados, erros, ultNSU, paginas: pagina,
      cStat: cStatFinal, xMotivo: xMotivoFinal, maxNSU: maxNSUFinal, pendenciaNSU,
      documentosProcessados,
    };
  } catch (e) {
    console.error('[sync-orchestrator-cte] erro fatal:', e);
    await registrarErroSefaz({
      empresaId, empresaCnpj: cnpjNum, motivo: e.message, contexto: { ultNSU, pagina }, capturadoPor,
    });
    return { ok: false, motivo: e.message, novosXmls, duplicados, erros, ultNSU, paginas: pagina, documentosProcessados };
  }
}
