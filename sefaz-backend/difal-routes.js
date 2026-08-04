// ============================================================================
// sefaz-backend/difal-routes.js  (ESM)
//
//   GET /api/admin/difal/varredura?competencia=   quais clientes do SIMPLES
//       têm compra interestadual no mês (fase leve — emitente.uf + vST)
//   GET /api/admin/difal/painel?empresaId=&competencia=&aliq=CHAVE:ALIQ,...
//                                &iva=CHAVE|NITEM:IVA[:aj],...   (IVA-ST é POR ITEM:
//                                o índice é do SEGMENTO/NCM, não da nota)
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
import { apurarAntecipacoes426APorItem } from './difal-426a.js';
import { cnpjEmitente, ufEmitente, modeloDoDoc } from './participante-doc-helper.js';
import { COLECAO_NCM, sugerirIvaPorItem } from './ncm-parametros.js';

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

        // A guia CONSOLIDADA do mês é do Simples (desenho do Alexandre, 03/08),
        // mas o cliente do LUCRO também paga DIFAL de aquisição — só que a
        // escrituração dele vai pelo SPED (C197 + Ajustes E111). Varrer só o
        // Simples fazia o cliente do Lucro sumir da tela sem explicação
        // ("o consultor puxou as notas e o DIFAL não aponta a empresa").
        const empresas = new Map();      // por empresaId
        const porCnpj = new Map();       // por CNPJ (14 dígitos)
        for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
                const d = doc.data() || {};
                if (d._deleted || d._merged_into) return;
                if (idsCarteira && !idsCarteira.includes(doc.id)) return;
                const linha = {
                    empresaId: doc.id,
                    nome: d.razaoSocial || d.nome || '—',
                    cnpj: so(d.cnpj),
                    uf: (d.dadosFiscais?.uf || d.uf || '').toUpperCase(),
                    regime,
                    notasInterestaduais: 0,
                    notasComSt: 0,
                    baseAproximada: 0,
                    semUfCadastrada: false,
                };
                empresas.set(doc.id, linha);
                // Índice por CNPJ: documento capturado server-side (autXML,
                // ZIP, cofre) muitas vezes tem só `empresaCnpj`, sem
                // `empresaId` — e a junção só por id o descartava. Mesma
                // lição da tela Exportar SAGE.
                if (linha.cnpj.length === 14) porCnpj.set(linha.cnpj, linha);
            });
        }

        const snaps = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('competencia', '==', competencia)
                // A projeção PRECISA trazer os campos ACHATADOS e a CHAVE: doc
                // capturado da SEFAZ não tem o objeto `emitente`, e a UF do
                // emitente sai das 2 primeiras posições da chave (cUF). Sem
                // isso a varredura só enxergava as notas importadas por XML e
                // dizia "1 cliente" onde havia mais (caso 04/08).
                .select('empresaId', 'empresaCnpj', 'status', 'modelo', 'tpNF', 'valorTotal', 'chave',
                    'emitente.cnpjCpf', 'emitente.uf', 'cnpjEmit', 'ufEmit', 'codMunEmit',
                    'totais.vST', 'totais.vBCST'),
            { label: `difal varredura ${competencia}`, maxDocs: 80000 },
        );
        for (const s of snaps) {
            const d = s.data() || {};
            const emp = empresas.get(d.empresaId) || porCnpj.get(so(d.empresaCnpj));
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
        // ?iva=CHAVE|NITEM:VALOR[:aj]  — o IVA-ST é POR ITEM porque vem da
        // Portaria CAT do SEGMENTO (NCM). Uma nota com dois NCMs pode precisar
        // de dois índices; pedir "o IVA da nota" seria pedir a coisa errada
        // (Paulo, 04/08: "não pode aglutinar").
        const ivaPorItem = {};
        for (const par of String(req.query.iva || '').split(',')) {
            const [ref, valor, marca] = par.split(':');
            const alvo = String(ref || '').trim();
            if (!alvo || !(Number(valor) > 0)) continue;
            const chaveDoItem = alvo.includes('|') ? alvo : null;
            if (!chaveDoItem) continue;   // formato antigo (nota inteira) é recusado
            ivaPorItem[chaveDoItem] = {
                ivaSt: Number(valor),
                ivaJaAjustado: String(marca || '').trim().toLowerCase() === 'aj',
                aliqInterna: aliqInternaPorChave[chaveDoItem.split('|')[0]],
            };
        }
        // CADASTRO DE NCM: preenche o IVA-ST que o colaborador ainda não
        // digitou. O que ele informou SEMPRE vence — o cadastro sugere.
        // A vigência é resolvida pela DATA DA NOTA, não pela de hoje: a
        // Portaria CAT muda e aplicar o índice atual numa nota antiga
        // recolhe errado (ncm-parametros.js).
        let catalogoNcm = [];
        try {
            const snapNcm = await db.collection(COLECAO_NCM).limit(20000).get();
            catalogoNcm = snapNcm.docs.map((x) => ({ id: x.id, ...x.data() }));
        } catch (err) {
            console.warn('[difal/painel] cadastro de NCM não pôde ser lido:', err.message);
        }

        const comStComUf = (resultado.antecipacaoIndividual || []).map((l) => ({
            ...l, ufDestino: empresa.uf,
        }));
        const { sugerido, usados } = sugerirIvaPorItem(comStComUf, catalogoNcm, ivaPorItem);
        const ivaFinal = { ...sugerido, ...ivaPorItem };

        const antecipacao426A = apurarAntecipacoes426APorItem(
            comStComUf, ivaFinal, ALIQ_INTERNA_PADRAO_SP,
        );
        antecipacao426A.sugestoesDoCadastroNcm = usados;
        if (usados.length > 0) {
            antecipacao426A.ressalvas = [
                `${usados.length} item(ns) tiveram o IVA-ST preenchido pelo CADASTRO DE NCM (com a Portaria e a vigência da data da nota) — confira antes de recolher.`,
                ...antecipacao426A.ressalvas,
            ];
        }

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
