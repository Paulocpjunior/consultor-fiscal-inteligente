// ============================================================================
// sefaz-backend/nfse-iss-retido-routes.js
// ----------------------------------------------------------------------------
//   POST /api/admin/nfse-iss-retido/reler   { empresaId, competencia }
//
// Relê do XML guardado a retenção do ISS das NFS-e da empresa na competência
// (05/10 — o leitor do padrão nacional gravava a retenção INVERTIDA; ver
// `nfse-iss-retido-releitura.js`). Cada nota é relida UMA vez: o carimbo
// `valores.issRetidoRelidoEm` tira a nota da fila. A aba de ISS chama sozinha
// quando vê nota sem o carimbo — ninguém precisa lembrar de clicar.
// ============================================================================
import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth, requireAdmin } from './require-admin.js';
import { podeAcessarEmpresaId } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { docRetiradoDoAcervo, direcaoEfetivaDoc, docCancelado } from './xml-metadata-helper.js';
import { formasDaCompetencia } from './competencia.js';
import {
    precisaReleituraIssRetido, patchDaReleituraIssRetido, ehEnvioDeIss,
} from './nfse-iss-retido-releitura.js';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'consultorfiscalapp';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const bucket = () => admin.storage().bucket(STORAGE_BUCKET);

/** Teto por chamada: a leitura é do Storage. O que sobrar sai dito e entra na próxima. */
const MAX_POR_CHAMADA = 300;

// O corpo JSON já chega parseado pelo parser global do server.js.
const router = Router();

/**
 * Relê do Storage a retenção de cada nota e grava o patch. Devolve as notas
 * cuja retenção MUDOU (antes × depois), com o que a pessoa precisa para
 * achar a guia afetada. Falha de leitura não vira "conferido".
 */
async function relerNotas(alvos, porEmail) {
    const agoraIso = new Date().toISOString();
    let relidas = 0;
    const corrigidas = [];
    const falhas = [];
    const trabalho = [...alvos];
    const trabalhador = async () => {
        while (trabalho.length) {
            const d = trabalho.shift();
            try {
                const [buf] = await bucket().file(d.storagePath).download();
                const r = patchDaReleituraIssRetido(buf.toString('utf8'), agoraIso);
                const antes = d.valores?.issRetido === true;
                await d.ref.update({ ...r.patch, 'valores.issRetidoRelidoPor': porEmail || null });
                relidas += 1;
                const depois = r.issRetido === true;
                // Nota CANCELADA tem o dado corrigido, mas não entra no
                // relatório: ela não gera imposto, e listá-la como "o A RECOLHER
                // mudou" mandaria reconferir guia que não mudou.
                if (r.nacional && antes !== depois && !docCancelado(d)) {
                    corrigidas.push({
                        id: d.id,
                        empresaId: d.empresaId || null,
                        empresaNome: d.empresaNome || null,
                        empresaCnpj: d.empresaCnpj || null,
                        competencia: d.competencia || null,
                        numero: d.numero || null,
                        direcao: direcaoEfetivaDoc(d) || d.direcao || null,
                        antes,
                        depois,
                    });
                }
            } catch (e) {
                falhas.push({ id: d.id, numero: d.numero || null, empresaNome: d.empresaNome || null, erro: e?.message || String(e) });
            }
        }
    };
    await Promise.all(Array.from({ length: 8 }, trabalhador));
    return { relidas, corrigidas, falhas };
}

router.post('/reler', requireAuth, async (req, res) => {
    try {
        const empresaId = String(req.body?.empresaId || '').trim();
        const competencia = String(req.body?.competencia || '').trim();
        if (!empresaId || !/^\d{4}-\d{2}$/.test(competencia)) {
            return res.status(400).json({ ok: false, erro: 'Informe a empresa e a competência (AAAA-MM).' });
        }
        if (req.user?.role !== 'admin') {
            const check = await podeAcessarEmpresaId(req.user, empresaId);
            if (!check.ok) return res.status(check.status || 403).json({ ok: false, erro: check.error });
        }

        const db = admin.firestore();
        const q = db.collection('documentos_fiscais')
            .where('empresaId', '==', empresaId)
            .where('competencia', '==', competencia);
        const snap = await fetchAllDocs(q, { label: `nfse-iss-retido/${competencia}` });
        const fila = snap
            .map((d) => ({ ref: d.ref, id: d.id, ...(d.data() || {}) }))
            // Nota excluída/mesclada não volta a ser mexida — a lápide vale aqui também.
            .filter((d) => !docRetiradoDoAcervo(d))
            .filter(precisaReleituraIssRetido);
        const alvos = fila.slice(0, MAX_POR_CHAMADA);

        // Falha de leitura NÃO vira "conferido": a nota fica na fila e a
        // próxima abertura da aba tenta de novo.
        const { relidas, corrigidas, falhas } = await relerNotas(alvos, req.user?.email);

        return res.json({
            ok: true,
            relidas,
            corrigidas: corrigidas.length,
            falhas,
            naoLidasPorTeto: fila.length - alvos.length,
        });
    } catch (e) {
        console.error('[nfse-iss-retido/reler]', e);
        return res.status(500).json({ ok: false, erro: e?.message || 'Falha ao reler a retenção.' });
    }
});

