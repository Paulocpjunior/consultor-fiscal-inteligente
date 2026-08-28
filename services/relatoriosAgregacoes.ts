/**
 * relatoriosAgregacoes.ts — PURO (testável). As contas dos relatórios do menu
 * Relatórios que agregam documentos fiscais (lista do Paulo, 01/08: resumo
 * CFOP, ICMS/IPI/ISS, serviços tomados/prestados, retenções, resumo por UF).
 *
 * Régua única: as colunas Base/Isentos/Outras saem de alocarTributacaoIcms —
 * a MESMA alocação do Exportar SAGE e do Livro. Relatório nunca inventa conta.
 */
import type { DocumentoFiscal } from '../types';
import { alocarTributacaoIcms } from './iobSageExportService';
// RÉGUA ÚNICA das duas formas de gravação: captura SEFAZ/portal grava
// ACHATADO (cnpjEmit) e importação de XML grava OBJETO (emitente.cnpjCpf).
// Ler só o objeto zerava TUDO que depende de "a empresa é a emitente" — foi
// o que fez "emissão própria 0" em 198 clientes (05/08) e o que fazia este
// relatório dizer "nenhuma nota emitida" com 436 documentos no recorte.
import { cnpjEmitente, modeloDoDoc, ladoDaContraparte } from '../sefaz-backend/participante-doc-helper.js';
// Régua ÚNICA de correlação de CFOP — a mesma do Exportar SAGE e do modal.
import { correlacionarCfop, cfopDoLancamento } from '../sefaz-backend/cfop-correlacao.js';
// Cancelamento EFETIVO — o status gravado pode mentir (evento 155 não virava o
// status; merge stub→nota ressuscitava a cancelada). docCancelado decide na
// LEITURA olhando também eventos[]/cStat — bug 11/08, MV LIDER 639: cancelada
// contada no Livro de Saídas e no fechamento.
import {
    docCancelado, direcaoEfetivaDoc,
    // 🚨 O ISS chega em QUATRO formas e este relatório lia UMA (`valores.*`,
    // que só o import pelo NAVEGADOR grava). Toda NFS-e do portal, do ABRASF
    // e do ADN imprimia ISS 0,00 — indistinguível de "não teve ISS".
    issDoDocumento, issRetidoDoDocumento,
} from '../sefaz-backend/xml-metadata-helper.js';
// RÉGUA ÚNICA das retenções federais nas DUAS formas (achatada do portal ×
// objeto do XML): o CSV do portal grava `valorIr`/`valorInss`/`valorCsll` na
// RAIZ, e este relatório só lia `valores.*` — 67 notas da CLUDE com IR/INSS
// gravados imprimiam "?" (19/08). Quem lê é o dono, nunca uma segunda cópia.
import { lerRetencoesFederaisDoDoc } from '../sefaz-backend/reinf-retencoes-pj.js';
// A assinatura de alíquota decide o que o campo É: "CSLL" que vale 4,65% da
// base é o TOTAL das três (CSRF); PIS 1,65% + COFINS 7,60% é o tributo da
// OPERAÇÃO do prestador, não retenção (casos CLINIPAR e ATLAS, 07/08).
import { conferirRetencaoFederal } from '../sefaz-backend/retencao-federal-coerencia.js';
// 🚨 "É NOTA DE SERVIÇO?" — o rótulo `tipo === 'NFSe'` é a forma MAIS RARA.
// A NFS-e do **ADN** (NFS-e Nacional) grava `tipo: 'nfseNacional'` e a do
// portal por CSV/TXT grava `prestador`/`tomador`. Perguntando pelo rótulo
// cru, esses documentos sumiam de TRÊS relatórios de uma vez — ISS destacado,
// Serviços tomados/prestados e **Retenções**. É o achado (2) de 21/08, que
// fechou no bloco A do EFD-Contribuições e ficou vivo aqui.
import { ehNotaDeServico } from '../sefaz-backend/sped-selecao-documentos.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const docValido = (d: DocumentoFiscal) => !docCancelado(d);

/**
 * 🚨 A DIREÇÃO GRAVADA PODE MENTIR — e estes relatórios são o que o
 * colaborador compara com o SPED e com o arquivo do SAGE.
 *
 * A nota PRÓPRIA DE ENTRADA (art. 136 — a compra de produtor rural PF, que o
 * adquirente emite) fica gravada como 'saida' até o backfill do sync-cron
 * passar. Lida crua, ela aparecia como SAÍDA no Resumo por CFOP (com um CFOP
 * 1xxx ao lado), somava ICMS/IPI no DÉBITO em vez do crédito, e sumia da lista
 * de fornecedores. Depois de 22/08 o SPED e o .FML lêem pela régua — o
 * relatório tinha de ler igual, senão a tela discorda do arquivo.
 */
const direcaoDoc = (d: DocumentoFiscal): 'entrada' | 'saida' =>
    (direcaoEfetivaDoc(d) as 'entrada' | 'saida');
const contabilDoc = (d: DocumentoFiscal) => d.totais?.vNF || d.valorTotal || 0;

