import { aliquotasReformaPorAno } from './reformaTributariaConfig';

export type AtividadeTipo = 'comercio' | 'industria' | 'servicos_simples' | 'servicos_fator_r' | 'servicos_especiais' | 'servicos_gerais';
export type RegimeTipo = 'simples' | 'presumido' | 'real';

export interface EntradaCalculo {
    receitaBrutaMensal: number;
    receitaBrutaAcumulada12: number;
    folhaPagamentoMensal: number;
    custosMercadorias: number;
    despesasDedutiveis: number;
    /**
     * Base de credito PIS/COFINS (despesas que geram credito - Lei 10.637/02 art. 3
     * e Lei 10.833/03 art. 3). Importante: NAO incluir folha (vedacao art. 3 §2 I).
     * Se o front estiver passando o VALOR ja calculado (pratica antiga), divida
     * por 9,25% antes — manter consistencia com a planilha do escritorio.
     */
    creditosPisCofins: number;
    atividade: AtividadeTipo;
    issAliquota: number;
    /**
     * Aliquota interna de ICMS em % (ex: 18 para SP padrao, 7 para alimentos basicos,
     * 12 para alguns setores). Se nao informada, assume 18% (default SP). Antes era
     * fixo em 12% no codigo — viesava o comparador.
     */
    icmsAliquota?: number;
    temImportacao: boolean;
}

export interface ResultadoRegime {
    regime: RegimeTipo;
    label: string;
    impostoMensal: number;
    aliquotaEfetiva: number;
    detalhamento: Record<string, number>;
    observacoes: string[];
    recomendado?: boolean;
}

export interface ResultadoAnalise {
    resultados: ResultadoRegime[];
    melhorOpcao: RegimeTipo;
    economiaAnual: number;
    percentualEconomia: number;
    alertas: string[];
}

// Tabelas Simples Nacional (LC 123/2006 Anexos I-V) — atualizadas LC 155/2016
const AI = [{ l: 180000, a: 4.00, pd: 0 }, { l: 360000, a: 7.30, pd: 5940 }, { l: 720000, a: 9.50, pd: 13860 }, { l: 1800000, a: 10.70, pd: 22500 }, { l: 3600000, a: 14.30, pd: 87300 }, { l: 4800000, a: 19.00, pd: 378000 }];
const AII = [{ l: 180000, a: 4.50, pd: 0 }, { l: 360000, a: 7.80, pd: 5940 }, { l: 720000, a: 10.00, pd: 13860 }, { l: 1800000, a: 11.20, pd: 22500 }, { l: 3600000, a: 14.70, pd: 85500 }, { l: 4800000, a: 30.00, pd: 720000 }];
const AIII = [{ l: 180000, a: 6.00, pd: 0 }, { l: 360000, a: 11.20, pd: 9360 }, { l: 720000, a: 13.50, pd: 17640 }, { l: 1800000, a: 16.00, pd: 35640 }, { l: 3600000, a: 21.00, pd: 125640 }, { l: 4800000, a: 33.00, pd: 648000 }];
const AIV = [{ l: 180000, a: 4.50, pd: 0 }, { l: 360000, a: 9.00, pd: 8100 }, { l: 720000, a: 10.20, pd: 12420 }, { l: 1800000, a: 14.00, pd: 39780 }, { l: 3600000, a: 22.00, pd: 183780 }, { l: 4800000, a: 33.00, pd: 828000 }];
const AV = [{ l: 180000, a: 15.50, pd: 0 }, { l: 360000, a: 18.00, pd: 4500 }, { l: 720000, a: 19.50, pd: 9900 }, { l: 1800000, a: 20.50, pd: 17100 }, { l: 3600000, a: 23.00, pd: 62100 }, { l: 4800000, a: 30.50, pd: 540000 }];

const PIRPJ: Record<AtividadeTipo, number> = { comercio: .08, industria: .08, servicos_simples: .32, servicos_fator_r: .32, servicos_especiais: .32, servicos_gerais: .32 };
const PCSLL: Record<AtividadeTipo, number> = { comercio: .12, industria: .12, servicos_simples: .32, servicos_fator_r: .32, servicos_especiais: .32, servicos_gerais: .32 };

const SERVICOS: ReadonlySet<AtividadeTipo> = new Set(['servicos_simples', 'servicos_fator_r', 'servicos_especiais', 'servicos_gerais']);
const ICMS_ALIQUOTA_DEFAULT = 0.18;   // SP padrao - antes era 0.12 hardcoded (errado)

function tabela(a: AtividadeTipo, f: number, rba: number) {
    if (a === 'comercio') return { tab: AI, obs: [] };
    if (a === 'industria') return { tab: AII, obs: [] };
    if (a === 'servicos_simples') return { tab: AIII, obs: [] };
    if (a === 'servicos_gerais') return { tab: AIV, obs: [] };
    const fr = (f * 12) / Math.max(rba, 1);
    if (fr >= .28) return { tab: AIII, obs: [`Fator R=${(fr * 100).toFixed(1)}% >= 28% -> Anexo III`] };
    return { tab: AV, obs: [`Fator R=${(fr * 100).toFixed(1)}% < 28% -> Anexo V`] };
}

