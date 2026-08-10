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
import { temPermissaoEmissao, PERM_EMISSAO_TRIBUTOS } from './emissao-permissao.js';
import { decidirAcessoHorario, travaArmada } from './horario-acesso.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * TRAVA DE HORÁRIO (Paulo, 10/08). Chamada depois que req.user existe. Se a
 * chave estiver armada (env HORARIO_ACESSO_ATIVO=bloqueio) e o colaborador
 * estiver fora do horário, RESPONDE 403 e registra a tentativa (prova
 * jurídica) — devolve true (o middleware para aqui). Admin sempre passa.
 * Erro na régua NUNCA bloqueia (fail-open pra não trancar o escritório por bug).
 */
async function barrarForaDoHorario(req, res) {
    try {
        const veredito = decidirAcessoHorario(req.user, { ativo: travaArmada() });
        if (veredito.permitido) return false;
        // Registra o bloqueio SEM travar a resposta se a gravação falhar.
        try {
            await fa().firestore().collection('horario_acesso_bloqueios').add({
                em: admin.firestore.FieldValue.serverTimestamp(),
                uid: req.user?.uid || null,
                email: req.user?.email || null,
                rota: req.originalUrl || req.url || null,
                metodo: req.method || null,
                motivo: veredito.motivo,
                janela: veredito.janela || null,
            });
        } catch (e) { console.warn('[horario-acesso] registro do bloqueio falhou:', e.message); }
        res.status(403).json({ error: veredito.mensagem, foraDoHorario: true, janela: veredito.janela });
        return true;
    } catch (e) {
        // Régua quebrou — libera (não é papel da trava derrubar o acesso por bug).
        console.warn('[horario-acesso] régua falhou, liberando:', e.message);
        return false;
    }
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
            // Mensagem precisa pra UI nao esconder a causa real (mesmo padrao da
            // varredura: "erros mentirosos"). Diferencia:
            //   a) doc users/{uid} nao existe (auto-seed falhou no login)
            //   b) doc existe mas role != 'admin' (rebaixado / nunca promovido)
            // Inclui o uid e o email do token pra operador localizar no console.
            console.warn(
                `[require-admin] 403 — uid=${decoded.uid} email=${decoded.email || '?'} ` +
                `docExists=${userDoc.exists} role=${JSON.stringify(role)}`,
            );
            return res.status(403).json({
                error: 'Acesso restrito a admin',
                motivo: !userDoc.exists
                    ? 'Seu perfil nao foi encontrado em users/{uid} no Firestore. ' +
                      'Faca logout/login pra recriar, ou peca pra um admin criar o doc.'
                    : `Seu role atual e ${JSON.stringify(role)}. ` +
                      'Apenas role=admin pode usar este recurso.',
                uid: decoded.uid,
                email: decoded.email || null,
            });
        }
        req.user = { uid: decoded.uid, role, email: decoded.email || null };
        next();
    } catch (e) {
        console.error('[require-admin] erro:', e.message);
        return res.status(401).json({ error: 'Token invalido ou expirado' });
    }
}

/**
 * Express middleware pra rotas de EMISSAO de tributos (DAS/DARF/Central).
 * Exige:
 *   - header Authorization: Bearer <firebase-id-token> valido
 *   - role 'admin' OU role 'colaborador' com PERM_EMISSAO_TRIBUTOS em
 *     users/{uid}.modulosPermitidos (liberado por admin via Gerenciar
 *     Usuarios — Firestore rules impedem auto-concessao).
 */
export async function requireEmissao(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });

        const decoded = await fa().auth().verifyIdToken(m[1]);
        const userDoc = await fa().firestore()
            .collection('users').doc(decoded.uid).get();
        const dados = userDoc.exists ? userDoc.data() : null;
        const role = dados ? dados.role : null;

        if (!temPermissaoEmissao(role, dados ? dados.modulosPermitidos : null)) {
            console.warn(
                `[require-emissao] 403 — uid=${decoded.uid} email=${decoded.email || '?'} ` +
                `docExists=${userDoc.exists} role=${JSON.stringify(role)}`,
            );
            return res.status(403).json({
                error: 'Sem permissão para emissão de tributos',
                motivo: !userDoc.exists
                    ? 'Seu perfil nao foi encontrado em users/{uid} no Firestore. ' +
                      'Faca logout/login pra recriar, ou peca pra um admin criar o doc.'
                    : `Seu role atual e ${JSON.stringify(role)} sem a permissão ` +
                      `"${PERM_EMISSAO_TRIBUTOS}". Peça a um administrador para ` +
                      'liberá-la em Gerenciar Usuários (ou promovê-lo a admin).',
                uid: decoded.uid,
                email: decoded.email || null,
            });
        }
        req.user = { uid: decoded.uid, role, email: decoded.email || null, horarioAcesso: dados ? dados.horarioAcesso || null : null };
        if (await barrarForaDoHorario(req, res)) return;
        next();
    } catch (e) {
        console.error('[require-emissao] erro:', e.message);
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
        const dados = userDoc.exists ? userDoc.data() : {};
        const role = dados.role || null;
        req.user = { uid: decoded.uid, role, email: decoded.email || null, horarioAcesso: dados.horarioAcesso || null };
        if (await barrarForaDoHorario(req, res)) return;
        next();
    } catch (e) {
        console.error('[require-auth] erro:', e.message);
        return res.status(401).json({ error: 'Token invalido ou expirado' });
    }
}

export default requireAdmin;