/** Contraparte (quem não é a empresa): destinatário na saída e na nota própria de entrada. */
export function contraparteDoc(d: DocumentoFiscal): any {
    const x = d as any;
    const temLado = (p: any) => !!(p && (p.cnpjCpf || p.cnpj || p.cpf || p.nome || p.razaoSocial));
    // O importer PRINCIPAL grava os participantes em campos CHATOS; sync-routes
    // e o abrasf gravam ANINHADO. Ler só o aninhado é a armadilha que mais
    // mordeu este projeto — e era por isso que a coluna
    // "Fornecedor/Remetente" do Livro saía toda com "—" (VINCENZO, 12/08).
    const emitente = temLado(d.emitente) ? d.emitente : (temLado(d.prestador) ? d.prestador : {
        cnpjCpf: x.prestadorCnpj || x.cnpjEmit || x.cnpjEmitente || '',
        // A captura NFS-e SP grava o participante em campos canônicos chatos
        // (`prestadorNome`/`prestadorCnpj`). Sem estes fallbacks, o relatório
        // preservava número e valores da nota, mas imprimia "—" no prestador.
        nome: x.prestadorNome || x.xNomeEmit || x.nomeEmit || '',
        ie: x.ieEmit || '', uf: x.ufEmit || '', codMunIBGE: x.codMunEmit || '',
    });
    const destinatario = temLado(d.destinatario) ? d.destinatario : (temLado(d.tomador) ? d.tomador : {
        cnpjCpf: x.tomadorCnpj || x.cnpjDest || x.cnpjDestinatario || '',
        nome: x.tomadorNome || x.xNomeDest || x.nomeDest || '',
        ie: x.ieDest || '', uf: x.ufDest || '', codMunIBGE: x.codMunDest || '',
    });
    // 🚨 QUEM DECIDE O LADO É O DONO, não uma cópia (26/08). A cópia daqui
    // reconhecia a nota própria de entrada só por `tpNF === '0'`, SEM o laço
    // que o dono tem — e o comentário do próprio dono já diz por que ele
    // existe: *"a nota própria de entrada é emitida PELA EMPRESA. Sem esse
    // laço, o tpNF=0 de um TERCEIRO viraria 'nossa' nota própria — e a
    // contraparte sairia do lado errado"*. Com dois clientes negociando entre
    // si (o caso KROYA × GOLDLOG, 17/08), a nota própria de entrada de UM
    // aparece na base e a coluna mostraria o PRÓPRIO cliente como fornecedor.
    return ladoDaContraparte(d, (d as any).empresaCnpj) === 'destinatario' ? destinatario : emitente;
}

// ─── Resumo por CFOP ────────────────────────────────────────────────────────

/** O que a correlação de entrada precisa saber sobre a empresa. */
export interface CtxCorrelacao {
    naturezaAtividade?: string;
    cfopOverrides?: Record<string, string>;
}

export interface LinhaCfop {
    cfop: string;
    direcao: 'entrada' | 'saida';
    notas: number;
    itens: number;
    contabil: number;
    base: number;
    icms: number;
    isentos: number;
    outras: number;
    ipi: number;
}

/**
 * Agrega por CFOP com o contábil da nota RATEADO entre os CFOPs dela na
 * proporção do valor dos itens (mesma regra do E201 do Exportar SAGE).
 *
 * ⚠️ **O CFOP DA ENTRADA NÃO É O DO XML.** Numa compra, o documento é do
 * FORNECEDOR e traz o CFOP de SAÍDA dele (5102, 6102…); quem escritura a
 * entrada lança 1102/2102. Paulo, 14/08: *"tudo que o cliente compra vira CFOP
 * de entrada de acordo com a correlação necessária"*.
 *
 * Por isso `ctx` é **OBRIGATÓRIO**, e não opcional com default: parâmetro que
 * dá para esquecer volta a agrupar pelo CFOP do fornecedor em silêncio, e o
 * número fica plausível — o pior jeito de errar. Assim o `tsc` obriga cada
 * chamador a dizer de onde vem a natureza da atividade.
 */
export function resumoPorCfop(docs: DocumentoFiscal[], ctx: CtxCorrelacao): LinhaCfop[] {
    const mapa = new Map<string, LinhaCfop>();
    for (const d of docs) {
        if (!docValido(d) || !(d.itens || []).length) continue;
        const porCfop = new Map<string, typeof d.itens>();
        for (const it of d.itens) {
            const cru = String(it.cfop || '0000').replace(/\D/g, '') || '0000';
            // Na saída `correlacionarCfop` devolve o próprio CFOP; a nota
            // própria de entrada (art. 136) já nasce 1xxx e passa intacta.
            // O CFOP informado NA NF vence a régua automática (decisão do
            // Paulo, 17/08: "é por NF"). Sem ele, nada muda.
            const cfop = String(cfopDoLancamento(d, cru, direcaoDoc(d) as any, ctx) || cru);
            if (!porCfop.has(cfop)) porCfop.set(cfop, []);
            porCfop.get(cfop)!.push(it);
        }
        const valorGrupo = (its: typeof d.itens) => its.reduce((a, i) => a + (i.vProd || 0) - (i.vDesc || 0), 0);
        const totalItens = Array.from(porCfop.values()).reduce((a, g) => a + valorGrupo(g), 0);
        const contabil = contabilDoc(d);
        const grupos = Array.from(porCfop.entries());
        let distribuido = 0;
        grupos.forEach(([cfop, its], idx) => {
            const ultimo = idx === grupos.length - 1;
            const contabilLinha = ultimo
                ? r2(contabil - distribuido)
                : (totalItens > 0 ? r2(contabil * (valorGrupo(its) / totalItens)) : 0);
            distribuido = r2(distribuido + contabilLinha);
            const a = alocarTributacaoIcms(its, contabilLinha);
            const k = `${direcaoDoc(d)}|${cfop}`;
            const linha = mapa.get(k) || {
                cfop, direcao: direcaoDoc(d),
                notas: 0, itens: 0, contabil: 0, base: 0, icms: 0, isentos: 0, outras: 0, ipi: 0,
            };
            linha.notas += 1;
            linha.itens += its.length;
            linha.contabil = r2(linha.contabil + contabilLinha);
            linha.base = r2(linha.base + a.base);
            linha.icms = r2(linha.icms + a.icms);
            linha.isentos = r2(linha.isentos + a.isentos);
            linha.outras = r2(linha.outras + a.outras);
            linha.ipi = r2(linha.ipi + a.ipi);
            mapa.set(k, linha);
        });
    }
    return Array.from(mapa.values()).sort((a, b) =>
        a.direcao.localeCompare(b.direcao) || a.cfop.localeCompare(b.cfop));
}

