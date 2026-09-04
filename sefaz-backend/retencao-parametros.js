/**
 * PARÂMETRO DE RETENÇÃO POR PRESTADOR — o cérebro do CFOP aplicado à retenção.
 *
 * ═══ O PEDIDO ═════════════════════════════════════════════════════════════
 *
 * Paulo, 04/09: *"Ajuste e criação de parâmetro p/ um caso específico"* — a
 * J.P. PISSATO recebe CT-e OS de transporte de valores da PROTEGE, que retém
 * **IRRF de 1%** todo mês (art. 55 da Lei 7.713/1988, escrito nas Observações
 * do próprio DACTE-OS), só chega em PDF, e a empresa tem A3 (sem captura
 * automática). *"Tenho a mesma particularidade da empresa 923 MONACO."*
 *
 * Sem parâmetro, quem digita precisa LEMBRAR a alíquota e o fundamento de cada
 * prestador, todo mês, em duas empresas. É a mesma dor que fez o cérebro do
 * CFOP nascer em 18/08 — e é o mesmo desenho: o que uma pessoa informou uma vez
 * passa a valer para as próximas competências **daquele prestador**.
 *
 * ═══ 🚨 O PARÂMETRO SUGERE — ELE NUNCA GRAVA SOZINHO ══════════════════════
 *
 * Aqui isto é mais duro do que no CFOP, e a razão está MEDIDA no documento do
 * caso: a prestação é **3.901,37** e o IRRF declarado é **39,02**. Um por cento
 * de 3.901,37 é **39,01** — o emitente arredondou para cima, e quem fecha o
 * líquido impresso (3.862,35) é o 39,02.
 *
 * Ou seja: **a conta do app e o documento divergem em um centavo, e quem manda
 * é o documento.** Se o parâmetro gravasse, a EFD-Reinf declararia um centavo a
 * menos do que foi retido — e a Receita não devolve. O parâmetro preenche campo
 * VAZIO na tela, a pessoa confere contra o papel, e o que ela confirma é o que
 * vale. É a régua do R-2055: *a ressalva PROÍBE recalcular do outro lado.*
 *
 * ⚠️ **A VIGÊNCIA NÃO RETROAGE** (régua do IVA-ST e do calendário municipal):
 * o parâmetro vale da competência em que nasceu em diante. Competência anterior
 * já foi entregue com outro número, e mudá-la por baixo é reescrever livro.
 *
 * ⚠️ **FUNDAMENTO É OBRIGATÓRIO.** Alíquota de retenção sem a norma ao lado não
 * se confere depois — daqui a três meses ninguém lembra de onde veio aquele 1%.
 * É a mesma recusa do calendário municipal sem base legal (15/08).
 */

/** Os tributos que um parâmetro pode reter. Vocabulário FECHADO. */
export const TRIBUTOS_RETENCAO = ['ir', 'inss', 'csll', 'pis', 'cofins'];

/** O nome do campo no documento — os MESMOS que os importadores gravam. */
export const CAMPO_DO_TRIBUTO = {
    ir: 'valorIr',
    inss: 'valorInss',
    csll: 'valorCsll',
    pis: 'valorPis',
    cofins: 'valorCofins',
};

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const soComp = (v) => {
    const t = String(v ?? '').trim();
    return /^\d{4}-\d{2}$/.test(t) ? t : '';
};

/** Piso do fundamento — o mesmo do motivo da reabertura e da retirada. */
export const MIN_FUNDAMENTO = 8;

/**
 * Recusas em português, com a ação. Parâmetro torto é pior que parâmetro
 * nenhum: ele se aplica calado a tudo que vier depois.
 */
