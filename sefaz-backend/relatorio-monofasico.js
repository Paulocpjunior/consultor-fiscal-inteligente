// ─────────────────────────────────────────────────────────────────────────────
// sefaz-backend/relatorio-monofasico.js  (PURO — testável)
//
// 🧪 RELATÓRIO GERENCIAL PIS/COFINS: MONOFÁSICO × TRIBUTADO, COM AS DEVOLUÇÕES.
//
// Paulo, 30/09 (UNIKE COMERCIO DE AUTO PECAS · 08/2026): *"gerei o arquivo EFD
// da UNIKE pelo consultor e vem com tudo certinho … mas tem as devoluções que
// não foram reconhecidas no arquivo … os blocos M220 e M620 foram preenchidos
// manualmente no PVA. Para conseguir realizar a apuração preciso de um
// relatório gerencial para identificar os produtos monofásicos e não
// monofásicos, e separar as receitas tributadas das não tributadas."*
//
// ═══ O QUE O ARQUIVO DELE PROVA ════════════════════════════════════════════
//
// M210 (gerado)  base 443.324,94 × 0,65% = 2.881,61
// M220 (manual)  redução 15,35   → 2.361,61 × 0,65%
// M620 (manual)  redução 70,85   → 2.361,61 × 3%
//
// e os 2.361,61 são EXATAMENTE as devoluções (CFOP 1411) cujo NCM a própria
// UNIKE vende com CST 01 (rolamentos 8482.10.10 + 8482.20.10); o resto das
// devoluções (4.333,33 — radiadores, cubos, kits 8708) ela vende com CST 04.
// Total 6.694,94 = a "Dedução Devoluções" da memória de apuração.
//
// ═══ AS RÉGUAS ═════════════════════════════════════════════════════════════
//
// · A SAÍDA é classificada pelo CST que o ARQUIVO declara — lido do dono
//   (`lerPisCofinsDosItens` do sped-contrib-blocos), que já aplicou o
//   cadastro de CST padrão da empresa. Relatório com conta própria divergiria
//   do M210 no primeiro ajuste de base.
// · A DEVOLUÇÃO DE VENDA é identificada pela DESCRIÇÃO OFICIAL do CFOP lançado
//   ("Devolução de venda…"), nunca por lista digitada.
// · A devolução volta com o código de produto do CLIENTE e o CST dele — então
//   o que liga a devolução à venda é o NCM: ela herda a classe com que a
//   EMPRESA vendeu aquele NCM no mês. **Alerta, nunca contorno:** NCM vendido
//   com duas classes (ambígua) ou não vendido no mês fica PENDENTE, dito, e
//   FORA do ajuste sugerido — nunca chutado.
// ─────────────────────────────────────────────────────────────────────────────

import { textoDoCfop } from './cfop-catalogo.js';
import { selecionarNotasBlocoC, codItemDoItem } from './sped-selecao-documentos.js';
import { docCancelado, direcaoEfetivaDoc } from './xml-metadata-helper.js';
import { normalizarParticipantesDoc } from './dipam-produtor-rural.js';
import { participanteDoDocumento } from './participante-doc-helper.js';
import { convertCfopParaEntrada } from './sped-fiscal-blocoC.js';
import { lerPisCofinsDosItens } from './sped-contrib-blocos.js';

/** As classes de receita, na ordem em que o relatório as mostra. */
export const CLASSES_RECEITA = Object.freeze({
    tributada: 'Tributada (CST 01/02/03/05)',
    monofasica: 'Monofásica — alíquota zero na revenda (CST 04)',
    'nao-tributada': 'Não tributada (CST 06/07/08/09)',
    outras: 'Outras saídas — não é receita (CST 49/99…)',
});

/** Devolução pendente: a classe não se decide sem a pessoa. */
export const PENDENCIAS_DEVOLUCAO = Object.freeze({
    ambigua: 'NCM vendido no mês com mais de uma classe — classifique a devolução à mão',
    'sem-venda': 'NCM sem venda no mês — não há de onde herdar a classe',
});

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

/** Classe da receita pelo CST PIS de SAÍDA. */
export function classeDoCstDeSaida(cst) {
    const c = String(cst || '').padStart(2, '0');
    if (['01', '02', '03', '05'].includes(c)) return 'tributada';
    if (c === '04') return 'monofasica';
    if (['06', '07', '08', '09'].includes(c)) return 'nao-tributada';
    return 'outras';
}

/** CFOP de ENTRADA cuja descrição oficial é "Devolução de venda…". */
export function ehCfopDevolucaoDeVenda(cfop) {
    const c = soDigitos(cfop);
    if (!/^[123]\d{3}$/.test(c)) return false;
    const d = textoDoCfop(c);
    return !!(d && d.temDescricao && /^devolu[çc][ãa]o de venda/i.test(String(d.texto || '')));
}

/**
 * Lê do período as linhas que interessam: SAÍDAS e DEVOLUÇÕES DE VENDA, item a
 * item, com o CST, a base e o valor que o arquivo declara.
 *
 * @param {object} dados o `dados` do `coletarDadosContribuicoes`
 */
