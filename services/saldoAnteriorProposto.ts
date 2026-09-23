/**
 * saldoAnteriorProposto — o saldo credor que a ficha NOVA deve trazer do mês
 * anterior, e o aviso de quando ela está com ele zerado.
 *
 * ═══ O CASO ══════════════════════════════════════════════════════════════════
 *
 * Paulo, 15/09, PWR INDÚSTRIA METALÚRGICA · 07 → 08/2026: *"essa empresa teve
 * saldo credor anterior de IPI do mês 07/2026 para o 08; na ficha do mês 07 ele
 * está informando certinho, mas quando eu crio a ficha do 08 ele não vem com o
 * valor, deveria vir, até mesmo para fins de SPED ICMS IPI"*.
 *
 * A ficha de 07 traz `IPI a transportar p/ 08/2026: R$ 4.747,84` — número que
 * NINGUÉM calcula: quem apura digita (decisão de 18/08, caso KROYA, porque a
 * conta óbvia `entrou − a recolher` está errada quando o mês gera mais crédito
 * do que débito). O dado está gravado; o que faltava era a LEITURA.
 *
 * ═══ POR QUE ISSO É PIOR DO QUE PARECE ══════════════════════════════════════
 *
 * O SPED **já está protegido** desde 11/09 (LEGACY): quando o campo "Cred. IPI
 * do mês anterior" desta competência está vazio, o orquestrador cai na RESERVA
 * e lê o "a TRANSPORTAR" da ficha anterior. Ou seja, o E520 de 08 já saía com
 * os 4.747,84.
 *
 * 🚨 E é justamente aí que dói: a **ficha** apurava com 0,00 e o **arquivo**
 * declarava 4.747,84. O IPI a recolher da GUIA sai a MAIOR, o SPED diz o
 * contrário, e nada acende — os dois números são plausíveis, cada um no seu
 * lugar. É arquivo e guia bebendo de fontes diferentes, a divergência que esta
 * casa mais paga (a lição do F600 × ficha, 28/08).
 *
 * ═══ O QUE ESTE MÓDULO FAZ, E O QUE ELE SE RECUSA A FAZER ═══════════════════
 *
 * Ele PROPÕE — nunca afirma. O valor proposto é o MESMO que uma pessoa digitou
 * na competência anterior, carimbado com a origem para quem lê saber de onde
 * ele veio. Nada é derivado, nada é calculado.
 *
 * ⚠️ **Ausência não é prova.** Competência anterior sem ficha, ou com o campo
 * "a transportar" em branco, NÃO vira zero proposto: zero num campo de saldo é
 * a afirmação *"você não tem crédito"*, dita a quem talvez tenha. Nesses casos
 * a proposta é `null` e o texto DIZ qual é o caso — são três causas com ações
 * diferentes (lançar a ficha anterior · informar o transporte nela · conferir a
 * competência).
 *
 * ⚠️ **PIS e COFINS ficam de fora, e isso é declarado.** A ficha tem
 * `saldoCredorPis`/`saldoCredorCofins` (mês anterior) e **não tem** o par "a
 * transportar" deles — então não existe o que herdar. Propor por analogia seria
 * inventar saldo federal a partir de uma régua estadual.
 */

import { acharFichaCompetencia } from '../sefaz-backend/ipi-varredura.js';
import { normalizarCompetencia } from '../sefaz-backend/competencia.js';

export type OrigemSaldoProposto =
    /** A ficha anterior informou o "a transportar" — é ele que vem. */
    | 'ficha-anterior'
    /** Não há ficha lançada na competência anterior. */
    | 'sem-ficha-anterior'
    /** A ficha anterior existe e não informou o "a transportar". */
    | 'anterior-nao-informou'
    /** A competência pedida não é legível — não dá para saber qual é a anterior. */
    | 'competencia-ilegivel';

export type TributoComTransporte = 'ICMS' | 'IPI';

export interface PropostaSaldoTributo {
    tributo: TributoComTransporte;
    /** O valor a propor. `null` = não há o que propor (nunca 0 inventado). */
    valor: number | null;
    origem: OrigemSaldoProposto;
    /** Frase pronta para a tela — a causa junto do número. */
    texto: string;
}

export interface PropostaSaldoAnterior {
    /** 'AAAA-MM' da competência da ficha nova. */
    competencia: string | null;
    /** 'AAAA-MM' da competência anterior. */
    competenciaAnterior: string | null;
    itens: PropostaSaldoTributo[];
    /** Há pelo menos um tributo com valor a propor. */
    temProposta: boolean;
}

interface FichaComSaldo {
    mesReferencia?: string;
    saldoCredorIcms?: number | null;
    saldoCredorIpi?: number | null;
    saldoCredorIcmsTransportar?: number | null;
    saldoCredorIpiTransportar?: number | null;
}

