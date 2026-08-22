// ============================================================================
// sefaz-backend/sync-orchestrator.js  (ESM)
// Coordena 1 sincronização SEFAZ: lock + cliente + importer + cursor NSU.
// ============================================================================

import { randomUUID } from 'crypto';
import admin from 'firebase-admin';
import { consultaDistDFe, consultaDistDFeComCert } from './sefaz-client.js';
import { loadCertEmpresa, loadCertEmpresaPorCnpjBase } from './cert-storage.js';
import { loadCertificate } from './secret-loader.js';
import { importarXmlSefaz, registrarErroSefaz } from './xml-importer.js';
// CNPJ do escritório (S&P Assessoria Contábil). Cert dele vive no Secret
// Manager (loadCertificate), NAO em empresas_certificados. Quando o escritorio
// aparece como cliente de si mesmo no cadastro, o cron NFe nao achava cert e
// abortava — entao NF-e de compra/saida do escritorio nunca eram capturadas
// (so NFSe SP capital, que usa cert global por outro caminho).
import { carregarFlagsEmpresa, CNPJ_ESCRITORIO } from './empresa-flags.js';

const LOCK_TTL_MS = 60 * 60 * 1000; // 1 hora
// Cooldown do "Recapturar do zero" (resetNSU / botão ⟲ 90d). Zerar o cursor
// re-solicita à SEFAZ TODO o histórico a partir do NSU 0 — e repetir isso é
// EXATAMENTE o gatilho do cStat 656 "Consumo Indevido". Esperar 1h não resolve
// se a cada tentativa o admin re-dispara o 90d: o próprio reset re-arma o 656.
// Além disso a SAÍDA própria (mod 55) nunca vem por DistDFe (Rejeição 641), então
// recapturar 90d NÃO traz nota nova de saída. Travamos reset repetido nesta janela.
// (caso JOTASUL 07/2026: 656 "persistindo >1h" era reset em loop, não bloqueio da SEFAZ.)
const RESET_NSU_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 horas
// Cada página DistDFe traz até ~50 docZip. Com 5 páginas, uma empresa com
// backlog grande (ex.: primeira captura de ~90 dias) baixava só ~250 docs e
// precisava de VÁRIAS janelas de 1h (lock) pra alcançar o maxNSU — na prática
// "faltavam notas" por dias. 50 páginas (~2500 docs) cobre o backlog de 90
// dias numa tacada; o loop continua parando cedo em 137 (em dia) e 656 (rate
// limit), então empresas em dia seguem fazendo 1-2 chamadas.
const MAX_PAGINAS = 50;

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

async function acquireLock(cnpj, lockedBy, lockToken) {
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
    // lockToken identifica ESTE run — usado no persist pra não sobrescrever o
    // cursor caso o run passe do TTL e outro cron reassuma o lock.
    tx.set(ref, {
      startedAt: fa().firestore.Timestamp.fromMillis(now),
      expiresAt: fa().firestore.Timestamp.fromMillis(expiresAt),
      lockedBy,
      lockToken,
    });
    return { ok: true };
  });

  return result;
}

// Quantas vezes tentamos reprocessar o MESMO NSU que falha ao importar antes de
// desistir dele e avançar o cursor (evita travar a empresa num "poison NSU").
const MAX_TENTATIVAS_NSU = 3;

