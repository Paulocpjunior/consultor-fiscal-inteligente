// sefaz-backend/abrasf/parser-nfse.js
// Parser de resposta ABRASF v2.x (ConsultarNfseResposta + variantes).
//
// Devolve estrutura normalizada pronta pra virar DocumentoFiscal no Firestore.
//
// Schema oficial: http://www.abrasf.org.br/nfse.xsd
//
// As tags relevantes:
//   <ListaNfse>
//     <CompNfse>
//       <Nfse>
//         <InfNfse Id="..."> (ABRASF v2.04 marca Id pra assinatura)
//           <Numero>            numero do NFSe
//           <CodigoVerificacao> codigo de autenticidade (10-20 chars)
//           <DataEmissao>       ISO datetime
//           <NaturezaOperacao>  1..6
//           <OptanteSimplesNacional> 1=sim 2=nao
//           <ServicosPrestados> ou <Servico> (depende da versao)
//             <Valores>...</Valores>
//             <IssRetido>1|2</IssRetido>
//             <ItemListaServico>   codigo da LC 116
//             <CodigoTributacaoMunicipio>
//             <Discriminacao>
//             <CodigoMunicipio>
//           </Servico>
//           <PrestadorServico>
//             <IdentificacaoPrestador>...</IdentificacaoPrestador>
//             <RazaoSocial>
//             <Endereco>...</Endereco>
//           </PrestadorServico>
//           <TomadorServico>
//             <IdentificacaoTomador>...</IdentificacaoTomador>
//             <RazaoSocial>
//           </TomadorServico>
//         </InfNfse>
//       </Nfse>
//     </CompNfse>
//   </ListaNfse>
//
// + Tratamento de erros:
//   <ListaMensagemRetorno>
//     <MensagemRetorno><Codigo>...</Codigo><Mensagem>...</Mensagem></MensagemRetorno>
//   </ListaMensagemRetorno>

import { DOMParser } from '@xmldom/xmldom';

// Validacao anti-XXE / billion-laughs inline (sem dependencia de modulo
// externo - mantem este parser auto-contido).
const XML_TAMANHO_MAX = 10 * 1024 * 1024; // 10 MB
class XmlInseguroError extends Error {
    constructor(motivo) {
        super(`XML rejeitado: ${motivo}`);
        this.name = 'XmlInseguroError';
    }
}
function validarXmlSeguro(xml) {
    if (typeof xml !== 'string') throw new XmlInseguroError('conteudo nao eh string');
    if (xml.length > XML_TAMANHO_MAX) throw new XmlInseguroError(`tamanho excede ${XML_TAMANHO_MAX} bytes`);
    if (/<!DOCTYPE/i.test(xml)) throw new XmlInseguroError('XML contem DOCTYPE - bloqueado');
    if (/<!ENTITY/i.test(xml)) throw new XmlInseguroError('XML contem ENTITY - bloqueado');
    return xml;
}

const txt = (parent, tag) => {
    const el = parent.getElementsByTagName(tag)[0];
    return el ? (el.textContent || '').trim() : '';
};
const num = (parent, tag) => {
    const v = txt(parent, tag);
    if (!v) return 0;
    const n = Number(v.replace(',', '.'));
    return isNaN(n) ? 0 : n;
};

/**
 * Faz parse do XML de resposta e devolve:
 *   {
 *     ok: boolean,
 *     mensagens: [{ codigo, mensagem, correcao? }],   se erro do WS
 *     nfses: [NfseAbrasf],
 *     paginaAtual?: number,
 *     temMaisPaginas: boolean,
 *   }
 *
 * Se o XML for SOAP fault ou unparsavel, devolve { ok: false, mensagens: [...] }.
 */
export function parseRespostaConsulta(xmlString) {
    try {
        validarXmlSeguro(xmlString);
    } catch (e) {
        return { ok: false, mensagens: [{ codigo: 'XML_INSEGURO', mensagem: e.message }], nfses: [] };
    }

    let doc;
    try {
        doc = new DOMParser({ errorHandler: () => {} }).parseFromString(xmlString, 'text/xml');
    } catch (e) {
        return { ok: false, mensagens: [{ codigo: 'XML_INVALIDO', mensagem: e.message }], nfses: [] };
    }

    // SOAP Fault tem prioridade
    const fault = doc.getElementsByTagName('Fault')[0] || doc.getElementsByTagName('soap:Fault')[0];
    if (fault) {
        const faultString = fault.getElementsByTagName('faultstring')[0]?.textContent
            || fault.getElementsByTagName('Reason')[0]?.textContent
            || 'SOAP Fault';
        return { ok: false, mensagens: [{ codigo: 'SOAP_FAULT', mensagem: faultString }], nfses: [] };
    }

    // Mensagens de retorno do WS (codigo/mensagem) - significam erro de negocio
    const mensagens = [];
    const lstMensagens = doc.getElementsByTagName('MensagemRetorno');
    for (let i = 0; i < lstMensagens.length; i++) {
        const m = lstMensagens[i];
        mensagens.push({
            codigo: txt(m, 'Codigo'),
            mensagem: txt(m, 'Mensagem'),
            correcao: txt(m, 'Correcao') || undefined,
        });
    }

    // Extrai NFSes da ListaNfse / lista de CompNfse
    const nfses = [];
    const comps = doc.getElementsByTagName('CompNfse');
    for (let i = 0; i < comps.length; i++) {
        const nfseEl = comps[i].getElementsByTagName('InfNfse')[0]
            || comps[i].getElementsByTagName('Nfse')[0];
        if (!nfseEl) continue;
        const parsed = parseInfNfse(nfseEl);
        if (parsed) nfses.push(parsed);
    }

    // Paginacao (algumas respostas trazem Pagina ou TotalPaginas)
    const paginaAtual = num(doc.documentElement, 'Pagina') || null;
    const totalPaginas = num(doc.documentElement, 'TotalPaginas') || null;
    const temMaisPaginas = totalPaginas ? paginaAtual < totalPaginas
        : nfses.length >= 50;   // heuristica: ABRASF padrao = 50 por pagina

    // OK se nao houve mensagem de erro (ListaNfse vazia + nenhuma mensagem = OK sem dados)
    const ok = mensagens.length === 0 || nfses.length > 0;
    return { ok, mensagens, nfses, paginaAtual, temMaisPaginas };
}

