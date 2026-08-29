// ============================================================================
// sefaz-backend/sped-bloco-k.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🏭 BLOCO K — CONTROLE DA PRODUÇÃO E DO ESTOQUE (EFD ICMS/IPI)
//
// 29/08, Paulo: *"pode fazer o bloco K"*. Era o último 🔴 do de-para.
//
// ═══ A REGRA QUE MANDA, E ELA JÁ CUSTOU UMA VEZ ═════════════════════════════
//
// 🚨 **QUANTIDADE DE PRODUÇÃO E DE ESTOQUE NÃO SAI DAS NOTAS.** Ela vem do
// controle de produção do cliente — e o app não tem nenhum. Este é exatamente
// o caso do **Bloco H** em 06/08: o gerador montava H010 para todos os itens
// com quantidade default ZERO, e em dezembro sairia um inventário inteiro
// zerado, **estruturalmente válido, que o PVA aceita** e a fiscalização lê
// como *"a empresa declarou que não tinha estoque"*.
//
// Aqui o custo é o mesmo com outro nome: bloco K zerado é a empresa declarando
// que **não produziu e não tem estoque**. Então vale a regra do Paulo (06/08):
// **falta de informação ACENDE ALERTA e alguém arruma — ela nunca vira zero.**
// Sem apontamento informado o bloco sai `K001|1` (SEM DADOS) e o gerador GRITA.
//
// ═══ QUEM APRESENTA — e o Guia é explícito nas duas pontas ══════════════════
//
// 📖 *"relativos aos estabelecimentos industriais ou a eles equiparados pela
// legislação federal e pelos atacadistas, podendo, a critério do Fisco, ser
// exigido de estabelecimento de contribuintes de outros setores"*.
//
// 📖 E a dispensa, literal: *"Os contribuintes optantes pelo Simples Nacional
// estão dispensados de apresentarem este bloco, em virtude da Resolução Comitê
// Gestor do Simples Nacional nº 94"*.
//
// ⚠️ **O app NÃO DEDUZ quem é industrial.** A 🚦 Migração já detecta produção
// pelos CFOPs desde 06/08 (`comProducaoParaBlocoK`) — mas detectar movimento é
// SINAL, não enquadramento: quem responde *"esta empresa entrega bloco K?"* é
// o CADASTRO. Deduzir aqui faria comércio equiparado (que destaca IPI sem
// industrializar) entregar um bloco que a legislação não pede dele — e o
// contrário, pior, faria indústria não entregar.
//
// ═══ O LEIAUTE É ESCOLHA DO CONTRIBUINTE (K010, desde 2023) ═════════════════
//
// 📖 Ajuste SINIEF 02/09: **0 = simplificado · 1 = completo · 2 = restrito aos
// saldos de estoque**. O simplificado **desobriga** justamente os registros de
// consumo por item (K210/K215/K235/K255/K260/K265) — e o K235 é o único que
// exigiria o apontamento insumo a insumo, que é o dado mais difícil de o
// cliente ter.
//
// ⚠️ O leiaute **não se deduz**: é opção do contribuinte, e escolher por ele
// faria o arquivo prometer detalhamento que o PVA vai cobrar (a família da
// recusa *"o registro não deve ser informado para esse perfil"* da AFFITTARE).
// Sem escolha cadastrada, o bloco não sai e a falta vai NOMEADA.
//
// ═══ O QUE ESTE MÓDULO AINDA NÃO FAZ, e vai DITO ════════════════════════════
//
// 🚩 Ele monta a ESPINHA — K001, K010, K100, K200, K230, K235 e K990. Os
// registros de desmontagem (K210/K215), movimentação interna (K220),
// industrialização por terceiros (K250/K255), reprocessamento (K260/K265),
// correção de apontamento (K270/K275/K280) e produção conjunta (K290-K302)
// **não são gerados** — e não saem calados: quem cadastrar apontamento de um
// tipo que este módulo não monta recebe aviso nomeando o registro.
//
// Preferi a espinha COMPLETA e provada a doze registros pela metade: no bloco
// K, registro montado por dedução é a mesma família do inventário zerado.
// ============================================================================

/** Leiautes válidos do K010 (Ajuste SINIEF 02/09, vigente desde 2023). */
export const LEIAUTES_BLOCO_K = {
    '0': 'simplificado',
    '1': 'completo',
    '2': 'restrito aos saldos de estoque',
};

/** IND_EST do K200 — Valores Válidos: [0, 1, 2] (Guia, K200 campo 05). */
export const IND_EST_VALIDOS = ['0', '1', '2'];

