// ============================================================================
// sefaz-backend/sped-bloco0-cadastros.js  (PURO — testável)
// ----------------------------------------------------------------------------
// OS CADASTROS QUE OS DOIS ARQUIVOS COMPARTILHAM — 0150 (participante) e 0190
// (unidade de medida).
//
// ═══ POR QUE ELES SAÍRAM DE DENTRO DE CADA FAMÍLIA ══════════════════════════
//
// O bloco 0 do EFD ICMS/IPI e o do EFD-Contribuições são diferentes de verdade
// no 0000 (um tem COD_VER e IND_PERFIL, o outro TIPO_ESCRIT e IND_NAT_PJ) — e
// por isso continuam separados. Mas o **0150 e o 0190 têm o MESMO leiaute nos
// dois**, e estavam escritos duas vezes, byte a byte.
//
// 🚨 E A CÓPIA JÁ TINHA CUSTADO: em 18/08 o PVA recusou **30 participantes sem
// COD_MUN** (MANTOAN 0040), e a denúncia — *"o app tem que cobrar ANTES"* —
// entrou **só no EFD-Contribuições**. O 0150 do EFD ICMS/IPI é o MESMO
// registro, com a MESMA obrigatoriedade, e ficava mudo: a próxima empresa
// gastaria a volta do PVA de novo, com outro CNPJ.
//
// É a régua de 21/08: **trava nasce onde roda para TODOS os arquivos daquela
// família** — senão protege o cliente que já quebrou e deixa o próximo
// descoberto. E a de 20/08: recusa aprendida entra na prevalidação no MESMO
// PR, não em metade dela.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';

/**
 * 0150 — Tabela de Cadastro do Participante.
 *
 * Leiaute idêntico nas duas famílias. `COD_PART` é a chave que C100, A100,
 * D100 e E010 referenciam — quem a monta é `participanteDoDocumento`, e o
 * coletor do 0150 usa o MESMO dono (senão o documento aponta para um
 * participante que a Tabela não tem).
 *
 * ⚠️ IE só existe para PJ: com CPF preenchido o campo sai VAZIO.
 */
export function build0150(p) {
    const cnpjStr = fmt.sanitizeCnpjCpf(p.cnpj || '');
    const cpfStr = fmt.sanitizeCnpjCpf(p.cpf || '');
    const ieStr = cpfStr ? '' : fmt.sanitizeString(p.ie || '', 14);
    return fmt.buildLine([
        '0150',
        fmt.sanitizeString(p.codPart, 60),
        fmt.sanitizeString(p.nome, 100),
        '1058',  // Brasil
        cnpjStr,
        cpfStr,
        ieStr,
        fmt.sanitizeString(p.codMunIBGE || '', 7),
        '',  // SUFRAMA
        fmt.sanitizeString(p.logradouro || '', 60),
        fmt.sanitizeString(p.numero || '', 10),
        fmt.sanitizeString(p.complemento || '', 60),
        fmt.sanitizeString(p.bairro || '', 60),
    ]);
}

/** 0190 — Identificação das Unidades de Medida. Idêntico nas duas famílias. */
export function build0190(u) {
    return fmt.buildLine([
        '0190',
        fmt.sanitizeString(u.codigo, 6),
        fmt.sanitizeString(u.descricao || u.codigo, 100),
    ]);
}

/**
 * O aviso do COD_MUN faltando — a recusa de 18/08, agora nas DUAS famílias.
 *
 * Paulo, sobre a MANTOAN: *"alguns erros como COD MUN eu arrumava manual
 * mesmo, pq na nota não tinha mesmo"*. A decisão dele fica: **o app NÃO
 * preenche** — inventar município é afirmar o domicílio de terceiro, e o
 * `'9999999'` que a mensagem do PVA sugere significa *"NÃO domiciliado no
 * Brasil"*, o que seria FALSO para um paciente de São Paulo.
 *
 * O que o app faz é DENUNCIAR na geração, com a lista e a contagem, em vez de
 * deixar a descoberta para o PVA depois do upload (regra de 06/08: cadastro
 * faltando é ALERTA, nunca contorno).
 *
 * @returns {string|null} a frase do aviso, ou null quando não há o que dizer.
 */
export function avisoParticipantesSemMunicipio(participantes) {
    const sem = [];
    for (const p of participantes || []) {
        if (!String(p?.codMunIBGE || '').replace(/\D/g, '')) {
            sem.push(String(p?.nome || p?.codPart || '(sem nome)'));
        }
    }
    if (!sem.length) return null;
    return `Bloco 0: ${sem.length} participante(s) sem código de município (COD_MUN) — o PVA `
        + `recusa cada um: ${sem.slice(0, 8).join(', ')}`
        + `${sem.length > 8 ? ` e mais ${sem.length - 8}` : ''}. `
        + 'O app NÃO preenche: inventar município é afirmar o domicílio de terceiro, e o "9999999" '
        + 'que o PVA sugere significa NÃO domiciliado no Brasil. Complete no cadastro do '
        + 'participante ou ajuste no arquivo antes de transmitir.';
}
