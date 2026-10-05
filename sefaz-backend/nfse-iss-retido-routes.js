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
import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { podeAcessarEmpresaId } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { docRetiradoDoAcervo } from './xml-metadata-helper.js';
import { precisaReleituraIssRetido, patchDaReleituraIssRetido } from './nfse-iss-retido-releitura.js';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'consultorfiscalapp';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const bucket = () => admin.storage().bucket(STORAGE_BUCKET);

/** Teto por chamada: a leitura é do Storage. O que sobrar sai dito e entra na próxima. */
const MAX_POR_CHAMADA = 300;

const router = express.Router();

router.post('/reler', requireAuth, express.json({ limit: '16kb' }), async (req, res) => {
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

        const agoraIso = new Date().toISOString();
        let relidas = 0;
        let corrigidas = 0;
        const falhas = [];
        const trabalho = [...alvos];
        const trabalhador = async () => {
            while (trabalho.length) {
                const d = trabalho.shift();
                try {
                    const [buf] = await bucket().file(d.storagePath).download();
                    const r = patchDaReleituraIssRetido(buf.toString('utf8'), agoraIso);
                    const antes = d.valores?.issRetido === true;
                    await d.ref.update({ ...r.patch, 'valores.issRetidoRelidoPor': req.user?.email || null });
                    relidas += 1;
                    if (r.nacional && antes !== (r.issRetido === true)) corrigidas += 1;
                } catch (e) {
                    // Falha de leitura NÃO vira "conferido": a nota fica na
                    // fila e a próxima abertura da aba tenta de novo.
                    falhas.push({ id: d.id, numero: d.numero || null, erro: e?.message || String(e) });
                }
            }
        };
        await Promise.all(Array.from({ length: 8 }, trabalhador));

        return res.json({
            ok: true,
            relidas,
            corrigidas,
            falhas,
            naoLidasPorTeto: fila.length - alvos.length,
        });
    } catch (e) {
        console.error('[nfse-iss-retido/reler]', e);
        return res.status(500).json({ ok: false, erro: e?.message || 'Falha ao reler a retenção.' });
    }
});

export default router;