// ─── ICMS / IPI / ISS ───────────────────────────────────────────────────────

export interface ResumoImpostos {
    icms: { creditoEntradas: number; debitoSaidas: number; saldo: number };
    ipi: { creditoEntradas: number; debitoSaidas: number; saldo: number };
    iss: { prestados: number; retidoTomados: number };
}

/**
 * Débitos × créditos DESTACADOS nos documentos da competência. É resumo de
 * escrituração (o que as notas carregam), NÃO a apuração — crédito de entrada
 * depende de direito a crédito que só a apuração conhece; a observação do PDF
 * diz isso.
 */
export function resumoImpostos(docs: DocumentoFiscal[]): ResumoImpostos {
    const out: ResumoImpostos = {
        icms: { creditoEntradas: 0, debitoSaidas: 0, saldo: 0 },
        ipi: { creditoEntradas: 0, debitoSaidas: 0, saldo: 0 },
        iss: { prestados: 0, retidoTomados: 0 },
    };
    for (const d of docs) {
        if (!docValido(d)) continue;
        // ⚠️ Quem responde "é serviço?" é o DONO — e ele é o mesmo que separa
        // o bloco A do C. O ISS de toda NFS-e do ADN saía ZERO daqui, e zero
        // num relatório de imposto destacado é indistinguível de "não teve".
        if (ehNotaDeServico(d)) {
            const iss = issDoDocumento(d);
            const retido = issRetidoDoDocumento(d);
            if (direcaoDoc(d) === 'saida') out.iss.prestados = r2(out.iss.prestados + (Number.isFinite(iss) ? iss : 0));
            else out.iss.retidoTomados = r2(out.iss.retidoTomados + (Number.isFinite(retido) ? retido : 0));
            continue;
        }
        const icms = (d.itens || []).reduce((a, i) => a + (i.vICMS || 0), 0) || d.totais?.vICMS || 0;
        const ipi = (d.itens || []).reduce((a, i) => a + (i.vIPI || 0), 0) || d.totais?.vIPI || 0;
        // 🚨 A nota PRÓPRIA DE ENTRADA (art. 136) fica gravada como 'saida' até
        // o backfill passar — lendo o campo cru, o ICMS dela entrava como
        // DÉBITO em vez de CRÉDITO. É o achado 16 (o E110 fazia o mesmo), aqui
        // no relatório que o colaborador lê, e o erro é para os DOIS lados:
        // débito a maior e crédito a menor.
        if (direcaoEfetivaDoc(d) === 'saida') {
            out.icms.debitoSaidas = r2(out.icms.debitoSaidas + icms);
            out.ipi.debitoSaidas = r2(out.ipi.debitoSaidas + ipi);
        } else {
            out.icms.creditoEntradas = r2(out.icms.creditoEntradas + icms);
            out.ipi.creditoEntradas = r2(out.ipi.creditoEntradas + ipi);
        }
    }
    out.icms.saldo = r2(out.icms.debitoSaidas - out.icms.creditoEntradas);
    out.ipi.saldo = r2(out.ipi.debitoSaidas - out.ipi.creditoEntradas);
    return out;
}

// ─── Serviços tomados / prestados + retenções ───────────────────────────────

export interface LinhaServico {
    data: string;
    numero: string;
    participante: string;
    doc: string;
    municipio: string;
    base: number;
    iss: number;
    issRetido: number;
    pis: number;
    cofins: number;
    ir: number;
    inss: number;
    csll: number;
    liquido: number;
    /** Doc gravado antes de 01/08 não tem IR/INSS/CSLL — ausente ≠ zero retido. */
    retencoesFederaisGravadas: boolean;
    /**
     * As três contribuições retidas NUM CAMPO SÓ (assinatura CSRF 4,65%) — o
     * documento não traz o rateio. Fica FORA da coluna CSLL e dos totais por
     * tributo (somar como CSLL contaria PIS e COFINS em dobro); a tela mostra
     * o valor marcado.
     */
    csrfSemRateio: number;
    /**
     * PIS+COFINS nas alíquotas do NÃO-CUMULATIVO (1,65% + 7,60%) — tributo da
     * OPERAÇÃO do prestador, não retenção (caso ATLAS). Fora dos totais.
     */
    pisCofinsOperacao: number;
    /** Código de serviço MUNICIPAL da nota (NFS-e SP); vazio quando o trilho não traz. */
    codigoServico: string;
    /** Discriminação da nota — texto livre, usado só como EXEMPLO no agrupamento. */
    descricaoNota: string;
}

