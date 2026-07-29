/**
 * CONFERÊNCIA DA CORRELAÇÃO DE CFOP — evidência antes de escriturar.
 *
 * Paulo, 29/07: "precisamos criar uma correlação com relação aos CFOPs de
 * compra. Quando nosso cliente é indústria E comércio, ele pode muito bem
 * comprar com CFOP final 1 e final 2 — industrialização ou revenda. Empresas
 * prestadoras de serviços, as compras indiferem: material de uso/consumo,
 * ativo, etc. Como podemos evidenciar para dirimir os erros?"
 *
 * A correlação em si já existe (correlacionarCfop). O que faltava era MOSTRAR
 * o que ela decidiu e POR QUÊ — e apontar os casos em que a decisão não é do
 * app, é do contador:
 *
 *   • empresa MISTA (indústria + comércio) comprando produto: 101
 *     (industrialização) e 102 (revenda) são ambos legítimos, e quem sabe qual
 *     é a operação é quem conhece o cliente. O app preserva o sufixo do
 *     emitente e marca para conferência.
 *   • empresa SEM natureza declarada: a heurística não age e tudo vai no
 *     espelho mecânico. Não é erro, mas é decisão tomada por omissão.
 *
 * Ativo (551) e uso/consumo (556) não entram nessa discussão: o sufixo do
 * emitente já diz o que é, e a conversão mecânica preserva.
 */
import type { DocumentoFiscal } from '../types';
import { cfopParaEscriturar, type CfopCtx } from './iobSageExportService';

/** Sufixos de COMPRA DE PRODUTO — os únicos onde a natureza decide. */
const SUFIXOS_COMPRA = ['101', '102', '116', '117', '118', '120', '122'];

export type MotivoCorrelacao = 'override' | 'natureza' | 'espelho' | 'sem-conversao';

export interface LinhaCorrelacao {
    origem: string;
    destino: string;
    qtd: number;
    valor: number;
    motivo: MotivoCorrelacao;
    /** Explicação em uma linha, para a tela. */
    explicacao: string;
    /** Precisa de olho humano (não é erro). */
    conferir: boolean;
}

export interface ConferenciaCfop {
    linhas: LinhaCorrelacao[];
    /** Quantas linhas pedem conferência do contador. */
    aConferir: number;
    naturezaAtividade: string | null;
    resumo: string;
}

const rotuloNatureza: Record<string, string> = {
    comercio: 'comércio (compra para revenda → 102)',
    industria: 'indústria (compra para industrialização → 101)',
    servicos: 'serviços (compra vira uso/consumo → 556)',
    misto: 'indústria e comércio',
};

/**
 * Agrupa os CFOPs do recorte: origem → destino, com o motivo da decisão.
 * Só faz sentido para ENTRADA (na saída o CFOP é o da própria empresa).
 */
export function conferirCorrelacaoCfop(
    documentos: DocumentoFiscal[],
    ctx?: CfopCtx,
): ConferenciaCfop {
    const natureza = (ctx?.naturezaAtividade || null) as string | null;
    const overrides = ctx?.cfopOverrides || {};
    const mapa = new Map<string, LinhaCorrelacao>();

    for (const d of documentos || []) {
        if (d.direcao !== 'entrada') continue;
        for (const it of d.itens || []) {
            const origem = String(it.cfop || '').trim();
            if (origem.length !== 4) continue;
            const destino = cfopParaEscriturar(origem, 'entrada', ctx);
            const chave = `${origem}->${destino}`;

            let motivo: MotivoCorrelacao;
            let explicacao: string;
            let conferir = false;
            const sufixo = origem.slice(1);
            const ehCompra = SUFIXOS_COMPRA.includes(sufixo);

            if (overrides[origem]) {
                motivo = 'override';
                explicacao = 'Definido manualmente na tela Correlação CFOP.';
            } else if (!['5', '6', '7'].includes(origem[0]!)) {
                motivo = 'sem-conversao';
                explicacao = 'CFOP já é de entrada — mantido como está.';
            } else if (ehCompra && natureza && natureza !== 'misto') {
                motivo = 'natureza';
                explicacao = `Compra de produto: sufixo definido pela natureza da empresa — ${rotuloNatureza[natureza] || natureza}.`;
            } else if (ehCompra) {
                // Mista ou sem natureza: o app NÃO escolhe entre 101 e 102.
                motivo = 'espelho';
                conferir = true;
                explicacao = natureza === 'misto'
                    ? 'Empresa de indústria E comércio: 101 (industrialização) e 102 (revenda) são ambos possíveis. Mantivemos o sufixo do emitente — confirme se é a operação certa.'
                    : 'Natureza da atividade não declarada no cadastro: mantivemos o sufixo do emitente. Preencha a natureza (ou grave um override) para o app decidir sozinho.';
            } else {
                motivo = 'espelho';
                explicacao = 'Ativo, uso/consumo, devolução, ST: o sufixo do emitente já diz a operação e foi preservado.';
            }

            const atual = mapa.get(chave) || { origem, destino, qtd: 0, valor: 0, motivo, explicacao, conferir };
            atual.qtd++;
            atual.valor += Number((it as any).vProd ?? (it as any).valorTotal ?? 0) || 0;
            mapa.set(chave, atual);
        }
    }

    const linhas = [...mapa.values()].sort(
        (a, b) => Number(b.conferir) - Number(a.conferir) || b.qtd - a.qtd,
    );
    const aConferir = linhas.filter((l) => l.conferir).length;

    return {
        linhas,
        aConferir,
        naturezaAtividade: natureza,
        resumo: linhas.length === 0
            ? 'Nenhum CFOP de entrada no recorte.'
            : aConferir > 0
                ? `${linhas.length} CFOP(s) de entrada · ${aConferir} pedem conferência antes de escriturar.`
                : `${linhas.length} CFOP(s) de entrada, todos com regra definida.`,
    };
}
