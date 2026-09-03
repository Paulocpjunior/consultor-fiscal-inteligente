/**
 * services/adminMaster.ts — o e-mail do admin MASTER, num lugar só.
 *
 * O literal vivia inline em SEIS arquivos (auth, Simples, Lucro, XML, SPED e
 * o dashboard do Simples). Seis cópias do mesmo fato é a segunda cópia de
 * sempre: trocar o e-mail um dia acertaria cinco e deixaria um, e o sexto
 * continuaria dando poder de admin a uma caixa que já não é a do dono.
 *
 * ⚠️ Constante PLANA de propósito, sem `import.meta.env`: ler uma VITE_* aqui
 * obrigaria a variável a existir no workflow e no Dockerfile (a trava
 * `viteEnvChegaNoBuild` cobra os quatro elos), e o valor não muda por
 * ambiente. `adminMasterEmailUnico.test.ts` barra o literal fora daqui.
 */
export const EMAIL_ADMIN_MASTER = 'junior@spassessoriacontabil.com.br';

/** Compara sem sensibilidade a caixa — o e-mail chega digitado pela pessoa. */
export function ehAdminMaster(email?: string | null): boolean {
    return String(email || '').trim().toLowerCase() === EMAIL_ADMIN_MASTER;
}
