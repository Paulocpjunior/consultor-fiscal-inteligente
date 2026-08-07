// ============================================================================
// sefaz-backend/credito-acumulado.js  (PURO — testável)
// ----------------------------------------------------------------------------
// QUEM GERA CRÉDITO ACUMULADO DE ICMS EM SP — e quem só PARECE gerar.
//
// O e-CredAc (Portaria CAT 207/2009) estava 🟡 no de-para, "sob demanda". Antes
// de construir gerador de arquivo pra possivelmente NINGUÉM — foi o que os
// dados já responderam sobre o SAT, o regime de caixa, o E310 e o bloco K — a
// pergunta é: quantos clientes realmente acumulam crédito?
//
// O sinal decisivo é SALDO CREDOR RECORRENTE, e a conta dele é a MESMA do E110
// (`somarIcmsPorDirecao`, importada do gerador). Painel com conta própria
// diverge do arquivo, e aí ninguém sabe qual dos dois está certo.
//
// MAS SALDO CREDOR SOZINHO NÃO É CRÉDITO ACUMULADO — e essa é a parte que
// importa. O crédito acumulado nasce de uma HIPÓTESE LEGAL (RICMS/SP art. 71):
//
//   I   — saída com alíquota MENOR que a da entrada
//   II  — saída isenta/não tributada COM manutenção do crédito (exportação)
//   III — saída com redução de base, mantido o crédito integral
//
// Empresa que aparece credora TODO mês e não tem nenhuma dessas hipóteses
// quase sempre está com SAÍDA FALTANDO na captura — e a saída é justamente o
// lado que a SEFAZ não entrega ao emitente (Rejeição 641). Chamar isso de
// "crédito acumulado" mandaria o colaborador abrir processo no e-CredAc em
// cima de um livro incompleto. Por isso as duas situações são SEPARADAS.
//
// Só LUCRO/RPA entra: optante do Simples não apura ICMS por conta gráfica,
// logo não acumula crédito por esta via.
// ============================================================================

import { somarIcmsPorDirecao } from './sped-fiscal-blocoE.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * CST de ICMS em que a SAÍDA não gera débito. Só estes interessam:
 *   40 isenta · 41 não tributada · 50 suspensão
 * FORA de propósito: 60 (ST já retido antes) e 51 (diferimento) — nesses o
 * débito existe, só não é daquele documento, e tratá-los como "sem débito"
 * inventaria hipótese de crédito acumulado que a lei não dá.
 */
const CST_SAIDA_SEM_DEBITO = new Set(['40', '41', '50']);

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
/** CST do ICMS: os 2 últimos dígitos (o 1º é a origem da mercadoria). */
const cstIcms = (item) => soDigitos(item?.cst).slice(-2);

/**
 * HIPÓTESES do art. 71 encontradas nas notas do período.
 *
 * @param {Array} notas documentos da competência (com `itens`)
 * @returns {{exportacao:number, isentaComCredito:number, reducaoBase:number,
 *            aliqSaida:number|null, aliqEntrada:number|null, aliquotaMenor:boolean,
 *            itensLidos:number}}
 */
export function detectarHipotesesArt71(notas) {
    let exportacao = 0;
    let isentaComCredito = 0;
    let reducaoBase = 0;
    let itensLidos = 0;
    let bcSaida = 0; let icmsSaida = 0;
    let bcEntrada = 0; let icmsEntrada = 0;

    for (const n of notas || []) {
        if (n?.status !== 'autorizado') continue;
        if (!['55', '65'].includes(String(n.modelo))) continue;
        const saida = n.direcao === 'saida';
        for (const it of (n.itens || [])) {
            itensLidos += 1;
            const cfop = soDigitos(it?.cfop);
            const cst = cstIcms(it);
            const bc = num(it?.vBC);
            const icms = num(it?.vICMS);

            if (saida) {
                bcSaida += bc; icmsSaida += icms;
                // Exportação: CFOP 7xxx. É a hipótese II clássica e a mais
                // fácil de provar — não depende de ler CST direito.
                if (cfop.startsWith('7')) exportacao += 1;
                else if (CST_SAIDA_SEM_DEBITO.has(cst) && num(it?.vProd) > 0) isentaComCredito += 1;
                if (num(it?.pRedBC) > 0) reducaoBase += 1;
            } else if (n.direcao === 'entrada') {
                bcEntrada += bc; icmsEntrada += icms;
            }
        }
    }

    // Alíquota MÉDIA efetiva de cada lado. Sem base de cálculo não se divide:
    // devolve null (ausente ≠ alíquota zero, e zero aqui faria toda empresa
    // sem itens lidos parecer geradora).
    const aliqSaida = bcSaida > 0 ? r2((icmsSaida / bcSaida) * 100) : null;
    const aliqEntrada = bcEntrada > 0 ? r2((icmsEntrada / bcEntrada) * 100) : null;
    // Um ponto percentual de folga: diferença de arredondamento entre notas
    // não é "alíquota diversa" do art. 71 I.
    const aliquotaMenor = aliqSaida !== null && aliqEntrada !== null
        && aliqSaida < aliqEntrada - 1;

    return { exportacao, isentaComCredito, reducaoBase, aliqSaida, aliqEntrada, aliquotaMenor, itensLidos };
}

