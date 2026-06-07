/**
 * sefaz-backend/calendario-obrigacoes.js
 *
 * Calendario fiscal completo brasileiro — federal, estadual SP, municipal SP.
 *
 * Datas conforme legislacao vigente em 2026 (RFB, SEFAZ-SP, Prefeitura SP).
 * Sempre confirme no calendario oficial de cada orgao.
 *
 * Regras de ajuste de vencimento:
 *   - Quando o dia cai em sabado/domingo, a regra padrao do RFB e POSTERGAR
 *     para o proximo dia util. Algumas obrigacoes (notadamente DAS Simples e
 *     algumas guias estaduais) ANTECIPAM para o ultimo dia util anterior.
 *     Default deste modulo: postergar (mais seguro contra multa por atraso).
 *
 *   - Para DAS Simples, FGTS, INSS, eSocial: postergar para proximo dia util
 *     conforme art. 38 da Resolucao CGSN 140/2018 e regras analogas RFB.
 *
 *   - Feriados nacionais nao sao considerados (apenas sabados e domingos).
 *     Para feriados oficiais, consulte calendario da RFB/SEFAZ/Prefeitura.
 */

// ─── Catalogo completo de obrigacoes ─────────────────────────────────────
//
// Campos:
//   tipo: string usado pra agrupar/filtrar no frontend (icone, cor).
//   nome: descricao curta humana.
//   diaVencimento: numero fixo OU 'ultimo_dia_util' OU 'cnae_final'
//     (este ultimo usa diaVencimentoPorCnae).
//   diaVencimentoPorCnae: { '0-3': 16, '4-7': 21, '8-9': 26 } para GIA SP etc.
//   mesesApos: 1 = mes seguinte ao periodo, 2 = 2o mes seguinte.
//   periodicidade: 'mensal' (default), 'trimestral', 'anual'.
//   mesAplicavel: para anuais (1=jan,...,12=dez).
//   mesesAplicaveis: para trimestrais.
//   regimes: array de regimes elegiveis ('simples','mei','lucro_presumido',
//     'lucro_real','pessoa_fisica').
//   regimeLabel: string mostrada no frontend.
//   requireFolha: true => so empresa com folha12 > 0.
//   requireICMS: true => so empresas industriais/comerciais (nao puramente
//     servicos). Heuristica via dadosFiscais.naturezaAtividade.
//   requireISS: true => so empresas com servicos.
//   requireUF: 'SP' => so empresas no UF informado.
//   requireMunicipioIBGE: '3550308' => so empresas no municipio IBGE.
//   descricaoTemplate: usa {COMP}, {ANO}, {ANO_ANTERIOR}, {TRIMESTRE}.
//
const OBRIGACOES = {
    // ─── FEDERAIS MENSAIS ────────────────────────────────────────────────
    DAS_SIMPLES: {
        tipo: 'DAS',
        nome: 'DAS Simples Nacional',
        diaVencimento: 20,
        mesesApos: 1,
        regimes: ['simples'],
        regimeLabel: 'Simples',
        descricaoTemplate: 'DAS Simples Nacional - ref. {COMP}',
    },
    DAS_MEI: {
        tipo: 'DAS-MEI',
        nome: 'DAS MEI',
        diaVencimento: 20,
        mesesApos: 1,
        regimes: ['mei'],
        regimeLabel: 'MEI',
        descricaoTemplate: 'DAS-MEI - ref. {COMP}',
    },
    INSS_PATRONAL: {
        tipo: 'INSS',
        nome: 'INSS Patronal',
        diaVencimento: 20,
        mesesApos: 1,
        regimes: ['simples', 'lucro_presumido', 'lucro_real'],
        regimeLabel: 'Federal',
        requireFolha: true,
        descricaoTemplate: 'INSS Patronal - ref. {COMP}',
    },
    FGTS: {
        tipo: 'FGTS',
        nome: 'FGTS Digital',
        diaVencimento: 20,
        mesesApos: 1,
        regimes: ['simples', 'lucro_presumido', 'lucro_real'],
        regimeLabel: 'Federal',
        requireFolha: true,
        descricaoTemplate: 'FGTS Digital - ref. {COMP}',
    },
    DCTFWEB: {
        tipo: 'DCTFWEB',
        nome: 'DCTFWeb',
        diaVencimento: 15,
        mesesApos: 1,
        regimes: ['simples', 'lucro_presumido', 'lucro_real'],
        regimeLabel: 'Federal',
        requireFolha: true,
        descricaoTemplate: 'DCTFWeb - ref. {COMP}',
    },
    ESOCIAL_S1299: {
        tipo: 'ESOCIAL',
        nome: 'eSocial - Fechamento (S-1299)',
        diaVencimento: 15,
        mesesApos: 1,
        regimes: ['simples', 'lucro_presumido', 'lucro_real'],
        regimeLabel: 'Federal',
        requireFolha: true,
        descricaoTemplate: 'eSocial S-1299 (fechamento) - ref. {COMP}',
    },
    EFD_REINF: {
        tipo: 'EFD-REINF',
        nome: 'EFD-Reinf',
        diaVencimento: 15,
        mesesApos: 1,
        regimes: ['simples', 'lucro_presumido', 'lucro_real'],
        regimeLabel: 'Federal',
        descricaoTemplate: 'EFD-Reinf - ref. {COMP}',
    },
    IRRF_PJ: {
        tipo: 'IRRF',
        nome: 'IRRF (pagamentos a PJ)',
        diaVencimento: 20,
        mesesApos: 1,
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Federal',
        descricaoTemplate: 'DARF IRRF s/ pagamentos PJ - ref. {COMP}',
    },
    PIS_COFINS_CUMULATIVO: {
        tipo: 'PIS-COFINS',
        nome: 'PIS/COFINS Cumulativo',
        diaVencimento: 25,
        mesesApos: 1,
        regimes: ['lucro_presumido'],
        regimeLabel: 'Lucro Presumido',
        descricaoTemplate: 'DARF PIS/COFINS Cumulativo - ref. {COMP}',
    },
    PIS_COFINS_NAO_CUMULATIVO: {
        tipo: 'PIS-COFINS',
        nome: 'PIS/COFINS Nao-Cumulativo',
        diaVencimento: 25,
        mesesApos: 1,
        regimes: ['lucro_real'],
        regimeLabel: 'Lucro Real',
        descricaoTemplate: 'DARF PIS/COFINS Nao-Cumulativo - ref. {COMP}',
    },

    // ─── FEDERAIS TRIMESTRAIS ────────────────────────────────────────────
    IRPJ_TRIMESTRAL: {
        tipo: 'DARF-IRPJ',
        nome: 'IRPJ Trimestral',
        diaVencimento: 'ultimo_dia_util',
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Trimestral',
        periodicidade: 'trimestral',
        // Mes de VENCIMENTO (mes seguinte ao encerramento do trimestre).
        // T1 fecha mar -> vence em abr; T2 fecha jun -> vence em jul;
        // T3 fecha set -> vence em out; T4 fecha dez -> vence em jan.
        mesesAplicaveis: [4, 7, 10, 1],
        descricaoTemplate: 'DARF IRPJ - T{TRIMESTRE}/{ANO_TRIM}',
    },
    CSLL_TRIMESTRAL: {
        tipo: 'DARF-CSLL',
        nome: 'CSLL Trimestral',
        diaVencimento: 'ultimo_dia_util',
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Trimestral',
        periodicidade: 'trimestral',
        mesesAplicaveis: [4, 7, 10, 1],
        descricaoTemplate: 'DARF CSLL - T{TRIMESTRE}/{ANO_TRIM}',
    },

    // ─── FEDERAIS ANUAIS ─────────────────────────────────────────────────
    DEFIS: {
        tipo: 'DEFIS',
        nome: 'DEFIS - Declaracao Anual Simples',
        diaVencimento: 31,
        mesAplicavel: 3, // 31 de marco
        regimes: ['simples'],
        regimeLabel: 'Simples',
        periodicidade: 'anual',
        descricaoTemplate: 'DEFIS - ano-base {ANO_ANTERIOR}',
    },
    DASN_SIMEI: {
        tipo: 'DASN-SIMEI',
        nome: 'DASN-SIMEI (MEI)',
        diaVencimento: 31,
        mesAplicavel: 5, // 31 de maio
        regimes: ['mei'],
        regimeLabel: 'MEI',
        periodicidade: 'anual',
        descricaoTemplate: 'DASN-SIMEI - ano-base {ANO_ANTERIOR}',
    },
    ECD: {
        tipo: 'ECD',
        nome: 'ECD - Escrituracao Contabil Digital',
        diaVencimento: 'ultimo_dia_util',
        mesAplicavel: 5, // ultimo dia util de maio
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Federal',
        periodicidade: 'anual',
        descricaoTemplate: 'ECD - ano-base {ANO_ANTERIOR}',
    },
    ECF: {
        tipo: 'ECF',
        nome: 'ECF - Escrituracao Contabil Fiscal',
        diaVencimento: 'ultimo_dia_util',
        mesAplicavel: 7, // ultimo dia util de julho
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Federal',
        periodicidade: 'anual',
        descricaoTemplate: 'ECF - ano-base {ANO_ANTERIOR}',
    },
    DIRF: {
        tipo: 'DIRF',
        nome: 'DIRF',
        diaVencimento: 'ultimo_dia_util',
        mesAplicavel: 2, // ultimo dia util de fevereiro
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Federal',
        periodicidade: 'anual',
        descricaoTemplate: 'DIRF - ano-base {ANO_ANTERIOR}',
    },
    DIRPF: {
        tipo: 'DIRPF',
        nome: 'Declaracao Imposto de Renda Pessoa Fisica',
        diaVencimento: 31,
        mesAplicavel: 5, // 31 de maio
        regimes: ['pessoa_fisica'],
        regimeLabel: 'Pessoa Fisica',
        periodicidade: 'anual',
        descricaoTemplate: 'DIRPF - ano-base {ANO_ANTERIOR}',
    },

    // ─── SPED ────────────────────────────────────────────────────────────
    SPED_FISCAL: {
        tipo: 'SPED-FISCAL',
        nome: 'SPED Fiscal (EFD ICMS/IPI)',
        diaVencimento: 25,
        mesesApos: 1, // dia 25 do mes seguinte (SP)
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Estadual',
        requireICMS: true,
        descricaoTemplate: 'SPED Fiscal (EFD ICMS/IPI) - ref. {COMP}',
    },
    SPED_CONTRIBUICOES: {
        tipo: 'SPED-CONTRIB',
        nome: 'SPED Contribuicoes (EFD PIS/COFINS)',
        diaVencimento: 14,
        mesesApos: 2, // dia 14 do 2o mes seguinte
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Federal',
        descricaoTemplate: 'SPED Contribuicoes (EFD PIS/COFINS) - ref. {COMP}',
    },

    // ─── ESTADUAIS SP ────────────────────────────────────────────────────
    GIA_SP: {
        tipo: 'GIA',
        nome: 'GIA SP - Guia de Informacao ICMS',
        diaVencimento: 'cnae_final',
        diaVencimentoPorCnae: { '0-3': 16, '4-7': 21, '8-9': 26 },
        mesesApos: 1,
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Estadual SP',
        requireICMS: true,
        requireUF: 'SP',
        descricaoTemplate: 'GIA SP - ref. {COMP}',
    },
    ICMS_SP: {
        tipo: 'ICMS',
        nome: 'ICMS SP (RPA)',
        diaVencimento: 'cnae_final',
        diaVencimentoPorCnae: { '0-3': 16, '4-7': 21, '8-9': 26 },
        mesesApos: 1,
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Estadual SP',
        requireICMS: true,
        requireUF: 'SP',
        descricaoTemplate: 'ICMS SP (RPA) - ref. {COMP}',
    },
    ICMS_ST_SP: {
        tipo: 'ICMS-ST',
        nome: 'ICMS-ST SP',
        diaVencimento: 9,
        mesesApos: 1,
        regimes: ['lucro_presumido', 'lucro_real'],
        regimeLabel: 'Estadual SP',
        requireICMS: true,
        requireUF: 'SP',
        descricaoTemplate: 'ICMS-ST SP - ref. {COMP}',
    },
    DESTDA: {
        tipo: 'DESTDA',
        nome: 'DeSTDA (Substituicao Tributaria)',
        diaVencimento: 28,
        mesesApos: 1,
        regimes: ['simples'],
        regimeLabel: 'Estadual',
        requireICMS: true,
        descricaoTemplate: 'DeSTDA - ref. {COMP}',
    },

    // ─── MUNICIPAIS SP (capital — codMunIBGE 3550308) ───────────────────
    ISS_SP: {
        tipo: 'ISS',
        nome: 'ISS Sao Paulo',
        diaVencimento: 10,
        mesesApos: 1,
        regimes: ['simples', 'lucro_presumido', 'lucro_real'],
        regimeLabel: 'Municipal SP',
        requireISS: true,
        requireUF: 'SP',
        requireMunicipioIBGE: '3550308',
        descricaoTemplate: 'ISS SP - ref. {COMP}',
    },
    DMS_SP: {
        tipo: 'DMS',
        nome: 'DMS - Declaracao Mensal Servicos SP',
        diaVencimento: 10,
        mesesApos: 1,
        regimes: ['simples', 'lucro_presumido', 'lucro_real'],
        regimeLabel: 'Municipal SP',
        requireISS: true,
        requireUF: 'SP',
        requireMunicipioIBGE: '3550308',
        descricaoTemplate: 'DMS SP - ref. {COMP}',
    },
};

