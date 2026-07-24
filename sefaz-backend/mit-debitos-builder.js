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

export const FAMILIAS = ['IRPJ', 'CSLL', 'PIS', 'COFINS', 'IPI'];

// Ordem canônica dos débitos no MIT (define o IdDebito sequencial). O SERPRO
// valida a sequência de IdDebito na ordem canônica dos grupos, NÃO na ordem em
// que mandamos. Numerar o IPI por último (IPI=5) dava "sequência de débitos
// inválida; sequencial 5" (Experte 06/2026) — o mês-modelo mostrou o IPI como
// IdDebito=3, logo o IPI vem ANTES de PIS/COFINS: IRPJ, CSLL, IPI, PIS, COFINS.
export const ORDEM_DEBITOS_MIT = ['IRPJ', 'CSLL', 'IPI', 'PIS', 'COFINS'];

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

// Estabelecimento do item de débito de IPI (apurado POR estabelecimento). O MIT
// grava/espera o SUFIXO de 6 dígitos = ordem(4) + DV(2), NÃO o CNPJ completo.
// Ex.: matriz 67.267.435/0001-78 → "000178" (comprovado no mês-modelo da Experte:
// CnpjEstabelecimento:"000178"). Enviar os 14 dígitos → SERPRO "valor inválido".
// Aceita 6 (usa como está) ou 14 (extrai os 6 finais); senão null.
export function sufixoEstabelecimento(valor) {
    const digs = String(valor ?? '').replace(/\D/g, '');
    if (digs.length === 6) return digs;
    if (digs.length === 14) return digs.slice(-6);
    return null;
}

