// ============================================================================
// sefaz-backend/competencia-acervo-routes.js
// ----------------------------------------------------------------------------
//   GET  /api/admin/competencia-acervo/fila?empresaId=&competencia=
//   POST /api/admin/competencia-acervo/corrigir   { docId, motivo }
//
// A porta da correção que 03/09 deixou nomeada: *"nota já gravada com a
// competência da emissão continua no mês errado — e o `dataFatoGerador` ESTÁ no
// banco, então o app TEM como listar e corrigir"*.
//
// 🚨 UMA NOTA POR CLIQUE, NUNCA EM LOTE, e o motivo é o mesmo de sempre nesta
// casa: mudar o mês mexe em livro que pode já ter sido entregue. Lote aqui
// moveria dezenas de notas de mês com um clique, e o que se perde não se
// confere depois. É a régua do *"ninguém emite em série"* (28/07) aplicada ao
// livro em vez da guia.
//
// 🚨 A FILA VARRE A COMPETÊNCIA PEDIDA **E A SEGUINTE**, e sem isso ela não
// acharia nada do caso real: em SP a nota de 31/08 pode ser emitida até 10/09,
// então ela está gravada em SETEMBRO justamente quando se fecha AGOSTO. Quem
// procurasse só dentro de agosto veria a fila vazia com as notas faltando.
// ============================================================================
import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { montarFilaCompetencia, patchCorrecaoCompetencia } from './competencia-acervo.js';

const router = express.Router();
const json = () => express.json({ limit: '256kb' });

/** 'AAAA-MM' → o mês seguinte, virando o ano. */
function mesSeguinte(comp) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(comp || ''));
    if (!m) return null;
    const ano = Number(m[1]);
    const mes = Number(m[2]);
    return mes === 12
        ? `${ano + 1}-01`
        : `${ano}-${String(mes + 1).padStart(2, '0')}`;
}

router.get('/fila', requireAdmin, async (req, res) => {
    try {
        const empresaId = String(req.query.empresaId || '').trim();
        const competencia = String(req.query.competencia || '').trim();
        if (!empresaId || !/^\d{4}-\d{2}$/.test(competencia)) {
            return res.status(400).json({
                erro: 'Informe a empresa e a competência no formato AAAA-MM.',
            });
        }

        const seguinte = mesSeguinte(competencia);
        const meses = seguinte ? [competencia, seguinte] : [competencia];

        const db = admin.firestore();
        const docs = [];
        const mesesLidos = [];
        const mesesComFalha = [];
        for (const mes of meses) {
            try {
                const q = db.collection('documentos_fiscais')
                    .where('empresaId', '==', empresaId)
                    .where('competencia', '==', mes);
                const snap = await fetchAllDocs(q, { label: `competencia-acervo/${mes}` });
                for (const d of snap) docs.push({ id: d.id, ...(d.data() || {}) });
                mesesLidos.push(mes);
            } catch (e) {
                // 🚨 MÊS QUE NÃO FOI LIDO SAI DITO, nunca some: fila curta por
                // falha de leitura é indistinguível de acervo limpo, que é o
                // silêncio falso que esta casa mais paga.
                mesesComFalha.push({ mes, erro: e?.message || String(e) });
            }
        }

        const fila = montarFilaCompetencia(docs);
        res.json({
            empresaId,
            competencia,
            mesesLidos,
            mesesComFalha,
            ...fila,
            // A fila é do que está gravado NESTES meses. Nota de agosto parada
            // em outubro não aparece aqui, e dizer isso evita que o vazio seja
            // lido como "o acervo inteiro está certo".
            alcance: `Esta fila examina o que está gravado em ${mesesLidos.join(' e ')}. `
                + 'Nota de outro mês do acervo não aparece aqui — confira a competência dela.',
            avisoLeitura: mesesComFalha.length
                ? `Não deu para ler ${mesesComFalha.map((x) => x.mes).join(', ')} — a fila está INCOMPLETA.`
                : null,
        });
    } catch (e) {
        res.status(500).json({ erro: e?.message || 'Falha ao montar a fila.' });
    }
});

router.post('/corrigir', requireAdmin, json(), async (req, res) => {
    try {
        const docId = String(req.body?.docId || '').trim();
        const motivo = String(req.body?.motivo || '');
        if (!docId) return res.status(400).json({ erro: 'Informe qual nota corrigir.' });

        const db = admin.firestore();
        const ref = db.collection('documentos_fiscais').doc(docId);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ erro: 'Nota não encontrada.' });

        // 🚨 A DECISÃO É RECALCULADA SOBRE O DOCUMENTO DE AGORA, nunca sobre o
        // que a tela mandou: entre a leitura da fila e o clique alguém pode ter
        // corrigido a mesma nota, e gravar por cima reescreveria o autor e o
        // motivo originais por um segundo clique (o defeito do ✕ de 14/08).
        const doc = { id: snap.id, ...(snap.data() || {}) };
        const r = patchCorrecaoCompetencia({
            doc,
            porEmail: req.user?.email || req.adminEmail || '',
            motivo,
        });
        if (!r.ok) return res.status(400).json({ erro: r.erro });

        await ref.set(r.patch, { merge: true });
        res.json({
            ok: true,
            docId,
            de: r.de,
            para: r.para,
            aviso: `A nota saiu de ${r.de} e entrou em ${r.para}. Se algum desses meses já foi `
                + 'entregue, regere e confira o arquivo dele.',
        });
    } catch (e) {
        res.status(500).json({ erro: e?.message || 'Falha ao corrigir a competência.' });
    }
});

export default router;
