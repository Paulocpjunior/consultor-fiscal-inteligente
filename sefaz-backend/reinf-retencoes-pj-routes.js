// ============================================================================
// sefaz-backend/reinf-retencoes-pj-routes.js  (ESM)
// ----------------------------------------------------------------------------
// GET /api/admin/reinf/retencoes-pj?cnpj=...&competencia=AAAA-MM
//
// As NFS-e TOMADAS com retenção federal, prontas para o R-4020 do EFD-Reinf.
//
// POR QUE ESTA ROTA EXISTE
//
// Hoje o caminho da colaboradora é: importar as notas no E-Fiscal → digitar a
// retenção e a natureza do rendimento nota a nota → gerar o módulo REINF. O
// dado das notas JÁ ESTÁ CAPTURADO aqui; o que falta é ele chegar do outro
// lado sem passar por planilha.
//
// E ela mora no CFI (e não no app do Reinf) porque quem conhece a FORMA do
// documento é o CFI: a NFS-e do portal de SP vem ACHATADA (`valorIss`,
// `pisRetido`) e a do XML vem em OBJETO (`valores.*`). Reler isso do outro
// lado seria a sétima vez que essa armadilha morde — e as duas leituras
// divergiriam sem ninguém perceber.
//
// QUEM PODE CHAMAR
//
// Os dois apps NÃO compartilham Firestore (o Reinf fixa `projetos-app-sp`, o
// CFI roda em `consultorfiscalapp`), então a integração é por token: admin do
// CFI, ou usuário do Consultor Contábil com e-mail VERIFICADO do domínio do
// escritório. A lista de projetos é explícita aqui — somar projeto na lista
// global abriria de lambuja o /api/dp-integration/*, que entrega dado SERPRO.
//
// A régua vive em reinf-retencoes-pj.js, puro e testado; aqui é só I/O.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { fetchAllDocs } from './firestore-paginate.js';
import { requireAdmin } from './require-admin.js';
import { crossProjectAuth, PROJETO } from './require-cross-project-auth.js';
import { montarPayloadReinfPJ } from './reinf-retencoes-pj.js';
import { montarPayloadR2055 } from './reinf-aquisicao-rural.js';
import { montarDipamCompetencia } from './dipam-produtor-rural.js';
import { carregarProdutoresRurais, lerCondicaoRural, documentosDaContraparte } from './dipam-store.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const COMPETENCIA = /^\d{4}-\d{2}$/;

const doContabil = crossProjectAuth([PROJETO.fiscal, PROJETO.contabil]);

/**
 * Admin do CFI OU usuário do Consultor Contábil.
 *
 * Tenta o admin primeiro (é quem abre a tela daqui) e, se o token não for
 * deste projeto, cai no cross-project. A resposta de erro é a do SEGUNDO —
 * "token de outro projeto" seria uma mensagem que não ajuda ninguém a agir.
 */
async function autorizar(req, res, next) {
    // Resposta de mentira: o requireAdmin responde 401/403 quando recusa, e
    // recusar aqui é normal (token do outro app). Engolimos a resposta dele
    // pra que só a segunda tentativa fale com o cliente.
    let passou = false;
    const engolir = { status() { return engolir; }, json() { return engolir; } };
    await requireAdmin(req, engolir, () => { passou = true; });
    if (passou) return next();
    return doContabil(req, res, next);
}

/** Documentos da competência de UMA empresa, pelas duas chaves de dono. */
async function carregarDocumentos(db, { empresaId, cnpj, competencia }) {
    const porId = new Map();
    const consultas = [];
    if (empresaId) {
        consultas.push(db.collection('documentos_fiscais')
            .where('empresaId', '==', empresaId)
            .where('competencia', '==', competencia));
    }
    // Documento capturado antes do vínculo de empresa fica só com o CNPJ —
    // buscar só por empresaId devolveria menos nota do que existe, e "menos
    // nota" numa declaração é omissão, não simplificação.
    if (cnpj) {
        consultas.push(db.collection('documentos_fiscais')
            .where('empresaCnpj', '==', cnpj)
            .where('competencia', '==', competencia));
    }
    for (const q of consultas) {
        const snaps = await fetchAllDocs(q, { label: `reinf-pj ${cnpj} ${competencia}`, maxDocs: 20000 });
        for (const s of snaps) {
            const d = s.data() || {};
            if (d._deleted || d._merged_into) continue;
            porId.set(s.id, { id: s.id, ...d });
        }
    }
    return [...porId.values()];
}

