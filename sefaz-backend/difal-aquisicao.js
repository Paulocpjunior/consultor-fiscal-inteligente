// ============================================================================
// sefaz-backend/difal-aquisicao.js  (PURO — testável)
//
// DIFAL de AQUISIÇÃO interestadual do SIMPLES (destinatário SP) — desenho do
// Alexandre (03/08): consolidado NO MÊS (consumo E revenda) numa guia; a
// antecipação do art. 426-A (mercadoria com ST) é INDIVIDUAL por documento e
// fica FORA da consolidação — aqui ela é separada e sinalizada.
//
// Base legal (SP): RICMS-SP art. 115, XV-A (equalização do Simples) e
// art. 426-A (antecipação com ST). Alíquota interestadual de ORIGEM → SP:
// Sul/Sudeste (exceto ES) = 12%; demais + ES = 7%; mercadoria importada
// (orig 1/2/3/8) = 4% (Res. SF 13/2012). DIFAL = base × (interna − inter).
//
// Farol honesto: a alíquota INTERNA padrão é 18% e é EDITÁVEL por nota —
// NCM com 12%/25%/redução exige ajuste humano, e a tela avisa isso. Sem
// pICMS destacado no item, a interestadual é derivada da UF+origem e a
// linha é marcada `aliqInterDerivada`.
// ============================================================================

import {
    cnpjEmitente, nomeEmitente, ufEmitente, modeloDoDoc,
} from './participante-doc-helper.js';
import { classificarItensDifal } from './difal-itens.js';

const so = (v) => String(v || '').replace(/\D/g, '');
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);

/** UFs cuja saída para SP é 12% (Sul/Sudeste, exceto ES). */
const UF_INTER_12 = new Set(['SP', 'RJ', 'MG', 'RS', 'SC', 'PR']);
/** Origem do produto que força 4% (importado/conteúdo importação >40%). */
const ORIG_4PCT = new Set(['1', '2', '3', '8']);

export const ALIQ_INTERNA_PADRAO_SP = 18;

/** Alíquota interestadual do item: destacada na nota vence; senão deriva. */
export function aliqInterestadualDoItem(item, ufOrigem) {
    const destacada = Number(item?.aliqIcms) || 0;
    if (destacada > 0) return { aliq: destacada, derivada: false };
    if (ORIG_4PCT.has(String(item?.orig ?? ''))) return { aliq: 4, derivada: true };
    return { aliq: UF_INTER_12.has(String(ufOrigem || '').toUpperCase()) ? 12 : 7, derivada: true };
}

/**
 * Apuração mensal consolidada do DIFAL de aquisição (cliente do Simples).
 * @param {object} p
 * @param {Array}  p.docs               documentos completos da empresa×competência
 * @param {object} p.empresa            {cnpj, uf}
 * @param {number} [p.aliqInternaPadrao] 18 (SP) — editável na tela
 * @param {Record<string, number>} [p.aliqInternaPorChave] override por nota
 */
