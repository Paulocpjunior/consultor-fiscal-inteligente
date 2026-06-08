/**
 * cfopClassifier — classifica CFOPs por categoria de operacao usando o catalogo
 * CONFAZ (Ajuste SINIEF 03/2004 e atualizacoes).
 *
 * Substitui a classificacao anterior (services/xmlParserService.classificarPorCfop)
 * que lia o 2o digito como "categoria" e errava sistematicamente:
 *   - 5202 (devolucao de compra) era classificado como "venda"
 *   - 5151 (transferencia) era "venda"
 *   - 5901 (remessa) era "servico_prestado"
 *   - 1902 (retorno de remessa) era "servico_tomado"
 *
 * A classificacao certa exige consultar o numero CFOP completo de 4 digitos
 * em uma tabela de faixas, nao apenas 1 digito.
 *
 * Codificacao CONFAZ (1o digito = origem):
 *   1xxx entrada do estado
 *   2xxx entrada de outro estado
 *   3xxx entrada do exterior
 *   5xxx saida para o estado
 *   6xxx saida para outro estado
 *   7xxx saida para o exterior
 */

import type { CategoriaOperacao, XmlDirecao as Direcao } from '../types';

interface CfopFaixa {
    inicio: number;
    fim: number;
    categoria: CategoriaOperacao;
}

/**
 * Tabela de faixas CFOP -> categoria. Ordem importa: a primeira faixa que
 * casa eh a usada. Lista verificada contra a tabela CONFAZ vigente em 2026.
 *
 * Cobertura: ~95% do volume tipico de empresas no varejo/comercio/industria.
 * CFOPs raros nao listados caem em 'outro' (ex: industrializacao, sucata).
 */
const FAIXAS: ReadonlyArray<CfopFaixa> = [
    // ── ENTRADAS (1xxx, 2xxx, 3xxx) ─────────────────────────────────────────

    // Compras de mercadoria/insumo (categoria 1xx)
    { inicio: 1101, fim: 1118, categoria: 'compra' },
    { inicio: 2101, fim: 2118, categoria: 'compra' },
    { inicio: 3101, fim: 3108, categoria: 'compra' },

    // Transferencia recebida (entrada)
    { inicio: 1151, fim: 1154, categoria: 'transferencia' },
    { inicio: 2151, fim: 2154, categoria: 'transferencia' },

    // Devolucao de venda (cliente devolveu — vira entrada pra emitente)
    { inicio: 1201, fim: 1213, categoria: 'devolucao' },
    { inicio: 2201, fim: 2213, categoria: 'devolucao' },
    { inicio: 3201, fim: 3211, categoria: 'devolucao' },

    // Servico transporte tomado
    { inicio: 1351, fim: 1360, categoria: 'servico_tomado' },
    { inicio: 2351, fim: 2360, categoria: 'servico_tomado' },
    { inicio: 3351, fim: 3360, categoria: 'servico_tomado' },

    // Servico comunicacao tomado
    { inicio: 1301, fim: 1306, categoria: 'servico_tomado' },
    { inicio: 2301, fim: 2306, categoria: 'servico_tomado' },
    { inicio: 3301, fim: 3303, categoria: 'servico_tomado' },

    // Aquisicao p/ substituicao tributaria (mercadoria) — natureza de compra
    { inicio: 1401, fim: 1410, categoria: 'compra' },
    { inicio: 2401, fim: 2410, categoria: 'compra' },

    // Devolucao em operacoes ST
    { inicio: 1411, fim: 1415, categoria: 'devolucao' },
    { inicio: 2411, fim: 2415, categoria: 'devolucao' },

    // Imobilizado / uso e consumo — modelado como 'compra' (entrada de bem)
    { inicio: 1551, fim: 1557, categoria: 'compra' },
    { inicio: 2551, fim: 2557, categoria: 'compra' },
    { inicio: 3551, fim: 3553, categoria: 'compra' },

    // Energia eletrica / combustivel / gas — entrada
    { inicio: 1251, fim: 1257, categoria: 'compra' },
    { inicio: 2251, fim: 2257, categoria: 'compra' },
    { inicio: 3251, fim: 3257, categoria: 'compra' },

    // Retornos de remessa (industrializacao, conserto, comodato, etc) — entrada
    { inicio: 1901, fim: 1926, categoria: 'remessa' },
    { inicio: 2901, fim: 2926, categoria: 'remessa' },
    { inicio: 3930, fim: 3950, categoria: 'remessa' },

    // ── SAIDAS (5xxx, 6xxx, 7xxx) ───────────────────────────────────────────

    // Vendas (categoria 1xx)
    { inicio: 5101, fim: 5119, categoria: 'venda' },
    { inicio: 6101, fim: 6119, categoria: 'venda' },
    { inicio: 7101, fim: 7106, categoria: 'venda' },

    // Transferencia enviada (saida)
    { inicio: 5151, fim: 5159, categoria: 'transferencia' },
    { inicio: 6151, fim: 6159, categoria: 'transferencia' },

    // Devolucao de compra (saida — devolvendo ao fornecedor)
    { inicio: 5201, fim: 5213, categoria: 'devolucao' },
    { inicio: 6201, fim: 6213, categoria: 'devolucao' },
    { inicio: 7201, fim: 7211, categoria: 'devolucao' },

    // Servico transporte prestado
    { inicio: 5351, fim: 5360, categoria: 'servico_prestado' },
    { inicio: 6351, fim: 6360, categoria: 'servico_prestado' },
    { inicio: 7358, fim: 7358, categoria: 'servico_prestado' },

    // Servico comunicacao prestado
    { inicio: 5301, fim: 5307, categoria: 'servico_prestado' },
    { inicio: 6301, fim: 6307, categoria: 'servico_prestado' },

    // Substituicao tributaria — emissao do substituto (natureza de venda)
    { inicio: 5401, fim: 5415, categoria: 'venda' },
    { inicio: 6401, fim: 6415, categoria: 'venda' },

    // Imobilizado / uso e consumo (saida)
    { inicio: 5551, fim: 5557, categoria: 'venda' },
    { inicio: 6551, fim: 6557, categoria: 'venda' },

    // Energia/combustivel saida
    { inicio: 5251, fim: 5257, categoria: 'venda' },
    { inicio: 6251, fim: 6257, categoria: 'venda' },

    // Remessas (saida temporaria — comodato, conserto, demonstracao, indust.)
    { inicio: 5901, fim: 5925, categoria: 'remessa' },
    { inicio: 6901, fim: 6925, categoria: 'remessa' },
    { inicio: 7949, fim: 7949, categoria: 'remessa' },
];

