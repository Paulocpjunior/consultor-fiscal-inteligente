// ============================================================================
// sefaz-backend/contador-escrituracao.js  (PURO — testável)
//
// O CONTABILISTA do registro 0100 — num lugar só, para os DOIS SPEDs.
//
// ═══ POR QUE VIROU DONO (20/08, PWR 1364) ═══════════════════════════════════
//
// O PVA recusou o EFD ICMS/IPI da PWR em 19/08 com *"Campo obrigatório · 13 -
// EMAIL"* e *"14 - COD_MUN"*: o 0100 saía com os dois em branco. Corrigi no
// orquestrador do **Fiscal** — e o do **EFD-Contribuições** tinha a SEGUNDA
// CÓPIA da mesma função, que ficou como estava: sem o e-mail padrão e **sem o
// campo `codMunIBGE` sequer existir**.
//
// Resultado: o arquivo do EFD-Contribuições da PWR (20/08) saiu com
// `|0100|Paulo Cesar Pereira Junior|26819016859|1SP238285/O-5|||||||||||` —
// tudo depois do CRC vazio. É a mesma recusa esperando do outro lado, no
// arquivo que o cliente ia transmitir em seguida.
//
// ⚠️ **Nenhum teste pegava**: cada orquestrador fazia exatamente o que o
// próprio código dizia, e os dois "funcionavam". É a família do IPI que foi
// parar em E200/E210 e do Bloco H zerado — defeito que só aparece na leitura
// humana do arquivo, ou na recusa.
//
// ═══ DE ONDE VÊM OS PADRÕES, E POR QUE ELES NÃO SÃO CHUTE ═══════════════════
//
// Do 0100 do EFD do e-Fiscal **ACEITO** do próprio escritório (HS PROJETOS
// 05/2026, assinado): `spcontabil@spassessoriacontabil.com.br` e COD_MUN
// **3550308** (São Paulo capital, onde o escritório fica). É dado do
// ESCRITÓRIO, não do cliente — o mesmo que a Receita já aceitou.
//
// O env continua VENCENDO, para o dia em que o contabilista mudar.
// ============================================================================

// O DV do CPF tem dono — conferir o dígito aqui seria a segunda cópia.
import { validarCpf } from './documento-dv.js';

/** E-mail e município do escritório, como no 0100 já aceito pela Receita. */
export const CONTADOR_EMAIL_PADRAO = 'spcontabil@spassessoriacontabil.com.br';
export const CONTADOR_COD_MUN_PADRAO = '3550308';

/**
 * Os dados do contabilista do 0100 — a MESMA fonte para o EFD ICMS/IPI e para
 * o EFD-Contribuições. Dois arquivos do mesmo mês declarando contabilistas
 * diferentes é divergência que ninguém vai procurar.
 *
 * @returns {{nome:string, cpf:string, cnpj:string, crc:string, endereco:string,
 *   bairro:string, cidade:string, uf:string, cep:string, telefone:string,
 *   email:string, codMunIBGE:string}}
 */
export function getContadorPadrao() {
    return {
        nome: process.env.CONTADOR_NOME || '',
        cpf: process.env.CONTADOR_CPF || '',
        cnpj: process.env.CONTADOR_CNPJ || '',
        crc: process.env.CONTADOR_CRC || '',
        endereco: process.env.CONTADOR_ENDERECO || '',
        bairro: process.env.CONTADOR_BAIRRO || '',
        cidade: process.env.CONTADOR_CIDADE || '',
        uf: process.env.CONTADOR_UF || '',
        cep: process.env.CONTADOR_CEP || '',
        telefone: process.env.CONTADOR_TELEFONE || '',
        email: process.env.CONTADOR_EMAIL || CONTADOR_EMAIL_PADRAO,
        codMunIBGE: process.env.CONTADOR_COD_MUN || CONTADOR_COD_MUN_PADRAO,
    };
}

/**
 * O contabilista está completo para o 0100?
 *
 * 📖 Guia Prático da EFD-Contribuições 1.35, registro 0100: **NOME (campo 02),
 * CPF (03) e CRC (04) são Obrig. `S`**, e o campo 03 traz a validação literal
 * *"será conferido o dígito verificador (DV) do CPF informado"*.
 *
 * 🚨 **POR QUE ISTO NASCEU (29/08)**: os dois geradores tinham DEFAULT
 * INVENTADO nesses campos — `'CONTADOR SP CONTABIL'` e `'1SP123456/O-7'`. Sem
 * a env, o arquivo declarava ao fisco um contabilista que não existe, com um
 * CRC que não é de ninguém — e o PVA **aceita**, porque a forma está certa. É
 * a família do `1405`, do `PARTSEM` e do `5352`: dado fabricado que só aparece
 * na fiscalização.
 *
 * ⚠️ **EMAIL e COD_MUN ficam de FORA desta conferência, de propósito.** No
 * EFD-Contribuições eles são **Obrig. `N`** (o Guia é explícito), e no EFD
 * ICMS/IPI o PVA os recusou como obrigatórios (PWR 19/08) — quem cobra lá é a
 * R13, que é da família certa. Cobrar aqui produziria alarme falso sobre
 * arquivo correto, que é o jeito conhecido de a equipe desligar a trava.
 *
 * @returns {{completo: boolean, faltando: string[], cpfInvalido: boolean, aviso: string|null}}
 */
export function conferirContador(c) {
    const faltando = [];
    if (!String(c?.nome || '').trim()) faltando.push('CONTADOR_NOME');
    if (!String(c?.cpf || '').trim()) faltando.push('CONTADOR_CPF');
    if (!String(c?.crc || '').trim()) faltando.push('CONTADOR_CRC');

    // O DV é FATO sobre o número — vale em qualquer família de arquivo.
    const cpfInvalido = !!String(c?.cpf || '').trim() && !validarCpf(String(c.cpf));

    if (!faltando.length && !cpfInvalido) return { completo: true, faltando: [], cpfInvalido: false, aviso: null };

    const partes = [];
    if (faltando.length) {
        partes.push(
            `Registro 0100 (contabilista) incompleto: ${faltando.join(', ')} sem valor. `
            + 'Os campos NOME, CPF e CRC são OBRIGATÓRIOS e o app não os inventa mais — eles saem VAZIOS '
            + 'e o PVA vai recusar. Preencha as variáveis de ambiente no Cloud Run.',
        );
    }
    if (cpfInvalido) {
        partes.push(
            'Registro 0100: o CPF do contabilista não passa no dígito verificador — o PVA confere o DV '
            + '(Guia 1.35, 0100 campo 03). Confira a env CONTADOR_CPF.',
        );
    }
    return { completo: false, faltando, cpfInvalido, aviso: partes.join(' ') };
}
