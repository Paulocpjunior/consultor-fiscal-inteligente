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
import { acharEmpresaPorCnpj, filiaisDaRaiz } from './empresa-por-cnpj.js';
import { montarPayloadR2055 } from './reinf-aquisicao-rural.js';
import { montarPayloadR2010 } from './reinf-servicos-tomados.js';
import { montarDipamCompetencia } from './dipam-produtor-rural.js';
import { carregarProdutoresRurais, lerCondicaoRural, documentosDaContraparte } from './dipam-store.js';
import { conferirTotalizadorR2099, CODIGOS_RECEITA_FUNRURAL } from './reinf-aquisicao-rural.js';
import { montarExtratoEntregas, montarEmailFechamento, codigoDoEvento } from './reinf-recibo-entrega.js';
import { enviarEmail } from './graph-provider.js';
import { escolherRemetente } from './graph-remetente.js';
import { GESTOR_EMAIL } from './envio-imposto.js';
import express from 'express';

const PROXY_URL = process.env.SHAREPOINT_PROXY_URL
    || 'https://consultor-fiscal-proxy-631239634290.us-west1.run.app';
const PROXY_TOKEN = process.env.SHAREPOINT_PROXY_TOKEN || process.env.PROXY_SHARED_TOKEN || '';

/**
 * Pasta dos recibos da REINF — irmã de IMPOSTOS na MESMA árvore do sync.
 *
 * IMPOSTOS guarda a GUIA (o que o cliente paga); RECIBOS guarda a PROVA DE
 * ENTREGA da obrigação acessória. São artefatos diferentes, com públicos
 * diferentes — misturar faz alguém mandar recibo de entrega no lugar da guia.
 */
export function pastaRecibosReinf(grupo, empresaPasta, competencia) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ''));
    if (!grupo || !empresaPasta || !m) return null;
    return `Empresas/${grupo}/DEPARTAMENTO FISCAL/${m[1]}/${m[2]}-${m[1]}/${empresaPasta}/RECIBOS`;
}

async function uploadRecibo(folderPath, filename, contentBase64, mimeType) {
    const resp = await fetch(`${PROXY_URL}/api/sharepoint/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(PROXY_TOKEN ? { Authorization: `Bearer ${PROXY_TOKEN}` } : {}) },
        body: JSON.stringify({ folderPath, filename, contentBase64: String(contentBase64).replace(/^data:[^;]+;base64,/, ''), mimeType }),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Proxy upload ${resp.status}`);
    }
    return resp.json();
}

const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

/**
 * Empresa da carteira pelo CNPJ (Simples ou Lucro).
 *
 * VARRE E NORMALIZA — não consulta por igualdade. O CNPJ não é gravado num
 * formato só: parte do cadastro tem `51227692000146`, parte tem
 * `51.227.692/0001-46`. A primeira versão desta rota usava
 * `where('cnpj','==',<dígitos>)` e respondia "CNPJ não cadastrado" para
 * empresa cadastrada — culpando o cadastro por um defeito da consulta.
 * Todas as outras rotas do CFI já faziam assim; esta é que destoava.
 */
