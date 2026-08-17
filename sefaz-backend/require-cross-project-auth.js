// ============================================================================
// sefaz-backend/require-cross-project-auth.js
//
// Middleware especial para endpoints de integração cross-project
// (ex: /api/dp-integration/*).
//
// Aceita tokens Firebase de DOIS projetos:
//   - consultorfiscalapp (Fiscal — projeto principal)
//   - consultor-dp-folha (DP Folhapagamentos)
//
// Valida o JWT manualmente contra a chave pública do Google.
// Verifica que o issuer é um dos projetos permitidos e que o email
// termina em @spassessoriacontabil.com.br.
// ============================================================================

import admin from 'firebase-admin';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

const PROJETOS_PERMITIDOS = new Set([
    'consultorfiscalapp',
    'consultor-dp-folha',
    // Consultor Contabil Inteligente (CCI). A integracao usa o token do
    // colaborador logado e expoe somente dados cadastrais minimos por CNPJ.
    'projetos-app-sp',
]);

/**
 * Projetos Firebase dos apps irmãos do escritório.
 *
 * CADA ROTA ESCOLHE O SEU CONJUNTO — não existe lista global. Somar um projeto
 * aqui em cima abriria, de lambuja, TODA rota que já usa o middleware padrão:
 * o /api/dp-integration/* entrega dado SERPRO (FGTS/eSocial/DCTFWeb) de
 * qualquer CNPJ, e ninguém deve ganhar isso por tabela ao integrar outra coisa.
 */
export const PROJETO = {
    fiscal: 'consultorfiscalapp',
    dpFolha: 'consultor-dp-folha',
    // Consultor Contábil / EFD-Reinf (repo plano-contas-iob).
    contabil: 'projetos-app-sp',
    // Consultor Financeiro (sp_dashboard_financeiro, Firebase Hosting).
    financeiro: 'gen-lang-client-0888019226',
};

const DOMINIO_PERMITIDO = '@spassessoriacontabil.com.br';

// Cache das chaves públicas do Google (auto-refresh a cada hora)
let _publicKeysCache = { keys: null, fetchedAt: 0 };
const KEYS_TTL_MS = 60 * 60 * 1000;

async function getGooglePublicKeys() {
    const now = Date.now();
    if (_publicKeysCache.keys && (now - _publicKeysCache.fetchedAt) < KEYS_TTL_MS) {
        return _publicKeysCache.keys;
    }
    const resp = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    if (!resp.ok) throw new Error('Falha ao buscar chaves públicas do Google');
    const keys = await resp.json();
    _publicKeysCache = { keys, fetchedAt: now };
    return keys;
}

function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64').toString('utf-8');
}

async function verificarTokenCrossProject(token, permitidos = PROJETOS_PERMITIDOS) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Token JWT inválido');

    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));

    // Verifica issuer
    const issuer = payload.iss || '';
    let projectId = null;
    for (const p of permitidos) {
        if (issuer === `https://securetoken.google.com/${p}`) {
            projectId = p;
            break;
        }
    }
    if (!projectId) throw new Error(`Issuer não permitido: ${issuer}`);

    // Verifica audience = projectId
    if (payload.aud !== projectId) {
        throw new Error(`Audience inválido: ${payload.aud}`);
    }

    // Verifica expiração
    if (payload.exp * 1000 < Date.now()) {
        throw new Error('Token expirado');
    }

    // Verifica email do domínio
    const email = payload.email || '';
    if (!email.endsWith(DOMINIO_PERMITIDO)) {
        throw new Error(`Email não permitido: ${email}`);
    }

    // EXIGE email verificado. Sem isto, bastava cadastrar um email
    // @dominio-permitido NÃO verificado (que o atacante não controla) em
    // qualquer dos projetos Firebase para obter acesso total aos dados SERPRO
    // (FGTS/eSocial/DCTFWeb) de QUALQUER CNPJ via /api/dp-integration/*.
    if (payload.email_verified !== true) {
        throw new Error(`Email não verificado: ${email}`);
    }

    // Rejeita tokens com iat/nbf no futuro (relógio/forja).
    const agoraSeg = Math.floor(Date.now() / 1000) + 60; // 60s de folga de clock
    if (payload.iat && payload.iat > agoraSeg) throw new Error('Token emitido no futuro (iat)');
    if (payload.nbf && payload.nbf > agoraSeg) throw new Error('Token ainda não válido (nbf)');

    // Verifica assinatura usando crypto + chave pública
    const crypto = await import('crypto');
    const publicKeys = await getGooglePublicKeys();
    const kid = header.kid;
    const publicKey = publicKeys[kid];
    if (!publicKey) throw new Error('Chave pública não encontrada');

    const signedData = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signedData);
    const isValid = verifier.verify(publicKey, signature);
    if (!isValid) throw new Error('Assinatura inválida');

    return {
        uid: payload.sub || payload.user_id,
        email,
        projectId,
        emailVerified: payload.email_verified === true,
    };
}

/**
 * Middleware que aceita tokens de Fiscal OU DP, desde que:
 *   - Issuer seja um dos projetos permitidos
 *   - Email termine em @spassessoriacontabil.com.br
 *   - Assinatura válida do Google
 */
export async function requireCrossProjectAuth(req, res, next) {
    return crossProjectAuth([...PROJETOS_PERMITIDOS])(req, res, next);
}

/**
 * Middleware cross-project com a lista de projetos EXPLÍCITA.
 *
 * Mesmas travas do padrão (assinatura do Google, audience, expiração, domínio
 * do escritório, e-mail VERIFICADO, iat/nbf no futuro) — muda só QUEM entra.
 *
 * @param {string[]} projetos ids de projeto Firebase aceitos (use `PROJETO.*`)
 */
export function crossProjectAuth(projetos) {
    const permitidos = new Set(projetos || []);
    if (!permitidos.size) throw new Error('crossProjectAuth exige ao menos um projeto permitido');
    return async function middleware(req, res, next) {
        try {
            const auth = req.headers.authorization || '';
            const m = auth.match(/^Bearer\s+(.+)$/i);
            if (!m) return res.status(401).json({ error: 'Token ausente' });

            const decoded = await verificarTokenCrossProject(m[1], permitidos);
            req.user = decoded;
            next();
        } catch (e) {
            console.error('[require-cross-project-auth]', e.message);
            return res.status(401).json({ error: 'Token inválido: ' + e.message });
        }
    };
}
