// ============================================================================
// 📧 Caminho de verificação de e-mail no SP Connect (caso recepcao@, 24/08)
// ----------------------------------------------------------------------------
// O backend recusa token com email_verified !== true ("Token inválido: Email
// não verificado") — trava de SEGURANÇA correta: sem ela, um e-mail do domínio
// registrado em qualquer projeto Firebase alcançaria dado SERPRO pelo túnel.
// O defeito era não existir CAMINHO de verificação em tela nenhuma (conta de
// login por senha nunca verificava). Este teste trava as duas metades:
//  · a TRAVA continua no backend (corrigir o erro afrouxando-a seria abrir a
//    porta que ela fecha);
//  · o CAMINHO existe no Connect, com o refresh forçado do token — sem o
//    getIdToken(true), o token cacheado (~1h) continuaria "não verificado"
//    DEPOIS do clique no link, e a leitura seria "não funcionou" (lição do
//    plano-contas-iob v3.4.88-92).
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';

const lerArquivo = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('trava do backend (não afrouxar)', () => {
    it('require-cross-project-auth continua recusando e-mail não verificado', () => {
        const fonte = lerArquivo('sefaz-backend/require-cross-project-auth.js');
        expect(fonte).toMatch(/email_verified\s*!==\s*true/);
        expect(fonte).toMatch(/Email não verificado/);
    });
});

describe('caminho de verificação no SP Connect', () => {
    const fonte = lerArquivo('components/SpConnect/index.tsx');

    it('importa sendEmailVerification do firebase/auth e o auth da config', () => {
        expect(fonte).toMatch(/import \{ sendEmailVerification \} from 'firebase\/auth'/);
        expect(fonte).toMatch(/import \{ auth \} from '\.\.\/\.\.\/services\/firebaseConfig'/);
    });

    it('o banner só aparece para quem está barrado (emailVerified === false)', () => {
        // Boolean(...currentUser && emailVerified === false): usuário SSO
        // verificado — a maioria — nunca vê o banner.
        expect(fonte).toMatch(/emailVerified === false/);
        expect(fonte).toMatch(/emailNaoVerificado && \(/);
    });

    it('tem os dois botões: enviar o e-mail e confirmar depois do clique', () => {
        expect(fonte).toMatch(/sendEmailVerification\(u\)/);
        expect(fonte).toMatch(/Enviar e-mail de verificação/);
        expect(fonte).toMatch(/Já cliquei no link/);
    });

    it('a confirmação RELÊ o usuário e força token NOVO antes de recarregar', () => {
        // reload() primeiro (o emailVerified local é foto velha), getIdToken(true)
        // depois (verificação só entra em token novo) — nessa ordem.
        const posReload = fonte.indexOf('await u.reload()');
        const posToken = fonte.indexOf('await u.getIdToken(true)');
        expect(posReload).toBeGreaterThan(-1);
        expect(posToken).toBeGreaterThan(posReload);
        expect(fonte).toMatch(/window\.location\.reload\(\)/);
    });

    it('ainda não verificado NÃO recarrega — diz o que falta', () => {
        expect(fonte).toMatch(/Ainda consta como NÃO verificado/);
    });

    it('too-many-requests vira orientação, não erro cru', () => {
        expect(fonte).toMatch(/too-many-requests/);
        expect(fonte).toMatch(/lixo eletrônico/);
    });
});
