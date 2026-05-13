/**
 * xmlParserService.ts
 * Parser de XMLs fiscais (NFe / NFCe / NFSe / CTe).
 *
 * Extraído do componente ImportaXML.tsx para permitir reaproveitamento entre
 * importação manual, captura SEFAZ e captura SharePoint.
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
    return found[0].textContent?.trim() || '';
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

/**
 * Faz o parse de um XML de NFe/NFCe.
 * Lança XmlParseError quando o documento é inválido ou não suportado.
 */
export function parseNFeXml(xmlText: string): ParsedXml {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    if (doc.querySelector('parsererror')) {
        throw new XmlParseError('Arquivo XML inválido ou corrompido.');
    }

    const infNFe = doc.getElementsByTagName('infNFe')[0];
    if (!infNFe) {
        // NFSe / CTe ainda não suportados nesta primeira entrega.
        throw new XmlParseError('XML não é uma NFe/NFCe válida (tag <infNFe> ausente).');
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
                orig = getTextContent(icmsInner, 'orig');
            }
        }

        let vIPI = 0;
        let aliqIPI = 0;
        if (ipi) {
            const ipiTrib = ipi.getElementsByTagName('IPITrib')[0];
            if (ipiTrib) {
                vIPI = num(getTextContent(ipiTrib, 'vIPI'));
                aliqIPI = num(getTextContent(ipiTrib, 'pIPI'));
            }
        }

        let vPIS = 0;
        let aliqPIS = 0;
        if (pis) {
            const pisInner = pis.children[0];
            if (pisInner) {
                vPIS = num(getTextContent(pisInner, 'vPIS'));
                aliqPIS = num(getTextContent(pisInner, 'pPIS'));
            }
        }

        let vCOFINS = 0;
        let aliqCOFINS = 0;
        if (cofins) {
            const cofinsInner = cofins.children[0];
            if (cofinsInner) {
                vCOFINS = num(getTextContent(cofinsInner, 'vCOFINS'));
                aliqCOFINS = num(getTextContent(cofinsInner, 'pCOFINS'));
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
            vIPI,
            aliqIPI,
            vPIS,
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
    return {
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
        status: parsed.status,
        empresaId: input.empresaId,
        empresaCnpj: onlyDigits(input.empresaCnpj),
        empresaNome: input.empresaNome,
        emitente: parsed.emitente,
        destinatario: parsed.destinatario,
        totais: parsed.totais,
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
