// ============================================================================
// sefaz-backend/sync-orchestrator.js  (ESM)
// Coordena 1 sincronização SEFAZ: lock + cliente + importer + cursor NSU.
// ============================================================================

import admin from 'firebase-admin';
import { consultaDistDFe, consultaDistDFeComCert } from './sefaz-client.js';
import { loadCertEmpresa, loadCertEmpresaPorCnpjBase } from './cert-storage.js';
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

// Carrega flags da empresa (uf + procuracaoEcacAtiva) consultando
// simples_empresas e lucro_empresas (tenta as duas). A flag de procuracao
// continua informativa para outros fluxos, mas NFe DistDFe no Cloud Run exige
// A1 da propria raiz CNPJ. SEFAZ rejeita cert do escritorio com cStat=593.
async function carregarFlagsEmpresa(empresaId, empresaCnpj) {
  if (!empresaId) return { uf: null, procuracaoEcacAtiva: false };
  const db = fa().firestore();
  for (const col of ['simples_empresas', 'lucro_empresas']) {
    try {
      const snap = await db.collection(col).doc(empresaId).get();
      if (snap.exists) {
        const d = snap.data() || {};
        // Cadastro canonico: dadosFiscais.uf. Fallback ao top-level pra
        // cobrir docs legados onde a UF foi gravada como d.uf direto.
        const uf = d.dadosFiscais?.uf || d.uf;
        return {
          uf: uf ? String(uf).trim().toUpperCase() : null,
          procuracaoEcacAtiva: d.procuracaoEcacAtiva === true,
        };
      }
    } catch (e) {
      console.warn(`[sync-orchestrator] erro lendo ${col}/${empresaId}:`, e.message);
    }
  }
  // Caso especial: a propria S&P (escritorio) — defaulta SP. Sem isso,
  // o escritorio tinha que cadastrar UF=SP pra si mesmo manualmente, o
  // que e ridiculo (S&P Assessoria Contabil esta literalmente em SP).
  const cnpjNum = String(empresaCnpj || '').replace(/\D/g, '');
  if (cnpjNum === CNPJ_ESCRITORIO) return { uf: 'SP', procuracaoEcacAtiva: false };
  return { uf: null, procuracaoEcacAtiva: false };
}

export async function sincronizarEmpresa({ empresaId, empresaCnpj, capturadoPor, resetNSU = false }) {
  const cnpjNum = String(empresaCnpj).replace(/\D/g, '');
  if (cnpjNum.length !== 14) return { ok: false, motivo: `CNPJ inválido: ${empresaCnpj}` };

  // Carrega UF + procuracaoEcacAtiva da empresa.
  const { uf } = await carregarFlagsEmpresa(empresaId, cnpjNum);
  if (!uf) {
    return {
      ok: false,
      motivo: `UF não cadastrada para a empresa. Acesse a tela de configuração e preencha dadosFiscais.uf (ex: SP).`,
    };
  }

  const lockResult = await acquireLock(cnpjNum, capturadoPor?.email || capturadoPor?.uid || 'system');
  if (!lockResult.ok) return { ok: false, motivo: lockResult.motivo, locked: true };

  // resetNSU=true zera o cursor → SEFAZ reenvia TODO o historico de DF-e dos
  // ultimos ~90 dias. Usado quando uma nota "passou" do cursor sem ser gravada
  // (caso BRASLIMPO: cursor avancou em disparos que abortavam por cert/UF).
  let ultNSU = resetNSU ? '0' : await carregaUltNSU(cnpjNum);
  if (resetNSU) console.log(`[sync-orchestrator] empresa=${empresaId} RESET NSU=0 solicitado`);
  let novosXmls = 0;
  let duplicados = 0;
  let erros = 0;
  let pagina = 0;
  let cStatFinal = null;
  let xMotivoFinal = null;
  let rateLimited = false;

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
      if (result.cStat === '137') {
        // NT DistDFe: mesmo sem documentos (137) a SEFAZ devolve ultNSU — deve
        // ser armazenado pra não reconsumir o mesmo NSU no próximo disparo.
        if (result.ultNSU) ultNSU = result.ultNSU;
        break;
      }

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
              // Manifestacao automatica: assim que um resNFe e importado com
              // sucesso, dispara 'Ciencia da Operacao' (210210) em background.
              // SEFAZ libera o procNFe completo na proxima DistDFe pra essa
              // chave. Sem isso a base fica so com resumos, sem itens/totais.
              // Nao dispara pra 'atualizado' (ja e a completa, nao precisa).
              if (r.tipoDoc === 'resNFe' && r.chave) {
                setImmediate(async () => {
                  try {
                    const { manifestarUma } = await import('./manifesto-orchestrator.js');
                    await manifestarUma({
                      chNFe: r.chave,
                      cnpjDestinatario: cnpjNum,
                      tipo: 'ciencia',
                      capturadoPor: { ...capturadoPor, motivo: 'auto-pos-import-resNFe' },
                      empresaId,
                      // Reusa o A1 que acabou de consultar o DistDFe — mesma
                      // exigência da SEFAZ: evento assinado pelo cert da raiz
                      // CNPJ do destinatário (cert do escritório dá cStat 593).
                      certOverride,
                    });
                  } catch (mfErr) {
                    console.warn(`[auto-manifestar] ${r.chave} falhou:`, mfErr.message);
                  }
                });
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
              documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'erro-import', motivo: r.motivo || JSON.stringify(r).slice(0, 200) });
              console.warn('[orchestrator] import retornou erro:', r);
              // O cursor NSU avança mesmo com erro na página — sem gravar o
              // XML bruto aqui, o documento fica irrecuperável (janela SEFAZ
              // ~90 dias, só via resetNSU manual).
              await registrarErroSefaz({
                empresaId, empresaCnpj: cnpjNum,
                motivo: r.motivo || 'import retornou erro',
                contexto: { nsu: docZip.nsu, schema: docZip.schema, chave },
                xmlBruto: docZip.xml,
                capturadoPor,
              });
            }
          } catch (e) {
            erros++;
            documentosProcessados.push({ nsu: docZip.nsu, schema: docZip.schema, chave, status: 'excecao-import', motivo: e.message });
            console.error('[orchestrator] exceção no import:', e.message);
            await registrarErroSefaz({
              empresaId, empresaCnpj: cnpjNum,
              motivo: e.message, contexto: { nsu: docZip.nsu, schema: docZip.schema, chave },
              xmlBruto: docZip.xml,
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
