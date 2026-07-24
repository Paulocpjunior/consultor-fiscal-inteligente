// ============================================================================
// sefaz-backend/ipi-varredura-routes.js  (ESM)
//
// VARREDURA DE IPI: identifica TODAS as empresas de Lucro (indústrias) com IPI
// apurado numa competência e classifica se o preenchimento automático do MIT
// consegue transmitir sozinho (há mês-modelo com IPI) ou se precisa de UM
// lançamento manual no e-CAC primeiro (vira modelo). Motivação: caso Experte
// 06/2026 — evitar que cada indústria vire urgência na hora de transmitir.
//
//   GET /api/admin/sefaz/ipi-varredura?competencia=2026-06&consultarMit=1
//
// Sem consultarMit: só a fase local (quem tem IPI apurado na ficha) — zero
// SERPRO. Com consultarMit=1: consulta o MIT das empresas COM IPI (2 chamadas
// SERPRO por empresa — só indústrias, poucas) e classifica pronta/precisa.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import {
    acharFichaCompetencia, calcularIpiApuradoFicha, classificarIpiEmpresa,
    resumirVarreduraIpi, normalizarCompetencia,
} from './ipi-varredura.js';
import { getDctfwebProvider, pickIdApuracao, mitPeriodoLabel } from './dctfweb-provider.js';
import { extrairModeloDebitosMit } from './mit-debitos-builder.js';

const router = express.Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

// Há modelo de IPI no MIT? Mesma busca do preencherEncerrarMit: períodos
// ANTERIORES à competência (ano atual + anterior), detalha até 4 candidatos
// mais recentes e procura código de IPI.
async function temModeloIpiNoMit(provider, empresaCnpj, competencia) {
    const [anoAlvo] = competencia.split('-').map(Number);
    const candidatos = [];
    for (const ano of [anoAlvo, anoAlvo - 1]) {
        try {
            const hist = await provider.consultarApuracoesAno({ empresaCnpj, anoPA: ano });
            for (const item of hist?.apuracoes || []) {
                const periodo = mitPeriodoLabel(item);
                const id = pickIdApuracao(item);
                if (!periodo || id == null || id === '') continue;
                if (periodo >= competencia) continue;
                candidatos.push({ periodo, id });
            }
        } catch (e) {
            // ano sem histórico não é erro fatal; segue pro anterior
            console.warn(`[ipi-varredura] histórico ${empresaCnpj}/${ano}:`, e.message);
        }
        if (candidatos.length > 0) break;
    }
    candidatos.sort((a, b) => b.periodo.localeCompare(a.periodo));
    if (candidatos.length === 0) return { temModelo: false, modeloPeriodo: null };

    for (const cand of candidatos.slice(0, 4)) {
        const det = await provider.consultarApuracaoMitPorId({ empresaCnpj, idApuracao: cand.id });
        const m = extrairModeloDebitosMit(det?.apuracaoMit);
        if (m.codigoPorFamilia?.IPI?.codigo) {
            return { temModelo: true, modeloPeriodo: cand.periodo };
        }
    }
    return { temModelo: false, modeloPeriodo: null };
}

router.get('/ipi-varredura', requireAdmin, async (req, res) => {
    try {
        const competencia = normalizarCompetencia(req.query.competencia)
            // default: mês anterior (competência que está sendo declarada agora)
            || new Date(Date.now() - 27 * 24 * 3600 * 1000).toISOString().slice(0, 7);
        const consultarMit = ['1', 'true', 'sim'].includes(String(req.query.consultarMit || ''));

        const db = getDb();
        const snap = await db.collection('lucro_empresas').get();
        const linhas = [];

        for (const doc of snap.docs) {
            const d = doc.data() || {};
            if (d._merged_into || d._deleted) continue; // perdedora de merge — ignora
            const cnpj = String(d.cnpj || '').replace(/\D/g, '');
            if (cnpj.length !== 14) continue;

            const ficha = acharFichaCompetencia(d.fichaFinanceira, competencia);
            const ipiApurado = calcularIpiApuradoFicha(ficha);
            linhas.push({
                empresaId: doc.id,
                cnpj,
                nome: d.nome || d.razaoSocial || '—',
                regime: ficha?.regime || d.regime || '—',
                temFicha: !!ficha,
                ipiApurado,
                temModeloIpi: null,     // preenchido na fase MIT
                modeloPeriodo: null,
                erroConsulta: null,
            });
        }

        // Fase MIT — só para quem tem IPI (indústrias; poucas empresas).
        if (consultarMit) {
            const provider = getDctfwebProvider();
            for (const l of linhas) {
                if (l.ipiApurado <= 0) continue;
                try {
                    const r = await temModeloIpiNoMit(provider, l.cnpj, competencia);
                    l.temModeloIpi = r.temModelo;
                    l.modeloPeriodo = r.modeloPeriodo;
                } catch (e) {
                    l.erroConsulta = String(e.message || 'falha na consulta MIT').slice(0, 200);
                }
            }
        }

        for (const l of linhas) {
            Object.assign(l, classificarIpiEmpresa({
                ipiApurado: l.ipiApurado,
                // Sem a fase MIT, trata "desconhecido" como precisa verificar —
                // mas só quando há IPI; o front mostra o botão de consultar.
                temModeloIpi: l.temModeloIpi === true,
                erroConsulta: l.erroConsulta,
            }));
            if (!consultarMit && l.ipiApurado > 0 && !l.erroConsulta) {
                l.status = 'verificar_mit';
                l.titulo = 'Tem IPI — verificar modelo no MIT';
                l.acao = 'Rode a varredura com consulta ao MIT para classificar.';
            }
        }

        // Só devolve quem interessa: com IPI, com erro, ou tudo se ?todas=1.
        const todas = ['1', 'true', 'sim'].includes(String(req.query.todas || ''));
        const linhasOut = todas ? linhas : linhas.filter((l) => l.ipiApurado > 0);
        linhasOut.sort((a, b) => (b.prioridade || 0) - (a.prioridade || 0) || b.ipiApurado - a.ipiApurado);

        return res.json({
            competencia,
            consultouMit: consultarMit,
            resumo: resumirVarreduraIpi(linhas),
            linhas: linhasOut,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[ipi-varredura]', e);
        return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
    }
});

export default router;
