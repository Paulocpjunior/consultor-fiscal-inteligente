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

// ═══ TAG COM PREFIXO (03/09) ═════════════════════════════════════════════════
// `getElementsByTagName('CompNfse')` casa o nome QUALIFICADO: num lote em que
// a prefeitura escreve `<ns2:CompNfse>` (prefixo de namespace — comum em
// respostas geradas por Java/JAXB), a lista voltava VAZIA e o parser dizia
// "ok, zero notas". O casamento é pelo `localName` — o nome sem o prefixo.
const localDe = (el) => el.localName || String(el.nodeName || '').split(':').pop();

/** Todos os descendentes de `parent` cujo localName é `name` (ordem do doc). */
function porLocalName(parent, name) {
    if (!parent || typeof parent.getElementsByTagName !== 'function') return [];
    const todos = parent.getElementsByTagName('*');
    const out = [];
    for (let i = 0; i < todos.length; i++) {
        if (localDe(todos[i]) === name) out.push(todos[i]);
    }
    return out;
}
const primeiroPorLocalName = (parent, name) => porLocalName(parent, name)[0] || null;

const txt = (parent, tag) => {
    const el = primeiroPorLocalName(parent, tag);
    return el ? (el.textContent || '').trim() : '';
};
// Valor NUMÉRICO com zero como "ausente". Serve a campos em que a ausência
// não afirma nada (paginação); para RETENÇÃO use `numOuNull`.
const num = (parent, tag) => {
    const v = txt(parent, tag);
    if (!v) return 0;
    const n = Number(v.replace(',', '.'));
    return isNaN(n) ? 0 : n;
};
// 🚨 AUSENTE ≠ ZERO RETIDO (03/09). `num()` devolvia 0 para `<ValorIr>` que
// não veio — e 0 num campo de retenção é a AFIRMAÇÃO de que não houve
// retenção: o Relatório de Retenções e o R-4020 leem esse zero como
// resposta do documento. Ausente vira **null**, que os leitores
// (`lerRetencoesFederaisDoDoc`) tratam como "não gravado" — a mesma política
// do `retencoesFederaisGravadas` da leitura nacional.
const numOuNull = (parent, tag) => {
    const v = txt(parent, tag);
    if (!v) return null;
    const n = Number(v.replace(',', '.'));
    return isNaN(n) ? null : n;
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
    const fault = primeiroPorLocalName(doc, 'Fault');
    if (fault) {
        const faultString = primeiroPorLocalName(fault, 'faultstring')?.textContent
            || primeiroPorLocalName(fault, 'Reason')?.textContent
            || 'SOAP Fault';
        return { ok: false, mensagens: [{ codigo: 'SOAP_FAULT', mensagem: faultString }], nfses: [] };
    }

    // Mensagens de retorno do WS (codigo/mensagem) - significam erro de negocio
    const mensagens = [];
    const lstMensagens = porLocalName(doc, 'MensagemRetorno');
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
    const comps = porLocalName(doc, 'CompNfse');
    for (let i = 0; i < comps.length; i++) {
        const nfseEl = primeiroPorLocalName(comps[i], 'InfNfse')
            || primeiroPorLocalName(comps[i], 'Nfse');
        if (!nfseEl) continue;
        const parsed = parseInfNfse(nfseEl);
        if (parsed) nfses.push(parsed);
    }

    // Paginacao (algumas respostas trazem Pagina ou TotalPaginas)
    const paginaAtual = num(doc.documentElement, 'Pagina') || null;
    const totalPaginas = num(doc.documentElement, 'TotalPaginas') || null;
    const temMaisPaginas = totalPaginas ? paginaAtual < totalPaginas
        : nfses.length >= 50;   // heuristica: ABRASF padrao = 50 por pagina

    // 🚨 LOTE COM NOTA E ZERO LIDAS NÃO É "OK, SEM DADOS" (03/09). Antes,
    // `ok = mensagens.length === 0 || nfses.length > 0` devolvia ok:true com
    // lista vazia sobre um lote que TEM `<CompNfse>` e que o parser não soube
    // ler — indistinguível de "a prefeitura não tem nota", que é justamente a
    // ausência plausível que esconde buraco de captura. ListaNfse VAZIA
    // continua sendo sucesso sem dados; CompNfse presente e nada lido é erro
    // NOMEADO.
    if (comps.length > 0 && nfses.length === 0 && mensagens.length === 0) {
        return {
            ok: false,
            mensagens: [{
                codigo: 'LOTE_NAO_LIDO',
                mensagem: `A resposta traz ${comps.length} CompNfse e nenhuma NFS-e pôde ser lida (sem <Numero> legível) — `
                    + 'o leiaute desta prefeitura não é o que o parser conhece. Não é "sem movimento".',
            }],
            nfses,
            paginaAtual,
            temMaisPaginas: false,
        };
    }
    // OK se nao houve mensagem de erro (ListaNfse vazia + nenhuma mensagem = OK sem dados)
    const ok = mensagens.length === 0 || nfses.length > 0;
    return { ok, mensagens, nfses, paginaAtual, temMaisPaginas };
}