function lerCnpjEstab(item) {
    const c = item?.CnpjEstabelecimento ?? item?.cnpjEstabelecimento
        ?? item?.CNPJEstabelecimento ?? item?.cnpjEstab ?? null;
    return sufixoEstabelecimento(c);
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
                        const ref = {
                            codigo,
                            grupo: GRUPO_MIT_FAMILIA[grupo] ? grupo : GRUPO_OFICIAL_POR_FAMILIA[familia],
                        };
                        // IPI carrega o CnpjEstabelecimento do item-modelo (SERPRO exige
                        // por estabelecimento). Só anexa quando o modelo trouxer.
                        const cnpjEstab = lerCnpjEstab(item);
                        if (cnpjEstab) ref.cnpjEstabelecimento = cnpjEstab;
                        out.codigoPorFamilia[familia] = ref;
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
 * @param {{apenasFamilias?: string[], idInicial?: number, empresaCnpj?: string}} [opts]
 *        apenasFamilias — monta só estas famílias (modo COMPLEMENTO: famílias
 *        que já têm débito no MIT ficam de fora e são preservadas).
 *        idInicial — primeiro IdDebito (continua a numeração dos existentes).
 *        empresaCnpj — CNPJ da empresa (fallback do CnpjEstabelecimento do IPI
 *        quando o mês-modelo não trouxe; IPI é apurado por estabelecimento).
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
    // Fallback do estabelecimento do IPI: sufixo de 6 dígitos (ordem+DV) do CNPJ
    // da empresa — mesmo formato que o MIT grava (NÃO o CNPJ completo).
    const empresaCnpjFallback = sufixoEstabelecimento(opts.empresaCnpj);

    const codigoPorFamilia = modelo?.codigoPorFamilia || {};

    // Itera na ordem canônica do MIT (IPI entre CSLL e PIS) pra o IdDebito
    // sequencial bater com o que o SERPRO espera.
    for (const familia of ORDEM_DEBITOS_MIT) {
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
        const item = {
            IdDebito: idDebito++,
            CodigoDebito: ref.codigo,
            ValorDebito: valor,
        };
        // IPI é apurado POR estabelecimento: o SERPRO recusa o encerramento com
        // "Debitos.Ipi.ListaDebitos[i].CnpjEstabelecimento: campo obrigatório não
        // informado" se o item não trouxer o CNPJ. Usa o do mês-modelo; senão o
        // CNPJ da empresa (matriz). Sem nenhum dos dois → falha clara, não envia
        // um débito que o SERPRO vai rejeitar.
        if (familia === 'IPI') {
            const cnpjEstab = ref.cnpjEstabelecimento || empresaCnpjFallback;
            if (!cnpjEstab) {
                erros.push(
                    'IPI: o SERPRO exige o CNPJ do estabelecimento em cada débito de IPI, '
                    + 'mas ele não veio no mês-modelo nem foi possível usar o CNPJ da empresa. '
                    + 'Confira o cadastro da empresa (CNPJ) e tente de novo.'
                );
                continue;
            }
            item.CnpjEstabelecimento = cnpjEstab;
        }
        if (!debitos[grupo]) debitos[grupo] = { ListaDebitos: [] };
        debitos[grupo].ListaDebitos.push(item);
        mapeamento.push({ familia, codigo: ref.codigo, grupo, valor, ...(item.CnpjEstabelecimento ? { cnpjEstabelecimento: item.CnpjEstabelecimento } : {}) });
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
 * Monta o bloco Debitos de uma RETIFICAÇÃO (reencerramento de apuração já
 * ENCERRADA — ENCAPURACAO314 de novo; a DCTFWeb retificadora é gerada
 * automaticamente pela Receita). Caso CLINICA MANTOAN 06/2026: apuração
 * transmitida e depois as aplicações financeiras entraram no app — IRPJ/CSLL
 * mudaram e o MIT precisa ser reencerrado com os valores novos.
 *
 * Regras (zero surpresa pro admin que confere o preview):
 *   - Família com valor no APP (> 0): débito REESCRITO com o valor do app.
 *     Código de débito vem do PRÓPRIO débito atual da família (mesma empresa,
 *     mesmo mês — fonte mais segura possível); se a família é NOVA na
 *     retificação, cai no código da apuração-modelo (mês anterior). Sem
 *     código em lugar nenhum → falha clara, nunca chuta.
 *   - Família com débito no MIT mas SEM valor no app (0): débito PRESERVADO
 *     intacto (não removemos débito que o app não apura — remover seria
 *     reduzir tributo declarado sem base).
 *   - Débito existente que não dá pra classificar por família → falha o lote
 *     inteiro (retificar por cima de débito desconhecido arrisca duplicar ou
 *     sumir com tributo — e-CAC manual nesse caso).
 *   - IdDebito renumerado sequencialmente na ordem canônica do MIT.
 *
 * @param {{IRPJ?:number,CSLL?:number,PIS?:number,COFINS?:number,IPI?:number}} tributosApp
 * @param {object|null} debitosExistentes  bloco Debitos atual da apuração-alvo
 * @param {{codigoPorFamilia: Record<string,{codigo:string,grupo:string,cnpjEstabelecimento?:string}>}} modelo
 * @param {{empresaCnpj?: string}} [opts]
 * @returns {{
 *   ok: boolean, erros: string[], debitos: object|null,
 *   mapeamento: Array<{familia:string,codigo:string,grupo:string,antes:number,depois:number,diferenca:number,acao:'ajustado'|'mantido'|'incluido'}>,
 *   totalAntes: number, totalDepois: number, temDiferenca: boolean,
 * }}
 */
export function montarDebitosRetificacaoMit(tributosApp, debitosExistentes, modelo, opts = {}) {
    const erros = [];
    const mapeamento = [];
    const empresaCnpjFallback = sufixoEstabelecimento(opts.empresaCnpj);
    const codigoPorFamilia = modelo?.codigoPorFamilia || {};

    // 1. Classifica TODOS os débitos existentes por família. Item sem família
    //    identificável derruba a retificação (segurança > conveniência).
    const existentesPorFamilia = {};
    if (debitosExistentes && typeof debitosExistentes === 'object' && !Array.isArray(debitosExistentes)) {
        for (const [grupo, bloco] of Object.entries(debitosExistentes)) {
            if (!bloco || typeof bloco !== 'object') continue;
            for (const listaNome of ['ListaDebitos', 'listaDebitos']) {
                const lista = bloco[listaNome];
                if (!Array.isArray(lista)) continue;
                for (const item of lista) {
                    if (!item || typeof item !== 'object') continue;
                    const codigo = lerCodigo(item);
                    const familia = GRUPO_MIT_FAMILIA[grupo] || familiaPorCodigo(codigo);
                    if (!familia || !FAMILIAS.includes(familia)) {
                        erros.push(
                            `Débito atual do MIT (grupo ${grupo}, código ${codigo || '?'}) não pôde ser `
                            + 'classificado por tributo — retifique manualmente no e-CAC para não arriscar '
                            + 'duplicar ou perder débito.'
                        );
                        continue;
                    }
                    const valor = round2(item.ValorDebito ?? item.valorDebito ?? 0);
                    if (!existentesPorFamilia[familia]) existentesPorFamilia[familia] = [];
                    existentesPorFamilia[familia].push({
                        familia,
                        grupo: GRUPO_MIT_FAMILIA[grupo] ? grupo : GRUPO_OFICIAL_POR_FAMILIA[familia],
                        codigo,
                        valor,
                        cnpjEstabelecimento: lerCnpjEstab(item),
                    });
                }
            }
        }
    }
    if (erros.length > 0) {
        return { ok: false, erros, debitos: null, mapeamento, totalAntes: 0, totalDepois: 0, temDiferenca: false };
    }

    // 2. Reconstrói o bloco inteiro na ordem canônica, renumerando IdDebito.
    const debitos = {};
    let idDebito = 1;
    let totalAntes = 0;
    let totalDepois = 0;
    for (const familia of ORDEM_DEBITOS_MIT) {
        const valorApp = round2(tributosApp?.[familia]);
        const existentes = existentesPorFamilia[familia] || [];
        const antes = round2(existentes.reduce((s, e) => s + e.valor, 0));
        totalAntes = round2(totalAntes + antes);

        if (valorApp < 0) {
            erros.push(`${familia}: valor negativo (${valorApp}) não pode ser declarado no MIT.`);
            continue;
        }

        if (valorApp > 0) {
            // Débito reescrito com o valor do app. Código do débito atual da
            // própria família; família nova cai no modelo.
            const ref = existentes[0] || codigoPorFamilia[familia];
            if (!ref?.codigo) {
                erros.push(
                    `${familia}: apurado R$ ${valorApp.toFixed(2)} no app, mas não há código de débito `
                    + 'nem na apuração atual nem na apuração-modelo (mês anterior). '
                    + 'Lance este tributo manualmente no e-CAC.'
                );
                continue;
            }
            const grupo = ref.grupo || GRUPO_OFICIAL_POR_FAMILIA[familia];
            const item = { IdDebito: idDebito++, CodigoDebito: ref.codigo, ValorDebito: valorApp };
            if (familia === 'IPI') {
                const cnpjEstab = ref.cnpjEstabelecimento
                    || codigoPorFamilia.IPI?.cnpjEstabelecimento || empresaCnpjFallback;
                if (!cnpjEstab) {
                    erros.push(
                        'IPI: o SERPRO exige o CNPJ do estabelecimento em cada débito de IPI e ele não '
                        + 'veio do débito atual, do mês-modelo nem do cadastro da empresa.'
                    );
                    continue;
                }
                item.CnpjEstabelecimento = cnpjEstab;
            }
            if (!debitos[grupo]) debitos[grupo] = { ListaDebitos: [] };
            debitos[grupo].ListaDebitos.push(item);
            totalDepois = round2(totalDepois + valorApp);
            mapeamento.push({
                familia, codigo: ref.codigo, grupo,
                antes, depois: valorApp, diferenca: round2(valorApp - antes),
                acao: existentes.length === 0 ? 'incluido'
                    : (Math.abs(valorApp - antes) < 0.005 ? 'mantido' : 'ajustado'),
            });
        } else if (existentes.length > 0) {
            // App não apura esta família → débitos atuais preservados intactos.
            for (const e of existentes) {
                const item = { IdDebito: idDebito++, CodigoDebito: e.codigo, ValorDebito: e.valor };
                if (e.cnpjEstabelecimento) item.CnpjEstabelecimento = e.cnpjEstabelecimento;
                if (!debitos[e.grupo]) debitos[e.grupo] = { ListaDebitos: [] };
                debitos[e.grupo].ListaDebitos.push(item);
            }
            totalDepois = round2(totalDepois + antes);
            mapeamento.push({
                familia, codigo: existentes[0].codigo, grupo: existentes[0].grupo,
                antes, depois: antes, diferenca: 0, acao: 'mantido',
            });
        }
    }

    if (erros.length > 0) {
        return { ok: false, erros, debitos: null, mapeamento, totalAntes, totalDepois, temDiferenca: false };
    }
    if (mapeamento.length === 0) {
        return {
            ok: false,
            erros: ['Nenhum tributo com valor no app nem débito existente no MIT — nada a retificar.'],
            debitos: null, mapeamento, totalAntes: 0, totalDepois: 0, temDiferenca: false,
        };
    }
    const temDiferenca = mapeamento.some((m) => Math.abs(m.diferenca) >= 0.01);
    return { ok: true, erros: [], debitos, mapeamento, totalAntes, totalDepois, temDiferenca };
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
