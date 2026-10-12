// ============================================================================
// sefaz-backend/dp-pagamentos.js  (DARF pago, consultado pelo Consultor DP)
// ----------------------------------------------------------------------------
// Paulo, 11/10/2026: "senão pode trabalhar no CFI". O "Pagamento de guias" do
// DP dá baixa no DARF à mão; com esta consulta a baixa sai do que a Receita
// registrou como arrecadado.
//
// Leiaute conferido na documentação oficial do Integra Contador (12/10/2026),
// "Integra Pagamento › PAGTOWEB › Consulta Pagamento":
//   idSistema PAGTOWEB · idServico PAGAMENTOS71 · versaoSistema "1.0" · /Consultar
//   entrada (todos opcionais, combináveis): numeroDocumentoLista (até 17
//     posições cada), codigoReceitaLista (até 4), intervaloDataArrecadacao
//     {dataInicial, dataFinal} AAAA-MM-DD, intervaloValorTotalDocumento,
//     codigoTipoDocumentoLista; obrigatórios: tamanhoDaPagina (máx. 100) e
//     primeiroDaPagina (começa em 0);
//   saída: `dados` = lista de DocumentoArrecadacaoIC (numeroDocumento, tipo,
//     periodoApuracao, dataArrecadacao, dataVencimento, receitaPrincipal,
//     referencia, valorTotal/Principal/Multa/Juros, saldos, desmembramentos).
// A consulta sempre devolve documentos do contribuinte do pedido.
//
// Regras:
//  - sem filtro de número ou de data a consulta não sai (não puxa o histórico
//    inteiro da empresa);
//  - "Ausente ≠ zero": valor que o SERPRO manda null continua null; resposta sem
//    lista volta ok=false, nunca "nada pago";
//  - documento pedido e não localizado é só "não localizado": a arrecadação
//    leva alguns dias para aparecer, então isso não é "não pago";
//  - documento que volta sem ter sido pedido (quando há lista) fica fora, com
//    aviso;
//  - resposta simulada (SERPRO_DRY_RUN) nunca chega ao DP como pagamento.
// ============================================================================

export const SERVICO_PAGAMENTOS = { idSistema: 'PAGTOWEB', idServico: 'PAGAMENTOS71', versaoSistema: '1.0' };
export const TAMANHO_MAXIMO_PAGINA = 100;
const MAX_DOCUMENTOS_POR_PEDIDO = 100;

/** Número do documento sem pontuação; até 17 posições (leiaute). */
export function normalizarNumeroDocumento(n) {
    const s = String(n ?? '').replace(/[\s.\-/]/g, '');
    return /^[0-9A-Za-z]{1,17}$/.test(s) ? s.toUpperCase() : null;
}

