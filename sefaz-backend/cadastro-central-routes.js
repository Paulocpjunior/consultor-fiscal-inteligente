// ============================================================================
// sefaz-backend/cadastro-central-routes.js  (ESM)
// ----------------------------------------------------------------------------
// O TÚNEL DO CADASTRO — o CFI como dono do cadastro dos apps irmãos.
//
//   GET /api/admin/cadastro/empresas
//   GET /api/admin/cadastro/empresas/:cnpj
//   GET /api/admin/cadastro/responsaveis          (fase 2)
//   GET /api/admin/cadastro/responsaveis/:cnpj
//   GET /api/admin/cadastro/certificados          (fase 3 — METADADO, nunca a chave)
//   GET /api/admin/cadastro/certificados/:cnpj
//   GET /api/admin/cadastro/fechamentos?competencia=      (fase 5 — o CCI importa)
//   GET /api/admin/cadastro/fechamentos/:cnpj?competencia=
//
// Ideia do Paulo (07/08), depois que a colaboradora recebeu "CNPJ não
// cadastrado" para uma empresa cadastrada. O mesmo cliente vive no CFI, no
// Consultor Contábil e no Legalização, cada um com o seu cadastro — e cadastro
// duplicado não fica igual, fica PARECIDO. Ninguém desconfia de parecido.
//
// A régua vive em `cadastro-central.js`, pura e testada; aqui é só I/O.
//
// ⚠️ CERTIFICADO A1 NÃO PASSA POR AQUI, e não é esquecimento: é chave privada
// que assina documento fiscal em nome do cliente. Chave copiada é chave que
// não se controla mais. Quando o outro app precisar assinar, a assinatura
// acontece NO CFI — leva-se a operação, nunca a chave.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { fetchAllDocs } from './firestore-paginate.js';
import { requireAdmin } from './require-admin.js';
import { crossProjectAuth, PROJETO } from './require-cross-project-auth.js';
import { decidirAcessoHorario, travaArmada, validarHorarioAcesso } from './horario-acesso.js';
import { montarCadastroEmpresas, soDigitos } from './cadastro-central.js';
import { triarCarteira } from './triagem-terceiro-setor.js';
import { triarCarteiraDere } from './dere.js';
import { acharEmpresaPorCnpj, filiaisDaRaiz } from './empresa-por-cnpj.js';
import { registrarMudancaPermissao } from './auditoria-permissoes.js';
import { montarResponsaveis, responsavelDoCnpj } from './cadastro-central-responsaveis.js';
import { montarCertificados, aptidaoDeAssinatura } from './cadastro-central-certificados.js';
import {
    montarUsuariosCadastro, normalizarUsuarioCadastro, acessoAoModulo, validarDepartamentos,
} from './cadastro-central-departamentos.js';
// 🔒 FASE 5 — o Contábil importa o FECHAMENTO, nunca a ficha (a ficha é um
// registro VIVO: alguém edita e o número muda depois da importação).
import { linhaDoFechamento, resumirFechamentos } from './cadastro-central-fechamentos.js';
import { lerFechamentoDaCompetencia, lerFechamentosDaCompetencia } from './fechamento-store.js';
import { normalizarCompetencia } from './competencia.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

// Lista EXPLÍCITA por rota. Pôr projeto na lista global abriria de lambuja o
// /api/dp-integration/*, que entrega dado SERPRO de qualquer CNPJ.
// O DP entra AQUI (cadastro/gate de departamento) e continua FORA de
// qualquer outra rota — é exatamente o que a lista por rota existe pra
// permitir.
const doIrmao = crossProjectAuth([PROJETO.fiscal, PROJETO.contabil, PROJETO.dpFolha, PROJETO.financeiro]);

/** Admin do CFI OU usuário de um app irmão com e-mail verificado do domínio. */
async function autorizar(req, res, next) {
    let passou = false;
    const engolir = { status() { return engolir; }, json() { return engolir; } };
    await requireAdmin(req, engolir, () => { passou = true; });
    if (passou) return next();
    return doIrmao(req, res, next);
}

async function lerCadastro(db) {
    const fontes = [];
    for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
        const snaps = await fetchAllDocs(db.collection(col), { label: `cadastro-central/${col}`, maxDocs: 5000 });
        fontes.push({ regime, docs: snaps.map((s) => ({ id: s.id, ...(s.data() || {}) })) });
    }
    return montarCadastroEmpresas(fontes);
}

