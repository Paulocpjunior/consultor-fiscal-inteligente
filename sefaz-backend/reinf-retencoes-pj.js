// ============================================================================
// sefaz-backend/reinf-retencoes-pj.js  (PURO — testável)
// ----------------------------------------------------------------------------
// As NFS-e TOMADAS com retenção, no formato que o módulo EFD-Reinf consome
// para montar o R-4020.
//
// POR QUE ESTA CASCA EXISTE, e por que ela mora AQUI:
//
// O REINF é outro app (`plano-contas-iob`, Cloud Run próprio) e — ao contrário
// do que o roadmap dele dizia — os dois NÃO compartilham Firestore: o REINF
// fixa `projectId: 'projetos-app-sp'` e o CFI roda em `consultorfiscalapp`.
// Então a integração é por ROTA.
//
// E a rota tem que sair DAQUI, não de lá, porque quem conhece a forma do
// documento é o CFI: a NFS-e do PORTAL vem ACHATADA (`valorIss`, `pisRetido`)
// e a do XML vem em OBJETO (`valores.*`). Ler isso do outro lado seria
// reescrever a armadilha que já mordeu seis vezes neste repo — e as duas
// leituras divergiriam sem ninguém perceber.
//
// O QUE ESTA CASCA NÃO RESOLVE, e diz na cara:
//
//  1. O `codigoServico` da NFS-e paulistana é o código MUNICIPAL (4030, 7498),
//     não o item da LC 116 (4.02, 7.10). A tabela de natureza do rendimento
//     casa por LC 116. Esse de-para NÃO existe aqui, então o payload manda o
//     código municipal ROTULADO como municipal — nunca fingindo ser LC 116.
//  2. A CSLL individual não vem do portal: o campo é o TOTAL das três
//     contribuições. Por isso ele viaja com o nome `csllOuTotal`, e quem
//     separa é o REINF (só quando as três alíquotas fecham).
//
// Nome de campo que mente é pior que campo faltando: o outro lado usa e ninguém
// descobre até a declaração.
// ============================================================================

import { conferirRetencaoFederal } from './retencao-federal-coerencia.js';

const num = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v) => String(v ?? '').trim();

const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);

/** Primeiro valor numérico de verdade. Ausente ≠ zero. */
const primeiro = (...cands) => {
    for (const x of cands) {
        const n = num(x);
        if (n !== undefined) return n;
    }
    return undefined;
};

/**
 * RETENÇÕES FEDERAIS DO DOCUMENTO, NAS DUAS FORMAS — a régua ÚNICA.
 *
 * O importador do CSV do portal grava ACHATADO na raiz (`valorIr`,
 * `valorInss`, `valorCsll`…); o trilho do XML grava em OBJETO (`valores.*`).
 * Ler só uma forma foi o que fez o Relatório de Retenções da CLUDE imprimir
 * "?" em 67 notas cujo IR/INSS estava GRAVADO — na outra forma (19/08).
 *
 * ⚠️ O campo de CSLL sai como `csllOuTotal` de propósito: no export do portal
 * ele é o TOTAL das três contribuições (CSRF), não a CSLL — quem separa é a
 * assinatura de alíquota (`conferirRetencaoFederal`), nunca este leitor.
 *
 * Ausente ≠ zero: campo que não existe em NENHUMA forma volta undefined.
 */
export function lerRetencoesFederaisDoDoc(d) {
    const v = d?.valores || {};
    return {
        ir: primeiro(d?.valorIr, v.ir),
        pis: primeiro(d?.valorPis, v.pis),
        cofins: primeiro(d?.valorCofins, v.cofins),
        csllOuTotal: primeiro(d?.valorCsll, v.csll),
        inss: primeiro(d?.valorInss, v.inss),
    };
}

/**
 * Uma NFS-e tomada → uma linha do payload do R-4020.
 *
 * Lê as DUAS formas do documento (achatada do portal e objeto do XML), que é
 * exatamente o que o outro app não teria como saber.
 */
export function normalizarNotaTomada(d) {
    const v = d?.valores || {};
    const base = primeiro(d?.valorServicos, v.valorServicos, d?.valorTotal);
    const fed = lerRetencoesFederaisDoDoc(d);
    return {
        numero: texto(d?.numero) || null,
        chave: texto(d?.chave) || null,
        dataFatoGerador: texto(d?.dataFatoGerador || d?.dhEmi) || null,
        competencia: texto(d?.competencia) || null,

        prestadorCnpj: soDigitos(d?.prestadorCnpj || d?.cnpjEmit || d?.emitente?.cnpjCpf),
        prestadorNome: texto(d?.prestadorNome || d?.xNomeEmit || d?.emitente?.nome) || null,
        // O tomador é o CLIENTE do escritório — é ele quem declara o R-4020.
        tomadorCnpj: soDigitos(d?.tomadorCnpj || d?.cnpjDest || d?.destinatario?.cnpjCpf || d?.empresaCnpj),

        base: base === undefined ? null : r2(base),
        ir: r2(fed.ir ?? 0),
        pis: r2(fed.pis ?? 0),
        cofins: r2(fed.cofins ?? 0),
        // NOME HONESTO: no export do portal este campo é o TOTAL das três
        // contribuições, não a CSLL. Chamar de `csll` faria o outro lado
        // declarar o total como CSLL — e ninguém veria.
        csllOuTotal: r2(fed.csllOuTotal ?? 0),
        inss: r2(fed.inss ?? 0),

        // Código MUNICIPAL de serviço (SP), não item da LC 116. O de-para não
        // existe neste app — mandar rotulado evita que o outro lado o use como
        // se fosse LC 116.
        codigoServicoMunicipal: texto(d?.codigoServico) || null,
        itemLc116: null,
        // O prestador às vezes escreve a natureza do rendimento aqui — é FONTE,
        // e o REINF sabe extrair.
        discriminacao: texto(d?.discriminacaoServicos) || null,
    };
}