/**
 * TIPO_ITEM que o K200 aceita.
 *
 * 📖 Guia, K200 campo 03: *"Somente podem ser informados nesse campo os
 * valores de COD_ITEM cujos tipos sejam iguais a 00, 01, 02, …"* — ou seja,
 * mercadoria/matéria-prima/embalagem. Serviço (09) e os demais não entram no
 * controle de estoque.
 */
export const TIPOS_ITEM_ESTOQUE = ['00', '01', '02', '03', '04', '05', '10'];

/** Quantidade INFORMADA? Zero informado é diferente de não informado. */
export function quantidadeInformada(v) {
    if (v == null || v === '') return false;
    const n = Number(v);
    return Number.isFinite(n);
}

/**
 * Esta empresa entrega bloco K?
 *
 * 🚨 Responde pelo CADASTRO, nunca por dedução do movimento. Devolve o motivo
 * junto, porque *"não se aplica"* e *"aplica-se e falta cadastrar"* pedem ações
 * opostas.
 *
 * @param {object} p
 * @param {string} [p.regime]        'simples' | 'lucro' (a coleção de origem)
 * @param {boolean} [p.entregaBlocoK] marcação do cadastro (Dados Fiscais)
 * @param {string} [p.leiauteBlocoK]  '0' | '1' | '2'
 */
export function exigenciaBlocoK({ regime, entregaBlocoK, leiauteBlocoK } = {}) {
    // 📖 A dispensa do Simples é literal no Guia — e vem ANTES de tudo: nem o
    // cadastro marcado fura, porque a Resolução CGSN 94 não lista este livro.
    if (String(regime || '').toLowerCase() === 'simples') {
        return {
            exige: false, motivo: 'simples-dispensado', leiaute: null,
            texto: 'Optante do Simples Nacional é DISPENSADO do bloco K (Resolução CGSN 94) — '
                + 'o bloco sai sem dados.',
        };
    }
    if (!entregaBlocoK) {
        return {
            exige: false, motivo: 'nao-marcado', leiaute: null,
            texto: 'O bloco K não está marcado no cadastro desta empresa — sai sem dados.',
        };
    }
    const leiaute = String(leiauteBlocoK || '').trim();
    if (!LEIAUTES_BLOCO_K[leiaute]) {
        // ⚠️ Leiaute é ESCOLHA do contribuinte (K010). Escolher por ele faria o
        // arquivo prometer detalhamento que o PVA cobra.
        return {
            exige: true, motivo: 'sem-leiaute', leiaute: null,
            texto: 'O bloco K está marcado mas o LEIAUTE (K010) não foi escolhido. Ele é opção do '
                + 'contribuinte (Ajuste SINIEF 02/09): 0 = simplificado, 1 = completo, 2 = restrito aos '
                + 'saldos de estoque. Preencha em Empresas → Dados Fiscais ("Leiaute do bloco K").',
        };
    }
    return { exige: true, motivo: 'ok', leiaute, texto: null };
}

/** O leiaute simplificado (0) e o restrito (2) desobrigam o K235. */
export function exigeInsumos(leiaute) {
    return String(leiaute) === '1';
}

/** O restrito (2) só leva saldo de estoque — nem produção entra. */
export function exigeProducao(leiaute) {
    return ['0', '1'].includes(String(leiaute));
}

/**
 * Separa o que dá para escriturar do que falta — SEM inventar quantidade.
 *
 * @param {object} p
 * @param {object[]} [p.estoques]  {codItem, qtd, indEst, codPart}
 * @param {object[]} [p.producao]  {dtIniOp, dtFinOp, codDocOp, codItem, qtdEnc, insumos[]}
 * @param {string} p.leiaute
 * @param {Set<string>|string[]} [p.itensDo0200] códigos que o arquivo declara
 * @param {object} [p.tipoPorItem] COD_ITEM → TIPO_ITEM (para a régua do K200)
 */
