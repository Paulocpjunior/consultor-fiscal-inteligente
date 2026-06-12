// ============================================================================
// dctfweb-mit-normalizer.js  (PURO — sem io/firebase, testavel)
//
// Normaliza o response oficial do MIT (LISTAAPURACOES317 + CONSAPURACAO316)
// num shape estavel { tributos: {IRPJ,CSLL,PIS,COFINS}, ... } pra
// cruzar contra a apuracao do app.
//
// HONESTIDADE sobre o shape do MIT:
//   O provider devolve `apuracaoMit` como `any` (SERPRO entrega JSON cru, sem
//   schema publicado sem cert). NAO sabemos os nomes EXATOS dos campos sem uma
//   chamada real. Por isso este normalizador eh DEFENSIVO:
//     - tenta varias estruturas conhecidas (debitos[]/tributos[]/itens[]);
//     - tenta varios nomes de campo de codigo (codigoReceita/codigo/cod);
//     - tenta varios nomes de valor (valor/valorDebito/vlrDebito/valorPrincipal);
//     - se NAO conseguir extrair NADA, retorna { lido: false, motivo } —
//       NUNCA zeros falsos (que virariam divergencia fake no cruzamento).
//   O serpro-smoke captura o LISTAAPURACOES317 real; o detalhe usa
//   CONSAPURACAO316 com idApuracao pra confirmar/ajustar.
//
// Tabela de codigos de receita: informacao PUBLICA da RFB (nao inventada).
// Codigos nao reconhecidos vao pra `outros` (reportados, nao descartados).
// ============================================================================

// Codigo de receita -> familia de tributo. Fonte: tabela de codigos RFB.
// Cobertura dos principais codigos federais que aparecem no MIT.
const CODIGO_FAMILIA = {
    // IRPJ
    '2362': 'IRPJ', '2390': 'IRPJ', '0220': 'IRPJ', '2319': 'IRPJ',
    '2456': 'IRPJ', '5993': 'IRPJ', '3373': 'IRPJ', '1599': 'IRPJ', '2430': 'IRPJ',
    // CSLL
    '2484': 'CSLL', '6012': 'CSLL', '2469': 'CSLL', '6758': 'CSLL', '2030': 'CSLL', '6773': 'CSLL',
    // PIS/PASEP
    '8109': 'PIS', '6912': 'PIS', '4574': 'PIS', '8301': 'PIS', '6824': 'PIS',
    // COFINS
    '2172': 'COFINS', '5856': 'COFINS', '5442': 'COFINS', '2050': 'COFINS', '6840': 'COFINS',
};

const FAMILIAS = ['IRPJ', 'CSLL', 'PIS', 'COFINS'];

const GRUPO_MIT_FAMILIA = {
    Irpj: 'IRPJ',
    IRPJ: 'IRPJ',
    Csll: 'CSLL',
    CSLL: 'CSLL',
    PisPasep: 'PIS',
    PIS: 'PIS',
    Cofins: 'COFINS',
    COFINS: 'COFINS',
};

function familiaPorCodigo(codigo) {
    const c = String(codigo || '').replace(/\D/g, '').slice(0, 4);
    return CODIGO_FAMILIA[c] || null;
}

// Tenta extrair familia tambem por descricao textual (fallback quando codigo
// nao bate). Ex: "IRPJ - Lucro Real" -> IRPJ.
function familiaPorDescricao(desc) {
    const d = String(desc || '').toUpperCase();
    if (/\bIRPJ\b|IMPOSTO DE RENDA PJ|IMPOSTO SOBRE A RENDA/.test(d)) return 'IRPJ';
    if (/\bCSLL\b|CONTRIB.*SOCIAL.*LUCRO/.test(d)) return 'CSLL';
    if (/\bCOFINS\b/.test(d)) return 'COFINS'; // antes de PIS (COFINS contem nada de PIS, ok)
    if (/\bPIS\b|PASEP/.test(d)) return 'PIS';
    return null;
}

function num(v) {
    if (v == null || v === '') return 0;
    // SERPRO as vezes manda valor como string "1.234,56" ou "1234.56" ou number.
    if (typeof v === 'number') return v;
    let s = String(v).trim();
    // formato BR "1.234,56" -> "1234.56"
    if (/,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
}

// Encontra o array de debitos dentro de uma estrutura desconhecida.
// Tenta chaves conhecidas; se nao achar, varre 1 nivel procurando o primeiro
// array de objetos que tenha cara de debito (tem codigo OU valor).
function acharArrayDebitos(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const oficiais = extrairDebitosOficiais(raw);
    if (oficiais?.length) return oficiais;

    const candidatasChaves = [
        'debitos', 'tributos', 'itens', 'creditosVinculados', 'apuracao',
        'debitosApurados', 'listaDebitos', 'tributosApurados', 'detalhamento',
    ];
    for (const k of candidatasChaves) {
        if (Array.isArray(raw[k]) && raw[k].length) return raw[k];
        // aninhado 1 nivel: raw.apuracao.debitos
        if (raw[k] && typeof raw[k] === 'object') {
            for (const k2 of candidatasChaves) {
                if (Array.isArray(raw[k][k2]) && raw[k][k2].length) return raw[k][k2];
            }
        }
    }
    // varredura generica: primeiro array de objetos com codigo/valor
    for (const v of Object.values(raw)) {
        if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
            const amostra = v[0];
            const temCodigo = ['codigoReceita', 'codigo', 'cod', 'codReceita'].some(c => c in amostra);
            const temValor = ['valor', 'valorDebito', 'vlrDebito', 'valorPrincipal', 'vlr'].some(c => c in amostra);
            if (temCodigo || temValor) return v;
        }
    }
    return null;
}

