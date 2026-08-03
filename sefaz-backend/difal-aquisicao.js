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

const so = (v) => String(v || '').replace(/\D/g, '');
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
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
        if (String(d?.modelo || (d?.tipo === 'NFCe' ? '65' : '55')) !== '55') continue;
        const emitDoc = so(d?.emitente?.cnpjCpf);
        // Entrada de TERCEIRO: emitente é outro CNPJ (nota própria tpNF=0 fora).
        if (!emitDoc || emitDoc === cnpjEmpresa || emitDoc.length !== 14) continue;
        const ufOrigem = String(d?.emitente?.uf || '').toUpperCase();
        if (!ufOrigem || ufOrigem === ufEmpresa) continue;

        const temSt = (Number(d?.totais?.vST) || 0) > 0
            || (Number(d?.totais?.vBCST) || 0) > 0
            || (d?.itens || []).some((i) => (Number(i?.vICMSST) || 0) > 0);

        const chave = d.chave || d.id;
        const aliqInterna = Number(aliqInternaPorChave[chave]) > 0
            ? Number(aliqInternaPorChave[chave])
            : aliqInternaPadrao;

        let base = 0;
        let difal = 0;
        let algumaDerivada = false;
        for (const it of d.itens || []) {
            const baseItem = r2((Number(it?.vProd) || 0) - (Number(it?.vDesc) || 0));
            if (baseItem <= 0) continue;
            const { aliq, derivada } = aliqInterestadualDoItem(it, ufOrigem);
            algumaDerivada = algumaDerivada || derivada;
            base = r2(base + baseItem);
            difal = r2(difal + Math.max(0, baseItem * (aliqInterna - aliq) / 100));
        }
        if (base <= 0) continue;

        const linha = {
            chave,
            numero: d.numero || '—',
            dhEmi: d.dhEmi || null,
            fornecedor: d?.emitente?.nome || '—',
            fornecedorDoc: emitDoc,
            ufOrigem,
            base,
            aliqInterna,
            aliqInterDerivada: algumaDerivada,
            difal: r2(difal),
        };
        if (temSt) antecipacaoIndividual.push(linha);
        else linhas.push(linha);
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
            'Nota com ST destacada fica FORA da consolidação: a antecipação do art. 426-A é individual por documento (e a conta com IVA-ST é outra — fase 2).',
            'Base = valor dos produtos (− desconto). Frete/despesas destacados à parte não entram nesta conta — confira caso a caso.',
        ],
    };
}
