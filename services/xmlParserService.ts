/**
 * xmlParserService.ts
 * Parser de XMLs fiscais (NFe / NFCe / NFSe / CTe).
 *
 * Extraído do componente ImportaXML.tsx para permitir reaproveitamento entre
 * importação manual, captura SEFAZ e captura SharePoint.
 *
 * NFSe: parse de XML ABRASF (v1.0, 2.0, 2.04) com tags
 * <CompNfse>, <Nfse>, <InfNfse>, <Servico>, <PrestadorServico>, <TomadorServico>.
 */

import type {
    DocumentoFiscal,
    DocumentoFiscalItem,
    DocumentoFiscalParticipante,
    DocumentoFiscalTotais,
    XmlDirecao,
    XmlStatusDocumento,
    XmlTipoDocumento,
} from '../types';

// ─── Helpers básicos ────────────────────────────────────────────────────────

const onlyDigits = (v: string | undefined | null): string =>
    (v || '').replace(/\D+/g, '');

function getTextContent(el: Element | null | undefined, tag: string): string {
    if (!el) return '';
    const found = el.getElementsByTagName(tag);
    if (found.length === 0) return '';
    return found[0]?.textContent?.trim() || '';
}

function num(v: string | undefined | null): number {
    if (!v) return 0;
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

/** SHA-256 em hexadecimal usando Web Crypto API (browser). */
export async function sha256Hex(text: string): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
        const buf = new TextEncoder().encode(text);
        const hash = await crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    // Fallback simples (não criptográfico) caso WebCrypto indisponível.
    let h = 0;
    for (let i = 0; i < text.length; i++) {
        h = ((h << 5) - h) + text.charCodeAt(i);
        h |= 0;
    }
    return 'fallback-' + Math.abs(h).toString(16);
}

/** Extrai chave de acesso (44 dígitos) a partir de Id da infNFe. */
export function extractChaveFromId(id: string): string {
    const digits = onlyDigits(id);
    return digits.length >= 44 ? digits.slice(-44) : digits;
}

/** YYYY-MM a partir de uma data ISO. */
export function competenciaFromIso(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
        // Tenta YYYY-MM-DD direto.
        const m = iso.match(/^(\d{4})-(\d{2})/);
        return m ? `${m[1]}-${m[2]}` : '';
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Classificação CFOP ──────────────────────────────────────────────────────
// Migrada para services/cfopClassifier.ts (catalogo CONFAZ por faixas de 4
// digitos). A logica anterior aqui (baseada no 2o digito como "grupo") errava
// sistematicamente em devolucoes, transferencias e remessas.

import { classificarPorCfop } from './cfopClassifier';
export { classificarPorCfop };

// ─── Tipos internos do parser ───────────────────────────────────────────────

export interface ParsedXml {
    chave: string;
    tipo: XmlTipoDocumento;
    modelo: string;
    serie: string;
    numero: string;
    natOp: string;
    dhEmi: string;
    status: XmlStatusDocumento;
    emitente: DocumentoFiscalParticipante;
    destinatario: DocumentoFiscalParticipante;
    itens: DocumentoFiscalItem[];
    totais: DocumentoFiscalTotais;
    infAdic?: string;
}

export class XmlParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'XmlParseError';
    }
}

// ─── Parser principal ───────────────────────────────────────────────────────

// Limite de tamanho do XML (10 MB) - XMLs SEFAZ usuais sao 5-50KB.
const XML_TAMANHO_MAX = 10 * 1024 * 1024;

/**
 * Faz o parse de um XML de NFe/NFCe ou CT-e.
 * Lança XmlParseError quando o documento é inválido, inseguro ou não suportado.
 */
