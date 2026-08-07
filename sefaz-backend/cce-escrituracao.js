// ============================================================================
// sefaz-backend/cce-escrituracao.js  (PURO — testável)
// ----------------------------------------------------------------------------
// A CARTA DE CORREÇÃO muda a escrituração — e ninguém estava vendo.
//
// A CC-e é CAPTURADA desde sempre (fica em `documentos_fiscais.eventos[]`, com
// o `xCorrecao`) e aparece na lista de XMLs com um selo. Mas NENHUM ponto da
// escrituração lê esse array: nem o gerador do SPED, nem o Exportar SAGE.
//
// O problema é concreto. Pelo Ajuste SINIEF 07/05 (cláusula 14-A §1º) a CC-e
// PODE corrigir a **natureza da operação** e o **CFOP** — e o CFOP manda no
// livro, no C190, no DIFAL de aquisição, na DIPAM e no bloco K. Se o cliente
// corrigiu o CFOP e a gente escritura o XML original, o livro sai justamente
// com o CFOP que ele mandou corrigir. Ninguém percebe até a fiscalização.
//
// O QUE ESTE MÓDULO **NÃO** FAZ: aplicar a correção. O `xCorrecao` é TEXTO
// LIVRE — não existe campo dizendo "CFOP: de 5102 para 5405". Deduzir e
// sobrescrever o documento seria inventar dado fiscal. A regra é a permanente:
// **ALERTA, NUNCA CONTORNO** — o app acende, diz onde, e o colaborador decide.
//
// TRÊS CLASSES, porque elas pedem coisas diferentes:
//
//   muda-escrituracao  fala em CFOP/natureza/NCM ⇒ CONFERIR antes de escriturar
//   indevida-suspeita  fala em VALOR, quantidade, partes ou data — coisas que a
//                      CC-e NÃO PODE corrigir. Ou o texto está mal escrito, ou o
//                      cliente usou CC-e onde precisava cancelar e reemitir; nos
//                      dois casos o livro provavelmente está errado.
//   sem-efeito-fiscal  transportador, placa, observação ⇒ informativo
// ============================================================================

/** Termos que indicam correção COM efeito na escrituração. */
const TERMOS_ESCRITURACAO = [
    /\bcfop\b/i,
    /natureza\s+da\s+opera/i,
    /\bnat\.?\s*op\b/i,
    /\bncm\b/i,
    /\bcst\b/i,
    /\bcsosn\b/i,
];

/**
 * Termos que a CC-e NÃO PODE corrigir (Ajuste SINIEF 07/05, cláusula 14-A §1º):
 * valores, quantidades, dados cadastrais que mudem remetente/destinatário, e
 * data de emissão/saída. Aparecer aqui não é erro do app — é sinal de que o
 * documento precisa de olho humano.
 */
const TERMOS_PROIBIDOS = [
    /\bvalor(es)?\b/i,
    /\bpre[çc]o\b/i,
    /\bbase\s+de\s+c[áa]lculo\b/i,
    /\bicms\b/i,
    /\bal[íi]quota\b/i,
    /\bquantidade\b/i,
    /\bqtde?\b/i,
    /\bcnpj\b/i,
    /\bcpf\b/i,
    /\bdestinat[áa]rio\b/i,
    /\bremetente\b/i,
    /data\s+de\s+(emiss|sa[íi]da)/i,
];

const so = (v) => String(v ?? '').trim();

/**
 * "de 5102 para 5405" / "de: 5102 para: 5405" / "5102 para 5405".
 * SUGESTÃO carimbada com o texto de origem — nunca aplicada sozinha.
 */
const DE_PARA = /\bde:?\s*([0-9A-Za-zÀ-ÿ.\-/ ]{1,40}?)\s+para:?\s*([0-9A-Za-zÀ-ÿ.\-/ ]{1,40})/i;

/**
 * Classifica UMA carta de correção pelo texto.
 *
 * @param {object} evento item de `documentos_fiscais.eventos[]`
 * @returns {{classe: string, motivo: string, exigeConferencia: boolean,
 *            termos: string[], sugestao: {de:string, para:string}|null, texto: string}}
 */
