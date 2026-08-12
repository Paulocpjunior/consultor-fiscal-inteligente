// ============================================================================
// sefaz-backend/nfse-sp-csv-parser.js
// Parser do CSV de NFS-e exportado MANUALMENTE pelo portal nfe.prefeitura.sp.gov.br
//
// Layout V.006 — confirmado em maio/2026
// Separador: ; (ponto-vírgula)
// Encoding: ISO-8859-1 / Windows-1252
//
// Suporta tanto NFs Emitidas (E) quanto Recebidas (R) — mesmo layout.
// A diferença é qual CCM é do "prestador" no contexto da exportação.
//
// Esse parser é a SOLUÇÃO PRAGMÁTICA pro WS legacy nfews retornar erro
// 1102 (provável Reforma Tributária 2026 mudou autorização). O portal já
// avisa que o TXT vai ser descontinuado em 01/08/2026 mas o CSV continua.
// ============================================================================

// Decodifica ISO-8859-1 (Windows-1252) pra string JS válida.
// O Node lê o buffer como bytes; convertemos manualmente.
function decodeIso88591(buffer) {
    // Buffer.toString('latin1') = ISO-8859-1 puro
    return buffer.toString('latin1');
}

/**
 * SEPARADOR do arquivo do portal, decidido pelo CABEÇALHO.
 *
 * O portal exporta o MESMO layout de 73 colunas em dois formatos: CSV com ";"
 * e TXT com TAB. O parser só entendia ";", então o TXT caía fora — e a rota
 * ainda o rotulava de "TXT de largura fixa", que ele não é. Resultado: a
 * equipe recebia "não sei ler" sobre um arquivo perfeitamente legível.
 *
 * Quem decide é a linha 1: vence o separador que produzir MAIS colunas. Um
 * arquivo de verdade tem dezenas; o separador errado devolve 1.
 */
export function detectarSeparador(primeiraLinha) {
    const linha = String(primeiraLinha || '');
    const porPontoVirgula = linha.split(';').length;
    const porTab = linha.split('\t').length;
    if (porTab > porPontoVirgula && porTab > 1) return '\t';
    if (porPontoVirgula > 1) return ';';
    return null; // nenhum separador reconhecido — quem chama decide o que dizer
}

// Parse uma linha considerando o separador do arquivo e respeitando quotes.
function parseCsvLine(line, sep = ';') {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === sep && !inQuotes) {
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells;
}

// Parse valor monetário brasileiro: "1.721,00" → 1721.00
function parseMoney(s) {
    if (!s) return 0;
    const limpa = String(s).trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpa);
    return Number.isFinite(n) ? n : 0;
}

// Parse "01/04/2026 09:13:46" → Date ISO
function parseDataHora(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
    if (!m) return null;
    const [, d, mo, y, h = '00', mi = '00', se = '00'] = m;
    // Constrói ISO local SP (sem timezone — Firestore aceita strings ISO)
    return `${y}-${mo}-${d}T${h}:${mi}:${se}`;
}

// CCM SP: "7.139.111-8" → "71391118"
function limpaCcm(s) {
    return String(s || '').replace(/\D/g, '');
}

// CNPJ/CPF: "44.388.152/0001-89" → "44388152000189"
function limpaDoc(s) {
    return String(s || '').replace(/\D/g, '');
}

// Mapeia situação SP:
// T = Tributada normal, F = Fora do município, A = Aceita, etc.
// Por enquanto retorna como veio + flag de cancelada.
function classificaSituacao(situacao, dataCancelamento) {
    const s = String(situacao || '').trim().toUpperCase();
    if (dataCancelamento && String(dataCancelamento).trim()) {
        return 'cancelada';
    }
    if (s === 'T') return 'tributada';
    if (s === 'F') return 'fora_municipio';
    if (s === 'A') return 'aceita';
    if (s === 'I') return 'isenta';
    if (s === 'C') return 'cancelada';
    return s || 'desconhecida';
}

/**
 * Parse o CSV completo. Aceita Buffer (do multer) ou string.
 * Retorna { header, notas, totais, ccmExportado, periodo }
 */