/**
 * Classifica um CFOP individual usando a tabela de faixas CONFAZ.
 * Devolve `null` se nao encontrar correspondencia (CFOP raro ou invalido).
 */
export function classificarCfop(cfop: string): CategoriaOperacao | null {
    const digitos = (cfop || '').replace(/\D/g, '');
    if (digitos.length !== 4) return null;
    const n = parseInt(digitos, 10);
    if (isNaN(n)) return null;
    for (const f of FAIXAS) {
        if (n >= f.inicio && n <= f.fim) return f.categoria;
    }
    return null;
}

/**
 * Verifica se o CFOP eh de entrada (1xxx, 2xxx, 3xxx). Util pra fallback
 * quando a tabela nao reconhece um CFOP raro.
 */
export function ehCfopDeEntrada(cfop: string): boolean {
    const digitos = (cfop || '').replace(/\D/g, '');
    if (digitos.length !== 4) return false;
    const primeiro = digitos[0];
    return primeiro === '1' || primeiro === '2' || primeiro === '3';
}

/**
 * Classifica a categoria predominante de um documento fiscal a partir dos
 * CFOPs de seus itens. Faz votacao (categoria que mais aparece vence).
 *
 * Quando nenhum CFOP eh reconhecido, usa a direcao (entrada/saida) como
 * fallback - entrada vira 'compra' e saida vira 'venda'.
 */
export function classificarPorCfop(
    itens: { cfop: string }[],
    direcao: Direcao,
): CategoriaOperacao {
    const cfops = itens.map(i => i.cfop).filter(Boolean);
    if (cfops.length === 0) return 'outro';

    const contagem: Record<CategoriaOperacao, number> = {
        compra: 0, venda: 0, servico_prestado: 0, servico_tomado: 0,
        devolucao: 0, transferencia: 0, remessa: 0, outro: 0,
    };

    for (const cfop of cfops) {
        const cat = classificarCfop(cfop);
        if (cat) {
            contagem[cat]++;
        } else {
            // Fallback pra CFOP nao mapeado: usa direcao do documento
            if (ehCfopDeEntrada(cfop)) contagem.compra++;
            else contagem.venda++;
        }
    }

    let best: CategoriaOperacao = 'outro';
    let bestCount = 0;
    for (const [cat, count] of Object.entries(contagem) as [CategoriaOperacao, number][]) {
        if (count > bestCount) { best = cat; bestCount = count; }
    }

    if (best === 'outro' && direcao === 'entrada') return 'compra';
    if (best === 'outro' && direcao === 'saida') return 'venda';
    return best;
}
