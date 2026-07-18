// ============================================================================
// sefaz-backend/mit-debitos-builder.js  (PURO — sem firebase/io, testável)
//
// Monta o bloco `Debitos` oficial do MIT (ENCAPURACAO314) a partir dos
// tributos apurados pelo APP (IRPJ/CSLL/PIS/COFINS/IPI de calcularLucro),
// usando uma apuração-MODELO (mês anterior da MESMA empresa, vinda do
// CONSAPURACAO316) como fonte dos códigos de débito.
//
// Por que modelo e não tabela fixa: o código de débito do MIT (código de
// receita + variação, ex. "236201") depende do regime/qualificação da
// empresa. Adivinhar código = declarar débito errado. O mês anterior da
// própria empresa é a fonte mais segura — mesma qualificação, mesmos
// tributos. Sem modelo com código pra uma família COM valor, o builder
// FALHA com mensagem clara (nunca chuta).
//
// Shape oficial do bloco (LISTAAPURACOES317/CONSAPURACAO316):
//   Debitos: {
//     Irpj:     { ListaDebitos: [{ IdDebito, CodigoDebito, ValorDebito }] },
//     Csll:     { ListaDebitos: [...] },
//     PisPasep: { ListaDebitos: [...] },
//     Cofins:   { ListaDebitos: [...] },
//   }
// ============================================================================

const FAMILIAS = ['IRPJ', 'CSLL', 'PIS', 'COFINS', 'IPI'];

// Família → grupo oficial do MIT (fallback quando o modelo não traz o grupo).
const GRUPO_OFICIAL_POR_FAMILIA = {
    IRPJ: 'Irpj',
    CSLL: 'Csll',
    PIS: 'PisPasep',
    COFINS: 'Cofins',
    IPI: 'Ipi',
};

// Grupo do MIT → família (mesmo mapa do dctfweb-mit-normalizer).
const GRUPO_MIT_FAMILIA = {
    Irpj: 'IRPJ', IRPJ: 'IRPJ',
    Csll: 'CSLL', CSLL: 'CSLL',
    PisPasep: 'PIS', PIS: 'PIS',
    Cofins: 'COFINS', COFINS: 'COFINS',
    Ipi: 'IPI', IPI: 'IPI',
};

