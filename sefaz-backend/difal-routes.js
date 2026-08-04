// ============================================================================
// sefaz-backend/difal-routes.js  (ESM)
//
//   GET /api/admin/difal/varredura?competencia=   quais clientes do SIMPLES
//       têm compra interestadual no mês (fase leve — emitente.uf + vST)
//   GET /api/admin/difal/painel?empresaId=&competencia=&aliq=CHAVE:ALIQ,...
//                                &iva=CHAVE:IVA[:aj],...
//       apuração mensal consolidada de UM cliente (difal-aquisicao.js puro) +
//       antecipação do art. 426-A por documento (difal-426a.js puro)
//
// Duas fases pelo mesmo motivo da DIPAM: ler documentos inteiros de todo
// mundo por causa de alguns compradores interestaduais seria caro.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { podeAcessarEmpresaId, getEmpresaIdsDaCarteira } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { montarDifalMensal, ALIQ_INTERNA_PADRAO_SP } from './difal-aquisicao.js';
import { apurarAntecipacoes426A } from './difal-426a.js';
import { cnpjEmitente, ufEmitente, modeloDoDoc } from './participante-doc-helper.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const so = (v) => String(v || '').replace(/\D/g, '');
const ehCompetencia = (c) => /^\d{4}-\d{2}$/.test(String(c || ''));
const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);

router.get('/varredura', requireAuth, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        if (!ehCompetencia(competencia)) return res.status(400).json({ ok: false, error: 'Competência AAAA-MM.' });
        const db = getDb();
        const idsCarteira = await getEmpresaIdsDaCarteira(req.user);

        // Só clientes do SIMPLES (o consolidado mensal é deles — Alexandre 03/08).
        const empresas = new Map();
        const snap = await db.collection('simples_empresas').get();
        snap.forEach((doc) => {
            const d = doc.data() || {};
            if (d._deleted || d._merged_into) return;
            if (idsCarteira && !idsCarteira.includes(doc.id)) return;
            empresas.set(doc.id, {
                empresaId: doc.id,
                nome: d.razaoSocial || d.nome || '—',
                cnpj: so(d.cnpj),
                uf: (d.dadosFiscais?.uf || d.uf || '').toUpperCase(),
                notasInterestaduais: 0,
                notasComSt: 0,
                baseAproximada: 0,
                semUfCadastrada: false,
            });
        });

        const snaps = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('competencia', '==', competencia)
                // A projeção PRECISA trazer os campos ACHATADOS e a CHAVE: doc
                // capturado da SEFAZ não tem o objeto `emitente`, e a UF do
                // emitente sai das 2 primeiras posições da chave (cUF). Sem
                // isso a varredura só enxergava as notas importadas por XML e
                // dizia "1 cliente" onde havia mais (caso 04/08).
                .select('empresaId', 'status', 'modelo', 'tpNF', 'valorTotal', 'chave',
                    'emitente.cnpjCpf', 'emitente.uf', 'cnpjEmit', 'ufEmit', 'codMunEmit',
                    'totais.vST', 'totais.vBCST'),
            { label: `difal varredura ${competencia}`, maxDocs: 80000 },
        );
        for (const s of snaps) {
            const d = s.data() || {};
            const emp = empresas.get(d.empresaId);
            if (!emp || CANCELADOS.has(d.status)) continue;
            if (modeloDoDoc(d) !== '55') continue;
            const emit = cnpjEmitente(d);
            if (!emit || emit === emp.cnpj || emit.length !== 14) continue;
            const ufOrig = ufEmitente(d);
            if (!ufOrig) continue;
            // Empresa SEM UF no cadastro: não dá pra dizer o que é
            // interestadual. Conta, mas sinaliza — senão toda compra dela
            // apareceria como "de fora" e ninguém saberia por quê.
            if (!emp.uf) emp.semUfCadastrada = true;
            else if (ufOrig === emp.uf) continue;
            emp.notasInterestaduais++;
            emp.baseAproximada = Math.round((emp.baseAproximada + (Number(d.valorTotal) || 0)) * 100) / 100;
            if ((Number(d.totais?.vST) || 0) > 0 || (Number(d.totais?.vBCST) || 0) > 0) emp.notasComSt++;
        }

        const linhas = Array.from(empresas.values())
            .filter((e) => e.notasInterestaduais > 0)
            .sort((a, b) => b.baseAproximada - a.baseAproximada);
        return res.json({ ok: true, competencia, linhas, lidos: snaps.length, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[difal/varredura]', e);
        return res.status(500).json({ ok: false, error: `Falha na varredura: ${e.message}` });
    }
});

