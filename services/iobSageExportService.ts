/**
 * iobSageExportService.ts
 * Mapeia DocumentoFiscal -> registros Folhamatic Fiscal e gera arquivo .FML
 * em codificacao Windows-1252.
 */

import { buildFile, buildRecord, LAYOUT_VERSION } from './iobSageLayout';
import { LAYOUT } from './iobSageLayoutData';
import type { DocumentoFiscal, DocumentoFiscalItem } from '../types';

// ─── Sanitizacao ───────────────────────────────────────────────────────────

/** Remove acentos (para campos tipo A). */
function sanitizeAlfa(s: string | undefined): string {
    if (!s) return '';
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 \-]/g, ' ');
}

/** Remove pipe e caracteres incompativeis com Windows-1252 (para campos X). */
function sanitizeTexto(s: string | undefined): string {
    if (!s) return '';
    return s.replace(/\|/g, ' ');
}

/** Converte 'AAAAMMDD' para Date (UTC). */
function parseIsoDate(iso?: string): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d : null;
}

// ─── Encoder Windows-1252 ──────────────────────────────────────────────────
// Mapeamento da faixa 0x80-0x9F (caracteres especificos do Windows-1252).
const WIN1252_HIGH: Record<number, number> = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
    0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
    0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
    0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};

/** Converte string UTF-16 em Uint8Array Windows-1252. Substitui caracteres fora da faixa por '?'. */
export function encodeWindows1252(text: string): Uint8Array {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) {
            out[i] = code;
        } else if (code <= 0xFF && (code < 0x80 || code > 0x9F)) {
            // 0xA0-0xFF mapeia 1:1 entre UTF-16 e Windows-1252.
            out[i] = code;
        } else if (WIN1252_HIGH[code] !== undefined) {
            out[i] = WIN1252_HIGH[code];
        } else {
            out[i] = 0x3F; // '?'
        }
    }
    return out;
}

// ─── Helpers de mapeamento ────────────────────────────────────────────────

const onlyDigits = (s: string | undefined) => (s || '').replace(/\D+/g, '');