/**
 * 'AAAA-MM' da competência ANTERIOR, aceitando as formas em que `mesReferencia`
 * é gravado (a normalização é do dono, `competencia.js`).
 *
 * 📌 Por que não reusei nenhuma das que já existem: `saldo-abertura.js` e o
 * `sped-fiscal-orchestrator.js` são backend sem `.d.ts` (e `.d.ts` à mão é a
 * armadilha das duas formas, 20/08), e o `competenciaSeguinteDe` do
 * `saldoCredorFicha.ts` devolve **'MM/AAAA'**, que é formato de EXIBIÇÃO — usar
 * um formato de tela para BUSCAR ficha é o descasamento que já zerou o F550.
 */
export function competenciaAnteriorDe(comp: unknown): string | null {
    const alvo = normalizarCompetencia(comp);
    if (!alvo) return null;
    const [ano, mes] = alvo.split('-').map(Number);
    const anteriorMes = mes === 1 ? 12 : mes - 1;
    const anteriorAno = mes === 1 ? ano - 1 : ano;
    return `${anteriorAno}-${String(anteriorMes).padStart(2, '0')}`;
}

/**
 * ⚠️ `Number(null)` é 0 e `Number.isFinite(0)` é true — a combinação que mordeu
 * três vezes num só dia. O `== null` vem PRIMEIRO, sempre.
 */
