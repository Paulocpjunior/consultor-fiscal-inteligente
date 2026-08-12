// ============================================================================
// sefaz-backend/nfts-sp-csv-parser.js  (PURO — sem io, testável)
//
// Parser do export de NFTS do portal nfe.prefeitura.sp.gov.br.
//
// NFTS = Nota Fiscal do TOMADOR de Serviços. Quem emite é o CLIENTE, quando o
// prestador não emite NFS-e paulistana — e é ela que carrega o ISS RETIDO.
// É documento DIFERENTE da NFS-e e tem layout DIFERENTE (147 colunas contra as
// 73 do V.006), por isso não cabia no parser existente.
//
// ─── DUAS DECISÕES DE DESENHO, E O PORQUÊ ───────────────────────────────────
//
// 1. **CASA COLUNA POR NOME, NÃO POR ÍNDICE.** O parser da NFS-e usa posição
//    fixa (`cells[26]`) porque o layout V.006 foi conferido contra arquivos
//    preenchidos. Aqui eu só tive um export VAZIO (12/08/2026): o cabeçalho é
//    real, as linhas de nota nunca foram vistas. Fixar índice sobre layout não
//    comprovado é inventar leiaute — a regra que o E510 ensinou. Por nome, uma
//    coluna nova no meio (e elas vêm: o layout já traz IBS/CBS da reforma) não
//    desloca nada.
// 2. **EXPORT VAZIO É RESPOSTA, NÃO FALHA.** Um arquivo com só a linha `Total;0`
//    significa "não houve NFTS no período" — e isso precisa chegar assim ao
//    colaborador. Foi exatamente o caso que gerou este módulo: o app respondeu
//    "NENHUMA linha de nota foi reconhecida", e a pessoa foi procurar defeito
//    onde não havia.
//    MAS zero também NÃO é sucesso automático: se o cliente tomou serviço de
//    prestador de fora de SP ou sem NFS-e paulistana, a NFTS DEVERIA existir.
//    Por isso o retorno traz `periodoSemNfts` + a ação, nunca um "ok" mudo.
// ============================================================================

/** Colunas que o app precisa, mapeadas pelo TEXTO do cabeçalho. */
const COLUNAS = {
    tipoRegistro: 'Tipo de Registro',
    numero: 'Nº NFTS',
    dataEmissao: 'Data Hora Emissão NFTS',
    numeroDocumento: 'Número do Documento',
    serieDocumento: 'Série do Documento',
    dataPrestacao: 'Data da Prestação de Serviços',
    ccmTomador: 'Inscrição Municipal do Tomador',
    docTomador: 'CPF/CNPJ do Tomador',
    nomeTomador: 'Razão Social do Tomador',
    dataCancelamento: 'Data de Cancelamento',
    valorServicos: 'Valor dos Serviços',
    valorDeducoes: 'Valor das Deduções',
    codigoServico: 'Código do Serviço Prestado na NFTS',
    subitemLista: 'Código do Subitem da Lista',
    aliquota: 'Alíquota',
    valorIss: 'Valor ISS',
    issRetido: 'ISS Retido',
    docPrestador: 'CPF/CNPJ do Prestador',
    ccmPrestador: 'Inscrição Municipal do Prestador',
    nomePrestador: 'Razão Social do Prestador',
    ufPrestador: 'UF do Prestador',
    cidadePrestador: 'Cidade do Prestador',
    discriminacao: 'Discriminação dos Serviços',
};

const normalizar = (s) => String(s || '')
    .replace(/^﻿/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase();

/** Mapa header→índice, tolerante a acento e caixa. */
export function mapearColunas(cabecalho) {
    const idx = new Map();
    cabecalho.forEach((nome, i) => {
        const k = normalizar(nome);
        if (k && !idx.has(k)) idx.set(k, i);
    });
    const out = {};
    for (const [campo, rotulo] of Object.entries(COLUNAS)) {
        const i = idx.get(normalizar(rotulo));
        out[campo] = i === undefined ? null : i;
    }
    return out;
}

function parseCsvLine(line, sep = ';') {
    const cells = [];
    let cur = '', aspas = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (aspas && line[i + 1] === '"') { cur += '"'; i++; }
            else aspas = !aspas;
        } else if (ch === sep && !aspas) { cells.push(cur); cur = ''; }
        else cur += ch;
    }
    cells.push(cur);
    return cells;
}

