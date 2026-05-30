// ============================================================================
// sefaz-backend/nfse-sp-portal-orchestrator.js
// Captura NFSe SP via PORTAL (CSV) — automação completa.
//
// Fluxo cron noturno:
//   1. mTLS login com cert A1 do escritório
//   2. GET tela exportação → captura tokens + lista de prestadores autorizados
//   3. Pra cada prestador (ou empresas elegíveis do Firestore):
//      a. POST EXPORTAR (NFs Emitidas) → CSV → parser → importer
//      b. POST EXPORTAR (NFs Recebidas) → CSV → parser → importer
//   4. Lock por CNPJ (TTL 1h) + log em nfsesp_portal_cron_logs
// ============================================================================

import admin from 'firebase-admin';
import { loadCertificate } from './secret-loader.js';
import {
    loginPortalSp,
    carregarTelaExportacao,
    baixarCsv,
    fmtDataPt,
} from './nfse-sp-portal-client.js';
import { parseCsvNfseSp } from './nfse-sp-csv-parser.js';
import { importarCsvNfseSp } from './nfse-sp-csv-importer.js';

const LOCK_TTL_MS = 60 * 60 * 1000;
const THROTTLE_MS = 1500; // 1.5s entre prestadores (anti-WAF do portal SP)

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Período padrão: mês anterior completo ────────────────────────────────

function periodoMesAnterior() {
    const hoje = new Date();
    const ano = hoje.getMonth() === 0 ? hoje.getFullYear() - 1 : hoje.getFullYear();
    const mes = hoje.getMonth() === 0 ? 11 : hoje.getMonth() - 1;
    const inicio = new Date(ano, mes, 1);
    const fim = new Date(ano, mes + 1, 0); // último dia
    return {
        dataInicio: fmtDataPt(inicio),
        dataFim: fmtDataPt(fim),
        anoMes: `${ano}-${String(mes + 1).padStart(2, '0')}`,
    };
}

// ─── Lock por CNPJ ────────────────────────────────────────────────────────

async function tentaLockCnpj(cnpj) {
    const db = fa().firestore();
    const ref = db.collection('nfsesp_portal_locks').doc(cnpj);
    const now = Date.now();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
            const data = snap.data();
            const expiresAt = data.expiresAt?.toMillis?.() ?? 0;
            if (expiresAt > now) return false;
        }
        tx.set(ref, {
            lockedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromMillis(now + LOCK_TTL_MS),
        });
        return true;
    });
}

// ─── Empresas elegíveis ───────────────────────────────────────────────────
// Empresas que têm ccmSp cadastrado E aparecem no dropdown de prestadores
// do portal (o que confirma que o escritório está autorizado).

async function listarEmpresasComCcm() {
    const db = fa().firestore();
    const mapa = new Map();
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        const snap = await db.collection(col).get();
        snap.forEach((doc) => {
            const d = doc.data();
            const ccm = (d.ccmSp || '').toString().replace(/\D/g, '');
            const cnpj = (d.cnpj || '').replace(/\D/g, '');
            if (!ccm || cnpj.length !== 14) return;
            if (mapa.has(ccm)) return;
            mapa.set(ccm, {
                id: doc.id,
                cnpj,
                ccm,
                nome: d.razaoSocial || d.nome || '',
                colecao: col,
            });
        });
    }
    return Array.from(mapa.values());
}

// ─── Sincroniza UMA empresa (1 CSV emitidas + 1 CSV recebidas) ────────────

async function sincronizarPrestador({ session, prestador, empresa, periodo }) {
    const certs = await loadCertificate();
    const baseArgs = {
        cookies: session.cookies,
        tokens: session.tokens,
        prestadorValue: prestador.value,
        dataInicio: periodo.dataInicio,
        dataFim: periodo.dataFim,
        naoCanceladas: false,
        pfxBuffer: certs.pfxBuffer,
        password: certs.password,
    };

    const resultado = { ccm: prestador.ccm, nome: prestador.nome || empresa?.nome, prestador: null, tomador: null };

    // 1. Emitidas (prestadas)
    try {
        const r = await baixarCsv({ ...baseArgs, tipo: 'emitidas' });
        const parsed = parseCsvNfseSp(r.csv);
        const importado = await importarCsvNfseSp(parsed, {
            empresaId: empresa?.id || null,
            empresaCnpj: empresa?.cnpj || null,
            empresaNome: empresa?.nome || prestador.nome,
            direcao: 'saida',
            importadoPor: 'cron-portal-sp',
        });
        resultado.prestador = {
            totalNotas: importado.totalNotas,
            criadas: importado.criadas,
            atualizadas: importado.atualizadas,
            erros: importado.erros,
            valorTotal: importado.valorTotal,
            fileName: r.fileName,
            csvSize: r.size,
        };
        // Atualiza cookies (se o servidor renovou)
        session.cookies = r.cookies;
    } catch (e) {
        resultado.prestador = { erro: e.message };
    }

    await sleep(THROTTLE_MS);

    // 2. Recebidas (tomadas)
    try {
        const r = await baixarCsv({ ...baseArgs, tipo: 'recebidas' });
        const parsed = parseCsvNfseSp(r.csv);
        const importado = await importarCsvNfseSp(parsed, {
            empresaId: empresa?.id || null,
            empresaCnpj: empresa?.cnpj || null,
            empresaNome: empresa?.nome || prestador.nome,
            direcao: 'entrada',
            importadoPor: 'cron-portal-sp',
        });
        resultado.tomador = {
            totalNotas: importado.totalNotas,
            criadas: importado.criadas,
            atualizadas: importado.atualizadas,
            erros: importado.erros,
            valorTotal: importado.valorTotal,
            fileName: r.fileName,
            csvSize: r.size,
        };
        session.cookies = r.cookies;
    } catch (e) {
        resultado.tomador = { erro: e.message };
    }

    // Atualiza state da empresa
    if (empresa?.cnpj) {
        try {
            await fa().firestore().collection('nfsesp_portal_state').doc(empresa.cnpj).set({
                ultimaSync: admin.firestore.FieldValue.serverTimestamp(),
                ultimoPeriodo: periodo.anoMes,
                prestadasUlt: resultado.prestador?.totalNotas ?? null,
                tomadasUlt: resultado.tomador?.totalNotas ?? null,
                erroPrestadas: resultado.prestador?.erro || null,
                erroTomadas: resultado.tomador?.erro || null,
            }, { merge: true });
        } catch (e) {
            console.warn(`[nfsesp-portal] state save falhou ${empresa.cnpj}:`, e.message);
        }
    }

    return resultado;
}