function alqEf(rba: number, tab: { l: number; a: number; pd: number }[]) {
    const fx = tab.find(f => rba <= f.l) || tab[tab.length - 1];
    const f0 = tab[0];
    if (!fx || !f0) return 0;
    if (fx.pd === 0 && fx.a === f0.a) return fx.a / 100;
    return (rba * (fx.a / 100) - fx.pd) / rba;
}

export function calcularSimples(e: EntradaCalculo): ResultadoRegime {
    if (e.receitaBrutaAcumulada12 > 4800000) {
        return { regime: 'simples', label: 'Simples Nacional', impostoMensal: 0, aliquotaEfetiva: 0, detalhamento: {}, observacoes: ['Receita acima do limite de R$ 4,8M. Vedado ao Simples.'], recomendado: false };
    }
    const { tab, obs } = tabela(e.atividade, e.folhaPagamentoMensal, e.receitaBrutaAcumulada12);
    const ae = alqEf(e.receitaBrutaAcumulada12, tab);
    const das = e.receitaBrutaMensal * ae;
    return { regime: 'simples', label: 'Simples Nacional', impostoMensal: das, aliquotaEfetiva: ae * 100, detalhamento: { 'DAS (unificado)': das }, observacoes: obs };
}

export function calcularLucroPresumido(e: EntradaCalculo): ResultadoRegime {
    const bI = e.receitaBrutaMensal * PIRPJ[e.atividade];
    const bC = e.receitaBrutaMensal * PCSLL[e.atividade];
    const irpj = bI * .15;
    const adicIRPJ = Math.max(0, bI - 20000) * .10;
    const csll = bC * .09;
    const pis = e.receitaBrutaMensal * .0065;
    const cofins = e.receitaBrutaMensal * .03;
    const isServico = SERVICOS.has(e.atividade);
    const iss = isServico ? e.receitaBrutaMensal * (e.issAliquota / 100) : 0;
    const icmsAliq = (e.icmsAliquota !== undefined && e.icmsAliquota > 0) ? e.icmsAliquota / 100 : ICMS_ALIQUOTA_DEFAULT;
    const icms = isServico ? 0 : e.receitaBrutaMensal * icmsAliq;
    const total = irpj + adicIRPJ + csll + pis + cofins + iss + icms;
    return {
        regime: 'presumido',
        label: 'Lucro Presumido',
        impostoMensal: total,
        aliquotaEfetiva: (total / e.receitaBrutaMensal) * 100,
        detalhamento: {
            'IRPJ 15%': irpj,
            'IRPJ Adicional 10%': adicIRPJ,
            'CSLL 9%': csll,
            'PIS 0,65%': pis,
            'COFINS 3%': cofins,
            ...(iss > 0 ? { ['ISS ' + e.issAliquota + '%']: iss } : {}),
            ...(icms > 0 ? { [`ICMS ${(icmsAliq * 100).toFixed(1)}%`]: icms } : {}),
        },
        observacoes: isServico ? [] : (e.icmsAliquota === undefined ? ['ICMS aplicado a aliquota padrao SP (18%). Configure aliquota real do estado/produto.'] : []),
    };
}

export function calcularLucroReal(e: EntradaCalculo): ResultadoRegime {
    const lucro = e.receitaBrutaMensal - e.custosMercadorias - e.despesasDedutiveis - e.folhaPagamentoMensal;
    const irpj = lucro > 0 ? lucro * .15 : 0;
    const adicIRPJ = lucro > 0 ? Math.max(0, lucro - 20000) * .10 : 0;
    const csll = lucro > 0 ? lucro * .09 : 0;
    // PIS/COFINS nao-cumulativo: receita*aliquota - baseCredito*aliquota.
    // Se o front passar `creditosPisCofins` como VALOR ja calculado (pratica antiga
    // do escritorio), aplicar a particao 17.9%/82.1% reproduz o valor por imposto.
    // Se passar como BASE (interpretacao moderna), seria multiplicar direto pela
    // aliquota. Mantemos a particao por compat — a soma final eh identica nos dois
    // casos (PIS+COFINS=9,25% e 17,9%+82,1%=100%).
    const pis = Math.max(0, e.receitaBrutaMensal * .0165 - e.creditosPisCofins * .179);
    const cofins = Math.max(0, e.receitaBrutaMensal * .076 - e.creditosPisCofins * .821);
    const isServico = SERVICOS.has(e.atividade);
    const iss = isServico ? e.receitaBrutaMensal * (e.issAliquota / 100) : 0;
    const icmsAliq = (e.icmsAliquota !== undefined && e.icmsAliquota > 0) ? e.icmsAliquota / 100 : ICMS_ALIQUOTA_DEFAULT;
    const icms = isServico ? 0 : e.receitaBrutaMensal * icmsAliq;
    const total = irpj + adicIRPJ + csll + pis + cofins + iss + icms;
    return {
        regime: 'real',
        label: 'Lucro Real',
        impostoMensal: total,
        aliquotaEfetiva: (total / e.receitaBrutaMensal) * 100,
        detalhamento: {
            'IRPJ 15%': irpj,
            'IRPJ Adicional 10%': adicIRPJ,
            'CSLL 9%': csll,
            'PIS ncum 1,65%': pis,
            'COFINS ncum 7,6%': cofins,
            ...(iss > 0 ? { ['ISS ' + e.issAliquota + '%']: iss } : {}),
            ...(icms > 0 ? { [`ICMS ${(icmsAliq * 100).toFixed(1)}%`]: icms } : {}),
        },
        observacoes: lucro <= 0 ? ['Prejuizo: IRPJ/CSLL zerados.'] : [],
    };
}

