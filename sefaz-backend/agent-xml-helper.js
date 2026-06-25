// Helpers puros do agente local A3.

export function pareceNfseNacional(xml, schema) {
    const s = String(schema || '');
    if (/nfse|nfse-nacional|dfe-nfse/i.test(s)) return true;
    return /<NFSe\b|<infNFSe\b|<eventoNFSe\b/i.test(String(xml || ''));
}