export function montarDifalMensal({ docs, empresa, aliqInternaPadrao = ALIQ_INTERNA_PADRAO_SP, aliqInternaPorChave = {} }) {
    const cnpjEmpresa = so(empresa?.cnpj);
    const ufEmpresa = String(empresa?.uf || '').toUpperCase();
    const linhas = [];
    const antecipacaoIndividual = [];
    const avisos = [];
    if (ufEmpresa && ufEmpresa !== 'SP') {
        avisos.push(`Empresa de ${ufEmpresa}: a régua deste painel é calibrada pra destinatário SP (art. 115, XV-A) — confira a regra do estado antes de usar.`);
    }

    for (const d of docs || []) {
        if (CANCELADOS.has(d?.status)) continue;
        if (modeloDoDoc(d) !== '55') continue;
        // Emitente pela RÉGUA ÚNICA: objeto (importação por XML) OU campo
        // achatado (captura SEFAZ). Ler só o objeto descartava TODA nota
        // capturada da SEFAZ em silêncio — o painel dizia "0 clientes com
        // compra interestadual" com a nota na tela (caso 04/08, NF 110497
        // RJ→SP da SAINT PATRICK).
        const emitDoc = cnpjEmitente(d);
        // Entrada de TERCEIRO: emitente é outro CNPJ (nota própria tpNF=0 fora).
        if (!emitDoc || emitDoc === cnpjEmpresa || emitDoc.length !== 14) continue;
        // UF do emitente cai na CHAVE quando o cadastro não veio: as 2
        // primeiras posições são o cUF, e documento da SEFAZ sempre tem chave.
        const ufOrigem = ufEmitente(d);
        if (!ufOrigem || ufOrigem === ufEmpresa) continue;

        // POR ITEM (Paulo, 04/08): uma nota pode ter item com ST e item sem —
        // NF 6831 tem CFOP 6102 (sem ST) e 6403 (com ST) na mesma folha.
        // Classificar no nível do DOCUMENTO jogava a nota inteira para um
        // lado só, e um dos dois grupos ia parar no trilho errado.
        let { comSt, semSt, mista } = classificarItensDifal(d);

        // ST no TOTAL da nota mas nenhum item destacando: captura antiga
        // (itens sem CST/vICMSST). Não dá pra partir com segurança — e as
        // duas saídas silenciosas são ruins: mandar tudo pro consolidado
        // ignora a ST, mandar tudo pro 426-A é a aglutinação que estamos
        // consertando. Vai pro 426-A (o lado que NÃO subtributa) e a linha
        // sai marcada pra conferência humana.
        const stNoTotal = num(d?.totais?.vST) > 0 || num(d?.totais?.vBCST) > 0;
        const stSemDetalhePorItem = stNoTotal && comSt.length === 0;
        if (stSemDetalhePorItem) {
            comSt = semSt;
            semSt = [];
            mista = false;
            avisos.push(
                `NF ${d.numero || d.chave}: a nota tem ST no total (R$ ${r2(num(d?.totais?.vST))}) mas nenhum `
                + 'item traz o destaque — provavelmente captura antiga. Ela foi inteira para o 426-A '
                + '(o lado que não subtributa); confira item a item antes de recolher.',
            );
        }

        const chave = d.chave || d.id;
        const aliqInterna = Number(aliqInternaPorChave[chave]) > 0
            ? Number(aliqInternaPorChave[chave])
            : aliqInternaPadrao;

        const cabecalho = {
            chave,
            numero: d.numero || '—',
            dhEmi: d.dhEmi || null,
            fornecedor: nomeEmitente(d) || '—',
            fornecedorDoc: emitDoc,
            ufOrigem,
            itensTotal: (d.itens || []).length,
            notaMista: mista,
            stSemDetalhePorItem,
        };

        // ── Consolidado do mês: SÓ os itens sem ST ──────────────────────────
        let base = 0;
        let difal = 0;
        let algumaDerivada = false;
        const detalheSemSt = [];
        for (const it of semSt) {
            if (it.valorProduto <= 0) continue;
            const { aliq, derivada } = aliqInterestadualDoItem(
                { aliqIcms: it.aliqIcms, orig: it.orig }, ufOrigem,
            );
            algumaDerivada = algumaDerivada || derivada;
            base = r2(base + it.valorProduto);
            const difalItem = r2(Math.max(0, it.valorProduto * (aliqInterna - aliq) / 100));
            difal = r2(difal + difalItem);
            detalheSemSt.push({
                nItem: it.nItem, cProd: it.cProd, xProd: it.xProd, ncm: it.ncm,
                cfop: it.cfop, cst: it.cst, base: it.valorProduto,
                aliqInterestadual: aliq, aliqInterDerivada: derivada, difal: difalItem,
            });
        }
        if (base > 0) {
            linhas.push({
                ...cabecalho,
                base,
                aliqInterna,
                aliqInterDerivada: algumaDerivada,
                difal: r2(difal),
                itens: detalheSemSt,
                itensConsiderados: detalheSemSt.length,
            });
        }

        // ── 426-A: SÓ os itens com ST, cada um com seu NCM ──────────────────
        if (comSt.length > 0) {
            antecipacaoIndividual.push({
                ...cabecalho,
                base: r2(comSt.reduce((sm, i) => sm + i.valorProduto, 0)),
                aliqInterna,
                aliqInterDerivada: false,
                difal: 0,   // a conta do 426-A é outra (IVA-ST) e é por item
                itens: comSt.map((it) => ({
                    nItem: it.nItem, cProd: it.cProd, xProd: it.xProd, ncm: it.ncm,
                    cfop: it.cfop, cst: it.cst,
                    valorAquisicao: it.valorAquisicao,
                    icmsPago: it.vICMS,
                    aliqIcms: it.aliqIcms,
                    orig: it.orig,
                    encargosRateados: it.encargosRateados,
                })),
                itensConsiderados: comSt.length,
            });
        }
        continue;
    }

    linhas.sort((a, b) => String(a.dhEmi || '').localeCompare(String(b.dhEmi || '')));
    antecipacaoIndividual.sort((a, b) => String(a.dhEmi || '').localeCompare(String(b.dhEmi || '')));

    return {
        linhas,
        totalBase: r2(linhas.reduce((s, l) => s + l.base, 0)),
        totalDifal: r2(linhas.reduce((s, l) => s + l.difal, 0)),
        antecipacaoIndividual,
        avisos,
        ressalvas: [
            'Alíquota interna padrão 18% — NCM com 12%/25% ou redução de base exige ajuste na linha antes de gerar a guia.',
            'A classificação é POR ITEM: numa mesma nota, o item COM ST vai para o 426-A e o item SEM ST entra no consolidado. Nota com os dois tipos aparece nas DUAS listas — é o certo, não é duplicidade.',
            'O IVA-ST é do SEGMENTO da mercadoria (NCM), então é informado item a item: dois NCMs na mesma nota podem ter IVA-ST diferentes.',
            'Base = valor dos produtos (− desconto). Frete/despesas destacados à parte não entram nesta conta — confira caso a caso.',
        ],
    };
}
