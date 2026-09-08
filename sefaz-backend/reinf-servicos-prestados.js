// ============================================================================
// sefaz-backend/reinf-servicos-prestados.js  (PURO — testável)
// ----------------------------------------------------------------------------
// As NFS-e PRESTADAS com RETENÇÃO PREVIDENCIÁRIA SOFRIDA (11% do art. 31 da
// Lei 8.212/91), no formato que o módulo EFD-Reinf consome para o **R-2020**.
//
// É o ESPELHO do R-2010 (`reinf-servicos-tomados.js`): lá o cliente é o TOMADOR
// e declara o que reteve; aqui o cliente é o PRESTADOR e declara o que lhe foi
// retido. O eixo do evento inverte junto — `ideEstabPrest > ideTomador > nfs`.
//
// ═══ A FONTE: UM EVENTO ACEITO, NÃO UM LEIAUTE DEDUZIDO ═════════════════════
//
// Paulo mandou em 08/09/2026 o `evtServPrest` REAL de 07/2026, transmitido pelo
// REINF.Web e ACEITO em produção (*"preciso gerar a REINF de INSS de serviços
// prestados e não está habilitado, pode liberar"*). Dele saem os fatos:
//
//   · o eixo é o TOMADOR: `ideTomador` traz tpInscTomador, nrInscTomador,
//     `indObra`, e os totais vlrTotalBruto / vlrTotalBaseRet / vlrTotalRetPrinc;
//   · cada `nfs` traz serie, numDocto, dtEmissaoNF, vlrBruto e `infoTpServ`
//     (tpServico de 9 dígitos, vlrBaseRet, vlrRetencao);
//   · **NÃO existe `indCPRB` no R-2020** — a desoneração do prestador é do
//     R-1000 (`indDesoneracao`), não deste evento;
//   · no caso aceito bruto = base = 9.105,95 e retenção = 1.001,65 (11%).
//
// ═══ A BASE SE PROVA PELA MESMA RÉGUA DO R-2010 ═════════════════════════════
//
// `conferirBaseRetencaoInss` é IMPORTADA, nunca copiada: 11% ⇒ a base é o
// bruto (provado); abaixo disso houve dedução de material/insumo (IN RFB 971,
// arts. 121-124) e a base derivada vai MARCADA; ~3,5% é ambíguo (a EMPRESA na
// CPRB retém 3,5% sobre o bruto — ou 11% sobre base muito deduzida).
//
// ═══ A RETENÇÃO SOFRIDA É DECLARAÇÃO, E A DECLARAÇÃO VENCE O DOCUMENTO ══════
//
// A nota de SAÍDA é a que o cliente esquece de informar a retenção (FRONTINI,
// 04/09: duas notas capturadas com retenção ZERO). O ajuste declarado
// (`reinf_retencoes_ajustadas`, com autor e motivo) tem campo `inss`, e aqui
// ele é honrado — carimbado como `ajuste-declarado`, nunca apresentado como
// lido. Régua que só escreve não é entrega: sem este leitor, o INSS informado à
// mão ficaria gravado e o R-2020 sairia com o zero do documento.
//
// ═══ O QUE ESTA CASCA SE RECUSA A INVENTAR ══════════════════════════════════
//
// `tpServico` (tabela 06) e `indObra` não estão na NFS-e — vão nulos, nomeados,
// e são cadastrados UMA VEZ por TOMADOR do outro lado. O `indObra` aqui é do
// contrato com AQUELE tomador (empreitada total para um, limpeza mensal para
// outro): "o primeiro decide pelos outros" é a forma silenciosa do defeito.
// ============================================================================

import { dataDeclaradaDoDocumento, direcaoEfetivaDoc, docCancelado } from './xml-metadata-helper.js';
import { ehNotaDeServico } from './sped-selecao-documentos.js';
import { lerRetencoesFederaisDoDoc } from './reinf-retencoes-pj.js';
import { conferirBaseRetencaoInss } from './reinf-servicos-tomados.js';
import { chaveDoAjuste } from './retencao-pj-ajuste.js';

const num = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v) => String(v ?? '').trim();

/** Primeiro valor numérico de verdade. Ausente ≠ zero. */
const primeiro = (...cands) => {
    for (const x of cands) {
        const n = num(x);
        if (n !== undefined) return n;
    }
    return undefined;
};

