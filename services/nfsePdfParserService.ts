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
    // Busca case-insensitive — DANFSe v1.0 escreve "Data e Hora da emissão"
    // (minúscula) e ABRASF escreve "Data e Hora da Emissão" (capital).
    // Sem case-insensitive, cada padrao quebrava o outro.
    const idx = text.toLowerCase().indexOf(label.toLowerCase());
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

    // CNPJ pode aparecer em VARIOS formatos:
    //  - Pontuado:           02.942.184/0001-34
    //  - Pontuado parcial:   02.942.184 / 0001-34   (com espacos)
    //  - Sem pontuacao:      02942184000134
    // E o label varia ("CNPJ:", "CNPJ/CPF:", "CPF/CNPJ", as vezes so o numero).
    // Procura em ordem: pontuado -> pontuado-com-espacos -> 14-digitos.
    const cnpjPontuadoMatch = block.match(/(\d{2})\s*\.\s*(\d{3})\s*\.\s*(\d{3})\s*\/\s*(\d{4})\s*-\s*(\d{2})/);
    if (cnpjPontuadoMatch) {
        // Normaliza: remove espacos extras mas mantem pontuacao canonica
        p.cnpj = `${cnpjPontuadoMatch[1]}.${cnpjPontuadoMatch[2]}.${cnpjPontuadoMatch[3]}/${cnpjPontuadoMatch[4]}-${cnpjPontuadoMatch[5]}`;
    } else {
        // Sem pontuacao: 14 digitos consecutivos (cuidado pra nao casar com CEP+telefone)
        // Exige label "CNPJ" perto pra reduzir falso positivo.
        const cnpjDigitosMatch = block.match(/(?:CNPJ|CGC)[\s\S]{0,40}?(\d{14})/i)
            || block.match(/(?<!\d)(\d{14})(?!\d)/);
        if (cnpjDigitosMatch && cnpjDigitosMatch[1]) {
            const d = cnpjDigitosMatch[1];
            p.cnpj = `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
        } else {
            // Fallback CPF (pessoa fisica)
            const cpfPontuadoMatch = block.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
            if (cpfPontuadoMatch && cpfPontuadoMatch[1]) p.cnpj = cpfPontuadoMatch[1];
        }
    }
    const ieMatch = block.match(/Inscri[c\u00e7][a\u00e3]o\s+Municipal\s*:?\s*(\d+)/i);
    if (ieMatch && ieMatch[1]) p.inscricaoMunicipal = ieMatch[1];
    // Nome aparece em formatos distintos por padrao:
    //  DANFSe v1.0       : "Nome / Nome Empresarial\nFASTWELD INDUSTRIA..."
    //  ABRASF (Publica)  : "Nome empresarial: FASTWELD..."
    //  Ginfes (Guarulhos): "Raz\u00e3o Social/Nome FASTWELD IND. E COM. LTDA"
    //
    // Tenta na ordem do mais especifico pro mais generico pra evitar pegar
    // o nome do CAMPO em vez do valor (ex.: "Nome:" sem valor na linha).
    const nomeRegexes: RegExp[] = [
        /Nome\s*\/\s*Nome\s+Empresarial[\s:]*\n?\s*([^\n]+)/i,        // DANFSe v1.0
        /Raz[a\u00e3]o\s+Social\s*\/\s*Nome\s*[:]?\s*([^\n]+)/i,      // Ginfes
        /Nome\s+Empresarial\s*:?\s*([^\n]+)/i,                         // ABRASF
        /Raz[a\u00e3]o\s+Social\s*:?\s*([^\n]+)/i,                    // generico
        /Nome\s*:?\s*([^\n]+)/i,                                       // ultimo fallback
    ];
    for (const r of nomeRegexes) {
        const m = block.match(r);
        const val = m?.[1]?.trim();
        // "-" eh placeholder do DANFSe pra campos vazios; ignora
        if (val && val !== '-' && val.length > 1) { p.nome = val; break; }
    }
    const fantasiaMatch = block.match(/Nome\s+fantasia\s*:?\s*([^\n]+)/i);
    if (fantasiaMatch && fantasiaMatch[1]) p.nomeFantasia = fantasiaMatch[1].trim();
    const enderecoMatch = block.match(/Endere[c\u00e7]o\s*:?\s*([^\n]+)/i);
    if (enderecoMatch && enderecoMatch[1]) p.endereco = enderecoMatch[1].trim();
    const bairroMatch = block.match(/Bairro\s*:?\s*([^\n]+)/i);
    if (bairroMatch && bairroMatch[1]) p.bairro = bairroMatch[1].trim();
    const municipioMatch = block.match(/Munic[i\u00ed]pio\s*:?\s*([^\n]+?)(?:\s+UF\s*:|\n|$)/i);
    if (municipioMatch && municipioMatch[1]) p.municipio = municipioMatch[1].trim();
    const ufMatch = block.match(/UF\s*:?\s*([A-Z]{2})/);
    if (ufMatch && ufMatch[1]) p.uf = ufMatch[1];
    const cepMatch = block.match(/CEP\s*:?\s*(\d{5}-?\d{3})/i);
    if (cepMatch && cepMatch[1]) p.cep = cepMatch[1];
    const emailMatch = block.match(/E-?mail\s*:?\s*([^\s\n]+@[^\s\n]+)/i);
    if (emailMatch && emailMatch[1]) p.email = emailMatch[1];
    const foneMatch = block.match(/Fone\s*:?\s*([\d\s\-()]+)/i);
    if (foneMatch && foneMatch[1]) p.telefone = foneMatch[1].trim();
    return p;
}

export async function parseNfsePdf(file: File): Promise<NfsePdfParsed> {
    const text = await extractText(file);
    if (!text || text.length < 100) {
        throw new NfsePdfParseError(
            'Nao foi possivel extrair texto do PDF. Pode ser uma NFSe digitalizada (imagem) — nao suportado.',
        );
    }
    return parseNfseFromText(text);
}

/**
 * Parsing puro — recebe o texto bruto extraido do PDF e devolve a estrutura.
 * Separado pra ser testavel sem precisar de pdfjs-dist no jest (que so roda
 * em jsdom com Worker mockado).
 */
export function parseNfseFromText(text: string): NfsePdfParsed {
    const upperText = text.toUpperCase();
    if (
        !upperText.includes('NFS-E') &&
        !upperText.includes('NFSE') &&
        !upperText.includes('NOTA FISCAL DE SERVI')
    ) {
        throw new NfsePdfParseError('Documento nao parece ser uma NFSe.');
    }

    // Cabecalho
    // DANFSe v1.0 (gov.br/nfse) tem labels separados em linhas distintas:
    //  "Número da NFS-e\n699598"  / "Série da DPS\n1"
    // ABRASF padrao usa formato "NNNNNN / S" inline.
    let numero = '';
    let serie = '';
    const numNfseMatch = text.match(/N[uú]mero\s+da\s+NFS-?e\s*\n?\s*(\d+)/i);
    if (numNfseMatch?.[1]) numero = numNfseMatch[1];
    const serieDpsMatch = text.match(/S[eé]rie\s+(?:da\s+(?:DPS|NFS-?e)|do\s+RPS)\s*\n?\s*(\w+)/i);
    if (serieDpsMatch?.[1]) serie = serieDpsMatch[1];
    if (!numero) {
        // Fallback ABRASF: "699598 / 1"
        const numSerieMatch = text.match(/(\d{6,})\s*\/\s*(\w+)/);
        if (numSerieMatch?.[1]) { numero = numSerieMatch[1]; serie = serie || numSerieMatch[2] || ''; }
    }

    // Data: DANFSe usa "Data e Hora da emissão da NFS-e\n11/05/2026 14:31:31"
    // (minusculo em "emissão" e tem " da NFS-e" no meio). findAfter agora eh
    // case-insensitive entao "Data e Hora da Emissão" pega a forma do DANFSe.
    const dataEmissao = findValueByLabel(
        text,
        ['Data e Hora da Emissão', 'Data e Hora da Emissao', 'Data de Emissão', 'Data de Emissao'],
        /(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/,
    );
    // Competencia: DANFSe = "Competência da NFS-e\n10/05/2026" (DD/MM/YYYY);
    // ABRASF tradicional = "Competência: MM/YYYY". Aceita os 2.
    const competencia = findValueByLabel(text, ['Competência', 'Competencia'], /(\d{1,2}\/\d{2,4}(?:\/\d{2,4})?)/);
    const codigoVerificacao = findValueByLabel(
        text,
        ['Código de Verificação', 'Codigo de Verificacao'],
        /([A-Z0-9-]{6,})/,
    );
    // Chave: DANFSe = "Chave de Acesso da NFS-e\n3548906..." (50 digitos).
    // ABRASF tradicional varia. Aceita label "da NFS-e" como variante.
    const chaveAcessoMatch =
        text.match(/Chave\s*(?:de\s+Acesso|Nacional)(?:\s+da\s+NFS-?e)?[\s:]*\n?\s*(\d{40,50})/i)
        || text.match(/(?:chave\s*de?\s*acesso|chave\s*nacional)[\s:]*?(\d{40,50})/i);
    const chaveAcesso = chaveAcessoMatch?.[1] || '';

    // Blocos de Prestador / Tomador.
    //
    // Cada padrao de DANFSe/NFSe usa labels diferentes:
    //  - ABRASF padrao (Publica/SC)         : "PRESTADOR DE SERVI\u00c7OS" + "TOMADOR DE SERVI\u00c7OS" + "DISCRIMINA\u00c7\u00c3O DOS SERVI\u00c7OS"
    //  - DANFSe v1.0 (gov.br/nfse nacional) : "EMITENTE DA NFS-e" + "TOMADOR DO SERVI\u00c7O" + "SERVI\u00c7O PRESTADO"
    //  - Ginfes/municipios SP (Guarulhos)   : "Dados do Prestador de Servi\u00e7os" + "Dados do Tomador de Servi\u00e7os" + "Discrimina\u00e7\u00e3o dos Servi\u00e7os"
    //
    // findFirstIndex pega o PRIMEIRO label que matcha (case-insensitive).
    // Sem esse fallback, PDFs reais da S&P (SERASA nacional, CONCEITO Guarulhos)
    // tinham os 2 blocos vazios -> CNPJ ficava em branco -> matchNfseEmpresa
    // rejeitava com "CNPJ (vazio) nao corresponde a empresa selecionada".
    const findFirstIndex = (haystack: string, needles: string[]): number => {
        const lower = haystack.toLowerCase();
        for (const n of needles) {
            const idx = lower.indexOf(n.toLowerCase());
            if (idx >= 0) return idx;
        }
        return -1;
    };
    const idxPrestador = findFirstIndex(text, [
        'PRESTADOR DE SERVI\u00c7OS', 'PRESTADOR DE SERVICOS',
        'EMITENTE DA NFS-e', 'EMITENTE DA NFSE',
        'Dados do Prestador',
    ]);
    const idxTomador = findFirstIndex(text, [
        'TOMADOR DE SERVI\u00c7OS', 'TOMADOR DE SERVICOS',
        'TOMADOR DO SERVI\u00c7O', 'TOMADOR DO SERVICO',
        'Dados do Tomador',
    ]);
    const idxDisc = findFirstIndex(text, [
        'DISCRIMINA\u00c7\u00c3O DOS SERVI\u00c7OS', 'DISCRIMINACAO DOS SERVICOS',
        'SERVI\u00c7O PRESTADO', 'SERVICO PRESTADO',
        'Discrimina\u00e7\u00e3o dos Servi\u00e7os',
        // Fallback: tributa\u00e7\u00e3o municipal vem logo depois do bloco do tomador
        // no DANFSe nacional, antes da discrimina\u00e7\u00e3o propriamente dita.
        'TRIBUTA\u00c7\u00c3O MUNICIPAL', 'TRIBUTACAO MUNICIPAL',
        'C\u00f3digo do Servi\u00e7o', 'Codigo do Servico',
    ]);

    const blockPrestador = idxPrestador >= 0 && idxTomador > idxPrestador ? text.slice(idxPrestador, idxTomador) : '';
    const blockTomador = idxTomador >= 0 && idxDisc > idxTomador ? text.slice(idxTomador, idxDisc) : '';

    const prestador = parsePartie(blockPrestador);
    const tomador = parsePartie(blockTomador);

    // Servico
    // DANFSe v1.0 usa "Código de Tributação Nacional\n17.01.01 - ..."
    // ABRASF tradicional usa "Código do Serviço\n01.05" ou similar.
    // Codigo pode ter ponto E hifen ('17.01.01' ou '17-01-01').
    const codigoServicoMatch =
        text.match(/C[oó]digo\s+(?:do\s+Servi[cç]o|de\s+Tributa[cç][aã]o\s+(?:Nacional|Municipal))[\s:]*\n?\s*([\d.\-/]+)/i);
    const codigoServico = codigoServicoMatch?.[1] || '';
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
    const naturezaOperacao = naturezaMatch?.[1] ? naturezaMatch[1].trim() : '';

    // Valores
    // numPattern aceita "R$" opcional antes do valor (DANFSe v1.0 escreve
    // "R$ 1.956,03" depois do label, ABRASF as vezes so o numero).
    const numPattern = /R?\$?\s*([\d.]+,\d{2})/;
    const valorServicos = parseValor(
        findValueByLabel(text, ['Valor do Serviço', 'Valor do Servico', 'Valor Servicos', 'Valor Serviços', 'VALOR TOTAL DO SERVI'], numPattern),
    );
    const baseCalculo = parseValor(findValueByLabel(text, ['Base de Cálculo', 'Base de Calculo', 'BC ISSQN'], numPattern));

    // DANFSe v1.0 usa "Al\u00edquota Aplicada\n2,00%" (linha separada);
    // ABRASF inline "Al\u00edquota ISS 2%".
    const aliquotaIssMatch = text.match(/Al[i\u00ed]quota\s+(?:ISS|Aplicada)[\s:]*\n?\s*([\d,]+)\s*%?/i);
    const aliquotaIss = aliquotaIssMatch ? parseValor(aliquotaIssMatch[1]) : 0;

    const valorIssRetido = parseValor(findValueByLabel(text, ['Valor ISS retido', 'ISS Retido'], numPattern));
    // ISSQN Apurado (DANFSe) ou "Valor ISS" (ABRASF). Bypassa "Valor ISS retido"
    // com lookahead negativo.
    const valorIssMatch = text.match(/(?:ISSQN\s+Apurado|Valor\s+ISS(?!\s+retido))[\s\S]{0,80}?([\d.]+,\d{2})/i);
    const valorIss = valorIssMatch ? parseValor(valorIssMatch[1]) : 0;

    // Tributos federais: DANFSe v1.0 escreve "PIS - Débito Apuração Própria",
    // "COFINS - Débito Apuração Própria" e "Contribuição Previdenciária - Retida".
    const valorPis = parseValor(findValueByLabel(text, ['PIS - Débito Apuração Própria', 'PIS - Debito Apuracao Propria', 'Valor PIS'], numPattern));
    const valorCofins = parseValor(findValueByLabel(text, ['COFINS - Débito Apuração Própria', 'COFINS - Debito Apuracao Propria', 'Valor COFINS'], numPattern));
    const valorInss = parseValor(findValueByLabel(text, ['Contribuição Previdenciária - Retida', 'Contribuicao Previdenciaria - Retida', 'Valor INSS'], numPattern));
    // DANFSe escreve "IRRF" sozinho como label. Precisa boundary (^ ou \n)
    // pra nao casar "IRRF" no meio de outro texto. Fallback pra "Valor IRRF".
    const valorIrrfStr =
        findValueByLabel(text, ['Valor IRRF', 'Valor IR'], numPattern)
        || (text.match(/(?:^|\n)IRRF\s*\n\s*R?\$?\s*([\d.]+,\d{2})/i)?.[1] ?? '');
    const valorIrrf = parseValor(valorIrrfStr);
    const valorCsll = parseValor(findValueByLabel(text, ['Valor CSLL', 'CSLL'], numPattern));
    const valorOutrasRetencoes = parseValor(
        findValueByLabel(text, ['Outras retenções', 'Outras retencoes'], numPattern),
    );
    const valorDeducoes = parseValor(findValueByLabel(text, ['Total Deduções', 'Total Deducoes', 'Valor deduções', 'Valor deducoes'], numPattern));
    const valorDescIncondicional = parseValor(findValueByLabel(text, ['Desconto Incondicionado', 'Desconto Incondicional', 'Desconto incondicional'], numPattern));
    const valorDescCondicional = parseValor(findValueByLabel(text, ['Desconto Condicionado', 'Desconto Condicional', 'Desconto condicional'], numPattern));
    const valorLiquido = parseValor(
        findValueByLabel(text, ['Valor Líquido da NFS-e', 'Valor Liquido da NFS-e', 'Valor Líquido', 'Valor liquido'], numPattern),
    );

    const municipioEmissorMatch = text.match(/MUNIC[I\u00cd]PIO\s+DE\s+([A-Z\u00c0-\u00dc\s]+)/i);
    const municipioEmissor = municipioEmissorMatch?.[1] ? municipioEmissorMatch[1].trim() : '';

    const localPrestacaoMatch = text.match(/Local\s+da\s+presta[c\u00e7][a\u00e3]o\s+do\s+servi[c\u00e7]o[\s:]*\n?\s*([^\n]+)/i);
    const municipioPrestacao = localPrestacaoMatch?.[1] ? localPrestacaoMatch[1].trim() : (prestador.municipio || '');

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

    // Fallback: alguns PDFs municipais nao seguem os labels esperados, o
    // findFirstIndex nao acha blockPrestador/blockTomador e os CNPJs ficam
    // vazios mesmo estando presentes no texto. Escanear o rawText e procurar
    // o CNPJ da empresa diretamente — se aparecer, ainda da pra inferir
    // direcao pela posicao relativa (quem aparece antes provavelmente eh o
    // prestador no layout ABRASF).
    if (parsed.rawText && (!prest || !toma)) {
        const textoLimpo = parsed.rawText.replace(/\D/g, '');
        const idxAlvo = textoLimpo.indexOf(alvo);
        if (idxAlvo >= 0) {
            // Procura QUALQUER outro CNPJ no texto bruto (com ou sem pontuacao)
            const todosCnpjs = (parsed.rawText.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{14}/g) || [])
                .map(s => s.replace(/\D/g, ''))
                .filter(d => d.length === 14 && d !== alvo);
            if (todosCnpjs.length > 0) {
                // Estrategia: ABRASF normalmente lista PRESTADOR antes de TOMADOR.
                // Posicao do alvo nos digitos vs posicao do primeiro outro CNPJ.
                const idxOutro = textoLimpo.indexOf(todosCnpjs[0] || '');
                const direcao: 'entrada' | 'saida' = idxAlvo > idxOutro ? 'entrada' : 'saida';
                return { ok: true, direcao };
            }
            // Encontrou alvo mas nao outro CNPJ - aceita como entrada por default
            // (cliente eh provavelmente o tomador em PDF que ele mesmo guarda).
            return { ok: true, direcao: 'entrada' };
        }
    }

    return {
        ok: false,
        direcao: 'entrada',
        motivo: `CNPJ ${parsed.prestador.cnpj || parsed.tomador.cnpj || '(vazio)'} nao corresponde a empresa selecionada (${cnpjEmpresa}). Confira se o PDF eh da NFSe correta ou se o layout do municipio esta suportado.`,
    };
}
