// ============================================================================
// sefaz-backend/health-consolidado-routes.js  (ESM)
//
// Endpoint /health consolidado que junta os 4 diagnosticos:
//   1. Cadastros incompletos
//   2. Documentos fiscais com defeito + duplicatas
//   3. Certificados vencendo
//   4. Configuracoes (env vars / modos)
//
// Uso:
//   - Cron noturno: bate 1 endpoint, decide se manda email
//   - Pingdom/UptimeRobot: olha so o status code (200=ok, 503=problema)
//   - Painel "saude geral": mostra os 4 resumos lado a lado
//
// So admin. Cada diagnostico isolado em try/catch — se um falhar, retorna
// status do outro com `_erros` listando o que nao rodou.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { pendenciasCadastro, gravidadeCadastro } from './diagnostico-cadastros-helper.js';
import { faixaDeVencimento, urgenciaFaixa, diasAteVencimento } from './cert-vencimento-helper.js';
import { diagnosticarConfig } from './diagnostico-config-helper.js';
import { listCertsEmpresas } from './cert-storage.js';

// Valor do documento em TODAS as formas (o import pelo navegador grava só
// `totais.vNF`) — régua única.
import { valorDoDocumento } from './xml-metadata-helper.js';
const router = express.Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

router.get('/', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });

        const erros = [];

        // ─── 1. Cadastros ─────────────────────────────────────────────────
        let cadastros = null;
        try {
            const db = fa().firestore();
            const empresas = [];
            for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
                const snap = await db.collection(col).get();
                snap.forEach((doc) => {
                    const d = doc.data();
                    if (d._merged_into || d._deleted) return;
                    const pendencias = pendenciasCadastro(d, regime);
                    empresas.push({ id: doc.id, gravidade: gravidadeCadastro(pendencias), pendencias });
                });
            }
            cadastros = {
                total: empresas.length,
                criticos: empresas.filter((e) => e.gravidade === 'critico').length,
                altos: empresas.filter((e) => e.gravidade === 'alto').length,
                medios: empresas.filter((e) => e.gravidade === 'medio').length,
                ok: empresas.filter((e) => e.gravidade === 'ok').length,
            };
        } catch (e) {
            erros.push({ secao: 'cadastros', erro: e.message });
        }

        // ─── 2. Documentos fiscais ────────────────────────────────────────
        let documentos = null;
        try {
            const db = fa().firestore();
            const docs = await fetchAllDocs(db.collection('documentos_fiscais'), { label: 'health/docs' });
            let semChave = 0, semCompetencia = 0, semDirecao = 0, semValor = 0, semEmpresa = 0;
            const porChave = new Map();
            for (const d of docs) {
                const x = d.data() || {};
                const chave = String(x.chave || x.chaveAcesso || '').replace(/\D/g, '');
                if (chave.length !== 44) semChave++;
                else porChave.set(chave, (porChave.get(chave) || 0) + 1);
                if (!/^\d{4}-\d{2}$/.test(String(x.competencia || ''))) semCompetencia++;
                if (x.direcao !== 'entrada' && x.direcao !== 'saida') semDirecao++;
                const valor = Number(valorDoDocumento(x)) || 0;
                if (!Number.isFinite(valor) || valor <= 0) semValor++;
                if (!x.empresaId || !x.empresaCnpj) semEmpresa++;
            }
            let duplicadas = 0;
            for (const c of porChave.values()) if (c > 1) duplicadas += c;
            documentos = {
                total: docs.length,
                semChave, semCompetencia, semDirecao, semValor, semEmpresa, duplicadas,
            };
        } catch (e) {
            erros.push({ secao: 'documentos', erro: e.message });
        }

        // ─── 3. Certificados ──────────────────────────────────────────────
        let certificados = null;
        try {
            const agora = new Date();
            const items = [];
            // Cert SEFAZ global
            try {
                const sefazDoc = await fa().firestore().collection('sefaz_certificados').doc('atual').get();
                if (sefazDoc.exists) {
                    const fim = sefazDoc.data().validade?.fim;
                    if (fim) items.push({ faixa: faixaDeVencimento(diasAteVencimento(fim, agora)) });
                }
            } catch { /* ignora — vai para o catch externo */ }
            // Certs por empresa
            const lista = await listCertsEmpresas();
            for (const c of (lista || [])) {
                items.push({ faixa: faixaDeVencimento(diasAteVencimento(c.notAfter, agora)) });
            }
            certificados = {
                total: items.length,
                expirados: items.filter((i) => i.faixa === 'expirado').length,
                criticos: items.filter((i) => i.faixa === '1' || i.faixa === '3').length,
                urgentes: items.filter((i) => i.faixa === '7').length,
                atencao: items.filter((i) => i.faixa === '15' || i.faixa === '30').length,
                ok: items.filter((i) => i.faixa === null).length,
            };
        } catch (e) {
            erros.push({ secao: 'certificados', erro: e.message });
        }

        // ─── 4. Configurações ─────────────────────────────────────────────
        let configuracoes = null;
        try {
            const { resumo } = diagnosticarConfig(process.env, 'prod');
            configuracoes = {
                total: resumo.total,
                criticos: resumo.criticos,
                altos: resumo.altos,
                medios: resumo.medios,
            };
        } catch (e) {
            erros.push({ secao: 'configuracoes', erro: e.message });
        }

        // ─── Status global ────────────────────────────────────────────────
        const cadCrit = cadastros?.criticos || 0;
        const docDef = (documentos?.semChave || 0) + (documentos?.semEmpresa || 0);
        const certExp = certificados?.expirados || 0;
        const cfgCrit = configuracoes?.criticos || 0;

        const totalCritico = cadCrit + certExp + cfgCrit;
        const totalAlto = (cadastros?.altos || 0) + (certificados?.criticos || 0) + (certificados?.urgentes || 0) + (configuracoes?.altos || 0);

        const status = totalCritico > 0 ? 'critico'
            : totalAlto > 0 ? 'alto'
            : (docDef > 0 || (documentos?.duplicadas || 0) > 0) ? 'medio'
            : erros.length > 0 ? 'degraded'
            : 'ok';

        const statusCode = status === 'critico' ? 503
            : status === 'alto' ? 200
            : status === 'degraded' ? 200
            : 200;

        return res.status(statusCode).json({
            status,
            totais: { critico: totalCritico, alto: totalAlto },
            secoes: { cadastros, documentos, certificados, configuracoes },
            _erros: erros,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[health-consolidado]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

export default router;