// ─── Orquestração completa ────────────────────────────────────────────────

/**
 * Pipeline cron: login do escritório → enumera prestadores autorizados no
 * portal → cruza com empresas do Firestore (por CCM) → pra cada bate
 * Emitidas + Recebidas do mês anterior.
 */
export async function sincronizarNfseSpViaPortal({ periodo, capturadoPor } = {}) {
    const inicio = Date.now();
    const per = periodo || periodoMesAnterior();
    const log = {
        iniciadoEm: new Date(inicio).toISOString(),
        periodo: per,
        fonte: 'portal-csv',
        capturadoPor: capturadoPor || 'cron',
    };

    let session;
    try {
        const certs = await loadCertificate();
        const login = await loginPortalSp({ pfxBuffer: certs.pfxBuffer, password: certs.password });
        const tela = await carregarTelaExportacao({
            cookies: login.cookies,
            pfxBuffer: certs.pfxBuffer,
            password: certs.password,
        });
        session = { cookies: tela.cookies, tokens: tela.tokens };
        log.prestadoresAutorizados = tela.prestadores.length;
        console.log(`[nfsesp-portal] login ok. ${tela.prestadores.length} prestadores autorizados.`);

        // Cruza com Firestore (só sincroniza empresas que estão no nosso cadastro)
        const empresasFs = await listarEmpresasComCcm();
        const mapaEmpresas = new Map(empresasFs.map(e => [e.ccm, e]));

        let processadas = 0;
        let prestadasTotal = 0, tomadasTotal = 0;
        let erros = 0;
        const detalhes = [];

        for (const prest of tela.prestadores) {
            const emp = mapaEmpresas.get(prest.ccm);
            if (!emp) {
                detalhes.push({ ccm: prest.ccm, nome: prest.nome, status: 'sem-cadastro-firestore' });
                continue;
            }

            // Lock por CNPJ
            const lockOk = await tentaLockCnpj(emp.cnpj);
            if (!lockOk) {
                detalhes.push({ ccm: prest.ccm, nome: prest.nome, cnpj: emp.cnpj, status: 'lock-ativo' });
                continue;
            }

            processadas++;
            try {
                const r = await sincronizarPrestador({
                    session, prestador: prest, empresa: emp, periodo: per,
                });
                prestadasTotal += r.prestador?.totalNotas || 0;
                tomadasTotal += r.tomador?.totalNotas || 0;
                if (r.prestador?.erro || r.tomador?.erro) erros++;
                detalhes.push({ ccm: prest.ccm, cnpj: emp.cnpj, ...r });
                console.log(`[nfsesp-portal] ${emp.cnpj} ${prest.ccm} ok: prest=${r.prestador?.totalNotas || '-'} tom=${r.tomador?.totalNotas || '-'}`);
            } catch (e) {
                erros++;
                detalhes.push({ ccm: prest.ccm, cnpj: emp.cnpj, status: 'erro', motivo: e.message });
                console.error(`[nfsesp-portal] ${emp.cnpj} ERRO:`, e.message);
            }

            await sleep(THROTTLE_MS);
        }

        log.processadas = processadas;
        log.prestadasTotalNotas = prestadasTotal;
        log.tomadasTotalNotas = tomadasTotal;
        log.totalNovos = prestadasTotal + tomadasTotal;
        log.totalEmpresas = processadas;
        log.sucessos = processadas - erros;
        log.falhas = erros;
        log.duracaoMs = Date.now() - inicio;
        log.detalhes = detalhes;
        log.detalhesCount = detalhes.length;
    } catch (e) {
        log.erroFatal = e.message;
        log.duracaoMs = Date.now() - inicio;
        log.processadas = 0;
        log.sucessos = 0;
        log.falhas = 0;
        log.totalNovos = 0;
        log.totalEmpresas = 0;
        log.detalhesCount = 0;
        console.error('[nfsesp-portal] erro fatal:', e);
    } finally {
        // Persiste log (sem detalhes individuais — pode estourar 1 MiB)
        try {
            const logFirestore = { ...log };
            delete logFirestore.detalhes; // remove array de detalhes antes de salvar
            await fa().firestore().collection('nfsesp_portal_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                ...logFirestore,
            });
        } catch (logErr) {
            console.warn('[nfsesp-portal] log falhou:', logErr.message);
        }
    }

    return log;
}
