// ============================================================================
// sefaz-backend/cadastro-central-routes.js  (ESM)
// ----------------------------------------------------------------------------
// O TÚNEL DO CADASTRO — o CFI como dono do cadastro dos apps irmãos.
//
//   GET /api/admin/cadastro/empresas
//   GET /api/admin/cadastro/empresas/:cnpj
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
import { montarCadastroEmpresas, soDigitos } from './cadastro-central.js';
import { acharEmpresaPorCnpj, filiaisDaRaiz } from './empresa-por-cnpj.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

// Lista EXPLÍCITA por rota. Pôr projeto na lista global abriria de lambuja o
// /api/dp-integration/*, que entrega dado SERPRO de qualquer CNPJ.
const doIrmao = crossProjectAuth([PROJETO.fiscal, PROJETO.contabil]);

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

export default router;