// Código de receita (4 primeiros dígitos) → família. Tabela pública RFB —
// espelho do dctfweb-mit-normalizer (fallback quando o grupo não vem).
const CODIGO_FAMILIA = {
    '2362': 'IRPJ', '2390': 'IRPJ', '0220': 'IRPJ', '2319': 'IRPJ',
    '2456': 'IRPJ', '5993': 'IRPJ', '3373': 'IRPJ', '1599': 'IRPJ', '2430': 'IRPJ',
    '2484': 'CSLL', '6012': 'CSLL', '2469': 'CSLL', '6758': 'CSLL', '2030': 'CSLL', '6773': 'CSLL',
    '8109': 'PIS', '6912': 'PIS', '4574': 'PIS', '8301': 'PIS', '6824': 'PIS',
    '2172': 'COFINS', '5856': 'COFINS', '5442': 'COFINS', '2050': 'COFINS', '6840': 'COFINS',
    '0668': 'IPI', '1097': 'IPI', '5110': 'IPI', '5123': 'IPI', '0676': 'IPI',
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function lerCodigo(item) {
    const c = item?.CodigoDebito ?? item?.codigoDebito ?? item?.codigoReceita
        ?? item?.codigo ?? item?.cod ?? item?.codReceita ?? item?.codigoTributo ?? null;
    return c != null && String(c).trim() !== '' ? String(c).trim() : null;
}

function familiaPorCodigo(codigo) {
    const c = String(codigo || '').replace(/\D/g, '').slice(0, 4);
    return CODIGO_FAMILIA[c] || null;
}

/**
 * Varre a apuração-modelo (payload do CONSAPURACAO316) e devolve o código de
 * débito de cada família encontrada.
 *
 * @returns {{ codigoPorFamilia: Record<string,{codigo:string,grupo:string}>, totalDebitos: number }}
 */
export function extrairModeloDebitosMit(apuracaoModelo) {
    const out = { codigoPorFamilia: {}, totalDebitos: 0 };
    let payload = apuracaoModelo && typeof apuracaoModelo === 'object' ? apuracaoModelo : null;
    if (Array.isArray(payload)) payload = payload[0] || null; // shape em array (CONSAPURACAO316)
    if (!payload || typeof payload !== 'object') return out;

    // Acha o bloco Debitos em shapes conhecidos (direto ou aninhado).
    const bases = [
        payload,
        payload.apuracaoMit,
        payload.apuracao,
        payload.dados,
        Array.isArray(payload.dadosApuracaoMit) ? payload.dadosApuracaoMit[0] : payload.dadosApuracaoMit,
        Array.isArray(payload.DadosApuracaoMit) ? payload.DadosApuracaoMit[0] : payload.DadosApuracaoMit,
    ].filter(Boolean);

    for (const base of bases) {
        const debitos = base?.Debitos || base?.debitos;
        if (!debitos || typeof debitos !== 'object' || Array.isArray(debitos)) continue;
        for (const [grupo, bloco] of Object.entries(debitos)) {
            const familiaGrupo = GRUPO_MIT_FAMILIA[grupo] || null;
            if (!bloco || typeof bloco !== 'object') continue;
            for (const listaNome of ['ListaDebitos', 'listaDebitos', 'ListaDebitosAposEvento', 'listaDebitosAposEvento']) {
                const lista = bloco[listaNome];
                if (!Array.isArray(lista)) continue;
                for (const item of lista) {
                    if (!item || typeof item !== 'object') continue;
                    const codigo = lerCodigo(item);
                    if (!codigo) continue;
                    out.totalDebitos++;
                    const familia = familiaGrupo || familiaPorCodigo(codigo);
                    if (!familia || !FAMILIAS.includes(familia)) continue;
                    // Primeiro código da família vence (débito principal).
                    if (!out.codigoPorFamilia[familia]) {
                        out.codigoPorFamilia[familia] = {
                            codigo,
                            grupo: GRUPO_MIT_FAMILIA[grupo] ? grupo : GRUPO_OFICIAL_POR_FAMILIA[familia],
                        };
                    }
                }
            }
        }
        if (out.totalDebitos > 0) break;
    }
    return out;
}

/**
 * Monta o bloco Debitos do encerramento a partir dos tributos do app.
 *
 * @param {{IRPJ?:number,CSLL?:number,PIS?:number,COFINS?:number,IPI?:number}} tributosApp
 * @param {{codigoPorFamilia: Record<string,{codigo:string,grupo:string}>}} modelo
 * @param {{apenasFamilias?: string[], idInicial?: number}} [opts]
 *        apenasFamilias — monta só estas famílias (modo COMPLEMENTO: famílias
 *        que já têm débito no MIT ficam de fora e são preservadas).
 *        idInicial — primeiro IdDebito (continua a numeração dos existentes).
 * @returns {{
 *   ok: boolean,
 *   erros: string[],
 *   debitos: object|null,
 *   mapeamento: Array<{familia:string,codigo:string,grupo:string,valor:number}>,
 *   totalProposto: number,
 * }}
 */
export function montarDebitosMit(tributosApp, modelo, opts = {}) {
    const erros = [];
    const mapeamento = [];
    const debitos = {};
    let totalProposto = 0;
    let idDebito = Math.max(1, Number(opts.idInicial) || 1);
    const familiasAlvo = Array.isArray(opts.apenasFamilias) ? opts.apenasFamilias : null;

    const codigoPorFamilia = modelo?.codigoPorFamilia || {};

    for (const familia of FAMILIAS) {
        if (familiasAlvo && !familiasAlvo.includes(familia)) continue;
        const valor = round2(tributosApp?.[familia]);
        if (valor < 0) {
            erros.push(`${familia}: valor negativo (${valor}) não pode ser declarado no MIT.`);
            continue;
        }
        if (valor === 0) continue; // família sem movimento não entra

        const ref = codigoPorFamilia[familia];
        if (!ref?.codigo) {
            erros.push(
                `${familia}: apurado R$ ${valor.toFixed(2)} no app, mas não há código de débito `
                + 'de referência na apuração-modelo (mês anterior desta empresa no MIT). '
                + 'Lance este tributo manualmente no e-CAC uma vez para servir de modelo.'
            );
            continue;
        }

        const grupo = ref.grupo || GRUPO_OFICIAL_POR_FAMILIA[familia];
        if (!debitos[grupo]) debitos[grupo] = { ListaDebitos: [] };
        debitos[grupo].ListaDebitos.push({
            IdDebito: idDebito++,
            CodigoDebito: ref.codigo,
            ValorDebito: valor,
        });
        mapeamento.push({ familia, codigo: ref.codigo, grupo, valor });
        totalProposto = round2(totalProposto + valor);
    }

    if (erros.length > 0) {
        return { ok: false, erros, debitos: null, mapeamento, totalProposto };
    }
    if (mapeamento.length === 0) {
        return {
            ok: false,
            erros: [familiasAlvo
                ? 'Nenhuma família faltante com valor > 0 na apuração do app — os débitos existentes no MIT já cobrem tudo.'
                : 'Nenhum tributo com valor > 0 na apuração do app — nada a declarar. '
                + 'Se a empresa não teve movimento, marque "Sem Movimento" na apuração MIT do e-CAC.'],
            debitos: null, mapeamento, totalProposto: 0,
        };
    }
    return { ok: true, erros: [], debitos, mapeamento, totalProposto };
}

/**
 * Maior IdDebito presente num bloco Debitos existente (0 se não houver).
 * Usado pra continuar a numeração ao COMPLEMENTAR uma apuração.
 */
export function maiorIdDebitoMit(debitos) {
    let maior = 0;
    if (!debitos || typeof debitos !== 'object') return maior;
    const listas = Array.isArray(debitos) ? [debitos] : Object.values(debitos).flatMap((bloco) => {
        if (Array.isArray(bloco)) return [bloco];
        if (bloco && typeof bloco === 'object') {
            return Object.values(bloco).filter(Array.isArray);
        }
        return [];
    });
    for (const lista of listas) {
        for (const item of lista) {
            const id = Number(item?.IdDebito ?? item?.idDebito);
            if (Number.isFinite(id) && id > maior) maior = id;
        }
    }
    return maior;
}

/**
 * Mescla débitos NOVOS num bloco Debitos EXISTENTE, sem tocar nos itens já
 * lançados (modo COMPLEMENTO — caso PEC PRONTA 06/2026: MIT com PIS/COFINS
 * lançados e IRPJ/CSLL faltando). Grupos novos são criados; grupos existentes
 * ganham os itens no fim da ListaDebitos.
 */
export function mesclarDebitosMit(existentes, novos) {
    const out = JSON.parse(JSON.stringify(existentes && typeof existentes === 'object' && !Array.isArray(existentes) ? existentes : {}));
    for (const [grupo, bloco] of Object.entries(novos || {})) {
        const lista = bloco?.ListaDebitos || [];
        if (!out[grupo] || typeof out[grupo] !== 'object') {
            out[grupo] = { ListaDebitos: [] };
        } else if (!Array.isArray(out[grupo].ListaDebitos)) {
            out[grupo].ListaDebitos = [];
        }
        out[grupo].ListaDebitos.push(...lista);
    }
    return out;
}
