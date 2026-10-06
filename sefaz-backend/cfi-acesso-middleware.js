import admin from 'firebase-admin';
import { podeOperarFiscal, exigeOperacaoFiscal, MENSAGEM_SOMENTE_RELATORIOS } from './cfi-acesso.js';
export async function protegerOperacaoFiscal(req, res, next) {
    if (!exigeOperacaoFiscal(req.method, req.originalUrl)) return next();
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
    // Cron, túnel e API keys continuam exigindo a autenticação própria da rota.
    if (!token) return next();
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(token); }
    catch { return res.status(401).json({ error: 'Token inválido ou expirado.' }); }
    try {
        const perfil = await admin.firestore().collection('users').doc(decoded.uid).get();
        if (!podeOperarFiscal(perfil.exists ? perfil.data() : null)) {
            return res.status(403).json({ error: MENSAGEM_SOMENTE_RELATORIOS, code: 'CFI_SOMENTE_RELATORIOS' });
        }
        return next();
    } catch {
        return res.status(503).json({ error: 'Não foi possível conferir a permissão operacional. Tente novamente.' });
    }
}
