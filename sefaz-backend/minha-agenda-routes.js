// ============================================================================
// sefaz-backend/minha-agenda-routes.js  (ESM)
//
// Agenda fiscal CONSOLIDADA por carteira: pra cada empresa que o colaborador
// é responsável (admin vê todas), traz num só JSON o risco fiscal real:
//   - PGDAS-D nao transmitido nos ultimos meses (Simples)
//   - DCTFWeb nao transmitida nos ultimos meses (Lucro)
//   - mensagens nao lidas na caixa postal (categorizadas por urgencia)
//
// Calcula um score 0-100 por empresa pra ordenar (prioridade da semana).
// Reusa os mesmos criterios dos 3 paineis especificos — fonte unica da verdade.
// Montado em: /api/admin/minha-agenda
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { getCnpjsDaCarteira, getEmpresaIdsDaCarteira } from './carteira-auth.js';
import { ultimasCompetencias as ultimasCompetenciasHelper } from './competencias-helper.js';
import { calcularScoreAgenda, FAIXA_CRITICO } from './minha-agenda-score.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

// Categorias de mensagem por urgencia (alinhado com RadarCriticasPanel)
const CAT_CRITICAS = new Set(['intimacao', 'malha', 'exclusao', 'det_auto_infracao', 'dje_citacao']);
const CAT_ALTAS = new Set(['dec_intimacao', 'dje_intimacao', 'emac_notificacao', 'prefeitura_sp_iss']);
const CAT_MEDIAS = new Set(['det_notificacao']);

// Reusa o helper compartilhado (testado em __tests__/competenciasHelper).
const ultimasCompetencias = (n) => ultimasCompetenciasHelper(n);

