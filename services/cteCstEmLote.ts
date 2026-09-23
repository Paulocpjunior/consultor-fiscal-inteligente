/**
 * cteCstEmLote — "informar o CST em TODOS os CT-e do recorte", de uma vez.
 *
 * ═══ POR QUE EXISTE (21/09, EDUARDO GUERRA) ═════════════════════════════════
 *
 * Paulo: *"onde consigo alterar o CST do frete? Nessa empresa não aproveitamos
 * o crédito de ICMS sobre os fretes"*. A decisão é da EMPRESA e vale para o
 * mês inteiro — e a EDUARDO GUERRA toma ~34 conhecimentos por competência.
 * O campo por documento (✏️ CST informado) é a régua certa, mas digitá-lo 34
 * vezes todo mês é passar o trabalho adiante (a régua de 14/09: *"lance o
 * ajuste na aba" não é entrega quando o app tem como fazer*).
 *
 * ═══ O QUE ESTE MÓDULO DECIDE, E O QUE NÃO ══════════════════════════════════
 *
 * Ele só ESCOLHE os alvos: CT-e de ENTRADA do recorte que ainda não têm CST
 * informado. Quem grava é `gravarCstEscriturado`, um documento por vez, cada
 * um CARIMBADO com quem informou — nada aqui reescreve a régua nem inventa
 * campo. E o que já foi informado à mão NÃO é sobrescrito: o lote preenche o
 * vazio, como todo backfill desta casa (13/08).
 *
 * ⚠️ NÃO É "emitir em série" (a regra de 28/07): nada aqui gera cobrança nem
 * transmite. É uma decisão de escrituração aplicada a documentos que a pessoa
 * está olhando na tela, reversível campo a campo (limpar devolve à régua).
 */

export interface LinhaCteParaLote {
    id: string;
    numero: string;
    direcao: 'entrada' | 'saida';
    ehCte?: boolean;
    cstInformado?: string;
    /** ICMS destacado pelo transportador — o número que a consequência diz. */
    icmsDestacado?: number;
}

/** CT-e de ENTRADA sem CST informado — os alvos do lote. */
export function ctesSemCstInformado<T extends LinhaCteParaLote>(linhas: T[]): T[] {
    return (linhas || []).filter(l => l.ehCte === true && l.direcao === 'entrada' && !String(l.cstInformado || '').trim());
}

const fmt = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A consequência, DITA antes do clique: quantos conhecimentos, e quanto de
 * ICMS destacado deixa de ser creditado no D190, no Livro e no Resumo.
 */
export function fraseDaConsequenciaDoLote(alvos: LinhaCteParaLote[], cst: string): string {
    const n = alvos.length;
    const icms = alvos.reduce((s, l) => s + (Number(l.icmsDestacado) || 0), 0);
    const semCredito = ['90', '40', '41', '50', '51', '60', '70'].includes(String(cst).replace(/\D/g, '').slice(-2));
    return `Informar CST ${cst} em ${n} CT-e de entrada deste recorte que ainda não têm CST informado. `
        + (semCredito
            ? `Com isso o D190 do SPED, o Livro de Entradas e o Resumo por CFOP saem com base e ICMS ZERO nesses fretes`
              + (icms > 0 ? ` — R$ ${fmt(icms)} destacados pelo transportador ficam FORA do crédito` : '')
              + '. '
            : 'A tributação informada passa a valer no D190, no Livro e no Resumo por CFOP. ')
        + 'Cada conhecimento fica gravado com quem informou; limpar o campo devolve o documento à régua automática. '
        + 'Regere o SPED depois.';
}
