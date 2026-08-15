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
import { relerItensFiscais } from './xml-importer.js';
import { conferirFichaContraDocumentos } from './ficha-x-documentos.js';

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

        // ─── FAROL FICHA × DOCUMENTOS (15/08, caso EXPERTE) ─────────────────
        //
        // IPI digitado na ficha sem documento no banco era INVISÍVEL — ficha e
        // escrituração são trilhos independentes e nada cruzava os dois. A
        // contagem roda só para quem tem IPI (indústrias, poucas), via
        // agregação count() — não baixa documento nenhum. Falha de contagem
        // vira null, NUNCA zero: zero falso acenderia "sem lastro" com o banco
        // cheio, o alarme falso que ensina a ignorar o farol.
        for (const l of linhas) {
            if (l.ipiApurado <= 0) { l.documentosNaCompetencia = null; l.lastro = conferirFichaContraDocumentos({ ipiFicha: 0, documentos: null }); continue; }
            let docs = null;
            try {
                const agg = await db.collection('documentos_fiscais')
                    .where('empresaId', '==', l.empresaId)
                    .where('competencia', '==', competencia)
                    .count().get();
                docs = agg.data().count;
            } catch (e) {
                console.warn(`[ipi-varredura] contagem de docs falhou (${l.nome}):`, e.message);
            }
            l.documentosNaCompetencia = docs;
            l.lastro = conferirFichaContraDocumentos({ ipiFicha: l.ipiApurado, documentos: docs });
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


// ─── RELEITURA DE CAMPOS DE ITEM (CST do IPI e do PIS/COFINS) ───────────────
//
// O extrator aprendeu `cstIpi` em 11/08 e `cstPis`/`cstCofins` em 12/08. O que
// foi capturado ANTES ficou sem eles — e sem `cstIpi` o **E510 não sai**, que é
// o último bloco travando indústria com IPI no de-para.
//
// O XML cru está no Cloud Storage (toda captura grava `storagePath`), então a
// recuperação é da FONTE: nada de pedir arquivo ao cliente ou consultar a SEFAZ.
//
// requireAdmin porque ESCREVE em documento fiscal — a varredura só lê.
router.post('/reler-itens-fiscais', requireAdmin, express.json(), async (req, res) => {
    try {
        const empresaId = String(req.body?.empresaId || '').trim();
        const competencia = normalizarCompetencia(req.body?.competencia);
        if (!empresaId) return res.status(400).json({ ok: false, error: 'Escolha a empresa.' });
        if (!competencia) return res.status(400).json({ ok: false, error: 'Informe a competência (AAAA-MM).' });

        const r = await relerItensFiscais({ empresaId, competencia, limit: 5000 });
        return res.json({ ok: true, competencia, ...r });
    } catch (e) {
        console.error('[ipi-varredura/reler-itens-fiscais]', e);
        return res.status(500).json({ ok: false, error: e?.message || 'Falha ao reler os itens.' });
    }
});

export default router;