export function classificarCce(evento) {
    const texto = so(evento?.xCorrecao);
    if (!texto) {
        // CC-e sem texto legível NÃO é CC-e inofensiva: é CC-e que não dá pra
        // avaliar. Ausência de texto ≠ ausência de efeito.
        return {
            classe: 'sem-texto',
            motivo: 'Carta de correção capturada SEM o texto da correção — não dá pra saber o que mudou.',
            exigeConferencia: true,
            termos: [], sugestao: null, texto: '',
        };
    }

    const achados = (lista) => lista
        .filter((re) => re.test(texto))
        .map((re) => re.source.replace(/\\b|\\s\+|[\\()?:]/g, '').slice(0, 24));

    const proibidos = achados(TERMOS_PROIBIDOS);
    const escrituracao = achados(TERMOS_ESCRITURACAO);
    const m = DE_PARA.exec(texto);
    const sugestao = m ? { de: so(m[1]), para: so(m[2]) } : null;

    // A PROIBIDA vence: se o texto fala em valor, o problema é maior que o CFOP.
    if (proibidos.length) {
        return {
            classe: 'indevida-suspeita',
            motivo: 'A correção menciona algo que a CC-e NÃO PODE corrigir (valores, quantidade, partes ou data — '
                + 'Ajuste SINIEF 07/05, cláusula 14-A §1º). Ou o texto está mal escrito, ou a nota precisava de '
                + 'cancelamento e reemissão.',
            exigeConferencia: true,
            termos: proibidos, sugestao, texto,
        };
    }
    if (escrituracao.length) {
        return {
            classe: 'muda-escrituracao',
            motivo: 'A correção mexe em campo que MANDA na escrituração (CFOP/natureza/NCM/CST). O livro sai do XML '
                + 'ORIGINAL — confira antes de gerar o arquivo.',
            exigeConferencia: true,
            termos: escrituracao, sugestao, texto,
        };
    }
    return {
        classe: 'sem-efeito-fiscal',
        motivo: 'Correção sem efeito aparente na escrituração (transporte, observação, descrição).',
        exigeConferencia: false,
        termos: [], sugestao, texto,
    };
}

/** As CC-e de um documento (o array `eventos` guarda todos os tipos). */
export function ccesDoDocumento(doc) {
    return (doc?.eventos || []).filter((e) => e?.tipo === 'cce' || String(e?.tpEvento) === '110110');
}

export const CLASSES_CCE = ['indevida-suspeita', 'muda-escrituracao', 'sem-texto', 'sem-efeito-fiscal'];
const PESO = Object.fromEntries(CLASSES_CCE.map((c, i) => [c, i]));

/**
 * Varredura de um período: quais documentos têm CC-e e quais delas pedem
 * conferência ANTES de escriturar.
 *
 * @param {Array} documentos docs da competência (com `eventos`)
 */
export function varrerCcesDoPeriodo(documentos) {
    const linhas = [];
    for (const d of documentos || []) {
        const cces = ccesDoDocumento(d);
        if (!cces.length) continue;
        // Só a ÚLTIMA sequência de cada correção vale? Não: cada CC-e é um
        // evento próprio e todas ficam válidas. Mostramos todas, ordenadas.
        for (const ev of cces) {
            const c = classificarCce(ev);
            linhas.push({
                chave: so(d.chave),
                numero: so(d.numero) || null,
                direcao: d.direcao || null,
                emitente: so(d.xNomeEmit || d.emitente?.nome) || null,
                empresaId: d.empresaId || null,
                empresaCnpj: so(d.empresaCnpj) || null,
                competencia: so(d.competencia) || null,
                nSeqEvento: ev?.nSeqEvento ?? null,
                dhEvento: ev?.dhEvento || null,
                ...c,
            });
        }
    }

    linhas.sort((a, b) => (PESO[a.classe] - PESO[b.classe])
        || String(a.dhEvento || '').localeCompare(String(b.dhEvento || '')));

    const conta = (c) => linhas.filter((l) => l.classe === c).length;
    const exigemConferencia = linhas.filter((l) => l.exigeConferencia).length;
    const docsComCce = new Set(linhas.map((l) => l.chave)).size;

    return {
        linhas,
        resumo: {
            cces: linhas.length,
            documentos: docsComCce,
            exigemConferencia,
            indevidaSuspeita: conta('indevida-suspeita'),
            mudaEscrituracao: conta('muda-escrituracao'),
            semTexto: conta('sem-texto'),
            semEfeitoFiscal: conta('sem-efeito-fiscal'),
        },
        avisos: avisosDaVarredura(linhas),
    };
}

function avisosDaVarredura(linhas) {
    const avisos = [];
    const indevidas = linhas.filter((l) => l.classe === 'indevida-suspeita').length;
    const muda = linhas.filter((l) => l.classe === 'muda-escrituracao').length;
    const semTexto = linhas.filter((l) => l.classe === 'sem-texto').length;

    if (muda > 0) {
        avisos.push(
            `${muda} carta(s) de correção mexem em CFOP/natureza/NCM — e o livro é gerado do XML ORIGINAL. `
            + 'Confira documento a documento antes de gerar o arquivo: o CFOP manda no C190, no DIFAL e na DIPAM.',
        );
    }
    if (indevidas > 0) {
        avisos.push(
            `🚨 ${indevidas} carta(s) mencionam algo que a CC-e NÃO PODE corrigir (valor, quantidade, partes ou data). `
            + 'Ou o texto está mal escrito, ou a nota precisava de cancelamento e reemissão — nos dois casos o livro '
            + 'provavelmente está errado.',
        );
    }
    if (semTexto > 0) {
        avisos.push(
            `${semTexto} carta(s) vieram SEM o texto da correção — não dá pra avaliar o efeito. Reimporte o XML do evento.`,
        );
    }
    if (linhas.length > 0) {
        avisos.push(
            'O app NÃO aplica a correção sozinho: o texto da CC-e é livre e deduzir o campo corrigido seria inventar '
            + 'dado fiscal. Quem decide é você, no documento.',
        );
    }
    return avisos;
}