function dataValida(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/**
 * Corpo do pedido do DP → `dados` do PAGAMENTOS71, ou { erro }.
 * @param {object} b { numerosDocumento?, dataInicial?, dataFinal?, codigosReceita?, primeiroDaPagina?, tamanhoDaPagina? }
 */
export function montarFiltroPagamentos(b = {}) {
    const dados = {};
    let numerosDocumento = [];
    if (b.numerosDocumento !== undefined) {
        if (!Array.isArray(b.numerosDocumento)) return { erro: 'numerosDocumento deve ser uma lista.' };
        if (b.numerosDocumento.length > MAX_DOCUMENTOS_POR_PEDIDO) return { erro: `No máximo ${MAX_DOCUMENTOS_POR_PEDIDO} documentos por consulta.` };
        for (const n of b.numerosDocumento) {
            const norm = normalizarNumeroDocumento(n);
            if (!norm) return { erro: `Número de documento inválido: "${n}" (até 17 posições).` };
            if (!numerosDocumento.includes(norm)) numerosDocumento.push(norm);
        }
        if (numerosDocumento.length) dados.numeroDocumentoLista = numerosDocumento;
    }

    const temInicio = b.dataInicial !== undefined && b.dataInicial !== null && b.dataInicial !== '';
    const temFim = b.dataFinal !== undefined && b.dataFinal !== null && b.dataFinal !== '';
    if (temInicio || temFim) {
        if (!temInicio || !temFim) return { erro: 'Informe dataInicial e dataFinal juntas (AAAA-MM-DD).' };
        if (!dataValida(b.dataInicial) || !dataValida(b.dataFinal)) return { erro: 'dataInicial e dataFinal no formato AAAA-MM-DD.' };
        if (b.dataInicial > b.dataFinal) return { erro: 'dataInicial depois de dataFinal.' };
        dados.intervaloDataArrecadacao = { dataInicial: b.dataInicial, dataFinal: b.dataFinal };
    }

    if (b.codigosReceita !== undefined) {
        if (!Array.isArray(b.codigosReceita)) return { erro: 'codigosReceita deve ser uma lista.' };
        const codigos = [];
        for (const c of b.codigosReceita) {
            const s = String(c ?? '').trim();
            if (!/^\d{1,4}$/.test(s)) return { erro: `Código de receita inválido: "${c}" (até 4 dígitos).` };
            if (!codigos.includes(s)) codigos.push(s);
        }
        if (codigos.length) dados.codigoReceitaLista = codigos;
    }

    if (!dados.numeroDocumentoLista && !dados.intervaloDataArrecadacao) {
        return { erro: 'Informe os números dos documentos ou o intervalo da data de arrecadação.' };
    }

    const primeiro = b.primeiroDaPagina ?? 0;
    const tamanho = b.tamanhoDaPagina ?? TAMANHO_MAXIMO_PAGINA;
    if (!Number.isInteger(primeiro) || primeiro < 0) return { erro: 'primeiroDaPagina deve ser inteiro a partir de 0.' };
    if (!Number.isInteger(tamanho) || tamanho < 1 || tamanho > TAMANHO_MAXIMO_PAGINA) {
        return { erro: `tamanhoDaPagina entre 1 e ${TAMANHO_MAXIMO_PAGINA}.` };
    }
    dados.primeiroDaPagina = primeiro;
    dados.tamanhoDaPagina = tamanho;
    return { dados, numerosDocumento };
}

/** "2019-09-30T00:00:00-03:00" → "2019-09-30" (a data como o SERPRO escreveu, sem converter fuso). */
function soData(v) {
    const m = /^(\d{4}-\d{2}-\d{2})(T|$)/.exec(String(v ?? ''));
    return m ? m[1] : null;
}
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texto = (v) => (v === null || v === undefined || v === '' ? null : String(v));

function receita(r) {
    if (!r || typeof r !== 'object') return null;
    const ext = r.extensaoReceita && typeof r.extensaoReceita === 'object'
        ? { codigo: texto(r.extensaoReceita.codigo), descricao: texto(r.extensaoReceita.descricao) }
        : null;
    return { codigo: texto(r.codigo), descricao: texto(r.descricao), extensao: ext };
}

function valores(d) {
    return {
        valorTotal: numero(d.valorTotal),
        valorPrincipal: numero(d.valorPrincipal),
        valorMulta: numero(d.valorMulta),
        valorJuros: numero(d.valorJuros),
        valorSaldoTotal: numero(d.valorSaldoTotal),
    };
}

/** DocumentoArrecadacaoIC → o que vai ao DP. */
export function normalizarDocumento(d) {
    return {
        numeroDocumento: normalizarNumeroDocumento(d?.numeroDocumento) || texto(d?.numeroDocumento),
        tipo: d?.tipo && typeof d.tipo === 'object'
            ? { codigo: texto(d.tipo.codigo), sigla: texto(d.tipo.descricaoAbreviada), descricao: texto(d.tipo.descricao) }
            : null,
        periodoApuracao: soData(d?.periodoApuracao),
        dataArrecadacao: soData(d?.dataArrecadacao),
        dataVencimento: soData(d?.dataVencimento),
        receita: receita(d?.receitaPrincipal),
        referencia: texto(d?.referencia),
        ...valores(d || {}),
        desmembramentos: Array.isArray(d?.desmembramentos)
            ? d.desmembramentos.map((x) => ({
                sequencial: texto(x?.sequencial),
                receita: receita(x?.receitaPrincipal),
                periodoApuracao: soData(x?.periodoApuracao),
                dataVencimento: soData(x?.dataVencimento),
                ...valores(x || {}),
            }))
            : [],
    };
}

/**
 * Resposta do invokeIntegraContador → resposta do túnel.
 * @param {object} r { status, dados, mensagens }
 * @param {object} ctx { numerosDocumento: string[], tamanhoDaPagina: number, dryRun?: boolean }
 */
export function lerRetornoPagamentos(r, { numerosDocumento = [], tamanhoDaPagina = TAMANHO_MAXIMO_PAGINA, dryRun = false } = {}) {
    const mensagens = Array.isArray(r?.mensagens) ? r.mensagens : [];
    if (dryRun || r?.dados?._dryRun) {
        return { ok: false, fonte: 'dry_run', error: 'O Consultor Fiscal está em modo simulado (SERPRO_DRY_RUN): nenhum pagamento foi consultado.', mensagens };
    }
    if (!Array.isArray(r?.dados)) {
        const msgs = mensagens.map((m) => m?.texto || '').filter(Boolean).join(' ');
        return {
            ok: false, fonte: 'serpro',
            error: `O SERPRO não devolveu a lista de pagamentos${msgs ? `: ${msgs}` : '.'} Sem a lista, nada é dado como pago nem como não pago.`,
            mensagens,
        };
    }

    const avisos = [];
    const pedidos = new Set(numerosDocumento);
    let documentos = r.dados.map(normalizarDocumento);
    if (pedidos.size) {
        const fora = documentos.filter((d) => !pedidos.has(d.numeroDocumento));
        if (fora.length) {
            avisos.push(`${fora.length} documento(s) devolvido(s) sem ter sido pedido(s) ficaram de fora.`);
            documentos = documentos.filter((d) => pedidos.has(d.numeroDocumento));
        }
    }
    for (const d of documentos) {
        if (!d.dataArrecadacao) avisos.push(`Documento ${d.numeroDocumento}: o SERPRO não informou a data de arrecadação.`);
        if (d.valorTotal === null) avisos.push(`Documento ${d.numeroDocumento}: o SERPRO não informou o valor total.`);
    }

    const situacoes = numerosDocumento.map((n) => {
        const doc = documentos.find((d) => d.numeroDocumento === n) || null;
        return doc
            ? { numeroDocumento: n, localizado: true, pagamento: doc }
            : { numeroDocumento: n, localizado: false, pagamento: null, observacao: 'Não localizado no PAGTOWEB. A arrecadação leva alguns dias para aparecer; isto não quer dizer que não foi pago.' };
    });

    return {
        ok: true,
        fonte: 'serpro',
        documentos,
        situacoes,
        // Página cheia: pode haver mais (chamar de novo com primeiroDaPagina adiante).
        podeHaverMais: r.dados.length >= tamanhoDaPagina,
        avisos,
        mensagens,
    };
}

// ─── Comprovante de arrecadação ─────────────────────────────────────────────
// Leiaute oficial (12/10/2026), "Integra Pagamento › PAGTOWEB › Emite
// Comprovante Pagamento": PAGTOWEB/COMPARRECADACAO72, versão "1.0", /Consultar;
// entrada { numeroDocumento } (obrigatório, até 17 bytes). A tabela de saída diz
// "dados = PDF codificado em Base64 (String)", mas o exemplo oficial traz
// dados = {"pdf": "<base64>"}. As duas formas são aceitas e o conteúdo é
// conferido: só passa base64 que começa como PDF ("%PDF" → "JVBER").

export const SERVICO_COMPROVANTE = { idSistema: 'PAGTOWEB', idServico: 'COMPARRECADACAO72', versaoSistema: '1.0' };

/** Resposta do invokeIntegraContador → { ok, fonte, pdfBase64 } ou ok=false com o motivo. */
export function lerComprovante(r, { dryRun = false } = {}) {
    const mensagens = Array.isArray(r?.mensagens) ? r.mensagens : [];
    if (dryRun || r?.dados?._dryRun) {
        return { ok: false, fonte: 'dry_run', error: 'O Consultor Fiscal está em modo simulado (SERPRO_DRY_RUN): nenhum comprovante foi emitido.', mensagens };
    }
    const bruto = typeof r?.dados === 'string' ? r.dados : typeof r?.dados?.pdf === 'string' ? r.dados.pdf : '';
    const pdfBase64 = bruto.replace(/\s/g, '');
    if (!pdfBase64.startsWith('JVBER')) {
        const msgs = mensagens.map((m) => m?.texto || '').filter(Boolean).join(' ');
        return { ok: false, fonte: 'serpro', error: `O SERPRO não devolveu o PDF do comprovante${msgs ? `: ${msgs}` : '.'}`, mensagens };
    }
    return { ok: true, fonte: 'serpro', pdfBase64, mensagens };
}