export function linhasDoPeriodo(dados) {
    const linhas = [];
    const cnpj = dados?.empresa?.cnpj;
    const { notas } = selecionarNotasBlocoC(dados?.notas || [], cnpj);
    for (const notaCrua of notas) {
        if (docCancelado(notaCrua) || notaCrua.status === 'denegado') continue;
        const nota = normalizarParticipantesDoc(notaCrua);
        const direcao = direcaoEfetivaDoc(nota);
        const itens = nota.itens || [];
        if (!itens.length) continue;
        const cfops = itens.map((item) => convertCfopParaEntrada(item.cfop || item.CFOP || '0000', direcao, dados, nota, item));
        if (direcao !== 'saida' && !cfops.some(ehCfopDevolucaoDeVenda)) continue;
        const { liquidosDosItens, descontosPorItem, pisCofinsDosItens } = lerPisCofinsDosItens(nota, direcao, dados);
        const part = participanteDoDocumento(nota, cnpj) || {};
        itens.forEach((item, k) => {
            const cfop = cfops[k];
            const devolucao = direcao !== 'saida' && ehCfopDevolucaoDeVenda(cfop);
            if (direcao !== 'saida' && !devolucao) return;
            const p = pisCofinsDosItens[k] || {};
            const liquido = Number(liquidosDosItens[k]) || 0;
            const icms = Number(item.vICMS) || 0;
            linhas.push({
                tipo: devolucao ? 'devolucao' : 'saida',
                numero: String(nota.numero || nota.nNF || ''),
                chave: String(nota.chaveAcesso || nota.chave || ''),
                emissao: String(nota.dataEmissao || nota.dhEmi || '').slice(0, 10),
                cnpjParticipante: soDigitos(part.cnpjCpf || part.cnpj || part.cpf),
                nomeParticipante: String(part.nome || part.razaoSocial || part.xNome || ''),
                ufParticipante: String(part.uf || part.UF || ''),
                cfop,
                codigo: codItemDoItem(item),
                descricao: String(item.xProd || item.descricao || ''),
                ncm: soDigitos(item.ncm || item.NCM),
                quantidade: Number(item.qCom || item.quantidade || 0) || 0,
                valorItem: Number(item.vProd || item.valor || 0) || 0,
                desconto: Number(descontosPorItem[k]) || 0,
                liquido,
                icms,
                cstPis: String(p.cstPis || ''),
                cstCofins: String(p.cstCofins || ''),
                // Saída: a base e o valor que o C170 declara. Devolução: a base
                // que ela tira (líquido − ICMS, a régua do Tema 69 da saída).
                base: devolucao ? Math.max(0, liquido - icms) : (Number(p.basePis) || 0),
                pis: devolucao ? 0 : (Number(p.vlPis) || 0),
                cofins: devolucao ? 0 : (Number(p.vlCofins) || 0),
            });
        });
    }
    return linhas;
}

/**
 * Classifica e soma. Devolve as linhas classificadas, os totais por classe, o
 * resumo por NCM, as pendências e o AJUSTE DE REDUÇÃO sugerido (M220/M620).
 *
 * @param {Array} linhas `linhasDoPeriodo`
 * @param {{aliquotas?: {pis: number, cofins: number}}} [opts] frações (0,0065)
 */
