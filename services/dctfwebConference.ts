/**
 * dctfwebConference.ts — motor PURO de cruzamento DCTFWeb × Apuração do app.
 *
 * Sem firebase, sem fetch — testável direto em jest (igual xmlDocumentosFilter).
 * O orquestrador (dctfwebConferenceService.ts) busca os dados e chama isto.
 *
 * Cruza por FAMÍLIA de tributo (IRPJ / CSLL / PIS / COFINS / IPI), não por código —
 * o lado-app nomeia o imposto por prefixo ("IRPJ (Trimestral)", "PIS (Lucro
 * Real)") e o lado-DCTFWeb agrupa por código de receita que o normalizador já
 * converte em família. Cruzar por família evita adivinhar mapa de código.
 *
 * INSS patronal fica de fora: o lucroService não calcula INSS — cruzar seria
 * comparar contra zero (divergência fake). Honestidade > cobertura.
 */

import type { DetalheImposto } from '../types';

export type TributoFamilia = 'IRPJ' | 'CSLL' | 'PIS' | 'COFINS' | 'IPI';
export const TRIBUTO_FAMILIAS: TributoFamilia[] = ['IRPJ', 'CSLL', 'PIS', 'COFINS', 'IPI'];

export type DivergenciaSeveridade = 'ok' | 'baixa' | 'media' | 'alta';
export type DivergenciaStatus =
    | 'ok'                  // valores batem (dentro da tolerância)
    | 'divergente'         // ambos têm valor mas diferem
    | 'sem-dctfweb'        // app apurou mas não há débito correspondente na DCTFWeb
    | 'sem-apuracao-app';  // DCTFWeb declarou mas o app não apurou nada

export interface TributosPorFamilia {
    IRPJ: number;
    CSLL: number;
    PIS: number;
    COFINS: number;
    IPI: number;
}

export interface DivergenciaTributo {
    tributo: TributoFamilia;
    valorApp: number;
    valorDctfweb: number;
    diferenca: number;       // valorApp - valorDctfweb
    diferencaPct: number;    // % sobre o maior dos dois (0 se ambos 0)
    severidade: DivergenciaSeveridade;
    status: DivergenciaStatus;
}

export interface ConferenciaResultado {
    competencia: string;
    divergencias: DivergenciaTributo[];
    totalApp: number;
    totalDctfweb: number;
    temDivergencia: boolean;     // alguma severidade != 'ok'
    resumo: { ok: number; baixa: number; media: number; alta: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Soma os valores do detalhamento do app por família de tributo.
 * PIS/COFINS podem ter várias linhas (Cumulativo, Lucro Real, Rec. Financeira,
 * Importação, Aplicações) — somadas na mesma família.
 */
export function extrairTributosApp(detalhamento: DetalheImposto[] | undefined | null): TributosPorFamilia {
    const out: TributosPorFamilia = { IRPJ: 0, CSLL: 0, PIS: 0, COFINS: 0, IPI: 0 };
    for (const det of detalhamento || []) {
        const nome = String(det?.imposto || '').toUpperCase().trim();
        // O DÉBITO declarado na DCTFWeb/MIT é o BRUTO (antes da retenção na
        // fonte); a retenção entra como vinculação e não abate o débito. Por
        // isso cruzamos/montamos o MIT com valorBruto (fallback: valor, p/
        // impostos sem retenção). Antes usava só `valor` (líquido) → gerava
        // divergência falsa e débito subdeclarado no MIT.
        const valor = Number(det?.valorBruto ?? det?.valor) || 0;
        if (!valor) continue;
        // COFINS antes de PIS (COFINS não contém "PIS"; ok). IRPJ/CSLL por prefixo.
        if (nome.startsWith('COFINS')) out.COFINS += valor;
        else if (nome.startsWith('PIS')) out.PIS += valor;
        else if (nome.startsWith('IRPJ')) out.IRPJ += valor;
        else if (nome.startsWith('CSLL')) out.CSLL += valor;
        // IRPJ/CSLL combinado ("IRPJ/CSLL (Lucro Real)") — divide? Não: sem como
        // separar com segurança. Vai pra IRPJ por convenção e marcamos via
        // observação no orquestrador. Aqui priorizamos COFINS/PIS/IRPJ/CSLL puros.
        else if (nome.startsWith('IRPJ/CSLL')) out.IRPJ += valor;
        // IPI da apuracao fiscal da ficha ("IPI", "IPI (A Recolher)") — nao
        // confunde com IRPJ (prefixos distintos).
        else if (nome.startsWith('IPI')) out.IPI += valor;
    }
    out.IRPJ = round2(out.IRPJ);
    out.CSLL = round2(out.CSLL);
    out.PIS = round2(out.PIS);
    out.COFINS = round2(out.COFINS);
    out.IPI = round2(out.IPI);
    return out;
}

function severidadePorPct(pct: number): DivergenciaSeveridade {
    const a = Math.abs(pct);
    if (a === 0) return 'ok';
    if (a > 10) return 'alta';
    if (a > 5) return 'media';
    return 'baixa';
}

/**
 * Cruza os tributos apurados (app) contra os declarados (DCTFWeb).
 *
 * @param app       tributos somados do app (extrairTributosApp)
 * @param dctfweb   tributos normalizados da DCTFWeb MIT (normalizarApuracaoMit)
 * @param competencia  rótulo YYYY-MM
 * @param opts.toleranciaCentavos  diferença <= isto é tratada como OK (default 0.02)
 */
export function cruzarTributos(
    app: TributosPorFamilia,
    dctfweb: TributosPorFamilia,
    competencia: string,
    opts: { toleranciaCentavos?: number } = {},
): ConferenciaResultado {
    const tol = opts.toleranciaCentavos ?? 0.02;
    const divergencias: DivergenciaTributo[] = [];
    const resumo = { ok: 0, baixa: 0, media: 0, alta: 0 };
    let totalApp = 0;
    let totalDctfweb = 0;

    for (const tributo of TRIBUTO_FAMILIAS) {
        const valorApp = round2(app[tributo] || 0);
        const valorDctfweb = round2(dctfweb[tributo] || 0);
        totalApp += valorApp;
        totalDctfweb += valorDctfweb;

        const diferenca = round2(valorApp - valorDctfweb);
        const base = Math.max(Math.abs(valorApp), Math.abs(valorDctfweb));
        const diferencaPct = base === 0 ? 0 : round2((diferenca / base) * 100);

        let status: DivergenciaStatus;
        let severidade: DivergenciaSeveridade;

        if (Math.abs(diferenca) <= tol) {
            status = 'ok';
            severidade = 'ok';
        } else if (valorDctfweb === 0 && valorApp > 0) {
            status = 'sem-dctfweb';
            severidade = 'alta'; // apurou e não declarou — risco fiscal alto
        } else if (valorApp === 0 && valorDctfweb > 0) {
            status = 'sem-apuracao-app';
            severidade = 'media'; // declarou e app não tem — revisar apuração
        } else {
            status = 'divergente';
            severidade = severidadePorPct(diferencaPct);
        }

        resumo[severidade]++;
        divergencias.push({ tributo, valorApp, valorDctfweb, diferenca, diferencaPct, severidade, status });
    }

    return {
        competencia,
        divergencias,
        totalApp: round2(totalApp),
        totalDctfweb: round2(totalDctfweb),
        temDivergencia: resumo.baixa + resumo.media + resumo.alta > 0,
        resumo,
    };
}