/**
 * 🔎 A FILA CURTA: quem PARECE imune, isenta ou terceiro setor.
 *
 * Paulo, 18/08: *"o que eu tenho que pedir p colaborador?"*. Não é "preencham as
 * ~390" — o regime deduzido acerta na esmagadora maioria. O que o app não tem
 * como saber é quem é imune/isenta/sem fins lucrativos, e essas são poucas.
 *
 * ⚠️ Consulta PURA: não grava regime nenhum. Quem grava é o cadastro, com o
 * nome de quem confirmou — mesma figura da consulta de prazo municipal.
 */
router.get('/triagem-terceiro-setor', autorizar, async (req, res) => {
    try {
        const cadastro = await lerCadastro(getDb());
        return res.json({ ok: true, ...triarCarteira(cadastro.empresas) });
    } catch (e) {
        return res.status(500).json({ error: e?.message || 'Falha na triagem.' });
    }
});

/**
 * 🏦 DeRE — quem está, quem PARECE estar, e quando vence (02/09).
 *
 * Paulo: *"crie uma nova função capaz de atender esta obrigação chamada DERE"*.
 * A resposta do app é a FILA: obrigadas (cadastro afirma regime específico de
 * IBS/CBS), candidatas (o CNAE sugere e o cadastro não diz), regimes que a
 * documentação lida não confirma, e o que ficou de fora — contado. Consulta
 * PURA, como a triagem do terceiro setor: quem grava é o cadastro.
 *
 * `?competencia=` em 'AAAA-MM' ou 'MM/AAAA'; sem ela, o mês anterior ao atual.
 */
router.get('/dere-carteira', autorizar, async (req, res) => {
    try {
        const comp = competenciaDaConsulta(req.query.competencia);
        if (!comp) {
            return res.status(400).json({ error: 'Competência inválida — use AAAA-MM ou MM/AAAA.' });
        }
        const cadastro = await lerCadastro(getDb());
        return res.json({ ok: true, ...triarCarteiraDere(cadastro.empresas, comp) });
    } catch (e) {
        return res.status(500).json({ error: e?.message || 'Falha ao levantar a DeRE da carteira.' });
    }
});

/** 'AAAA-MM' | 'MM/AAAA' → 'MM/AAAA' (o formato do catálogo). Vazio = mês anterior. */
function competenciaDaConsulta(bruto) {
    const t = String(bruto || '').trim();
    if (!t) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
    const iso = normalizarCompetencia(t);
    if (!iso) return null;
    const [ano, mes] = iso.split('-');
    return `${mes}/${ano}`;
}