/**
 * Apuração SIMPLIFICADA de uma competência: débito × crédito de ICMS.
 *
 * SIMPLIFICADA porque NÃO inclui os ajustes do E111 nem o saldo credor
 * anterior — quem faz isso é o gerador do SPED. Aqui é SINAL, e a tela precisa
 * dizer isso: um ajuste grande muda o saldo e não aparece nesta conta.
 */
export function apurarCompetencia(notas) {
    const debitos = r2(somarIcmsPorDirecao(notas, 'saida'));
    const creditos = r2(somarIcmsPorDirecao(notas, 'entrada'));
    const saldo = r2(debitos - creditos);
    return {
        debitos, creditos, saldo,
        credor: saldo < 0,
        credorValor: saldo < 0 ? r2(-saldo) : 0,
        ...detectarHipotesesArt71(notas),
    };
}

/** Situações possíveis. A ordem é a de prioridade na tela. */
export const SITUACOES_CREDITO = [
    'gerador-recorrente', 'credor-sem-hipotese', 'gerador-pontual', 'credor-pontual', 'devedor', 'sem-dados',
];

const temHipotese = (c) => c.exportacao > 0 || c.isentaComCredito > 0 || c.reducaoBase > 0 || c.aliquotaMenor;

/**
 * Veredito de UMA empresa a partir das competências apuradas.
 *
 * @param {Array} competencias [{competencia, ...apurarCompetencia()}]
 */
export function classificarEmpresa(competencias) {
    const meses = (competencias || []).filter(Boolean);
    if (!meses.length) {
        return {
            situacao: 'sem-dados',
            motivo: 'Nenhuma competência com nota lida.',
            acao: 'Sem documento não se conclui nada sobre crédito acumulado — rode a captura antes.',
        };
    }
    // Mês sem NENHUM item lido não vota: a hipótese do art. 71 depende de item
    // (CFOP/CST), e ausência de item não é ausência de hipótese.
    const comItens = meses.filter((m) => m.itensLidos > 0);
    const credores = meses.filter((m) => m.credor);
    const comHipotese = comItens.filter(temHipotese);
    const credorValor = r2(credores.reduce((t, m) => t + m.credorValor, 0));

    const recorrente = credores.length >= 2;
    const hipotese = comHipotese.length > 0;

    if (recorrente && hipotese) {
        return {
            situacao: 'gerador-recorrente',
            motivo: `Saldo CREDOR em ${credores.length} de ${meses.length} competência(s), com hipótese do art. 71 nas notas.`,
            acao: 'Candidata real ao e-CredAc: o crédito se acumula e há evento gerador. Avalie abrir o processo de apropriação na SEFAZ.',
            credorValor,
        };
    }
    if (recorrente && !hipotese) {
        // O achado que mais importa: credor todo mês SEM hipótese legal quase
        // sempre é SAÍDA FALTANDO — e saída é justamente o lado que a SEFAZ
        // não entrega ao emitente (Rejeição 641).
        return {
            situacao: 'credor-sem-hipotese',
            motivo: `Saldo CREDOR em ${credores.length} de ${meses.length} competência(s), mas NENHUMA hipótese do art. 71 nas notas.`,
            acao: 'Isso quase nunca é crédito acumulado — é SAÍDA FALTANDO na captura (a SEFAZ não entrega a saída ao emitente). '
                + 'Confira a Cobertura de Saída antes de concluir qualquer coisa.',
            credorValor,
        };
    }
    if (hipotese && credores.length === 1) {
        return {
            situacao: 'gerador-pontual',
            motivo: 'Saldo credor em uma competência, com hipótese do art. 71.',
            acao: 'Um mês só não caracteriza acúmulo — acompanhe as próximas competências.',
            credorValor,
        };
    }
    if (credores.length === 1) {
        return {
            situacao: 'credor-pontual',
            motivo: 'Saldo credor em uma competência, sem hipótese do art. 71.',
            acao: 'Pode ser compra grande no mês ou saída não capturada — não é crédito acumulado.',
            credorValor,
        };
    }
    return {
        situacao: 'devedor',
        motivo: `Saldo devedor em todas as ${meses.length} competência(s) lidas.`,
        acao: null,
        credorValor: 0,
    };
}

