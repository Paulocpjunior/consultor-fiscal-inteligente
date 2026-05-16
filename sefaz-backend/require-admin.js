// ============================================================================
// sefaz-backend/require-admin.js
// Middleware de autenticacao ADMIN compartilhado.
//
// Substitui o requireAdmin fraco (baseado no header X-User-Role, falsificavel)
// que existia em dctfweb/das/caixa-postal/nfse-nacional routes.
//
// Valida o ID token do Firebase (Bearer) e exige role 'admin' no Firestore.
// Uma fonte, todos os routers admin consomem.
// ============================================================================

import admin from 'firebase-admin';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Express middleware. Exige:
 *   - header Authorization: Bearer <firebase-id-token> valido
 *   - documento users/{uid} com role === 'admin'
 * Em qualquer falha responde 401/403 e NAO chama next().
 */
export async function requireAdmin(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });

        const decoded = await fa().auth().verifyIdToken(m[1]);
        const userDoc = await fa().firestore()
            .collection('users').doc(decoded.uid).get();
        const role = userDoc.exists ? userDoc.data().role : null;

        if (role !== 'admin') {
            return res.status(403).json({ error: 'Acesso restrito a admin' });
        }
        req.user = { uid: decoded.uid, role, email: decoded.email || null };
        next();
    } catch (e) {
        console.error('[require-admin] erro:', e.message);
        return res.status(401).json({ error: 'Token invalido ou expirado' });
    }
}

/**
* Express middleware. Exige apenas:
*   - header Authorization: Bearer <firebase-id-token> valido
* NAO exige role admin. Use em rotas de leitura liberadas a qualquer
* usuario autenticado (ex.: /resumo da Caixa Postal pro popup geral).
*/
export async function requireAuth(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });

        const decoded = await fa().auth().verifyIdToken(m[1]);
        const userDoc = await fa().firestore()
            .collection('users').doc(decoded.uid).get();
        const role = userDoc.exists ? userDoc.data().role : null;
        req.user = { uid: decoded.uid, role, email: decoded.email || null };
        next();
    } catch (e) {
        console.error('[require-auth] erro:', e.message);
        return res.status(401).json({ error: 'Token invalido ou expirado' });
    }
}

export default requireAdmin;
