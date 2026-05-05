/**
 * nfsePdfParserService.ts
 * Parser de PDFs de NFSe (Nota Fiscal de Servicos Eletronica).
 *
 * Estrategia: extrai texto via pdfjs-dist e procura labels universais
 * usadas pelos sistemas Publica/ABRASF (cobre maioria dos municipios SC
 * e varios outros). Retorna estrutura editavel que o colaborador
 * valida antes de salvar.
 *
 * NAO funciona em PDFs digitalizados (foto/scan) — apenas PDFs gerados
 * por sistema com texto extraivel.
 */

import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined') {
    // Worker via CDN (versao em runtime, sem precisar copiar arquivo)
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface NfsePdfParticipante {
    cnpj: string;
    inscricaoMunicipal: string;
    nome: string;
    nomeFantasia: string;
    endereco: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
    email: string;
    telefone: string;
}

export interface NfsePdfParsed {
    numero: string;
    serie: string;
    competencia: string;
    dataEmissao: string;
    codigoVerificacao: string;
    municipioPrestacao: string;
    chaveAcesso: string;

    prestador: NfsePdfParticipante;
    tomador: NfsePdfParticipante;

    codigoServico: string;
    discriminacao: string;
    naturezaOperacao: string;

    valorServicos: number;
    baseCalculo: number;
    aliquotaIss: number;
    valorIss: number;
    valorIssRetido: number;
    valorPis: number;
    valorCofins: number;
    valorInss: number;
    valorIrrf: number;
    valorCsll: number;
    valorOutrasRetencoes: number;
    valorDeducoes: number;
    valorDescIncondicional: number;
    valorDescCondicional: number;
    valorLiquido: number;

    municipioEmissor: string;
    rawText: string;
}

export class NfsePdfParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NfsePdfParseError';
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const onlyDigits = (s: string): string => (s || '').replace(/\D+/g, '');

function parseValor(s: string | undefined): number {
    if (!s) return 0;
    const cleaned = String(s).replace(/[^\d,.-]/g, '').trim();
    if (!cleaned) return 0;
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
}

function findAfter(text: string, label: string, maxChars = 200): string {
    const idx = text.indexOf(label);
    if (idx === -1) return '';
    return text.slice(idx + label.length, idx + label.length + maxChars);
}

function findValueByLabel(text: string, labels: string[], pattern: RegExp): string {
    for (const label of labels) {
        const after = findAfter(text, label);
        const match = after.match(pattern);
        if (match) return (match[1] || match[0]).trim();
    }
    return '';
}

const empty = (): NfsePdfParticipante => ({
    cnpj: '', inscricaoMunicipal: '', nome: '', nomeFantasia: '',
    endereco: '', bairro: '', municipio: '', uf: '', cep: '',
    email: '', telefone: '',
});

async function extractText(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const pageText = content.items
            .map((item: any) => ('str' in item ? item.str : ''))
            .join('\n');
        fullText += pageText + '\n';
    }
    return fullText;
}

function parsePartie(block: string): NfsePdfParticipante {
    const p = empty();
    if (!block) return p;

    const cnpjMatch = block.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    if (cnpjMatch) p.cnpj = cnpjMatch[1];
    else {
        const cpfMatch = block.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
        if (cpfMatch) p.cnpj = cpfMatch[1];
    }
    const ieMatch = block.match(/Inscri[c\u00e7][a\u00e3]o\s+Municipal\s*:?\s*(\d+)/i);
    if (ieMatch) p.inscricaoMunicipal = ieMatch[1];
    const nomeEmpresarialMatch = block.match(/Nome\s+empresarial\s*:?\s*([^\n]+)/i);
    if (nomeEmpresarialMatch) p.nome = nomeEmpresarialMatch[1].trim();
    else {
        const nomeMatch = block.match(/Nome\s*:?\s*([^\n]+)/i);
        if (nomeMatch) p.nome = nomeMatch[1].trim();
    }
    const fantasiaMatch = block.match(/Nome\s+fantasia\s*:?\s*([^\n]+)/i);
    if (fantasiaMatch) p.nomeFantasia = fantasiaMatch[1].trim();
    const enderecoMatch = block.match(/Endere[c\u00e7]o\s*:?\s*([^\n]+)/i);
    if (enderecoMatch) p.endereco = enderecoMatch[1].trim();
    const bairroMatch = block.match(/Bairro\s*:?\s*([^\n]+)/i);
    if (bairroMatch) p.bairro = bairroMatch[1].trim();
    const municipioMatch = block.match(/Munic[i\u00ed]pio\s*:?\s*([^\n]+?)(?:\s+UF\s*:|\n|$)/i);
    if (municipioMatch) p.municipio = municipioMatch[1].trim();
    const ufMatch = block.match(/UF\s*:?\s*([A-Z]{2})/);
    if (ufMatch) p.uf = ufMatch[1];
    const cepMatch = block.match(/CEP\s*:?\s*(\d{5}-?\d{3})/i);
    if (cepMatch) p.cep = cepMatch[1];
    const emailMatch = block.match(/E-?mail\s*:?\s*([^\s\n]+@[^\s\n]+)/i);
    if (emailMatch) p.email = emailMatch[1];
    const foneMatch = block.match(/Fone\s*:?\s*([\d\s\-()]+)/i);
    if (foneMatch) p.telefone = foneMatch[1].trim();
    return p;
}

