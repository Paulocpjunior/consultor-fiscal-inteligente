import admin from 'firebase-admin';
import { podeAcessarEmpresaId } from './carteira-auth.js';

/** Bind the supplied tax identity to a stored company before any side effect. */
export async function requireEmpresaEmissao(req, res, next) {
    try {
        const { empresaId, empresaCnpj } = req.body || {};
        if (typeof empresaId !== 'string' || !empresaId || empresaId.includes('/')) {
            return res.status(400).json({ error: 'Empresa obrigatória.' });
        }
        const acesso = await podeAcessarEmpresaId(req.user, empresaId);
        if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error });
        const cnpj = String(empresaCnpj || '').replace(/\D/g, '');
        if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido.' });
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
        const db = admin.firestore();
        for (const colecao of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(colecao).doc(empresaId).get();
            if (!snap.exists) continue;
            const empresa = snap.data() || {};
            if (String(empresa.cnpj || '').replace(/\D/g, '') !== cnpj) {
                return res.status(400).json({ error: 'O CNPJ informado não corresponde à empresa selecionada.' });
            }
            req.body.empresaCnpj = cnpj;
            return next();
        }
        return res.status(404).json({ error: 'Empresa não encontrada no cadastro.' });
    } catch (err) {
        console.error('[emissao/empresa]', err.message);
        return res.status(503).json({ error: 'Não foi possível validar o acesso à empresa. Nenhuma emissão foi iniciada.' });
    }
}
