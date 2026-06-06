// ============================================================================
// sefaz-backend/cert-monitor-routes.js  (ESM)
//
// Painel admin de monitoramento de certificados digitais. Lista TODOS os
// certs por empresa + o cert global SEFAZ (S&P), classifica por dias
// restantes e exibe os que precisam de renovação iminente.
//
// Quando cert vence sem renovar:
//   - SERPRO/SEFAZ/e-CAC param sem aviso
//   - Manifesto de NF-e falha (rejeita comunicacao)
//   - DCTFWeb nao transmite
//   - cobertura de tudo cai pra zero silenciosamente
//
// So admin. Reusa logica pura testada em cert-vencimento-helper.js.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { listCertsEmpresas } from './cert-storage.js';
import { faixaDeVencimento, urgenciaFaixa, diasAteVencimento } from './cert-vencimento-helper.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

router.get('/', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });

        const agora = new Date();
        const certs = [];

        // 1. Cert global SEFAZ (S&P) — usado pra SEFAZ/manifesto.
        // Le direto do Firestore sefaz_certificados/atual (mesmo padrao do cert-manager).
        try {
            const sefazDoc = await fa().firestore().collection('sefaz_certificados').doc('atual').get();
            if (sefazDoc.exists) {
                const data = sefazDoc.data();
                const fim = data.validade?.fim;
                if (fim) {
                    const dias = diasAteVencimento(fim, agora);
                    const faixa = faixaDeVencimento(dias);
                    const u = urgenciaFaixa(faixa);
                    certs.push({
                        escopo: 'sefaz_global',
                        titular: data.titular || data.subject || 'S&P Assessoria Contábil',
                        cnpj: data.cnpj || null,
                        notAfter: fim,
                        diasRestantes: dias,
                        faixa,
                        severidade: u.severidade,
                        labelUrgencia: u.label,
                        afeta: 'SEFAZ + manifesto + sync XML (TODAS as empresas)',
                    });
                }
            }
        } catch (e) {
            console.warn('[cert-monitor] cert SEFAZ indisponível:', e.message);
        }

        // 2. Certs por empresa (uploaded individualmente)
        try {
            const lista = await listCertsEmpresas();
            for (const c of (lista || [])) {
                const dias = diasAteVencimento(c.notAfter, agora);
                const faixa = faixaDeVencimento(dias);
                const u = urgenciaFaixa(faixa);
                certs.push({
                    escopo: 'empresa',
                    empresaId: c.empresaId,
                    cnpj: c.cnpj,
                    titular: c.subject || c.cnpj,
                    notAfter: c.notAfter,
                    diasRestantes: dias,
                    faixa,
                    severidade: u.severidade,
                    labelUrgencia: u.label,
                    afeta: `Apenas ${c.cnpj}`,
                });
            }
        } catch (e) {
            console.warn('[cert-monitor] listCertsEmpresas falhou:', e.message);
        }

        // Ordena: mais urgente primeiro (expirado, depois menor dias)
        const ordem = { expirado: 0, '1': 1, '3': 2, '7': 3, '15': 4, '30': 5, null: 6 };
        certs.sort((a, b) => {
            const r = ordem[a.faixa] - ordem[b.faixa];
            if (r !== 0) return r;
            return (a.diasRestantes || 99999) - (b.diasRestantes || 99999);
        });

        const resumo = {
            total: certs.length,
            expirados: certs.filter((c) => c.faixa === 'expirado').length,
            criticos: certs.filter((c) => c.faixa === '1' || c.faixa === '3').length,
            urgentes: certs.filter((c) => c.faixa === '7').length,
            atencao: certs.filter((c) => c.faixa === '15' || c.faixa === '30').length,
            ok: certs.filter((c) => c.faixa === null).length,
        };

        return res.json({ resumo, certs, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[cert-monitor]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

export default router;