export function planejarBlocoK({
    estoques = [], producao = [], leiaute, itensDo0200 = [], tipoPorItem = {},
} = {}) {
    const cadastrados = itensDo0200 instanceof Set ? itensDo0200 : new Set(itensDo0200);
    const avisos = [];

    const estoqueOk = [];
    const estoqueForaCount = { semQtd: 0, semItem: 0, foraDo0200: 0, tipoInvalido: 0, semParticipante: 0 };
    for (const e of estoques) {
        const cod = String(e?.codItem || '').trim();
        if (!cod) { estoqueForaCount.semItem++; continue; }
        // 🚨 Quantidade não informada NUNCA vira zero — é a regra de 06/08.
        if (!quantidadeInformada(e?.qtd)) { estoqueForaCount.semQtd++; continue; }
        if (cadastrados.size && !cadastrados.has(cod)) { estoqueForaCount.foraDo0200++; continue; }
        const tipo = tipoPorItem[cod];
        if (tipo != null && !TIPOS_ITEM_ESTOQUE.includes(String(tipo))) {
            estoqueForaCount.tipoInvalido++;
            continue;
        }
        const indEst = IND_EST_VALIDOS.includes(String(e?.indEst)) ? String(e.indEst) : '0';
        const codPart = String(e?.codPart || '').trim();
        // 📖 Guia K200 campo 05: IND_EST 1 ou 2 ⇒ COD_PART obrigatório.
        if (['1', '2'].includes(indEst) && !codPart) { estoqueForaCount.semParticipante++; continue; }
        estoqueOk.push({ codItem: cod, qtd: Number(e.qtd), indEst, codPart });
    }

    const producaoOk = [];
    const producaoForaCount = { semQtd: 0, semItem: 0, foraDo0200: 0 };
    if (exigeProducao(leiaute)) {
        for (const p of producao) {
            const cod = String(p?.codItem || '').trim();
            if (!cod) { producaoForaCount.semItem++; continue; }
            if (!quantidadeInformada(p?.qtdEnc)) { producaoForaCount.semQtd++; continue; }
            if (cadastrados.size && !cadastrados.has(cod)) { producaoForaCount.foraDo0200++; continue; }
            const insumos = exigeInsumos(leiaute)
                ? (p.insumos || [])
                    .filter((i) => String(i?.codItem || '').trim() && quantidadeInformada(i?.qtd))
                    .map((i) => ({
                        dtSaida: String(i.dtSaida || '').trim(),
                        codItem: String(i.codItem).trim(),
                        qtd: Number(i.qtd),
                        codInsSubst: String(i.codInsSubst || '').trim(),
                    }))
                : [];
            producaoOk.push({
                dtIniOp: String(p.dtIniOp || '').trim(),
                dtFinOp: String(p.dtFinOp || '').trim(),
                codDocOp: String(p.codDocOp || '').trim(),
                codItem: cod,
                qtdEnc: Number(p.qtdEnc),
                insumos,
            });
        }
    } else if (producao.length) {
        avisos.push(
            `Bloco K: ${producao.length} apontamento(s) de produção NÃO entraram — o leiaute escolhido é `
            + '"restrito aos saldos de estoque" (K010 = 2), que só admite o K200. '
            + 'Se a empresa precisa declarar produção, mude o leiaute em Dados Fiscais.',
        );
    }

    // 🚨 O ALERTA É O PRODUTO quando falta informação: sem ele, quantidade não
    // informada some do arquivo em silêncio, e o bloco declara menos produção
    // e menos estoque do que houve.
    const foraEstoque = Object.values(estoqueForaCount).reduce((a, b) => a + b, 0);
    if (foraEstoque) {
        const partes = [];
        if (estoqueForaCount.semQtd) partes.push(`${estoqueForaCount.semQtd} sem quantidade informada`);
        if (estoqueForaCount.semItem) partes.push(`${estoqueForaCount.semItem} sem código de item`);
        if (estoqueForaCount.foraDo0200) partes.push(`${estoqueForaCount.foraDo0200} com item que o 0200 não declara`);
        if (estoqueForaCount.tipoInvalido) partes.push(`${estoqueForaCount.tipoInvalido} com TIPO_ITEM que o K200 não admite`);
        if (estoqueForaCount.semParticipante) partes.push(`${estoqueForaCount.semParticipante} de terceiro sem participante`);
        avisos.push(
            `Bloco K: ${foraEstoque} linha(s) de ESTOQUE ficaram fora do arquivo (${partes.join(' · ')}). `
            + 'Quantidade não informada não vira zero — zero no K200 declara que a empresa não tem o item '
            + 'em estoque. Complete em SPED Fiscal → 🏭 Bloco K.',
        );
    }
    const foraProducao = Object.values(producaoForaCount).reduce((a, b) => a + b, 0);
    if (foraProducao) {
        const partes = [];
        if (producaoForaCount.semQtd) partes.push(`${producaoForaCount.semQtd} sem quantidade produzida`);
        if (producaoForaCount.semItem) partes.push(`${producaoForaCount.semItem} sem código de item`);
        if (producaoForaCount.foraDo0200) partes.push(`${producaoForaCount.foraDo0200} com item que o 0200 não declara`);
        avisos.push(
            `Bloco K: ${foraProducao} apontamento(s) de PRODUÇÃO ficaram fora do arquivo (${partes.join(' · ')}). `
            + 'Complete em SPED Fiscal → 🏭 Bloco K.',
        );
    }
    // ⚠️ Produção informada COM insumos num leiaute que os desobriga: o dado
    // existe e não vai ao arquivo. Some calado seria o defeito com outra roupa.
    if (!exigeInsumos(leiaute) && producao.some((p) => (p?.insumos || []).length)) {
        avisos.push(
            'Bloco K: há insumos apontados, mas o leiaute escolhido (K010 = '
            + `${leiaute} · ${LEIAUTES_BLOCO_K[leiaute]}) DESOBRIGA o K235 — eles não vão ao arquivo. `
            + 'Se a empresa precisa declará-los, o leiaute é o completo (1).',
        );
    }

    return { estoqueOk, producaoOk, avisos, comDados: estoqueOk.length > 0 || producaoOk.length > 0 };
}