/**
 * Parseia 1 <InfNfse> em estrutura normalizada.
 * Tolerante a campos faltantes (devolve string vazia ou 0).
 */
function parseInfNfse(el) {
    const numero = txt(el, 'Numero');
    if (!numero) return null;

    // Servicos pode vir como <Servico> (v2.04) ou <ServicosPrestados> (algumas versoes)
    const servicoEl = el.getElementsByTagName('Servico')[0]
        || el.getElementsByTagName('ServicosPrestados')[0];

    const valoresEl = servicoEl?.getElementsByTagName('Valores')[0];
    const valorServicos = valoresEl ? num(valoresEl, 'ValorServicos') : 0;
    const aliquota = valoresEl ? num(valoresEl, 'Aliquota') : 0;
    const valorIss = valoresEl ? num(valoresEl, 'ValorIss') : 0;
    const valorIssRetido = valoresEl ? num(valoresEl, 'ValorIssRetido') : 0;
    const valorPis = valoresEl ? num(valoresEl, 'ValorPis') : 0;
    const valorCofins = valoresEl ? num(valoresEl, 'ValorCofins') : 0;
    const valorInss = valoresEl ? num(valoresEl, 'ValorInss') : 0;
    const valorIr = valoresEl ? num(valoresEl, 'ValorIr') : 0;
    const valorCsll = valoresEl ? num(valoresEl, 'ValorCsll') : 0;
    const baseCalculo = valoresEl ? num(valoresEl, 'BaseCalculo') : valorServicos;
    const valorLiquidoNfse = valoresEl ? num(valoresEl, 'ValorLiquidoNfse') : 0;

    // 1 = retido pelo tomador; 2 = nao retido
    const issRetido = servicoEl ? txt(servicoEl, 'IssRetido') === '1' : false;
    const itemListaServico = servicoEl ? txt(servicoEl, 'ItemListaServico') : '';
    const codigoTributacaoMunicipio = servicoEl ? txt(servicoEl, 'CodigoTributacaoMunicipio') : '';
    const discriminacao = servicoEl ? txt(servicoEl, 'Discriminacao') : '';
    const codigoMunicipio = servicoEl ? txt(servicoEl, 'CodigoMunicipio') : '';

    // Prestador
    const prestadorEl = el.getElementsByTagName('PrestadorServico')[0];
    const prestadorId = prestadorEl?.getElementsByTagName('IdentificacaoPrestador')[0];
    const prestadorCnpj = prestadorId ? (txt(prestadorId, 'Cnpj') || txt(prestadorId, 'Cpf')) : '';
    const prestadorIm = prestadorId ? txt(prestadorId, 'InscricaoMunicipal') : '';
    const prestadorNome = prestadorEl ? txt(prestadorEl, 'RazaoSocial') : '';

    // Tomador
    const tomadorEl = el.getElementsByTagName('TomadorServico')[0];
    const tomadorId = tomadorEl?.getElementsByTagName('IdentificacaoTomador')[0];
    const tomadorCnpj = tomadorId ? (txt(tomadorId, 'Cnpj') || txt(tomadorId, 'Cpf')) : '';
    const tomadorIm = tomadorId ? txt(tomadorId, 'InscricaoMunicipal') : '';
    const tomadorNome = tomadorEl ? txt(tomadorEl, 'RazaoSocial') : '';

    const codigoVerificacao = txt(el, 'CodigoVerificacao');
    const dataEmissao = txt(el, 'DataEmissao');
    const naturezaOperacao = txt(el, 'NaturezaOperacao');
    const optanteSimples = txt(el, 'OptanteSimplesNacional') === '1';

    return {
        numero,
        codigoVerificacao,
        dataEmissao,
        naturezaOperacao,
        optanteSimples,
        servico: {
            valorServicos, baseCalculo, aliquota, valorIss, valorIssRetido,
            valorPis, valorCofins, valorInss, valorIr, valorCsll, valorLiquidoNfse,
            issRetido,
            itemListaServico, codigoTributacaoMunicipio,
            discriminacao,
            codigoMunicipio,
        },
        prestador: {
            cnpj: prestadorCnpj.replace(/\D/g, ''),
            inscricaoMunicipal: prestadorIm,
            nome: prestadorNome,
        },
        tomador: {
            cnpj: tomadorCnpj.replace(/\D/g, ''),
            inscricaoMunicipal: tomadorIm,
            nome: tomadorNome,
        },
    };
}
