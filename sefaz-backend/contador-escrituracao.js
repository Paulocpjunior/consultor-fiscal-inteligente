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