export function parseCsvNfseSp(input) {
    const text = Buffer.isBuffer(input) ? decodeIso88591(input) : String(input);
    const rawLines = text.split(/\r?\n/);
    if (rawLines.length < 2) {
        throw new Error('CSV vazio ou inválido');
    }

    const separador = detectarSeparador(rawLines[0]);
    if (!separador) {
        throw new Error(
            'Não reconheci o separador das colunas na primeira linha. Esta importação lê o export do '
            + 'portal em CSV (";") ou TXT (TAB), ambos com as mesmas colunas. Se o arquivo veio do '
            + '"Layout do Arquivo NFS-e" (largura fixa, sem separador), esse layout ainda não é lido.',
        );
    }
    const header = parseCsvLine(rawLines[0], separador);
    const notas = [];
    let totalDeclarado = null;
    let valorTotalDeclarado = null;
    let ccmExportado = null;

    for (let i = 1; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (!line || !line.trim()) continue;
        const cells = parseCsvLine(line, separador);

        // Linha de Total (última): "Total;66;;;;;;;;;;;;;;;;;;;;;;;;;193.469,34;..."
        if (String(cells[0] || '').toLowerCase() === 'total') {
            totalDeclarado = parseInt(cells[1] || '0', 10) || 0;
            valorTotalDeclarado = parseMoney(cells[26]);
            continue;
        }

        // Linha de NF: começa com "2" (Tipo de Registro)
        if (String(cells[0] || '').trim() !== '2') continue;

        // Captura o CCM do prestador do primeiro registro
        if (!ccmExportado && cells[8]) {
            ccmExportado = limpaCcm(cells[8]);
        }

        const ccmPrestador = limpaCcm(cells[8]);
        const cnpjPrestador = limpaDoc(cells[10]);
        const cnpjTomador = limpaDoc(cells[34]);
        const valorServicos = parseMoney(cells[26]);
        const situacaoBruta = cells[22];
        const dataCancelamento = cells[23];

        const nota = {
            numero: String(cells[1] || '').trim(),
            dataHoraEmissao: parseDataHora(cells[2]),
            codigoVerificacao: String(cells[3] || '').trim(),
            tipoRps: String(cells[4] || '').trim(),
            serieRps: String(cells[5] || '').trim(),
            numeroRps: String(cells[6] || '').trim(),
            dataFatoGerador: parseDataHora(cells[7]),
            // Prestador
            ccmPrestador,
            cnpjPrestador,
            razaoSocialPrestador: String(cells[11] || '').trim(),
            enderecoPrestador: {
                tipo: cells[12] || '',
                logradouro: cells[13] || '',
                numero: cells[14] || '',
                complemento: cells[15] || '',
                bairro: cells[16] || '',
                cidade: cells[17] || '',
                uf: cells[18] || '',
                cep: cells[19] || '',
            },
            emailPrestador: cells[20] || '',
            optanteSimples: cells[21] === '4' || cells[21] === '4 ',
            // Situação
            situacao: classificaSituacao(situacaoBruta, dataCancelamento),
            situacaoBruta: String(situacaoBruta || '').trim(),
            dataCancelamento: dataCancelamento ? parseDataHora(dataCancelamento) : null,
            // Valores
            valorServicos,
            valorDeducoes: parseMoney(cells[27]),
            codigoServico: String(cells[28] || '').trim(),
            aliquota: parseMoney(cells[29]),
            issDevido: parseMoney(cells[30]),
            valorCredito: parseMoney(cells[31]),
            issRetido: String(cells[32] || '').trim().toUpperCase(), // S/N
            // Tomador
            cnpjTomador,
            inscricaoMunicipalTomador: limpaCcm(cells[35]),
            inscricaoEstadualTomador: String(cells[36] || '').trim(),
            razaoSocialTomador: String(cells[37] || '').trim(),
            enderecoTomador: {
                tipo: cells[38] || '',
                logradouro: cells[39] || '',
                numero: cells[40] || '',
                complemento: cells[41] || '',
                bairro: cells[42] || '',
                cidade: cells[43] || '',
                uf: cells[44] || '',
                cep: cells[45] || '',
            },
            emailTomador: cells[46] || '',
            // Tributos retidos
            issPago: parseMoney(cells[48]),
            issAPagar: parseMoney(cells[49]),
            pisRetido: parseMoney(cells[55]),
            cofinsRetida: parseMoney(cells[56]),
            contribPrevidenciariaRetida: parseMoney(cells[57]),
            irRetido: parseMoney(cells[58]),
            contribSociaisRetidas: parseMoney(cells[59]),
            cargaTributariaValor: parseMoney(cells[60]),
            cargaTributariaPct: parseMoney(cells[61]),
            municipioPrestacaoIbge: String(cells[65] || '').trim(),
            valorTotalRecebido: parseMoney(cells[68]),
            // Reforma Tributária (campos novos v2 — podem estar 0 em abril/2026)
            valorIbs: parseMoney(cells[128]),
            valorCbs: parseMoney(cells[132]),
            valorInicialCobrado: parseMoney(cells[133]),
            valorFinalCobrado: parseMoney(cells[134]),
            // Descrição (sempre na última coluna)
            discriminacaoServicos: String(cells[164] || cells[cells.length - 1] || '').trim(),
        };
        notas.push(nota);
    }

    // Inferi período pela menor/maior data
    let dtMin = null, dtMax = null;
    for (const n of notas) {
        if (!n.dataHoraEmissao) continue;
        if (!dtMin || n.dataHoraEmissao < dtMin) dtMin = n.dataHoraEmissao;
        if (!dtMax || n.dataHoraEmissao > dtMax) dtMax = n.dataHoraEmissao;
    }

    const valorSomaCalculada = notas.reduce((acc, n) => acc + (n.valorServicos || 0), 0);

    // FAROL HONESTO: linha de detalhe é a que começa com "2". Se o arquivo tem
    // conteúdo e NENHUMA linha de detalhe foi reconhecida, isso é falha de
    // leitura — não "arquivo sem notas". Zero em silêncio é o que fazia a
    // equipe achar que importou.
    const linhasComConteudo = rawLines.slice(1).filter((l) => l && l.trim()).length;
    return {
        layout: 'V.006',
        separador,
        linhasComConteudo,
        ccmExportado,
        totalNotas: notas.length,
        totalDeclarado,
        valorSomaCalculada: +valorSomaCalculada.toFixed(2),
        valorTotalDeclarado,
        periodo: { inicio: dtMin, fim: dtMax },
        notas,
        // Validações
        contagemBate: totalDeclarado === null || totalDeclarado === notas.length,
        somaBate: valorTotalDeclarado === null
            || Math.abs(valorSomaCalculada - valorTotalDeclarado) < 0.01,
    };
}