export function linhasServicos(docs: DocumentoFiscal[], direcao: 'entrada' | 'saida'): LinhaServico[] {
    return docs
        // 🔴 Era `d.tipo === 'NFSe'`: a NFS-e do ADN (`tipo: 'nfseNacional'`)
        // sumia das TRÊS abas que saem daqui — Serviços tomados, prestados e
        // **Retenções**, que é a que alimenta a conferência do R-4020.
        .filter(d => docValido(d) && ehNotaDeServico(d) && direcaoDoc(d) === direcao)
        .map(d => {
            // Usa a régua única de contraparte: ela conhece tanto o schema
            // aninhado do XML quanto os campos chatos da captura NFS-e SP.
            const parte: any = contraparteDoc(d);
            const v = d.valores || {};
            const base = v.baseCalculo ?? d.valorTotal ?? 0;
            // As duas formas de gravação, lidas pelo DONO da régua.
            const fed = lerRetencoesFederaisDoDoc(d);
            // A assinatura de alíquota separa o que o campo É: CSLL de verdade,
            // total CSRF sem rateio, ou tributo da operação do prestador.
            const coer = conferirRetencaoFederal({ base, pis: fed.pis, cofins: fed.cofins, csll: fed.csllOuTotal });
            const csllEhTotal = coer.situacao === 'csll-e-o-total';
            const daOperacao = coer.situacao === 'campos-sao-totais-da-operacao';
            return {
                data: (d.dhEmi || '').slice(0, 10).split('-').reverse().join('/'),
                numero: d.numero || '—',
                participante: parte?.nome || '—',
                doc: String(parte?.cnpjCpf || '').replace(/\D/g, ''),
                municipio: parte?.municipio || '',
                base,
                // As quatro formas do ISS, lidas pelo DONO — era aqui que a
                // coluna saía 0,00 em toda nota que não veio pelo navegador.
                iss: Number.isFinite(issDoDocumento(d)) ? issDoDocumento(d) : 0,
                issRetido: Number.isFinite(issRetidoDoDocumento(d)) ? issRetidoDoDocumento(d) : 0,
                // PIS/COFINS da OPERAÇÃO não são retenção: fora das colunas e
                // dos totais, mostrados à parte (senão o relatório afirma
                // retenção que ninguém reteve — o erro que o R-4020 já barra).
                pis: daOperacao ? 0 : (fed.pis ?? 0),
                cofins: daOperacao ? 0 : (fed.cofins ?? 0),
                ir: fed.ir ?? 0,
                inss: fed.inss ?? 0,
                // "CSLL" com assinatura de 4,65% é o TOTAL das três — somar
                // como CSLL contaria PIS e COFINS em dobro (caso CLINIPAR).
                csll: (csllEhTotal || daOperacao) ? 0 : (fed.csllOuTotal ?? 0),
                liquido: v.liquido ?? d.valorTotal ?? 0,
                retencoesFederaisGravadas:
                    fed.ir !== undefined || fed.inss !== undefined || fed.csllOuTotal !== undefined,
                csrfSemRateio: (csllEhTotal || daOperacao) ? (fed.csllOuTotal ?? 0) : 0,
                pisCofinsOperacao: daOperacao ? r2((fed.pis ?? 0) + (fed.cofins ?? 0)) : 0,
                codigoServico: String((d as any).codigoServico || '').trim(),
                descricaoNota: String((d as any).discriminacao || (d as any).descricao || '').trim(),
            };
        })
        .sort((a, b) => a.data.localeCompare(b.data) || a.numero.localeCompare(b.numero));
}

// ─── Serviços agrupados por CÓDIGO DE SERVIÇO ───────────────────────────────

export interface GrupoServicoCodigo {
    /** Código municipal ('' = a nota não trouxe — trilho ADN/nota antiga). */
    codigo: string;
    rotulo: string;
    /**
     * Descrição = a DISCRIMINAÇÃO mais frequente das notas do grupo (texto
     * livre da própria nota, truncado). Não existe tabela oficial
     * código→descrição no app — inventar uma seria chute; a da nota é real e
     * vem carimbada como exemplo.
     */
    descricaoExemplo: string;
    notas: number;
    bruto: number;
    issRetido: number;
    ir: number;
    pis: number;
    cofins: number;
    csll: number;
    inss: number;
    /** Soma de TODAS as retenções do grupo (ISS retido + federais + CSRF sem rateio). */
    totalRetido: number;
    liquido: number;
    /** Notas do grupo sem IR/INSS/CSLL gravados — ausente ≠ zero retido. */
    semCamposGravados: number;
    /** Retenção CSRF sem rateio (o campo traz as três juntas) — no total, fora das colunas. */
    csrfSemRateio: number;
}

/**
 * Agrupa as NFS-e por código de serviço com subtotais (colaborador via Paulo,
 * 10/08: conferência da apuração dos impostos de serviço por código). Nota sem
 * código NÃO some: vira o grupo "Sem código de serviço" — sumir faria o total
 * bater a menor sem ninguém ver. Ordem: maior valor bruto primeiro; o grupo
 * sem código sempre por último.
 */
