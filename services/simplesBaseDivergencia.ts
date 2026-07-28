/**
 * VARREDURA DA BASE DO SIMPLES (RBT12) — quem estava pagando a maior.
 *
 * Até 28/07/2026 o enquadramento na faixa usava uma base montada somando os
 * itens do detalhamento por CNAE. Quando esse detalhamento somava MAIS que o
 * total lançado do mês (item duplicado, filial contada duas vezes), o excesso
 * inflava o RBT12, subia a alíquota efetiva e o DAS saía acima do PGDAS-D
 * (caso JD DE SOUZA ITAPEVI 06/2026: R$ 3.012,58 contra R$ 2.981,84).
 *
 * O cálculo já foi corrigido. Esta varredura responde a pergunta seguinte, que
 * é a que importa pra equipe: **quais clientes foram afetados e em quanto?**
 *
 * O impacto NÃO é estimado por regra de três: recalculamos o DAS com o mesmo
 * motor de cálculo nas duas bases (a correta e a inflada que o app usava),
 * então o número que aparece na tela é a diferença real.
 */
import { calcularResumoEmpresa } from './simplesNacionalService';
import type { SimplesNacionalEmpresa } from '../types';

export interface MesDivergente {
    competencia: string;
    /** Total lançado do mês (faturamentoManual). */
    total: number;
    /** Soma dos itens do detalhamento por CNAE. */
    detalhado: number;
    /** Quanto o detalhamento passou do total — o que inflava a base. */
    excedente: number;
}

export interface DivergenciaBase {
    empresaId: string;
    nome: string;
    cnpj: string;
    competencia: string;
    anexo: string;
    /** RBT12 correto (soma dos totais dos 12 meses anteriores). */
    rbt12Correto: number;
    /** Base que o app usava para enquadrar a faixa. */
    rbt12Antigo: number;
    excedente: number;
    meses: MesDivergente[];
    /** DAS da competência com a base correta (o que o app mostra hoje). */
    dasCorreto: number;
    /** DAS que o app mostrava antes da correção. */
    dasAntigo: number;
    /** dasAntigo − dasCorreto. Positivo = estava sendo cobrado a maior. */
    diferenca: number;
}

const chaveMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Soma interna/externa do detalhamento de um mês. */
function somarDetalhe(detalhe: any): { interno: number; externo: number } {
    let interno = 0, externo = 0;
    for (const item of Object.values(detalhe || {})) {
        const valor = typeof item === 'number' ? item : Number((item as any)?.valor) || 0;
        const isExt = typeof item === 'object' && (item as any)?.isExterior === true;
        if (isExt) externo += valor; else interno += valor;
    }
    return { interno, externo };
}

/**
 * Analisa UMA empresa numa competência. Devolve null quando não há divergência
 * — o painel só deve mostrar quem foi realmente afetado.
 */
export function analisarDivergenciaBase(
    empresa: SimplesNacionalEmpresa,
    mesReferencia: Date,
): DivergenciaBase | null {
    const mensal: Record<string, number> = (empresa.faturamentoManual || {}) as any;
    const detalhado: Record<string, any> = (empresa.faturamentoMensalDetalhado || {}) as any;

    const inicio = new Date(mesReferencia.getFullYear(), mesReferencia.getMonth() - 12, 1);
    const meses: MesDivergente[] = [];
    // Reproduz a base ANTIGA: quando havia detalhamento, o mês entrava pela
    // soma dos itens (mais o que faltasse para o total) — nunca aparado.
    const totaisAntigos: Record<string, number> = {};

    for (let i = 0; i < 12; i++) {
        const d = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
        const k = chaveMes(d);
        const total = Number(mensal[k]) || 0;
        if (!detalhado[k]) { totaisAntigos[k] = total; continue; }

        const { interno, externo } = somarDetalhe(detalhado[k]);
        const soma = interno + externo;
        const faltante = Math.max(0, total - soma);
        totaisAntigos[k] = interno + faltante + externo;

        const excedente = Math.round((soma - total) * 100) / 100;
        if (total > 0 && excedente > 0.01) {
            meses.push({ competencia: k, total, detalhado: soma, excedente });
        }
    }

    if (meses.length === 0) return null;

    const rbt12Correto = Object.keys(totaisAntigos)
        .reduce((s, k) => s + (Number(mensal[k]) || 0), 0);
    const rbt12Antigo = Object.values(totaisAntigos).reduce((s, v) => s + v, 0);

    // Recalcula o DAS nas DUAS bases com o motor real. Para a base antiga,
    // clonamos a empresa com os totais mensais inflados e sem o histórico
    // detalhado (que é só o que alimentava a base) — o detalhamento da própria
    // competência é preservado, porque é ele que define anexo, ISS retido etc.
    const mesChave = chaveMes(mesReferencia);
    const clone = {
        ...empresa,
        faturamentoManual: { ...mensal, ...totaisAntigos },
        faturamentoMensalDetalhado: detalhado[mesChave]
            ? { [mesChave]: detalhado[mesChave] }
            : {},
    } as SimplesNacionalEmpresa;

    const dasCorreto = calcularResumoEmpresa(empresa, [], mesReferencia).das_mensal;
    const dasAntigo = calcularResumoEmpresa(clone, [], mesReferencia).das_mensal;

    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
        empresaId: empresa.id,
        nome: empresa.nome,
        cnpj: String(empresa.cnpj || '').replace(/\D/g, ''),
        competencia: mesChave,
        anexo: String(empresa.anexo || ''),
        rbt12Correto: r2(rbt12Correto),
        rbt12Antigo: r2(rbt12Antigo),
        excedente: r2(rbt12Antigo - rbt12Correto),
        meses,
        dasCorreto: r2(dasCorreto),
        dasAntigo: r2(dasAntigo),
        diferenca: r2(dasAntigo - dasCorreto),
    };
}

export interface ResultadoVarredura {
    competencia: string;
    total: number;
    afetadas: DivergenciaBase[];
    /** Soma das diferenças de DAS (positivo = foi cobrado a maior). */
    impactoTotal: number;
    farol: 'ok' | 'atencao';
    resumo: string;
}

/** Varre a carteira inteira e devolve só quem tem divergência, pior primeiro. */
export function varrerBasesSimples(
    empresas: SimplesNacionalEmpresa[],
    mesReferencia: Date,
): ResultadoVarredura {
    const afetadas: DivergenciaBase[] = [];
    for (const e of empresas || []) {
        try {
            const r = analisarDivergenciaBase(e, mesReferencia);
            if (r) afetadas.push(r);
        } catch {
            // Uma empresa com cadastro estranho não pode derrubar a varredura.
        }
    }
    afetadas.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca) || b.excedente - a.excedente);

    const impactoTotal = Math.round(afetadas.reduce((s, a) => s + a.diferenca, 0) * 100) / 100;
    const comImpacto = afetadas.filter((a) => Math.abs(a.diferenca) >= 0.01).length;

    return {
        competencia: chaveMes(mesReferencia),
        total: (empresas || []).length,
        afetadas,
        impactoTotal,
        farol: afetadas.length === 0 ? 'ok' : 'atencao',
        resumo: afetadas.length === 0
            ? `Nenhuma divergência de base nas ${(empresas || []).length} empresa(s) desta competência.`
            : `${afetadas.length} empresa(s) com detalhamento acima do total lançado`
              + (comImpacto > 0
                  ? ` — ${comImpacto} com DAS afetado, diferença somada de R$ ${impactoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
                  : ' — sem impacto no DAS desta competência (a faixa não mudou).'),
    };
}
