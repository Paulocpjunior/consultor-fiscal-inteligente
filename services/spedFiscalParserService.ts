import type {
    SpedFiscalArquivo,
    SpedFiscalParseResult,
    SpedRegistro0000,
    SpedParticipante0150,
    SpedProduto0200,
    SpedDocumentoC100,
    SpedItemC170,
    SpedResumoC190,
    SpedDocumentoD100,
    SpedApuracaoE110,
    SpedApuracaoE520,
    SpedConsolidacaoE510,
    User,
} from '../types';

function onlyDigits(v: string | undefined | null): string {
    return (v || '').replace(/\D+/g, '');
}

function parseNumber(v: string | undefined | null): number {
    if (!v || v.trim() === '') return 0;
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

function parseDateSped(ddmmyyyy: string | undefined | null): string {
    if (!ddmmyyyy || ddmmyyyy.length !== 8) return '';
    const dd = ddmmyyyy.substring(0, 2);
    const mm = ddmmyyyy.substring(2, 4);
    const yyyy = ddmmyyyy.substring(4, 8);
    return `${yyyy}-${mm}-${dd}`;
}

function splitLine(line: string): string[] {
    if (line.startsWith('|')) line = line.substring(1);
    if (line.endsWith('|')) line = line.substring(0, line.length - 1);
    return line.split('|');
}

function parseRegistro0000(fields: string[]): SpedRegistro0000 {
    return {
        tipo: '0000',
        codVer: fields[1] || undefined,
        codFin: fields[2] || undefined,
        dtIni: parseDateSped(fields[3]),
        dtFin: parseDateSped(fields[4]),
        nome: fields[5] || undefined,
        cnpj: onlyDigits(fields[6]) || undefined,
        cpf: onlyDigits(fields[7]) || undefined,
        uf: fields[8] || undefined,
        ie: fields[9] || undefined,
        codMun: fields[10] || undefined,
        im: fields[11] || undefined,
        suframa: fields[12] || undefined,
        indPerfil: fields[13] || undefined,
        indAtiv: fields[14] || undefined,
    };
}

function parseParticipante0150(fields: string[]): SpedParticipante0150 {
    return {
        tipo: '0150',
        codPart: fields[1] || '',
        nome: fields[2] || undefined,
        codPais: fields[3] || undefined,
        cnpj: onlyDigits(fields[4]) || undefined,
        cpf: onlyDigits(fields[5]) || undefined,
        ie: fields[6] || undefined,
        codMun: fields[7] || undefined,
        suframa: fields[8] || undefined,
        endereco: fields[9] || undefined,
        numero: fields[10] || undefined,
        complemento: fields[11] || undefined,
        bairro: fields[12] || undefined,
    };
}

function parseProduto0200(fields: string[]): SpedProduto0200 {
    return {
        tipo: '0200',
        codItem: fields[1] || '',
        descrItem: fields[2] || undefined,
        codBarra: fields[3] || undefined,
        codAntItem: fields[4] || undefined,
        unidInv: fields[5] || undefined,
        tipoItem: fields[6] || undefined,
        codNcm: fields[7] || undefined,
        exIpi: fields[8] || undefined,
        codGen: fields[9] || undefined,
        codLst: fields[10] || undefined,
        aliqIcms: fields[11] ? parseNumber(fields[11]) : undefined,
        cest: fields[12] || undefined,
    };
}

function parseDocumentoC100(fields: string[]): SpedDocumentoC100 {
    return {
        tipo: 'C100',
        indOper: fields[1] || undefined,
        indEmit: fields[2] || undefined,
        codPart: fields[3] || undefined,
        codMod: fields[4] || undefined,
        codSit: fields[5] || undefined,
        serie: fields[6] || undefined,
        numDoc: fields[7] || undefined,
        chave: onlyDigits(fields[8]) || undefined,
        dataDoc: parseDateSped(fields[9]) || undefined,
        dataES: parseDateSped(fields[10]) || undefined,
        valorDocumento: parseNumber(fields[11]),
        valorDesconto: parseNumber(fields[12]) || undefined,
        valorMercadoria: parseNumber(fields[16]) || undefined,
        valorIcms: parseNumber(fields[21]) || undefined,
        valorIpi: parseNumber(fields[25]) || undefined,
        valorPis: parseNumber(fields[26]) || undefined,
        valorCofins: parseNumber(fields[27]) || undefined,
        itens: [],
        resumos: [],
    };
}

function parseItemC170(fields: string[]): SpedItemC170 {
    return {
        tipo: 'C170',
        numItem: fields[1] || undefined,
        codItem: fields[2] || undefined,
        descricaoComplementar: fields[3] || undefined,
        quantidade: parseNumber(fields[4]) || undefined,
        unidade: fields[5] || undefined,
        valorItem: parseNumber(fields[6]) || undefined,
        valorDesconto: parseNumber(fields[7]) || undefined,
        cstIcms: fields[9] || undefined,
        cfop: fields[10] || undefined,
        natBcCred: fields[11] || undefined,
        valorBcIcms: parseNumber(fields[12]) || undefined,
        aliquotaIcms: parseNumber(fields[13]) || undefined,
        valorIcms: parseNumber(fields[14]) || undefined,
        valorBcIcmsSt: parseNumber(fields[15]) || undefined,
        aliquotaSt: parseNumber(fields[16]) || undefined,
        valorIcmsSt: parseNumber(fields[17]) || undefined,
        indApur: fields[18] || undefined,
        cstIpi: fields[19] || undefined,
        codEnq: fields[20] || undefined,
        valorBcIpi: parseNumber(fields[21]) || undefined,
        aliquotaIpi: parseNumber(fields[22]) || undefined,
        valorIpi: parseNumber(fields[23]) || undefined,
        cstPis: fields[24] || undefined,
        valorBcPis: parseNumber(fields[25]) || undefined,
        aliquotaPis: parseNumber(fields[26]) || undefined,
        valorPis: parseNumber(fields[27]) || undefined,
        cstCofins: fields[28] || undefined,
        valorBcCofins: parseNumber(fields[29]) || undefined,
        aliquotaCofins: parseNumber(fields[30]) || undefined,
        valorCofins: parseNumber(fields[31]) || undefined,
    };
}

function parseResumoC190(fields: string[]): SpedResumoC190 {
    return {
        tipo: 'C190',
        cstIcms: fields[1] || undefined,
        cfop: fields[2] || undefined,
        aliquotaIcms: parseNumber(fields[3]) || undefined,
        valorOperacao: parseNumber(fields[4]) || undefined,
        valorBcIcms: parseNumber(fields[5]) || undefined,
        valorIcms: parseNumber(fields[6]) || undefined,
        valorBcIcmsSt: parseNumber(fields[7]) || undefined,
        valorIcmsSt: parseNumber(fields[8]) || undefined,
        valorReducaoBc: parseNumber(fields[9]) || undefined,
        valorIpi: parseNumber(fields[10]) || undefined,
        codObs: fields[11] || undefined,
    };
}

function parseDocumentoD100(fields: string[]): SpedDocumentoD100 {
    return {
        tipo: 'D100',
        indOper: fields[1] || undefined,
        indEmit: fields[2] || undefined,
        codPart: fields[3] || undefined,
        codMod: fields[4] || undefined,
        codSit: fields[5] || undefined,
        serie: fields[6] || undefined,
        subSerie: fields[7] || undefined,
        numDoc: fields[8] || undefined,
        chave: onlyDigits(fields[9]) || undefined,
        dataDoc: parseDateSped(fields[10]) || undefined,
        dataAP: parseDateSped(fields[11]) || undefined,
        tpCtE: fields[12] || undefined,
        chaveCteRef: fields[13] || undefined,
        valorDocumento: parseNumber(fields[14]),
        valorDesconto: parseNumber(fields[15]) || undefined,
        valorServico: parseNumber(fields[17]) || undefined,
        valorBcIcms: parseNumber(fields[19]) || undefined,
        valorIcms: parseNumber(fields[20]) || undefined,
    };
}

function parseApuracaoE110(fields: string[]): SpedApuracaoE110 {
    return {
        tipo: 'E110',
        valorTotalDebitos: parseNumber(fields[1]),
        valorAjustesDebitos: parseNumber(fields[2]),
        valorTotalAjustesDebitos: parseNumber(fields[3]),
        valorEstornosCreditos: parseNumber(fields[4]),
        valorTotalCreditos: parseNumber(fields[5]),
        valorAjustesCreditos: parseNumber(fields[6]),
        valorTotalAjustesCreditos: parseNumber(fields[7]),
        valorEstornosDebitos: parseNumber(fields[8]),
        saldoCredorAnterior: parseNumber(fields[9]),
        valorSaldoDevedor: parseNumber(fields[10]),
        valorDeducoes: parseNumber(fields[11]),
        valorIcmsRecolher: parseNumber(fields[12]),
        valorSaldoCredorTransportar: parseNumber(fields[13]),
    };
}

// 🚨 CORRIGIDO 21/08 — este parser lia posições que NÃO são as do leiaute
// (fields[4] como "saldo credor" é o VL_OD_IPI, quase sempre 0,00). Ver o
// comentário do tipo em types.ts; a prova é a linha real da PWR.
function parseApuracaoE520(fields: string[]): SpedApuracaoE520 {
    return {
        tipo: 'E520',
        saldoCredorAnteriorIpi: parseNumber(fields[1]),
        valorDebitosIpi: parseNumber(fields[2]),
        valorCreditosIpi: parseNumber(fields[3]),
        valorOutrosDebitosIpi: parseNumber(fields[4]),
        valorOutrosCreditosIpi: parseNumber(fields[5]),
        valorSaldoCredorIpi: parseNumber(fields[6]),
        valorSaldoDevedorIpi: parseNumber(fields[7]),
    };
}

// E510 — |E510|CFOP|CST_IPI|VL_CONT_IPI|VL_BC_IPI|VL_IPI|
function parseConsolidacaoE510(fields: string[]): SpedConsolidacaoE510 {
    return {
        tipo: 'E510',
        cfop: (fields[1] || '').trim(),
        cstIpi: (fields[2] || '').trim(),
        valorContabil: parseNumber(fields[3]),
        valorBcIpi: parseNumber(fields[4]),
        valorIpi: parseNumber(fields[5]),
    };
}

export function parseSpedFiscalText(
    text: string,
    nomeArquivo: string,
    tamanhoBytes: number,
    user?: User | null,
): SpedFiscalParseResult {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const erros: string[] = [];
    const avisos: string[] = [];

    let registro0000: SpedRegistro0000 | undefined;
    const participantes: SpedParticipante0150[] = [];
    const produtos: SpedProduto0200[] = [];
    const documentosC100: SpedDocumentoC100[] = [];
    const documentosD100: SpedDocumentoD100[] = [];
    let apuracaoIcms: SpedApuracaoE110 | undefined;
    let apuracaoIpi: SpedApuracaoE520 | undefined;
    const consolidacaoIpiE510: SpedConsolidacaoE510[] = [];

    let currentC100: SpedDocumentoC100 | null = null;
    let totalRegistros = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = (lines[i] || '').trim();
        if (!line.startsWith('|')) continue;

        const fields = splitLine(line);
        const reg = fields[0];
        totalRegistros++;

        try {
            switch (reg) {
                case '0000':
                    registro0000 = parseRegistro0000(fields);
                    break;
                case '0150':
                    participantes.push(parseParticipante0150(fields));
                    break;
                case '0200':
                    produtos.push(parseProduto0200(fields));
                    break;
                case 'C100':
                    if (currentC100) {
                        documentosC100.push(currentC100);
                    }
                    currentC100 = parseDocumentoC100(fields);
                    break;
                case 'C170':
                    if (currentC100) {
                        currentC100.itens.push(parseItemC170(fields));
                    } else {
                        avisos.push(`Linha ${i + 1}: C170 sem C100 pai`);
                    }
                    break;
                case 'C190':
                    if (currentC100) {
                        currentC100.resumos.push(parseResumoC190(fields));
                    } else {
                        avisos.push(`Linha ${i + 1}: C190 sem C100 pai`);
                    }
                    break;
                case 'C990':
                    if (currentC100) {
                        documentosC100.push(currentC100);
                        currentC100 = null;
                    }
                    break;
                case 'D100':
                    if (currentC100) {
                        documentosC100.push(currentC100);
                        currentC100 = null;
                    }
                    documentosD100.push(parseDocumentoD100(fields));
                    break;
                case 'E110':
                    apuracaoIcms = parseApuracaoE110(fields);
                    break;
                case 'E510':
                    consolidacaoIpiE510.push(parseConsolidacaoE510(fields));
                    break;
                case 'E520':
                    apuracaoIpi = parseApuracaoE520(fields);
                    break;
                default:
                    break;
            }
        } catch (err: any) {
            erros.push(`Linha ${i + 1} (${reg}): ${err?.message || 'Erro desconhecido'}`);
        }
    }

    if (currentC100) {
        documentosC100.push(currentC100);
    }

    const competencia = registro0000?.dtIni ? registro0000.dtIni.substring(0, 7) : undefined;

    const arquivo: SpedFiscalArquivo = {
        id: `sped_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        cnpj: registro0000?.cnpj,
        razaoSocial: registro0000?.nome,
        competencia,
        periodoInicial: registro0000?.dtIni,
        periodoFinal: registro0000?.dtFin,
        nomeArquivo,
        tamanhoBytes,
        importadoPorUid: user?.id,
        importadoPorNome: user?.name,
        importadoEm: Date.now(),
        status: erros.length > 0 ? 'COM_ERROS' : 'PROCESSADO',
        totalLinhas: lines.length,
        totalRegistros,
    };

    return {
        arquivo,
        registro0000,
        participantes,
        produtos,
        documentosC100,
        documentosD100,
        apuracaoIcms,
        apuracaoIpi,
        consolidacaoIpiE510,
        erros,
        avisos,
    };
}

export async function parseSpedFiscalFile(
    file: File,
    user?: User | null,
): Promise<SpedFiscalParseResult> {
    const text = await file.text();
    return parseSpedFiscalText(text, file.name, file.size, user);
}