export function servicosPorCodigo(docs: DocumentoFiscal[], direcao: 'entrada' | 'saida'): GrupoServicoCodigo[] {
    const linhas = linhasServicos(docs, direcao);
    const grupos = new Map<string, GrupoServicoCodigo & { _descricoes: Map<string, number> }>();
    for (const l of linhas) {
        const codigo = l.codigoServico;
        if (!grupos.has(codigo)) {
            grupos.set(codigo, {
                codigo,
                rotulo: codigo ? `Cód. ${codigo}` : 'Sem código de serviço',
                descricaoExemplo: '',
                notas: 0, bruto: 0, issRetido: 0, ir: 0, pis: 0, cofins: 0, csll: 0, inss: 0,
                totalRetido: 0, liquido: 0, semCamposGravados: 0, csrfSemRateio: 0,
                _descricoes: new Map(),
            });
        }
        const g = grupos.get(codigo)!;
        g.notas += 1;
        g.bruto += l.base;
        g.issRetido += l.issRetido;
        g.ir += l.ir;
        g.pis += l.pis;
        g.cofins += l.cofins;
        g.csll += l.csll;
        g.inss += l.inss;
        g.csrfSemRateio += l.csrfSemRateio;
        g.totalRetido += l.issRetido + l.ir + l.pis + l.cofins + l.csll + l.inss + l.csrfSemRateio;
        g.liquido += l.liquido;
        if (!l.retencoesFederaisGravadas) g.semCamposGravados += 1;
        const desc = l.descricaoNota.slice(0, 80);
        if (desc) g._descricoes.set(desc, (g._descricoes.get(desc) || 0) + 1);
    }
    return Array.from(grupos.values())
        .map(({ _descricoes, ...g }) => ({
            ...g,
            descricaoExemplo: [..._descricoes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
        }))
        .sort((a, b) => {
            if (!a.codigo !== !b.codigo) return a.codigo ? -1 : 1;
            return b.bruto - a.bruto;
        });
}

/**
 * As notas com ALGUMA retenção (federal ou ISS retido) — E as que não dá pra
 * afirmar que não têm.
 *
 * Paulo, 19/08 (CLUDE, "Serviços tomados" 07/2026): o relatório voltava 0
 * NFS-e/R$ 0,00 com 67 notas no recorte inteiro — o filtro exigia
 * `soma > 0`, e nota sem IR/INSS/CSLL gravado (importada antes de 01/08)
 * soma exatamente ZERO, então CONFIRMADA-sem-retenção e
 * NÃO-SABEMOS ficavam no mesmo balde: sumido. O relatório existe pra listar
 * "as notas com os devidos impostos retidos" — sumir a nota é a forma mais
 * silenciosa de errar essa pergunta, pior que listar com o campo em branco.
 * Só fica de fora quem tem os campos GRAVADOS e a soma deu zero — aí "sem
 * retenção" é fato, não lacuna de captura.
 */
export function linhasRetencoes(docs: DocumentoFiscal[], direcao: 'entrada' | 'saida'): LinhaServico[] {
    return linhasServicos(docs, direcao)
        // csrfSemRateio conta como retenção: a nota da ATLAS tem 158,72 retidos
        // num campo só — sumir da lista porque as colunas individuais zeraram
        // seria esconder justamente a retenção que existe.
        .filter(l => !l.retencoesFederaisGravadas
            || l.issRetido + l.pis + l.cofins + l.ir + l.inss + l.csll + l.csrfSemRateio > 0);
}

export interface DiagnosticoRetencoes {
    /** NFS-e da direção no recorte (com ou sem retenção). */
    totalNotas: number;
    /** Notas com alguma retenção destacada. */
    comRetencao: number;
    /** Notas SEM os campos federais gravados — ausente ≠ zero retido. */
    semCamposGravados: number;
    /**
     * O relatório pode afirmar "não houve retenção"? Só quando TODAS as notas
     * do recorte têm os campos gravados. Com nota sem campo, "0,00" significa
     * "não foi capturado", e dizer "nenhuma retenção" é responder uma pergunta
     * que o dado não responde.
     */
    podeAfirmarZero: boolean;
    /** Frase pronta pro vazio da tela e pra observação do PDF. */
    mensagem: string;
}

/**
 * Diagnóstico do recorte de retenções.
 *
 * POR QUE EXISTE (equipe, 05/08): a aba Retenções dizia "Nenhuma NFS-e
 * prestada com retenção neste recorte" para uma empresa cujo relatório de
 * Serviços prestados, no MESMO recorte, avisava que as 9 notas foram
 * importadas antes de 01/08 e não têm IR/INSS/CSLL gravados. As duas telas
 * liam o mesmo dado e davam respostas opostas — e a errada era a que
 * AFIRMAVA. O aviso até existia, mas era contado sobre a lista JÁ FILTRADA
 * (só notas com retenção), que nesse caso é vazia: o alerta nunca aparecia
 * exatamente no caso em que ele importa.
 */
export function diagnosticoRetencoes(
    docs: DocumentoFiscal[],
    direcao: 'entrada' | 'saida',
): DiagnosticoRetencoes {
    const todas = linhasServicos(docs, direcao);
    const comRetencao = todas.filter(
        l => l.issRetido + l.pis + l.cofins + l.ir + l.inss + l.csll + l.csrfSemRateio > 0,
    ).length;
    const semCamposGravados = todas.filter(l => !l.retencoesFederaisGravadas).length;
    const podeAfirmarZero = todas.length > 0 && semCamposGravados === 0;
    const rotulo = direcao === 'entrada' ? 'tomada' : 'prestada';

    let mensagem: string;
    if (todas.length === 0) {
        mensagem = `Nenhuma NFS-e ${rotulo} neste recorte.`;
    } else if (comRetencao > 0 && semCamposGravados > 0) {
        mensagem = `${semCamposGravados} de ${todas.length} nota(s) não têm IR/INSS/CSLL gravados `
            + '(importadas antes de 01/08/2026) — pode haver retenção além da listada. '
            + 'Reimporte o XML para completar.';
    } else if (semCamposGravados > 0) {
        mensagem = `NÃO é possível afirmar que não houve retenção: ${semCamposGravados} de ${todas.length} `
            + 'nota(s) foram importadas antes de 01/08/2026 e não têm IR/INSS/CSLL gravados. '
            + 'Reimporte o XML da competência para completar.';
    } else if (comRetencao === 0) {
        mensagem = `Nenhuma das ${todas.length} NFS-e ${rotulo} do recorte tem retenção — `
            + 'todas com os campos conferidos.';
    } else {
        mensagem = `${comRetencao} de ${todas.length} NFS-e ${rotulo} com retenção.`;
    }

    return { totalNotas: todas.length, comRetencao, semCamposGravados, podeAfirmarZero, mensagem };
}

// ─── NF Saídas Canceladas/Faltantes ─────────────────────────────────────────

export interface LinhaSerieNumeracao {
    modelo: string;
    serie: string;
    /** Menor e maior número EMITIDOS pela empresa na competência. */
    primeiro: number;
    ultimo: number;
    autorizadas: number;
    canceladas: number[];
    /** Números ausentes entre primeiro..último (limitado a 500 — ver faltantesTotal). */
    faltantes: number[];
    faltantesTotal: number;
}

const LIMITE_FALTANTES = 500;

/**
 * Completude da numeração das notas EMITIDAS pela empresa (mod 55/65), por
 * série. A nota própria de entrada (tpNF=0) CONSOME número do mesmo talão —
 * por isso o recorte é "emitente == empresa", não "direção == saída".
 * Buraco ≠ nota perdida: pode ser inutilização na SEFAZ (não gera XML) ou
 * captura incompleta (cofre/autXML) — as ressalvas ficam na tela e no PDF.
 */
export function nfCanceladasFaltantes(docs: DocumentoFiscal[], empresaCnpj: string): LinhaSerieNumeracao[] {
    const cnpj = String(empresaCnpj || '').replace(/\D/g, '');
    const mapa = new Map<string, { modelo: string; serie: string; presentes: Set<number>; canceladas: Set<number> }>();
    for (const d of docs) {
        const tipoDoc = (d as any).tipoDoc || d.tipo;
        if (!['NFe', 'NFCe'].includes(tipoDoc)) continue;
        if (cnpjEmitente(d) !== cnpj) continue;
        const num = parseInt(String(d.numero || '').replace(/\D/g, ''), 10);
        if (!Number.isFinite(num) || num <= 0) continue;
        // `modelo` NÃO é campo gravado: a captura deriva da chave (pos 21-22).
        const modelo = modeloDoDoc(d) || (tipoDoc === 'NFCe' ? '65' : '55');
        const serie = String(parseInt(String(d.serie || '0').replace(/\D/g, '') || '0', 10));
        const k = `${modelo}|${serie}`;
        const g = mapa.get(k) || { modelo, serie, presentes: new Set<number>(), canceladas: new Set<number>() };
        g.presentes.add(num);
        if (docCancelado(d)) g.canceladas.add(num);
        mapa.set(k, g);
    }
    return Array.from(mapa.values()).map(g => {
        const nums = Array.from(g.presentes).sort((a, b) => a - b);
        const primeiro = nums[0], ultimo = nums[nums.length - 1];
        const faltantes: number[] = [];
        let faltantesTotal = 0;
        for (let n = primeiro; n <= ultimo; n++) {
            if (!g.presentes.has(n)) {
                faltantesTotal++;
                if (faltantes.length < LIMITE_FALTANTES) faltantes.push(n);
            }
        }
        return {
            modelo: g.modelo, serie: g.serie, primeiro, ultimo,
            autorizadas: nums.length - g.canceladas.size,
            canceladas: Array.from(g.canceladas).sort((a, b) => a - b),
            faltantes, faltantesTotal,
        };
    }).sort((a, b) => a.modelo.localeCompare(b.modelo) || Number(a.serie) - Number(b.serie));
}

/** Compacta [3,4,5,9] em "3–5, 9" (pra tela e PDF não estourarem). */
export function formatarFaixas(nums: number[]): string {
    if (!nums.length) return '';
    const faixas: string[] = [];
    let ini = nums[0], fim = nums[0];
    for (let i = 1; i <= nums.length; i++) {
        if (i < nums.length && nums[i] === fim + 1) { fim = nums[i]; continue; }
        faixas.push(ini === fim ? String(ini) : `${ini}–${fim}`);
        if (i < nums.length) { ini = nums[i]; fim = nums[i]; }
    }
    return faixas.join(', ');
}

/**
 * A CAUSA DOMINANTE do buraco de numeração — porque a lista de números, sozinha,
 * é alarme sem ação.
 *
 * Caso LAV COMÉRCIO DE AUTOPEÇAS (Eunice, 12/08): o relatório acusou **759
 * números faltantes** e ela perguntou pela sequência completa, para conferir uma
 * a uma. Mas 759 buracos contra 137 notas capturadas não é uma lista para
 * conferir — é o trilho de captura da SAÍDA que não está trazendo as notas
 * (Rej. 641: a SEFAZ não entrega ao emitente). Nesse cenário a ação é a
 * Cobertura de Saída, e caçar 759 números seria trabalho jogado fora.
 *
 * Três leituras, com ações OPOSTAS:
 *  · `captura-incompleta` — faltam mais números do que existem notas ⇒ o
 *    problema é o cofre/autXML, não a numeração;
 *  · `buraco-pontual` — poucos buracos num talão majoritariamente capturado ⇒
 *    aí sim vale conferir número a número (inutilização ou nota perdida);
 *  · `continua` — nada faltando.
 */
export type CausaFaltantes = 'captura-incompleta' | 'buraco-pontual' | 'continua';

export interface LeituraFaltantes {
    causa: CausaFaltantes;
    faltantes: number;
    capturadas: number;
    /** O que fazer — sempre uma frase, nunca uma contagem solta. */
    acao: string;
}

export function lerFaltantes(linhas: LinhaSerieNumeracao[]): LeituraFaltantes {
    const faltantes = linhas.reduce((s, l) => s + l.faltantesTotal, 0);
    const capturadas = linhas.reduce((s, l) => s + (l.ultimo - l.primeiro + 1 - l.faltantesTotal), 0);

    if (!faltantes) {
        return {
            causa: 'continua', faltantes, capturadas,
            acao: 'A numeração está contínua no recorte — nada a conferir.',
        };
    }
    if (faltantes > capturadas) {
        return {
            causa: 'captura-incompleta', faltantes, capturadas,
            acao: `Faltam MAIS números (${faltantes}) do que as notas capturadas (${capturadas}). Isto não é `
                + 'uma lista para conferir uma a uma: é o trilho de captura da SAÍDA que não está trazendo as '
                + 'notas — a SEFAZ não entrega ao emitente (Rej. 641), elas vêm pelo cofre de e-mail ou por '
                + 'autXML. Resolva em Captura → Cobertura de Saída; enquanto isso, a numeração não pode ser '
                + 'conferida.',
        };
    }
    return {
        causa: 'buraco-pontual', faltantes, capturadas,
        acao: `${faltantes} buraco(s) num talão majoritariamente capturado (${capturadas} notas). Aqui vale `
            + 'conferir número a número: cada um é inutilização na SEFAZ (não gera XML) ou nota emitida que '
            + 'não chegou.',
    };
}

// ─── Resumo por participante (fornecedor/cliente) ───────────────────────────

export interface LinhaParticipante {
    doc: string;
    nome: string;
    uf: string;
    municipio: string;
    notas: number;
    valor: number;
}

/**
 * Ranking por CONTRAPARTE (fornecedor nas entradas, cliente nas saídas) —
 * cobre os "Resumo por fornecedor/cliente" e a listagem "Clientes e
 * fornecedores" do E-Fiscal num painel só. NFe e NFSe juntas.
 */
export function resumoPorParticipante(docs: DocumentoFiscal[], direcao: 'entrada' | 'saida'): LinhaParticipante[] {
    const mapa = new Map<string, LinhaParticipante>();
    for (const d of docs) {
        if (!docValido(d) || direcaoDoc(d) !== direcao) continue;
        const parte: any = contraparteDoc(d);
        const doc = String(parte?.cnpjCpf || '').replace(/\D/g, '');
        const k = doc || `nome:${String(parte?.nome || '—').toUpperCase()}`;
        const linha = mapa.get(k) || {
            doc, nome: parte?.nome || '—', uf: String(parte?.uf || '').toUpperCase(),
            municipio: parte?.municipio || '', notas: 0, valor: 0,
        };
        linha.notas += 1;
        linha.valor = r2(linha.valor + contabilDoc(d));
        if (!linha.uf && parte?.uf) linha.uf = String(parte.uf).toUpperCase();
        if (!linha.municipio && parte?.municipio) linha.municipio = parte.municipio;
        mapa.set(k, linha);
    }
    return Array.from(mapa.values()).sort((a, b) => b.valor - a.valor);
}

// ─── Resumo por alíquota (ICMS) ─────────────────────────────────────────────

export interface LinhaAliquota {
    direcao: 'entrada' | 'saida';
    /** Alíquota em % para tributadas; null nas linhas Isentas e Outras. */
    aliquota: number | null;
    rotulo: string;
    itens: number;
    valor: number;
    base: number;
    icms: number;
}

/**
 * Base × ICMS por alíquota destacada (conferência de GIA). Mesma régua de CST
 * da alocação do Exportar SAGE: 40/41/50 = Isentas; sem destaque = Outras
 * (ST/diferimento/Simples).
 */
export function resumoPorAliquota(docs: DocumentoFiscal[]): LinhaAliquota[] {
    const mapa = new Map<string, LinhaAliquota>();
    const add = (direcao: 'entrada' | 'saida', aliquota: number | null, rotulo: string, valor: number, base: number, icms: number) => {
        const k = `${direcao}|${aliquota ?? rotulo}`;
        const linha = mapa.get(k) || { direcao, aliquota, rotulo, itens: 0, valor: 0, base: 0, icms: 0 };
        linha.itens += 1;
        linha.valor = r2(linha.valor + valor);
        linha.base = r2(linha.base + base);
        linha.icms = r2(linha.icms + icms);
        mapa.set(k, linha);
    };
    for (const d of docs) {
        const tipoDoc = (d as any).tipoDoc || d.tipo;
        if (!docValido(d) || !['NFe', 'NFCe'].includes(tipoDoc)) continue;
        const direcao = direcaoDoc(d);
        for (const it of d.itens || []) {
            const valorItem = r2((it.vProd || 0) - (it.vDesc || 0));
            const cst = String(it.cst || '').replace(/\D/g, '');
            if ((it.vICMS || 0) > 0) {
                const base = (it.vBC || 0) > 0 ? (it.vBC as number) : valorItem;
                const aliq = (it.aliqIcms || 0) > 0
                    ? r2(it.aliqIcms as number)
                    : (base > 0 ? r2(((it.vICMS || 0) / base) * 100) : null);
                add(direcao, aliq, aliq !== null ? `${aliq}%` : 'Tributadas s/ alíquota', valorItem, base, it.vICMS || 0);
            } else if (['40', '41', '50'].includes(cst)) {
                add(direcao, null, 'Isentas / não tributadas', valorItem, 0, 0);
            } else {
                add(direcao, null, 'Outras (ST · diferido · Simples)', valorItem, 0, 0);
            }
        }
    }
    return Array.from(mapa.values()).sort((a, b) =>
        a.direcao.localeCompare(b.direcao)
        || (b.aliquota ?? -1) - (a.aliquota ?? -1)
        || a.rotulo.localeCompare(b.rotulo));
}

// ─── Lançamento por produto (NCM) ───────────────────────────────────────────

export interface LinhaProduto {
    produto: string;
    ncm: string;
    cfops: string;
    unidade: string;
    qtd: number;
    itens: number;
    notas: number;
    valor: number;
}

/**
 * Agregado por produto (NCM + descrição), com quantidade quando a unidade é única.
 *
 * `ctx` é obrigatório pelo mesmo motivo do `resumoPorCfop`: a coluna CFOP das
 * ENTRADAS mostra o correlacionado. Sem isto, esta aba exibiria `5102` para a
 * mesma nota em que o Livro exibe `1102` — duas telas discordando sobre o
 * mesmo documento, que é o defeito que este projeto mais paga caro.
 */
export function resumoPorProduto(docs: DocumentoFiscal[], direcao: 'entrada' | 'saida', ctx: CtxCorrelacao): LinhaProduto[] {
    const mapa = new Map<string, LinhaProduto & { _unidades: Set<string>; _cfops: Set<string>; _notas: Set<string> }>();
    for (const d of docs) {
        const tipoDoc = (d as any).tipoDoc || d.tipo;
        if (!docValido(d) || direcaoDoc(d) !== direcao || !['NFe', 'NFCe'].includes(tipoDoc)) continue;
        for (const it of d.itens || []) {
            const produto = String(it.xProd || '—').trim().toUpperCase();
            const ncm = String(it.ncm || '').replace(/\D/g, '');
            const k = `${ncm}|${produto}`;
            const linha = mapa.get(k) || {
                produto, ncm: ncm || '—', cfops: '', unidade: '', qtd: 0, itens: 0, notas: 0, valor: 0,
                _unidades: new Set<string>(), _cfops: new Set<string>(), _notas: new Set<string>(),
            };
            linha.itens += 1;
            linha.qtd = r2(linha.qtd + (it.qCom || 0));
            linha.valor = r2(linha.valor + (it.vProd || 0) - (it.vDesc || 0));
            if (it.uCom) linha._unidades.add(String(it.uCom).trim().toUpperCase());
            if (it.cfop) {
                const cru = String(it.cfop).replace(/\D/g, '');
                linha._cfops.add(String(cfopDoLancamento(d, cru, direcao, ctx) || cru));
            }
            linha._notas.add(d.id || d.chave);
            mapa.set(k, linha);
        }
    }
    return Array.from(mapa.values()).map(l => ({
        produto: l.produto, ncm: l.ncm,
        cfops: Array.from(l._cfops).sort().join(' '),
        unidade: l._unidades.size === 1 ? Array.from(l._unidades)[0] : (l._unidades.size ? 'várias' : '—'),
        qtd: l.qtd, itens: l.itens, notas: l._notas.size, valor: l.valor,
    })).sort((a, b) => b.valor - a.valor);
}

// ─── Resumo por UF ──────────────────────────────────────────────────────────

export interface LinhaUf {
    uf: string;
    entradasQtd: number;
    entradasValor: number;
    saidasQtd: number;
    saidasValor: number;
}

export function resumoPorUf(docs: DocumentoFiscal[]): LinhaUf[] {
    const mapa = new Map<string, LinhaUf>();
    for (const d of docs) {
        if (!docValido(d)) continue;
        const parte = contraparteDoc(d);
        const uf = String(parte?.uf || '').toUpperCase() || '??';
        const linha = mapa.get(uf) || { uf, entradasQtd: 0, entradasValor: 0, saidasQtd: 0, saidasValor: 0 };
        const valor = contabilDoc(d);
        if (direcaoDoc(d) === 'saida') { linha.saidasQtd++; linha.saidasValor = r2(linha.saidasValor + valor); }
        else { linha.entradasQtd++; linha.entradasValor = r2(linha.entradasValor + valor); }
        mapa.set(uf, linha);
    }
    return Array.from(mapa.values()).sort((a, b) =>
        (b.saidasValor + b.entradasValor) - (a.saidasValor + a.entradasValor));
}