const money = (s) => {
    const t = String(s ?? '').trim();
    if (!t) return null;                       // vazio ≠ zero
    const n = Number(t.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * @param {Buffer|string} input arquivo do portal (ISO-8859-1)
 * @returns {{notas:Array, totalDeclarado:number|null, valorServicosDeclarado:number|null,
 *            valorIssDeclarado:number|null, periodoSemNfts:boolean, acao:string|null,
 *            colunasFaltando:string[], linhasComConteudo:number, colunas:number}}
 */
export function parseCsvNftsSp(input) {
    const texto = Buffer.isBuffer(input) ? input.toString('latin1') : String(input || '');
    const linhas = texto.split(/\r?\n/).filter((l) => l.length > 0);
    if (!linhas.length) throw new Error('Arquivo vazio.');

    const cabecalho = parseCsvLine(linhas[0]);
    const col = mapearColunas(cabecalho);

    // Coluna essencial ausente ⇒ NÃO é export de NFTS (ou o layout mudou). Não
    // se adivinha posição: quem chama recebe a lista e decide o que dizer.
    const essenciais = ['numero', 'valorServicos', 'valorIss', 'docPrestador'];
    const colunasFaltando = essenciais.filter((c) => col[c] === null)
        .map((c) => COLUNAS[c]);

    const notas = [];
    let totalDeclarado = null, valorServicosDeclarado = null, valorIssDeclarado = null;
    let linhasComConteudo = 0;

    for (let i = 1; i < linhas.length; i++) {
        const linha = linhas[i];
        if (!linha.trim()) continue;
        linhasComConteudo++;
        const c = parseCsvLine(linha);
        const tipo = String(c[0] ?? '').trim().toLowerCase();

        // Linha de fechamento do portal: "Total;<qtd>;...;<vServ>;<vDed>;...;<vISS>"
        if (tipo === 'total') {
            totalDeclarado = Number(String(c[1] ?? '').trim()) || 0;
            if (col.valorServicos !== null) valorServicosDeclarado = money(c[col.valorServicos]);
            if (col.valorIss !== null) valorIssDeclarado = money(c[col.valorIss]);
            continue;
        }
        if (colunasFaltando.length) continue;          // sem mapa, não inventa nota
        if (!String(c[col.numero] ?? '').trim()) continue;

        const at = (campo) => (col[campo] === null ? null : (c[col[campo]] ?? '').trim() || null);
        notas.push({
            numero: at('numero'),
            dataEmissao: at('dataEmissao'),
            // Documento do PRESTADOR que a NFTS cobre — é a chave da duplicidade.
            numeroDocumento: at('numeroDocumento'),
            serieDocumento: at('serieDocumento'),
            dataPrestacao: at('dataPrestacao'),
            ccmTomador: soDigitos(at('ccmTomador')) || null,
            docTomador: soDigitos(at('docTomador')) || null,
            nomeTomador: at('nomeTomador'),
            cancelada: !!at('dataCancelamento'),
            dataCancelamento: at('dataCancelamento'),
            valorServicos: col.valorServicos === null ? null : money(c[col.valorServicos]),
            valorDeducoes: col.valorDeducoes === null ? null : money(c[col.valorDeducoes]),
            codigoServico: at('codigoServico'),
            subitemLista: at('subitemLista'),
            aliquota: col.aliquota === null ? null : money(c[col.aliquota]),
            valorIss: col.valorIss === null ? null : money(c[col.valorIss]),
            issRetido: at('issRetido'),
            docPrestador: soDigitos(at('docPrestador')) || null,
            ccmPrestador: soDigitos(at('ccmPrestador')) || null,
            nomePrestador: at('nomePrestador'),
            ufPrestador: at('ufPrestador'),
            cidadePrestador: at('cidadePrestador'),
            discriminacao: at('discriminacao'),
        });
    }

    // Zero NFTS é RESPOSTA — mas nunca um "ok" mudo.
    const periodoSemNfts = notas.length === 0 && totalDeclarado === 0;

    // DUPLICIDADE: duas NFTS pro MESMO documento do mesmo prestador, mesma data
    // e mesmo valor. Achado real no export de 07/2026 (NFTS 66 e 67, doc 1269
    // da REGULATORIO MAIS, R$ 690,00, emitidas com 16 min de diferença).
    // NFTS em dobro declara o serviço duas vezes — e quando há ISS retido,
    // declara o imposto duas vezes.
    const porChave = new Map();
    for (const n of notas) {
        if (n.cancelada) continue;
        const chave = [n.docPrestador, n.numeroDocumento, n.dataPrestacao, n.valorServicos].join('|');
        if (!n.docPrestador || !n.numeroDocumento) continue;   // sem chave, não acusa
        if (!porChave.has(chave)) porChave.set(chave, []);
        porChave.get(chave).push(n);
    }
    const duplicadas = Array.from(porChave.values())
        .filter((g) => g.length > 1)
        .map((g) => ({
            docPrestador: g[0].docPrestador,
            nomePrestador: g[0].nomePrestador,
            numeroDocumento: g[0].numeroDocumento,
            dataPrestacao: g[0].dataPrestacao,
            valorServicos: g[0].valorServicos,
            valorIss: g[0].valorIss,
            numeros: g.map((n) => n.numero),
            acao: 'Duas NFTS para o MESMO documento do prestador. Cancele a duplicada no portal — '
                + 'NFTS em dobro declara o serviço duas vezes (e o ISS retido, quando houver).',
        }));

    return {
        notas,
        totalDeclarado,
        valorServicosDeclarado,
        valorIssDeclarado,
        periodoSemNfts,
        acao: periodoSemNfts
            ? 'O portal informou 0 NFTS no período — o arquivo está correto e não há nada a importar. '
              + 'ATENÇÃO: zero NFTS não é conclusão. Se o cliente tomou serviço de prestador de fora de SP '
              + 'ou que não emite NFS-e paulistana, a NFTS DEVERIA ter sido emitida — e o ISS retido não foi declarado.'
            : null,
        duplicadas,
        colunasFaltando,
        linhasComConteudo,
        colunas: cabecalho.length,
    };
}