export function validarParametroRetencao(p) {
    const erros = [];
    if (!String(p?.empresaId || '').trim()) erros.push('Empresa não identificada.');
    if (soDigitos(p?.cnpjPrestador).length !== 14) {
        erros.push('Informe o CNPJ do prestador (14 dígitos) — o parâmetro é DELE, não da empresa.');
    }
    if (!TRIBUTOS_RETENCAO.includes(String(p?.tributo || ''))) {
        erros.push(`Tributo inválido. Os aceitos são: ${TRIBUTOS_RETENCAO.join(', ').toUpperCase()}.`);
    }
    const al = Number(p?.aliquota);
    if (!Number.isFinite(al) || al <= 0 || al > 100) {
        erros.push('Alíquota deve ficar entre 0 e 100% (e maior que zero — parâmetro de 0% não retém nada).');
    }
    if (String(p?.fundamento || '').trim().length < MIN_FUNDAMENTO) {
        erros.push('Informe a base legal da retenção (ex.: "Art. 55 da Lei 7.713/1988"). '
            + 'Alíquota sem a norma ao lado não se confere depois.');
    }
    if (!soComp(p?.vigenciaInicio)) {
        erros.push('Informe a competência a partir da qual o parâmetro vale (AAAA-MM). '
            + 'Ele NÃO retroage: competência anterior já foi entregue com outro número.');
    }
    if (!String(p?.criadoPor || '').trim()) {
        erros.push('Sessão sem usuário identificado — saia e entre de novo. O parâmetro fica gravado com quem o criou.');
    }
    return erros;
}

/**
 * Os parâmetros VIGENTES daquele prestador naquela competência — um por
 * tributo, e entre dois do mesmo tributo ganha o de vigência mais RECENTE
 * (é ele que descreve a regra em vigor).
 */
export function parametrosAplicaveis(parametros, { cnpjPrestador, competencia } = {}) {
    const cnpj = soDigitos(cnpjPrestador);
    const comp = soComp(competencia);
    if (!cnpj || !comp) return [];
    const porTributo = new Map();
    for (const p of Array.isArray(parametros) ? parametros : []) {
        if (p?.ativo === false) continue;
        if (soDigitos(p?.cnpjPrestador) !== cnpj) continue;
        const ini = soComp(p?.vigenciaInicio);
        // Sem vigência legível o parâmetro não se aplica — data chutada aqui
        // mudaria a retenção de uma competência já entregue.
        if (!ini || ini > comp) continue;
        const atual = porTributo.get(p.tributo);
        if (!atual || soComp(atual.vigenciaInicio) < ini) porTributo.set(p.tributo, p);
    }
    return [...porTributo.values()];
}

/**
 * A SUGESTÃO para a tela — valores calculados sobre a base, CARIMBADOS.
 *
 * Devolve `{ ir: { valor, aliquota, fundamento, vigenciaInicio } , … }`.
 *
 * ⚠️ Número derivado não se apresenta como lido do documento: cada linha
 * carrega a alíquota e a norma, e a tela mostra isso ao lado do campo. Quem
 * confirma é a pessoa, contra o papel.
 */
export function sugerirRetencoes(parametros, { cnpjPrestador, competencia, base } = {}) {
    const b = Number(base);
    if (!Number.isFinite(b) || b <= 0) return {};
    const out = {};
    for (const p of parametrosAplicaveis(parametros, { cnpjPrestador, competencia })) {
        const al = Number(p.aliquota);
        if (!Number.isFinite(al) || al <= 0) continue;
        out[p.tributo] = {
            valor: Math.round(b * al) / 100,
            aliquota: al,
            fundamento: String(p.fundamento || '').trim(),
            vigenciaInicio: soComp(p.vigenciaInicio),
        };
    }
    return out;
}

/** A frase da sugestão, para a tela dizer DE ONDE veio o número. */
export function explicarSugestao(tributo, s) {
    if (!s) return null;
    const brl = (n) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `Sugerido pelo parâmetro deste prestador: ${String(tributo).toUpperCase()} `
        + `${s.aliquota}% = R$ ${brl(s.valor)} (${s.fundamento}, desde ${s.vigenciaInicio}). `
        + 'Confira contra o documento — se ele declarar outro valor, vale o do documento.';
}