const PESO = Object.fromEntries(SITUACOES_CREDITO.map((s, i) => [s, i]));

/**
 * O painel da carteira.
 *
 * @param {Array} empresas  [{empresaId, nome, cnpj, regime}]
 * @param {Map|object} notasPorEmpresaCompetencia  empresaId → {competencia: notas[]}
 */
export function montarPainelCreditoAcumulado(empresas, notasPorEmpresaCompetencia) {
    const ler = (id) => {
        const f = notasPorEmpresaCompetencia;
        if (!f) return {};
        return (typeof f.get === 'function' ? f.get(id) : f[id]) || {};
    };

    const linhas = [];
    for (const e of empresas || []) {
        // Optante do Simples não apura ICMS por conta gráfica — não acumula
        // crédito por esta via, e listá-lo encheria a tela de falso alvo.
        if (String(e.regime || '').toLowerCase() === 'simples') continue;

        const porComp = ler(e.empresaId || e.id);
        const competencias = Object.keys(porComp).sort()
            .map((c) => ({ competencia: c, ...apurarCompetencia(porComp[c]) }));
        const veredito = classificarEmpresa(competencias);
        linhas.push({ ...e, competencias, ...veredito });
    }

    linhas.sort((a, b) => (PESO[a.situacao] - PESO[b.situacao])
        || (b.credorValor || 0) - (a.credorValor || 0)
        || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    const conta = (s) => linhas.filter((l) => l.situacao === s).length;
    const resumo = {
        empresas: linhas.length,
        geradorRecorrente: conta('gerador-recorrente'),
        credorSemHipotese: conta('credor-sem-hipotese'),
        geradorPontual: conta('gerador-pontual'),
        credorPontual: conta('credor-pontual'),
        devedor: conta('devedor'),
        semDados: conta('sem-dados'),
    };

    return { linhas, resumo, avisos: avisosDoPainel(resumo) };
}

function avisosDoPainel(r) {
    const avisos = [
        'Esta conta é um SINAL, não a apuração: ela soma o ICMS das notas e NÃO inclui os ajustes do E111 '
        + 'nem o saldo credor de meses anteriores. Um ajuste grande muda o saldo e não aparece aqui.',
    ];
    if (r.geradorRecorrente === 0) {
        // Resposta de F0: zero cliente = o e-CredAc é descartável como o SAT.
        avisos.push(
            'NENHUMA empresa com acúmulo recorrente E hipótese do art. 71 nas competências lidas — '
            + 'pelo que os dados mostram, construir o arquivo do e-CredAc não atende ninguém hoje. '
            + 'Rode mais competências antes de concluir: mês atípico esconde sinal.',
        );
    } else {
        avisos.push(
            `${r.geradorRecorrente} empresa(s) com acúmulo recorrente E hipótese legal — são estas, nomeadas, que justificam o e-CredAc.`,
        );
    }
    if (r.credorSemHipotese > 0) {
        avisos.push(
            `🚨 ${r.credorSemHipotese} empresa(s) aparecem CREDORAS todo mês SEM nenhuma hipótese do art. 71. `
            + 'Isso quase nunca é crédito acumulado: é saída faltando na captura. Confira a Cobertura de Saída.',
        );
    }
    return avisos;
}
