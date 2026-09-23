// ============================================================================
// sefaz-backend/chave-nfse-nacional.js  (PURO)
// ----------------------------------------------------------------------------
// A CHAVE DE 50 DÍGITOS DO PADRÃO NACIONAL — o que ela responde sozinha.
//
// 📌 A chave carrega o PRESTADOR e o NÚMERO. O leiaute, **MEDIDO em 24 chaves
// reais** (CSV do portal de Barueri, 07/2026, notas 39 a 62):
//
//   cMun (7) · ambiente (1) · tipo de inscrição (1) · inscrição federal (14)
//   · **número da NFS-e (13)** · AAMM da emissão (4) · código (10)   = 50
//
// A inscrição é de quem EMITIU a nota. É a mesma leitura que o
// `nfse-nacional-leitura.js` faz do XML, e a mesma disciplina do CT-e da A
// CASTELLANO: **antes de pedir o dado ao dono, perguntar se o app não o tem**.
//
// 🐛 E O NÚMERO ESTAVA ERRADO DESDE 08/09 — a régua nasceu com `número (15)`,
// que era DEDUÇÃO minha, e devolvia `3926` para a nota **39**: os dois dígitos
// seguintes são o ANO da emissão. As 24 chaves do arquivo real fecham em 13,
// **24 de 24**. Ninguém tinha pago por isso porque o único consumidor até
// hoje (`completarParticipantesDaNfsePdf`) lê só a `inscricaoEmitente` — o
// número passa a valer agora, no importador de Barueri, onde ele é a
// IDENTIDADE do documento. Medição vence dedução, como sempre nesta casa.
//
// 🏠 POR QUE ELA MUDOU DE CASA (10/09): nasceu em `services/
// nfsePdfChaveNacional.ts` para o importador de PDF (08/09) e agora o
// **importador de CSV do portal de Barueri** precisa dela — e ele é backend,
// que não importa TS. Escrever a leitura de novo lá seria a segunda cópia da
// régua que decide **de quem é a nota**; e cópia dessa pergunta já custou o
// caso do CT-e (19/08) e o do ABRASF (31/08). O `.ts` passou a IMPORTAR daqui.
// Mesmo desenho do `ccm-sp.js` (29/08): a régua mora na casa de quem mais lê,
// e quem mais lê passou a ser o backend.
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Lê a chave de 50 dígitos do padrão nacional.
 *
 * ⚠️ Chave de outro tamanho (44 da NF-e, ou nada) devolve **null** — nunca um
 * pedaço de outra chave como CNPJ, que foi exatamente o defeito de 02/09
 * (`\d{14}` casando o começo da chave de 44 e carimbando direção errada).
 *
 * @param {*} chave
 * @returns {{cMun:string, ambiente:string, tpInsc:string,
 *            inscricaoEmitente:string, numero:string}|null}
 */
export function lerChaveNfseNacional(chave) {
    const c = soDigitos(chave);
    // A chave tem 50 dígitos; o nome do arquivo da DANFSe traz 53 (a chave
    // mais um sufixo), e o leitor captura os 50 primeiros. As posições que
    // importam são as 38 primeiras, iguais nas duas formas.
    if (c.length < 50 || c.length > 53) return null;
    const tpInsc = c[8];
    const insc14 = c.slice(9, 23);
    let inscricaoEmitente = '';
    if (tpInsc === '2') inscricaoEmitente = insc14;
    else if (tpInsc === '1') inscricaoEmitente = insc14.slice(-11);
    else return null;
    if (/^0+$/.test(inscricaoEmitente)) return null;
    return {
        cMun: c.slice(0, 7),
        ambiente: c[7],
        tpInsc,
        inscricaoEmitente,
        // ⚠️ 13 dígitos, MEDIDO (ver o topo). Os 15 da versão anterior comiam
        // o `AA` da emissão e devolviam `3926` no lugar de `39`.
        numero: c.slice(23, 36).replace(/^0+/, '') || '0',
    };
}
