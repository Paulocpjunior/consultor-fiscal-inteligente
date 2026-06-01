// ============================================================================
// sefaz-backend/carteira-auth.js  (ESM)
//
// Multi-tenancy: garante que colaborador so acesse dados das empresas da sua
// carteira. Admin enxerga tudo. Helpers para usar em rotas /api/admin/*.
//
// Modelo do doc em `carteiras` (Firestore):
//   { colaboradorUid, colaboradorNome?, empresaId, empresaCnpj, papel }
//
// Padrao de uso em rota:
//
//   import { podeAcessarCnpj } from './carteira-auth.js';
//   router.post('/x', requireAuth, async (req, res) => {
//     const check = await podeAcessarCnpj(req.user, req.body.empresaCnpj);
//     if (!check.ok) return res.status(check.status).json({ error: check.error });
//     // ...
//   });
// ============================================================================

import admin from 'firebase-admin';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Lista os CNPJs (so digitos) que o user tem direito de acessar.
 * @returns {Promise<string[] | null>} null = admin (sem restricao); [] = sem carteira.
 */
export async function getCnpjsDaCarteira(user) {
    if (!user || user.role === 'admin') return null;
    const snap = await fa().firestore()
        .collection('carteiras')
        .where('colaboradorUid', '==', user.uid)
        .get();
    return snap.docs
        .map(d => (d.data().empresaCnpj || '').replace(/\D/g, ''))
        .filter(Boolean);
}

/**
 * Lista os empresaIds que o user tem direito de acessar.
 * @returns {Promise<string[] | null>} null = admin (sem restricao); [] = sem carteira.
 */
export async function getEmpresaIdsDaCarteira(user) {
    if (!user || user.role === 'admin') return null;
    const snap = await fa().firestore()
        .collection('carteiras')
        .where('colaboradorUid', '==', user.uid)
        .get();
    return snap.docs.map(d => d.data().empresaId || '').filter(Boolean);
}

/**
 * Checa se user pode acessar dados desse CNPJ.
 * @returns {Promise<{ok: true} | {ok: false, error: string, status: number}>}
 */
export async function podeAcessarCnpj(user, cnpj) {
    if (!user) return { ok: false, error: 'Nao autenticado', status: 401 };
    if (user.role === 'admin') return { ok: true };
    const cnpjLimpo = (cnpj || '').toString().replace(/\D/g, '');
    if (!cnpjLimpo) return { ok: false, error: 'CNPJ obrigatorio', status: 400 };
    const cnpjs = await getCnpjsDaCarteira(user);
    if (cnpjs && cnpjs.includes(cnpjLimpo)) return { ok: true };
    return { ok: false, error: 'Empresa nao pertence a sua carteira', status: 403 };
}

/**
 * Idem por empresaId.
 */
export async function podeAcessarEmpresaId(user, empresaId) {
    if (!user) return { ok: false, error: 'Nao autenticado', status: 401 };
    if (user.role === 'admin') return { ok: true };
    if (!empresaId) return { ok: false, error: 'empresaId obrigatorio', status: 400 };
    const ids = await getEmpresaIdsDaCarteira(user);
    if (ids && ids.includes(empresaId)) return { ok: true };
    return { ok: false, error: 'Empresa nao pertence a sua carteira', status: 403 };
}
