// ============================================================================
// sefaz-backend/nfse-tomada-orchestrator.js
//
// Orquestra captura de NFSe TOMADAS via API Sefin Nacional / ADN.
//
// Fluxo:
//   1. Le ultimoNSU em nfse_tomada_estado/{empresaId}
//   2. Chama provider.buscarTomadas(empresaId, cnpj, ultimoNSU)
//   3. Pra cada NFSe nova:
//      - decode XML (GZip+Base64 -> string)
//      - dedup por chaveAcesso
//      - persist em nfse_tomadas/{chave}
//      - upload XML pro SharePoint via sharepoint-provider
//   4. Atualiza ultimoNSU
//   5. Paginate se houver mais lotes (maxNSU > ultimoNSURecebido)
//
// Coleções Firestore:
//   - nfse_tomadas/{chaveAcesso50}      (documento por NFSe)
//   - nfse_tomada_estado/{empresaId}    (NSU + última sync)
// ============================================================================

import admin from 'firebase-admin';
import crypto from 'crypto';
import { gunzipSync } from 'zlib';
import { getNfseTomadaProvider, getNfseTomadaMode } from './nfse-tomada-provider.js';
import { uploadXmlParaEmpresa } from './sharepoint-provider.js';

const COL_TOMADAS = 'nfse_tomadas';
const COL_ESTADO = 'nfse_tomada_estado';
const COL_EMPRESAS_LUCRO = 'lucro_empresas';
const COL_EMPRESAS_SIMPLES = 'simples_empresas';

// ─── Espacamento entre empresas no cron (evita rate limit Sefin) ─────────
const DELAY_ENTRE_EMPRESAS_MS = 2000;
const MAX_LOTES_POR_EMPRESA = 10;        // 10 lotes x 50 docs = 500 NFSe/sync
const MAX_NFSE_POR_LOTE = 50;

// ─── Lazy init Firebase Admin ─────────────────────────────────────────────
function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}
function db() { return fa().firestore(); }

// ─── Logging estruturado ──────────────────────────────────────────────────
function log(level, msg, extra = {}) {
    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level,
        component: 'nfse-tomada-orchestrator',
        msg,
        ...extra,
    }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function decodeXmlGzipBase64(xmlGzipBase64) {
    if (!xmlGzipBase64) return null;
    try {
        const gz = Buffer.from(xmlGzipBase64, 'base64');
        return gunzipSync(gz).toString('utf-8');
    } catch (err) {
        log('warn', 'gzip_decode_failed', { error: err.message });
        return null;
    }
}

function getEstadoRef(empresaId) {
    return db().collection(COL_ESTADO).doc(empresaId);
}

async function getUltimoNSU(empresaId) {
    const snap = await getEstadoRef(empresaId).get();
    if (!snap.exists) return 0;
    return snap.data().ultimoNSU || 0;
}

async function setUltimoNSU(empresaId, ultimoNSU, extras = {}) {
    await getEstadoRef(empresaId).set({
        ultimoNSU,
        ultimaSincronizacao: new Date().toISOString(),
        ...extras,
    }, { merge: true });
}

