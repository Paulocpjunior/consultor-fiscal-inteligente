// ============================================================================
// sefaz-backend/st-cadastro-uf.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🏛️ IE DE SUBSTITUTO TRIBUTÁRIO POR UF — o RECOLHIMENTO MENSAL do ICMS-ST
// (08/10).
//
// Paulo, FLANACAR (IE de ST em todos os estados): o CFI já apura o E200/E210
// por UF, mas o E250 (a guia) só saía se alguém digitasse o vencimento e o
// código de receita EM CADA COMPETÊNCIA. Quem tem IE de substituto na UF de
// destino recolhe por APURAÇÃO, todo mês, com a mesma regra — o exemplo real
// dele (PR, 09/2026): COD_OR 002, COD_REC 100048, vencimento 09/10/2026,
// MES_REF 09/2026, valor = VL_ICMS_RECOL_ST do E210.
//
// Este módulo é a régua do cadastro FIXO por empresa: valida o que foi
// informado e, para cada competência, devolve a obrigação por UF no MESMO
// formato do lançamento da competência ({ dtVcto, codRec, codOr }). O que foi
// lançado NA competência continua vencendo (exceção do mês).
//
// ⚠️ NADA AQUI SE DEDUZ: código da obrigação, código de receita e dia do
// vencimento vêm do cadastro. O vencimento é o dia informado no mês SEGUINTE
// à competência, sem ajuste de fim de semana ou feriado — a regra de cada UF
// para dia não útil é dela, e o aviso da geração diz isso.
//
// 🧾 RECOLHIMENTO POR OPERAÇÃO (14/10, FASTWELD): quem NÃO tem IE de
// substituto na UF de destino recolhe a GNRE A CADA SAÍDA — receita 100099
// (10009-9, "ICMS Substituição Tributária por Operação"). O E210 continua
// mensal; o E250 sai UM POR NOTA, vencimento = data de emissão. Exemplo real
// do PVA (MG, 09/2026): E210 642,40 = E250 185,98 (08/09) + 456,42 (16/09),
// COD_OR 002, COD_REC 100099, MES_REF 092026. A forma é ESCOLHIDA no cadastro
// ("mensal" × "por operação"); a linha sem forma gravada é a mensal de
// sempre (o cadastro nasceu só com ela). Forma e código que se contradizem
// são recusados, ditos — nunca um "corrige" o outro.
// ============================================================================

/**
 * Tabela 5.4 (Obrigações do ICMS a recolher) — só os códigos que cabem no E250
 * do ICMS-ST. O texto do 002 é o do PVA no exemplo real do Paulo.
 */
export const CODIGOS_OBRIGACAO_ST = Object.freeze({
    '001': 'ICMS da substituição tributária pelas entradas',
    '002': 'ICMS da substituição tributária pelas saídas para o Estado',
    '090': 'Outras obrigações do ICMS',
    '999': 'ICMS da substituição tributária pelas saídas para outro Estado',
});

