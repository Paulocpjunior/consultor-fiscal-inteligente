// ============================================================================
// services/redefinirSenha.ts — a régua de "esqueci minha senha"
// ----------------------------------------------------------------------------
// Paulo (25/08): *"um ajuste que precisamos definir, colaborador não consegue
// resetar a SENHA, reveja a função"*. Fui ler, e eram DOIS defeitos:
//
// 🔴 (1) O CAMINHO NÃO EXISTIA. A tela de login (a MESMA do CFI e do SP
//    Connect) tinha "Entrar" e "Primeiro acesso? Cadastre-se aqui", e mais
//    nada. Quem esquecia a senha não tinha o que clicar — a única saída era
//    pedir a alguém, e a pessoa a quem se pedia caía no defeito (2).
//
// 🔴 (2) O BOTÃO DO ADMIN MENTIA. `resetUserPassword` fazia
//    `if (isFirebaseConfigured) return true;` — ou seja, **em produção ele não
//    fazia NADA e devolvia sucesso**, e a tela dizia "Senha de X resetada.".
//    O admin clicava, lia a confirmação, mandava a pessoa entrar com a senha
//    nova… e ela não entrava. Afirmar um ato que não aconteceu é pior que não
//    ter o botão: manda os dois procurarem o problema no lugar errado.
//    (O tooltip ainda dizia "Resetar senha para 123456" — senha padrão
//    conhecida no bundle é a mesma classe que este projeto já removeu em
//    `authService`.)
//
// ✂️ O QUE MANDA AQUI: a identidade é do **Firebase Auth**, então quem
// redefine a senha é o DONO da caixa de e-mail, pelo link que o Firebase
// envia. Nem o app nem o admin escolhem a senha de ninguém — e isso não é
// limitação: senha padrão conhecida é porta aberta enquanto ninguém a troca.
//
// 📌 Este módulo é PURO de propósito (nenhum import de firebase): ele decide
// se o e-mail pode receber o link e traduz a resposta do Firebase em frase
// COM AÇÃO. Assim a régua se prova sem rede — o resto é I/O no authService.
// ============================================================================

/** Domínio da casa: conta de login só existe para e-mail corporativo. */
export const DOMINIO_DA_CASA = '@spassessoriacontabil.com.br';

export type SituacaoRedefinicao =
    | 'enviado'            // o Firebase aceitou e mandou o link
    | 'email-vazio'
    | 'formato'            // não parece e-mail
    | 'fora-do-dominio'    // e-mail pessoal não tem conta aqui
    | 'sem-conta'          // domínio certo, conta não existe
    | 'muitas-tentativas'  // throttle do Firebase
    | 'indeterminado'      // rede caiu: pode ter enviado
    | 'falha';

export interface ResultadoRedefinicao {
    ok: boolean;
    situacao: SituacaoRedefinicao;
    texto: string;
    /** O que a pessoa faz agora. `null` só quando não há nada a fazer. */
    acao: string | null;
}

const limpar = (email: string) => String(email || '').trim().toLowerCase();

/**
 * Confere ANTES de gastar a chamada — e principalmente antes de dar uma
 * resposta que confunde. E-mail pessoal digitado por engano é o caso comum,
 * e "não achei conta" ali mandaria a pessoa achar que perdeu o acesso.
 */
export function validarEmailParaRedefinicao(
    email: string,
    dominio = DOMINIO_DA_CASA,
): ResultadoRedefinicao | null {
    const e = limpar(email);
    if (!e) {
        return {
            ok: false, situacao: 'email-vazio',
            texto: 'Digite o seu e-mail antes de pedir o link.',
            acao: 'Preencha o campo E-mail Corporativo acima.',
        };
    }
    // Estreito de propósito: só o que o Firebase também recusaria.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        return {
            ok: false, situacao: 'formato',
            texto: `"${email}" não parece um e-mail.`,
            acao: `Escreva no formato nome${dominio}.`,
        };
    }
    if (!e.endsWith(dominio)) {
        return {
            ok: false, situacao: 'fora-do-dominio',
            texto: `O acesso é só para e-mail ${dominio}.`,
            acao: 'Use o seu e-mail do escritório — o link de redefinição chega nele.',
        };
    }
    return null; // pode seguir
}

/**
 * Traduz a resposta do Firebase. Cada situação tem AÇÃO própria, porque as
 * ações são diferentes: conta que não existe se resolve no cadastro, throttle
 * se resolve esperando, e rede caída não se resolve repetindo às cegas.
 */
export function mensagemDaRedefinicao(
    codigo: string | null | undefined,
    email: string,
): ResultadoRedefinicao {
    const e = limpar(email);
    switch (String(codigo || '')) {
        case '':
        case 'ok':
            return {
                ok: true, situacao: 'enviado',
                texto: `📧 Link de redefinição enviado para ${e}.`,
                // O remetente é do Firebase (noreply@…firebaseapp.com), então
                // ele cai no lixo eletrônico com frequência — dizer isso aqui
                // evita a conclusão errada de que o link não foi mandado.
                acao: 'Abra o link pelo e-mail (confira o lixo eletrônico). Ele vence rápido — cerca de 1 hora —, então use assim que chegar.',
            };
        case 'auth/user-not-found':
            // ⚠️ DECISÃO, não descuido: aqui a mensagem DIZ que não há conta.
            // O risco clássico de enumerar e-mails não se aplica do mesmo jeito
            // num app restrito a UM domínio corporativo (o endereço de qualquer
            // colega já é público na assinatura de e-mail), e a alternativa —
            // "se existir, enviamos" — deixaria quem NUNCA criou conta esperando
            // um link que não vem. Este app tem auto-cadastro, então há ação.
            return {
                ok: false, situacao: 'sem-conta',
                texto: `Não existe conta para ${e}.`,
                acao: 'Se é o seu primeiro acesso, use "Primeiro acesso? Cadastre-se aqui" — o cadastro cria a conta com a senha que você escolher.',
            };
        case 'auth/invalid-email':
            return {
                ok: false, situacao: 'formato',
                texto: `"${email}" não parece um e-mail.`,
                acao: `Escreva no formato nome${DOMINIO_DA_CASA}.`,
            };
        case 'auth/too-many-requests':
            return {
                ok: false, situacao: 'muitas-tentativas',
                texto: 'Muitos pedidos seguidos — o Firebase bloqueou por alguns minutos.',
                acao: 'Espere uns minutos e peça de novo. Se um link já chegou antes, ele continua valendo.',
            };
        case 'auth/network-request-failed':
            // 🚨 Rede caída NÃO é "não enviou": o pedido pode ter chegado e a
            // resposta ter se perdido. Dizer "falhou" faria a pessoa pedir de
            // novo e cair no throttle; dizer "enviado" seria mentira. A mesma
            // régua do `indeterminado` da emissão de guia.
            return {
                ok: false, situacao: 'indeterminado',
                texto: 'A conexão caiu antes da resposta — não dá para afirmar se o link saiu.',
                acao: 'Confira o seu e-mail em um minuto. Se nada chegar, peça de novo.',
            };
        default:
            return {
                ok: false, situacao: 'falha',
                texto: `Não consegui pedir o link (${codigo}).`,
                acao: 'Tente de novo; se repetir, fale com o administrador do sistema.',
            };
    }
}
