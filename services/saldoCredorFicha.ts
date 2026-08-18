/**
 * saldoCredorFicha — o que a ficha DIZ sobre saldo credor de ICMS e IPI.
 *
 * ═══ POR QUE ISTO É UM NÚCLEO, E NÃO UM `if` NA TELA ═════════════════════════
 *
 * Paulo, 18/08, com a ficha da KROYA 07/2026 e a planilha que ele manda ao
 * cliente lado a lado: *"o saldo credor de ICMS e IPI está mostrando do mês
 * anterior, mas preciso que apresente o saldo atual, o que vamos transportar
 * para o mês seguinte. Nesse modelo manual, eu informo pra eles mensalmente
 * qual saldo será transportado"*.
 *
 * São **DOIS fatos diferentes** e a ficha só tinha um:
 *
 *   • o saldo que ENTROU no mês (`saldoCredorIcms`) — é ele que abate o imposto
 *     a recolher, e é dele que a tela dizia "Cred. ICMS Anterior";
 *   • o saldo que SOBRA e vai para o mês seguinte — o número que o cliente
 *     realmente quer, porque é o que ele leva adiante.
 *
 * ═══ POR QUE O APP NÃO DERIVA O SEGUNDO ═════════════════════════════════════
 *
 * A conta óbvia — `entrou − a recolher` — está ERRADA, e a própria KROYA prova:
 * o ICMS entrou em **486.477,01** e sai em **521.793,35**. Ele CRESCEU, porque o
 * mês gerou mais crédito do que débito, e a ficha não carrega o crédito gerado.
 * Derivar devolveria um número MENOR que o real — erro na direção que prejudica
 * o cliente, e num papel que vai para ele.
 *
 * Enquanto a cronologia de verdade não existe (saldo de abertura carimbado +
 * transporte CALCULADO mês a mês, desenho de 17/08 que sai do E110 campo 14),
 * quem sabe o número é quem apura. O campo existe para ele.
 *
 * ═══ A TRAVA ════════════════════════════════════════════════════════════════
 *
 * **Campo vazio NÃO vira zero.** Zero num campo de saldo é uma AFIRMAÇÃO — aqui,
 * "você não tem crédito a transportar", dita a um cliente que talvez tenha meio
 * milhão. É a lição do E110 de 17/08 aplicada a um documento externo.
 */

export type SituacaoSaldo =
    /** Tem número informado — é o que o cliente leva para o mês seguinte. */
    | 'informado'
    /** Ninguém informou. O relatório DIZ isso; nunca imprime 0,00. */
    | 'nao-informado'
    /** Informado como zero DE PROPÓSITO: o saldo acabou neste mês. */
    | 'zerado';

export interface SaldoTributo {
    tributo: 'ICMS' | 'IPI';
    /** O que entrou no mês (saldo do mês anterior). Null = não informado. */
    anterior: number | null;
    /** O que sobra e vai para o mês seguinte. Null = não informado. */
    transportar: number | null;
    situacao: SituacaoSaldo;
    /** Frase pronta para a tela e para o PDF — a causa junto do número. */
    texto: string;
}

export interface SaldosDaFicha {
    itens: SaldoTributo[];
    /** Há algum tributo com saldo anterior mas sem o de transporte informado? */
    faltaInformar: boolean;
    /** Competência seguinte, escrita ('08/2026') — para o rótulo não mentir. */
    competenciaSeguinte: string | null;
}

interface EntradaFicha {
    saldoCredorIcms?: number | null;
    saldoCredorIpi?: number | null;
    saldoCredorIcmsTransportar?: number | null;
    saldoCredorIpiTransportar?: number | null;
    /** 'AAAA-MM' da competência da ficha. */
    mesReferencia?: string | null;
}

/** 'AAAA-MM' → 'MM/AAAA' do mês SEGUINTE. Null quando a competência não é legível. */
export function competenciaSeguinteDe(mesReferencia?: string | null): string | null {
    const m = /^(\d{4})-(\d{2})$/.exec(String(mesReferencia || '').trim());
    if (!m) return null;
    const ano = Number(m[1]);
    const mes = Number(m[2]);
    if (mes < 1 || mes > 12) return null;
    const proximoMes = mes === 12 ? 1 : mes + 1;
    const proximoAno = mes === 12 ? ano + 1 : ano;
    return `${String(proximoMes).padStart(2, '0')}/${proximoAno}`;
}

/**
 * ⚠️ `Number(null)` é 0 e `Number.isFinite(0)` é true — foi essa combinação que
 * mordeu três vezes num só dia (farol de lastro, regime do catálogo, calendário
 * municipal). O `== null` vem PRIMEIRO, sempre.
 */
function numeroOuNulo(v: unknown): number | null {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function montarItem(
    tributo: 'ICMS' | 'IPI',
    anteriorBruto: unknown,
    transportarBruto: unknown,
    competenciaSeguinte: string | null,
): SaldoTributo {
    const anterior = numeroOuNulo(anteriorBruto);
    const transportar = numeroOuNulo(transportarBruto);
    const proximo = competenciaSeguinte ? ` para ${competenciaSeguinte}` : ' para o mês seguinte';

    if (transportar == null) {
        return {
            tributo,
            anterior,
            transportar: null,
            situacao: 'nao-informado',
            // A ação vai na frase: quem lê precisa saber que o branco não é zero
            // e onde se resolve.
            texto: `Saldo credor de ${tributo} a transportar${proximo}: não informado nesta ficha. `
                + 'Informe na apuração — em branco não quer dizer que não há saldo.',
        };
    }
    if (transportar === 0) {
        return {
            tributo,
            anterior,
            transportar: 0,
            situacao: 'zerado',
            texto: `Sem saldo credor de ${tributo}${proximo}: o crédito foi consumido nesta competência.`,
        };
    }
    return {
        tributo,
        anterior,
        transportar,
        situacao: 'informado',
        texto: `Saldo credor de ${tributo}${proximo}.`,
    };
}

export function saldosDaFicha(ficha: EntradaFicha | null | undefined): SaldosDaFicha {
    const competenciaSeguinte = competenciaSeguinteDe(ficha?.mesReferencia);
    const itens = [
        montarItem('ICMS', ficha?.saldoCredorIcms, ficha?.saldoCredorIcmsTransportar, competenciaSeguinte),
        montarItem('IPI', ficha?.saldoCredorIpi, ficha?.saldoCredorIpiTransportar, competenciaSeguinte),
    ];
    // Só cobra quem TEM motivo: empresa sem saldo anterior e sem transporte não
    // é pendência nenhuma — alarme sem alvo é o que ensina a ignorar alarme.
    const faltaInformar = itens.some(i => i.situacao === 'nao-informado' && (i.anterior || 0) > 0);
    return { itens, faltaInformar, competenciaSeguinte };
}

/** Os itens que MERECEM aparecer: sem saldo nenhum, o bloco não nasce. */
export function itensVisiveis(s: SaldosDaFicha): SaldoTributo[] {
    return s.itens.filter(i => (i.anterior || 0) > 0 || i.transportar != null);
}
