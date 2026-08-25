// ============================================================================
// 🔑 "COLABORADOR NÃO CONSEGUE RESETAR A SENHA" (Paulo, 25/08)
//
// Eram DOIS defeitos, e o segundo é o que faz este teste existir:
//  (1) o caminho não existia na tela de login (nem "Esqueci minha senha");
//  (2) o botão do admin **afirmava um ato que não acontecia** —
//      `resetUserPassword` fazia `if (isFirebaseConfigured) return true;`, e a
//      tela imprimia "Senha de X resetada.". Em produção, NADA era feito.
//
// Afirmar sucesso sem executar é o defeito mais caro desta casa, porque manda
// as duas pessoas (quem clicou e quem esperava a senha) procurarem o problema
// no lugar errado. A varredura no fim deste arquivo é o que impede ele de
// voltar num refactor.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import {
    DOMINIO_DA_CASA,
    validarEmailParaRedefinicao,
    mensagemDaRedefinicao,
} from '../services/redefinirSenha';

const raiz = (...p: string[]) => path.join(process.cwd(), ...p);

describe('🔑 quem pode receber o link', () => {
    it('e-mail vazio não vira chamada de rede — a tela diz o que preencher', () => {
        const r = validarEmailParaRedefinicao('   ');
        expect(r?.situacao).toBe('email-vazio');
        expect(r?.acao).toMatch(/E-mail Corporativo/);
    });

    it('e-mail PESSOAL (o engano comum) tem recusa PRÓPRIA — não "não achei conta"', () => {
        // Se caísse em "não existe conta", a pessoa concluiria que perdeu o
        // acesso; a causa é outra e a ação é outra.
        const r = validarEmailParaRedefinicao('fulano@gmail.com');
        expect(r?.situacao).toBe('fora-do-dominio');
        expect(r?.texto).toContain(DOMINIO_DA_CASA);
    });

    it('formato torto é recusado antes da rede, com o formato certo na frase', () => {
        expect(validarEmailParaRedefinicao('fulano')?.situacao).toBe('formato');
        expect(validarEmailParaRedefinicao('fulano@')?.situacao).toBe('formato');
    });

    it('e-mail da casa passa (com espaço e maiúscula, que é como se digita)', () => {
        expect(validarEmailParaRedefinicao(`  Fulano${DOMINIO_DA_CASA.toUpperCase()} `)).toBeNull();
    });
});

describe('🔑 a resposta do Firebase vira frase COM AÇÃO', () => {
    const email = `fulano${DOMINIO_DA_CASA}`;

    it('enviado diz onde procurar — o remetente do Firebase cai no lixo eletrônico', () => {
        const r = mensagemDaRedefinicao('ok', email);
        expect(r.ok).toBe(true);
        expect(r.texto).toContain(email);
        expect(r.acao).toMatch(/lixo eletrônico/i);
    });

    it('conta inexistente aponta o AUTO-CADASTRO, que é a ação de quem nunca entrou', () => {
        const r = mensagemDaRedefinicao('auth/user-not-found', email);
        expect(r.ok).toBe(false);
        expect(r.situacao).toBe('sem-conta');
        expect(r.acao).toMatch(/Primeiro acesso/);
    });

    it('🚨 rede caída é INDETERMINADO — não afirma que o link deixou de sair', () => {
        // O pedido pode ter chegado e a resposta ter se perdido. Dizer "falhou"
        // faz pedir de novo e cair no throttle; dizer "enviado" é mentira. É a
        // mesma régua do indeterminado da emissão de guia.
        const r = mensagemDaRedefinicao('auth/network-request-failed', email);
        expect(r.situacao).toBe('indeterminado');
        expect(r.ok).toBe(false);
        expect(r.texto).not.toMatch(/enviado/i);
        expect(r.acao).toMatch(/Confira o seu e-mail/);
    });

    it('throttle manda ESPERAR, e lembra que o link anterior continua valendo', () => {
        const r = mensagemDaRedefinicao('auth/too-many-requests', email);
        expect(r.situacao).toBe('muitas-tentativas');
        expect(r.acao).toMatch(/continua valendo/);
    });

    it('código desconhecido não some — volta NOMEADO, com o código', () => {
        const r = mensagemDaRedefinicao('auth/coisa-nova', email);
        expect(r.situacao).toBe('falha');
        expect(r.texto).toContain('auth/coisa-nova');
    });

    it('toda situação tem AÇÃO — recusa sem caminho é beco', () => {
        const codigos = ['ok', 'auth/user-not-found', 'auth/invalid-email',
            'auth/too-many-requests', 'auth/network-request-failed', 'auth/qualquer'];
        for (const c of codigos) expect(mensagemDaRedefinicao(c, email).acao).toBeTruthy();
    });
});

describe('🚨 o caminho existe, e ninguém volta a fingir que resetou', () => {
    const login = fs.readFileSync(raiz('components/LoginScreen.tsx'), 'utf8');
    const auth = fs.readFileSync(raiz('services/authService.ts'), 'utf8');
    const usuarios = fs.readFileSync(raiz('components/UserManagementModal.tsx'), 'utf8');

    it('a tela de login TEM o "Esqueci minha senha" e ele chama o serviço', () => {
        expect(login).toContain('Esqueci minha senha');
        expect(login).toContain('authService.enviarLinkDeRedefinicao');
    });

    it('o link some no cadastro — lá ele não tem sentido', () => {
        expect(login).toMatch(/\{!isRegistering && \(\s*<div className="text-right/);
    });

    it('🚨 `resetUserPassword` NÃO pode devolver sucesso sem executar', () => {
        // A linha exata do defeito: `if (isFirebaseConfigured) return true;`
        const corpo = auth.slice(auth.indexOf('export const resetUserPassword'));
        expect(corpo).not.toMatch(/isFirebaseConfigured\)\s*return true/);
        // E ela passou a ser o MESMO caminho do colaborador — dois caminhos
        // para a mesma pergunta divergem no primeiro ajuste.
        expect(corpo.slice(0, 200)).toContain('enviarLinkDeRedefinicao');
    });

    it('🚨 nenhuma senha padrão volta ao código do reset', () => {
        const corpo = auth.slice(auth.indexOf('export const enviarLinkDeRedefinicao'));
        expect(corpo).not.toMatch(/123456/);
        expect(corpo).not.toMatch(/LOCAL_MASTER_PASSWORD/);
        // Modo local RECUSA em vez de devolver ok — era esse `return true` que
        // fazia a tela mentir.
        expect(corpo).toMatch(/modo local/i);
    });

    it('🚨 a tela do admin não promete "123456" nem afirma senha resetada', () => {
        expect(usuarios).not.toMatch(/Resetar senha para 123456/);
        expect(usuarios).not.toMatch(/Senha de \$\{userName\} resetada/);
        expect(usuarios).toContain('handleResetPassword(user.email');
        // E o texto do confirm diz QUEM escolhe a senha, antes do clique.
        expect(usuarios).toMatch(/nem você nem o sistema definem a senha/);
    });

    it('a mensagem do admin sai da RÉGUA, não de texto próprio', () => {
        const corpo = usuarios.slice(usuarios.indexOf('const handleResetPassword'));
        expect(corpo.slice(0, 1400)).toMatch(/r\.acao \? `\$\{r\.texto\} \$\{r\.acao\}` : r\.texto/);
    });
});
