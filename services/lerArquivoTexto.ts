/**
 * services/lerArquivoTexto.ts — lê um arquivo de texto respeitando o encoding
 * que ele TEM, não o que o navegador supõe.
 *
 * `file.text()` decodifica SEMPRE como UTF-8. O SPED que sai do PVA (e o que a
 * equipe recebe do e-Fiscal) é Latin-1/Windows-1252: cada acento virava `�`
 * na razão social, na descrição do item e no nome do participante — e o
 * arquivo "conferido" na tela já não era o arquivo entregue. Cinco telas
 * faziam `file.text()` cada uma do seu jeito; a decisão mora AQUI, e é a
 * mesma do `decodificarXml` do importador em lote: decodifica como UTF-8 e,
 * se o resultado carrega o caractere de substituição (bytes que não são UTF-8
 * válido), o arquivo é Latin-1 e é relido assim.
 */

const SUBSTITUICAO = '�';

/** Decide pelo CONTEÚDO: UTF-8 válido fica; byte fora do UTF-8 ⇒ Latin-1. */
export function decodificarLatin1OuUtf8(bytes: Uint8Array): string {
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    if (!utf8.includes(SUBSTITUICAO)) return utf8;
    try { return new TextDecoder('latin1').decode(bytes); } catch { return utf8; }
}

/** `file.text()` que não estraga acento de arquivo Latin-1 (PVA, e-Fiscal). */
export async function lerTextoLatin1OuUtf8(file: Blob): Promise<string> {
    const buffer = await file.arrayBuffer();
    return decodificarLatin1OuUtf8(new Uint8Array(buffer));
}
