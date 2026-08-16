// ============================================================================
// sefaz-backend/prazos-municipais-routes.js  (ESM)
// ----------------------------------------------------------------------------
// GET  /api/admin/prazos-municipais            — cadastro + fila do que falta
// POST /api/admin/prazos-municipais            — cadastra/corrige um calendário
// POST /api/admin/prazos-municipais/desativar  — tira de circulação
//
// SÓ ADMIN grava: prazo de tributo decide se há multa, e data que muda sozinha
// é o tipo de mudança que precisa ter dono. O GET é `requireAuth` porque a fila
// do que falta é informação de trabalho do colaborador, não segredo.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth, requireAdmin } from './require-admin.js';
import express from 'express';
import {
    validarPrazoMunicipal, idPrazoMunicipal, municipiosSemCalendario,
    resolverPrazoMunicipal, montarPrazoInformadoNoFluxo, prazosAConfirmar,
} from './prazos-municipais.js';
import {
    montarPromptPrazoMunicipal, interpretarPropostaPrazo,
} from './prazo-municipal-consulta.js';

const router = Router();
const COL = 'prazos_municipais';

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/** Todos os calendários cadastrados (a coleção é pequena: 1 doc por cidade). */
export async function carregarPrazosMunicipais(db) {
    const snap = await db.collection(COL).get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const competencia = /^\d{4}-\d{2}$/.test(String(req.query.competencia || ''))
            ? req.query.competencia
            : new Date().toISOString().slice(0, 7);

        const cadastros = await carregarPrazosMunicipais(db);

        // A FILA DO QUE FALTA, por MUNICÍPIO: cadastrar um calendário resolve
        // todos os clientes daquela cidade de uma vez. Por cliente seriam ~157
        // linhas dizendo a mesma coisa.
        const clientes = [];
        for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
                const d = doc.data() || {};
                if (d._deleted || d._merged_into) return;
                const df = d.dadosFiscais || {};
                clientes.push({
                    id: doc.id, regime,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    cnpj: soDigitos(d.cnpj),
                    codMunIBGE: String(df.codMunIBGE || d.codMunIBGE || '').trim(),
                    municipioNome: df.municipio || d.municipio || null,
                });
            });
        }

        const fila = municipiosSemCalendario(clientes, cadastros, { obrigacao: 'ISS', competencia });
        return res.json({
            ok: true, competencia, cadastros, ...fila,
            // Prazos que já VALEM mas ainda não têm norma — trabalho OPCIONAL
            // do admin. Não é pendência: a obrigação já sai com data.
            aConfirmar: prazosAConfirmar(cadastros),
            // O QUE ESTA FILA NÃO COBRA: optante do Simples não recolhe ISS
            // próprio (LC 123 art. 13, já está no DAS).
            escopo: 'Só clientes que recolhem ISS próprio em guia do município. '
                + 'Optante do Simples fica de fora: o ISS dele já está dentro do DAS.',
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[prazos-municipais/get]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/', requireAdmin, express.json(), async (req, res) => {
    try {
        const p = req.body || {};
        const v = validarPrazoMunicipal(p);
        if (!v.ok) return res.status(400).json({ ok: false, erros: v.erros });

        const db = getDb();
        const id = idPrazoMunicipal(p);
        // Quem cadastrou e quando: prazo sem dono não se audita, e é ele que
        // decide se um pagamento atrasou.
        const doc = {
            // Esfera MUNICIPAL guarda o IBGE; ESTADUAL guarda a UF. A
            // validação já recusou cadastro sem nenhum dos dois.
            esfera: String(p.esfera || '') === 'estadual' ? 'estadual' : 'municipal',
            codMunIBGE: soDigitos(p.codMunIBGE) || null,
            uf: String(p.uf || '').trim().toUpperCase() || null,
            municipioNome: String(p.municipioNome || '').trim() || null,
            obrigacao: String(p.obrigacao).trim().toUpperCase(),
            diaVencimento: Number(p.diaVencimento),
            mesesApos: Number.isFinite(Number(p.mesesApos)) ? Number(p.mesesApos) : 1,
            ajusteDiaNaoUtil: p.ajusteDiaNaoUtil || 'antecipa',
            baseLegal: String(p.baseLegal).trim(),
            vigenciaInicio: String(p.vigenciaInicio || '').slice(0, 10) || null,
            vigenciaFim: String(p.vigenciaFim || '').slice(0, 10) || null,
            ativo: true,
            cadastradoPorEmail: req.user?.email || null,
            cadastradoEm: new Date().toISOString(),
        };
        await db.collection(COL).doc(id).set(doc, { merge: true });
        return res.json({ ok: true, id, prazo: doc });
    } catch (e) {
        console.error('[prazos-municipais/post]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ============================================================================
// POST /informar — A DATA VEM DO FLUXO, não de uma fila de admin.
//
// Paulo, 16/08: *"eu não vou fazer nada manual (...) no caso de ISS de outra
// cidade, deve abrir o modal de data de vencimento para que o colaborador
// insira a data na hora do cálculo e geração da guia — assim eliminamos esta
// pendência e seguimos para o próximo"*.
//
// `requireAuth`, não `requireAdmin`: quem informa é quem trabalha a obrigação.
// Exigir admin aqui devolveria a pendência para a fila que este desenho existe
// para acabar.
//
// O que ele informa VIRA o calendário da cidade a partir daquela competência —
// então ninguém pergunta de novo no mês seguinte. É isso que faz o cadastro se
// preencher sozinho pelo uso.
// ============================================================================
router.post('/informar', requireAuth, express.json(), async (req, res) => {
    try {
        const r = montarPrazoInformadoNoFluxo({
            ...(req.body || {}),
            informadoPorEmail: req.user?.email || null,
        });
        if (!r.ok) return res.status(400).json({ ok: false, error: r.erro });

        const db = getDb();
        const id = idPrazoMunicipal(r.prazo);
        // NÃO sobrescreve calendário já confirmado com base legal: o informado
        // no fluxo é o que falta, não o que corrige quem já conferiu a norma.
        const atual = await db.collection(COL).doc(id).get();
        if (atual.exists && String(atual.data()?.origem || 'admin') !== 'fluxo') {
            return res.status(409).json({
                ok: false,
                error: 'Já existe calendário CONFIRMADO para esta cidade nesta vigência. '
                    + 'Se o prazo mudou, cadastre uma vigência nova em ⚙️ Config Admin.',
            });
        }
        await db.collection(COL).doc(id).set(r.prazo, { merge: true });
        return res.json({
            ok: true, id, prazo: r.prazo,
            aviso: 'Guardado como calendário desta cidade a partir desta competência — '
                + 'ninguém precisa informar de novo. Ficou marcado como informado no fluxo (sem a norma): '
                + 'o admin pode confirmar a base legal depois, sem pressa.',
        });
    } catch (e) {
        console.error('[prazos-municipais/informar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ============================================================================
// POST /consultar — a CONSULTA MENSAL desenhada pelo Paulo (11/08).
//
// "Proposta COM FONTE, nunca escrita direta: o app mostra a DIFERENÇA contra o
// catálogo e humano confirma — data de pagamento não muda sozinha (multa de um
// lado, 'atrasada' falsa do outro), e modelo com busca reduz o chute mas pode
// citar blog no lugar do ato."
//
// 🚨 ESTE HANDLER NÃO ESCREVE NADA. Ele consulta, recusa o que não se sustenta
// e devolve a proposta com as fontes. Quem grava é o POST de cadastro, que
// exige base legal e guarda quem confirmou.
// ============================================================================
router.post('/consultar', requireAdmin, express.json(), async (req, res) => {
    try {
        const ai = req.app.get('ai');
        if (!ai) return res.status(503).json({ ok: false, error: 'IA indisponível (GEMINI_API_KEY ausente).' });

        const { codMunIBGE, municipioNome, uf, obrigacao = 'ISS' } = req.body || {};
        if (String(codMunIBGE || '').replace(/\D/g, '').length !== 7) {
            return res.status(400).json({ ok: false, error: 'Informe o código IBGE do município (7 dígitos).' });
        }

        const db = getDb();
        const cadastros = await carregarPrazosMunicipais(db);
        const competencia = new Date().toISOString().slice(0, 7);
        const atual = resolverPrazoMunicipal(cadastros, { codMunIBGE, obrigacao, competencia });

        const modelos = req.app.get('geminiModelos');
        const modelo = (typeof modelos === 'function' ? modelos().pro : null) || undefined;
        const r = await ai.models.generateContent({
            model: modelo,
            contents: montarPromptPrazoMunicipal({ municipioNome, uf, codMunIBGE, obrigacao }),
            // GROUNDING LIGADO: é ele que transforma "o modelo acha" em "o
            // modelo leu isto aqui". Sem as fontes a proposta é recusada.
            config: { tools: [{ googleSearch: {} }], temperature: 0 },
        });

        const chunks = r?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const fontes = chunks.filter((c) => c?.web?.uri).map((c) => ({ uri: c.web.uri, title: c.web.title }));

        const resultado = interpretarPropostaPrazo({
            texto: r?.text ?? '',
            fontes,
            cadastroAtual: atual.achou ? atual.prazo : null,
        });
        return res.json({
            ...resultado,
            modelo: modelo || null,
            // Dito na resposta e repetido na tela: consulta NÃO é cadastro.
            aviso: 'Isto é uma PROPOSTA. Nada foi gravado — confira nas fontes e cadastre você mesmo, '
                + 'com a base legal. Prazo que muda sozinho é multa de um lado ou "atrasada" falsa do outro.',
        });
    } catch (e) {
        console.error('[prazos-municipais/consultar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/desativar', requireAdmin, express.json(), async (req, res) => {
    try {
        const id = String(req.body?.id || '').trim();
        if (!id) return res.status(400).json({ ok: false, error: 'Informe o id do calendário.' });
        const db = getDb();
        // NÃO APAGA: o calendário antigo continua explicando as competências
        // que ele datou. Apagar reescreveria o passado sem deixar rastro.
        await db.collection(COL).doc(id).set({
            ativo: false,
            desativadoPorEmail: req.user?.email || null,
            desativadoEm: new Date().toISOString(),
        }, { merge: true });
        return res.json({ ok: true, id });
    } catch (e) {
        console.error('[prazos-municipais/desativar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