// ─── Helpers de data ─────────────────────────────────────────────────────

function ultimoDiaMes(ano, mes) {
    // mes: 1-12
    return new Date(ano, mes, 0).getDate();
}

import { ehDiaUtil } from './feriados-nacionais.js';

/**
 * Recebe ano/mes (1-12)/dia e devolve string YYYY-MM-DD ajustada para o
 * proximo dia util quando a data cai em sabado/domingo/feriado nacional.
 * Default fiscal: POSTERGAR (mais seguro - regra CGSN/RFB pra DAS/DCTFWeb/etc).
 */
export function ajustarDiaUtil(ano, mes, dia, modo = 'postergar') {
    let d = new Date(ano, mes - 1, dia);
    const passo = modo === 'antecipar' ? -1 : 1;
    while (!ehDiaUtil(d)) {
        d.setDate(d.getDate() + passo);
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function calcularUltimoDiaUtil(ano, mes) {
    return ajustarDiaUtil(ano, mes, ultimoDiaMes(ano, mes), 'antecipar');
}

/**
 * Dia base a partir da regra (mes/dia da obrigacao). Retorna o dia bruto
 * (1-31) sem ajuste de fim de semana, ou null se nao se aplica.
 */
function diaBruto(regra, cnae) {
    if (regra.diaVencimento === 'cnae_final') {
        const ultimoDigito = String(cnae || '').replace(/\D/g, '').slice(-1);
        const n = parseInt(ultimoDigito, 10);
        if (Number.isNaN(n)) {
            // CNAE invalido/ausente => assume dia mais tardio (26)
            return 26;
        }
        if (n <= 3) return regra.diaVencimentoPorCnae?.['0-3'] || 16;
        if (n <= 7) return regra.diaVencimentoPorCnae?.['4-7'] || 21;
        return regra.diaVencimentoPorCnae?.['8-9'] || 26;
    }
    if (typeof regra.diaVencimento === 'number') {
        return regra.diaVencimento;
    }
    return null;
}

export function calcularVencimentoMensal(ano, mes, regra, cnae) {
    if (regra.diaVencimento === 'ultimo_dia_util') {
        return calcularUltimoDiaUtil(ano, mes);
    }
    const dia = diaBruto(regra, cnae);
    if (dia === null) return null;
    const diaSeguro = Math.min(dia, ultimoDiaMes(ano, mes));
    return ajustarDiaUtil(ano, mes, diaSeguro, 'postergar');
}

export function calcularVencimentoAnual(ano, regra) {
    if (!regra.mesAplicavel) return null;
    if (regra.diaVencimento === 'ultimo_dia_util') {
        return calcularUltimoDiaUtil(ano, regra.mesAplicavel);
    }
    const dia = typeof regra.diaVencimento === 'number' ? regra.diaVencimento : 31;
    const diaSeguro = Math.min(dia, ultimoDiaMes(ano, regra.mesAplicavel));
    return ajustarDiaUtil(ano, regra.mesAplicavel, diaSeguro, 'postergar');
}

/**
 * Dado o mes de VENCIMENTO da DARF trimestral (4=abr,7=jul,10=out,1=jan),
 * devolve o trimestre encerrado anterior (1,2,3,4).
 */
export function trimestreEncerrado(mes) {
    const map = { 4: 1, 7: 2, 10: 3, 1: 4 };
    return map[mes] || null;
}

/**
 * Dado o ano/mes de vencimento e quantos meses antes esta a competencia,
 * devolve { refMes, refAno } da competencia referenciada.
 */
export function competenciaAnterior(ano, mes, mesesApos = 1) {
    let refMes = mes - mesesApos;
    let refAno = ano;
    while (refMes <= 0) {
        refMes += 12;
        refAno -= 1;
    }
    return { refMes, refAno };
}

function formatComp(refMes, refAno) {
    return `${String(refMes).padStart(2, '0')}/${refAno}`;
}

function aplicarTemplate(template, vars) {
    let out = template;
    for (const [k, v] of Object.entries(vars)) {
        out = out.replaceAll(`{${k}}`, String(v));
    }
    return out;
}

// ─── Heuristica de atividade ─────────────────────────────────────────────
//
// Decide se a empresa tem ICMS (industria/comercio) ou ISS (servicos).
// Fontes de informacao, em ordem de prioridade:
//   1. empresa.tiposAtividade { comercio, industria, servico } (Lucro)
//   2. empresa.dadosFiscais.naturezaAtividade
//   3. empresa.dadosFiscais.indAtividade
//   4. fallback: MEI/Simples assume servicos+comercio; Lucro assume ambos
//
function temAtividadeICMS(empresa, regimeKind) {
    const tipos = empresa.tiposAtividade;
    if (tipos && typeof tipos === 'object') {
        return !!(tipos.comercio || tipos.industria);
    }
    const nat = empresa.dadosFiscais?.naturezaAtividade;
    if (nat) return nat === 'comercio' || nat === 'industria' || nat === 'misto';
    const ind = empresa.dadosFiscais?.indAtividade;
    if (ind === 'industrial') return true;
    if (ind === 'outras') {
        // 'outras' inclui comercio + servicos => assume ICMS aplicavel
        return true;
    }
    // Sem info: para MEI assume nao tem ICMS por padrao;
    // para Simples/Lucro assume que tem (mais seguro mostrar e filtrar manual).
    return regimeKind !== 'mei';
}

function temAtividadeISS(empresa, regimeKind) {
    const tipos = empresa.tiposAtividade;
    if (tipos && typeof tipos === 'object') {
        return !!tipos.servico;
    }
    const nat = empresa.dadosFiscais?.naturezaAtividade;
    if (nat) return nat === 'servicos' || nat === 'misto';
    // Sem info: assume que tem (servicos e a categoria mais ampla).
    return true;
}

// ─── Builder ─────────────────────────────────────────────────────────────

function buildObrigacao(empresa, regra, vencimento, vars, regimeKindLabel) {
    const compStr = vars.refMes ? formatComp(vars.refMes, vars.refAno) : '';
    const templateVars = {
        COMP: compStr,
        ANO: vars.ano || '',
        ANO_ANTERIOR: vars.anoAnterior || (vars.ano ? vars.ano - 1 : ''),
        TRIMESTRE: vars.trimestre || '',
        ANO_TRIM: vars.anoTrim || vars.ano || '',
    };
    const descricao = aplicarTemplate(regra.descricaoTemplate, templateVars);
    const periodicidade = regra.periodicidade || 'mensal';
    return {
        tipo: regra.tipo,
        descricao,
        empresaId: empresa.id,
        empresaNome: empresa.nome,
        empresaCnpj: empresa.cnpj,
        anexo: empresa.anexo,
        vencimento,
        regime: regimeKindLabel || regra.regimeLabel,
        urgencia: periodicidade,
    };
}

// ─── Geracao principal por empresa ───────────────────────────────────────

/**
 * Devolve a lista de obrigacoes pra uma empresa num determinado ano/mes.
 *
 * @param {object} empresa - documento Firestore.
 * @param {'simples'|'lucro'|'mei'|'pessoa_fisica'} regimeKind
 * @param {number} ano - 4 digitos.
 * @param {number} mes - 1..12 (mes de visualizacao do calendario).
 */
export function gerarObrigacoesPorEmpresa(empresa, regimeKind, ano, mes) {
    const obrigacoes = [];

    const folha = empresa.folha12 || empresa.folha_12 || 0;
    const temFolha = folha > 0;
    const uf = (empresa.dadosFiscais?.uf || '').toUpperCase();
    const codMunIBGE = String(empresa.dadosFiscais?.codMunIBGE || '');
    const cnae = empresa.cnae ||
        empresa.cnaePrincipal?.codigo ||
        empresa.cnaePrincipal ||
        '';

    // Mapeia regimeKind para chave usada nas regras
    let regimeChave;
    let regimeLabel;
    if (regimeKind === 'mei') {
        regimeChave = 'mei';
        regimeLabel = 'MEI';
    } else if (regimeKind === 'simples') {
        regimeChave = 'simples';
        regimeLabel = 'Simples';
    } else if (regimeKind === 'pessoa_fisica') {
        regimeChave = 'pessoa_fisica';
        regimeLabel = 'Pessoa Fisica';
    } else {
        // 'lucro': decide entre Real e Presumido com base em campos disponiveis
        const r = empresa.regime || empresa.regimePadrao || 'Presumido';
        if (r === 'Real') {
            regimeChave = 'lucro_real';
            regimeLabel = 'Lucro Real';
        } else {
            regimeChave = 'lucro_presumido';
            regimeLabel = 'Lucro Presumido';
        }
    }

    const flagICMS = temAtividadeICMS(empresa, regimeKind);
    const flagISS = temAtividadeISS(empresa, regimeKind);

    for (const regra of Object.values(OBRIGACOES)) {
        if (!regra.regimes.includes(regimeChave)) continue;
        if (regra.requireFolha && !temFolha) continue;
        if (regra.requireICMS && !flagICMS) continue;
        if (regra.requireISS && !flagISS) continue;
        if (regra.requireUF && uf !== regra.requireUF) continue;
        if (regra.requireMunicipioIBGE && codMunIBGE !== regra.requireMunicipioIBGE) continue;

        // Anual
        if (regra.periodicidade === 'anual') {
            if (mes !== regra.mesAplicavel) continue;
            const venc = calcularVencimentoAnual(ano, regra);
            if (venc) {
                obrigacoes.push(buildObrigacao(empresa, regra, venc, {
                    ano,
                    anoAnterior: ano - 1,
                }, regra.regimeLabel));
            }
            continue;
        }

        // Trimestral
        if (regra.periodicidade === 'trimestral') {
            if (!regra.mesesAplicaveis.includes(mes)) continue;
            const trimestre = trimestreEncerrado(mes);
            // Quando o vencimento e em janeiro, o trimestre fechado e T4 do
            // ano anterior; demais casos sao do mesmo ano.
            const anoTrim = mes === 1 ? ano - 1 : ano;
            const venc = calcularUltimoDiaUtil(ano, mes);
            obrigacoes.push(buildObrigacao(empresa, regra, venc, {
                trimestre,
                ano,
                anoTrim,
                anoAnterior: ano - 1,
            }, regra.regimeLabel));
            continue;
        }

        // Mensal (default)
        const venc = calcularVencimentoMensal(ano, mes, regra, cnae);
        if (!venc) continue;
        const { refMes, refAno } = competenciaAnterior(ano, mes, regra.mesesApos || 1);
        obrigacoes.push(buildObrigacao(empresa, regra, venc, {
            refMes,
            refAno,
            ano,
            anoAnterior: ano - 1,
        }, regimeLabel));
    }

    return obrigacoes;
}

// ─── Export utilitario do catalogo (para testes/debug) ──────────────────
export { OBRIGACOES };