/**
 * Monta as LINHAS do bloco K (arrays de campos — o formatador é do gerador).
 *
 * @returns {{linhas: any[][], avisos: string[], indMov: '0'|'1'}}
 */
export function montarBlocoK({
    exigencia, estoques = [], producao = [], dtIni, dtFin,
    itensDo0200 = [], tipoPorItem = {},
} = {}) {
    const avisos = [];
    const linhas = [];

    if (!exigencia?.exige) {
        // Não se aplica: bloco SEM DADOS, e o motivo vai dito (só quando há o
        // que dizer — empresa do Simples não precisa de alarme todo mês).
        if (exigencia?.motivo === 'nao-marcado' && exigencia.texto) avisos.push(`Bloco K: ${exigencia.texto}`);
        return { linhas: [['K001', '1'], ['K990', 2]], avisos, indMov: '1' };
    }
    if (!exigencia.leiaute) {
        avisos.push(`Bloco K: ${exigencia.texto}`);
        return { linhas: [['K001', '1'], ['K990', 2]], avisos, indMov: '1' };
    }

    const plano = planejarBlocoK({
        estoques, producao, leiaute: exigencia.leiaute, itensDo0200, tipoPorItem,
    });
    avisos.push(...plano.avisos);

    if (!plano.comDados) {
        // 🚨 AQUI ESTÁ A LIÇÃO DO BLOCO H: sem apontamento informado o bloco sai
        // SEM DADOS e o gerador GRITA — nunca zerado. Bloco vazio é "não
        // declarei"; zerado é "declarei que não tenho", e a segunda é mentira.
        avisos.push(
            'Bloco K: a empresa entrega o bloco e NENHUM apontamento de estoque ou produção foi informado — '
            + 'o bloco saiu SEM DADOS (K001 = 1). Ele não sai zerado de propósito: zero no K200 declara ao '
            + 'fisco que a empresa não tem estoque. Informe em SPED Fiscal → 🏭 Bloco K antes de transmitir.',
        );
        return { linhas: [['K001', '1'], ['K990', 2]], avisos, indMov: '1' };
    }

    linhas.push(['K001', '0']);
    // K010 é obrigatório quando IND_MOV = 0 (Guia, K010, Validação).
    linhas.push(['K010', exigencia.leiaute]);
    // 📖 K100: "Os períodos informados neste registro deverão abranger todo o
    // período da escrituração". Um período por mês é o caso comum; empresa com
    // apuração mais curta declara vários — o app não inventa a quebra.
    linhas.push(['K100', dtIni, dtFin]);

    // 📖 K200 campo 02 (DT_EST), Validação: "a data do estoque deve ser igual à
    // data final do período de apuração – campo DT_FIN do Registro K100".
    for (const e of plano.estoqueOk) {
        linhas.push(['K200', dtFin, e.codItem, e.qtd, e.indEst, e.codPart]);
    }

    for (const p of plano.producaoOk) {
        linhas.push(['K230', p.dtIniOp, p.dtFinOp, p.codDocOp, p.codItem, p.qtdEnc]);
        for (const i of p.insumos) {
            linhas.push(['K235', i.dtSaida || p.dtFinOp || dtFin, i.codItem, i.qtd, i.codInsSubst]);
        }
    }

    linhas.push(['K990', linhas.length + 1]);
    return { linhas, avisos, indMov: '0' };
}