function numeroOuNulo(v: unknown): number | null {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

const CAMPO_TRANSPORTE: Record<TributoComTransporte, keyof FichaComSaldo> = {
    ICMS: 'saldoCredorIcmsTransportar',
    IPI: 'saldoCredorIpiTransportar',
};

function rotuloCompetencia(comp: string | null): string {
    if (!comp) return 'a competência anterior';
    const [ano, mes] = comp.split('-');
    return `${mes}/${ano}`;
}

function montarItem(
    tributo: TributoComTransporte,
    fichaAnterior: FichaComSaldo | null,
    competenciaAnterior: string | null,
): PropostaSaldoTributo {
    const rotulo = rotuloCompetencia(competenciaAnterior);

    if (!competenciaAnterior) {
        return {
            tributo,
            valor: null,
            origem: 'competencia-ilegivel',
            texto: `Não consegui ler a competência desta ficha, então não sei qual é a anterior — `
                + `o saldo credor de ${tributo} do mês anterior não foi proposto. Confira a competência.`,
        };
    }
    if (!fichaAnterior) {
        return {
            tributo,
            valor: null,
            origem: 'sem-ficha-anterior',
            texto: `Não há ficha lançada em ${rotulo}, então não há de onde trazer o saldo credor de `
                + `${tributo}. Em branco não quer dizer que não há saldo — informe se houver.`,
        };
    }

    const transportar = numeroOuNulo(fichaAnterior[CAMPO_TRANSPORTE[tributo]]);
    if (transportar == null) {
        return {
            tributo,
            valor: null,
            origem: 'anterior-nao-informou',
            texto: `A ficha de ${rotulo} não informou o saldo credor de ${tributo} a transportar, então `
                + `não há o que trazer. Em branco não quer dizer que não há saldo — informe lá se houver.`,
        };
    }
    return {
        tributo,
        valor: transportar,
        origem: 'ficha-anterior',
        texto: `Saldo credor de ${tributo} veio do "a TRANSPORTAR" da ficha de ${rotulo} — `
            + 'digitado lá, não calculado. Confira antes de salvar.',
    };
}

/**
 * A proposta de saldo anterior para a ficha de `competencia`.
 *
 * 🚨 A leitura da ficha anterior passa pelo DONO (`acharFichaCompetencia`):
 * `mesReferencia` aparece em três formas conforme a época do lançamento, e
 * comparar com `===` na mão não devolve erro — devolve NADA, indistinguível de
 * "a ficha não foi lançada" (a régua de 21/08).
 */
export function proporSaldoAnterior(
    fichaFinanceira: FichaComSaldo[] | null | undefined,
    competencia: unknown,
): PropostaSaldoAnterior {
    const alvo = normalizarCompetencia(competencia);
    const anterior = competenciaAnteriorDe(competencia);
    const fichaAnterior = anterior
        ? (acharFichaCompetencia(fichaFinanceira as { mesReferencia?: string }[], anterior) as FichaComSaldo | null)
        : null;

    const itens: PropostaSaldoTributo[] = [
        montarItem('ICMS', fichaAnterior, anterior),
        montarItem('IPI', fichaAnterior, anterior),
    ];
    return {
        competencia: alvo,
        competenciaAnterior: anterior,
        itens,
        temProposta: itens.some(i => i.valor != null),
    };
}

/** O valor proposto de um tributo, ou `null`. Atalho para quem só quer o número. */
export function valorPropostoDe(
    proposta: PropostaSaldoAnterior,
    tributo: TributoComTransporte,
): number | null {
    return proposta.itens.find(i => i.tributo === tributo)?.valor ?? null;
}

/**
 * Decide o que fica no CAMPO quando a proposta muda (a pessoa trocou a
 * competência da ficha nova, por exemplo).
 *
 * 🚨 **O que a pessoa digitou VENCE a proposta, sempre.** Ela só é aplicada
 * quando o campo ainda está com o valor que a proposta ANTERIOR pôs ali — ou
 * seja, quando ninguém o tocou. Reescrever por cima de um número digitado é
 * mudar imposto pelas costas de quem apurou.
 *
 * ⚠️ E quando a proposta nova é `null`, o campo VOLTA A ZERO em vez de manter o
 * número da outra competência: saldo da competência errada grudado no campo é o
 * mesmo defeito, na direção contrária — foi assim que o "a TRANSPORTAR" ficava
 * preso na ficha seguinte porque o reset não o zerava.
 */
export function aplicarPropostaAoCampo(
    atual: number | null | undefined,
    ultimoProposto: number | null,
    novoProposto: number | null,
): number {
    const valorAtual = numeroOuNulo(atual) ?? 0;
    const anteriorProposto = ultimoProposto ?? 0;
    const foiTocado = Math.round(valorAtual * 100) !== Math.round(anteriorProposto * 100);
    if (foiTocado) return valorAtual;
    return novoProposto ?? 0;
}

export type CausaAvisoSaldo =
    /** O campo está zerado e a competência anterior mandou transportar. */
    | 'zerado-com-transporte'
    /** O campo tem valor, e ele DIFERE do que a anterior mandou transportar. */
    | 'diverge-do-transporte';

export interface AvisoSaldoAnterior {
    tributo: TributoComTransporte;
    causa: CausaAvisoSaldo;
    /** O que a ficha anterior mandou transportar. */
    proposto: number;
    /** O que está no campo desta ficha. */
    atual: number;
    texto: string;
}

/**
 * Os avisos da ficha ABERTA — onde a proposta NÃO entra (reabrir uma ficha
 * gravada não pode reescrever o que a pessoa digitou).
 *
 * ⚠️ São DUAS causas com ações diferentes, e por isso não se juntam numa frase:
 *   • **zerado com transporte** é o caso caro — a guia sai a MAIOR e o SPED,
 *     que já cai na reserva, declara o crédito assim mesmo. Pede a ação
 *     (aplicar o valor);
 *   • **diverge** é informativo: pode ser decisão de quem apura. O app diz os
 *     DOIS números e não escolhe — é a mesma divergência que a geração do SPED
 *     já denuncia, dita antes, na tela onde ela se resolve.
 *
 * ⚠️ E ele NASCE MUDO no caso normal: sem proposta, ou com o campo já batendo
 * com ela, não há aviso nenhum. Alarme sobre ficha correta é o jeito conhecido
 * de a equipe parar de ler os avisos que importam.
 */
export function avisosDeSaldoAnteriorNaFicha(
    proposta: PropostaSaldoAnterior,
    campos: { saldoCredorIcms?: number | null; saldoCredorIpi?: number | null } | null | undefined,
): AvisoSaldoAnterior[] {
    const atualDe = (t: TributoComTransporte) =>
        numeroOuNulo(t === 'ICMS' ? campos?.saldoCredorIcms : campos?.saldoCredorIpi) ?? 0;
    const rotulo = rotuloCompetencia(proposta.competenciaAnterior);
    const centavos = (n: number) => Math.round(n * 100);

    const avisos: AvisoSaldoAnterior[] = [];
    for (const item of proposta.itens) {
        if (item.valor == null || item.valor <= 0) continue;
        const atual = atualDe(item.tributo);
        if (centavos(atual) === centavos(item.valor)) continue;

        if (centavos(atual) === 0) {
            avisos.push({
                tributo: item.tributo,
                causa: 'zerado-com-transporte',
                proposto: item.valor,
                atual,
                texto: `A ficha de ${rotulo} mandou transportar saldo credor de ${item.tributo} e o campo `
                    + '"Mês Anterior" desta ficha está zerado. Assim a GUIA sai sem o abatimento — e o SPED, '
                    + 'que lê o transporte da competência anterior quando este campo está vazio, vai declarar '
                    + 'o crédito assim mesmo: arquivo e guia com números diferentes.',
            });
            continue;
        }
        avisos.push({
            tributo: item.tributo,
            causa: 'diverge-do-transporte',
            proposto: item.valor,
            atual,
            texto: `Esta ficha diz que entrou saldo credor de ${item.tributo} diferente do que a ficha de `
                + `${rotulo} mandou transportar. O arquivo sai com o desta competência — se o certo é o `
                + 'outro, corrija antes de gerar o SPED.',
        });
    }
    return avisos;
}