/**
 * Uma NFS-e PRESTADA com INSS retido → uma linha do R-2020.
 *
 * Lê as formas do documento que o CFI conhece (achatada do portal de SP, objeto
 * do XML, e as do importador de PDF) — é o serviço que este túnel presta.
 *
 * @param {object} d        o documento
 * @param {object} [ajuste] o ajuste declarado desta nota, se houver
 */
export function normalizarServicoPrestado(d, ajuste) {
    const v = d?.valores || {};
    // As MESMAS formas do bruto que o R-4020 lê (08/09: a NFS-e importada de
    // PDF grava `valores.servicos` e `totais.vProd`, e chegava com BRUTO 0,00).
    const bruto = primeiro(
        d?.valorServicos, v.valorServicos, v.servicos,
        d?.totais?.vServ, d?.totais?.vProd, d?.valorTotal,
    );
    const fed = lerRetencoesFederaisDoDoc(d);

    // 🚨 A DECLARAÇÃO VENCE O DOCUMENTO — e sai carimbada.
    const inssDeclarado = num(ajuste?.inss);
    const retido = inssDeclarado !== undefined ? inssDeclarado : fed.inss;
    const inssOrigem = inssDeclarado !== undefined ? 'ajuste-declarado'
        : (fed.inss !== undefined ? 'documento' : null);

    const conferencia = conferirBaseRetencaoInss({ bruto, retido });

    return {
        // ── Identificação da nota (o grupo `nfs` do evento aceito) ──────────
        numero: texto(d?.numero) || null,
        serie: texto(d?.serie) || null,
        // Data pelo DONO: o `dhEmi` chega em três formas e texto cru é data que
        // o leiaute não aceita (02/09). Ilegível continua null.
        dtEmissao: dataDeclaradaDoDocumento(d?.dataFatoGerador || d?.dhEmi) || null,
        chave: texto(d?.chave) || null,
        competencia: texto(d?.competencia) || null,

        // O PRESTADOR é o cliente do escritório — é ele quem declara o R-2020,
        // e é o CNPJ dele que vai em `nrInscEstabPrest`.
        prestadorCnpj: soDigitos(d?.prestadorCnpj || d?.prestador?.cnpjCpf || d?.prestador?.cnpj || d?.cnpjEmit || d?.emitente?.cnpjCpf || d?.empresaCnpj),
        // O TOMADOR é a contraparte — o eixo do evento (`ideTomador`).
        tomadorCnpj: soDigitos(d?.tomadorCnpj || d?.tomador?.cnpjCpf || d?.tomador?.cnpj || d?.cnpjDest || d?.destinatario?.cnpjCpf),
        tomadorNome: texto(d?.tomadorNome || d?.tomador?.nome || d?.tomador?.razaoSocial || d?.xNomeDest || d?.destinatario?.nome) || null,

        vlrBruto: bruto === undefined ? null : r2(bruto),
        // O que foi RETIDO desta nota: do documento, ou da declaração.
        inssRetido: retido === undefined ? null : r2(retido),
        inssOrigem,
        ajuste: inssDeclarado !== undefined
            ? { autor: texto(ajuste?.autor) || null, motivo: texto(ajuste?.motivo) || null, em: texto(ajuste?.em) || null }
            : null,

        // ── O que a assinatura de alíquota PROVA (ou recusa a afirmar) ──────
        baseRetencao: conferencia.base,
        baseOrigem: conferencia.baseOrigem,
        conferencia,

        // ── O que NÃO está no documento ─────────────────────────────────────
        tpServico: null,
        indObra: null,

        discriminacao: texto(d?.discriminacaoServicos) || null,
        codigoServicoMunicipal: texto(d?.codigoServico) || null,
    };
}

/**
 * Payload do R-2020 para UMA empresa (o PRESTADOR) numa competência.
 *
 * O eixo é TOMADOR × ESTABELECIMENTO PRESTADOR, como o evento aceito se
 * organiza (`ideEstabPrest > ideTomador > nfs*`), com os totais do tomador
 * somados das notas.
 *
 * @param {object} p
 * @param {string} p.cnpjPrestador  o cliente que declara
 * @param {string} p.competencia    'AAAA-MM'
 * @param {Array}  p.documentos     documentos da competência
 * @param {object} [p.ajustes]      chave da NOTA → ajuste declarado
 */
