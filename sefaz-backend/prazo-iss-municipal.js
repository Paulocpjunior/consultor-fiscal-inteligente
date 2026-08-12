// ============================================================================
// sefaz-backend/prazo-iss-municipal.js   (PURO — sem io, testável)
//
// O PRAZO DO ISS É DO MUNICÍPIO. Não existe "dia do ISS" nacional.
//
// Paulo, 11/08/2026: *"os vencimentos são datas definidas pelos órgãos
// governamentais, sempre separados por esferas — federal, estadual, municipal;
// isso nunca se altera e é onde deve ser feita a consulta"*. E em 12/08,
// confirmando: **"ISS é municipal e não federal"**.
//
// No catálogo único o ISS nasceu como PROPOSTA, sem data, justamente porque
// carimbar o dia de São Paulo em cliente de outro município seria INVENTAR
// prazo — e prazo inventado erra dos dois lados: multa de um, "atrasada" falsa
// do outro. Este módulo é o cadastro que faltava.
//
// ─── AS TRÊS REGRAS ─────────────────────────────────────────────────────────
//
// 1. **VIGÊNCIA MANDA, NÃO "O MAIS RECENTE".** É a mesma régua do IVA-ST: o
//    prazo se resolve pela DATA DA COMPETÊNCIA. Município que mudou o dia em
//    2026 não pode reescrever o vencimento de 2025 — o erro só apareceria na
//    fiscalização.
// 2. **SEM CADASTRO, SEM DATA.** Município não cadastrado devolve pendência
//    NOMEADA (com o código IBGE) em vez de um dia qualquer. O mês do cliente
//    mostra a obrigação e diz que falta cadastrar — some do mês seria pior.
// 3. **FONTE OBRIGATÓRIA.** Todo prazo carrega a norma que o define. Data sem
//    origem é achismo com cara de cadastro, e daqui a seis meses ninguém sabe
//    de onde veio (foi assim que o IVA-ST virou regra: índice órfão não se
//    confere depois).
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** Competência AAAA-MM → comparável. Vigência usa a MESMA forma. */
const ehCompetencia = (c) => /^\d{4}-\d{2}$/.test(String(c || ''));

/**
 * Cadastro semente. Só entra município cuja regra veio de uma FONTE — hoje só
 * a capital, herdada do mapa que a equipe já usava (`calendario-obrigacoes.js`,
 * ISS_SP dia 10). Ela entra marcada como `confirmar: true`: herdada de cadastro
 * interno não é o mesmo que conferida na norma, e o app não pode fingir que é.
 */
export const PRAZOS_ISS_SEMENTE = [
    {
        codMunIBGE: '3550308',
        municipio: 'São Paulo',
        diaVencimento: 10,
        mesesApos: 1,
        vigenciaInicio: null,          // null = vale desde sempre até prova em contrário
        vigenciaFim: null,
        fonte: 'herdado de calendario-obrigacoes.js (ISS_SP) — CONFERIR na legislação do município',
        confirmar: true,
    },
];

/**
 * Resolve o prazo do ISS de um município numa competência.
 *
 * @param {object} p
 * @param {string} p.codMunIBGE     município do CLIENTE (7 dígitos)
 * @param {string} p.competencia    AAAA-MM
 * @param {Array}  [p.cadastro]     linhas de prazo (padrão: a semente)
 * @returns {{ resolvido:boolean, diaVencimento:number|null, mesesApos:number|null,
 *             municipio:string|null, fonte:string|null, confirmar:boolean,
 *             motivo:string|null, acao:string|null }}
 */