// Cursor seguro: NUNCA persiste um ultNSU ALÉM de um NSU que falhou ao importar,
// senão aquele documento fica "atrás" do cursor e a SEFAZ nunca mais o reenvia
// (a classe "baixou algumas notas mas não todas" — caso BRASLIMPO/VINATEX).
// Segura o cursor logo antes do menor NSU falho, pra ele ser reprocessado no
// próximo run. Como a SEFAZ só devolve NSU > ultNSU solicitado, o menor NSU
// falho é sempre > cursor inicial, então segurar em (falho-1) nunca retrocede.
// Se o mesmo NSU falha MAX_TENTATIVAS_NSU vezes, desiste dele (avança o cursor +
// sinaliza), pra não travar a captura do resto da empresa. Função PURA/testável.
//
// IMPORTANTE: recebe TODOS os NSUs falhos do run (nsusFalhos), não só o menor.
// Ao desistir do poison (menor falho), o cursor NÃO salta para reachedNSU — isso
// pularia outros NSUs que falharam menos vezes no mesmo run e os perderia. Em vez
// disso avança só até logo antes do PRÓXIMO NSU falho, que vira a nova trava
// (tentativa 1). Assim cada NSU ganha suas 3 tentativas de verdade.
export function calcularCursorSeguro({ reachedNSU, nsusFalhos, travadoAnterior }) {
  const falhos = (nsusFalhos || [])
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (falhos.length === 0) {
    return { cursor: String(reachedNSU), travado: null, desistiu: false };
  }
  const menor = falhos[0];
  const prevNsu = travadoAnterior?.nsu != null ? parseInt(travadoAnterior.nsu, 10) : null;
  const mesmaTrava = prevNsu !== null && prevNsu === menor;
  const tentativas = mesmaTrava ? (Number(travadoAnterior.tentativas) || 1) + 1 : 1;

  if (tentativas >= MAX_TENTATIVAS_NSU) {
    // Desiste do poison (menor), mas não pula os demais falhos: para logo antes
    // do próximo NSU falho, que passa a ser a trava (tentativa 1).
    const proximoFalho = falhos.find((n) => n > menor);
    if (proximoFalho == null) {
      return { cursor: String(reachedNSU), travado: null, desistiu: true, nsuDesistido: String(menor) };
    }
    return {
      cursor: String(Math.max(0, proximoFalho - 1)),
      travado: { nsu: String(proximoFalho), tentativas: 1 },
      desistiu: true,
      nsuDesistido: String(menor),
    };
  }
  const seguro = Math.max(0, menor - 1);
  return { cursor: String(seguro), travado: { nsu: String(menor), tentativas }, desistiu: false };
}

async function carregaEstadoNSU(cnpj) {
  const cnpjNum = String(cnpj).replace(/\D/g, '');
  const ref = fa().firestore().collection('sefaz_state').doc(cnpjNum);
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : {};
  return {
    ultNSU: d.ultNSU || '0',
    travado: d.nsuTravado ? { nsu: d.nsuTravado, tentativas: d.tentativasTravado || 1 } : null,
  };
}

// Instante (ms) do último "Recapturar do zero" (resetNSU) desta empresa, pro
// cooldown anti-656. null se nunca resetou.
async function ultimoResetNsuMs(cnpj) {
  const cnpjNum = String(cnpj).replace(/\D/g, '');
  const snap = await fa().firestore().collection('sefaz_state').doc(cnpjNum).get();
  if (!snap.exists) return null;
  const v = snap.data()?.ultimoResetNsuEm;
  if (!v) return null;
  return v?.toMillis ? v.toMillis() : (typeof v === 'number' ? v : Date.parse(v) || null);
}

// Persiste o cursor/estado. Se `lockToken` for passado, faz numa transação que
// só grava se o lock AINDA for nosso (mesmo token) — assim um run que passou do
// TTL de 1h e teve o lock reassumido por outro cron NÃO sobrescreve o cursor/
// contador do dono atual. Sem token (ex.: reset), grava direto. Retorna
// { persistido: boolean }.
async function persisteUltNSU(cnpj, ultNSU, info = {}, lockToken = null) {
  const cnpjNum = String(cnpj).replace(/\D/g, '');
  const db = fa().firestore();
  const stateRef = db.collection('sefaz_state').doc(cnpjNum);
  const payload = {
    cnpj: cnpjNum,
    ultNSU,
    ultimaSync: fa().firestore.FieldValue.serverTimestamp(),
    ...info,
  };
  if (!lockToken) {
    await stateRef.set(payload, { merge: true });
    return { persistido: true };
  }
  const lockRef = db.collection('sefaz_locks').doc(cnpjNum);
  return db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef);
    if (!lockSnap.exists || lockSnap.data().lockToken !== lockToken) {
      return { persistido: false };
    }
    tx.set(stateRef, payload, { merge: true });
    return { persistido: true };
  });
}

// carregarFlagsEmpresa (uf + procuracaoEcacAtiva) agora vive em
// empresa-flags.js — compartilhada com o manifesto-orchestrator, que precisa
// da UF pro consChNFe do re-download pós-manifestação.