export function montarPayloadR2020({ cnpjPrestador, competencia, documentos, ajustes = {} } = {}) {
    const alvo = soDigitos(cnpjPrestador);
    const porTomador = new Map();
    let semRetencaoPrevidenciaria = 0;
    let tomadorPessoaFisica = 0;
    let semTomadorLegivel = 0;
    const comAjuste = [];

    for (const d of documentos || []) {
        if (!ehNotaDeServico(d)) continue;
        if (docCancelado(d)) continue;
        // PRESTADAS: o cliente é o prestador. A direção vem do DONO.
        if (direcaoEfetivaDoc(d) !== 'saida') continue;

        const chave = chaveDoAjuste({
            chave: d?.chave,
            numero: d?.numero,
            prestadorCnpj: d?.prestadorCnpj || d?.prestador?.cnpjCpf || d?.prestador?.cnpj || d?.cnpjEmit || d?.emitente?.cnpjCpf || d?.empresaCnpj,
        });
        const n = normalizarServicoPrestado(d, chave ? ajustes[chave] : undefined);
        if (alvo && n.prestadorCnpj && n.prestadorCnpj !== alvo) continue;
        // Sem INSS retido não é R-2020 — a maioria das notas prestadas não tem
        // retenção previdenciária. Contagem, não pendência. (Zero DECLARADO
        // também cai aqui: "conferi e não houve" é um fato.)
        if (!n.inssRetido) { semRetencaoPrevidenciaria += 1; continue; }
        if (!n.tomadorCnpj) { semTomadorLegivel += 1; continue; }
        // Tomador PESSOA FÍSICA não retém a contribuição do art. 31 — o evento
        // é entre pessoas jurídicas. Some da lista é o que faz alguém achar que
        // declarou tudo, então vira contagem.
        if (n.tomadorCnpj.length !== 14) { tomadorPessoaFisica += 1; continue; }

        if (n.inssOrigem === 'ajuste-declarado') comAjuste.push(n);

        const acc = porTomador.get(n.tomadorCnpj) || {
            cnpjTomador: n.tomadorCnpj,
            nome: n.tomadorNome,
            // O estabelecimento do PRESTADOR: `nrInscEstabPrest` do evento aceito.
            nrInscEstabPrest: n.prestadorCnpj || alvo || null,
            indObra: null,
            notas: [],
            vlrTotalBruto: 0,
            // Só soma base o que TEM base provada.
            vlrTotalBaseRet: 0,
            baseCompleta: true,
            vlrTotalRetPrinc: 0,
            comPendencia: 0,
            comAjuste: 0,
        };
        acc.notas.push(n);
        acc.vlrTotalBruto = r2(acc.vlrTotalBruto + (n.vlrBruto || 0));
        acc.vlrTotalRetPrinc = r2(acc.vlrTotalRetPrinc + n.inssRetido);
        if (n.baseOrigem === 'bruto-sem-deducao') {
            acc.vlrTotalBaseRet = r2(acc.vlrTotalBaseRet + n.baseRetencao);
        } else {
            acc.baseCompleta = false;
        }
        if (n.conferencia.exigeAcao) acc.comPendencia += 1;
        if (n.inssOrigem === 'ajuste-declarado') acc.comAjuste += 1;
        if (!acc.nome && n.tomadorNome) acc.nome = n.tomadorNome;
        porTomador.set(n.tomadorCnpj, acc);
    }

    const tomadores = [...porTomador.values()].map((t) => ({
        ...t,
        // Base incompleta NÃO sai como número: total parcial num campo chamado
        // "vlrTotalBaseRet" seria lido como a base do tomador.
        vlrTotalBaseRet: t.baseCompleta ? t.vlrTotalBaseRet : null,
    })).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    const comPendencia = tomadores.filter((t) => t.comPendencia > 0).length;
    return {
        cnpjPrestador: alvo || null,
        competencia: competencia || null,
        tomadores,
        resumo: {
            tomadores: tomadores.length,
            notas: tomadores.reduce((t, x) => t + x.notas.length, 0),
            semRetencaoPrevidenciaria,
            tomadorPessoaFisica,
            semTomadorLegivel,
            comPendencia,
            comAjuste: comAjuste.length,
            semBaseProvada: tomadores.filter((t) => !t.baseCompleta).length,
            vlrTotalBruto: r2(tomadores.reduce((t, x) => t + x.vlrTotalBruto, 0)),
            vlrTotalRetPrinc: r2(tomadores.reduce((t, x) => t + x.vlrTotalRetPrinc, 0)),
        },
        ressalvas: ressalvasDoPayload({ tomadores, tomadorPessoaFisica, semTomadorLegivel, comAjuste }),
    };
}

