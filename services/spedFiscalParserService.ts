import {
  SpedApuracaoE110,
  SpedApuracaoE520,
  SpedDocumentoC100,
  SpedDocumentoD100,
  SpedFiscalArquivo,
  SpedFiscalParseResult,
  SpedItemC170,
  SpedParticipante0150,
  SpedProduto0200,
  SpedRegistro0000,
  SpedResumoC190,
} from '../types';

function onlyDigits(value?: string): string {
  return (value || '').replace(/\D/g, '');
}

function parseNumber(value?: string): number {
  if (!value) return 0;
  const normalized = value.replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateSped(value?: string): string | undefined {
  if (!value || value.length !== 8) return undefined;
  const dia = value.substring(0, 2);
  const mes = value.substring(2, 4);
  const ano = value.substring(4, 8);
  return `${ano}-${mes}-${dia}`;
}

function splitSpedLine(line: string): string[] {
  // Linha SPED costuma vir como: |C100|0|1|...
  return line.split('|');
}

function getRegistroTipo(fields: string[]): string {
  return fields[1] || 'OUTRO';
}

function parse0000(fields: string[]): SpedRegistro0000 {
  return {
    tipo: '0000',
    codVer: fields[2],
    codFin: fields[3],
    dtIni: parseDateSped(fields[4]),
    dtFin: parseDateSped(fields[5]),
    nome: fields[6],
    cnpj: onlyDigits(fields[7]),
    cpf: onlyDigits(fields[8]),
    uf: fields[9],
    ie: fields[10],
    codMun: fields[11],
    im: fields[12],
    suframa: fields[13],
    indPerfil: fields[14],
    indAtiv: fields[15],
  };
}

function parse0150(fields: string[]): SpedParticipante0150 {
  return {
    tipo: '0150',
    codPart: fields[2] || '',
    nome: fields[3],
    codPais: fields[4],
    cnpj: onlyDigits(fields[5]),
    cpf: onlyDigits(fields[6]),
    ie: fields[7],
    codMun: fields[8],
    suframa: fields[9],
    endereco: fields[10],
    numero: fields[11],
    complemento: fields[12],
    bairro: fields[13],
  };
}

function parse0200(fields: string[]): SpedProduto0200 {
  return {
    tipo: '0200',
    codItem: fields[2] || '',
    descrItem: fields[3],
    codBarra: fields[4],
    codAntItem: fields[5],
    unidInv: fields[6],
    tipoItem: fields[7],
    codNcm: fields[8],
    exIpi: fields[9],
    codGen: fields[10],
    codLst: fields[11],
    aliqIcms: parseNumber(fields[12]),
    cest: fields[13],
  };
}

function parseC100(fields: string[]): SpedDocumentoC100 {
  return {
    tipo: 'C100',
    indOper: fields[2],
    indEmit: fields[3],
    codPart: fields[4],
    codMod: fields[5],
    codSit: fields[6],
    serie: fields[7],
    numDoc: fields[8],
    chave: onlyDigits(fields[9]),
    dataDoc: parseDateSped(fields[10]),
    dataES: parseDateSped(fields[11]),
    valorDocumento: parseNumber(fields[12]),
    valorDesconto: parseNumber(fields[14]),
    valorMercadoria: parseNumber(fields[16]),
    valorIcms: parseNumber(fields[22]),
    valorIpi: parseNumber(fields[25]),
    valorPis: parseNumber(fields[26]),
    valorCofins: parseNumber(fields[27]),
    itens: [],
    resumos: [],
  };
}

function parseC170(fields: string[]): SpedItemC170 {
  return {
    tipo: 'C170',
    numItem: fields[2],
    codItem: fields[3],
    descricaoComplementar: fields[4],
    quantidade: parseNumber(fields[5]),
    unidade: fields[6],
    valorItem: parseNumber(fields[7]),
    valorDesconto: parseNumber(fields[8]),
    cstIcms: fields[10],
    cfop: fields[11],
    natBcCred: fields[12],
    valorBcIcms: parseNumber(fields[13]),
    aliquotaIcms: parseNumber(fields[14]),
    valorIcms: parseNumber(fields[15]),
    valorBcIcmsSt: parseNumber(fields[16]),
    aliquotaSt: parseNumber(fields[17]),
    valorIcmsSt: parseNumber(fields[18]),
    indApur: fields[20],
    cstIpi: fields[21],
    codEnq: fields[22],
    valorBcIpi: parseNumber(fields[23]),
    aliquotaIpi: parseNumber(fields[24]),
    valorIpi: parseNumber(fields[25]),
    cstPis: fields[26],
    valorBcPis: parseNumber(fields[27]),
    aliquotaPis: parseNumber(fields[28]),
    valorPis: parseNumber(fields[30]),
    cstCofins: fields[36],
    valorBcCofins: parseNumber(fields[37]),
    aliquotaCofins: parseNumber(fields[38]),
    valorCofins: parseNumber(fields[40]),
  };
}

function parseC190(fields: string[]): SpedResumoC190 {
  return {
    tipo: 'C190',
    cstIcms: fields[2],
    cfop: fields[3],
    aliquotaIcms: parseNumber(fields[4]),
    valorOperacao: parseNumber(fields[5]),
    valorBcIcms: parseNumber(fields[6]),
    valorIcms: parseNumber(fields[7]),
    valorBcIcmsSt: parseNumber(fields[8]),
    valorIcmsSt: parseNumber(fields[9]),
    valorReducaoBc: parseNumber(fields[10]),
    valorIpi: parseNumber(fields[11]),
    codObs: fields[12],
  };
}

function parseD100(fields: string[]): SpedDocumentoD100 {
  return {
    tipo: 'D100',
    indOper: fields[2],
    indEmit: fields[3],
    codPart: fields[4],
    codMod: fields[5],
    codSit: fields[6],
    serie: fields[7],
    subSerie: fields[8],
    numDoc: fields[9],
    chave: onlyDigits(fields[10]),
    dataDoc: parseDateSped(fields[11]),
    dataAP: parseDateSped(fields[12]),
    tpCtE: fields[13],
    chaveCteRef: onlyDigits(fields[14]),
    valorDocumento: parseNumber(fields[15]),
    valorDesconto: parseNumber(fields[17]),
    valorServico: parseNumber(fields[18]),
    valorBcIcms: parseNumber(fields[21]),
    valorIcms: parseNumber(fields[22]),
  };
}

function parseE110(fields: string[]): SpedApuracaoE110 {
  return {
    tipo: 'E110',
    valorTotalDebitos: parseNumber(fields[2]),
    valorAjustesDebitos: parseNumber(fields[3]),
    valorTotalAjustesDebitos: parseNumber(fields[4]),
    valorEstornosCreditos: parseNumber(fields[5]),
    valorTotalCreditos: parseNumber(fields[6]),
    valorAjustesCreditos: parseNumber(fields[7]),
    valorTotalAjustesCreditos: parseNumber(fields[8]),
    valorEstornosDebitos: parseNumber(fields[9]),
    saldoCredorAnterior: parseNumber(fields[10]),
    valorSaldoDevedor: parseNumber(fields[11]),
    valorDeducoes: parseNumber(fields[12]),
    valorIcmsRecolher: parseNumber(fields[13]),
    valorSaldoCredorTransportar: parseNumber(fields[14]),
  };
}

function parseE520(fields: string[]): SpedApuracaoE520 {
  return {
    tipo: 'E520',
    valorSaldoDevedorIpi: parseNumber(fields[2]),
    valorDeducoesIpi: parseNumber(fields[3]),
    valorIpiRecolher: parseNumber(fields[4]),
    valorSaldoCredorIpi: parseNumber(fields[5]),
  };
}

export async function parseSpedFiscalFile(
  file: File,
  user?: { id?: string; name?: string } | null
): Promise<SpedFiscalParseResult> {
  const text = await file.text();
  return parseSpedFiscalText(text, file.name, file.size, user);
}

export function parseSpedFiscalText(
  text: string,
  nomeArquivo = 'sped-fiscal.txt',
  tamanhoBytes = 0,
  user?: { id?: string; name?: string } | null
): SpedFiscalParseResult {
  const linhas = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const erros: string[] = [];
  const avisos: string[] = [];

  let registro0000: SpedRegistro0000 | undefined;
  let apuracaoIcms: SpedApuracaoE110 | undefined;
  let apuracaoIpi: SpedApuracaoE520 | undefined;

  const participantes: SpedParticipante0150[] = [];
  const produtos: SpedProduto0200[] = [];
  const documentosC100: SpedDocumentoC100[] = [];
  const documentosD100: SpedDocumentoD100[] = [];

  let currentC100: SpedDocumentoC100 | null = null;

  linhas.forEach((linha, index) => {
    try {
      const fields = splitSpedLine(linha);
      const tipo = getRegistroTipo(fields);

      switch (tipo) {
        case '0000':
          registro0000 = parse0000(fields);
          break;

        case '0150':
          participantes.push(parse0150(fields));
          break;

        case '0200':
          produtos.push(parse0200(fields));
          break;

        case 'C100':
          currentC100 = parseC100(fields);
          documentosC100.push(currentC100);
          break;

        case 'C170':
          if (currentC100) {
            currentC100.itens.push(parseC170(fields));
          } else {
            avisos.push(`Linha ${index + 1}: Registro C170 sem C100 anterior.`);
          }
          break;

        case 'C190':
          if (currentC100) {
            currentC100.resumos.push(parseC190(fields));
          } else {
            avisos.push(`Linha ${index + 1}: Registro C190 sem C100 anterior.`);
          }
          break;

        case 'D100':
          documentosD100.push(parseD100(fields));
          break;

        case 'E110':
          apuracaoIcms = parseE110(fields);
          break;

        case 'E520':
          apuracaoIpi = parseE520(fields);
          break;

        default:
          break;
      }
    } catch (err: any) {
      erros.push(`Linha ${index + 1}: ${err.message || 'erro ao processar registro.'}`);
    }
  });

  if (!registro0000) {
    erros.push('Registro 0000 não encontrado. Arquivo pode não ser uma EFD ICMS/IPI válida.');
  }

  const arquivo: SpedFiscalArquivo = {
    id: crypto.randomUUID(),
    cnpj: registro0000?.cnpj,
    razaoSocial: registro0000?.nome,
    competencia: registro0000?.dtIni ? registro0000.dtIni.substring(0, 7) : undefined,
    periodoInicial: registro0000?.dtIni,
    periodoFinal: registro0000?.dtFin,
    nomeArquivo,
    tamanhoBytes,
    importadoPorUid: user?.id,
    importadoPorNome: user?.name,
    importadoEm: Date.now(),
    status: erros.length > 0 ? 'COM_ERROS' : 'PROCESSADO',
    totalLinhas: linhas.length,
    totalRegistros:
      participantes.length +
      produtos.length +
      documentosC100.length +
      documentosD100.length +
      (apuracaoIcms ? 1 : 0) +
      (apuracaoIpi ? 1 : 0),
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
    erros,
    avisos,
  };
}