/** Empresa da carteira pelo CNPJ (Simples ou Lucro). */
async function acharEmpresa(db, cnpj) {
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        const snap = await db.collection(col).where('cnpj', '==', cnpj).limit(5).get();
        for (const doc of snap.docs) {
            const d = doc.data() || {};
            if (d._deleted || d._merged_into) continue;
            return {
                empresaId: doc.id,
                nome: d.razaoSocial || d.nome || '—',
                regime: col === 'simples_empresas' ? 'simples' : 'lucro',
                // O doc cru vai junto porque `lerCondicaoRural` lê
                // `dadosFiscais.condicaoRural` — sem ele a marcação do cliente
                // sairia sempre falsa, e mês vazio deixaria de levantar suspeita.
                _doc: { ...d, id: doc.id },
            };
        }
    }
    return null;
}

router.get('/retencoes-pj', autorizar, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        const cnpj = soDigitos(req.query.cnpj);
        if (!COMPETENCIA.test(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        if (cnpj.length !== 14) {
            return res.status(400).json({ ok: false, error: 'Informe o CNPJ do tomador (14 dígitos) — é ele quem declara o R-4020.' });
        }

        const db = getDb();
        const empresa = await acharEmpresa(db, cnpj);
        // Empresa sem cadastro NÃO devolve lista vazia com cara de sucesso: a
        // lista vazia seria lida como "não teve retenção no mês".
        if (!empresa) {
            return res.status(404).json({
                ok: false,
                error: `O CNPJ ${cnpj} não está cadastrado no CFI (nem no Simples, nem no Lucro). `
                    + 'Sem cadastro não há captura, e a ausência de notas aqui não prova ausência de retenção.',
            });
        }

        const documentos = await carregarDocumentos(db, { empresaId: empresa.empresaId, cnpj, competencia });
        const payload = montarPayloadReinfPJ({ cnpjTomador: cnpj, competencia, documentos });

        return res.json({
            ok: true,
            empresa: { empresaId: empresa.empresaId, nome: empresa.nome, regime: empresa.regime, cnpj },
            documentosLidos: documentos.length,
            ...payload,
        });
    } catch (e) {
        console.error('[reinf-retencoes-pj]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/reinf/aquisicao-rural?cnpj=...&competencia=AAAA-MM
//
// As aquisições de produção rural de produtor PF — o FUNRURAL que o cliente
// recolhe por SUB-ROGAÇÃO — no formato do R-2055.
//
// É o único evento da série R-2000 com o cálculo JÁ PRONTO: a aba 🌾 apura
// desde 31/07, com vigência de alíquota (LC 224/2025), tabela própria de
// segurado especial, centavo desprezado (IN RFB 971) e conferência contra o
// FUNRURAL declarado no infAdic da própria nota.
//
// A rota LÊ essa apuração e só troca o eixo (nota/município → PRODUTOR, que é
// como o R-2055 é declarado). Recalcular do outro lado abriria a porta pro
// pior defeito de um arquivo fiscal: dois números pro mesmo fato.
// ────────────────────────────────────────────────────────────────────────────
router.get('/aquisicao-rural', autorizar, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        const cnpj = soDigitos(req.query.cnpj);
        if (!COMPETENCIA.test(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        if (cnpj.length !== 14) {
            return res.status(400).json({ ok: false, error: 'Informe o CNPJ do ADQUIRENTE (14 dígitos) — é ele quem declara o R-2055.' });
        }

        const db = getDb();
        const empresa = await acharEmpresa(db, cnpj);
        if (!empresa) {
            return res.status(404).json({
                ok: false,
                error: `O CNPJ ${cnpj} não está cadastrado no CFI. Sem cadastro não há captura, e a ausência `
                    + 'de aquisições aqui não prova ausência de obrigação.',
            });
        }

        const documentos = await carregarDocumentos(db, { empresaId: empresa.empresaId, cnpj, competencia });
        const fornecedores = await carregarProdutoresRurais(documentosDaContraparte(documentos));
        const condicao = lerCondicaoRural(empresa._doc);
        // MESMA função da aba 🌾 — é isso que garante um número só.
        const painel = montarDipamCompetencia({ documentos, competencia, empresa: condicao, fornecedores });
        const payload = montarPayloadR2055({
            cnpjAdquirente: cnpj,
            competencia,
            funrural: painel.funrural,
            produtores: fornecedores,
        });

        return res.json({
            ok: true,
            empresa: { empresaId: empresa.empresaId, nome: empresa.nome, regime: empresa.regime, cnpj },
            documentosLidos: documentos.length,
            // O cadastro diz que o cliente COMPRA de produtor? Mês vazio com a
            // marcação ligada é suspeita de captura, não ausência de obrigação.
            marcadoComoComprador: condicao.adquireDeProdutor === true,
            ...payload,
        });
    } catch (e) {
        console.error('[reinf-aquisicao-rural]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
