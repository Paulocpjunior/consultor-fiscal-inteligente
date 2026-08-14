/**
 * dipamFilaExport — a fila de fornecedores para o Paulo correr atrás.
 *
 * Paulo, 14/08: *"mais fácil me mandar os fornecedores e os erros igual o
 * Antonio, de manhã eu corro atrás"*. O trabalho dele não é na tela — é no
 * CADESP, no telefone, com o cliente. Para isso a fila precisa SAIR do app: no
 * WhatsApp, ou num papel.
 *
 * ═══ NENHUMA CONTA NOVA ═════════════════════════════════════════════════════
 *
 * Tudo aqui vem do MESMO payload que a tela já mostra (`/api/admin/dipam/
 * painel`). Relatório com conta própria diverge da tela sozinho — foi assim que
 * o card 4 passou dois dias mentindo. Este módulo só AGRUPA e FORMATA.
 *
 * ═══ AGRUPADO POR FORNECEDOR, NÃO POR NOTA ══════════════════════════════════
 *
 * A ação é por fornecedor: uma consulta ao CADESP resolve TODAS as notas dele.
 * Uma lista por nota faria a mesma consulta aparecer dez vezes, e a fila
 * pareceria dez vezes maior do que o trabalho que ela é.
 */

import type { DipamPendencia, DipamPainel } from './dipamService';

/** Quantos fornecedores cabem numa mensagem de WhatsApp sem virar muro. */
export const LIMITE_WHATSAPP = 30;

export interface ItemFila {
    /** Nome do fornecedor, ou a nota quando não há fornecedor lido. */
    quem: string;
    doc: string | null;
    /** O que falta — a AÇÃO, não o código interno da pendência. */
    oQueFalta: string;
    notas: number;
    valor: number;
    funruralPotencial: number;
    codigo: string;
}

const texto = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number => Number(v) || 0;

export const fmtBRL = (v: number): string =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function fmtDoc(doc: string | null | undefined): string {
    const d = texto(doc).replace(/\D/g, '');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return d || '—';
}

/**
 * A fila, agrupada por fornecedor e ordenada pelo que vale mais.
 *
 * A ordem é a MESMA da tela (por valor): a primeira costuma resolver o mês, e
 * 293 conferências em ordem qualquer são impossíveis de atacar.
 */
export function montarFilaFornecedores(pendencias: DipamPendencia[] | undefined): ItemFila[] {
    const porChave = new Map<string, ItemFila>();

    for (const p of pendencias || []) {
        const doc = texto(p.doc).replace(/\D/g, '') || null;
        // Sem fornecedor lido, o eixo é a NOTA — é ela que se abre para
        // descobrir de quem é. Agrupar tudo isso num balde "sem doc" faria a
        // linha dizer "12 notas" sem dizer QUAIS, e aí não há o que fazer.
        const chave = doc || `nota:${texto(p.chave) || texto(p.numero) || texto(p.mensagem)}`;
        const atual = porChave.get(chave);
        if (atual) {
            atual.notas += num(p.notas) || 1;
            atual.valor += num(p.valor);
            atual.funruralPotencial += num(p.funruralPotencial);
            continue;
        }
        porChave.set(chave, {
            quem: texto(p.fornecedor) || (p.numero ? `Nota nº ${texto(p.numero)}` : 'Fornecedor não identificado'),
            doc,
            // A AÇÃO, nunca o código: quem lê no WhatsApp não sabe o que é
            // `fornecedor-sociedade`, e o código não diz o que fazer.
            oQueFalta: texto(p.acao) || texto(p.mensagem),
            notas: num(p.notas) || 1,
            valor: num(p.valor),
            funruralPotencial: num(p.funruralPotencial),
            codigo: texto(p.codigo),
        });
    }

    return [...porChave.values()].sort((a, b) => b.valor - a.valor || b.notas - a.notas);
}

export interface ResumoFila {
    fornecedores: number;
    notas: number;
    valor: number;
    funruralPotencial: number;
}

export function resumirFila(fila: ItemFila[]): ResumoFila {
    return (fila || []).reduce<ResumoFila>((acc, f) => ({
        fornecedores: acc.fornecedores + 1,
        notas: acc.notas + f.notas,
        valor: acc.valor + f.valor,
        funruralPotencial: acc.funruralPotencial + f.funruralPotencial,
    }), { fornecedores: 0, notas: 0, valor: 0, funruralPotencial: 0 });
}