router.get('/empresas', autorizar, async (req, res) => {
    try {
        const cadastro = await lerCadastro(getDb());
        return res.json({ ok: true, ...cadastro });
    } catch (e) {
        console.error('[cadastro-central]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/empresas/:cnpj', autorizar, async (req, res) => {
    try {
        const cnpj = soDigitos(req.params.cnpj);
        if (cnpj.length !== 14) {
            return res.status(400).json({ ok: false, error: 'Informe o CNPJ com 14 dígitos.' });
        }
        const { empresas } = await lerCadastro(getDb());
        // A busca compara SEMPRE por dígitos — foi consultar por igualdade que
        // produziu "CNPJ não cadastrado" para empresa cadastrada (07/08).
        const empresa = acharEmpresaPorCnpj(empresas, cnpj);
        if (!empresa) {
            return res.status(404).json({
                ok: false,
                error: `O CNPJ ${cnpj} não foi encontrado no cadastro do CFI. Confira o número; se estiver `
                    + 'certo, a empresa precisa ser cadastrada.',
            });
        }
        return res.json({
            ok: true,
            empresa,
            // As filiais da raiz vão junto: o SN-Entregar exige TODOS os
            // estabelecimentos, e o R-4020/R-2055 declaram por estabelecimento.
            // Quem consome não deveria ter que descobrir isso sozinho.
            filiais: filiaisDaRaiz(empresas, cnpj),
        });
    } catch (e) {
        console.error('[cadastro-central/cnpj]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── FASE 2: quem responde por cada cliente ──────────────────────────────────
// A fase 1 responde "este CNPJ existe?". Esta responde a pergunta seguinte —
// "e quem eu procuro?" —, que hoje sai por WhatsApp, de memória. Vale a regra
// de 05/08: envio sai da caixa de QUEM CUIDA da carteira, e o app irmão não
// tinha como saber quem é.

async function lerResponsaveis(db) {
    const { empresas } = await lerCadastro(db);
    const [vincSnap, userSnap] = await Promise.all([
        fetchAllDocs(db.collection('carteiras'), { label: 'cadastro-central/carteiras', maxDocs: 5000 }),
        fetchAllDocs(db.collection('users'), { label: 'cadastro-central/users', maxDocs: 2000 }),
    ]);
    return montarResponsaveis({
        empresas,
        vinculos: vincSnap.map((s) => ({ id: s.id, ...(s.data() || {}) })),
        usuarios: userSnap.map((s) => ({ uid: s.id, ...(s.data() || {}) })),
    });
}

router.get('/responsaveis', autorizar, async (req, res) => {
    try {
        return res.json({ ok: true, ...(await lerResponsaveis(getDb())) });
    } catch (e) {
        console.error('[cadastro-central/responsaveis]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/responsaveis/:cnpj', autorizar, async (req, res) => {
    try {
        const cnpj = soDigitos(req.params.cnpj);
        if (cnpj.length !== 14) {
            return res.status(400).json({ ok: false, error: 'Informe o CNPJ com 14 dígitos.' });
        }
        const { linhas, avisos } = await lerResponsaveis(getDb());
        const linha = responsavelDoCnpj(linhas, cnpj);
        if (!linha) {
            return res.status(404).json({
                ok: false,
                error: `O CNPJ ${cnpj} não foi encontrado no cadastro do CFI. Confira o número; se estiver `
                    + 'certo, a empresa precisa ser cadastrada.',
            });
        }
        // Empresa cadastrada e SEM responsável responde 200, não 404: ela
        // existe, o que falta é atribuição. 404 aqui mandaria o outro lado
        // procurar cadastro que está certo (o erro de hoje de manhã).
        return res.json({ ok: true, ...linha, avisos });
    } catch (e) {
        console.error('[cadastro-central/responsaveis/cnpj]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── FASE 3: "dá pra transmitir?" ────────────────────────────────────────────
// Metadado de certificado, NUNCA a chave. O outro app precisa saber se o CNPJ
// está apto a assinar hoje e até quando — e nada disso exige mover o A1.
//
// A leitura pega os campos sigilosos do Firestore porque é assim que o doc é;
// quem os deixa para trás é `metadadoDoCertificado`, no módulo puro. O teste
// tranca que nenhum caminho da resposta os carrega.

async function lerCertificados(db) {
    const snaps = await fetchAllDocs(db.collection('empresas_certificados'), {
        label: 'cadastro-central/certificados', maxDocs: 5000,
    });
    return snaps.map((s) => ({ empresaId: s.id, ...(s.data() || {}) }));
}

router.get('/certificados', autorizar, async (req, res) => {
    try {
        const db = getDb();
        const [{ empresas }, certificados] = await Promise.all([lerCadastro(db), lerCertificados(db)]);
        return res.json({ ok: true, ...montarCertificados({ empresas, certificados }) });
    } catch (e) {
        console.error('[cadastro-central/certificados]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/certificados/:cnpj', autorizar, async (req, res) => {
    try {
        const cnpj = soDigitos(req.params.cnpj);
        if (cnpj.length !== 14) {
            return res.status(400).json({ ok: false, error: 'Informe o CNPJ com 14 dígitos.' });
        }
        const db = getDb();
        const [{ empresas }, certificados] = await Promise.all([lerCadastro(db), lerCertificados(db)]);
        const empresa = acharEmpresaPorCnpj(empresas, cnpj);
        if (!empresa) {
            return res.status(404).json({
                ok: false,
                error: `O CNPJ ${cnpj} não foi encontrado no cadastro do CFI. Confira o número; se estiver `
                    + 'certo, a empresa precisa ser cadastrada.',
            });
        }
        // Empresa cadastrada e SEM certificado responde 200 com o motivo, não
        // 404: ela existe, e "sem certificado" é a resposta, não a ausência dela.
        return res.json({
            ok: true,
            empresa: { cnpj: empresa.cnpj, nome: empresa.nome, regime: empresa.regime },
            ...aptidaoDeAssinatura({ cnpj, certificados }),
        });
    } catch (e) {
        console.error('[cadastro-central/certificados/cnpj]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── FECHAMENTOS DA COMPETÊNCIA (fase 5, 26/08) ──────────────────────────────
//
// Paulo: *"o departamento contábil, através do CCI, deve fazer a importação
// com a mesma exatidão dos valores apurados e o mês fechado"*.
//
// ⚠️ O QUE ATRAVESSA É O CARIMBO, NUNCA A FICHA. A ficha é um registro VIVO —
// servi-la aqui faria o Contábil puxar um valor que pode mudar depois, e a
// divergência voltaria pela porta de trás, calada.
//
// ⚠️ E O CCI NÃO RECALCULA: a `ressalva` vai em toda linha entregue. É a régua
// já provada no R-2055 — dois números para o mesmo fato é o pior defeito de um
// arquivo fiscal.

/** A competência da consulta — sem ela não há o que responder. */
function competenciaDaQuery(req) {
    return normalizarCompetencia(req.query.competencia);
}

router.get('/fechamentos', autorizar, async (req, res) => {
    try {
        const competencia = competenciaDaQuery(req);
        if (!competencia) {
            return res.status(400).json({
                ok: false,
                error: 'Informe a competência (?competencia=AAAA-MM). Sem ela não dá para dizer QUAL '
                    + 'mês foi fechado — e importar o mês errado não volta atrás.',
            });
        }
        const db = getDb();
        const { empresas } = await lerCadastro(db);
        // 🚨 UMA query para os carimbos da competência inteira. O laço que
        // estava aqui fazia ~420 leituras por chamada — a MESMA classe que
        // produziu o HTTP 429 na Rotina do Mês (27/08), e aqui num túnel que
        // outro app chama.
        const carimbos = await lerFechamentosDaCompetencia(db, competencia);
        const linhas = empresas.map((empresa) => linhaDoFechamento({
            empresa, competencia, fechamento: carimbos.get(String(empresa.id)) || null,
        }));
        return res.json({ ok: true, competencia, resumo: resumirFechamentos(linhas), fechamentos: linhas });
    } catch (e) {
        console.error('[cadastro-central/fechamentos]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/fechamentos/:cnpj', autorizar, async (req, res) => {
    try {
        const cnpj = soDigitos(req.params.cnpj);
        if (cnpj.length !== 14) {
            return res.status(400).json({ ok: false, error: 'Informe o CNPJ com 14 dígitos.' });
        }
        const competencia = competenciaDaQuery(req);
        if (!competencia) {
            return res.status(400).json({ ok: false, error: 'Informe a competência (?competencia=AAAA-MM).' });
        }
        const db = getDb();
        const { empresas } = await lerCadastro(db);
        const empresa = acharEmpresaPorCnpj(empresas, cnpj);
        if (!empresa) {
            return res.status(404).json({
                ok: false,
                error: `O CNPJ ${cnpj} não foi encontrado no cadastro do CFI. Confira o número; se estiver `
                    + 'certo, a empresa precisa ser cadastrada.',
            });
        }
        // Empresa cadastrada e com a competência ABERTA responde 200 com o
        // motivo, não 404: ela existe, e "ainda não fechou" é a resposta, não a
        // ausência dela — é o mesmo desenho do certificado.
        const fechamento = await lerFechamentoDaCompetencia(db, empresa.id, competencia);
        return res.json({ ok: true, ...linhaDoFechamento({ empresa, competencia, fechamento }) });
    } catch (e) {
        console.error('[cadastro-central/fechamentos/cnpj]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── USUÁRIOS E DEPARTAMENTOS (o gate do SaaS, 08/08) ────────────────────────
// O departamento diz qual MÓDULO a pessoa abre (Fiscal, Contábil, DP/Folha,
// Legalização, Financeiro). Grava-se SÓ aqui, por admin; o túnel responde
// consultas — app irmão pergunta, não define.

async function lerUsuarios(db) {
    const snaps = await fetchAllDocs(db.collection('users'), {
        label: 'cadastro-central/users-departamentos', maxDocs: 2000,
    });
    return snaps.map((s) => ({ uid: s.id, ...(s.data() || {}) }));
}

router.get('/usuarios', autorizar, async (req, res) => {
    try {
        return res.json({ ok: true, ...montarUsuariosCadastro(await lerUsuarios(getDb())) });
    } catch (e) {
        console.error('[cadastro-central/usuarios]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// A pergunta do login do app irmão: "este e-mail abre o meu módulo?".
// `?modulo=` é obrigatório aqui — sem ele a resposta não teria pergunta.
router.get('/usuarios/:email', autorizar, async (req, res) => {
    try {
        const email = String(req.params.email || '').trim().toLowerCase();
        if (!email.includes('@')) {
            return res.status(400).json({ ok: false, error: 'Informe o e-mail do usuário.' });
        }
        const modulo = String(req.query.modulo || '').trim().toLowerCase();
        if (!modulo) {
            return res.status(400).json({
                ok: false,
                error: 'Informe ?modulo= (fiscal, contabil, dp-folha, legalizacao ou financeiro) — '
                    + 'a resposta é sobre um módulo, não sobre o usuário no vazio.',
            });
        }
        const docs = await lerUsuarios(getDb());
        const usuario = docs.map(normalizarUsuarioCadastro).filter(Boolean)
            .find((u) => u.email === email) || null;
        const acesso = acessoAoModulo(usuario, modulo);
        // Veredito de HORÁRIO junto (Paulo, 10/08): o app irmão faz UMA
        // pergunta no login e recebe as DUAS travas — departamento e horário —
        // aplicando a régua idêntica à do CFI. Só bloqueia se a chave estiver
        // armada (env); desarmada, `horario.permitido` é sempre true.
        const horario = decidirAcessoHorario(usuario, { ativo: travaArmada() });
        // Usuário sem cadastro responde 200 com temAcesso:false e o motivo —
        // 404 aqui viraria "erro de sistema" na tela do outro app, e a causa
        // (conta não criada) é informação, não falha.
        return res.json({ ok: true, usuario, modulo, ...acesso, horario });
    } catch (e) {
        console.error('[cadastro-central/usuarios/email]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// GRAVAÇÃO: só admin do CFI, NUNCA o túnel. Deixar app irmão gravar seria
// auto-concessão com uma máquina no meio.
router.post('/usuarios/:uid/departamentos', requireAdmin, async (req, res) => {
    try {
        const uid = String(req.params.uid || '').trim();
        if (!uid) return res.status(400).json({ ok: false, error: 'Informe o uid do usuário.' });

        const v = validarDepartamentos(req.body?.departamentos);
        // Desconhecido é RECUSA, não descarte em silêncio (lição da #382).
        if (!v.ok) return res.status(400).json({ ok: false, error: v.erro });

        const db = getDb();
        const ref = db.collection('users').doc(uid);
        const snap = await ref.get();
        if (!snap.exists) {
            return res.status(404).json({ ok: false, error: `Usuário ${uid} não existe no cadastro.` });
        }
        const antes = snap.data()?.departamentos || [];
        await ref.set({ departamentos: v.departamentos }, { merge: true });
        // Departamento é o gate dos MÓDULOS do SaaS — mudança de poder deixa
        // rastro (a trilha que o relatório do dono lê).
        await registrarMudancaPermissao({
            alvoUid: uid, alvoEmail: snap.data()?.email || null,
            campo: 'departamentos', de: antes, para: v.departamentos, por: req.user?.email || null,
        });
        console.log(`[cadastro-central] departamentos de ${uid} → [${v.departamentos.join(', ')}] por ${req.user?.email}`);
        return res.json({ ok: true, uid, departamentos: v.departamentos });
    } catch (e) {
        console.error('[cadastro-central/departamentos]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Exceção de HORÁRIO por colaborador (Paulo, 10/08). SÓ admin (o irmão nunca
// grava — auto-concessão com máquina no meio). null limpa (volta ao padrão).
router.post('/usuarios/:uid/horario', requireAdmin, async (req, res) => {
    try {
        const uid = String(req.params.uid || '').trim();
        if (!uid) return res.status(400).json({ ok: false, error: 'Informe o uid do usuário.' });
        const v = validarHorarioAcesso(req.body?.horarioAcesso);
        if (!v.ok) return res.status(400).json({ ok: false, error: v.erro });
        const db = getDb();
        const ref = db.collection('users').doc(uid);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: `Usuário ${uid} não existe no cadastro.` });
        // null = apaga o campo (volta ao padrão); objeto = grava a exceção.
        await ref.set({ horarioAcesso: v.horario }, { merge: true });
        console.log(`[cadastro-central] horário de ${uid} → ${JSON.stringify(v.horario)} por ${req.user?.email}`);
        return res.json({ ok: true, uid, horarioAcesso: v.horario });
    } catch (e) {
        console.error('[cadastro-central/horario]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
