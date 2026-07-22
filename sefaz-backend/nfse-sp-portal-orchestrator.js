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
    loadSessaoManual,
    carregarTelaExportacao,
    baixarCsv,
    fmtDataPt,
} from './nfse-sp-portal-client.js';
import { loginHeadlessPortalSp } from './nfse-sp-headless-login.js';
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

export function periodoMesAnterior(hoje = new Date()) {
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

// Janela padrão do CRON: últimos 40 dias ATÉ HOJE. Bug 22/07/2026: o default
// era periodoMesAnterior() — em julho o cron re-baixava junho toda noite
// ("0 novas") e NUNCA capturava o mês corrente; a "última nota" ficou parada
// em 30/06 por 3 semanas. 40 dias cobre o mês atual inteiro + a cauda do mês
// anterior (notas emitidas com atraso); o importer deduplica, então re-baixar
// é seguro e o volume é equivalente ao que já se baixava (1 mês/noite).
export function periodoJanelaCorrente(hoje = new Date(), dias = 40) {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - dias);
    return {
        dataInicio: fmtDataPt(inicio),
        dataFim: fmtDataPt(hoje),
        anoMes: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`,
    };
}

// ─── Lock por CNPJ ────────────────────────────────────────────────────────

async function tentaLockCnpj(cnpj) {
    if (!cnpj || String(cnpj).length !== 14) {
        // Empresa auto-cadastrada sem CNPJ ainda — não tem como criar lock.
        // Permite seguir (sem lock); o portal SP já é rate-limit por sessão.
        return true;
    }
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
            // Cadastro unico: CCM canonico em dadosFiscais.ccmSp (mesmo caminho
            // do nfse-sp-orchestrator API). Fallback ao top-level legado.
            // Sem isso, CCM gravada pelo modal Dados Fiscais (que so grava em
            // dadosFiscais.ccmSp) nao era vista pelo caminho do portal headless.
            const ccm = (d.dadosFiscais?.ccmSp || d.ccmSp || '').toString().replace(/\D/g, '');
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
    // Default: janela rolante de 40d até hoje (mês CORRENTE incluso) — o
    // mês-anterior fixo deixava julho sem nenhuma nota até agosto.
    const per = periodo || periodoJanelaCorrente();
    const log = {
        iniciadoEm: new Date(inicio).toISOString(),
        periodo: per,
        fonte: 'portal-csv',
        capturadoPor: capturadoPor || 'cron',
    };

    // HEARTBEAT: grava 'iniciado' JÁ — a varredura leva 15-25 min (188 empresas
    // × throttle anti-WAF) e sem isto o painel ficava mudo do clique até o fim
    // ("travado" e "rodando" eram indistinguíveis — caso 22/07 16:57).
    let logRef = null;
    try {
        logRef = await fa().firestore().collection('nfsesp_portal_cron_logs').add({
            executadoEm: admin.firestore.FieldValue.serverTimestamp(),
            status: 'iniciado',
            iniciadoEm: log.iniciadoEm,
            periodo: per,
            fonte: 'portal-csv',
            capturadoPor: log.capturadoPor,
        });
    } catch (e) {
        console.warn('[nfsesp-portal] heartbeat inicial falhou:', e.message);
    }

    let session;
    try {
        const certs = await loadCertificate();
        // Estratégia de login (em ordem):
        // 1. Headless (Chromium com cert A1) — 100% automático
        // 2. Cookies manuais (admin colou via UI) — fallback emergencial
        // 3. mTLS direto — fallback derradeiro
        let cookies;
        try {
            const headless = await loginHeadlessPortalSp();
            cookies = headless.cookies;
            log.metodoLogin = 'headless';
            console.log(`[nfsesp-portal] login headless ok (${Object.keys(cookies).length} cookies)`);
        } catch (headlessErr) {
            // HeadlessLoginError carrega tipo (manutencao | timeout-rede |
            // selector-mudou | cert-rejeitado | desconhecido) e tentativas.
            // Persistimos no log do cron pra metrica honesta de causa-raiz —
            // sem isso, painel so dizia "login falhou" sem distinguir
            // "portal em manutencao" (esperar) de "DOM mudou" (atualizar
            // selectors) de "cert rejeitado" (renovar cert).
            log.headlessErroTipo = headlessErr.tipo || 'desconhecido';
            log.headlessTentativas = headlessErr.tentativas || 1;
            console.warn(`[nfsesp-portal] login headless falhou: tipo=${log.headlessErroTipo} tentativas=${log.headlessTentativas} msg=${headlessErr.message} — tentando cookies manuais`);
            try {
                const manual = await loadSessaoManual();
                cookies = manual.cookies;
                log.metodoLogin = 'cookies-manuais';
                console.log(`[nfsesp-portal] usando cookies manuais (atualizados ${manual.atualizadoEm?.toDate?.()?.toISOString?.()})`);
            } catch (manualErr) {
                console.warn(`[nfsesp-portal] cookies manuais indisponíveis (${manualErr.message}) — tentando mTLS direto`);
                const login = await loginPortalSp({ pfxBuffer: certs.pfxBuffer, password: certs.password });
                cookies = login.cookies;
                log.metodoLogin = 'mtls-direto';
                console.log('[nfsesp-portal] login mTLS direto ok');
            }
        }
        const tela = await carregarTelaExportacao({
            cookies,
            pfxBuffer: certs.pfxBuffer,
            password: certs.password,
        });
        session = { cookies: tela.cookies, tokens: tela.tokens };
        log.prestadoresAutorizados = tela.prestadores.length;
        console.log(`[nfsesp-portal] tela exportação ok. ${tela.prestadores.length} prestadores autorizados.`);

        // Cruza com Firestore (só sincroniza empresas que estão no nosso cadastro)
        const empresasFs = await listarEmpresasComCcm();
        const mapaEmpresas = new Map(empresasFs.map(e => [e.ccm, e]));

        let processadas = 0;
        let prestadasTotal = 0, tomadasTotal = 0;
        let erros = 0;
        let autoCadastradas = 0;
        const detalhes = [];

        for (const prest of tela.prestadores) {
            let emp = mapaEmpresas.get(prest.ccm);
            // AUTO-CADASTRO: empresa autorizada no portal SP mas sem cadastro
            // no Firestore — cria stub em `nfsesp_empresas_descobertas` pra
            // permitir captura no próximo cron sem trabalho operacional.
            if (!emp) {
                try {
                    const stubId = `ccm-${prest.ccm}`;
                    const stubRef = fa().firestore().collection('nfsesp_empresas_descobertas').doc(stubId);
                    const stubSnap = await stubRef.get();
                    if (!stubSnap.exists) {
                        await stubRef.set({
                            ccm: prest.ccm,
                            nome: prest.nome,
                            value: prest.value,
                            descobertoEm: admin.firestore.FieldValue.serverTimestamp(),
                            descobertoPor: capturadoPor || 'cron',
                            statusCadastro: 'pendente-cnpj',
                        });
                        autoCadastradas++;
                    }
                    // Usa o stub como empresa pra ainda baixar CSV (cnpj não preenchido
                    // ainda, mas baixar a NF mesmo assim — direção identificada pelo
                    // próprio CSV)
                    emp = {
                        id: stubId,
                        cnpj: '', // desconhecido — empresa precisa ser linkada manualmente
                        ccm: prest.ccm,
                        nome: prest.nome,
                        colecao: 'nfsesp_empresas_descobertas',
                    };
                } catch (e) {
                    detalhes.push({ ccm: prest.ccm, nome: prest.nome, status: 'erro-auto-cadastro', motivo: e.message });
                    continue;
                }
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
        log.autoCadastradas = autoCadastradas;
        log.prestadasTotalNotas = prestadasTotal;
        log.tomadasTotalNotas = tomadasTotal;
        log.totalNovos = prestadasTotal + tomadasTotal;
        log.totalEmpresas = processadas;
        log.sucessos = processadas - erros;
        log.falhas = erros;
        log.duracaoMs = Date.now() - inicio;
        log.detalhes = detalhes;
        log.detalhesCount = detalhes.length;
        // Resumo dos erros pra persistir (array `detalhes` inteiro estoura 1 MiB
        // em runs grandes — guardamos top 10 falhas com motivo enxuto).
        log.errosResumo = detalhes
            .filter(d => d.prestador?.erro || d.tomador?.erro || d.status === 'erro' || d.status === 'erro-auto-cadastro')
            .slice(0, 10)
            .map(d => ({
                cnpj: d.cnpj || null,
                ccm: d.ccm || null,
                nome: (d.nome || '').slice(0, 60) || null,
                erroPrestador: (d.prestador?.erro || '').slice(0, 200) || null,
                erroTomador: (d.tomador?.erro || '').slice(0, 200) || null,
                motivo: (d.motivo || '').slice(0, 200) || null,
                status: d.status || null,
            }));
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
        // Persiste log (sem detalhes individuais — pode estourar 1 MiB).
        // Atualiza o MESMO doc do heartbeat ('iniciado' → 'sucesso'/'falha');
        // se o heartbeat não existiu, cria um novo (comportamento antigo).
        try {
            const logFirestore = { ...log };
            delete logFirestore.detalhes; // remove array de detalhes antes de salvar
            logFirestore.status = log.erroFatal ? 'falha' : 'sucesso';
            if (logRef) {
                await logRef.update({
                    executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                    ...logFirestore,
                });
            } else {
                await fa().firestore().collection('nfsesp_portal_cron_logs').add({
                    executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                    ...logFirestore,
                });
            }
        } catch (logErr) {
            console.warn('[nfsesp-portal] log falhou:', logErr.message);
        }
    }

    return log;
}
