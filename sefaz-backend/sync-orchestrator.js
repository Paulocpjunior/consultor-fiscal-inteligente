// ============================================================================
// sefaz-backend/sync-orchestrator.js  (ESM)
// Coordena 1 sincronização SEFAZ: lock + cliente + importer + cursor NSU.
// ============================================================================

import admin from 'firebase-admin';
import { consultaDistDFe, consultaDistDFeComCert } from './sefaz-client.js';
import { loadCertEmpresa } from './cert-storage.js';
import { loadCertificate } from './secret-loader.js';
import { importarXmlSefaz, registrarErroSefaz } from './xml-importer.js';

const LOCK_TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_PAGINAS = 5;

// CNPJ do escritório (S&P Assessoria Contábil). Cert dele vive no Secret
// Manager (loadCertificate), NAO em empresas_certificados. Quando o escritorio
// aparece como cliente de si mesmo no cadastro, o cron NFe nao achava cert e
// abortava — entao NF-e de compra/saida do escritorio nunca eram capturadas
// (so NFSe SP capital, que usa cert global por outro caminho).
const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

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
async function carregarUfEmpresa(empresaId, empresaCnpj) {
  if (!empresaId) return null;
  const db = fa().firestore();
  for (const col of ['simples_empresas', 'lucro_empresas']) {
    try {
      const snap = await db.collection(col).doc(empresaId).get();
      if (snap.exists) {
        const d = snap.data() || {};
        // Cadastro canonico: dadosFiscais.uf. Fallback ao top-level pra
        // cobrir docs legados onde a UF foi gravada como d.uf direto.
        const uf = d.dadosFiscais?.uf || d.uf;
        if (uf) return String(uf).trim().toUpperCase();
      }
    } catch (e) {
      console.warn(`[sync-orchestrator] erro lendo ${col}/${empresaId}:`, e.message);
    }
  }
  // Caso especial: a propria S&P (escritorio) — defaulta SP. Sem isso,
  // o escritorio tinha que cadastrar UF=SP pra si mesmo manualmente, o
  // que e ridiculo (S&P Assessoria Contabil esta literalmente em SP).
  const cnpjNum = String(empresaCnpj || '').replace(/\D/g, '');
  if (cnpjNum === CNPJ_ESCRITORIO) return 'SP';
  return null;
}

export async function sincronizarEmpresa({ empresaId, empresaCnpj, capturadoPor }) {
  const cnpjNum = String(empresaCnpj).replace(/\D/g, '');
  if (cnpjNum.length !== 14) return { ok: false, motivo: `CNPJ inválido: ${empresaCnpj}` };

  // Carrega UF da empresa — necessária pro envelope cUFAutor.
  const uf = await carregarUfEmpresa(empresaId, cnpjNum);
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
  // Fallback APENAS pra propria S&P: cert dela vive no Secret Manager,
  // nao em empresas_certificados. Sem isso, NFe de entrada do escritorio
  // (compras, materiais, etc) nunca eram baixadas. Nao aplicar pra outras
  // empresas com procuracao e-CAC sem discussao — multiplicaria 6x o
  // volume diario de DistDFe contra a quota do IP do Cloud Run.
  if (!certOverride && cnpjNum === CNPJ_ESCRITORIO) {
    try {
      const escritorio = await loadCertificate();
      certOverride = {
        pfxBuffer: escritorio.pfxBuffer,
        password: escritorio.password,
        cnpj: cnpjNum,           // pro sanity check de CNPJ-Base mais abaixo
        notAfter: null,           // desconhecido aqui, nao usado no fluxo
        fingerprint: null,
      };
      console.log(`[sync-orchestrator] empresa=${empresaId} cnpj=${cnpjNum} cert=escritorio (S&P, fallback Secret Manager)`);
    } catch (e) {
      console.warn(`[sync-orchestrator] falha carregando cert do escritorio: ${e.message}`);
    }
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

  // Detalhe por documento processado — exposto no retorno pra debug fino
  // (qual chave veio, qual o status, qual o erro). Sem isso era impossivel
  // saber se uma NFe especifica chegou via DistDFe ou nao — o cron so dava
  // total agregado.
  const documentosProcessados = [];

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
            documentosProcessados.push({
              nsu: docZip.nsu, schema: docZip.schema, chave: null,
              status: 'erro-descompressao', motivo: docZip.erroDescompressao || 'docZip vazio',
            });
            await registrarErroSefaz({
              empresaId, empresaCnpj: cnpjNum,
              motivo: 'Falha ao descomprimir docZip',
              contexto: { nsu: docZip.nsu, schema: docZip.schema, erro: docZip.erroDescompressao },
              capturadoPor,
            });
            continue;
          }
          // Extrai chave do XML pra mostrar no retorno (mesmo padrao do xml-importer)
          const chaveMatch = docZip.xml.match(/Id="(?:NFe|CTe|MDFe|ID)?(\d{44})"/i)
            || docZip.xml.match(/<ch(?:NFe|CTe|MDFe)>(\d{44})<\/ch/i);
          const chave = chaveMatch ? chaveMatch[1] : null;
          try {
            const r = await importarXmlSefaz({
              empresaId, empresaCnpj: cnpjNum,
              xml: docZip.xml, schema: docZip.schema, nsu: docZip.nsu,
              capturadoPor,
            });
            if (r.status === 'ok') {
              novosXmls++;
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'ok', motivo: null });
              // Manifestacao automatica: assim que um resNFe e importado com
              // sucesso, dispara 'Ciencia da Operacao' (210210) em background.
              // SEFAZ libera o procNFe completo na proxima DistDFe pra essa
              // chave. Sem isso a base fica so com resumos, sem itens/totais.
              if (r.tipoDoc === 'resNFe' && r.chave) {
                setImmediate(async () => {
                  try {
                    const { manifestarUma } = await import('./manifesto-orchestrator.js');
                    await manifestarUma({
                      chNFe: r.chave,
                      cnpjDestinatario: cnpjNum,
                      tipo: 'ciencia',
                      capturadoPor: { ...capturadoPor, motivo: 'auto-pos-import-resNFe' },
                    });
                  } catch (mfErr) {
                    console.warn(`[auto-manifestar] ${r.chave} falhou:`, mfErr.message);
                  }
                });
              }
            } else if (r.status === 'duplicado') {
              duplicados++;
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'duplicado', motivo: r.motivo || null });
            } else {
              erros++;
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'erro-import', motivo: r.motivo || JSON.stringify(r).slice(0, 200) });
              console.warn('[orchestrator] import retornou erro:', r);
            }
          } catch (e) {
            erros++;
            documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'excecao-import', motivo: e.message });
            console.error('[orchestrator] exceção no import:', e.message);
            await registrarErroSefaz({
              empresaId, empresaCnpj: cnpjNum,
              motivo: e.message, contexto: { nsu: docZip.nsu, schema: docZip.schema, chave },
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
        documentosProcessados,
      };
    }

    return {
      ok: true, novosXmls, duplicados, erros, ultNSU, paginas: pagina,
      cStat: cStatFinal, xMotivo: xMotivoFinal,
      documentosProcessados,
    };
  } catch (e) {
    console.error('[orchestrator] erro fatal:', e);
    await registrarErroSefaz({
      empresaId, empresaCnpj: cnpjNum,
      motivo: e.message, contexto: { ultNSU, pagina }, capturadoPor,
    });
    return { ok: false, motivo: e.message, novosXmls, duplicados, erros, ultNSU, paginas: pagina, documentosProcessados };
  }
}
