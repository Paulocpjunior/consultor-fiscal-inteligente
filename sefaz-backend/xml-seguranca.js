/**
 * xml-seguranca — validador anti-XXE / billion-laughs para XML antes do parse.
 *
 * @xmldom/xmldom 0.8.x nao resolve external entities, mas aceita DOCTYPE com
 * <!ENTITY> internas. Isso permite "billion laughs":
 *
 *   <!DOCTYPE lolz [
 *     <!ENTITY lol "lol">
 *     <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 *     ...]>
 *   <root>&lol9;</root>
 *
 * Expansao exponencial estoura memoria/CPU. Como NENHUM XML legitimo da SEFAZ,
 * NFSe ou EFD-Reinf usa DOCTYPE inline, rejeitamos qualquer um.
 *
 * Tambem aplicamos teto duro de tamanho (10MB default) - XMLs SEFAZ usuais
 * tem 5-50KB; um XML > 10MB ja eh indicativo de tentativa de DoS.
 */

const TAMANHO_MAX_DEFAULT = 10 * 1024 * 1024; // 10 MB

export class XmlInseguroError extends Error {
    constructor(motivo) {
        super(`XML rejeitado: ${motivo}`);
        this.name = 'XmlInseguroError';
        this.motivo = motivo;
    }
}

/**
 * Valida o conteudo de um XML como string ANTES de passar pro DOMParser.
 * Lanca XmlInseguroError se inseguro. Devolve o proprio string se OK.
 */
export function validarXmlSeguro(xml, opts = {}) {
    const limite = opts.tamanhoMax || TAMANHO_MAX_DEFAULT;
    if (typeof xml !== 'string') throw new XmlInseguroError('conteudo nao eh string');
    if (xml.length > limite) {
        throw new XmlInseguroError(`tamanho ${xml.length} excede limite ${limite}`);
    }
    // DOCTYPE em si nao eh ameaca, mas permite ENTITY. Como SEFAZ/NFSe/Reinf
    // nao usam DOCTYPE, rejeitar eh seguro e simples.
    if (/<!DOCTYPE/i.test(xml)) {
        throw new XmlInseguroError('XML contem DOCTYPE - bloqueado (XXE / billion-laughs)');
    }
    if (/<!ENTITY/i.test(xml)) {
        throw new XmlInseguroError('XML contem ENTITY declaration - bloqueado');
    }
    return xml;
}
