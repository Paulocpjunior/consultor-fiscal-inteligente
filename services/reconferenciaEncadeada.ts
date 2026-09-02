/**
 * reconferenciaEncadeada.ts — o LAÇO que drena a competência.
 *
 * 🚨 POR QUE ELE EXISTE (02/09, Paulo na MV LIDER 0639): *"tenho 3 canceladas e
 * não considerou, pede para eu reconferir 3 vezes de 1 em 1, isso que precisa
 * verificar, já imaginou uma NOVA ERA da vida?"*
 *
 * O teto por rodada (~60 notas) EXISTE E CONTINUA VALENDO: cada consulta é uma
 * chamada com o certificado do cliente, e varrer centenas de uma vez arrisca o
 * bloqueio por excesso da SEFAZ (cStat 656). O que não pode é o TETO virar
 * tarefa do colaborador — 126 notas eram 3 cliques, e uma carteira grande seria
 * dezenas. Ninguém clica dezenas de vezes: na prática a reconferência não roda,
 * e "0 cancelada(s)" continua sendo o que o app SABE, não o que a SEFAZ diz.
 *
 * 📌 O laço mora AQUI, e não dentro do `.tsx` de 1500 linhas, porque é ele que
 * pode errar (laço infinito, parar cedo, ignorar o 656) — e régua dentro de
 * tela é régua sem prova. O componente só renderiza o que este módulo devolve.
 */
import type { RespostaReconferencia } from './reconferirCancelamentoService';

/** Teto defensivo: o backend corta em ~60 por rodada, então 40 cobrem 2.400
 *  notas — acima de qualquer competência real. Sem teto, um backend que
 *  parasse de progredir viraria laço infinito no navegador. */
export const MAX_RODADAS_RECONFERENCIA = 40;

export interface AcumuladoReconferencia {
    consultadas: number;
    canceladas: number;
    naoCanceladas: number;
    naoCanceladasPorRecusa: number;
    cancelamentoNaoConfirmado: number;
    indeterminadas: number;
    valorRemovido: number;
}

export type MotivoParada = 'drenou' | 'rate-limit' | 'sem-progresso' | 'parado-pelo-usuario' | 'teto-de-rodadas' | 'erro';

export interface FimDaDrenagem {
    rodadas: number;
    motivo: MotivoParada;
    acumulado: AcumuladoReconferencia;
    ultima: RespostaReconferencia | null;
}

const zero = (): AcumuladoReconferencia => ({
    consultadas: 0, canceladas: 0, naoCanceladas: 0, naoCanceladasPorRecusa: 0,
    cancelamentoNaoConfirmado: 0, indeterminadas: 0, valorRemovido: 0,
});

/**
 * Encadeia as rodadas até a competência drenar.
 *
 * @param chamar      dispara UMA rodada real (o fetch)
 * @param onProgresso recebe o acumulado a cada rodada (progresso ao vivo)
 * @param parar       consultado entre rodadas — o botão "parar após esta rodada"
 */
export async function drenarReconferencia(opts: {
    chamar: () => Promise<RespostaReconferencia>;
    onProgresso?: (acc: AcumuladoReconferencia, r: RespostaReconferencia, rodada: number) => void;
    parar?: () => boolean;
    maxRodadas?: number;
}): Promise<FimDaDrenagem> {
    const acc = zero();
    const max = opts.maxRodadas ?? MAX_RODADAS_RECONFERENCIA;
    let ultima: RespostaReconferencia | null = null;
    let rodadas = 0;

    for (let i = 1; i <= max; i++) {
        rodadas = i;
        const r = await opts.chamar();
        ultima = r;
        if (!r?.ok) return { rodadas, motivo: 'erro', acumulado: acc, ultima };

        const res: any = r.resumo || {};
        acc.consultadas += res.consultadas || 0;
        acc.canceladas += res.canceladas || 0;
        acc.naoCanceladas += res.naoCanceladas || 0;
        acc.naoCanceladasPorRecusa += res.naoCanceladasPorRecusa || 0;
        acc.cancelamentoNaoConfirmado += res.cancelamentoNaoConfirmado || 0;
        acc.indeterminadas += res.indeterminadas || 0;
        acc.valorRemovido = Math.round((acc.valorRemovido + (res.valorRemovido || 0)) * 100) / 100;
        opts.onProgresso?.({ ...acc }, r, i);

        // ⚠️ PARA NO cStat 656: é a SEFAZ dizendo "consulta demais". Insistir é
        // colecionar recusa e ESTENDER o bloqueio — a régua do respiro (27/08).
        if ((r as any).abortou656) return { rodadas, motivo: 'rate-limit', acumulado: acc, ultima };
        // Rodada que não consultou nada não avança a fila: seguir seria laço.
        if (!(Number(res.consultadas) > 0)) return { rodadas, motivo: 'sem-progresso', acumulado: acc, ultima };
        // Sem corte, a competência drenou.
        if (!Number(r.selecao?.cortadas)) return { rodadas, motivo: 'drenou', acumulado: acc, ultima };
        if (opts.parar?.()) return { rodadas, motivo: 'parado-pelo-usuario', acumulado: acc, ultima };
    }
    return { rodadas, motivo: 'teto-de-rodadas', acumulado: acc, ultima };
}

/**
 * A frase do fim da drenagem — cada motivo tem uma AÇÃO diferente, e uma frase
 * só para todos seria "vá procurar" com mais passos.
 */
export function fraseDaDrenagem(fim: FimDaDrenagem): string {
    const n = fim.acumulado.consultadas;
    switch (fim.motivo) {
        case 'drenou':
            return `✓ Competência drenada em ${fim.rodadas} rodada(s) — ${n} nota(s) perguntadas à SEFAZ.`;
        case 'rate-limit':
            return `⏸ A SEFAZ bloqueou por excesso de consultas (cStat 656) depois de ${n} nota(s). `
                + 'Isso é limite DELA, não do app: espere cerca de 1 hora e clique de novo — o que já foi '
                + 'perguntado fica carimbado e a próxima rodada continua de onde parou.';
        case 'parado-pelo-usuario':
            return `⏸ Parado a seu pedido depois de ${n} nota(s). Clique de novo para continuar — as já `
                + 'perguntadas não são repetidas primeiro.';
        case 'teto-de-rodadas':
            return `⏸ Parei no teto de ${fim.rodadas} rodadas por segurança, com ${n} nota(s) perguntadas. `
                + 'Clique de novo para continuar.';
        case 'sem-progresso':
            return n
                ? `✓ ${n} nota(s) perguntadas à SEFAZ.`
                : 'Nenhuma nota foi perguntada nesta rodada — não havia fila a consumir.';
        default:
            return '';
    }
}