function extrairDebitosOficiais(raw) {
    const bases = [
        raw,
        raw.apuracaoMit,
        raw.apuracao,
        raw.dados,
        Array.isArray(raw.dadosApuracaoMit) ? raw.dadosApuracaoMit[0] : raw.dadosApuracaoMit,
        Array.isArray(raw.dadosApuracaoMIT) ? raw.dadosApuracaoMIT[0] : raw.dadosApuracaoMIT,
        Array.isArray(raw.DadosApuracaoMit) ? raw.DadosApuracaoMit[0] : raw.DadosApuracaoMit,
        Array.isArray(raw.DadosApuracaoMIT) ? raw.DadosApuracaoMIT[0] : raw.DadosApuracaoMIT,
    ].filter(Boolean);

    for (const base of bases) {
        const debitos = base?.Debitos || base?.debitos;
        if (!debitos || typeof debitos !== 'object' || Array.isArray(debitos)) continue;
        const out = [];
        for (const [grupo, bloco] of Object.entries(debitos)) {
            const familia = GRUPO_MIT_FAMILIA[grupo];
            if (!familia || !bloco || typeof bloco !== 'object') continue;
            for (const listaNome of ['ListaDebitos', 'listaDebitos', 'ListaDebitosAposEvento', 'listaDebitosAposEvento']) {
                const lista = bloco[listaNome];
                if (!Array.isArray(lista)) continue;
                for (const item of lista) {
                    if (item && typeof item === 'object') {
                        out.push({ ...item, _familiaMit: familia, _grupoMit: grupo });
                    }
                }
            }
        }
        if (out.length) return out;
    }
    return null;
}

function lerCodigo(item) {
    return item.codigoReceita ?? item.codigo ?? item.cod ?? item.codReceita
        ?? item.codigoTributo ?? item.CodigoDebito ?? item.codigoDebito ?? null;
}
function lerValor(item) {
    const cand = [item.valor, item.valorDebito, item.vlrDebito, item.valorPrincipal,
                  item.vlr, item.valorTotal, item.valorApurado, item.principal,
                  item.ValorDebito, item.valorDebito];
    for (const c of cand) {
        if (c != null && c !== '') return num(c);
    }
    return 0;
}
function lerDescricao(item) {
    return item.descricao ?? item.descricaoReceita ?? item.nomeTributo ?? item.tributo ?? item.nome ?? '';
}

/**
 * @param {any} apuracaoMit  o campo `apuracaoMit` retornado por
 *                           dctfweb-provider.consultarApuracaoMit
 * @returns {{
 *   lido: boolean,
 *   motivo: string|null,
 *   tributos: {IRPJ:number, CSLL:number, PIS:number, COFINS:number},
 *   outros: Array<{codigo:string|null, descricao:string, valor:number}>,
 *   totalReconhecido: number
 * }}
 */
export function normalizarApuracaoMit(apuracaoMit) {
    const vazio = { IRPJ: 0, CSLL: 0, PIS: 0, COFINS: 0 };
    if (!apuracaoMit || typeof apuracaoMit !== 'object') {
        return { lido: false, motivo: 'apuracaoMit ausente ou nao-objeto', tributos: { ...vazio }, outros: [], totalReconhecido: 0 };
    }

    const debitos = acharArrayDebitos(apuracaoMit);
    if (!debitos) {
        return {
            lido: false,
            motivo: 'Nao encontrei debitos no response MIT. Estrutura diferente do esperado — rode o serpro-smoke (MIT/LISTAAPURACOES317) e consulte o detalhe (MIT/CONSAPURACAO316) para ajustar o normalizador.',
            tributos: { ...vazio }, outros: [], totalReconhecido: 0,
        };
    }

    const tributos = { ...vazio };
    const outros = [];
    let reconhecido = 0;

    for (const item of debitos) {
        if (!item || typeof item !== 'object') continue;
        const codigo = lerCodigo(item);
        const desc = lerDescricao(item);
        const valor = lerValor(item);
        if (!valor) continue;

        const familia = item._familiaMit || familiaPorCodigo(codigo) || familiaPorDescricao(desc);
        if (familia && FAMILIAS.includes(familia)) {
            tributos[familia] += valor;
            reconhecido += valor;
        } else {
            outros.push({ codigo: codigo != null ? String(codigo) : null, descricao: String(desc), valor });
        }
    }

    // Arredonda 2 casas
    for (const f of FAMILIAS) tributos[f] = +tributos[f].toFixed(2);

    // Se achou o array mas nenhum debito reconhecido E nenhum "outro", o
    // response provavelmente tem shape diferente do que parseamos.
    if (reconhecido === 0 && outros.length === 0) {
        return {
            lido: false,
            motivo: `Array de debitos encontrado (${debitos.length} itens) mas nenhum valor extraido. Campos de codigo/valor diferem do esperado — ajuste lerCodigo/lerValor com base no smoke.`,
            tributos: { ...vazio }, outros: [], totalReconhecido: 0,
        };
    }

    return { lido: true, motivo: null, tributos, outros, totalReconhecido: +reconhecido.toFixed(2) };
}

export const _internals = { familiaPorCodigo, familiaPorDescricao, acharArrayDebitos, num };