function periodoDeData(dataIso) {
    if (!dataIso) return new Date().toISOString().slice(0, 7); // YYYY-MM
    return dataIso.slice(0, 7);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Persist + SharePoint pra uma NFSe ────────────────────────────────────
async function persistirNfseTomada({ empresaId, cnpjTomador, doc, xmlContent }) {
    const chave = doc.chaveAcesso;
    if (!chave || chave.length !== 50) {
        throw new Error(`chaveAcesso inválida (len=${chave?.length || 0})`);
    }

    // Dedup: já existe?
    const ref = db().collection(COL_TOMADAS).doc(chave);
    const existing = await ref.get();
    if (existing.exists) {
        return { chave, alreadyExists: true };
    }

    // Fingerprint do XML pra deteccao de re-emissao com alteracao
    const fingerprint = xmlContent ? sha256(xmlContent) : null;

    // Upload SharePoint (idempotente — sharepoint-provider faz check)
    let sharepointUrl = null;
    let sharepointAlreadyExisted = false;
    if (xmlContent) {
        try {
            const periodo = periodoDeData(doc.dataEmissao);
            const fileName = `NFSe-Tomada-${chave}.xml`;
            const spResult = await uploadXmlParaEmpresa(
                cnpjTomador,
                periodo,
                fileName,
                xmlContent,
            );
            sharepointUrl = spResult.url;
            sharepointAlreadyExisted = spResult.alreadyExisted;
        } catch (err) {
            log('warn', 'sharepoint_upload_failed', {
                empresaId, chave, error: err.message,
            });
        }
    }

    // Persist Firestore
    const payload = {
        empresaId,
        cnpjTomador,
        chaveAcesso: chave,
        nsu: doc.nsu,
        dataEmissao: doc.dataEmissao,
        prestador: doc.prestador || {},
        tomador: doc.tomador || { cnpj: cnpjTomador },
        servico: doc.servico || {},
        retencoes: doc.retencoes || {},
        valorBruto: doc.servico?.valor || 0,
        valorLiquido: (doc.servico?.valor || 0) - (doc.servico?.issRetido || 0),
        manifestacao: 'pendente',
        fingerprintXml: fingerprint,
        sharepointUrl,
        sharepointAlreadyExisted,
        tipoDocumento: doc.tipoDocumento || 'NFSe',
        modoCaptura: getNfseTomadaMode(),
        capturadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
    };

    await ref.set(payload);
    log('info', 'nfse_tomada_persistida', {
        empresaId, chave, nsu: doc.nsu, sharepointUrl,
    });

    return { chave, alreadyExists: false, sharepointUrl };
}

// ─── Captura UMA empresa (paginate até maxNSU) ────────────────────────────
export async function capturarTomadasUmaEmpresa({ empresaId, cnpjTomador }) {
    if (!empresaId || !cnpjTomador) {
        throw new Error('empresaId e cnpjTomador obrigatórios');
    }

    const provider = getNfseTomadaProvider();
    const t0 = Date.now();

    let ultimoNSU = await getUltimoNSU(empresaId);
    let totalNovas = 0;
    let totalDuplicadas = 0;
    let totalErros = 0;
    let lotesProcessados = 0;
    let proximoNSU = ultimoNSU;
    let ultimoErro = null;

    log('info', 'captura_iniciada', { empresaId, cnpjTomador, ultimoNSU });

    while (lotesProcessados < MAX_LOTES_POR_EMPRESA) {
        let res;
        try {
            res = await provider.buscarTomadas({
                empresaId, cnpj: cnpjTomador, ultimoNSU: proximoNSU,
            });
        } catch (err) {
            ultimoErro = err.message;
            log('error', 'captura_request_falhou', {
                empresaId, error: err.message,
            });
            break;
        }

        if (res.status !== 200) {
            ultimoErro = res.erro || `HTTP ${res.status}`;
            log('warn', 'captura_status_nao_200', {
                empresaId, status: res.status, erro: ultimoErro,
            });
            break;
        }

        const documentos = res.documentos || [];
        if (documentos.length === 0) {
            log('info', 'captura_sem_novas', { empresaId, proximoNSU });
            break;
        }

        for (const doc of documentos) {
            try {
                // Decode XML — em mock vem direto em xmlContent;
                // em prod restrita/real vem em xmlGzipBase64
                const xmlContent = doc.xmlContent || decodeXmlGzipBase64(doc.xmlGzipBase64);

                const result = await persistirNfseTomada({
                    empresaId, cnpjTomador, doc, xmlContent,
                });
                if (result.alreadyExists) totalDuplicadas++;
                else totalNovas++;

                if (doc.nsu && doc.nsu > proximoNSU) proximoNSU = doc.nsu;
            } catch (err) {
                totalErros++;
                log('error', 'persist_falhou', {
                    empresaId, chave: doc.chaveAcesso,
                    error: err.message,
                });
            }
        }

        lotesProcessados++;
        if (res.ultimoNSURecebido) proximoNSU = res.ultimoNSURecebido;

        // Se maxNSU informado, decide se vale paginate
        const maxNSU = res.maxNSU;
        if (maxNSU && proximoNSU >= maxNSU) {
            log('info', 'captura_finalizada_max_nsu', {
                empresaId, proximoNSU, maxNSU,
            });
            break;
        }

        // Se lote veio com menos que o max, provavelmente acabou
        if (documentos.length < MAX_NFSE_POR_LOTE) break;
    }

    await setUltimoNSU(empresaId, proximoNSU, { ultimoErro });

    const sumario = {
        empresaId, cnpjTomador,
        totalNovas, totalDuplicadas, totalErros,
        lotesProcessados, proximoNSU,
        ultimoErro,
        duracaoMs: Date.now() - t0,
        modo: getNfseTomadaMode(),
    };
    log('info', 'captura_finalizada', sumario);
    return sumario;
}

// ─── Cron — Captura TODAS empresas elegíveis ──────────────────────────────
export async function cronCapturarTomadasTodas() {
    const t0 = Date.now();

    // Pega empresas Lucro Real + Simples Nacional com flag ativa
    const elegiveis = [];

    for (const colName of [COL_EMPRESAS_LUCRO, COL_EMPRESAS_SIMPLES]) {
        const snap = await db().collection(colName)
            .where('capturarNfseTomada', '==', true)
            .get();

        snap.forEach(d => {
            const data = d.data();
            if (data.cnpj && data.certA1Carregado !== false) {
                elegiveis.push({
                    empresaId: d.id,
                    cnpjTomador: data.cnpj.replace(/\D/g, ''),
                    nome: data.nome || data.razaoSocial || d.id,
                    colecao: colName,
                });
            }
        });
    }

    log('info', 'cron_iniciado', { totalEmpresas: elegiveis.length });

    const sumarios = [];
    for (const emp of elegiveis) {
        try {
            const r = await capturarTomadasUmaEmpresa(emp);
            sumarios.push({ ...r, nome: emp.nome });
        } catch (err) {
            log('error', 'cron_empresa_falhou', {
                empresaId: emp.empresaId, error: err.message,
            });
            sumarios.push({
                empresaId: emp.empresaId,
                nome: emp.nome,
                erro: err.message,
            });
        }

        // Espaca pra evitar rate limit Sefin
        await sleep(DELAY_ENTRE_EMPRESAS_MS);
    }

    const totais = sumarios.reduce((acc, s) => ({
        totalNovas: acc.totalNovas + (s.totalNovas || 0),
        totalDuplicadas: acc.totalDuplicadas + (s.totalDuplicadas || 0),
        totalErros: acc.totalErros + (s.totalErros || 0),
        empresasComErro: acc.empresasComErro + (s.erro || s.ultimoErro ? 1 : 0),
    }), { totalNovas: 0, totalDuplicadas: 0, totalErros: 0, empresasComErro: 0 });

    const resultado = {
        empresasProcessadas: elegiveis.length,
        ...totais,
        duracaoMs: Date.now() - t0,
        modo: getNfseTomadaMode(),
        sumarios,
    };
    log('info', 'cron_finalizado', resultado);
    return resultado;
}

// ─── Listar NFSe tomadas (pra UI) ─────────────────────────────────────────
export async function listarNfseTomadas({ empresaId, periodo, limit = 100 }) {
    let query = db().collection(COL_TOMADAS);

    if (empresaId) {
        query = query.where('empresaId', '==', empresaId);
    }
    if (periodo) {
        // periodo = 'YYYY-MM'
        const inicio = `${periodo}-01T00:00:00`;
        const fim = `${periodo}-31T23:59:59`;
        query = query.where('dataEmissao', '>=', inicio)
                     .where('dataEmissao', '<=', fim);
    }

    const snap = await query
        .orderBy('dataEmissao', 'desc')
        .limit(limit)
        .get();

    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Resumo (pra dashboard) ───────────────────────────────────────────────
export async function resumoNfseTomadas({ empresaId, periodo }) {
    const docs = await listarNfseTomadas({ empresaId, periodo, limit: 1000 });
    return {
        total: docs.length,
        valorBruto: docs.reduce((s, d) => s + (d.valorBruto || 0), 0),
        valorLiquido: docs.reduce((s, d) => s + (d.valorLiquido || 0), 0),
        comRetencao: docs.filter(d => Object.values(d.retencoes || {}).some(v => v > 0)).length,
        manifestadas: docs.filter(d => d.manifestacao && d.manifestacao !== 'pendente').length,
        pendentesManifestacao: docs.filter(d => !d.manifestacao || d.manifestacao === 'pendente').length,
        modo: getNfseTomadaMode(),
    };
}
