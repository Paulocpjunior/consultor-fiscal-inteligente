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
import { requireAuth } from './require-admin.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// CNPJ do escritório (SP Assessoria Contábil) — quem detém o cert default.
const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

router.get('/empresas-status-captura', requireAuth, async (req, res) => {
    try {
        const db = fa().firestore();
        const agora = new Date();

        // 1. Lista todas as empresas (Simples + Lucro)
        const empresasMap = new Map();
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            snap.forEach(doc => {
                const d = doc.data();
                const cnpj = (d.cnpj || '').replace(/\D/g, '');
                if (cnpj.length !== 14) return;
                if (empresasMap.has(cnpj)) return; // dedup
                empresasMap.set(cnpj, {
                    id: doc.id,
                    cnpj,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    regime: col === 'simples_empresas' ? 'simples' : 'lucro',
                    fonte: col,
                    capturarSefaz: d.capturarSefaz !== false, // default true
                    ccmSp: (d.ccmSp || '').toString().trim(),
                    nfseSpAutorizadoEm: d.nfseSpAutorizadoEm?.toMillis?.() ?? null,
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

        // 4. Monta resposta agregada
        const empresas = [];
        const resumo = {
            total: 0,
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

        for (const emp of empresasMap.values()) {
            const cert = certsMap.get(emp.id);
            let tipoCert = 'nenhum';
            let certUploaded = false;
            let certValido = false;
            let certVenceEm = null;
            let usaCertEscritorio = false;

            if (cert) {
                certUploaded = true;
                tipoCert = cert.tipoCert;
                if (cert.notAfter) {
                    const venceEm = new Date(cert.notAfter);
                    certValido = venceEm > agora;
                    certVenceEm = cert.notAfter;
                }
            } else {
                // Sem cert próprio — pode usar o cert do escritório se houver procuração
                if (emp.procuracaoEcacAtiva) {
                    tipoCert = 'escritorio';
                    usaCertEscritorio = true;
                    certValido = true; // assume escritório válido (verificar separado)
                }
            }

            // Cálculo de capacidade de captura
            const motivosBloqueio = [];

            // a) NFe DistDFe: precisa cert válido (próprio ou do escritório via procuração)
            const capturaNfeOk = certValido && emp.capturarSefaz;
            if (!emp.capturarSefaz) motivosBloqueio.push('Captura SEFAZ desativada manualmente');
            else if (tipoCert === 'nenhum') motivosBloqueio.push('Sem certificado A1/A3 e sem procuração e-CAC');
            else if (!certValido && certUploaded) motivosBloqueio.push(`Certificado ${tipoCert} expirado em ${certVenceEm}`);
            else if (tipoCert === 'A3') motivosBloqueio.push('Tipo A3 — captura via agente local cfi-a3, não pelo Cloud Run');

            // b) NFSe SP: precisa ccmSp + autorização do contador no portal SP
            const capturaNfseSpOk = !!emp.ccmSp && !!emp.nfseSpAutorizadoEm;
            if (!emp.ccmSp) motivosBloqueio.push('NFSe SP: falta Inscrição Municipal (ccmSp)');
            else if (!emp.nfseSpAutorizadoEm) motivosBloqueio.push('NFSe SP: falta autorização do escritório no portal nfe.prefeitura.sp.gov.br');

            // c) NFSe Nacional: precisa flag + procuração e-CAC
            const capturaNfseNacionalOk = emp.nfseNacionalDfeAtivo && emp.procuracaoEcacAtiva;
            if (!emp.procuracaoEcacAtiva) motivosBloqueio.push('NFSe Nacional: falta procuração e-CAC pro escritório');
            else if (!emp.nfseNacionalDfeAtivo) motivosBloqueio.push('NFSe Nacional: flag nfseNacionalDfeAtivo desabilitada');

            const state = stateMap.get(emp.cnpj);

            const item = {
                id: emp.id,
                cnpj: emp.cnpj,
                nome: emp.nome,
                regime: emp.regime,
                fonte: emp.fonte,
                // certificados
                tipoCert,
                certUploaded,
                certValido,
                certVenceEm,
                usaCertEscritorio,
                // procuração / autorizações
                procuracaoEcacAtiva: emp.procuracaoEcacAtiva,
                ccmSp: emp.ccmSp,
                nfseSpAutorizado: !!emp.nfseSpAutorizadoEm,
                nfseNacionalDfeAtivo: emp.nfseNacionalDfeAtivo,
                capturarSefaz: emp.capturarSefaz,
                // capacidades
                capturaNfeOk,
                capturaNfseSpOk,
                capturaNfseNacionalOk,
                motivosBloqueio,
                // estado última sync
                ultimaSyncMs: state?.ultimaSyncMs ?? null,
                ultNSU: state?.ultNSU ?? null,
                cStatUltimaSync: state?.cStatUltimaSync ?? null,
            };
            empresas.push(item);

            // Resumo
            resumo.total++;
            if (tipoCert === 'A1') resumo.comCertA1++;
            else if (tipoCert === 'A3') resumo.comCertA3++;
            else if (tipoCert === 'escritorio') resumo.usandoCertEscritorio++;
            else resumo.semCertNenhum++;
            if (certVenceEm) {
                const dias = (new Date(certVenceEm).getTime() - agora.getTime()) / 86400000;
                if (dias < 0) resumo.certExpirado++;
                else if (dias < 30) resumo.certVenceEm30d++;
            }
            if (emp.procuracaoEcacAtiva) resumo.comProcuracaoEcac++;
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

export default router;