function dateAAAAMMDD(d: Date): string {
    const y = d.getFullYear().toString().padStart(4, '0');
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}${m}${d}`.length === 8 ? `${y}${m}${day}` : `${y}${m}${day}`;
}

/**
 * Formata NCM no padrao IOB/SAGE: "9999.99.99" (8 digitos com pontos).
 * Aceita NCM cru ('78030000'), com pontos ('7803.00.00'), com tamanho irregular.
 * Retorna string vazia se NCM nao tem pelo menos 8 digitos.
 *
 * IOB Folhamatic Fiscal exige formato '9999.99.99' ou '9999.99.99EX99' no E020 campo 12.
 * NCM crua do XML SEFAZ vem como 8 digitos sem pontos -> precisa formatar.
 */
function formatNcm(ncm: string | undefined): string {
    if (!ncm) return '';
    const digits = ncm.replace(/\D/g, '');
    if (digits.length < 8) return ''; // NCM invalido, deixa vazio (campo nao obrigatorio)
    const base = digits.slice(0, 8);
    return `${base.slice(0, 4)}.${base.slice(4, 6)}.${base.slice(6, 8)}`;
}

/** Codigo da empresa para o campo CODIGO DO CLIENTE/FORNECEDOR (max 20 chars). */
function codigoParticipante(cnpjCpf: string): string {
    const digits = onlyDigits(cnpjCpf);
    return digits.length === 0 ? 'SEMCNPJ' : digits.slice(0, 20);
}

/** Codigo de produto: cProd da NF (sanitizado para 14 chars). */
function codigoProduto(cProd: string): string {
    if (!cProd) return 'SEMCODIGO';
    return cProd.replace(/[^A-Za-z0-9]/g, '').slice(0, 14) || 'SEMCODIGO';
}

interface ExportarParams {
    /** Documentos a exportar. */
    documentos: DocumentoFiscal[];
    /** Numero da empresa no E-Fiscal (campo NÚMERO DA EMPRESA do E001). */
    numeroEmpresaEfiscal: number;
    /** UF da empresa (para emitter de saidas). */
    ufEmpresa?: string;
}

interface RegistroPrep {
    /** Linha pronta de tamanho fixo. */
    linha: string;
    /** Tipo do registro para ordenacao no arquivo final. */
    tipo: 'E001' | 'E010' | 'E020' | 'E200' | 'E201' | 'E221' | 'E222' | 'E342';
    /** Chave de ordenacao secundaria (numero da NF para E200..E342). */
    ordem?: number;
}

// ─── Construtores de registros por DocumentoFiscal ────────────────────────

function buildE001(numeroEmpresa: number): string {
    return buildRecord(LAYOUT.E001, {
        'NÚMERO DA EMPRESA': numeroEmpresa,
        'VERSÃO LAYOUT': LAYOUT_VERSION,
        'CONTROLE DO SISTEMA': 0,
    });
}

function buildE010(d: DocumentoFiscal): string {
    // Participante a cadastrar = quem NAO e a empresa monitorada.
    // Guard: IOB/SAGE so aceita NFe/NFCe (modelo 55/65). NFSe nao deveria chegar aqui
    // por conta do filtro em XmlExportarIobSage, mas falhamos cedo se vazar.
    if (d.tipo === 'NFSe') {
        throw new Error(`buildE010: documento ${d.id} e NFSe, nao suportado em IOB/SAGE Folhamatic Fiscal.`);
    }
    const part = d.direcao === 'entrada' ? d.emitente : d.destinatario;
    if (!part) {
        throw new Error(`buildE010: documento ${d.id} sem ${d.direcao === 'entrada' ? 'emitente' : 'destinatario'} (esperado em NFe).`);
    }
    const isCliente = d.direcao === 'saida';
    const isFornecedor = d.direcao === 'entrada';

    return buildRecord(LAYOUT.E010, {
        'CÓDIGO DO CLIENTE/FORNECEDOR': codigoParticipante(part.cnpjCpf),
        'NOME': sanitizeTexto(part.nome).slice(0, 100),
        'DATA DE INCLUSÃO': new Date(d.importadoEm),
        'TIPO DE LOGRADOURO': 'RUA',
        'LOGRADOURO': '',
        'NÚMERO DO LOGRADOURO': 'S/N',
        'COMPLEMENTO DO LOGRADOURO': '',
        'BAIRRO': '',
        'ESTADO': sanitizeAlfa(part.uf || '').slice(0, 2).toUpperCase() || '  ',
        'CIDADE': 0,
        'CEP': 0,
        'PAÍS': 1058, // Brasil
        'CNPJ/CPF': onlyDigits(part.cnpjCpf).padEnd(14, ' ').slice(0, 14),
        'INSCRIÇÃO ESTADUAL': sanitizeTexto(part.ie || '').slice(0, 18),
        'INSCRIÇÃO MUNICIPAL': '',
        'INSCRIÇÃO SUFRAMA': '',
        'CONTATO': '',
        'TELEFONE': '',
        'FAX': '',
        'CLIENTE': isCliente ? 'S' : 'N',
        'FORNECEDOR': isFornecedor ? 'S' : 'N',
        'PRODUTOR RURAL': 'N',
        'FORNECEDOR SUBSTITUTO TRIBUTÁRIO': 'N',
        'SIMPLES NACIONAL': 'N',
        'INSCRITO NO MUNICÍPIO': 'N',
        // Campos S/N abaixo: IOB exige preenchimento explicito (default 'N').
        // Sem eles, formatField enche com espaco em branco e IOB rejeita.
        'HOSPEDAGEM DE SITES E BANCO DE DADOS': 'N',
        'GATEWAY DE PAGAMENTOS': 'N',
        'PROVIMENTOS DE SOLUÇÕES': 'N',
        'CONTROLE DO SISTEMA': 0,
    });
}

function buildE020(item: DocumentoFiscalItem, dataInclusao: Date): string {
    const uCom = sanitizeTexto(item.uCom || 'UN').slice(0, 6) || 'UN';
    return buildRecord(LAYOUT.E020, {
        'CÓDIGO DO PRODUTO/SERVIÇO': codigoProduto(item.cProd),
        'DESCRIÇÃO DO PRODUTO/SERVIÇO': sanitizeTexto(item.xProd).slice(0, 60),
        'DATA DA INCLUSÃO DO PRODUTO/SERVIÇO': dataInclusao,
        'PERÍODO INICIAL DE UTILIZAÇÃO DO PRODUTO/SERVIÇO': dataInclusao,
        'GÊNERO DO ITEM': '',
        'TIPO DO PRODUTO': '01', // Mercadoria de Revenda (default)
        'TIPO PARA O INVENTÁRIO': 1,
        'NBM/SH': formatNcm(item.ncm),
        'CÓDIGO DE BARRA': '',
        'COMBUSTÍVEL/SOLVENTE': 'N',
        'CÓD.UNID.COMERCIAL': uCom,
        'CÓD. UNID. ESTOQUE': uCom,
        'FATOR DE CONVERSÃO': 0,
        'CÓDIGO DO PRODUTO (DNF)': 0,
        'FATOR DE CONV. PARA A UNID. MED. EST. (DNF)': 0,
        'CAPACIDADE VOLUMÉTRICA (ML)': 0,
        'ALÍQ. IPI': 0,
        'ALÍQ. ICMS': 0,
        'ADICIONAL ALÍQ. ICMS': 0,
        'ADICIONAL ALÍQ. ICMS (RJ)': 'N',
        '% RED. BASE CÁLC. ICMS': 0,
        'UNIT. BASE ICMS ST': 0,
        'CONTROLE DO SISTEMA': 0,
    });
}

function commonNF(d: DocumentoFiscal) {
    // Guard: mesmo motivo do buildE010.
    if (d.tipo === 'NFSe') {
        throw new Error(`commonNF: documento ${d.id} e NFSe, nao suportado em IOB/SAGE.`);
    }
    const part = d.direcao === 'entrada' ? d.emitente : d.destinatario;
    if (!part) {
        throw new Error(`commonNF: documento ${d.id} sem ${d.direcao === 'entrada' ? 'emitente' : 'destinatario'}.`);
    }
    const especie = d.tipo === 'NFCe' ? 'NFCE' : d.tipo === 'NFe' ? 'NFE' : 'NF';
    const dEmi = parseIsoDate(d.dhEmi) || new Date();
    return {
        es: d.direcao === 'entrada' ? 'E' : 'S',
        especie,
        serie: (d.serie || '1').slice(0, 3),
        subserie: '',
        numero: parseInt(d.numero || '0', 10) || 0,
        codigoPart: codigoParticipante(part.cnpjCpf),
        dEmi,
        ufNF: sanitizeAlfa(part.uf || '').slice(0, 2).toUpperCase() || '  ',
        modelo: d.modelo || (d.tipo === 'NFCe' ? '65' : '55'),
    };
}

/**
 * Mapeia tpFrete SEFAZ -> codigo IOB Folhamatic.
 * SEFAZ:  0=Emitente, 1=Destinatario, 2=Terceiros, 9=Sem frete
 * IOB:    1=Emitente, 2=Destinatario, 3=Terceiros, 9=Sem frete
 * Se valor invalido ou ausente, retorna 9 (sem frete) - seguro pro IOB nao reclamar.
 */
function mapTipoFrete(tpFrete: unknown): number {
    const v = String(tpFrete ?? '').trim();
    switch (v) {
        case '0': return 1; // SEFAZ "Emitente" -> IOB "1"
        case '1': return 2; // SEFAZ "Destinatario" -> IOB "2"
        case '2': return 3; // SEFAZ "Terceiros" -> IOB "3"
        case '9': return 9;
        default:  return 9; // ausente/invalido -> sem frete
    }
}

function buildE200(d: DocumentoFiscal): string {
    const c = commonNF(d);
    const situacao =
        d.status === 'cancelado' ? 2
        : d.status === 'denegado' ? 4
        : d.status === 'inutilizado' ? 5
        : 0;

    return buildRecord(LAYOUT.E200, {
        'ENTRADAS OU SAÍDAS': c.es,
        'ESPÉCIE N.F.': c.especie,
        'SÉRIE N.F.': c.serie,
        'SUBSÉRIE N.F': c.subserie,
        'Nº INICIAL DA N. F.': c.numero,
        'Nº FINAL DA N. F': c.es === 'S' ? c.numero : 0,
        'CÓDIGO DO CLIENTE/FORNECEDOR': c.codigoPart,
        'DATA DE EMISSÃO': c.dEmi,
        'DATA DE ENTRADA/SAÍDA': c.dEmi,
        'UF DA N.F.': c.ufNF,
        'MODELO DA N.F.': c.modelo,
        'EMITENTE DA N.F.': c.es === 'S' ? 'P' : 'T',
        'SITUAÇÃO DA N.F.': situacao,
        // SEFAZ aceita: 0=Emitente, 1=Destinatario, 2=Terceiros, 9=Sem frete.
        // IOB Folhamatic exige 1/2/3/9 (mapeamento DIFERENTE: 1=Emi, 2=Dest, 3=3os, 9=Sem).
        // Se tpFrete vier do XML SEFAZ, mapeia. Senao, default 9 (sem frete) que e seguro.
        'TIPO DO FRETE': mapTipoFrete((d as any).tpFrete),
        'VALOR CONTÁBIL': d.totais?.vNF || 0,
        'Nº LINHAS DE LANÇAMENTO': calcQtdCfops(d),
        'DATA DE LANÇAMENTO NO SISTEMA': c.dEmi,
    });
}

/** Quantidade de CFOPs unicos (para E200 e contador de E201). */
function calcQtdCfops(d: DocumentoFiscal): number {
    return new Set((d.itens || []).map(i => i.cfop).filter(Boolean)).size || 1;
}

function buildE201sFromDoc(d: DocumentoFiscal): string[] {
    const c = commonNF(d);
    const linhas: string[] = [];

    // Agrupa itens por CFOP.
    const porCfop = new Map<string, DocumentoFiscalItem[]>();
    for (const it of d.itens || []) {
        const cfop = it.cfop || '0000';
        if (!porCfop.has(cfop)) porCfop.set(cfop, []);
        porCfop.get(cfop)!.push(it);
    }

    let seq = 0;
    for (const [cfop, itens] of porCfop.entries()) {
        seq++;
        const sumProd = itens.reduce((a, i) => a + (i.vProd || 0), 0);
        const sumICMS = itens.reduce((a, i) => a + (i.vICMS || 0), 0);
        const sumIPI = itens.reduce((a, i) => a + (i.vIPI || 0), 0);
        // Aliquota efetiva: ICMS / base. Se sem base, deixa zero.
        const aliquota = sumProd > 0 && sumICMS > 0 ? (sumICMS / sumProd) * 100 : 0;

        linhas.push(buildRecord(LAYOUT.E201, {
            'ENTRADAS OU SAÍDAS': c.es,
            'ESPÉCIE N.F.': c.especie,
            'SÉRIE N.F': c.serie,
            'SUBSÉRIE N.F': c.subserie,
            'NÚMERO N.F.': c.numero,
            'CÓDIGO DO CLIENTE/FORNECEDOR': c.codigoPart,
            'CFOP': parseInt(cfop, 10) || 0,
            'TIPO DE PAGAMENTO': 0,
            'BC ICMS': sumProd,
            'CÓDIGO TURBO': 0,
            'REDUÇÃO BASE CÁLC. ICMS': 0,
            'ALÍQUOTA DO ICMS': aliquota,
            'VALOR DO ICMS': sumICMS,
            'ISENTOS DE ICMS': 0,
            'OUTRAS DE ICMS': 0,
            'ICMS SUBST. TRIB.': 0,
            'BASE SUBST. TRIB.': 0,
            'BC IPI': 0,
            'VALOR DO IPI': sumIPI,
            'ISENTOS DE IPI': 0,
            'OUTRAS DE IPI': 0,
            'CONTRIBUINTE DO ICMS': 'S',
            'OBSERVAÇÃO DA LINHA DE LANÇAMENTO': '',
            'Nº SEQUENCIAL DO LANÇAMENTO': seq,
            // Campos S/N abaixo: IOB exige preenchimento explicito (default 'N').
            // Sem eles, formatField enche com espaco e IOB rejeita o E201,
            // o que faz E342 reportar "NF nao cadastrada" em cascata.
            'VENDA P/ ENTREGA FUTURA': 'N',
            'OPERAÇÕES SUBST TRIB SAÍDAS': 'N',
            'CIAP SAÍDA TRIBUTADA': 'N',
            'CONTROLE DO SISTEMA': 0,
        }));
    }
    return linhas;
}

function buildE221(d: DocumentoFiscal): string {
    const c = commonNF(d);
    return buildRecord(LAYOUT.E221, {
        'ENTRADAS OU SAÍDAS': c.es,
        'ESPÉCIE N.F.': c.especie,
        'SÉRIE N.F.': c.serie,
        'SUBSÉRIE N.F.': c.subserie,
        'NÚMERO N.F.': c.numero,
        'CÓDIGO DO CLIENTE/FORNECEDOR': c.codigoPart,
        'FRETE': d.totais?.vFrete || 0,
        'SEGURO': d.totais?.vSeg || 0,
        'DESPESAS ACESSÓRIAS': d.totais?.vOutro || 0,
        'QUANTIDADE DE ITENS DA N.F.': (d.itens || []).length,
        'PIS/COFINS': 0,
        'PESO BRUTO': 0,
        'PESO LÍQUIDO': 0,
        'VIA DE TRANSPORTE': 0,
        'QTDE DE VOLUMES': 0,
        'CONTROLE DO SISTEMA': 0,
    });
}

function buildE222sFromDoc(d: DocumentoFiscal): string[] {
    const c = commonNF(d);
    return (d.itens || []).map((it, idx) => {
        const aliquota = it.vProd > 0 && it.vICMS > 0 ? (it.vICMS / it.vProd) * 100 : 0;
        return buildRecord(LAYOUT.E222, {
            'ENTRADAS OU SAÍDAS': c.es,
            'ESPÉCIE N.F.': c.especie,
            'SÉRIE N.F.': c.serie,
            'SUBSÉRIE N.F.': c.subserie,
            'NÚMERO N.F.': c.numero,
            'CÓDIGO DO CLIENTE/FORNECEDOR': c.codigoPart,
            'Nº ITEM': parseInt(it.nItem || String(idx + 1), 10) || (idx + 1),
            'CFOP': it.cfop || '',
            'CÓDIGO DO PRODUTO/SERVIÇO': codigoProduto(it.cProd),
            'ALÍQUOTA DO ICMS': aliquota,
            'QUANTIDADE': it.qCom || 0,
            'VLR.MERCADORIA/SERVIÇO': it.vProd || 0,
            'VALOR DO DESCONTO': it.vDesc || 0,
            'BASE DE CÁLCULO DO ICMS': it.vProd || 0,
            'BASE SUBST. TRIB.': 0,
            'VALOR DO IPI': it.vIPI || 0,
            'VALOR UNITÁRIO': it.vUnCom || 0,
            'BC DO IPI': 0,
            'VALOR DO ICMS': it.vICMS || 0,
            'ISENTOS DE ICMS': 0,
            'OUTROS DE ICMS': 0,
            'ICMS SUBST. TRIB.': 0,
            'MOVIMENTAÇÃO FÍSICA DA MERCADORIA': 'S',
            'ISENTOS DE IPI': 0,
            'OUTROS DE IPI': 0,
            'ITEM CANCELADO': 'N',
            'ISS': 'N',
            'CÓDIGO UNID. COMERCIAL': sanitizeTexto(it.uCom || 'UN').slice(0, 6) || 'UN',
            'DESCRIÇÃO COMPLEMENTAR DO PRODUTO': '',
            'FRETE NO TOTAL DA NF': 'N',
            'SEGURO NO TOTAL DA NF': 'N',
            'DESPESAS ACESSÓRIAS NO TOTAL DA NF': 'N',
            'DESCONTO INCONDICIONAL': it.vDesc && it.vDesc > 0 ? 'S' : 'N',
            'CONTROLE DO SISTEMA': 0,
        });
    });
}

function buildE342(d: DocumentoFiscal): string | null {
    if (!d.chave || d.chave.length !== 44) return null;
    const c = commonNF(d);
    return buildRecord(LAYOUT.E342, {
        'ENTRADAS OU SAÍDAS': c.es,
        'ESPÉCIE N.F.': c.especie,
        'SÉRIE N.F.': c.serie,
        'SUBSÉRIE N.F.': c.subserie,
        'NÚMERO N.F.': c.numero,
        'CÓDIGO DO CLIENTE': c.codigoPart,
        'CHAVE DA NF-E/CT-E/CF-E/NFC-E': d.chave,
        'CONTROLE DO SISTEMA': 0,
    });
}

// ─── Geracao do arquivo .FML completo ──────────────────────────────────────

export interface ExportarResult {
    blob: Blob;
    fileName: string;
    totalLinhas: number;
    estatisticas: {
        documentos: number;
        participantes: number;
        produtos: number;
        e201: number;
        e222: number;
    };
}

export function exportarParaIobSage(params: ExportarParams): ExportarResult {
    const { documentos, numeroEmpresaEfiscal } = params;
    if (!documentos.length) {
        throw new Error('Nenhum documento para exportar.');
    }

    // 1. E001 (uma vez).
    const e001 = buildE001(numeroEmpresaEfiscal);

    // 2. E010 — um por participante unico (CNPJ/CPF).
    const e010Set = new Map<string, string>();
    for (const d of documentos) {
        try {
            const part = d.direcao === 'entrada' ? d.emitente : d.destinatario;
            if (!part) continue;
            const cnpj = onlyDigits(part.cnpjCpf);
            if (!cnpj || e010Set.has(cnpj)) continue;
            e010Set.set(cnpj, buildE010(d));
        } catch (err) {
            console.warn('Falha E010 para', d.id, err);
        }
    }

    // 3. E020 — um por produto unico (cProd).
    const e020Set = new Map<string, string>();
    for (const d of documentos) {
        const dataInclusao = parseIsoDate(d.dhEmi) || new Date(d.importadoEm);
        for (const it of d.itens || []) {
            const cod = codigoProduto(it.cProd);
            if (e020Set.has(cod)) continue;
            try {
                e020Set.set(cod, buildE020(it, dataInclusao));
            } catch (err) {
                console.warn('Falha E020 para item', cod, err);
            }
        }
    }

    // 4. E200 + E201 + E221 + E222 + E342 — agrupados por nota.
    const blocosPorNota: string[][] = [];
    let count201 = 0;
    let count222 = 0;
    for (const d of documentos) {
        const bloco: string[] = [];
        try {
            bloco.push(buildE200(d));
            const e201s = buildE201sFromDoc(d);
            bloco.push(...e201s);
            count201 += e201s.length;

            if ((d.itens || []).length > 0) {
                bloco.push(buildE221(d));
                const e222s = buildE222sFromDoc(d);
                bloco.push(...e222s);
                count222 += e222s.length;
            }

            const e342 = buildE342(d);
            if (e342) bloco.push(e342);

            blocosPorNota.push(bloco);
        } catch (err) {
            console.warn('Falha bloco da NF', d.numero, err);
        }
    }

    // 5. Concatena na ordem: E001, E010s, E020s, blocos por nota.
    const linhas: string[] = [
        e001,
        ...Array.from(e010Set.values()),
        ...Array.from(e020Set.values()),
        ...blocosPorNota.flat(),
    ];

    const conteudo = buildFile(linhas, /* appendEOF */ true);
    const bytes = encodeWindows1252(conteudo);
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });

    const competencia = documentos[0]?.competencia?.replace(/[^0-9]/g, '') || 'sem-comp';
    const empresa = (documentos[0]?.empresaCnpj || '').replace(/[^0-9]/g, '').slice(0, 14) || 'empresa';
    const fileName = `EFISCAL_${empresa}_${competencia}.FML`;

    return {
        blob,
        fileName,
        totalLinhas: linhas.length,
        estatisticas: {
            documentos: documentos.length,
            participantes: e010Set.size,
            produtos: e020Set.size,
            e201: count201,
            e222: count222,
        },
    };
}

/** Dispara download no navegador. */
export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