const temRetencao = (n) => !!(n.ir || n.pis || n.cofins || n.csllOuTotal);

/**
 * Payload do R-4020 para UMA empresa numa competência.
 *
 * @param {object} p
 * @param {string} p.cnpjTomador  o cliente que declara
 * @param {string} p.competencia  'AAAA-MM'
 * @param {Array}  p.documentos   NFS-e da competência (qualquer direção)
 */
export function montarPayloadReinfPJ({ cnpjTomador, competencia, documentos } = {}) {
    const alvo = soDigitos(cnpjTomador);
    const notas = [];
    let semRetencao = 0;
    let dePessoaFisica = 0;

    for (const d of documentos || []) {
        if (!/NFSe/i.test(texto(d?.tipoDoc || d?.tipo))) continue;
        if (CANCELADOS.has(texto(d?.status).toLowerCase())) continue;
        // TOMADAS: o cliente é o tomador, não o prestador.
        if (d?.direcao !== 'entrada') continue;

        const n = normalizarNotaTomada(d);
        if (alvo && n.tomadorCnpj && n.tomadorCnpj !== alvo) continue;
        if (!temRetencao(n)) { semRetencao += 1; continue; }
        // Prestador PESSOA FÍSICA é R-4010, outro evento. Não some em silêncio:
        // vira contagem, porque some da lista é o que faz alguém achar que
        // declarou tudo.
        if (n.prestadorCnpj.length !== 14) { dePessoaFisica += 1; continue; }

        notas.push({ ...n, coerencia: conferirRetencaoFederal({
            base: n.base, pis: n.pis, cofins: n.cofins, csll: n.csllOuTotal,
        }) });
    }

    notas.sort((a, b) => String(a.prestadorNome).localeCompare(String(b.prestadorNome), 'pt-BR'));

    const comProblema = notas.filter((n) => n.coerencia.exigeAcao).length;
    const camposDaOperacao = notas.filter((n) => n.coerencia.situacao === 'campos-sao-totais-da-operacao').length;
    return {
        cnpjTomador: alvo || null,
        competencia: competencia || null,
        notas,
        resumo: {
            notas: notas.length,
            prestadores: new Set(notas.map((n) => n.prestadorCnpj)).size,
            semRetencao,
            dePessoaFisica,
            comIncoerencia: comProblema,
            camposDaOperacao,
            totalBase: r2(notas.reduce((t, n) => t + (n.base || 0), 0)),
            totalIr: r2(notas.reduce((t, n) => t + n.ir, 0)),
        },
        ressalvas: ressalvasDoPayload({ notas: notas.length, dePessoaFisica, comProblema, camposDaOperacao }),
    };
}

function ressalvasDoPayload({ notas, dePessoaFisica, comProblema, camposDaOperacao }) {
    const out = [
        'O campo `csllOuTotal` é o que o portal de SP entrega — e nele a CSLL individual NÃO vem: '
        + 'o valor é o TOTAL das três contribuições. Quem separa é o EFD-Reinf, e só quando as '
        + 'alíquotas fecham (PIS 0,65% · COFINS 3% · CSLL 1%).',
        'O `codigoServicoMunicipal` é o código de serviço da prefeitura de SP, NÃO o item da LC 116/2003. '
        + 'A correlação com a natureza do rendimento casa por LC 116 — este app não tem esse de-para, '
        + 'então `itemLc116` vai nulo de propósito.',
    ];
    if (dePessoaFisica) {
        out.push(`${dePessoaFisica} nota(s) com prestador PESSOA FÍSICA ficaram de fora — são R-4010, outro evento.`);
    }
    if (camposDaOperacao) {
        // Causa junto do número: "N notas com alíquota fora" faria o colaborador
        // conferir uma a uma sem saber o que procurar. Aqui a causa tem nome, e
        // é a mais cara de todas — declarar o tributo do prestador como retido
        // infla a retenção várias vezes (nota real: 315,73 no lugar de 158,72).
        out.push(`🚨 ${camposDaOperacao} nota(s) em que PIS e COFINS são o tributo do PRESTADOR `
            + '(não-cumulativo 1,65% e 7,60%), não retenção — a NFS-e paulistana tem campos que muitos '
            + 'prestadores preenchem assim e avisam em "Outras Informações". Declarar esses valores como '
            + 'retidos infla a retenção; a retenção real é a CSRF de 4,65%.');
    }
    const outrasIncoerencias = comProblema - camposDaOperacao;
    if (outrasIncoerencias > 0) {
        out.push(`${outrasIncoerencias} nota(s) com retenção que não bate com a alíquota legal — confira antes de declarar.`);
    }
    if (notas === 0) {
        // Zero nunca é sucesso: pode ser mês sem retenção OU captura faltando.
        out.push('NENHUMA nota tomada com retenção nesta competência. Se o cliente contrata serviços com '
            + 'retenção, o problema é de CAPTURA — não é ausência de obrigação.');
    }
    return out;
}