export async function sincronizarEmpresa({ empresaId, empresaCnpj, capturadoPor, resetNSU = false }) {
  const cnpjNum = String(empresaCnpj).replace(/\D/g, '');
  if (cnpjNum.length !== 14) return { ok: false, motivo: `CNPJ inválido: ${empresaCnpj}` };

  // Carrega UF + procuracaoEcacAtiva da empresa.
  const { uf } = await carregarFlagsEmpresa(empresaId, cnpjNum);
  if (!uf) {
    return {
      ok: false,
      motivo: 'UF não cadastrada para a empresa — preencha em Empresas → Dados Fiscais (ex.: SP).',
    };
  }

  // Guard-rail anti-656 do "Recapturar do zero" (⟲ 90d). Repetir o resetNSU é o
  // que arma o cStat 656 — e como o admin bypassa o lock de 1h, sem isto ele
  // entra num loop de reset→656→reset. Bloqueia reset dentro do cooldown, com
  // mensagem que aponta o caminho certo (Sincronizar incremental / cofre p/ saída).
  if (resetNSU) {
    const ultReset = await ultimoResetNsuMs(cnpjNum);
    if (ultReset && (Date.now() - ultReset) < RESET_NSU_COOLDOWN_MS) {
      const minAtras = Math.floor((Date.now() - ultReset) / 60000);
      const minFalta = Math.ceil((RESET_NSU_COOLDOWN_MS - (Date.now() - ultReset)) / 60000);
      return {
        ok: false,
        resetBloqueado: true,
        motivo: `"Recapturar do zero" (90d) já foi feito há ${minAtras} min nesta empresa. `
          + `A SEFAZ já reenviou todo o histórico — repetir o 90d agora dispara o cStat 656 `
          + `(Consumo Indevido) e NÃO traz nota nova. Aguarde ${minFalta} min OU use o `
          + `"↓ Sincronizar SEFAZ" normal (incremental). Obs.: a saída própria (mod 55) não vem `
          + `por este canal (Rejeição 641) — para saída use o cofre de e-mail.`,
      };
    }
  }

  const lockToken = randomUUID();
  const lockResult = await acquireLock(cnpjNum, capturadoPor?.email || capturadoPor?.uid || 'system', lockToken);
  if (!lockResult.ok) return { ok: false, motivo: lockResult.motivo, locked: true };

  // resetNSU=true zera o cursor → SEFAZ reenvia TODO o historico de DF-e dos
  // ultimos ~90 dias. Usado quando uma nota "passou" do cursor sem ser gravada
  // (caso BRASLIMPO: cursor avancou em disparos que abortavam por cert/UF).
  const estadoAnterior = resetNSU ? { ultNSU: '0', travado: null } : await carregaEstadoNSU(cnpjNum);
  let ultNSU = estadoAnterior.ultNSU;
  if (resetNSU) console.log(`[sync-orchestrator] empresa=${empresaId} RESET NSU=0 solicitado`);
  // TODOS os NSUs que FALHARAM ao importar neste run. O cursor seguro precisa da
  // lista completa (não só o menor) pra, ao desistir de um poison, não pular os
  // demais falhos. Set pra deduplicar.
  const nsusFalhosSet = new Set();
  const marcarFalha = (nsu) => {
    const n = parseInt(nsu, 10);
    if (!Number.isFinite(n)) return;
    nsusFalhosSet.add(n);
  };
  let novosXmls = 0;
  let duplicados = 0;
  let erros = 0;
  let pagina = 0;
  let cStatFinal = null;
  let xMotivoFinal = null;
  let rateLimited = false;
  let maxNSUFinal = null;
  // Chaves de resNFe importados nesta sync — a Ciência é disparada DEPOIS da
  // paginação, em fila sequencial. Antes era setImmediate POR DOCUMENTO durante
  // a paginação: cada ciência re-baixava a completa via consChNFe no MESMO
  // webservice NFeDistribuicaoDFe, em rajada concorrente com as páginas → a
  // SEFAZ devolvia cStat=656 e a captura parava no meio (caso VINATEX:
  // "baixou algumas notas mas não todas", todo dia).
  const resumosParaCiencia = [];

  // Tenta carregar cert especifico da empresa. Se a empresa for filial sem
  // PFX proprio, reaproveita um A1 valido da mesma raiz CNPJ (matriz/filial).
  // Isso evita o erro cStat=593 causado por tentar assinar DistDFe com cert do
  // escritorio/procuracao para outro CNPJ-base.
  let certOverride = null;
  try {
    certOverride = await loadCertEmpresa(empresaId);
    const notAfterMs = certOverride?.notAfter ? Date.parse(certOverride.notAfter) : null;
    if (notAfterMs && notAfterMs <= Date.now()) {
      console.warn(`[sync-orchestrator] cert empresa ${empresaId} vencido em ${certOverride.notAfter}; buscando A1 da mesma raiz`);
      certOverride = null;
    }
  } catch (e) {
    console.warn(`[sync-orchestrator] erro carregando cert empresa ${empresaId}:`, e.message);
  }
  if (!certOverride && cnpjNum !== CNPJ_ESCRITORIO) {
    try {
      certOverride = await loadCertEmpresaPorCnpjBase(cnpjNum, empresaId);
      if (certOverride) {
        console.log(`[sync-orchestrator] empresa=${empresaId} cnpj=${cnpjNum} cert=mesma_raiz fonte=${certOverride.empresaIdFonte}`);
      }
    } catch (e) {
      console.warn(`[sync-orchestrator] erro buscando cert por raiz CNPJ ${cnpjNum}:`, e.message);
    }
  }

  // Fallback pro cert do escritorio (Secret Manager) somente quando a empresa
  // consultada e a propria S&P. Para clientes, procuracao e-CAC nao substitui
  // o certificado A1 da raiz CNPJ na NFe Distribuicao DF-e.
  const ehEscritorio = !certOverride && cnpjNum === CNPJ_ESCRITORIO;
  if (ehEscritorio) {
    try {
      const escritorio = await loadCertificate();
      certOverride = {
        pfxBuffer: escritorio.pfxBuffer,
        password: escritorio.password,
        cnpj: CNPJ_ESCRITORIO,
        notAfter: null,
        fingerprint: null,
      };
      console.log(`[sync-orchestrator] empresa=${empresaId} cnpj=${cnpjNum} cert=escritorio (S&P fallback Secret Manager)`);
    } catch (e) {
      console.warn(`[sync-orchestrator] falha carregando cert do escritorio: ${e.message}`);
    }
  }
  if (!certOverride) {
    console.log(`[sync-orchestrator] empresa=${empresaId} cnpj=${cnpjNum} sem A1 proprio/mesma raiz — aguardando upload`);
    // Libera o lock pra não ficar reservado por 1h
    try {
      await fa().firestore().collection('sefaz_locks').doc(cnpjNum).delete();
    } catch (e) { /* lock já foi liberado ou erro: ignora */ }
    return {
      ok: false,
      motivo: 'Empresa aguardando certificado A1 proprio ou A1 de outra empresa da mesma raiz CNPJ. Procuração e-CAC do escritório não substitui certificado na consulta NFe DistDFe.',
      semCert: true,
    };
  }

  const certCnpjBase = String(certOverride.cnpj || '').replace(/\D/g, '').slice(0, 8);
  const empresaCnpjBase = cnpjNum.slice(0, 8);
  if (certCnpjBase && empresaCnpjBase !== certCnpjBase) {
    console.warn(`[sync-orchestrator] empresa=${empresaId} cert tem CNPJ-Base ${certCnpjBase}, esperado ${empresaCnpjBase}`);
    try {
      await fa().firestore().collection('sefaz_locks').doc(cnpjNum).delete();
    } catch (e) {}
    return {
      ok: false,
      motivo: `CNPJ-Base do cert (${certCnpjBase}) difere do CNPJ da empresa (${empresaCnpjBase}). Suba um A1 da mesma raiz CNPJ ou marque a empresa como A3 para agente local.`,
      certInvalido: true,
    };
  }
  console.log(`[sync-orchestrator] empresa=${empresaId} cnpj=${cnpjNum} cert=${certOverride.viaCnpjBase ? 'mesma_raiz' : 'empresa'}`);

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
            marcarFalha(docZip.nsu);
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
            if (r.status === 'ok' || r.status === 'atualizado') {
              novosXmls++;
              // 'atualizado' = upgrade de resumo→NFe completa (chegou a procNFe
              // com itens/totais que substituiu o resumo de 531 bytes). Conta
              // como novo (algo de valor foi gravado) e marca o motivo pra debug.
              documentosProcessados.push({
                nsu: docZip.nsu, schema: docZip.schema, chave,
                status: r.status,
                motivo: r.upgrade ? 'resumo→completa (valor/itens gravados)' : null,
              });
              // Manifestacao automatica: resNFe importado entra na FILA de
              // 'Ciencia da Operacao' (210210), processada apos a paginacao.
              // SEFAZ libera o procNFe completo no proximo ciclo DistDFe.
              // Nao enfileira 'atualizado' (ja e a completa, nao precisa).
              if (r.tipoDoc === 'resNFe' && r.chave) {
                resumosParaCiencia.push(r.chave);
              }
            } else if (r.status === 'duplicado') {
              duplicados++;
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'duplicado', motivo: r.motivo || null });
            } else if (r.status === 'evento_anexado' || r.status === 'evento_stub_criado') {
              // Evento (cancelamento/ciencia/etc) anexado a uma NFe — sucesso,
              // nao e erro. Conta como 'novo' (algo foi gravado).
              novosXmls++;
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'evento-ok', motivo: r.tipo || null });
            } else if (r.status === 'duplicado_evento' || r.status === 'evento_skip_vazio') {
              // Evento que ja tinha sido anexado antes (reprocessamento via
              // reset NSU) OU evento vazio — nao e erro, e duplicata benigna.
              duplicados++;
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'evento-dup', motivo: r.tipo || null });
            } else {
              erros++;
              marcarFalha(docZip.nsu);
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'erro-import', motivo: r.motivo || JSON.stringify(r).slice(0, 200) });
              console.warn('[orchestrator] import retornou erro:', r);
            }
          } catch (e) {
            erros++;
            marcarFalha(docZip.nsu);
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
      if (result.maxNSU) maxNSUFinal = result.maxNSU;
      if (result.maxNSU && result.ultNSU && result.maxNSU === result.ultNSU) break;
      if (result.cStat !== '138') break;
      // Anti-656: respiro curto entre páginas. Backlog de 90d = até 50
      // requisições seguidas no NFeDistribuicaoDFe; sem pausa vira rajada e o
      // WAF da SEFAZ derruba a própria paginação com "Consumo Indevido".
      // 500ms × 50 páginas = +25s no pior caso — barato pelo risco evitado.
      await new Promise(r => setTimeout(r, 500));
    }

    // Cursor SEGURO: nunca persiste além de um NSU que falhou ao importar (senão
    // o doc fica atrás do cursor e a SEFAZ nunca mais o reenvia). Segura antes do
    // menor NSU falho pra retentar no próximo run; desiste após MAX_TENTATIVAS_NSU.
    const nsusFalhos = [...nsusFalhosSet];
    const cursorInfo = calcularCursorSeguro({
      reachedNSU: ultNSU,
      nsusFalhos,
      travadoAnterior: estadoAnterior.travado,
    });
    const cursorPersistir = cursorInfo.cursor;
    if (cursorInfo.desistiu) {
      console.warn(`[sync-orchestrator] empresa=${empresaId} DESISTIU do NSU ${cursorInfo.nsuDesistido} após ${MAX_TENTATIVAS_NSU} tentativas — cursor avançado, doc pulado`);
      await registrarErroSefaz({
        empresaId, empresaCnpj: cnpjNum,
        motivo: `NSU ${cursorInfo.nsuDesistido} falhou ${MAX_TENTATIVAS_NSU}x ao importar; cursor avançado (documento pulado). Investigar e, se necessário, reset NSU manual.`,
        contexto: { nsuDesistido: cursorInfo.nsuDesistido, maxNSU: maxNSUFinal },
        capturadoPor,
      });
    } else if (nsusFalhos.length) {
      console.warn(`[sync-orchestrator] empresa=${empresaId} cursor SEGURADO em ${cursorPersistir} (${nsusFalhos.length} NSU(s) falho(s), trava em ${cursorInfo.travado?.nsu}, tentativa ${cursorInfo.travado?.tentativas}) — retenta no próximo run`);
    }

    // Pendência estimada: quantos NSUs a SEFAZ ainda tem além do cursor (usa o
    // cursor EFETIVAMENTE persistido, não o alcançado em memória).
    const pendenciaNSU = (maxNSUFinal && cursorPersistir)
      ? Math.max(0, parseInt(maxNSUFinal, 10) - parseInt(cursorPersistir, 10))
      : 0;

    const persistResult = await persisteUltNSU(cnpjNum, cursorPersistir, {
      cStatUltimaSync: cStatFinal,
      xMotivoUltimaSync: xMotivoFinal,
      paginas: pagina,
      maxNSUUltimaSync: maxNSUFinal,
      pendenciaNSU,
      nsuAlcancado: ultNSU,
      nsuTravado: cursorInfo.travado?.nsu || null,
      tentativasTravado: cursorInfo.travado?.tentativas || null,
      ultimoColaborador: capturadoPor?.email || null,
      fonteUltimaSync: capturadoPor?.fonte || 'desconhecido',
      // Carimba o reset pro cooldown anti-656 (bloqueia repetir o 90d em loop).
      // Grava mesmo quando o reset acabou em 656 — foi ele que armou o 656.
      ...(resetNSU ? { ultimoResetNsuEm: fa().firestore.FieldValue.serverTimestamp() } : {}),
    }, lockToken);
    if (persistResult && persistResult.persistido === false) {
      // Run passou do TTL de 1h e outro cron reassumiu o lock desta empresa —
      // não sobrescrevemos o cursor/contador dele. Os docs deste run já foram
      // importados (idempotente); o dono atual continua do cursor correto.
      console.warn(`[sync-orchestrator] empresa=${empresaId} lock reassumido por outro run (TTL excedido) — cursor NÃO persistido pra evitar clobber`);
    }

    // Fila de Ciência pós-paginação: sequencial, espaçada, SEM re-download
    // (skipRedownload) — zero chamadas extras ao NFeDistribuicaoDFe. Roda em
    // background pra não travar a resposta do /sync-one.
    if (resumosParaCiencia.length > 0) {
      const chaves = [...resumosParaCiencia];
      console.log(`[sync-orchestrator] empresa=${empresaId} enfileirando ciência de ${chaves.length} resumo(s) pós-paginação`);
      setImmediate(async () => {
        try {
          const { manifestarUma } = await import('./manifesto-orchestrator.js');
          for (const chave of chaves) {
            try {
              await manifestarUma({
                chNFe: chave,
                cnpjDestinatario: cnpjNum,
                tipo: 'ciencia',
                capturadoPor: { ...capturadoPor, motivo: 'auto-pos-import-resNFe' },
                empresaId,
                uf,
                skipRedownload: true,
              });
            } catch (mfErr) {
              console.warn(`[auto-manifestar] ${chave} falhou:`, mfErr.message);
            }
            await new Promise(r => setTimeout(r, 1200));
          }
        } catch (e) {
          console.warn('[sync-orchestrator] fila de ciência abortou:', e.message);
        }
      });
    }

    if (rateLimited) {
      return {
        ok: false, rateLimited: true,
        motivo: resetNSU
          ? 'SEFAZ retornou cStat 656 (Consumo Indevido) durante o "Recapturar do zero". '
            + 'O reset (NSU 0) é o que dispara o 656 — NÃO repita o 90d; aguarde ~1h e use o '
            + 'Sincronizar normal (incremental). Saída própria não vem por aqui — use o cofre de e-mail.'
          : 'SEFAZ retornou cStat 656 (Consumo Indevido) — aguarde ~1h e sincronize de novo (incremental). '
            + 'Evite "Recapturar do zero" repetido: o reset re-arma o 656.',
        novosXmls, duplicados, erros, ultNSU, paginas: pagina,
        maxNSU: maxNSUFinal, pendenciaNSU,
        cienciasEnfileiradas: resumosParaCiencia.length,
        documentosProcessados,
      };
    }

    return {
      ok: true, novosXmls, duplicados, erros, ultNSU, paginas: pagina,
      cStat: cStatFinal, xMotivo: xMotivoFinal,
      maxNSU: maxNSUFinal, pendenciaNSU,
      cienciasEnfileiradas: resumosParaCiencia.length,
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