export async function parseNfsePdf(file: File): Promise<NfsePdfParsed> {
    const text = await extractText(file);
    if (!text || text.length < 100) {
        throw new NfsePdfParseError(
            'Nao foi possivel extrair texto do PDF. Pode ser uma NFSe digitalizada (imagem) — nao suportado.',
        );
    }

    const upperText = text.toUpperCase();
    if (
        !upperText.includes('NFS-E') &&
        !upperText.includes('NFSE') &&
        !upperText.includes('NOTA FISCAL DE SERVI')
    ) {
        throw new NfsePdfParseError('Documento nao parece ser uma NFSe.');
    }

    // Cabecalho
    let numero = '';
    let serie = '';
    const numSerieMatch = text.match(/(\d{6,})\s*\/\s*(\w+)/);
    if (numSerieMatch) {
        numero = numSerieMatch[1];
        serie = numSerieMatch[2];
    }

    const dataEmissao = findValueByLabel(
        text,
        ['Data e Hora da Emissao', 'Data e Hora da Emissão', 'Data de Emissao', 'Data de Emissão'],
        /(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/,
    );
    const competencia = findValueByLabel(text, ['Competencia', 'Competência'], /(\d{1,2}\/\d{4})/);
    const codigoVerificacao = findValueByLabel(
        text,
        ['Codigo de Verificacao', 'Código de Verificação'],
        /([A-Z0-9-]{6,})/,
    );
    const chaveAcessoMatch = text.match(/(?:chave\s*de?\s*acesso|chave\s*nacional)[\s:]*?(\d{40,50})/i);
    const chaveAcesso = chaveAcessoMatch ? chaveAcessoMatch[1] : '';

    // Blocos de Prestador / Tomador
    const idxPrestador =
        text.indexOf('PRESTADOR DE SERVI\u00c7OS') >= 0
            ? text.indexOf('PRESTADOR DE SERVI\u00c7OS')
            : text.indexOf('PRESTADOR DE SERVICOS');
    const idxTomador =
        text.indexOf('TOMADOR DE SERVI\u00c7OS') >= 0
            ? text.indexOf('TOMADOR DE SERVI\u00c7OS')
            : text.indexOf('TOMADOR DE SERVICOS');
    const idxDisc =
        text.indexOf('DISCRIMINA\u00c7\u00c3O DOS SERVI\u00c7OS') >= 0
            ? text.indexOf('DISCRIMINA\u00c7\u00c3O DOS SERVI\u00c7OS')
            : text.indexOf('DISCRIMINACAO DOS SERVICOS');

    const blockPrestador = idxPrestador >= 0 && idxTomador > idxPrestador ? text.slice(idxPrestador, idxTomador) : '';
    const blockTomador = idxTomador >= 0 && idxDisc > idxTomador ? text.slice(idxTomador, idxDisc) : '';

    const prestador = parsePartie(blockPrestador);
    const tomador = parsePartie(blockTomador);

    // Servico
    const codigoServicoMatch = text.match(/C[oó]digo\s+do\s+Servi[cç]o[\s:]*\n?\s*([\d.]+)/i);
    const codigoServico = codigoServicoMatch ? codigoServicoMatch[1] : '';
    const discBlock =
        idxDisc >= 0
            ? text.slice(
                idxDisc,
                text.indexOf('VALOR TOTAL DO SERVI', idxDisc) > 0
                    ? text.indexOf('VALOR TOTAL DO SERVI', idxDisc)
                    : Math.min(idxDisc + 1500, text.length),
            )
            : '';
    const discriminacao = discBlock
        .replace(/DISCRIMINA[CÇ][ÃA]O DOS SERVI[CÇ]OS/i, '')
        .trim()
        .slice(0, 2000);
    const naturezaMatch = text.match(/Natureza\s+de\s+Opera[c\u00e7][a\u00e3]o\s*\n?\s*([^\n]+)/i);
    const naturezaOperacao = naturezaMatch ? naturezaMatch[1].trim() : '';

    // Valores
    const numPattern = /([\d.]+,\d{2})/;
    const valorServicos = parseValor(
        findValueByLabel(text, ['Valor Servicos', 'Valor Serviços', 'VALOR TOTAL DO SERVI'], numPattern),
    );
    const baseCalculo = parseValor(findValueByLabel(text, ['Base de Calculo', 'Base de Cálculo'], numPattern));

    const aliquotaIssMatch = text.match(/Al[i\u00ed]quota\s+ISS\s*([\d,]+)\s*%?/i);
    const aliquotaIss = aliquotaIssMatch ? parseValor(aliquotaIssMatch[1]) : 0;

    const valorIssRetido = parseValor(findValueByLabel(text, ['Valor ISS retido'], numPattern));
    const valorIssMatch = text.match(/Valor\s+ISS(?!\s+retido)[\s\S]{0,80}?([\d.]+,\d{2})/i);
    const valorIss = valorIssMatch ? parseValor(valorIssMatch[1]) : 0;

    const valorPis = parseValor(findValueByLabel(text, ['Valor PIS'], numPattern));
    const valorCofins = parseValor(findValueByLabel(text, ['Valor COFINS'], numPattern));
    const valorInss = parseValor(findValueByLabel(text, ['Valor INSS'], numPattern));
    const valorIrrf = parseValor(findValueByLabel(text, ['Valor IRRF', 'Valor IR'], numPattern));
    const valorCsll = parseValor(findValueByLabel(text, ['Valor CSLL'], numPattern));
    const valorOutrasRetencoes = parseValor(
        findValueByLabel(text, ['Outras retencoes', 'Outras retenções'], numPattern),
    );
    const valorDeducoes = parseValor(findValueByLabel(text, ['Valor deducoes', 'Valor deduções'], numPattern));
    const valorDescIncondicional = parseValor(findValueByLabel(text, ['Desconto incondicional'], numPattern));
    const valorDescCondicional = parseValor(findValueByLabel(text, ['Desconto condicional'], numPattern));
    const valorLiquido = parseValor(
        findValueByLabel(text, ['Valor liquido da NFS-e', 'Valor líquido da NFS-e', 'Valor liquido', 'Valor líquido'], numPattern),
    );

    const municipioEmissorMatch = text.match(/MUNIC[I\u00cd]PIO\s+DE\s+([A-Z\u00c0-\u00dc\s]+)/i);
    const municipioEmissor = municipioEmissorMatch ? municipioEmissorMatch[1].trim() : '';

    const localPrestacaoMatch = text.match(/Local\s+da\s+presta[c\u00e7][a\u00e3]o\s+do\s+servi[c\u00e7]o[\s:]*\n?\s*([^\n]+)/i);
    const municipioPrestacao = localPrestacaoMatch ? localPrestacaoMatch[1].trim() : prestador.municipio;

    return {
        numero, serie, competencia, dataEmissao, codigoVerificacao,
        municipioPrestacao, chaveAcesso,
        prestador, tomador,
        codigoServico, discriminacao, naturezaOperacao,
        valorServicos, baseCalculo,
        aliquotaIss, valorIss, valorIssRetido,
        valorPis, valorCofins, valorInss, valorIrrf, valorCsll,
        valorOutrasRetencoes, valorDeducoes,
        valorDescIncondicional, valorDescCondicional, valorLiquido,
        municipioEmissor,
        rawText: text,
    };
}

/** Identifica se o CNPJ da empresa selecionada bate com prestador (saida) ou tomador (entrada). */
export function matchNfseEmpresa(
    parsed: NfsePdfParsed,
    cnpjEmpresa: string,
): { ok: boolean; direcao: 'entrada' | 'saida'; motivo?: string } {
    const alvo = onlyDigits(cnpjEmpresa);
    const prest = onlyDigits(parsed.prestador.cnpj);
    const toma = onlyDigits(parsed.tomador.cnpj);

    if (!alvo) return { ok: false, direcao: 'entrada', motivo: 'CNPJ da empresa nao fornecido.' };
    if (prest === alvo) return { ok: true, direcao: 'saida' };
    if (toma === alvo) return { ok: true, direcao: 'entrada' };

    return {
        ok: false,
        direcao: 'entrada',
        motivo: `CNPJ ${parsed.prestador.cnpj || parsed.tomador.cnpj || '(vazio)'} nao corresponde a empresa selecionada (${cnpjEmpresa}).`,
    };
}
