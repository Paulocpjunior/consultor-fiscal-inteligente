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
 * A linha do VEREDITO — e ela NÃO funde as duas provas.
 *
 * 🚨 03/09, Paulo na MV LIDER 0639 · 08/2026: *"ainda sobre NFS canceladas veja
 * o erro que não estão sendo relacionadas"*. A tela dizia, na linha mais alta
 * da caixa, **"20 consultada(s) · 0 cancelada(s) · 20 não cancelada(s)"** — e
 * dois parágrafos abaixo, no aviso do backend, **"20 nota(s) a SEFAZ recusou
 * por PERMISSÃO (cStat 640)"**. As mesmas 20.
 *
 * 🔴 A causa era de SOMA, na tela: `naoCanceladas + naoCanceladasPorRecusa`. O
 * núcleo separa as duas de propósito desde 20/08 — *"lá a prova é POSITIVA (ela
 * entregou o documento e não há evento), aqui é NEGATIVA (ela não disse 653), e
 * fundir as duas apagaria a diferença justo onde importa"* — e era exatamente a
 * tela que apagava. Nesta empresa, que **não tem A1 próprio**, a rodada inteira
 * volta por recusa: o veredito lia "conferi 20 e estão boas" sobre 20 notas em
 * que a SEFAZ não entregou documento nenhum.
 *
 * ⚠️ E a correção NÃO é chamar o 640 de "sem resposta": **recusa é resposta**
 * (a régua de 20/08, provada na própria MV LIDER — nota cancelada volta 653
 * mesmo a quem não é parte). O que muda é a tela parar de somar as duas provas
 * num número só.
 */
export function fraseDoVeredito(resumo: any, selecao: any): string {
    const n = (v: unknown) => Number(v) || 0;
    const partes = [
        `${n(resumo?.consultadas)} consultada(s)`,
        `${n(resumo?.canceladas)} cancelada(s)`,
        `${n(resumo?.naoCanceladas)} não cancelada(s) pelo XML`,
        `${n(resumo?.naoCanceladasPorRecusa)} não cancelada(s) por recusa (640)`,
        `${n(resumo?.indeterminadas)} indeterminada(s)`,
    ];
    if (n(resumo?.cancelamentoNaoConfirmado)) {
        partes.push(`${n(resumo.cancelamentoNaoConfirmado)} com cancelamento NÃO confirmado`);
    }
    if (n(selecao?.jaCanceladas)) partes.push(`${n(selecao.jaCanceladas)} já constavam canceladas`);
    if (n(selecao?.naoMod55)) partes.push(`${n(selecao.naoMod55)} fora (não é NF-e mod 55)`);
    return partes.join(' · ');
}

/**
 * Os NÚMEROS das notas em que a prova é NEGATIVA — as que voltaram 640.
 *
 * 📌 Elas não aparecem linha a linha de propósito (20 linhas dizendo o mesmo é
 * o que faz ninguém ler as que importam), mas sumir de vez foi o que produziu o
 * *"não estão sendo relacionadas"*: quem confere o mês precisa saber QUAIS
 * dependem de prova fraca, porque são justamente essas que um A1 próprio
 * responderia melhor.
 */
export function numerosPorRecusa(resultados: any[], teto = 30): { numeros: string[]; restantes: number } {
    const todos = (resultados || [])
        .filter((r) => r?.situacao === 'nao-cancelada-por-recusa')
        .map((r) => String(r?.numero ?? '—'));
    return { numeros: todos.slice(0, teto), restantes: Math.max(0, todos.length - teto) };
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
