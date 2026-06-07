// sefaz-backend/abrasf/config-municipios.js
// Catalogo de municipios suportados pelo adapter ABRASF v2.x.
//
// Cada entrada tem:
//   codIBGE     - codigo IBGE 7 digitos (chave primaria)
//   nome        - nome do municipio (display)
//   uf          - UF
//   wsdl        - URL do webservice SOAP
//   versao      - 'abrasf-2.02' | 'abrasf-2.03' | 'abrasf-2.04'
//   soapAction  - SOAPAction header (ws-i)
//   exigeIM     - true se o municipio exige InscricaoMunicipal no consulente
//   exigeAuth   - 'mTLS' | 'wsdsig' | 'mTLS+wsdsig'
//                 mTLS: client-cert TLS; wsdsig: assinatura XML-DSig do payload
//   tipoPagina  - 'pagina' (campo Pagina no envelope) | 'sem' (sem paginacao)
//   maxDias     - limite de dias por requisicao (alguns municipios limitam a 30 ou 90)
//   ambiente    - 'producao' | 'homologacao'
//
// Pra adicionar novo municipio: ver doc do TI da prefeitura ou Megasoft/Govbr.
// Cada municipio publica o WSDL. Conferir versao do schema (ABRASF) na URL.

export const MUNICIPIOS_ABRASF = {
    // Barueri/SP - sistema Megasoft NFSe v2.03
    // Doc: https://www.barueri.sp.gov.br/nfse (consultar TI da Prefeitura)
    '3505708': {
        codIBGE: '3505708',
        nome: 'Barueri',
        uf: 'SP',
        wsdl: 'https://nfse.barueri.sp.gov.br/Services/NotaFiscalServicos.svc',
        versao: 'abrasf-2.03',
        soapAction: 'http://www.abrasf.org.br/nfse/ConsultarNfseServicoTomado',
        exigeIM: true,
        exigeAuth: 'mTLS+wsdsig',
        tipoPagina: 'pagina',
        maxDias: 90,
        ambiente: 'producao',
    },

    // Santos/SP - Sistema da prefeitura, ABRASF v2.03
    // Doc: https://www.santos.sp.gov.br/?q=hotsite/nota-fiscal-eletronica
    '3548500': {
        codIBGE: '3548500',
        nome: 'Santos',
        uf: 'SP',
        wsdl: 'https://nfe.santos.sp.gov.br/Services/NotaFiscalServicos.svc',
        versao: 'abrasf-2.03',
        soapAction: 'http://www.abrasf.org.br/nfse/ConsultarNfseServicoTomado',
        exigeIM: true,
        exigeAuth: 'mTLS+wsdsig',
        tipoPagina: 'pagina',
        maxDias: 90,
        ambiente: 'producao',
    },

    // Curitiba/PR - ABRASF v2.04
    // Doc: https://www.curitiba.pr.gov.br/iss
    '4106902': {
        codIBGE: '4106902',
        nome: 'Curitiba',
        uf: 'PR',
        wsdl: 'https://isscuritiba.curitiba.pr.gov.br/iss/WSNacional/nfse.asmx',
        versao: 'abrasf-2.04',
        soapAction: 'http://www.abrasf.org.br/nfse/ConsultarNfseServicoTomado',
        exigeIM: true,
        exigeAuth: 'wsdsig',
        tipoPagina: 'pagina',
        maxDias: 60,
        ambiente: 'producao',
    },

    // ── Templates para adicionar (pesquisar WSDL e verificar) ────────────
    // Campinas/SP: 3509502, ABRASF v2.03/v2.04
    // Rio de Janeiro/RJ: 3304557, sistema proprio (NAO ABRASF puro)
    // Belo Horizonte/MG: 3106200, sistema proprio
    // Porto Alegre/RS: 4314902, ABRASF v2.04
    // Recife/PE: 2611606, ABRASF v2.03
    // Fortaleza/CE: 2304400, ABRASF v2.03
    // Salvador/BA: 2927408, sistema proprio Pronim
};

/**
 * Devolve config do municipio ou null se nao suportado.
 * codIBGE pode vir com 6 (sem digito verificador) ou 7 digitos - normalizamos
 * truncando pra 7. Se vier com 6, NAO eh valido (cod IBGE oficial sempre tem 7).
 */
export function configMunicipio(codIBGE) {
    if (!codIBGE) return null;
    const s = String(codIBGE).replace(/\D/g, '');
    return MUNICIPIOS_ABRASF[s] || null;
}

/**
 * Lista codIBGE de todos municipios suportados.
 */
export function municipiosSuportados() {
    return Object.keys(MUNICIPIOS_ABRASF);
}

/**
 * Util pra debugging/relatorios: mapa de codIBGE -> nome+UF.
 */
export function listarMunicipiosNomes() {
    return Object.values(MUNICIPIOS_ABRASF).map(m => ({
        codIBGE: m.codIBGE, nome: m.nome, uf: m.uf, versao: m.versao,
    }));
}