export function analisarRegimes(e: EntradaCalculo): ResultadoAnalise {
    const s = calcularSimples(e), p = calcularLucroPresumido(e), r = calcularLucroReal(e);
    const todos = [s, p, r].filter(x => x.impostoMensal > 0);
    todos.sort((a, b) => a.impostoMensal - b.impostoMensal);
    if (todos[0]) todos[0].recomendado = true;
    const melhor = todos[0], pior = todos[todos.length - 1];
    const econAno = pior && melhor ? (pior.impostoMensal - melhor.impostoMensal) * 12 : 0;
    const econPct = pior && melhor && pior.impostoMensal > 0 ? ((pior.impostoMensal - melhor.impostoMensal) / pior.impostoMensal) * 100 : 0;

    // Alertas de faturamento — LC 123/2006. Antes era um unico alerta confuso
    // que disparava em R$ 3,6M mas dizia "proximo ao limite de R$ 4,8M",
    // misturando sublimite ICMS/ISS (art. 13-A) com limite federal (art. 3º II).
    // Agora cada threshold gera o alerta correto, em ordem de gravidade.
    const alertas: string[] = [];
    const rbt = e.receitaBrutaAcumulada12;

    if (rbt > 5_760_000) {
        alertas.push('Receita ultrapassou em mais de 20% o limite Simples (R$ 5,76M). DESENQUADRAMENTO RETROATIVO ao mes seguinte do excesso (LC 123 art. 30 §1º II) — comunicar a Receita ate o ultimo dia util do mes seguinte.');
    } else if (rbt > 4_800_000) {
        alertas.push('Receita ultrapassou o limite federal do Simples Nacional (R$ 4,8M). Empresa vedada ao Simples (LC 123 art. 3º II); desenquadramento a partir do ano seguinte. Planeje migracao para Lucro Presumido/Real.');
    } else if (rbt > 4_320_000) {
        alertas.push('Receita acumulada em 12 meses se aproxima do limite federal do Simples (R$ 4,8M). Planeje migracao para Lucro Presumido/Real.');
    }

    if (rbt > 3_600_000 && rbt <= 4_800_000) {
        alertas.push('Receita ultrapassou sublimite estadual de ICMS/ISS (R$ 3,6M). ICMS e ISS deverao ser apurados FORA do DAS (LC 123 art. 13-A); demais tributos seguem no Simples.');
    }

    if (e.folhaPagamentoMensal / e.receitaBrutaMensal < 0.20 &&
        (e.atividade === 'servicos_especiais' || e.atividade === 'servicos_fator_r')) {
        alertas.push('Folha baixa para servicos — verifique Fator R.');
    }

    // Alerta de Reforma Tributaria (LC 214/2025) por ano corrente.
    const reforma = aliquotasReformaPorAno(new Date().getFullYear());
    if (reforma.fase === 'teste-2026') {
        alertas.push('REFORMA TRIBUTARIA - fase de teste 2026: CBS 0,9% + IBS 0,1% compensados com PIS/COFINS. Registro obrigatorio mesmo com debito liquido zero.');
    } else if (reforma.fase === 'cbs-2027') {
        alertas.push('REFORMA TRIBUTARIA - 2027: PIS/COFINS EXTINTOS, CBS plena (~8,8%). Recalcule projecoes - regime tributario pode mudar.');
    } else if (reforma.fase === 'transicao-ibs') {
        alertas.push(`REFORMA TRIBUTARIA - transicao IBS ano ${reforma.ano}: ICMS/ISS a ${(reforma.fatorIcmsIss * 100).toFixed(0)}% da aliquota original; IBS subindo proporcionalmente.`);
    }

    return { resultados: todos, melhorOpcao: melhor?.regime || 'presumido', economiaAnual: econAno, percentualEconomia: econPct, alertas };
}