/**
 * O texto que vai pro WhatsApp.
 *
 * REGRA DA CASA: lista cortada SEMPRE diz "mostrando X de N" — o `slice(0,20)`
 * mudo do painel de Legalização (30/07) contradizia os próprios selos e ninguém
 * via. Aqui o corte existe porque mensagem de WhatsApp com 300 linhas não se
 * lê; então ele é DITO, com o caminho para a lista inteira.
 */
export function textoDaFila(p: {
    empresa: string;
    competencia: string;
    fila: ItemFila[];
    limite?: number;
}): string {
    const limite = p.limite ?? LIMITE_WHATSAPP;
    const fila = p.fila || [];
    const r = resumirFila(fila);
    const linhas: string[] = [];

    linhas.push(`*DIPAM / FUNRURAL — pendências*`);
    linhas.push(`${p.empresa} · competência ${p.competencia}`);
    linhas.push('');

    if (!fila.length) {
        // Zero nunca é "tudo certo" por si só — ele só vale com a captura
        // saudável, e quem sabe isso é o painel, não este texto.
        linhas.push('Nenhuma pendência nesta competência.');
        linhas.push('Confira a captura antes de dar o mês por fechado: lista vazia não prova que as notas chegaram.');
        return linhas.join('\n');
    }

    linhas.push(
        `${r.fornecedores} fornecedor(es) · ${r.notas} nota(s) · ${fmtBRL(r.valor)} fora do total`
        + ` · ${fmtBRL(r.funruralPotencial)} de FUNRURAL esperando`,
    );
    linhas.push('');

    fila.slice(0, limite).forEach((f, i) => {
        linhas.push(`${i + 1}. *${f.quem}* — ${fmtDoc(f.doc)}`);
        linhas.push(`   ${f.notas} nota(s) · ${fmtBRL(f.valor)} · FUNRURAL ${fmtBRL(f.funruralPotencial)}`);
        linhas.push(`   ${f.oQueFalta}`);
        linhas.push('');
    });

    if (fila.length > limite) {
        linhas.push(`_Mostrando os ${limite} maiores de ${fila.length}. O PDF traz todos._`);
    }
    return linhas.join('\n').trimEnd();
}

/** Colunas e linhas do PDF — a casca única (`gerarRelatorioPdf`) desenha. */
export function linhasDoPdf(fila: ItemFila[]): (string | number)[][] {
    return (fila || []).map((f) => [
        f.quem,
        fmtDoc(f.doc),
        String(f.notas),
        fmtBRL(f.valor),
        fmtBRL(f.funruralPotencial),
        f.oQueFalta,
    ]);
}

export function totaisDoPdf(fila: ItemFila[]): (string | number)[] {
    const r = resumirFila(fila);
    return ['TOTAL', `${r.fornecedores} fornecedor(es)`, String(r.notas), fmtBRL(r.valor), fmtBRL(r.funruralPotencial), ''];
}

/**
 * As ressalvas que vão no rodapé do PDF.
 *
 * Nenhuma delas é enfeite: um papel que lista "R$ 1,4 milhão fora do total" sem
 * dizer que esse dinheiro NÃO é imposto devido faz alguém provisionar valor que
 * não existe.
 */
export function observacoesDoPdf(painel: Pick<DipamPainel, 'funrural'> | null | undefined): string[] {
    const obs = [
        'Os valores desta lista estão FORA do total apurado — eles entram um a um, conforme cada '
        + 'pendência é resolvida com a prova do lado. O "FUNRURAL esperando" é o que ENTRARIA, não o que é devido.',
        'A ordem é por valor: a primeira linha costuma resolver o mês.',
    ];
    const tirados = painel?.funrural?.tiradosPorDecisao?.length || 0;
    if (tirados) {
        // Quem lê o papel precisa saber que existe gente fora do FUNRURAL por
        // DECISÃO — senão procura no CADESP um fornecedor que já foi resolvido.
        obs.push(`${tirados} produtor(es) estão fora do FUNRURAL por decisão gravada no cadastro e NÃO aparecem `
            + 'nesta fila — eles estão no bloco "FORA do FUNRURAL por decisão gravada", na tela.');
    }
    return obs;
}
