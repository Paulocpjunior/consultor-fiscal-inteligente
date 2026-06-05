// ============================================================================
// sefaz-backend/empresa-status-routes.js
// ----------------------------------------------------------------------------
// Endpoint admin que retorna pra CADA empresa elegível de captura:
//   - tipoCert      : 'A1' | 'A3' | 'escritorio' | 'nenhum'
//   - certUploaded  : bool (cert subido em empresas_certificados)
//   - certValido    : bool (notAfter > hoje)
//   - certVenceEm   : ISO date
//   - usaCertEscritorio : bool (sem cert próprio, escritório usa cert dele)
//   - procuracaoEcacAtiva : bool (flag manual no doc da empresa)
//   - nfseSpAutorizado    : bool (ccmSp + nfseSpAutorizadoEm)
//   - nfseNacionalDfeAtivo: bool
//   - capturaNfeOk        : bool
//   - capturaNfseSpOk     : bool
//   - capturaNfseNacionalOk : bool
//   - motivosBloqueio     : string[] (gaps identificados)
//
// Montado em /api/admin/sefaz/empresas-status-captura
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import forge from 'node-forge';
import { requireAuth } from './require-admin.js';
import { getCnpjsDaCarteira } from './carteira-auth.js';
import { loadCertificate } from './secret-loader.js';
import { lookupCnpj } from './brasilapi-cache.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// Normaliza uma data que pode chegar em formatos diferentes para millis:
//   - Timestamp do Firestore   (escrito pelo backend/cron)    -> .toMillis()
//   - string ISO               (escrita pelo front via setDoc) -> Date.parse
//   - number em millis / Date  -> direto
// Sem isso o badge NFSe SP rodava .toMillis() numa string ISO (o painel grava
// nfseSpAutorizadoEm como ISO via new Date().toISOString()), o resultado virava
// null e marcava "falta autorização" mesmo com a data salva e a empresa
// ELEGÍVEL no painel. A captura em si nunca foi bloqueada — os orquestradores
// (nfse-sp-routes/orchestrator, sync-routes) checam truthiness do valor cru.
function toMillis(v) {
    if (v == null) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();        // Firestore Timestamp
    if (typeof v.toDate === 'function') return v.toDate().getTime();  // Timestamp-like
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const ms = Date.parse(v);
        return Number.isNaN(ms) ? null : ms;
    }
    return null;
}

// CNPJ do escritório (SP Assessoria Contábil) — quem detém o cert default.
const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