export function montarRelatorioMonofasico(linhas, { aliquotas = { pis: 0.0065, cofins: 0.03 } } = {}) {
    const lista = Array.isArray(linhas) ? linhas : [];
    // 1. A classe com que a EMPRESA vendeu cada NCM no mês.
    const classesPorNcm = new Map();
    for (const l of lista) {
        if (l.tipo !== 'saida') continue;
        const classe = classeDoCstDeSaida(l.cstPis);
        l.classe = classe;
        if (classe === 'outras' || !l.ncm) continue;
        if (!classesPorNcm.has(l.ncm)) classesPorNcm.set(l.ncm, new Set());
        classesPorNcm.get(l.ncm).add(classe);
    }
    // 2. A devolução herda — ou fica pendente, dita.
    for (const l of lista) {
        if (l.tipo !== 'devolucao') continue;
        const cls = classesPorNcm.get(l.ncm);
        if (cls && cls.size === 1) {
            l.classe = [...cls][0];
            l.origemClasse = `NCM ${l.ncm} vendido no mês como ${l.classe}`;
        } else {
            l.classe = null;
            l.pendencia = cls && cls.size > 1 ? 'ambigua' : 'sem-venda';
            l.origemClasse = PENDENCIAS_DEVOLUCAO[l.pendencia];
        }
    }

    const vazio = () => ({ itens: 0, valor: 0, base: 0, pis: 0, cofins: 0 });
    const receitas = Object.fromEntries(Object.keys(CLASSES_RECEITA).map((k) => [k, vazio()]));
    const devolucoes = Object.fromEntries(Object.keys(CLASSES_RECEITA).filter((k) => k !== 'outras').map((k) => [k, vazio()]));
    const pendentes = vazio();
    const porNcm = new Map();
    for (const l of lista) {
        const alvo = l.tipo === 'saida' ? receitas[l.classe] : (l.classe ? devolucoes[l.classe] : pendentes);
        if (!alvo) continue;
        alvo.itens += 1;
        alvo.valor += l.liquido;
        alvo.base += l.base;
        alvo.pis += l.pis;
        alvo.cofins += l.cofins;
        const chave = l.ncm || '(sem NCM)';
        if (!porNcm.has(chave)) {
            porNcm.set(chave, { ncm: chave, classes: [...(classesPorNcm.get(l.ncm) || [])], saidas: 0, devolucoes: 0, itens: 0, descricao: l.descricao });
        }
        const n = porNcm.get(chave);
        n.itens += 1;
        if (l.tipo === 'saida') n.saidas += l.liquido; else n.devolucoes += l.liquido;
    }
    const arredondar = (o) => { for (const k of ['valor', 'base', 'pis', 'cofins']) o[k] = r2(o[k]); return o; };
    Object.values(receitas).forEach(arredondar);
    Object.values(devolucoes).forEach(arredondar);
    arredondar(pendentes);

    // 3. O ajuste de redução que o M220/M620 pede: devolução TRIBUTADA × alíquota.
    const baseDevTributada = devolucoes.tributada.base;
    const ajuste = {
        base: r2(baseDevTributada),
        pis: r2(baseDevTributada * aliquotas.pis),
        cofins: r2(baseDevTributada * aliquotas.cofins),
    };
    const apurado = { pis: receitas.tributada.pis, cofins: receitas.tributada.cofins };
    const avisos = [];
    if (pendentes.itens > 0) {
        avisos.push(`${pendentes.itens} item(ns) de devolução PENDENTE(S) (R$ ${pendentes.valor.toFixed(2).replace('.', ',')}) — `
            + 'NCM sem venda no mês ou vendido com duas classes. Estão FORA do ajuste sugerido: classifique-os antes de fechar o M220/M620.');
    }
    if (!lista.some((l) => l.tipo === 'saida')) avisos.push('Nenhuma saída no período — o relatório não tem receita para classificar.');

    return {
        linhas: lista,
        receitas,
        devolucoes,
        pendentes,
        porNcm: [...porNcm.values()]
            .map((n) => ({ ...n, saidas: r2(n.saidas), devolucoes: r2(n.devolucoes) }))
            .sort((a, b) => (b.saidas + b.devolucoes) - (a.saidas + a.devolucoes)),
        receitaLiquidaTributada: r2(receitas.tributada.valor - devolucoes.tributada.valor),
        receitaLiquidaMonofasica: r2(receitas.monofasica.valor - devolucoes.monofasica.valor),
        ajusteReducao: ajuste,
        apurado: { pis: r2(apurado.pis), cofins: r2(apurado.cofins) },
        aRecolher: { pis: r2(apurado.pis - ajuste.pis), cofins: r2(apurado.cofins - ajuste.cofins) },
        aliquotas,
        avisos,
    };
}

const CABECALHO_CSV = [
    'Tipo', 'Emissão', 'Nº da NF', 'Chave', 'CNPJ/CPF participante', 'Razão social', 'UF', 'CFOP',
    'Código produto', 'Descrição produto', 'NCM', 'Quantidade', 'Valor do item', 'Desconto', 'Valor líquido',
    'Valor ICMS', 'Base PIS/COFINS', 'CST PIS', 'CST COFINS', 'Classe', 'Valor PIS', 'Valor COFINS', 'Origem da classe',
];

/** CSV (`;`, decimal com vírgula) — o formato do relatório que a equipe já usa. */
export function csvDoRelatorio(rel) {
    const num = (v, d = 2) => (Number(v) || 0).toFixed(d).replace('.', ',');
    const txt = (s) => {
        const t = String(s ?? '');
        return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const dataBr = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : iso);
    const rotulo = (l) => (l.classe ? (CLASSES_RECEITA[l.classe] || l.classe).split(' (')[0].split(' —')[0] : 'PENDENTE');
    const linhas = [CABECALHO_CSV.join(';')];
    for (const l of rel.linhas || []) {
        linhas.push([
            l.tipo === 'saida' ? 'SAÍDA' : 'DEVOLUÇÃO DE VENDA', dataBr(l.emissao), txt(l.numero),
            // Apóstrofo na frente: a planilha não vira a chave em notação científica.
            l.chave ? `'${l.chave}` : '', l.cnpjParticipante, txt(l.nomeParticipante), l.ufParticipante, l.cfop,
            txt(l.codigo), txt(l.descricao), l.ncm, num(l.quantidade, 4), num(l.valorItem), num(l.desconto), num(l.liquido),
            num(l.icms), num(l.base), l.cstPis, l.cstCofins, rotulo(l), num(l.pis), num(l.cofins), txt(l.origemClasse || ''),
        ].join(';'));
    }
    return linhas.join('\r\n') + '\r\n';
}
