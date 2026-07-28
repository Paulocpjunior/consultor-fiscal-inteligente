// ============================================================================
// sefaz-backend/prova-captura-routes.js  (ESM)
// ----------------------------------------------------------------------------
// GET /api/admin/sefaz/prova-captura?cnpj=29240822000121
//
// Responde "a captura DESTE CNPJ está completa?" com dado da FONTE:
// o cursor do DistDFe (ultNSU × maxNSU) gravado em `sefaz_state`. Não compara
// com concorrente — se a SEFAZ diz que tem documento além do que lemos, a
// captura está incompleta e ponto.
//
// Sempre por RAIZ: matriz e filial são CNPJs distintos na SEFAZ, com cursor e
// documentos próprios. Olhar um e concluir sobre o outro foi exatamente o que
// gerou o "79 × 502" do caso NOVA ERA (28/07/2026).
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { podeAcessarCnpj } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { selecionarCertA1PorBase } from './cert-base-helper.js';
import { montarProvaCaptura } from './prova-captura.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/** Empresas da raiz (Simples + Lucro), pulando lápide e fundidas. */
async function carregarEmpresasDaRaiz(db, raiz) {
    const out = [];
    for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
        const snap = await db.collection(col).get();
        snap.forEach((doc) => {
            const d = doc.data() || {};
            if (d._deleted || d._merged_into) return;
            const cnpj = soDigitos(d.cnpj);
            if (cnpj.slice(0, 8) !== raiz) return;
            out.push({
                id: doc.id,
                cnpj,
                nome: d.razaoSocial || d.nome || d.fantasia || '—',
                regime,
                capturarSefaz: d.capturarSefaz !== false,
                uf: d.dadosFiscais?.uf || d.uf || null,
            });
        });
    }
    return out;
}

router.get('/prova-captura', requireAuth, async (req, res) => {
    try {
        const cnpj = soDigitos(req.query.cnpj);
        if (cnpj.length !== 14) {
            return res.status(400).json({ ok: false, error: 'Informe o CNPJ completo (14 dígitos) da empresa a provar.' });
        }
        const acesso = await podeAcessarCnpj(req.user, cnpj);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const db = getDb();
        const raiz = cnpj.slice(0, 8);
        const empresas = await carregarEmpresasDaRaiz(db, raiz);

        // Certificado: a regra canônica é a da RAIZ (#315) — filial sem cert
        // usa o A1 válido da matriz. Só o que barra a consulta NFe entra como
        // motivo de bloqueio aqui; o detalhamento fino vive no Status.
        const certsMeta = [];
        const certPorEmpresaId = new Map();
        const certsSnap = await db.collection('empresas_certificados').get();
        certsSnap.forEach((doc) => {
            const d = doc.data() || {};
            const meta = {
                empresaId: doc.id,
                tipoCert: d.tipoCert || 'A1',
                cnpj: soDigitos(d.cnpj),
                cnpjCert: soDigitos(d.cnpj),
                notAfter: d.notAfter || null,
            };
            certsMeta.push(meta);
            certPorEmpresaId.set(doc.id, meta);
        });

        const agoraMs = Date.now();
        for (const e of empresas) {
            const proprio = certPorEmpresaId.get(e.id);
            const proprioValido = !!proprio
                && (proprio.tipoCert === 'A3' || (proprio.notAfter && new Date(proprio.notAfter).getTime() > agoraMs));
            const daRaiz = proprioValido ? null : selecionarCertA1PorBase(certsMeta, e.cnpj, agoraMs, e.id);
            e.tipoCert = proprioValido ? proprio.tipoCert : (daRaiz ? 'A1-raiz' : 'nenhum');
            e.motivosBloqueio = [];
            if (!proprioValido && !daRaiz) {
                e.motivosBloqueio.push('sem certificado A1 próprio nem da mesma raiz (a SEFAZ não é consultada sem certificado)');
            }
            if (!e.uf) e.motivosBloqueio.push('UF não cadastrada nos dados fiscais');
        }

        // Cursor da SEFAZ por CNPJ da raiz — é aqui que mora a prova.
        const states = {};
        await Promise.all([...new Set([cnpj, ...empresas.map((e) => e.cnpj)])].map(async (c) => {
            const snap = await db.collection('sefaz_state').doc(c).get();
            if (!snap.exists) return;
            const d = snap.data() || {};
            states[c] = {
                ultNSU: d.ultNSU ?? null,
                maxNSU: d.maxNSUUltimaSync ?? d.maxNSU ?? null,
                pendenciaNSU: d.pendenciaNSU ?? null,
                nsuTravado: d.nsuTravado || null,
                cStatUltimaSync: d.cStatUltimaSync || null,
                xMotivoUltimaSync: d.xMotivoUltimaSync || null,
                ultimaSyncMs: d.ultimaSync?.toMillis?.() ?? null,
            };
        }));

        // Documentos da raiz: uma query por CNPJ (índice simples, recorte
        // pequeno) — nunca varredura da coleção inteira.
        const docs = [];
        for (const c of new Set([cnpj, ...empresas.map((e) => e.cnpj)])) {
            const snaps = await fetchAllDocs(
                db.collection('documentos_fiscais')
                    .where('empresaCnpj', '==', c)
                    .select('empresaCnpj', 'direcao', 'status', 'competencia', 'dhEmi', 'schema', 'tipoDoc', 'temItens', 'chave'),
                { label: `prova-captura ${c}`, maxDocs: 60000 },
            );
            for (const s of snaps) docs.push(s.data() || {});
        }

        const prova = montarProvaCaptura({ cnpjAlvo: cnpj, empresas, states, docs, agoraMs });
        return res.json({ ...prova, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[prova-captura]', e);
        return res.status(500).json({ ok: false, error: `Falha ao montar a prova: ${e.message}` });
    }
});

export default router;