function ressalvasDoPayload({ tomadores, tomadorPessoaFisica, semTomadorLegivel, comAjuste }) {
    const out = [
        'O `tpServico` (tabela 06 da EFD-Reinf, 9 dígitos) e o `indObra` vão NULOS: nenhum dos dois está '
        + 'na NFS-e — nem no XML, nem no export do portal. São informados UMA VEZ por TOMADOR do lado do '
        + 'EFD-Reinf: o indicador de obra é do contrato com AQUELE tomador. Chutar 0 em `indObra` porque '
        + '"quase sempre é 0" é o default que campo de declaração não aceita.',
        'A BASE de retenção NÃO é o valor bruto quando houve dedução de material/insumo (IN RFB 971, '
        + 'arts. 121-124). Ela só viaja quando a alíquota PROVA que não houve dedução (retido = 11% do '
        + 'bruto — o caso do evento aceito de referência, 9.105,95 × 11% = 1.001,65); nos demais casos vem '
        + 'marcada como derivada, e derivada não vai para declaração.',
        'O R-2020 NÃO tem `indCPRB`: a desoneração da folha do prestador (a própria empresa) é declarada no '
        + 'R-1000 (`indDesoneracao`), não neste evento. Retenção de ~3,5% do bruto continua sendo pergunta — '
        + 'ou a empresa está na CPRB e a base é o bruto, ou são os 11% sobre base muito deduzida.',
    ];
    const semBase = tomadores.filter((t) => !t.baseCompleta);
    if (semBase.length) {
        out.push(`${semBase.length} tomador(es) com nota cuja BASE não está provada `
            + `(${semBase.map((t) => t.nome || t.cnpjTomador).join(', ')}) — o total da base vem NULO `
            + 'para eles. Total parcial num campo de base seria lido como a base inteira.');
    }
    const ambiguos = tomadores.filter((t) => t.notas.some((n) => n.conferencia.situacao === 'aliquota-ambigua-cprb-ou-deducao'));
    if (ambiguos.length) {
        out.push(`🚨 ${ambiguos.length} tomador(es) com retenção de ~3,5% do bruto — número com DUAS `
            + 'leituras: a empresa na desoneração da folha (CPRB) ou 11% sobre base muito deduzida. '
            + 'O app não escolhe: confirme o regime da empresa (R-1000) e a base da nota.');
    }
    if (comAjuste.length) {
        // O número que vem de DECLARAÇÃO HUMANA sai DITO, com a nota e quem
        // declarou — quem conferir daqui a três meses precisa saber que aquele
        // número não saiu do documento.
        out.push(`✍️ ${comAjuste.length} nota(s) com o INSS retido INFORMADO À MÃO (ajuste declarado, vence o `
            + `documento): ${comAjuste.map((n) => `nº ${n.numero || '—'} (${n.ajuste?.autor || 'autor não gravado'})`).join(', ')}. `
            + 'O valor declarado é o que vai ao evento — o documento continua gravado como chegou.');
    }
    if (tomadorPessoaFisica) {
        out.push(`${tomadorPessoaFisica} nota(s) com tomador PESSOA FÍSICA ficaram de fora — a retenção do `
            + 'art. 31 é entre pessoas jurídicas; PF não retém contribuição previdenciária de serviço.');
    }
    if (semTomadorLegivel) {
        out.push(`${semTomadorLegivel} nota(s) com INSS retido e SEM CNPJ do tomador legível ficaram de fora — `
            + 'sem o tomador o evento não tem eixo. Complete o documento (reimporte o PDF/XML com o CNPJ) '
            + 'antes de declarar.');
    }
    if (!tomadores.length) {
        // Zero nunca é sucesso: pode ser mês sem retenção OU captura faltando.
        out.push('NENHUMA nota prestada com retenção previdenciária nesta competência. Se o cliente presta '
            + 'cessão de mão de obra ou empreitada (limpeza, vigilância, conservação, construção) e a nota '
            + 'saiu sem o INSS retido, o caminho é informar a retenção na própria nota (✍️ ajuste declarado, '
            + 'em Relatórios → Retenções) — não é ausência de obrigação.');
    }
    return out;
}