/**
 * QUE DOCUMENTO É ESTE ARQUIVO?
 *
 * O portal da PMSP exporta MAIS DE UM documento com a mesma cara (CSV/TXT do
 * "Exportação de..."), e o parser acima lê UM só: a **NFS-e**, layout V.006,
 * cuja linha de nota começa com "2".
 *
 * O caso que motivou isto (11/08, Paulo): veio um `NFTS_66958369_...csv` e o
 * app respondeu "nenhuma linha reconhecida — confira se é o export de NFS-e".
 * Estava tecnicamente certo e praticamente inútil.
 *
 * NFTS é a **Nota Fiscal do TOMADOR de Serviços** — quem emite é o cliente,
 * quando o prestador não emite NFS-e paulistana, e é ela que carrega o ISS
 * RETIDO. E o CFI **TEM módulo de NFTS** (card "NFTS São Paulo"), só que ele faz
 * o caminho CONTRÁRIO deste arquivo:
 *
 *   módulo NFTS  →  PDFs das notas tomadas  →  TXT V.001 pra EMITIR em lote na PMSP
 *   este arquivo →  export do portal com as NFTS **JÁ EMITIDAS** (a volta)
 *
 * A volta não existe hoje: o app gera o lote e nunca lê de volta o que a PMSP
 * aceitou. Por isso a mensagem manda pro módulo certo E diz a limitação — sem
 * isso o colaborador procura no card NFTS uma importação que não está lá.
 *
 * Esta função NÃO tenta ler NFTS (o layout não está aqui, e layout de arquivo
 * fiscal não se deduz — a regra da casa). Ela só NOMEIA o que chegou, pra
 * mensagem de erro dizer a verdade e a ação certa.
 *
 * @param {string} nomeArquivo nome original enviado pelo navegador
 * @returns {{tipo:'nfse'|'nfts'|'desconhecido', rotulo:string, acao:string}|null}
 */
export function identificarDocumentoDoPortal(nomeArquivo) {
    const nome = String(nomeArquivo || '').toUpperCase();
    if (!nome) return null;

    if (/(^|[^A-Z])NFTS/.test(nome)) {
        return {
            tipo: 'nfts',
            rotulo: 'NFTS — Nota Fiscal do TOMADOR de Serviços (documento diferente da NFS-e)',
            acao: 'Esta aba importa NFS-e (layout V.006). A NFTS tem MÓDULO PRÓPRIO no CFI: '
                + 'card "NFTS São Paulo". Atenção, porém: aquele módulo faz o caminho de IDA — lê os '
                + 'PDFs das notas tomadas e gera o TXT V.001 pra emitir o lote na PMSP. Ler de VOLTA o '
                + 'export das NFTS já emitidas (que é este arquivo) ainda não existe em lugar nenhum. '
                + 'Mande o arquivo ao Paulo pra esse retorno ser construído — é ele que fecha a prova '
                + 'de que as NFTS foram emitidas e alimenta o ISS retido.',
        };
    }
    if (/(^|[^A-Z])NFS?E/.test(nome)) {
        return { tipo: 'nfse', rotulo: 'NFS-e', acao: '' };
    }
    return { tipo: 'desconhecido', rotulo: '', acao: '' };
}