async function acharEmpresa(db, cnpj) {
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        const snap = await db.collection(col).get();
        const empresas = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
        const achada = acharEmpresaPorCnpj(empresas, cnpj);
        if (achada) {
            return {
                empresaId: achada.id,
                nome: achada.razaoSocial || achada.nome || '—',
                regime: col === 'simples_empresas' ? 'simples' : 'lucro',
                filiais: filiaisDaRaiz(empresas, cnpj),
                _doc: achada,
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
                error: `O CNPJ ${cnpj} não foi encontrado no cadastro do CFI (nem no Simples, nem no Lucro). `
                    + 'Confira o número; se estiver certo, a empresa precisa ser cadastrada — sem cadastro '
                    + 'não há captura, e a ausência de notas aqui não prova ausência de retenção.',
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
// GET /api/admin/reinf/servicos-tomados?cnpj=...&competencia=AAAA-MM
//
// As NFS-e TOMADAS com RETENÇÃO PREVIDENCIÁRIA (11% do art. 31 da Lei
// 8.212/91), prontas para o **R-2010** do EFD-Reinf.
//
// Mesmo desenho do R-4020 e do R-2055 — e pela mesma razão: quem conhece a
// FORMA do documento é o CFI (portal ACHATADO × XML em OBJETO). Reler isso do
// outro lado seria a nona mordida da mesma armadilha.
//
// A régua vive em `reinf-servicos-tomados.js`, calibrada contra um `evtServTom`
// REAL com recibo de SUCESSO da Receita (06/2026) — arquivo aceito vale mais
// que leiaute deduzido. É de lá que veio o achado que manda no módulo: a BASE
// de retenção NÃO é o valor bruto quando há dedução de material/insumo.
// ────────────────────────────────────────────────────────────────────────────
router.get('/servicos-tomados', autorizar, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        const cnpj = soDigitos(req.query.cnpj);
        if (!COMPETENCIA.test(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        if (cnpj.length !== 14) {
            return res.status(400).json({ ok: false, error: 'Informe o CNPJ do TOMADOR (14 dígitos) — é ele quem declara o R-2010.' });
        }

        const db = getDb();
        const empresa = await acharEmpresa(db, cnpj);
        // Lista vazia com cara de sucesso seria lida como "não teve retenção".
        if (!empresa) {
            return res.status(404).json({
                ok: false,
                error: `O CNPJ ${cnpj} não está cadastrado no CFI. Sem cadastro não há captura, e a ausência `
                    + 'de notas aqui não prova ausência de retenção.',
            });
        }

        const documentos = await carregarDocumentos(db, { empresaId: empresa.empresaId, cnpj, competencia });
        const payload = montarPayloadR2010({ cnpjTomador: cnpj, competencia, documentos });

        return res.json({
            ok: true,
            empresa: { empresaId: empresa.empresaId, nome: empresa.nome, regime: empresa.regime, cnpj },
            documentosLidos: documentos.length,
            ...payload,
        });
    } catch (e) {
        console.error('[reinf-servicos-tomados]', e);
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

// ============================================================================
// GET /api/admin/reinf/fechamento-competencia/preparar?cnpj=&competencia=
//
// O QUE O APP JÁ SABE NÃO SE REDIGITA.
//
// O fechamento pede duas coisas de fora — os RECIBOS de cada evento e o
// TOTALIZADOR do R-2099 — porque as duas só existem depois que a Receita
// processa. Mas QUAIS eventos foram transmitidos, em que lote e em que
// ambiente, disso o CFI é testemunha: desde que `REINF_TRANSMISSOR=gateway`
// (09/08), toda transmissão do módulo Contábil passa por aqui e fica em
// `reinf_gateway_lotes`.
//
// Pedir que a pessoa digite a lista de eventos seria pedir de novo o que já
// está gravado — e lista digitada à mão ESQUECE evento, que é exatamente o
// jeito de dar o mês por fechado com um R-2055 faltando.
//
// ═══ SEM RECIBO NÃO NASCE VERDE ═════════════════════════════════════════════
//
// A auditoria do gateway guarda PROTOCOLO (lote recebido), nunca recibo (evento
// processado) — entre um e outro cabe uma recusa. Então tudo o que sai daqui
// nasce `sem-recibo`, e é a pessoa que cola o recibo do e-CAC. Preencher
// recibo por dedução seria transformar "transmitiu" em "entregou", que é a
// única coisa que este extrato existe para não deixar acontecer.
// ============================================================================
router.get('/fechamento-competencia/preparar', requireAdmin, async (req, res) => {
    try {
        const cnpj = soDigitos(req.query.cnpj);
        const competencia = String(req.query.competencia || '').trim();
        if (cnpj.length !== 14) return res.status(400).json({ ok: false, error: 'Informe o CNPJ do declarante (14 dígitos).' });
        if (!COMPETENCIA.test(competencia)) return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });

        const db = getDb();
        const empresa = await acharEmpresa(db, cnpj);
        if (!empresa) return res.status(404).json({ ok: false, error: `O CNPJ ${cnpj} não está cadastrado no CFI.` });

        // O APURADO é a MESMA `montarDipamCompetencia` da aba 🌾. Ele vem junto
        // para a tela mostrar contra o que o totalizador será conferido — sem
        // isso a pessoa digita o totalizador às cegas.
        const documentos = await carregarDocumentos(db, { empresaId: empresa.empresaId, cnpj, competencia });
        const fornecedores = await carregarProdutoresRurais(documentosDaContraparte(documentos));
        const painel = montarDipamCompetencia({
            documentos, competencia, empresa: lerCondicaoRural(empresa._doc), fornecedores,
        });

        // Consulta por igualdade de CNPJ é segura AQUI (e só aqui): `declarante`
        // é gravado pelo próprio gateway já normalizado em dígitos. A regra da
        // casa — nunca consultar Firestore por igualdade de CNPJ — vale para o
        // CADASTRO, que tem duas formas porque veio de fontes diferentes.
        const snap = await db.collection('reinf_gateway_lotes').where('declarante', '==', cnpj).get();
        const entregas = [];
        let semCompetencia = 0;
        for (const doc of snap.docs) {
            const l = doc.data() || {};
            const comps = Array.isArray(l.competencias) ? l.competencias : [];
            if (!comps.length) { semCompetencia += 1; continue; }
            if (!comps.includes(competencia)) continue;

            // O elemento é guardado por LOTE (conjunto), não por evento. Com um
            // elemento só, todo evento do lote é ele; com mais de um, o app NÃO
            // adivinha qual id é qual — diz que não sabe.
            const elementos = Array.isArray(l.elementos) ? l.elementos : [];
            const unico = elementos.length === 1 ? elementos[0] : null;
            for (const id of (Array.isArray(l.eventos) ? l.eventos : [])) {
                entregas.push({
                    evento: unico ? (codigoDoEvento(unico) || unico) : `Evento ${String(id).slice(-5)}`,
                    tipo: id,
                    protocolo: l.protocolo || null,
                    recibo: null,
                    transmitidoEm: l.em?.toDate ? l.em.toDate().toISOString().slice(0, 10) : null,
                    tpAmb: l.tpAmb || null,
                    elementoIncerto: !unico,
                });
            }
        }

        return res.json({
            ok: true,
            empresa: { empresaId: empresa.empresaId, nome: empresa.nome, cnpj },
            competencia,
            apurado: painel.funrural,
            entregas,
            // Lote sem competência NÃO some: é R-1000/tabela (que não tem
            // perApur) ou lote antigo, e sumir sem dizer faria alguém procurar
            // um evento que está gravado.
            lotesSemCompetencia: semCompetencia,
            // Os códigos de receita saem DAQUI para a tela não escrever a
            // tabela outra vez. Ela veio do RECIBO do R-2099 aceito (VINCENZO
            // 07/2026) e mora em `reinf-aquisicao-rural.js`; uma segunda cópia
            // no frontend mandaria a contribuição para o código de outro
            // tributo, e o erro só apareceria na cobrança.
            codigosFunrural: CODIGOS_RECEITA_FUNRURAL,
            // O SharePoint é a prova que fica — se não há onde arquivar, a tela
            // precisa dizer ANTES, não depois de montar o extrato.
            temPastaSharePoint: Boolean(empresa._doc?.sharePointConfig?.grupo && empresa._doc?.sharePointConfig?.empresaPasta),
        });
    } catch (e) {
        console.error('[reinf/fechamento/preparar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ============================================================================
// POST /api/admin/reinf/fechamento-competencia
//
// O RITO DO FECHAMENTO DA EFD-REINF — o que acontece depois do R-2099.
//
// Paulo, 13/08, com o recibo do R-2099 da VINCENZO na mão: *"vc pode mandar por
// email somente o que foi enviado e seu status, salvar pode salvar no
// sharepoint"*. Dispara no FECHAMENTO (é quando o mês fecha de verdade), sai da
// caixa de quem transmitiu com o gestor em cópia — mesmo rito das guias (#293).
//
// ═══ A CONFERÊNCIA NÃO É OPCIONAL, E O NÚMERO NÃO VEM DE FORA ═══════════════
//
// O totalizador chega do e-CAC (ou do gateway), mas o APURADO é lido AQUI, da
// mesma `montarDipamCompetencia` que a aba 🌾 usa. Aceitar o apurado por
// parâmetro abriria a porta pro pior defeito de um arquivo fiscal: dois números
// pro mesmo fato, e quem confere escolhendo qual mandar.
//
// ═══ ORDEM DELIBERADA: ARQUIVA, DEPOIS AVISA ════════════════════════════════
//
// O SharePoint é a prova que fica; o e-mail é o aviso. Avisar antes de arquivar
// produziria "extrato enviado" com o arquivo em lugar nenhum — e é justamente o
// e-mail que faz a pessoa parar de procurar.
//
// Falha no e-mail NÃO derruba o arquivamento (nem o contrário): cada etapa
// devolve seu próprio status, como no rito das guias.
// ============================================================================
router.post('/fechamento-competencia', requireAdmin, express.json({ limit: '12mb' }), async (req, res) => {
    try {
        const cnpj = soDigitos(req.body?.cnpj);
        const competencia = String(req.body?.competencia || '').trim();
        if (cnpj.length !== 14) {
            return res.status(400).json({ ok: false, error: 'Informe o CNPJ do declarante (14 dígitos).' });
        }
        if (!COMPETENCIA.test(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }

        const db = getDb();
        const empresa = await acharEmpresa(db, cnpj);
        if (!empresa) {
            return res.status(404).json({ ok: false, error: `O CNPJ ${cnpj} não está cadastrado no CFI.` });
        }

        // O APURADO sai da régua da casa, nunca do corpo da requisição.
        const documentos = await carregarDocumentos(db, { empresaId: empresa.empresaId, cnpj, competencia });
        const fornecedores = await carregarProdutoresRurais(documentosDaContraparte(documentos));
        const painel = montarDipamCompetencia({
            documentos, competencia, empresa: lerCondicaoRural(empresa._doc), fornecedores,
        });
        const conferencia = conferirTotalizadorR2099({
            apurado: painel.funrural,
            totalizador: Array.isArray(req.body?.totalizador) ? req.body.totalizador : [],
        });

        const extrato = montarExtratoEntregas({
            competencia,
            empresa: { nome: empresa.nome, cnpj },
            entregas: Array.isArray(req.body?.entregas) ? req.body.entregas : [],
            fechamento: req.body?.fechamento || null,
            conferencia,
        });

        const resultado = { sharePoint: { status: 'sem-arquivo' }, email: { status: 'nao-enviado' } };

        // 1. ARQUIVA. Os arquivos vêm de quem fechou (XML do recibo/totalizador
        //    e o relatório em PDF, que o próprio e-CAC oferece para baixar).
        const arquivos = (Array.isArray(req.body?.arquivos) ? req.body.arquivos : [])
            .filter((a) => a && a.nome && a.base64);
        if (arquivos.length) {
            const cfg = empresa._doc?.sharePointConfig;
            const pasta = cfg ? pastaRecibosReinf(cfg.grupo, cfg.empresaPasta, competencia) : null;
            if (!pasta) {
                resultado.sharePoint = {
                    status: 'sem-config',
                    motivo: 'Empresa sem sharePointConfig (grupo + pasta) — preencha na Central de XMLs → '
                        + 'Integrações → SharePoint. O extrato foi montado, mas não há onde arquivar.',
                };
            } else {
                const arquivados = [];
                for (const a of arquivos) {
                    try {
                        await uploadRecibo(pasta, String(a.nome), String(a.base64), a.mime || 'application/octet-stream');
                        arquivados.push(a.nome);
                    } catch (e) {
                        resultado.sharePoint = { status: 'erro', motivo: e.message, pasta, arquivados };
                    }
                }
                if (resultado.sharePoint.status !== 'erro') {
                    resultado.sharePoint = { status: 'arquivado', pasta, arquivados };
                }
            }
        }

        // 2. AVISA. Remetente = caixa de quem clicou; gestor em CÓPIA OCULTA
        //    (o cliente não entra nesta mensagem — é comunicação interna).
        const { assunto, corpo } = montarEmailFechamento(extrato);
        const escolha = escolherRemetente({
            emailColaborador: req.user?.email,
            padrao: process.env.GRAPH_REMETENTE,
            dominios: (process.env.GRAPH_DOMINIOS_REMETENTE || '').split(',').map((d) => d.trim()).filter(Boolean),
        });
        try {
            await enviarEmail({
                remetente: escolha.remetente,
                para: [escolha.remetente],
                bcc: [GESTOR_EMAIL],
                assunto,
                corpoHtml: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(corpo)}</pre>`,
            });
            resultado.email = { status: 'enviado', remetente: escolha.remetente, fonteRemetente: escolha.fonte, gestorEmCopia: GESTOR_EMAIL };
        } catch (e) {
            // O extrato continua valendo: ele está na resposta e (se houve
            // arquivo) no SharePoint. Falha de e-mail não apaga a entrega.
            resultado.email = { status: 'erro', motivo: e.message };
        }

        // 3. AUDITA — sem o conteúdo dos eventos, como no gateway.
        try {
            await db.collection('reinf_fechamentos').add({
                em: admin.firestore.FieldValue.serverTimestamp(),
                por: req.user?.email || null,
                cnpj, competencia,
                empresaId: empresa.empresaId,
                farol: extrato.farol.cor,
                resumo: extrato.resumo,
                reciboFechamento: extrato.fechamento?.recibo || null,
                recibos: extrato.linhas.map((l) => ({ evento: l.evento, recibo: l.recibo, situacao: l.situacao })),
                conferencia: conferencia.situacao,
                sharePoint: resultado.sharePoint.status,
                email: resultado.email.status,
            });
        } catch (e) {
            console.warn('[reinf/fechamento] auditoria não gravada:', e.message);
        }

        return res.json({ ok: true, extrato, ...resultado });
    } catch (e) {
        console.error('[reinf/fechamento-competencia]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