export function parseNFeXml(xmlText: string): ParsedXml {
    if (typeof xmlText !== 'string') {
        throw new XmlParseError('Conteudo XML invalido.');
    }
    if (xmlText.length > XML_TAMANHO_MAX) {
        throw new XmlParseError(`XML excede tamanho maximo (${XML_TAMANHO_MAX / 1024 / 1024}MB).`);
    }
    // Bloqueia XXE / billion-laughs - XMLs legitimos SEFAZ/NFSe nao usam DOCTYPE.
    if (/<!DOCTYPE/i.test(xmlText) || /<!ENTITY/i.test(xmlText)) {
        throw new XmlParseError('XML contem DOCTYPE/ENTITY - bloqueado por seguranca.');
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    if (doc.querySelector('parsererror')) {
        throw new XmlParseError('Arquivo XML inválido ou corrompido.');
    }

    // NFSe (ABRASF): redireciona para parser específico
    const infNfse = doc.getElementsByTagName('InfNfse')[0]
        || doc.getElementsByTagName('infNfse')[0];
    if (infNfse || doc.getElementsByTagName('CompNfse')[0]) {
        return parseNFSeXml(doc, infNfse);
    }

    // CT-e: redireciona para parser específico
    const infCte = doc.getElementsByTagName('infCte')[0];
    if (infCte) {
        return parseCTeXml(doc, infCte);
    }

    const infNFe = doc.getElementsByTagName('infNFe')[0];
    if (!infNFe) {
        throw new XmlParseError('XML não é uma NFe/NFCe/CTe/NFSe válida (tag <infNFe>, <infCte> ou <InfNfse> ausente).');
    }

    const ide = doc.getElementsByTagName('ide')[0];
    const emit = doc.getElementsByTagName('emit')[0];
    const dest = doc.getElementsByTagName('dest')[0];
    const total = doc.getElementsByTagName('total')[0];
    const icmsTot = total ? total.getElementsByTagName('ICMSTot')[0] : null;
    const infAdFisco = doc.getElementsByTagName('infAdFisco')[0];
    const infCpl = doc.getElementsByTagName('infCpl')[0];

    const modelo = getTextContent(ide, 'mod');
    const tipo: XmlTipoDocumento = modelo === '65' ? 'NFCe' : modelo === '55' ? 'NFe' : 'NFe';

    const detElements = doc.getElementsByTagName('det');
    const itens: DocumentoFiscalItem[] = [];

    for (let i = 0; i < detElements.length; i++) {
        const det = detElements[i];
        if (!det) continue;
        const prod = det.getElementsByTagName('prod')[0];
        const icms = det.getElementsByTagName('ICMS')[0];
        const ipi = det.getElementsByTagName('IPI')[0];
        const pis = det.getElementsByTagName('PIS')[0];
        const cofins = det.getElementsByTagName('COFINS')[0];

        // ICMS — extrai TODOS os campos do bloco interno (ICMS00/10/20/30/etc).
        // Cada CST tem subset diferente de campos; num('') retorna 0 quando ausente.
        let cst = '';
        let vICMS = 0;
        let vBC = 0;
        let aliqIcms = 0;
        let vBCST = 0;
        let aliqST = 0;
        let vICMSST = 0;
        let pRedBC = 0;
        let modBC = '';
        let orig = '';
        if (icms) {
            const icmsInner = icms.children[0];
            if (icmsInner) {
                cst = getTextContent(icmsInner, 'CST') || getTextContent(icmsInner, 'CSOSN');
                vICMS = num(getTextContent(icmsInner, 'vICMS'));
                vBC = num(getTextContent(icmsInner, 'vBC'));
                aliqIcms = num(getTextContent(icmsInner, 'pICMS'));
                vBCST = num(getTextContent(icmsInner, 'vBCST'));
                aliqST = num(getTextContent(icmsInner, 'pICMSST'));
                vICMSST = num(getTextContent(icmsInner, 'vICMSST'));
                pRedBC = num(getTextContent(icmsInner, 'pRedBC'));
                modBC = getTextContent(icmsInner, 'modBC');
                orig = getTextContent(icmsInner, 'orig');
            }
        }

        let vIPI = 0;
        let aliqIPI = 0;
        // CST do IPI para o E510 (por CFOP+CST_IPI): tributado em IPITrib,
        // não-tributado em IPINT — os dois entram no E510. Ausente = undefined
        // (item sem IPI), nunca "0".
        let cstIpi: string | undefined;
        let cEnqIpi: string | undefined;
        let vBcIpi = 0;
        if (ipi) {
            const ipiTrib = ipi.getElementsByTagName('IPITrib')[0];
            const ipiNt = ipi.getElementsByTagName('IPINT')[0];
            if (ipiTrib) {
                vIPI = num(getTextContent(ipiTrib, 'vIPI'));
                aliqIPI = num(getTextContent(ipiTrib, 'pIPI'));
                vBcIpi = num(getTextContent(ipiTrib, 'vBC'));
            }
            cstIpi = getTextContent(ipiTrib, 'CST') || getTextContent(ipiNt, 'CST') || undefined;
            cEnqIpi = getTextContent(ipi, 'cEnq') || undefined;
        }

        // CST de PIS/COFINS: é ele que decide se a ENTRADA gera crédito no
        // não-cumulativo. Paridade OBRIGATÓRIA com o xml-importer.js do backend
        // (regra da casa) — ler só num lado é como as leituras divergem.
        let vPIS = 0;
        let aliqPIS = 0;
        let cstPis: string | undefined;
        let vBcPis = 0;
        if (pis) {
            const pisInner = pis.children[0];
            if (pisInner) {
                vPIS = num(getTextContent(pisInner, 'vPIS'));
                aliqPIS = num(getTextContent(pisInner, 'pPIS'));
                cstPis = getTextContent(pisInner, 'CST') || undefined;
                vBcPis = num(getTextContent(pisInner, 'vBC'));
            }
        }

        let vCOFINS = 0;
        let aliqCOFINS = 0;
        let cstCofins: string | undefined;
        let vBcCofins = 0;
        if (cofins) {
            const cofinsInner = cofins.children[0];
            if (cofinsInner) {
                vCOFINS = num(getTextContent(cofinsInner, 'vCOFINS'));
                aliqCOFINS = num(getTextContent(cofinsInner, 'pCOFINS'));
                cstCofins = getTextContent(cofinsInner, 'CST') || undefined;
                vBcCofins = num(getTextContent(cofinsInner, 'vBC'));
            }
        }

        itens.push({
            nItem: det.getAttribute('nItem') || String(i + 1),
            cProd: getTextContent(prod, 'cProd'),
            xProd: getTextContent(prod, 'xProd'),
            ncm: getTextContent(prod, 'NCM'),
            cest: getTextContent(prod, 'CEST') || undefined,
            cfop: getTextContent(prod, 'CFOP'),
            uCom: getTextContent(prod, 'uCom'),
            qCom: num(getTextContent(prod, 'qCom')),
            vUnCom: num(getTextContent(prod, 'vUnCom')),
            vProd: num(getTextContent(prod, 'vProd')),
            vDesc: num(getTextContent(prod, 'vDesc')) || undefined,
            vBC,
            aliqIcms,
            vICMS,
            vBCST,
            aliqST,
            vICMSST,
            modBC,
            pRedBC,
            vIPI,
            aliqIPI,
            cstIpi,
            cEnqIpi,
            vBcIpi,
            vPIS,
            cstPis,
            vBcPis,
            cstCofins,
            vBcCofins,
            aliqPIS,
            vCOFINS,
            aliqCOFINS,
            cst,
            orig,
        });
    }

    const emitEnder = emit ? emit.getElementsByTagName('enderEmit')[0] : null;
    const destEnder = dest ? dest.getElementsByTagName('enderDest')[0] : null;

    const emitente: DocumentoFiscalParticipante = {
        cnpjCpf: onlyDigits(getTextContent(emit, 'CNPJ') || getTextContent(emit, 'CPF')),
        nome: getTextContent(emit, 'xNome'),
        fantasia: getTextContent(emit, 'xFant') || undefined,
        ie: getTextContent(emit, 'IE') || undefined,
        uf: getTextContent(emitEnder, 'UF') || undefined,
        municipio: getTextContent(emitEnder, 'xMun') || undefined,
        codMunIBGE: getTextContent(emitEnder, 'cMun') || undefined,
        logradouro: getTextContent(emitEnder, 'xLgr') || undefined,
        numero: getTextContent(emitEnder, 'nro') || undefined,
        complemento: getTextContent(emitEnder, 'xCpl') || undefined,
        bairro: getTextContent(emitEnder, 'xBairro') || undefined,
        cep: onlyDigits(getTextContent(emitEnder, 'CEP')) || undefined,
        codPais: getTextContent(emitEnder, 'cPais') || undefined,
        pais: getTextContent(emitEnder, 'xPais') || undefined,
    };

    const destinatario: DocumentoFiscalParticipante = {
        cnpjCpf: onlyDigits(getTextContent(dest, 'CNPJ') || getTextContent(dest, 'CPF')),
        nome: getTextContent(dest, 'xNome'),
        ie: getTextContent(dest, 'IE') || undefined,
        uf: getTextContent(destEnder, 'UF') || undefined,
        municipio: getTextContent(destEnder, 'xMun') || undefined,
        codMunIBGE: getTextContent(destEnder, 'cMun') || undefined,
        logradouro: getTextContent(destEnder, 'xLgr') || undefined,
        numero: getTextContent(destEnder, 'nro') || undefined,
        complemento: getTextContent(destEnder, 'xCpl') || undefined,
        bairro: getTextContent(destEnder, 'xBairro') || undefined,
        cep: onlyDigits(getTextContent(destEnder, 'CEP')) || undefined,
        codPais: getTextContent(destEnder, 'cPais') || undefined,
        pais: getTextContent(destEnder, 'xPais') || undefined,
    };

    const totais: DocumentoFiscalTotais = {
        vBC: num(getTextContent(icmsTot, 'vBC')),
        vICMS: num(getTextContent(icmsTot, 'vICMS')),
        vICMSDeson: num(getTextContent(icmsTot, 'vICMSDeson')),
        vFCP: num(getTextContent(icmsTot, 'vFCP')),
        vBCST: num(getTextContent(icmsTot, 'vBCST')),
        vST: num(getTextContent(icmsTot, 'vST')),
        vFCPST: num(getTextContent(icmsTot, 'vFCPST')),
        vProd: num(getTextContent(icmsTot, 'vProd')),
        vFrete: num(getTextContent(icmsTot, 'vFrete')),
        vSeg: num(getTextContent(icmsTot, 'vSeg')),
        vDesc: num(getTextContent(icmsTot, 'vDesc')),
        vII: num(getTextContent(icmsTot, 'vII')),
        vIPI: num(getTextContent(icmsTot, 'vIPI')),
        vIPIDevol: num(getTextContent(icmsTot, 'vIPIDevol')),
        vPIS: num(getTextContent(icmsTot, 'vPIS')),
        vCOFINS: num(getTextContent(icmsTot, 'vCOFINS')),
        vOutro: num(getTextContent(icmsTot, 'vOutro')),
        vNF: num(getTextContent(icmsTot, 'vNF')),
    };

    const chave = extractChaveFromId(infNFe.getAttribute('Id') || '');

    // Status presente em protNFe quando o XML é o "completo" (procNFe).
    const cStat = getTextContent(doc.getElementsByTagName('infProt')[0], 'cStat');
    const status: XmlStatusDocumento =
        cStat === '100' ? 'autorizado'
        : cStat === '101' ? 'cancelado'
        : cStat === '110' ? 'denegado'
        : cStat === '102' ? 'inutilizado'
        : !cStat ? 'desconhecido'
        : 'rejeitado';

    return {
        chave,
        tipo,
        modelo,
        serie: getTextContent(ide, 'serie'),
        numero: getTextContent(ide, 'nNF'),
        natOp: getTextContent(ide, 'natOp'),
        dhEmi: getTextContent(ide, 'dhEmi') || getTextContent(ide, 'dEmi'),
        status,
        emitente,
        destinatario,
        itens,
        totais,
        infAdic: infAdFisco?.textContent?.trim() || infCpl?.textContent?.trim() || undefined,
    };
}

// ─── Parser CT-e ────────────────────────────────────────────────────────────

function parseCTeXml(doc: Document, infCte: Element): ParsedXml {
    const ide = doc.getElementsByTagName('ide')[0];
    const emit = doc.getElementsByTagName('emit')[0];
    const rem = doc.getElementsByTagName('rem')[0];
    const dest = doc.getElementsByTagName('dest')[0];
    const vPrest = doc.getElementsByTagName('vPrest')[0];
    const imp = doc.getElementsByTagName('imp')[0];
    const icmsEl = imp ? imp.getElementsByTagName('ICMS')[0] : null;

    const chave = extractChaveFromId(infCte.getAttribute('Id') || '');

    const enderEmit = emit ? emit.getElementsByTagName('enderEmit')[0] : null;
    const enderRem = rem ? rem.getElementsByTagName('enderReme')[0] : null;
    const enderDest = dest ? dest.getElementsByTagName('enderDest')[0] : null;

    const emitente: DocumentoFiscalParticipante = {
        cnpjCpf: onlyDigits(getTextContent(emit, 'CNPJ') || getTextContent(emit, 'CPF')),
        nome: getTextContent(emit, 'xNome'),
        fantasia: getTextContent(emit, 'xFant') || undefined,
        ie: getTextContent(emit, 'IE') || undefined,
        uf: getTextContent(enderEmit, 'UF') || undefined,
        municipio: getTextContent(enderEmit, 'xMun') || undefined,
        codMunIBGE: getTextContent(enderEmit, 'cMun') || undefined,
    };

    // CT-e usa remetente como "contraparte principal" no campo destinatário
    // para manter compatibilidade com matchCompanyAndDirection
    const remetente: DocumentoFiscalParticipante = {
        cnpjCpf: onlyDigits(getTextContent(rem, 'CNPJ') || getTextContent(rem, 'CPF')),
        nome: getTextContent(rem, 'xNome'),
        fantasia: getTextContent(rem, 'xFant') || undefined,
        ie: getTextContent(rem, 'IE') || undefined,
        uf: getTextContent(enderRem, 'UF') || undefined,
        municipio: getTextContent(enderRem, 'xMun') || undefined,
        codMunIBGE: getTextContent(enderRem, 'cMun') || undefined,
    };

    const destinatario: DocumentoFiscalParticipante = {
        cnpjCpf: onlyDigits(getTextContent(dest, 'CNPJ') || getTextContent(dest, 'CPF')),
        nome: getTextContent(dest, 'xNome'),
        fantasia: getTextContent(dest, 'xFant') || undefined,
        ie: getTextContent(dest, 'IE') || undefined,
        uf: getTextContent(enderDest, 'UF') || undefined,
        municipio: getTextContent(enderDest, 'xMun') || undefined,
        codMunIBGE: getTextContent(enderDest, 'cMun') || undefined,
    };

    // ICMS do CT-e
    let vICMS = 0;
    let vBC = 0;
    if (icmsEl) {
        const inner = icmsEl.children[0];
        if (inner) {
            vICMS = num(getTextContent(inner, 'vICMS'));
            vBC = num(getTextContent(inner, 'vBC'));
        }
    }

    const valorPrest = num(getTextContent(vPrest, 'vTPrest'));
    const valorRec = num(getTextContent(vPrest, 'vRec'));

    const totais: DocumentoFiscalTotais = {
        vBC,
        vICMS,
        vICMSDeson: 0,
        vFCP: 0,
        vBCST: 0,
        vST: 0,
        vFCPST: 0,
        vProd: valorPrest,
        vFrete: valorPrest,
        vSeg: 0,
        vDesc: 0,
        vII: 0,
        vIPI: 0,
        vIPIDevol: 0,
        vPIS: 0,
        vCOFINS: 0,
        vOutro: 0,
        vNF: valorRec || valorPrest,
    };

    const cStat = getTextContent(doc.getElementsByTagName('infProt')[0], 'cStat');
    const status: XmlStatusDocumento =
        cStat === '100' ? 'autorizado'
        : cStat === '101' ? 'cancelado'
        : cStat === '110' ? 'denegado'
        : !cStat ? 'desconhecido'
        : 'rejeitado';

    return {
        chave,
        tipo: 'CTe',
        modelo: getTextContent(ide, 'mod') || '57',
        serie: getTextContent(ide, 'serie'),
        numero: getTextContent(ide, 'nCT'),
        natOp: getTextContent(ide, 'natOp'),
        dhEmi: getTextContent(ide, 'dhEmi'),
        status,
        emitente,
        destinatario: remetente.cnpjCpf ? remetente : destinatario,
        itens: [],
        totais,
        infAdic: getTextContent(doc.documentElement, 'infCpl') || undefined,
    };
}

// ─── Parser NFSe (ABRASF 1.0 / 2.0 / 2.04) ───────────────────────────────

/**
 * Faz parse de um XML de NFSe padrão ABRASF.
 * Aceita tanto <InfNfse> quanto <infNfse> (case-insensitive na detecção,
 * mas getElementsByTagName é case-sensitive, por isso tentamos ambas).
 *
 * Estrutura esperada:
 *   <CompNfse><Nfse><InfNfse>...</InfNfse></Nfse></CompNfse>
 * ou variantes onde <InfNfse> aparece diretamente.
 */
function parseNFSeXml(doc: Document, infNfse: Element | undefined): ParsedXml {
    // Se infNfse não foi passado, tenta navegar pela hierarquia ABRASF
    if (!infNfse) {
        const nfse = doc.getElementsByTagName('Nfse')[0]
            || doc.getElementsByTagName('nfse')[0];
        if (nfse) {
            infNfse = nfse.getElementsByTagName('InfNfse')[0]
                || nfse.getElementsByTagName('infNfse')[0];
        }
    }
    if (!infNfse) {
        throw new XmlParseError('XML NFSe inválida: tag <InfNfse> não encontrada.');
    }

    // ── Dados básicos ──────────────────────────────────────────────────────
    const numero = getTextContent(infNfse, 'Numero')
        || getTextContent(infNfse, 'NumeroNfse');
    const codigoVerificacao = getTextContent(infNfse, 'CodigoVerificacao');
    const dhEmi = getTextContent(infNfse, 'DataEmissao')
        || getTextContent(infNfse, 'DataEmissaoNfse');
    const competenciaTag = getTextContent(infNfse, 'Competencia');

    // ── Serviço ────────────────────────────────────────────────────────────
    const servico = infNfse.getElementsByTagName('Servico')[0]
        || infNfse.getElementsByTagName('servico')[0];
    const valores = servico
        ? (servico.getElementsByTagName('Valores')[0]
            || servico.getElementsByTagName('valores')[0])
        : null;

    const valorServicos = num(getTextContent(valores, 'ValorServicos'));
    const valorDeducoes = num(getTextContent(valores, 'ValorDeducoes'));
    const baseCalculo = num(getTextContent(valores, 'BaseCalculo')) || (valorServicos - valorDeducoes);
    const aliquotaIss = num(getTextContent(valores, 'Aliquota'));
    const valorIss = num(getTextContent(valores, 'ValorIss'));
    const issRetido = getTextContent(valores, 'IssRetido');
    const valorIssRetido = num(getTextContent(valores, 'ValorIssRetido'));
    const valorPis = num(getTextContent(valores, 'ValorPis'));
    const valorCofins = num(getTextContent(valores, 'ValorCofins'));
    const valorInss = num(getTextContent(valores, 'ValorInss'));
    const valorIr = num(getTextContent(valores, 'ValorIr'));
    const valorCsll = num(getTextContent(valores, 'ValorCsll'));
    const valorLiquido = num(getTextContent(valores, 'ValorLiquidoNfse'));
    const descontoCondicionado = num(getTextContent(valores, 'DescontoCondicionado'));
    const descontoIncondicionado = num(getTextContent(valores, 'DescontoIncondicionado'));

    const discriminacao = getTextContent(servico, 'Discriminacao')
        || getTextContent(servico, 'discriminacao');
    const itemListaServico = getTextContent(servico, 'ItemListaServico');
    const codigoCnae = getTextContent(servico, 'CodigoCnae');

    // ── Prestador ──────────────────────────────────────────────────────────
    const prestadorEl = infNfse.getElementsByTagName('PrestadorServico')[0]
        || infNfse.getElementsByTagName('prestadorServico')[0]
        || infNfse.getElementsByTagName('Prestador')[0];
    const identPrestador = prestadorEl
        ? (prestadorEl.getElementsByTagName('IdentificacaoPrestador')[0]
            || prestadorEl.getElementsByTagName('identificacaoPrestador')[0])
        : null;

    const prestadorCnpj = onlyDigits(
        getTextContent(identPrestador, 'Cnpj')
        || getTextContent(identPrestador, 'cnpj')
        || getTextContent(prestadorEl, 'Cnpj')
    );
    const prestadorCpf = onlyDigits(
        getTextContent(identPrestador, 'Cpf')
        || getTextContent(identPrestador, 'cpf')
    );

    const prestadorEnder = prestadorEl
        ? (prestadorEl.getElementsByTagName('Endereco')[0]
            || prestadorEl.getElementsByTagName('endereco')[0])
        : null;

    const emitente: DocumentoFiscalParticipante = {
        cnpjCpf: prestadorCnpj || prestadorCpf,
        nome: getTextContent(prestadorEl, 'RazaoSocial')
            || getTextContent(prestadorEl, 'razaoSocial')
            || getTextContent(prestadorEl, 'NomeFantasia'),
        fantasia: getTextContent(prestadorEl, 'NomeFantasia') || undefined,
        ie: getTextContent(identPrestador, 'InscricaoMunicipal')
            || getTextContent(identPrestador, 'inscricaoMunicipal') || undefined,
        uf: getTextContent(prestadorEnder, 'Uf')
            || getTextContent(prestadorEnder, 'uf') || undefined,
        codMunIBGE: getTextContent(prestadorEnder, 'CodigoMunicipio')
            || getTextContent(prestadorEnder, 'codigoMunicipio') || undefined,
        logradouro: getTextContent(prestadorEnder, 'Endereco')
            || getTextContent(prestadorEnder, 'endereco') || undefined,
        numero: getTextContent(prestadorEnder, 'Numero')
            || getTextContent(prestadorEnder, 'numero') || undefined,
        bairro: getTextContent(prestadorEnder, 'Bairro')
            || getTextContent(prestadorEnder, 'bairro') || undefined,
        cep: onlyDigits(getTextContent(prestadorEnder, 'Cep')
            || getTextContent(prestadorEnder, 'cep')) || undefined,
    };

    // ── Tomador ────────────────────────────────────────────────────────────
    const tomadorEl = infNfse.getElementsByTagName('TomadorServico')[0]
        || infNfse.getElementsByTagName('tomadorServico')[0]
        || infNfse.getElementsByTagName('Tomador')[0];
    const identTomador = tomadorEl
        ? (tomadorEl.getElementsByTagName('IdentificacaoTomador')[0]
            || tomadorEl.getElementsByTagName('identificacaoTomador')[0])
        : null;
    // ABRASF wraps CNPJ/CPF inside <CpfCnpj>
    const cpfCnpjTomador = identTomador
        ? (identTomador.getElementsByTagName('CpfCnpj')[0]
            || identTomador.getElementsByTagName('cpfCnpj')[0])
        : null;

    const tomadorCnpj = onlyDigits(
        getTextContent(cpfCnpjTomador, 'Cnpj')
        || getTextContent(cpfCnpjTomador, 'cnpj')
        || getTextContent(identTomador, 'Cnpj')
    );
    const tomadorCpf = onlyDigits(
        getTextContent(cpfCnpjTomador, 'Cpf')
        || getTextContent(cpfCnpjTomador, 'cpf')
        || getTextContent(identTomador, 'Cpf')
    );

    const tomadorEnder = tomadorEl
        ? (tomadorEl.getElementsByTagName('Endereco')[0]
            || tomadorEl.getElementsByTagName('endereco')[0])
        : null;

    const destinatario: DocumentoFiscalParticipante = {
        cnpjCpf: tomadorCnpj || tomadorCpf,
        nome: getTextContent(tomadorEl, 'RazaoSocial')
            || getTextContent(tomadorEl, 'razaoSocial')
            || getTextContent(tomadorEl, 'NomeFantasia') || '',
        fantasia: getTextContent(tomadorEl, 'NomeFantasia') || undefined,
        ie: getTextContent(identTomador, 'InscricaoMunicipal')
            || getTextContent(identTomador, 'inscricaoMunicipal') || undefined,
        uf: getTextContent(tomadorEnder, 'Uf')
            || getTextContent(tomadorEnder, 'uf') || undefined,
        codMunIBGE: getTextContent(tomadorEnder, 'CodigoMunicipio')
            || getTextContent(tomadorEnder, 'codigoMunicipio') || undefined,
        logradouro: getTextContent(tomadorEnder, 'Endereco')
            || getTextContent(tomadorEnder, 'endereco') || undefined,
        numero: getTextContent(tomadorEnder, 'Numero')
            || getTextContent(tomadorEnder, 'numero') || undefined,
        bairro: getTextContent(tomadorEnder, 'Bairro')
            || getTextContent(tomadorEnder, 'bairro') || undefined,
        cep: onlyDigits(getTextContent(tomadorEnder, 'Cep')
            || getTextContent(tomadorEnder, 'cep')) || undefined,
    };

    // ── Chave sintética (NFSe não tem chave de 44 dígitos) ─────────────────
    // Usa CodigoVerificacao quando presente; senão, monta Numero+CNPJ.
    const chave = codigoVerificacao
        || `NFSE-${numero}-${emitente.cnpjCpf}`;

    // ── Item único a partir de Serviço ─────────────────────────────────────
    const itens: DocumentoFiscalItem[] = [];
    if (servico) {
        itens.push({
            nItem: '1',
            cProd: itemListaServico || codigoCnae || '',
            xProd: discriminacao || 'Serviço',
            ncm: '',  // NFSe não usa NCM
            cfop: '',  // NFSe não usa CFOP
            uCom: 'SV',
            qCom: 1,
            vUnCom: valorServicos,
            vProd: valorServicos,
            vDesc: (descontoCondicionado + descontoIncondicionado) || undefined,
            vICMS: 0,
            vIPI: 0,
            vPIS: valorPis,
            vCOFINS: valorCofins,
            cst: '',
            orig: '',
        });
    }

    // ── Totais (mapeia para DocumentoFiscalTotais) ─────────────────────────
    const totais: DocumentoFiscalTotais = {
        vBC: baseCalculo,
        vICMS: 0,
        vICMSDeson: 0,
        vFCP: 0,
        vBCST: 0,
        vST: 0,
        vFCPST: 0,
        vProd: valorServicos,
        vFrete: 0,
        vSeg: 0,
        vDesc: descontoCondicionado + descontoIncondicionado,
        vII: 0,
        vIPI: 0,
        vIPIDevol: 0,
        vPIS: valorPis,
        vCOFINS: valorCofins,
        vOutro: 0,
        vNF: valorServicos,
    };

    // ── NatOp sintético ────────────────────────────────────────────────────
    const natOp = discriminacao
        ? `Prestação de serviço – LC ${itemListaServico || ''}`
        : 'Prestação de serviço';

    // ── Status ─────────────────────────────────────────────────────────────
    // NFSe emitida e presente no XML é sempre autorizada.
    // Cancelamento vem em XML separado (evento).
    const cancelada = getTextContent(infNfse, 'NfseCancelamento')
        || getTextContent(infNfse, 'DataHoraCancelamento')
        || getTextContent(doc.documentElement, 'NfseCancelamento');
    const status: XmlStatusDocumento = cancelada ? 'cancelado' : 'autorizado';

    return {
        chave,
        tipo: 'NFSe',
        modelo: '99',  // NFSe não tem modelo oficial; convencional = 99
        serie: '',       // NFSe não usa série
        numero,
        natOp,
        dhEmi,
        status,
        emitente,
        destinatario,
        itens,
        totais,
        infAdic: discriminacao || undefined,
        // Campos extras transportados via totais/itens para que
        // buildDocumentoFiscal possa preencher doc.valores no xmlFiscalService
        _nfseValores: {
            liquido: valorLiquido || (valorServicos - valorIssRetido - valorPis - valorCofins - valorInss - valorIr - valorCsll),
            iss: valorIss,
            issRetido: issRetido === '1' || issRetido === 'true',
            valorIssRetido,
            baseCalculo,
            deducoes: valorDeducoes,
            pis: valorPis,
            cofins: valorCofins,
            inss: valorInss,
            ir: valorIr,
            csll: valorCsll,
            aliquotaIss,
        },
    } as ParsedXml & { _nfseValores?: any };
}

// ─── Validação de empresa & direção ─────────────────────────────────────────

export interface CompanyMatchResult {
    ok: boolean;
    direcao: XmlDirecao;
    motivo?: string;
}

/**
 * Verifica se o CNPJ da empresa cadastrada aparece como emitente
 * (=> saída) ou destinatário (=> entrada). Se nenhum bater, retorna
 * `ok: false` para que o front rejeite a importação.
 */
export function matchCompanyAndDirection(
    parsed: ParsedXml,
    empresaCnpj: string,
): CompanyMatchResult {
    const emp = onlyDigits(empresaCnpj);
    if (!emp) {
        return { ok: false, direcao: 'desconhecida', motivo: 'CNPJ da empresa selecionada está vazio.' };
    }

    const emit = onlyDigits(parsed.emitente.cnpjCpf);
    const dest = onlyDigits(parsed.destinatario.cnpjCpf);

    if (emit === emp) return { ok: true, direcao: 'saida' };
    if (dest === emp) return { ok: true, direcao: 'entrada' };

    return {
        ok: false,
        direcao: 'desconhecida',
        motivo: `O CNPJ ${empresaCnpj} não consta como emitente nem destinatário deste XML (emit: ${emit || '-'}, dest: ${dest || '-'}).`,
    };
}

/**
 * Constrói o objeto DocumentoFiscal pronto para gravar no Firestore.
 * `id` deve ser fornecido externamente (em geral derivado da chave).
 */
export function buildDocumentoFiscal(input: {
    id: string;
    parsed: ParsedXml;
    xmlHash: string;
    direcao: XmlDirecao;
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;
    origem: DocumentoFiscal['origem'];
    importadoPor: string;
    importadoPorEmail?: string;
    fileName?: string;
    tamanhoBytes?: number;
    storagePath?: string;
    storageUrl?: string;
}): DocumentoFiscal {
    const { parsed } = input;
    const isNFSe = parsed.tipo === 'NFSe';
    const nfseValores = (parsed as any)._nfseValores;

    // Categoria de operação: NFSe usa prestador/tomador em vez de CFOP
    const categoriaOperacao = isNFSe
        ? (input.direcao === 'saida' ? 'servico_prestado' : 'servico_tomado')
        : classificarPorCfop(parsed.itens, input.direcao);

    const documento: DocumentoFiscal = {
        id: input.id,
        chave: parsed.chave,
        xmlHash: input.xmlHash,
        tipo: parsed.tipo,
        modelo: parsed.modelo,
        serie: parsed.serie,
        numero: parsed.numero,
        natOp: parsed.natOp,
        dhEmi: parsed.dhEmi,
        competencia: competenciaFromIso(parsed.dhEmi),
        direcao: input.direcao,
        categoriaOperacao,
        status: parsed.status,
        empresaId: input.empresaId,
        empresaCnpj: onlyDigits(input.empresaCnpj),
        empresaNome: input.empresaNome,
        // NFSe: usa prestador/tomador; NF-e/CT-e: usa emitente/destinatario
        ...(isNFSe
            ? { prestador: parsed.emitente, tomador: parsed.destinatario }
            : { emitente: parsed.emitente, destinatario: parsed.destinatario }),
        totais: parsed.totais,
        // NFSe valores adicionais (ISS, líquido, etc.)
        ...(isNFSe && nfseValores ? {
            valores: {
                liquido: nfseValores.liquido,
                pis: nfseValores.pis,
                cofins: nfseValores.cofins,
                iss: nfseValores.iss,
                baseCalculo: nfseValores.baseCalculo,
                deducoes: nfseValores.deducoes,
                // Retenções federais + ISS retido: o parser sempre extraiu,
                // mas eram descartados aqui — o relatório de Retenções (01/08)
                // precisa deles gravados.
                ir: nfseValores.ir,
                inss: nfseValores.inss,
                csll: nfseValores.csll,
                issRetido: nfseValores.issRetido,
                valorIssRetido: nfseValores.valorIssRetido,
            },
        } : {}),
        itens: parsed.itens,
        infAdic: parsed.infAdic,
        storagePath: input.storagePath,
        storageUrl: input.storageUrl,
        tamanhoBytes: input.tamanhoBytes,
        fileName: input.fileName,
        origem: input.origem,
        importadoPor: input.importadoPor,
        importadoPorEmail: input.importadoPorEmail,
        importadoEm: Date.now(),
        createdBy: input.importadoPor,
        createdByEmail: input.importadoPorEmail,
    };
    return documento;
}

// ─── Formatadores reutilizáveis (UI) ────────────────────────────────────────

export function formatCnpjCpf(val: string): string {
    if (!val) return '-';
    const v = onlyDigits(val);
    if (v.length === 14) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (v.length === 11) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return val;
}

export function formatCurrency(val: number | string): string {
    const n = typeof val === 'string' ? num(val) : val;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(iso: string): string {
    if (!iso) return '-';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return iso;
    }
}