export function resolverPrazoIss({ codMunIBGE, competencia, cadastro = PRAZOS_ISS_SEMENTE } = {}) {
    const ibge = soDigitos(codMunIBGE);
    if (ibge.length !== 7) {
        return naoResolvido(
            'O cliente não tem código IBGE do município no cadastro — sem ele não dá pra saber qual '
            + 'prefeitura define o prazo.',
            'Preencha o município em Dados Fiscais da empresa.',
        );
    }
    if (!ehCompetencia(competencia)) {
        return naoResolvido('Competência inválida (use AAAA-MM).', 'Corrija a competência e tente de novo.');
    }

    const doMunicipio = (Array.isArray(cadastro) ? cadastro : [])
        .filter((r) => soDigitos(r?.codMunIBGE) === ibge);
    if (!doMunicipio.length) {
        return naoResolvido(
            `O prazo do ISS do município ${ibge} não está cadastrado.`,
            // A obrigação NÃO some do mês: ela aparece sem data, dizendo o que falta.
            'Cadastre o prazo desse município (dia e norma que o define). Enquanto isso a obrigação '
            + 'aparece no mês SEM data — nunca com o prazo de outra cidade.',
        );
    }

    // VIGÊNCIA: vale a linha cuja janela contém a competência. Empate resolve
    // pela vigência mais recente que ainda cobre a data — nunca "a última
    // cadastrada".
    const vigentes = doMunicipio.filter((r) => dentroDaVigencia(r, competencia));
    if (!vigentes.length) {
        return naoResolvido(
            `Há prazo cadastrado para o município ${ibge}, mas nenhum vigente em ${competencia}.`,
            'Cadastre a vigência que cobre essa competência — usar um prazo de outra época erra a data.',
        );
    }
    const escolhida = vigentes.sort((a, b) => String(b.vigenciaInicio || '').localeCompare(String(a.vigenciaInicio || '')))[0];

    return {
        resolvido: true,
        diaVencimento: Number(escolhida.diaVencimento),
        mesesApos: Number.isFinite(Number(escolhida.mesesApos)) ? Number(escolhida.mesesApos) : 1,
        municipio: escolhida.municipio || null,
        fonte: escolhida.fonte || null,
        // Prazo herdado ou não conferido continua VALENDO, mas carimbado —
        // é a diferença entre "sei" e "acho".
        confirmar: escolhida.confirmar === true,
        motivo: null,
        acao: escolhida.confirmar === true
            ? 'Prazo em uso, mas ainda NÃO conferido na norma do município — confirme antes de tratar como definitivo.'
            : null,
    };
}

function dentroDaVigencia(r, competencia) {
    const ini = r?.vigenciaInicio || null;
    const fim = r?.vigenciaFim || null;
    if (ini && competencia < ini) return false;
    if (fim && competencia > fim) return false;
    return true;
}

function naoResolvido(motivo, acao) {
    return {
        resolvido: false, diaVencimento: null, mesesApos: null,
        municipio: null, fonte: null, confirmar: false, motivo, acao,
    };
}

/**
 * Validação de uma linha de cadastro. Prazo sem FONTE é recusado — é a mesma
 * trava do IVA-ST sem Portaria: índice órfão não se confere depois.
 */
export function validarPrazoIss(linha) {
    const erros = [];
    if (soDigitos(linha?.codMunIBGE).length !== 7) erros.push('codMunIBGE deve ter 7 dígitos');
    const dia = Number(linha?.diaVencimento);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) erros.push('diaVencimento deve ser um dia do mês (1-31)');
    if (linha?.mesesApos != null && !Number.isInteger(Number(linha.mesesApos))) {
        erros.push('mesesApos deve ser inteiro (1 = mês seguinte ao fato gerador)');
    }
    if (!String(linha?.fonte || '').trim()) {
        erros.push('fonte é obrigatória — a norma do município que define o prazo. '
            + 'Data sem origem é achismo com cara de cadastro.');
    }
    for (const campo of ['vigenciaInicio', 'vigenciaFim']) {
        const v = linha?.[campo];
        if (v != null && v !== '' && !ehCompetencia(v)) erros.push(`${campo} deve ser AAAA-MM (ou vazio)`);
    }
    if (linha?.vigenciaInicio && linha?.vigenciaFim && linha.vigenciaInicio > linha.vigenciaFim) {
        erros.push('vigenciaInicio não pode ser depois de vigenciaFim');
    }
    return erros;
}

/** Municípios que aparecem na carteira e ainda não têm prazo cadastrado. */
export function municipiosSemPrazo(codsIBGE = [], cadastro = PRAZOS_ISS_SEMENTE) {
    const cadastrados = new Set((cadastro || []).map((r) => soDigitos(r?.codMunIBGE)));
    const faltando = new Map();
    for (const c of codsIBGE) {
        const ibge = soDigitos(c);
        if (ibge.length !== 7 || cadastrados.has(ibge)) continue;
        faltando.set(ibge, (faltando.get(ibge) || 0) + 1);
    }
    return Array.from(faltando.entries())
        .map(([codMunIBGE, clientes]) => ({ codMunIBGE, clientes }))
        .sort((a, b) => b.clientes - a.clientes);
}