/**
 * Parseia 1 <InfNfse> em estrutura normalizada.
 * Tolerante a campos faltantes (string vazia / 0) — EXCETO as retenções
 * federais, que ausentes saem `null` (ausente ≠ zero retido).
 */
function parseInfNfse(el) {
    const numero = txt(el, 'Numero');
    if (!numero) return null;

    // Servicos pode vir como <Servico> (v2.04) ou <ServicosPrestados> (algumas versoes)
    const servicoEl = primeiroPorLocalName(el, 'Servico')
        || primeiroPorLocalName(el, 'ServicosPrestados');

    const valoresEl = servicoEl ? primeiroPorLocalName(servicoEl, 'Valores') : null;
    const valorServicos = valoresEl ? num(valoresEl, 'ValorServicos') : 0;
    const aliquota = valoresEl ? num(valoresEl, 'Aliquota') : 0;
    const valorIss = valoresEl ? num(valoresEl, 'ValorIss') : 0;
    const valorIssRetido = valoresEl ? num(valoresEl, 'ValorIssRetido') : 0;
    // Retenções FEDERAIS: ausente é null, nunca zero (ver `numOuNull`).
    const valorPis = valoresEl ? numOuNull(valoresEl, 'ValorPis') : null;
    const valorCofins = valoresEl ? numOuNull(valoresEl, 'ValorCofins') : null;
    const valorInss = valoresEl ? numOuNull(valoresEl, 'ValorInss') : null;
    const valorIr = valoresEl ? numOuNull(valoresEl, 'ValorIr') : null;
    const valorCsll = valoresEl ? numOuNull(valoresEl, 'ValorCsll') : null;
    const baseCalculo = valoresEl ? num(valoresEl, 'BaseCalculo') : valorServicos;
    const valorLiquidoNfse = valoresEl ? num(valoresEl, 'ValorLiquidoNfse') : 0;

    // 1 = retido pelo tomador; 2 = nao retido
    const issRetido = servicoEl ? txt(servicoEl, 'IssRetido') === '1' : false;
    const itemListaServico = servicoEl ? txt(servicoEl, 'ItemListaServico') : '';
    const codigoTributacaoMunicipio = servicoEl ? txt(servicoEl, 'CodigoTributacaoMunicipio') : '';
    const discriminacao = servicoEl ? txt(servicoEl, 'Discriminacao') : '';
    const codigoMunicipio = servicoEl ? txt(servicoEl, 'CodigoMunicipio') : '';

    // Prestador
    const prestadorEl = primeiroPorLocalName(el, 'PrestadorServico');
    const prestadorId = prestadorEl ? primeiroPorLocalName(prestadorEl, 'IdentificacaoPrestador') : null;
    const prestadorCnpj = prestadorId ? (txt(prestadorId, 'Cnpj') || txt(prestadorId, 'Cpf')) : '';
    const prestadorIm = prestadorId ? txt(prestadorId, 'InscricaoMunicipal') : '';
    const prestadorNome = prestadorEl ? txt(prestadorEl, 'RazaoSocial') : '';

    // Tomador
    const tomadorEl = primeiroPorLocalName(el, 'TomadorServico');
    const tomadorId = tomadorEl ? primeiroPorLocalName(tomadorEl, 'IdentificacaoTomador') : null;
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
