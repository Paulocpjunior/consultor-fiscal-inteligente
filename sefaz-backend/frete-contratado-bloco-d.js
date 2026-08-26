// ============================================================================
// sefaz-backend/frete-contratado-bloco-d.js
//
// 🚨 O BLOCO D DO EFD-CONTRIBUIÇÕES NÃO É "O CT-e DO MÊS" — É A AQUISIÇÃO DE
//    FRETE QUE DÁ DIREITO A CRÉDITO. E o gerador tratava como se fosse o
//    primeiro.
//
// ═══ AS DUAS FONTES, LITERAIS ════════════════════════════════════════════════
//
// 📖 **Guia Prático da EFD-Contribuições 1.35, Registro D100, Observações**:
//    *"Só devem ser relacionados neste registro as aquisições de serviços de
//    transportes que, de acordo com a legislação tributária, confiram direito
//    ao crédito do PIS/Pasep e da Cofins."*
//    E o campo 02 (IND_OPER) tem **um único valor válido: [0] — Aquisição**.
//
// 📖 **Manual do Lucro Presumido (PVA 2.04)**, ao listar os registros do
//    regime CUMULATIVO: Bloco 0, Bloco F, Bloco M e Bloco P, mais os
//    complementares 0200, 0500, F525, F600, 1010/1020, 1800 e 1900.
//    **O bloco D não está lá** — e não podia estar: crédito só existe no
//    regime NÃO-CUMULATIVO.
//
// ═══ O QUE ISSO SIGNIFICA, E O QUE O GERADOR FAZIA ═══════════════════════════
//
// (1) **Em empresa do LUCRO PRESUMIDO o bloco D não sai.** O gerador emitia
//     D100 para qualquer CT-e, em qualquer regime — e as CINCO empresas com
//     EFD-Contribuições fechado por recibo (MANTOAN, HS, AFFITTARE, PEC, CF
//     BANK) são todas cumulativas. Nenhuma tinha CT-e no período, e foi só por
//     isso que a recusa não chegou: é a MESMA da PEC/AFFITTARE — *"O registro
//     não deve ser informado para esse perfil e/ou tipo de operação"*.
//
// (2) **CT-e de SAÍDA nunca vai ao D100.** O gerador escrevia `IND_OPER = 1`
//     na prestação — valor que não existe no campo. Quem presta serviço de
//     transporte escritura a receita no **D200**, que este app não gera; a
//     ausência sai NOMEADA, nunca como um D100 inválido.
//
// (3) **D100 sem D101/D105 é registro pela metade.** O Guia é literal:
//     *"Para cada documento informado e relacionado em cada registro D100,
//     obrigatoriamente deve ser apresentado o detalhamento das informações,
//     por item do documento, referentes ao PIS/Pasep (D101) e à Cofins
//     (D105)"*. O gerador nunca emitiu nenhum dos dois — ele empurrava
//     PIS/COFINS para dentro do próprio D100, em campos de ICMS.
//
// ═══ O QUE O APP SE RECUSA A DEDUZIR ════════════════════════════════════════
//
// Três campos de TABELA OFICIAL, e nenhum deles está no XML do CT-e:
//
//   · **IND_NAT_FRT** (D101/D105 campo 02) — a natureza do frete CONTRATADO.
//     Ela descreve o que a empresa fez com aquele frete (venda? compra?
//     transferência?), não o que o transportador fez. Valores [0,1,2,3,4,5,9].
//   · **IND_FRT** (D100 campo 17) — por conta de quem corre o frete.
//     Valores [0,1,2,9], com a redação de 01/07/2012.
//   · **NAT_BC_CRED** (D101/D105 campo 05) — Tabela **4.3.7**, que NÃO está
//     neste repo (o Guia só a referencia).
//
// É a disciplina que fechou o 1900 da AFFITTARE na PRIMEIRA rodada do PVA:
// **código de tabela oficial vem do CADASTRO, nunca da minha memória.** Sem
// eles o CT-e **não entra** e a falta vira aviso com o lugar de preencher.
//
// ⚠️ E o indicador **9 (Outras)** é recusado de propósito: o Guia o amarra à
// SUBCONTRATAÇÃO de transporte, que tem crédito PRESUMIDO com alíquota
// diferenciada (1,2375% / 5,7%, Tabela 4.3.17) e CST 60-66. Tratá-lo como os
// outros declararia crédito na alíquota errada — e o app não tem como saber
// se aquele frete é subcontratação.
// ============================================================================

