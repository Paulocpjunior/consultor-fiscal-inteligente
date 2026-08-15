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
import { montarProvaCaptura, montarProvaCarteira } from './prova-captura.js';
import { getCnpjsDaCarteira } from './carteira-auth.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/**
 * Motivo de bloqueio por empresa, pela regra canônica da RAIZ (#315): filial
 * sem certificado próprio usa o A1 válido da matriz. Extraído da rota de UM
 * CNPJ para a varredura da carteira usar a MESMA régua — segunda cópia aqui
 * faria as duas telas discordarem sobre quem está bloqueado.
 */
async function anotarBloqueios(db, empresas, agoraMs) {
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
    return empresas;
}

/** Cursor do DistDFe de um CNPJ — a forma que o núcleo espera. */
function lerState(d) {
    return {
        ultNSU: d.ultNSU ?? null,
        maxNSU: d.maxNSUUltimaSync ?? d.maxNSU ?? null,
        pendenciaNSU: d.pendenciaNSU ?? null,
        nsuTravado: d.nsuTravado || null,
        cStatUltimaSync: d.cStatUltimaSync || null,
        xMotivoUltimaSync: d.xMotivoUltimaSync || null,
        ultimaSyncMs: d.ultimaSync?.toMillis?.() ?? null,
    };
}

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

// ============================================================================
// GET /api/admin/sefaz/prova-captura-carteira
//
// "Como estão as capturas?" — a CARTEIRA inteira numa resposta (Paulo, 15/08).
// A prova por CNPJ já existia e responde bem; o que não existia era a visão do
// conjunto, e a única saída era abrir a tela ~390 vezes ou estimar de memória.
//
// ESCOPO: colaborador vê a carteira DELE, admin vê tudo — mesma regra do resto
// do app. E o recorte é DITO na resposta: recorte que não se declara é o que
// faz alguém ler o número de uma carteira como se fosse o do escritório.
//
// CUSTO: lê `sefaz_state` (uma coleção) + os dois cadastros + certificados.
// NÃO varre `documentos_fiscais` — por isso o veredito de quem está com o
// cursor em dia sai como `cursor-em-dia` (com `naoConferido`), nunca
// "em-dia-na-fonte", que afirmaria também sobre os resumos.
// ============================================================================
router.get('/prova-captura-carteira', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        // `null` = admin (sem restrição); array = a carteira do colaborador.
        const daCarteira = await getCnpjsDaCarteira(req.user);
        const permitidos = daCarteira === null ? null : new Set(daCarteira);

        const empresas = [];
        for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
                const d = doc.data() || {};
                if (d._deleted || d._merged_into) return;
                const cnpj = soDigitos(d.cnpj);
                if (cnpj.length !== 14) return;
                if (permitidos && !permitidos.has(cnpj)) return;
                empresas.push({
                    id: doc.id, cnpj, regime,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    capturarSefaz: d.capturarSefaz !== false,
                    uf: d.dadosFiscais?.uf || d.uf || null,
                });
            });
        }

        const agoraMs = Date.now();
        await anotarBloqueios(db, empresas, agoraMs);

        const states = {};
        const stSnap = await db.collection('sefaz_state').get();
        stSnap.forEach((doc) => {
            const c = soDigitos(doc.id);
            if (c.length !== 14) return;
            // Cursor de CNPJ fora da carteira não entra — senão o colaborador
            // veria pendência de cliente que não é dele.
            if (permitidos && !permitidos.has(c)) return;
            states[c] = lerState(doc.data() || {});
        });

        const carteira = montarProvaCarteira({ empresas, states, agoraMs });
        return res.json({
            ok: true,
            ...carteira,
            recorte: permitidos ? 'carteira' : 'todas as empresas',
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[prova-captura-carteira]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

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
        const agoraMs = Date.now();
        await anotarBloqueios(db, empresas, agoraMs);

        // Cursor da SEFAZ por CNPJ da raiz — é aqui que mora a prova.
        const states = {};
        await Promise.all([...new Set([cnpj, ...empresas.map((e) => e.cnpj)])].map(async (c) => {
            const snap = await db.collection('sefaz_state').doc(c).get();
            if (!snap.exists) return;
            states[c] = lerState(snap.data() || {});
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
