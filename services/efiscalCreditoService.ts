// services/efiscalCreditoService.ts
//
// Calculo de credito PIS/COFINS sobre o relatorio "Servicos Tomados" do
// E-Fiscal, condicionado ao regime tributario da empresa TOMADORA.
//
// Regra fiscal (definida por SP Assessoria):
//   - Simples Nacional ............ NAO gera credito (recolhe no DAS)
//   - Lucro Presumido ............. credito 0,65% PIS + 3,00% COFINS
//   - Lucro Real .................. credito 1,65% PIS + 7,60% COFINS
//   - Todas as categorias de servico geram credito (sem distincao).
//
// A classificacao por categoria reaproveita as regras de keyword do
// analiseCreditoExtratoService (as 11 categorias da Eunice).

import { classificar, type TipoDespesaCredito } from './analiseCreditoExtratoService';
import type { RegimeSugerido } from './xmlFiscalService';
import type { EfiscalFornecedorAgrupado, EfiscalNf } from './efiscalPdfParserService';

export type RegimeCalculo = 'SIMPLES' | 'PRESUMIDO' | 'REAL';

export interface AliquotaRegime {
    pis: number;
    cofins: number;
    label: string;
}

export const ALIQUOTAS: Record<RegimeCalculo, AliquotaRegime> = {
    SIMPLES:   { pis: 0,      cofins: 0,     label: 'Simples Nacional (nao gera credito)' },
    PRESUMIDO: { pis: 0.0065, cofins: 0.0300, label: 'Lucro Presumido (cumulativo)' },
    REAL:      { pis: 0.0165, cofins: 0.0760, label: 'Lucro Real (nao-cumulativo)' },
};

/** Mapeia o RegimeSugerido (5 valores) para o regime de calculo (3 valores). */
export function regimeParaCalculo(regime: RegimeSugerido): RegimeCalculo {
    if (regime === 'SIMPLES') return 'SIMPLES';
    if (regime === 'LUCRO_PRESUMIDO') return 'PRESUMIDO';
    // LUCRO_REAL_INDUSTRIA | LUCRO_REAL_SERVICOS | LUCRO_REAL_COMERCIO
    return 'REAL';
}

export interface FornecedorClassificado extends EfiscalFornecedorAgrupado {
    categoria: TipoDespesaCredito | null;
}

export interface CategoriaAgrupada {
    categoria: TipoDespesaCredito | 'SEM_CATEGORIA';
    qtdFornecedores: number;
    qtdNotas: number;
    somaBaseCalculo: number;
    notas: EfiscalNf[];   // NFs individuais que compoem este grupo
}

export interface CreditoEfiscal {
    regime: RegimeCalculo;
    aliquota: AliquotaRegime;
    geraCredito: boolean;
    baseTotal: number;          // soma de Base de Calculo de todas as NFs
    creditoPis: number;
    creditoCofins: number;
    creditoTotal: number;
    fornecedoresClassificados: FornecedorClassificado[];
    categorias: CategoriaAgrupada[];
}

/**
 * Classifica cada fornecedor numa das 11 categorias (via keyword na razao
 * social), agrupa por categoria e calcula o credito conforme o regime.
 */
export function calcularCreditoEfiscal(
    fornecedores: EfiscalFornecedorAgrupado[],
    regime: RegimeCalculo,
    notas: EfiscalNf[] = [],
): CreditoEfiscal {
    const aliquota = ALIQUOTAS[regime];
    const geraCredito = regime !== 'SIMPLES';

    // 1. classifica cada fornecedor pela razao social
    // classificar() pode devolver 'SEM_CREDITO' — normalizo para null
    // (no contexto E-Fiscal todas as categorias geram credito; 'SEM_CREDITO'
    //  aqui significa apenas "nao casou com nenhuma categoria conhecida").
    const fornecedoresClassificados: FornecedorClassificado[] = fornecedores.map(f => {
        const cls = classificar(f.razaoSocial, '');
        const cat = (cls.categoria && cls.categoria !== 'SEM_CREDITO')
            ? cls.categoria
            : null;
        return { ...f, categoria: cat };
    });

    // 2. mapa CNPJ (so digitos) -> categoria do fornecedor
    const soDig = (s: string) => (s || '').replace(/\D+/g, '');
    const catPorCnpj = new Map<string, TipoDespesaCredito | null>();
    for (const f of fornecedoresClassificados) {
        catPorCnpj.set(soDig(f.cnpjCpf), f.categoria);
    }

    // 3. agrupa por categoria (resumo + notas individuais)
    const mapaCat = new Map<string, CategoriaAgrupada>();
    const ensureCat = (chave: string): CategoriaAgrupada => {
        if (!mapaCat.has(chave)) {
            mapaCat.set(chave, {
                categoria: chave as CategoriaAgrupada['categoria'],
                qtdFornecedores: 0, qtdNotas: 0, somaBaseCalculo: 0, notas: [],
            });
        }
        return mapaCat.get(chave)!;
    };
    for (const f of fornecedoresClassificados) {
        const cat = ensureCat(f.categoria ?? 'SEM_CATEGORIA');
        cat.qtdFornecedores++;
        cat.qtdNotas += f.qtdNotas;
        cat.somaBaseCalculo += f.somaBaseCalculo;
    }
    // distribui as NFs individuais nos grupos, pela categoria do fornecedor
    for (const nf of notas) {
        const categoria = catPorCnpj.get(soDig(nf.cnpjCpf)) ?? 'SEM_CATEGORIA';
        ensureCat(categoria as string).notas.push(nf);
    }
    const categorias = Array.from(mapaCat.values())
        .sort((a, b) => b.somaBaseCalculo - a.somaBaseCalculo);

    // 3. base = soma da Base de Calculo de todos os fornecedores
    const baseTotal = fornecedores.reduce((s, f) => s + f.somaBaseCalculo, 0);

    const creditoPis    = geraCredito ? baseTotal * aliquota.pis    : 0;
    const creditoCofins = geraCredito ? baseTotal * aliquota.cofins : 0;

    return {
        regime, aliquota, geraCredito,
        baseTotal, creditoPis, creditoCofins,
        creditoTotal: creditoPis + creditoCofins,
        fornecedoresClassificados, categorias,
    };
}