router.get('/', requireAuth, async (req, res) => {
    try {
        const meses = Math.min(Math.max(Number(req.query.meses || 3), 1), 12);
        const competencias = ultimasCompetencias(meses);
        const db = fa().firestore();

        // 1. Resolve carteira (null = admin, vê todas)
        const cnpjsCarteira = await getCnpjsDaCarteira(req.user);
        const idsCarteira = await getEmpresaIdsDaCarteira(req.user);
        const cnpjsAdmitidos = cnpjsCarteira ? new Set(cnpjsCarteira) : null;
        const idsAdmitidos = idsCarteira ? new Set(idsCarteira) : null;

        // 2. Empresas (Simples + Lucro) que o user pode ver
        const empresas = [];
        for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            try {
                const snap = await db.collection(col).get();
                snap.forEach((doc) => {
                    const d = doc.data();
                    if (d._merged_into || d._deleted) return;
                    const cnpj = (d.cnpj || '').replace(/\D/g, '');
                    if (cnpj.length !== 14) return;
                    if (cnpjsAdmitidos && !cnpjsAdmitidos.has(cnpj)) return;
                    if (idsAdmitidos && !idsAdmitidos.has(doc.id) && !cnpjsAdmitidos?.has(cnpj)) return;
                    empresas.push({
                        id: doc.id, cnpj, regime,
                        nome: d.razaoSocial || d.nome || '',
                    });
                });
            } catch (e) {
                console.warn(`[minha-agenda] ${col} indisponivel:`, e.message);
            }
        }
        // Dedup por cnpj (empresa pode aparecer em ambas se cadastro errado)
        const mapa = new Map();
        for (const e of empresas) if (!mapa.has(e.cnpj)) mapa.set(e.cnpj, e);
        const lista = Array.from(mapa.values());
        if (lista.length === 0) return res.json({ totalEmpresas: 0, empresas: [], competencias });

        const idsSimples = lista.filter((e) => e.regime === 'simples').map((e) => e.id);
        const idsLucro = lista.filter((e) => e.regime === 'lucro').map((e) => e.id);
        const cnpjsAll = lista.map((e) => e.cnpj);

        // 3. PGDAS — das_emitidos das competencias (so Simples)
        // Loteia por competencia (chunks de 10 — limite do 'in') E filtra por empresaId em memoria.
        const pgdasPorEmp = new Map(); // empresaId -> Set<competencias transmitidas>
        if (idsSimples.length) {
            for (let i = 0; i < competencias.length; i += 10) {
                const chunk = competencias.slice(i, i + 10);
                try {
                    const snap = await db.collection('das_emitidos').where('competencia', 'in', chunk).get();
                    snap.forEach((d) => {
                        const x = d.data();
                        if (!idsSimples.includes(x.empresaId)) return;
                        const set = pgdasPorEmp.get(x.empresaId) || new Set();
                        set.add(x.competencia);
                        pgdasPorEmp.set(x.empresaId, set);
                    });
                } catch (e) {
                    console.warn('[minha-agenda] das chunk', chunk, e.message);
                }
            }
        }

        // 4. DCTFWeb — dctfweb_declaracoes (so Lucro), agrupa por anoPA (mais eficiente)
        const dctfwebPorEmp = new Map(); // empresaId -> Set<competencias com ATIVA>
        if (idsLucro.length) {
            const anos = Array.from(new Set(competencias.map((c) => Number(c.slice(0, 4)))));
            for (const ano of anos) {
                try {
                    const snap = await db.collection('dctfweb_declaracoes').where('anoPA', '==', ano).get();
                    snap.forEach((d) => {
                        const x = d.data();
                        if (!idsLucro.includes(x.empresaId)) return;
                        if (x.categoria && x.categoria !== 'GERAL_MENSAL') return;
                        if (x.situacao !== 'ATIVA') return;
                        const label = `${x.anoPA}-${String(x.mesPA).padStart(2, '0')}`;
                        if (!competencias.includes(label)) return;
                        const set = dctfwebPorEmp.get(x.empresaId) || new Set();
                        set.add(label);
                        dctfwebPorEmp.set(x.empresaId, set);
                    });
                } catch (e) {
                    console.warn('[minha-agenda] dctfweb ano', ano, e.message);
                }
            }
        }

        // 5. Caixa postal — mensagens NAO lidas por cnpj
        const msgPorCnpj = new Map(); // cnpj -> { criticas, altas, medias, baixas, total }
        for (let i = 0; i < cnpjsAll.length; i += 10) {
            const chunk = cnpjsAll.slice(i, i + 10);
            try {
                const snap = await db.collection('caixa_postal_mensagens')
                    .where('empresaCnpj', 'in', chunk)
                    .where('dataLeitura', '==', null)
                    .get();
                snap.forEach((d) => {
                    const x = d.data();
                    const cnpj = (x.empresaCnpj || '').replace(/\D/g, '');
                    const cat = x.categoria || 'informativo';
                    const slot = msgPorCnpj.get(cnpj) || { criticas: 0, altas: 0, medias: 0, baixas: 0, total: 0 };
                    if (CAT_CRITICAS.has(cat)) slot.criticas++;
                    else if (CAT_ALTAS.has(cat)) slot.altas++;
                    else if (CAT_MEDIAS.has(cat)) slot.medias++;
                    else slot.baixas++;
                    slot.total++;
                    msgPorCnpj.set(cnpj, slot);
                });
            } catch (e) {
                console.warn('[minha-agenda] msg chunk', e.message);
            }
        }

        // 6. Calcula risco por empresa (logica pura em minha-agenda-score.js)
        const resultado = lista.map((emp) => {
            // PGDAS gaps (so Simples) — mantem detalhes da competencia pra UI
            let pgdas = null;
            let pgdasGaps = 0;
            if (emp.regime === 'simples') {
                const transmitidas = pgdasPorEmp.get(emp.id) || new Set();
                const gapsArr = competencias.filter((c) => !transmitidas.has(c));
                pgdas = { gaps: gapsArr.length, gapsCompetencias: gapsArr };
                pgdasGaps = gapsArr.length;
            }
            // DCTFWeb gaps (so Lucro)
            let dctfweb = null;
            let dctfwebGaps = 0;
            if (emp.regime === 'lucro') {
                const transmitidas = dctfwebPorEmp.get(emp.id) || new Set();
                const gapsArr = competencias.filter((c) => !transmitidas.has(c));
                dctfweb = { gaps: gapsArr.length, gapsCompetencias: gapsArr };
                dctfwebGaps = gapsArr.length;
            }
            // Mensagens
            const msg = msgPorCnpj.get(emp.cnpj) || { criticas: 0, altas: 0, medias: 0, baixas: 0, total: 0 };

            const { score, pendencias } = calcularScoreAgenda({
                regime: emp.regime,
                pgdasGaps, dctfwebGaps,
                msgCriticas: msg.criticas, msgAltas: msg.altas, msgMedias: msg.medias,
            });

            // Enriquecimento da pendencia "PGDAS/DCTFWeb": usa o array com as
            // competencias especificas (helper so reporta a quantidade).
            const pendenciasDetalhadas = pendencias.map((p) => {
                if (p.startsWith('PGDAS-D pendente') && pgdas?.gapsCompetencias.length) {
                    return `PGDAS-D pendente: ${pgdas.gapsCompetencias.join(', ')}`;
                }
                if (p.startsWith('DCTFWeb pendente') && dctfweb?.gapsCompetencias.length) {
                    return `DCTFWeb pendente: ${dctfweb.gapsCompetencias.join(', ')}`;
                }
                return p;
            });

            return {
                id: emp.id, cnpj: emp.cnpj, nome: emp.nome, regime: emp.regime,
                score, pendencias: pendenciasDetalhadas,
                pgdas, dctfweb, mensagens: msg,
            };
        });

        resultado.sort((a, b) => b.score - a.score || (a.nome || '').localeCompare(b.nome || ''));

        const empresasComRisco = resultado.filter((e) => e.score > 0).length;
        const riscoCritico = resultado.filter((e) => e.score >= FAIXA_CRITICO).length;

        return res.json({
            usuario: { uid: req.user.uid, email: req.user.email, role: req.user.role },
            mesesAnalisados: meses,
            competencias,
            totalEmpresas: lista.length,
            empresasComRisco,
            riscoCritico,
            empresas: resultado,
        });
    } catch (e) {
        console.error('[minha-agenda]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

export default router;