router.get('/empresas-status-captura', requireAuth, async (req, res) => {
    try {
        const db = fa().firestore();
        const agora = new Date();

        // Multi-tenancy: admin ve todas. Colaborador ve so as empresas da
        // carteira dele (via colecao `carteiras`). Se nao tem nenhuma na
        // carteira, vai retornar lista vazia (intencional — sem carteira =
        // sem acesso a empresa nenhuma).
        const cnpjsPermitidos = await getCnpjsDaCarteira(req.user);
        const cnpjsSet = cnpjsPermitidos ? new Set(cnpjsPermitidos) : null;

        // 1. Lista todas as empresas (Simples + Lucro)
        const empresasMap = new Map();
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            snap.forEach(doc => {
                const d = doc.data();
                const cnpj = (d.cnpj || '').replace(/\D/g, '');
                if (cnpj.length !== 14) return;
                if (empresasMap.has(cnpj)) return; // dedup
                if (cnpjsSet && !cnpjsSet.has(cnpj)) return; // filtra pela carteira
                empresasMap.set(cnpj, {
                    id: doc.id,
                    cnpj,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    regime: col === 'simples_empresas' ? 'simples' : 'lucro',
                    fonte: col,
                    capturarSefaz: d.capturarSefaz !== false, // default true
                    uf: d.dadosFiscais?.uf || d.uf || '',
                    // Cadastro UNICO: ccmSp em dadosFiscais.ccmSp (canonico, igual
                    // uf/IE). Fallback ao top-level d.ccmSp so pra dado legado.
                    ccmSp: (d.dadosFiscais?.ccmSp || d.ccmSp || '').toString().replace(/\D/g, ''),
                    nfseSpAutorizadoEm: toMillis(d.nfseSpAutorizadoEm),
                    nfseNacionalDfeAtivo: d.nfseNacionalDfeAtivo === true,
                    procuracaoEcacAtiva: d.procuracaoEcacAtiva === true,
                });
            });
        }

        // 2. Lista todos os certs cadastrados
        const certsMap = new Map();
        const certsSnap = await db.collection('empresas_certificados').get();
        certsSnap.forEach(doc => {
            const d = doc.data();
            certsMap.set(doc.id, {
                tipoCert: d.tipoCert || 'A1', // default A1 (subido via .pfx)
                cnpjCert: (d.cnpj || '').replace(/\D/g, ''),
                notAfter: d.notAfter || null,
                fingerprint: d.fingerprint || null,
                uploadedAt: d.uploadedAt?.toDate?.()?.toISOString?.() || null,
            });
        });

        // 3. Estado de última captura por CNPJ
        const stateMap = new Map();
        const stateSnap = await db.collection('sefaz_state').get();
        stateSnap.forEach(doc => {
            const d = doc.data();
            stateMap.set(doc.id, {
                ultimaSyncMs: d.ultimaSync?.toMillis?.() ?? null,
                ultNSU: d.ultNSU || '0',
                cStatUltimaSync: d.cStatUltimaSync || null,
            });
        });

        // 3b. Responsáveis (vínculos da Carteira de Clientes) por CNPJ.
        // Permite admin/colaborador ver de cara quem cuida de cada empresa
        // direto no painel de Status (antes precisava abrir Carteira de Clientes
        // numa aba separada e cruzar manualmente).
        const responsaveisMap = new Map();
        const carteirasSnap = await db.collection('carteiras').get();
        carteirasSnap.forEach(doc => {
            const d = doc.data();
            const cnpj = (d.empresaCnpj || '').replace(/\D/g, '');
            if (!cnpj) return;
            if (!responsaveisMap.has(cnpj)) responsaveisMap.set(cnpj, []);
            responsaveisMap.get(cnpj).push({
                nome: d.colaboradorNome || '—',
                papel: d.papel || 'principal',
            });
        });

        // 4. Monta resposta agregada
        const empresas = [];
        const resumo = {
            total: 0,
            semUf: 0,
            comCertA1: 0,
            comCertA3: 0,
            usandoCertEscritorio: 0,
            semCertNenhum: 0,
            certExpirado: 0,
            certVenceEm30d: 0,
            comProcuracaoEcac: 0,
            semProcuracaoEcac: 0,
            ccmSpAutorizado: 0,
            nfseNacionalAtivo: 0,
            // Status de captura
            capturaNfeOk: 0,
            capturaNfeBloqueada: 0,
            capturaNfseSpOk: 0,
            capturaNfseNacionalOk: 0,
        };

        // Lê o cert do escritório (Secret Manager) UMA vez por request e
        // extrai o CNPJ-Base do subject. Usado pra detectar o mismatch que
        // causa cStat=593 em massa (cert global pertence a outro CNPJ).
        // loadCertificate() tem cache TTL 5min — chamada repetida é grátis.
        let cnpjBaseCertEscritorio = null;
        let certEscritorioErro = null;
        try {
            const certEsc = await loadCertificate();
            if (certEsc?.pemCert) {
                const cert509 = forge.pki.certificateFromPem(certEsc.pemCert);
                const subjectAttrs = cert509.subject?.attributes || [];
                const cn = (subjectAttrs.find(a => a.shortName === 'CN' || a.name === 'commonName')?.value || '');
                const serial = (subjectAttrs.find(a => a.shortName === 'serialNumber')?.value || '');
                const matchCN = cn.match(/:(\d{14})$/);
                const matchSerial = serial.match(/\d{14}/);
                const cnpjCert = matchCN ? matchCN[1] : (matchSerial ? matchSerial[0] : null);
                if (cnpjCert) cnpjBaseCertEscritorio = cnpjCert.slice(0, 8);
            }
        } catch (e) {
            certEscritorioErro = e.message;
            console.warn('[empresa-status-routes] falha lendo cert do escritorio:', e.message);
        }

        for (const emp of empresasMap.values()) {
            const cert = certsMap.get(emp.id);
            let tipoCert = 'nenhum';
            let certUploaded = false;
            let certValido = false;
            let certVenceEm = null;
            let usaCertEscritorio = false;

            // A propria empresa do escritorio (S&P) tem o cert dela no Secret
            // Manager (carregado por loadCertificate()), NAO em empresas_certificados.
            // Sem esse caso especial, ela aparecia como "sem cert" na varredura
            // mesmo sendo o dono do cert global usado por todas as procuracoes.
            const ehEscritorio = emp.cnpj === CNPJ_ESCRITORIO;

            if (cert) {
                certUploaded = true;
                tipoCert = cert.tipoCert;
                if (cert.notAfter) {
                    const venceEm = new Date(cert.notAfter);
                    certValido = venceEm > agora;
                    certVenceEm = cert.notAfter;
                }
            } else if (ehEscritorio) {
                // Cert do escritorio vive em Secret Manager. Marca como A1 proprio.
                // Nao puxa notAfter daqui pra nao adicionar chamada ao Secret Manager
                // na rota de varredura (cara, +200ms por request). Se precisar do
                // venc real, a tela de Configurações > Certificado Digital mostra.
                tipoCert = 'A1';
                certUploaded = true;
                certValido = true;
            } else {
                // Sem cert próprio — pode usar o cert do escritório se houver procuração
                if (emp.procuracaoEcacAtiva) {
                    tipoCert = 'escritorio';
                    usaCertEscritorio = true;
                    certValido = true; // assume escritório válido (verificar separado)
                }
            }

            // Empresa com cert A1/A3 próprio NÃO precisa de procuração e-CAC
            // separada — o cert já autoriza. A flag só importa quando usa cert
            // do escritório. Pra UI mostrar verde, inferimos como ativa.
            const procuracaoInferida = emp.procuracaoEcacAtiva || (tipoCert === 'A1' || tipoCert === 'A3');

            // Cálculo de capacidade de captura
            const motivosBloqueio = [];

            // a) NFe DistDFe: precisa cert válido + UF cadastrada + cert-base bater
            // O mismatch CNPJ-Base só importa quando usa cert do escritório (cert
            // global) ou quando a empresa É o escritório. Empresas com cert próprio
            // já são validadas pelo sanity check do sync-orchestrator.
            const empresaCnpjBase = String(emp.cnpj || '').slice(0, 8);
            const certBaseMismatch = (usaCertEscritorio || emp.cnpj === CNPJ_ESCRITORIO)
                && cnpjBaseCertEscritorio
                && cnpjBaseCertEscritorio !== empresaCnpjBase;
            const capturaNfeOk = certValido && emp.capturarSefaz && !!emp.uf && !certBaseMismatch;
            if (!emp.capturarSefaz) motivosBloqueio.push('Captura SEFAZ desativada manualmente');
            else if (!emp.uf) motivosBloqueio.push('UF não cadastrada (preencha dadosFiscais.uf, ex: SP)');
            else if (tipoCert === 'nenhum') motivosBloqueio.push('Sem certificado A1/A3 e sem procuração e-CAC');
            else if (!certValido && certUploaded) motivosBloqueio.push(`Certificado ${tipoCert} expirado em ${certVenceEm}`);
            else if (tipoCert === 'A3') motivosBloqueio.push('Tipo A3 — captura via agente local cfi-a3, não pelo Cloud Run');
            else if (certBaseMismatch) {
                motivosBloqueio.push(
                    `Cert do escritório no Secret Manager é de outro CNPJ-Base (${cnpjBaseCertEscritorio}) — esperado ${empresaCnpjBase}. ` +
                    `SEFAZ rejeita com cStat=593. Suba o .pfx correto via 'Empresas Monitoradas → Certificado'.`
                );
            }
            if (certEscritorioErro && (usaCertEscritorio || emp.cnpj === CNPJ_ESCRITORIO)) {
                motivosBloqueio.push(`Cert do escritório indisponível: ${certEscritorioErro}`);
            }

            // b) NFSe SP: precisa ccmSp + autorização do contador no portal SP
            const capturaNfseSpOk = !!emp.ccmSp && !!emp.nfseSpAutorizadoEm;
            if (!emp.ccmSp) motivosBloqueio.push('NFSe SP: falta Inscrição Municipal (ccmSp)');
            else if (!emp.nfseSpAutorizadoEm) motivosBloqueio.push('NFSe SP: falta autorização do escritório no portal nfe.prefeitura.sp.gov.br');

            // c) NFSe Nacional: precisa flag + procuração e-CAC (ou cert próprio que já autoriza)
            const capturaNfseNacionalOk = emp.nfseNacionalDfeAtivo && procuracaoInferida;
            if (!procuracaoInferida) motivosBloqueio.push('NFSe Nacional: falta procuração e-CAC pro escritório (ou cert A1 próprio)');
            else if (!emp.nfseNacionalDfeAtivo) motivosBloqueio.push('NFSe Nacional: flag nfseNacionalDfeAtivo desabilitada');

            const state = stateMap.get(emp.cnpj);

            const item = {
                id: emp.id,
                cnpj: emp.cnpj,
                nome: emp.nome,
                regime: emp.regime,
                fonte: emp.fonte,
                uf: emp.uf,
                // certificados
                tipoCert,
                certUploaded,
                certValido,
                certVenceEm,
                usaCertEscritorio,
                // procuração / autorizações (inferida=true se tem cert A1/A3 próprio)
                procuracaoEcacAtiva: procuracaoInferida,
                procuracaoEcacFlagBruta: emp.procuracaoEcacAtiva,
                ccmSp: emp.ccmSp,
                nfseSpAutorizado: !!emp.nfseSpAutorizadoEm,
                nfseNacionalDfeAtivo: emp.nfseNacionalDfeAtivo,
                capturarSefaz: emp.capturarSefaz,
                // capacidades
                capturaNfeOk,
                capturaNfseSpOk,
                capturaNfseNacionalOk,
                motivosBloqueio,
                // responsáveis na carteira de clientes (vazio = ninguém atribuído)
                responsaveis: responsaveisMap.get(emp.cnpj) || [],
                // estado última sync
                ultimaSyncMs: state?.ultimaSyncMs ?? null,
                ultNSU: state?.ultNSU ?? null,
                cStatUltimaSync: state?.cStatUltimaSync ?? null,
            };
            empresas.push(item);

            // Resumo
            resumo.total++;
            if (!emp.uf) resumo.semUf++;
            if (tipoCert === 'A1') resumo.comCertA1++;
            else if (tipoCert === 'A3') resumo.comCertA3++;
            else if (tipoCert === 'escritorio') resumo.usandoCertEscritorio++;
            else resumo.semCertNenhum++;
            if (certVenceEm) {
                const dias = (new Date(certVenceEm).getTime() - agora.getTime()) / 86400000;
                if (dias < 0) resumo.certExpirado++;
                else if (dias < 30) resumo.certVenceEm30d++;
            }
            if (procuracaoInferida) resumo.comProcuracaoEcac++;
            else resumo.semProcuracaoEcac++;
            if (capturaNfseSpOk) resumo.ccmSpAutorizado++;
            if (emp.nfseNacionalDfeAtivo) resumo.nfseNacionalAtivo++;
            if (capturaNfeOk) resumo.capturaNfeOk++;
            else resumo.capturaNfeBloqueada++;
            if (capturaNfseSpOk) resumo.capturaNfseSpOk++;
            if (capturaNfseNacionalOk) resumo.capturaNfseNacionalOk++;
        }

        // Ordena: bloqueadas primeiro (pra ficar fácil ver o que precisa atenção)
        empresas.sort((a, b) => {
            const aBlocked = a.motivosBloqueio.length;
            const bBlocked = b.motivosBloqueio.length;
            if (aBlocked !== bBlocked) return bBlocked - aBlocked;
            return a.nome.localeCompare(b.nome);
        });

        return res.json({ resumo, empresas, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[empresa-status-routes] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─── Toggle flags ──────────────────────────────────────────────────────────
// Permite admin ativar/desativar via UI: procuração e-CAC, NFSe Nacional, captura SEFAZ.

router.post('/empresa-toggle-flag', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        const { cnpj, campo, valor } = req.body || {};
        const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
        if (cnpjLimpo.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
        const FLAGS_PERMITIDAS = ['procuracaoEcacAtiva', 'nfseNacionalDfeAtivo', 'capturarSefaz'];
        if (!FLAGS_PERMITIDAS.includes(campo)) {
            return res.status(400).json({ error: `Campo inválido. Permitidos: ${FLAGS_PERMITIDAS.join(', ')}` });
        }
        if (typeof valor !== 'boolean') {
            return res.status(400).json({ error: 'Valor deve ser boolean' });
        }

        const db = fa().firestore();
        let atualizadas = 0;
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).where('cnpj', '==', cnpjLimpo).limit(1).get();
            for (const doc of snap.docs) {
                await doc.ref.update({
                    [campo]: valor,
                    [`${campo}AlteradoEm`]: admin.firestore.FieldValue.serverTimestamp(),
                    [`${campo}AlteradoPor`]: req.user.email,
                });
                atualizadas++;
            }
        }
        if (!atualizadas) return res.status(404).json({ error: 'Empresa não encontrada' });
        console.log(`[empresa-toggle-flag] cnpj=${cnpjLimpo} ${campo}=${valor} por=${req.user.email}`);
        return res.json({ ok: true, cnpj: cnpjLimpo, campo, valor, atualizadas });
    } catch (e) {
        console.error('[empresa-toggle-flag] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─── Auto-preencher UF via BrasilAPI ───────────────────────────────────────
// Itera empresas sem dadosFiscais.uf e busca o estado via BrasilAPI a partir
// do CNPJ. Resolve em massa o motivo "UF não cadastrada" sem trabalho manual.
router.post('/auto-preencher-uf', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        res.json({ ok: true, motivo: 'Auto-preenchimento iniciado em background' });

        setImmediate(async () => {
            const db = fa().firestore();
            const t0 = Date.now();
            let preenchidas = 0, jaTinham = 0, naoEncontradas = 0, erros = 0, total = 0;

            for (const col of ['simples_empresas', 'lucro_empresas']) {
                const snap = await db.collection(col).get();
                for (const doc of snap.docs) {
                    total++;
                    const d = doc.data();
                    const ufAtual = d.dadosFiscais?.uf || d.uf || '';
                    if (ufAtual) { jaTinham++; continue; }
                    const cnpj = (d.cnpj || '').replace(/\D/g, '');
                    if (cnpj.length !== 14) { erros++; continue; }
                    try {
                        const info = await lookupCnpj(cnpj);
                        const uf = info?.uf || null;
                        const municipio = info?.municipio || null;
                        const codMunIBGE = info?.codigo_municipio_ibge || info?.codigo_municipio || null;
                        if (!uf) { naoEncontradas++; continue; }
                        const update = {
                            'dadosFiscais.uf': uf,
                            'dadosFiscais.autoPreenchidoEm': admin.firestore.FieldValue.serverTimestamp(),
                            'dadosFiscais.autoPreenchidoPor': req.user.email,
                        };
                        if (municipio && !d.dadosFiscais?.municipio) update['dadosFiscais.municipio'] = municipio;
                        if (codMunIBGE && !d.dadosFiscais?.codMunIBGE) update['dadosFiscais.codMunIBGE'] = String(codMunIBGE);
                        await doc.ref.update(update);
                        preenchidas++;
                        console.log(`[auto-preencher-uf] ${cnpj} ${d.razaoSocial || d.nome} → uf=${uf} mun=${municipio || '?'}`);
                    } catch (e) {
                        erros++;
                        console.warn(`[auto-preencher-uf] ${cnpj} erro:`, e.message);
                    }
                }
            }

            const duracaoMs = Date.now() - t0;
            await fa().firestore().collection('sefaz_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                tipo: 'auto-preencher-uf',
                total, preenchidas, jaTinham, naoEncontradas, erros,
                duracaoMs,
                fonte: req.user.email,
            });
            console.log(`[auto-preencher-uf] FIM — total=${total} preenchidas=${preenchidas} jaTinham=${jaTinham} naoEncontradas=${naoEncontradas} erros=${erros} (${duracaoMs}ms)`);
        });
    } catch (e) {
        console.error('[auto-preencher-uf] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

export default router;
