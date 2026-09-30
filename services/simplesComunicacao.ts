/**
 * services/simplesComunicacao.ts — COMUNICAÇÃO no Simples Nacional: Anexo III
 * SEM o ISS e COM a parcela do ICMS do Anexo I. PURO.
 *
 * Paulo, 30/09, com o pedido da Valeria (09/09) e os prints do PGDAS-D:
 * *"Configurar o SIMPLES da RADIO SB, ela é serviço de comunicação, está
 * puxando como prestação de serviço normal, ela é sujeita ao ICMS"*.
 *
 * 📖 LC 123/2006, art. 18, § 5º-E: *"… as atividades de prestação de serviços
 * de transportes intermunicipais e interestaduais de cargas … e de COMUNICAÇÃO
 * serão tributadas na forma do Anexo III desta Lei Complementar, DEDUZIDA a
 * parcela correspondente ao ISS e ACRESCIDA a parcela correspondente ao ICMS
 * prevista no Anexo I"*. O app tratava a receita como serviço comum do Anexo
 * III: cobrava ISS (que a rádio não paga) e não cobrava o ICMS (que ela paga).
 *
 * 🔢 A ATIVIDADE DO PGDAS-D É A 36 — "Serviços de comunicação; de transporte
 * intermunicipal e interestadual de carga … > Comunicação sem substituição
 * tributária de ICMS (o substituto tributário deve utilizar essa opção)". O
 * número saiu da FONTE QUE NÃO MENTE, a mesma que deu o código 9 do ISS fixo:
 * o input escondido do formulário do e-CAC colado pela Valeria —
 * `<input type="hidden" name="atividades" value="07147345000111-36">` e
 * `data-rec="0001-36"`. As variantes COM substituição tributária e PARA O
 * EXTERIOR têm outros números, que NÃO vieram — por isso elas calculam, mas a
 * transmissão pelo app é BLOQUEADA com o motivo (nunca um id chutado).
 *
 * A configuração é da EMPRESA, por CNAE (`cnaesComunicacao`): marca-se uma vez
 * e vale em toda competência. O CNAE das divisões 60/61 (rádio, TV,
 * telecomunicações) só SUGERE — quem decide é a pessoa.
 */
import type { SimplesNacionalEmpresa } from '../types';

/** Atividade do PGDAS-D: "Comunicação sem substituição tributária de ICMS". Fonte: e-CAC (value="…-36"). */
export const ID_ATIVIDADE_COMUNICACAO_SEM_ST = 36;

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** O CNAE desta receita está configurado como comunicação na empresa? */
export function ehCnaeComunicacao(
    empresa: Pick<SimplesNacionalEmpresa, 'cnaesComunicacao'> | null | undefined,
    cnae: unknown,
): boolean {
    const c = so(cnae);
    if (!c) return false;
    return (empresa?.cnaesComunicacao || []).some((x) => so(x) === c);
}

/** Liga/desliga o CNAE na lista da empresa (devolve a lista nova, sem duplicar). */
export function alternarCnaeComunicacao(atual: string[] | undefined, cnae: unknown): string[] {
    const c = so(cnae);
    const lista = (atual || []).map(so).filter(Boolean);
    if (!c) return lista;
    return lista.includes(c) ? lista.filter((x) => x !== c) : [...lista, c];
}

/**
 * O CNAE PARECE comunicação (divisão 60 — rádio e televisão; 61 —
 * telecomunicações)? Só para SUGERIR a marcação: o CNAE não prova sozinho que
 * a receita é de comunicação tributada pelo ICMS.
 */
export function cnaeSugereComunicacao(cnae: unknown): boolean {
    const c = so(cnae);
    return c.length >= 2 && ['60', '61'].includes(c.slice(0, 2));
}

/**
 * O idAtividade do PGDAS-D para a receita de comunicação — ou `null` quando a
 * variante não tem número confirmado (com ST, para o exterior).
 */
export function idAtividadeComunicacao(state: { icmsSt?: boolean; isExterior?: boolean }): number | null {
    if (state.isExterior || state.icmsSt) return null;
    return ID_ATIVIDADE_COMUNICACAO_SEM_ST;
}

/**
 * A alíquota efetiva da receita de comunicação (§ 5º-E): a efetiva do Anexo
 * III sem a parcela do ISS (e sem PIS/COFINS na exportação), MAIS a parcela do
 * ICMS do Anexo I (efetiva do Anexo I × percentual do ICMS da faixa). A parcela
 * do ICMS sai quando o ICMS não é devido no DAS (ST, imunidade, isenção,
 * exterior).
 */
export function aliquotaEfetivaComunicacao(args: {
    efetivaIII: number;
    reparticaoIII: Partial<Record<string, number>>;
    efetivaI: number;
    percentualIcmsI: number;
    icmsSt?: boolean; isImune?: boolean; isIsento?: boolean; isExterior?: boolean;
}): number {
    const r = args.reparticaoIII || {};
    let reducao = Number(r.ISS || 0);
    if (args.isExterior) reducao += Number(r.PIS || 0) + Number(r.COFINS || 0);
    const semIss = Math.max(0, args.efetivaIII * (1 - reducao / 100));
    const icmsFora = !!(args.icmsSt || args.isImune || args.isIsento || args.isExterior);
    const parcelaIcms = icmsFora ? 0 : Math.max(0, args.efetivaI * (args.percentualIcmsI / 100));
    return semIss + parcelaIcms;
}