export const UFS_BRASIL = Object.freeze([
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
    'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

/** Dia máximo aceito: até 28, para existir em todo mês. */
export const DIA_MAXIMO_VENCIMENTO = 28;

/** Como a UF recolhe: por APURAÇÃO (tem IE de ST lá) ou a cada OPERAÇÃO (não tem). */
export const FORMAS_RECOLHIMENTO_ST = Object.freeze({ MENSAL: 'mensal', OPERACAO: 'operacao' });

/**
 * Os dois códigos nacionais da GNRE para o ICMS-ST — a forma de recolher está
 * no próprio nome do código (tabela da GNRE). Código estadual fora desta lista
 * não é julgado: vale a forma escolhida no cadastro.
 */
export const CODIGOS_RECEITA_GNRE_ST = Object.freeze([
    { codigo: '100048', forma: 'mensal', descricao: 'ICMS Substituição Tributária por Apuração' },
    { codigo: '100099', forma: 'operacao', descricao: 'ICMS Substituição Tributária por Operação' },
]);

/** Forma que o código da GNRE DIZ (`'mensal'`/`'operacao'`), ou '' quando o código não é um dos nacionais. */
export function formaDoCodigoReceitaSt(codigo) {
    const c = String(codigo || '').replace(/\D/g, '');
    return CODIGOS_RECEITA_GNRE_ST.find((x) => x.codigo === c)?.forma || '';
}

/** O código de receita é o da GNRE de ST POR OPERAÇÃO (100099 / 10009-9)? */
export function codigoReceitaStPorOperacao(codigo) {
    return formaDoCodigoReceitaSt(codigo) === FORMAS_RECOLHIMENTO_ST.OPERACAO;
}

/**
 * Confere uma linha do cadastro.
 * @param {{uf?:string, ie?:string, codOr?:string, codRec?:string, diaVencimento?:number|string|null, forma?:string}} l
 * @returns {{ok: true, linha: object} | {ok: false, erros: string[]}}
 */
export function validarLinhaStUf(l) {
    const erros = [];
    const uf = String(l?.uf || '').trim().toUpperCase();
    const ie = String(l?.ie || '').replace(/[^\dA-Za-z]/g, '').toUpperCase();
    const codOr = String(l?.codOr || '').trim();
    const codRec = String(l?.codRec || '').trim();
    const formaInformada = String(l?.forma || '').trim();
    // Linha sem forma é a do cadastro de 08/10, que só conhecia a mensal.
    const forma = formaInformada || FORMAS_RECOLHIMENTO_ST.MENSAL;
    const porOperacao = forma === FORMAS_RECOLHIMENTO_ST.OPERACAO;
    const dia = Number(String(l?.diaVencimento ?? '').trim());
    const rotulo = uf || 'UF';
    if (!UFS_BRASIL.includes(uf)) erros.push(`UF "${l?.uf || ''}" não existe.`);
    if (!Object.values(FORMAS_RECOLHIMENTO_ST).includes(forma)) {
        erros.push(`${rotulo}: forma de recolhimento "${formaInformada}" não existe (mensal ou por operação).`);
    }
    if (ie.length > 14) erros.push(`${rotulo}: a IE de substituto tem no máximo 14 caracteres.`);
    if (!Object.prototype.hasOwnProperty.call(CODIGOS_OBRIGACAO_ST, codOr)) {
        erros.push(`${rotulo}: escolha o código da obrigação (tabela 5.4: ${Object.keys(CODIGOS_OBRIGACAO_ST).join(', ')}).`);
    }
    if (!codRec) erros.push(`${rotulo}: informe o código de receita da GNRE.`);
    // Forma e código que se contradizem: os dois vieram da pessoa, e o app não
    // escolhe qual está certo — diz.
    const formaDoCodigo = formaDoCodigoReceitaSt(codRec);
    if (formaDoCodigo && formaDoCodigo !== forma) {
        erros.push(porOperacao
            ? `${rotulo}: a receita ${codRec} é da GNRE por APURAÇÃO (mensal) e a UF está como "por operação" — por operação é 100099.`
            : `${rotulo}: a receita ${codRec} é da GNRE POR OPERAÇÃO e a UF está como "mensal" — marque "por operação" ou troque o código.`);
    }
    if (!porOperacao && (!Number.isInteger(dia) || dia < 1 || dia > DIA_MAXIMO_VENCIMENTO)) {
        erros.push(`${rotulo}: dia do vencimento entre 1 e ${DIA_MAXIMO_VENCIMENTO} (do mês seguinte à competência).`);
    }
    if (erros.length) return { ok: false, erros };
    // Por operação não tem dia: o vencimento é a data de cada nota (null, não
    // undefined — o Firestore recusa undefined).
    return { ok: true, linha: { uf, ie, codOr, codRec, forma, diaVencimento: porOperacao ? null : dia } };
}

/**
 * Confere o cadastro inteiro (uma linha por UF, sem repetir).
 * @param {Array<object>} linhas
 */
export function validarCadastroStUf(linhas) {
    const erros = [];
    const ufs = {};
    for (const l of Array.isArray(linhas) ? linhas : []) {
        const v = validarLinhaStUf(l);
        if (!v.ok) { erros.push(...v.erros); continue; }
        if (ufs[v.linha.uf]) { erros.push(`${v.linha.uf} informada duas vezes.`); continue; }
        ufs[v.linha.uf] = {
            ie: v.linha.ie, codOr: v.linha.codOr, codRec: v.linha.codRec, forma: v.linha.forma, diaVencimento: v.linha.diaVencimento,
        };
    }
    if (erros.length) return { ok: false, erros };
    return { ok: true, ufs };
}

/**
 * Vencimento (DDMMAAAA) no dia informado do mês SEGUINTE à competência.
 * @param {string} competencia 'AAAA-MM'
 * @param {number} dia
 * @returns {string} '' quando a competência não é legível
 */
export function vencimentoNoMesSeguinte(competencia, dia) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ''));
    const d = Number(dia);
    if (!m || !Number.isInteger(d) || d < 1 || d > DIA_MAXIMO_VENCIMENTO) return '';
    let ano = Number(m[1]);
    let mes = Number(m[2]) + 1;
    if (mes > 12) { mes = 1; ano += 1; }
    return `${String(d).padStart(2, '0')}${String(mes).padStart(2, '0')}${ano}`;
}

/**
 * As obrigações de ST da competência a partir do cadastro fixo, no formato do
 * lançamento da competência. Linha inválida não vira obrigação (vai em `erros`).
 *
 * @param {{ufs?: object}|null} cadastro  doc de `empresa_st_por_uf`
 * @param {string} competencia 'AAAA-MM'
 * UF "por operação" vira `{ porOperacao: true, dtVcto: '' }`: o vencimento é a
 * data de cada nota, e quem as tem é o gerador do bloco E.
 *
 * @returns {{obrigacoes: Record<string, {dtVcto:string, codRec:string, codOr:string, origem:'cadastro', porOperacao?: true}>, erros: string[]}}
 */
export function obrigacoesStDoCadastro(cadastro, competencia) {
    const obrigacoes = {};
    const erros = [];
    for (const [uf, l] of Object.entries(cadastro?.ufs || {})) {
        const v = validarLinhaStUf({ uf, ...l });
        if (!v.ok) { erros.push(...v.erros); continue; }
        if (v.linha.forma === FORMAS_RECOLHIMENTO_ST.OPERACAO) {
            obrigacoes[uf] = { dtVcto: '', codRec: v.linha.codRec, codOr: v.linha.codOr, origem: 'cadastro', porOperacao: true };
            continue;
        }
        const dtVcto = vencimentoNoMesSeguinte(competencia, v.linha.diaVencimento);
        if (!dtVcto) { erros.push(`${uf}: competência "${competencia}" ilegível — vencimento não calculado.`); continue; }
        obrigacoes[uf] = { dtVcto, codRec: v.linha.codRec, codOr: v.linha.codOr, origem: 'cadastro' };
    }
    return { obrigacoes, erros };
}

/**
 * Junta as duas fontes: o lançado NA competência vence o cadastro, UF a UF.
 * @returns {Record<string, object>}
 */
export function mesclarObrigacoesSt(daCompetencia, doCadastro) {
    return { ...(doCadastro || {}), ...(daCompetencia || {}) };
}