/** IND_NAT_FRT — D101/D105 campo 02 (Guia 1.35, valores válidos [0,1,2,3,4,5,9]). */
export const INDICADORES_NATUREZA_FRETE = Object.freeze({
    0: 'Operações de vendas, com ônus suportado pelo estabelecimento vendedor',
    1: 'Operações de vendas, com ônus suportado pelo adquirente',
    2: 'Operações de compras (bens para revenda, matérias-primas e outros produtos, GERADORES de crédito)',
    3: 'Operações de compras (bens para revenda, matérias-primas e outros produtos, NÃO geradores de crédito)',
    4: 'Transferência de produtos acabados entre estabelecimentos da pessoa jurídica',
    5: 'Transferência de produtos em elaboração entre estabelecimentos da pessoa jurídica',
    9: 'Outras (inclui a subcontratação de transporte — crédito presumido)',
});

/** IND_FRT — D100 campo 17, redação a partir de 01/07/2012 (Guia 1.35). */
export const INDICADORES_TIPO_FRETE = Object.freeze({
    0: 'Por conta do emitente',
    1: 'Por conta do destinatário/remetente',
    2: 'Por conta de terceiros',
    9: 'Sem cobrança de frete',
});

/**
 * Naturezas que o Guia diz NÃO gerarem crédito.
 *
 * 📖 D101, campo 02: *"As operações que não tem previsão de apuração de
 * crédito devem ser informadas com o CST '70' (operações de aquisição sem
 * direito a crédito)"*, dito no parágrafo que trata dos indicadores 4 e 5.
 * O indicador **3** se autodeclara ("não geradores de crédito"), e o **1**
 * põe o ônus no ADQUIRENTE — ou seja, quem escritura não pagou o frete.
 */
const NATUREZAS_SEM_CREDITO = new Set(['1', '3', '4', '5']);

/** Naturezas em que o ônus é de quem escritura e a legislação prevê crédito. */
const NATUREZAS_COM_CREDITO = new Set(['0', '2']);

/** CST de aquisição COM direito a crédito — o mesmo que o C170 usa na entrada. */
export const CST_FRETE_COM_CREDITO = '50';
/** CST de aquisição SEM direito a crédito. */
export const CST_FRETE_SEM_CREDITO = '70';

/**
 * O regime da escrituração admite o bloco D?
 *
 * `regimeApuracao`: '1' não-cumulativo · '2' cumulativo · '3' ambos.
 * Só há crédito no não-cumulativo — e o D100 existe só para crédito.
 */
export function regimeAdmiteBlocoD(regimeApuracao) {
    const r = String(regimeApuracao || '2');
    return r === '1' || r === '3';
}

/**
 * Lê o cadastro do frete contratado da empresa, normalizado.
 *
 * ⚠️ Devolve string VAZIA para o que não foi cadastrado — nunca um default.
 * Campo de tabela oficial em branco é ausência, e ausência aqui tem ação
 * (preencher em Empresas → Dados Fiscais), não um valor plausível.
 */
export function cadastroDoFreteContratado(dadosFiscais) {
    const df = dadosFiscais || {};
    const so = (v, validos) => {
        const s = String(v ?? '').trim();
        return validos.has(s) ? s : '';
    };
    return {
        indNatFrete: so(df.contribIndNatFrete, new Set(Object.keys(INDICADORES_NATUREZA_FRETE))),
        indFrt: so(df.contribIndFrtCte, new Set(Object.keys(INDICADORES_TIPO_FRETE))),
        natBcCred: String(df.contribNatBcCredFrete ?? '').trim().slice(0, 2),
    };
}

/**
 * Decide se um CT-e entra no bloco D e com qual tratamento.
 *
 * Devolve `{ entra, motivo, indNatFrete, indFrt, cst, natBcCred, comCredito }`.
 * O `motivo` é o que vira aviso — e cada um pede uma AÇÃO DIFERENTE, por isso
 * eles não são fundidos num contador só (a lição do "sem movimento" sem causa).
 *
 * @param {object} params
 * @param {'entrada'|'saida'} params.direcao   direção EFETIVA do documento
 * @param {string} params.regimeApuracao       '1' | '2' | '3'
 * @param {object} params.cadastro             saída de `cadastroDoFreteContratado`
 */