// ============================================================================
//   POST /api/admin/nfse-iss-retido/varrer   { cursor? }       (admin)
//
// A CARTEIRA INTEIRA, em lotes: cada chamada examina até LOTE notas de
// serviço (em ordem de id, a partir do `cursor`) e relê as que ainda não
// foram conferidas. A tela chama em laço até `proximoCursor` vir null — cada
// chamada é curta, e parar no meio não perde nada (a nota relida sai da fila).
// ============================================================================
const LOTE_VARREDURA = 400;

router.post('/varrer', requireAdmin, async (req, res) => {
    try {
        const cursor = String(req.body?.cursor || '').trim();
        const db = admin.firestore();
        let q = db.collection('documentos_fiscais')
            .where('tipo', '==', 'NFSe')
            .orderBy(admin.firestore.FieldPath.documentId())
            .select('tipo', 'tipoDoc', 'storagePath', 'valores', 'empresaId', 'empresaCnpj', 'empresaNome',
                'competencia', 'numero', 'direcao', '_deleted', '_merged_into',
                // a régua do cancelamento (docCancelado) lê estes quatro
                'status', 'cStat', 'eventos', 'cancelamentoDeclarado')
            .limit(LOTE_VARREDURA);
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.get();
        const docs = snap.docs.map((d) => ({ ref: d.ref, id: d.id, ...(d.data() || {}) }));
        const alvos = docs.filter((d) => !docRetiradoDoAcervo(d)).filter(precisaReleituraIssRetido);
        const { relidas, corrigidas, falhas } = await relerNotas(alvos, req.user?.email);
        return res.json({
            ok: true,
            examinadas: docs.length,
            relidas,
            corrigidas,
            falhas,
            proximoCursor: docs.length === LOTE_VARREDURA ? docs[docs.length - 1].id : null,
        });
    } catch (e) {
        console.error('[nfse-iss-retido/varrer]', e);
        return res.status(500).json({ ok: false, erro: e?.message || 'Falha na varredura.' });
    }
});

// ============================================================================
//   POST /api/admin/nfse-iss-retido/envios-iss   { pares: [{empresaCnpj, competencia}] }   (admin)
//
// Das empresas × competências que tiveram nota corrigida: as guias de ISS
// que JÁ SAÍRAM para o cliente. É a lista de quem reconferir.
// ============================================================================
router.post('/envios-iss', requireAdmin, async (req, res) => {
    try {
        const pares = (Array.isArray(req.body?.pares) ? req.body.pares : []).slice(0, 400);
        const db = admin.firestore();
        const resultado = [];
        const falhas = [];
        for (const p of pares) {
            const cnpj = String(p?.empresaCnpj || '').replace(/\D/g, '');
            const formas = formasDaCompetencia(p?.competencia);
            if (!cnpj || !formas.length) continue;
            try {
                const snap = await db.collection('impostos_enviados')
                    .where('empresaCnpj', '==', cnpj)
                    .where('competencia', 'in', formas.slice(0, 10))
                    .get();
                const envios = snap.docs.map((d) => d.data() || {}).filter(ehEnvioDeIss).map((x) => ({
                    tipo: x.tipo || null,
                    valor: Number.isFinite(Number(x.valor)) ? Number(x.valor) : null,
                    enviadoEm: x.enviadoEm?.toDate?.()?.toISOString?.() || null,
                    para: x.para || null,
                }));
                resultado.push({ empresaCnpj: cnpj, competencia: p.competencia, envios });
            } catch (e) {
                // Par que não pôde ser consultado sai DITO — "sem envio" seria afirmação falsa.
                falhas.push({ empresaCnpj: cnpj, competencia: p.competencia, erro: e?.message || String(e) });
            }
        }
        return res.json({ ok: true, resultado, falhas });
    } catch (e) {
        console.error('[nfse-iss-retido/envios-iss]', e);
        return res.status(500).json({ ok: false, erro: e?.message || 'Falha ao consultar os envios.' });
    }
});

export default router;