router.get('/painel', requireAuth, async (req, res) => {
    try {
        const empresaId = String(req.query.empresaId || '').trim();
        const competencia = String(req.query.competencia || '').trim();
        if (!empresaId || !ehCompetencia(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe empresaId e competência AAAA-MM.' });
        }
        const acesso = await podeAcessarEmpresaId(req.user, empresaId);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const db = getDb();
        let empresa = null;
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const s = await db.collection(col).doc(empresaId).get();
            if (s.exists && !s.data()._deleted && !s.data()._merged_into) {
                const d = s.data();
                empresa = {
                    id: empresaId,
                    nome: d.razaoSocial || d.nome || '—',
                    cnpj: d.cnpj,
                    uf: (d.dadosFiscais?.uf || d.uf || '').toUpperCase(),
                    regime: col === 'simples_empresas' ? 'simples' : 'lucro',
                };
                break;
            }
        }
        if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa não encontrada.' });

        // Overrides de alíquota interna: "CHAVE:25,CHAVE2:12".
        const aliqInternaPorChave = {};
        for (const par of String(req.query.aliq || '').split(',')) {
            const [chave, aliq] = par.split(':');
            if (chave && Number(aliq) > 0) aliqInternaPorChave[chave.trim()] = Number(aliq);
        }

        const snap = await db.collection('documentos_fiscais')
            .where('empresaId', '==', empresaId)
            .where('competencia', '==', competencia)
            .get();
        const docs = snap.docs.map((s) => ({ id: s.id, ...s.data() })).filter((d) => !d._merged_into);

        const resultado = montarDifalMensal({ docs, empresa, aliqInternaPorChave });

        // FASE 2 — antecipação do art. 426-A das notas com ST (uma guia POR
        // documento). O IVA-ST vem da Portaria CAT e é informado na tela:
        // ?iva=CHAVE:VALOR ou CHAVE:VALOR:aj (quando já é o ajustado).
        const parametrosPorChave = {};
        for (const par of String(req.query.iva || '').split(',')) {
            const [chave, valor, marca] = par.split(':');
            if (chave && Number(valor) > 0) {
                parametrosPorChave[chave.trim()] = {
                    ivaSt: Number(valor),
                    ivaJaAjustado: String(marca || '').trim().toLowerCase() === 'aj',
                    aliqInterna: aliqInternaPorChave[chave.trim()],
                };
            }
        }
        // Reanexa o documento cru de cada linha com ST — o 426-A precisa dos
        // totais (frete, seguro, IPI) que a consolidação não carrega.
        const porChave = new Map(docs.map((d) => [d.chave || d.id, d]));
        const comSt = (resultado.antecipacaoIndividual || []).map((l) => ({
            ...l, doc: porChave.get(l.chave) || null,
        }));
        const antecipacao426A = apurarAntecipacoes426A(comSt, parametrosPorChave, ALIQ_INTERNA_PADRAO_SP);

        return res.json({
            ok: true, empresa, competencia, ...resultado,
            antecipacao426A,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[difal/painel]', e);
        return res.status(500).json({ ok: false, error: `Falha no painel: ${e.message}` });
    }
});

export default router;