export function decidirFreteNoBlocoD({ direcao, regimeApuracao, cadastro }) {
    const fora = (motivo) => ({ entra: false, motivo });
    const cad = cadastro || { indNatFrete: '', indFrt: '', natBcCred: '' };

    // 📖 D100 campo 02 — valor válido: [0]. Prestação de serviço de transporte
    // se escritura no D200, que este app não gera.
    if (direcao === 'saida') return fora('prestacao');
    if (!regimeAdmiteBlocoD(regimeApuracao)) return fora('regime-cumulativo');
    if (!cad.indNatFrete) return fora('sem-natureza-cadastrada');
    if (!cad.indFrt) return fora('sem-tipo-de-frete-cadastrado');
    // ⚠️ Subcontratação tem crédito PRESUMIDO com alíquota diferenciada
    // (Tabela 4.3.17) e CST 60-66 — o app não sabe se é o caso.
    if (cad.indNatFrete === '9') return fora('natureza-9-nao-decidida');

    const comCredito = NATUREZAS_COM_CREDITO.has(cad.indNatFrete);
    if (!comCredito && !NATUREZAS_SEM_CREDITO.has(cad.indNatFrete)) {
        return fora('natureza-9-nao-decidida');
    }
    // 📖 D101 campo 05: *"Caso seja informado código representativo de crédito
    // no Campo 04 (CST_PIS), informar neste campo o código da base de cálculo
    // do crédito, conforme a Tabela 4.3.7"*. A tabela não está no repo, então
    // ela vem do cadastro — e sem ela o registro NÃO SAI com crédito.
    if (comCredito && !cad.natBcCred) return fora('sem-natureza-da-base-de-credito');

    return {
        entra: true,
        motivo: '',
        indNatFrete: cad.indNatFrete,
        indFrt: cad.indFrt,
        cst: comCredito ? CST_FRETE_COM_CREDITO : CST_FRETE_SEM_CREDITO,
        // Sem crédito, NAT_BC_CRED não existe — campo fiscal não recebe default.
        natBcCred: comCredito ? cad.natBcCred : '',
        comCredito,
    };
}

const FRASE_POR_MOTIVO = {
    prestacao:
        'são de PRESTAÇÃO (a empresa emitiu o CT-e). O campo IND_OPER do D100 só aceita "0 — Aquisição" '
        + '(Guia Prático 1.35), então quem presta serviço de transporte escritura a receita no registro '
        + 'D200 — que este app ainda NÃO gera. Até lá, o frete prestado precisa ser lançado no PVA.',
    'regime-cumulativo':
        'a empresa apura no regime CUMULATIVO, e o bloco D existe só para a aquisição de frete COM '
        + 'direito a crédito (Guia Prático 1.35, D100: "só devem ser relacionados neste registro as '
        + 'aquisições … que confiram direito ao crédito"). O Manual do Lucro Presumido do PVA 2.04 lista '
        + 'os registros do regime e o bloco D não está entre eles. O frete aqui é CUSTO, e declará-lo '
        + 'traria a recusa "O registro não deve ser informado para esse perfil e/ou tipo de operação".',
    'sem-natureza-cadastrada':
        'falta a NATUREZA DO FRETE CONTRATADO (IND_NAT_FRT, campo 02 do D101/D105). Ela diz o que a '
        + 'empresa fez com aquele frete — venda, compra, transferência — e isso não está no CT-e. '
        + 'Preencha em Empresas → Dados Fiscais → "EFD-Contribuições: frete contratado (bloco D)".',
    'sem-tipo-de-frete-cadastrado':
        'falta o TIPO DO FRETE (IND_FRT, campo 17 do D100 — por conta de quem ele corre). É campo '
        + 'obrigatório de tabela oficial e não se deduz do XML. Preencha em Empresas → Dados Fiscais → '
        + '"EFD-Contribuições: frete contratado (bloco D)".',
    'natureza-9-nao-decidida':
        'a natureza cadastrada é "9 — Outras", e o Guia amarra esse indicador à SUBCONTRATAÇÃO de '
        + 'transporte, que tem crédito PRESUMIDO, CST 60-66 e alíquotas próprias (1,2375% e 5,7%, '
        + 'Tabela 4.3.17). O app não sabe se é esse o caso e não escolhe alíquota de crédito no escuro — '
        + 'escriture esses conhecimentos no PVA ou escolha a natureza que descreve a operação.',
    'sem-natureza-da-base-de-credito':
        'a natureza cadastrada gera CRÉDITO, e para isso o D101/D105 exige o código da base de cálculo '
        + '(NAT_BC_CRED, Tabela 4.3.7) — que não está neste app. Preencha em Empresas → Dados Fiscais → '
        + '"EFD-Contribuições: frete contratado (bloco D)".',
};

/**
 * Avisos do que ficou de FORA do bloco D, um por CAUSA.
 *
 * CT-e que some sem ninguém saber é crédito a menos (ou recusa do PVA no mês
 * seguinte). Cada motivo carrega a ação dele — fundir tudo em "N CT-e ficaram
 * de fora" seria o "sem movimento" sem causa outra vez.
 *
 * @param {Record<string,string[]>} porMotivo  motivo → rótulos dos documentos
 */
export function avisosDoBlocoD(porMotivo) {
    const avisos = [];
    for (const [motivo, docs] of Object.entries(porMotivo || {})) {
        if (!docs || !docs.length) continue;
        const frase = FRASE_POR_MOTIVO[motivo];
        if (!frase) continue;
        const amostra = docs.slice(0, 8).join(', ');
        avisos.push(
            `Bloco D: ${docs.length} conhecimento(s) de transporte ficaram FORA do arquivo porque ${frase} `
            + `Documentos: ${amostra}${docs.length > 8 ? ` e mais ${docs.length - 8}` : ''}.`,
        );
    }
    return avisos;
}
