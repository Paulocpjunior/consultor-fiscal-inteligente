/**
 * cst-correlacao — o CST que a ESCRITURAÇÃO usa, quando ele não é o do fornecedor.
 *
 * ═══ O PEDIDO ═══════════════════════════════════════════════════════════════
 *
 * Paulo, 18/08, na sequência da correlação de CFOP: *"adiciona o CST para
 * validarmos a operação. Exemplo do consumo: a nota vai vir 5102/5101 etc.,
 * vamos registrar como 1556. Aí que está a chave do SPED: o CST do fornecedor
 * vai vir como 00, temos que indicar 90 para essas operações."*
 *
 * É a MESMA assimetria do CFOP, um campo adiante. A nota é do FORNECEDOR: para a
 * Kalunga aquilo é venda tributada integralmente (CST 00). Para quem compra
 * material de escritório, a entrada não é de mercadoria — e o CST que descreve a
 * operação do lado de cá é **90 (Outras)**.
 *
 * ⚠️ E é a mesma família do IPI: em 11/08 já ficou provado que o CST de SAÍDA do
 * fornecedor vira outro na ENTRADA do destinatário (IN RFB 932/2009: 50→00,
 * 51→01…). Preservar o CST cru é escriturar a operação DELE.
 *
 * ═══ O QUE ESTE MÓDULO SE RECUSA A FAZER ════════════════════════════════════
 *
 * **Não deduz de-para que ninguém provou.** A tabela tem UMA família — a que o
 * Paulo nomeou — e cada entrada carrega a FONTE, igual ao catálogo de CFOP e às
 * contagens de campo do PVA. Família fora dela **preserva o CST e volta NOMEADA**
 * (`nao-decidido`), para virar uma pergunta com contagem em vez de um chute
 * aplicado calado a milhares de linhas.
 *
 * Em particular: **ATIVO IMOBILIZADO (1551/2551) FICA DE FORA.** O raciocínio
 * *parece* o mesmo, mas não é o mesmo fato — no ativo o crédito de ICMS existe e
 * é controlado em 48 parcelas pelo CIAP (LC 87/96 art. 20 §5º), enquanto no
 * uso/consumo não há crédito nenhum. Deduzir aqui é o que produziu o 1405 e o
 * 1655; a decisão é do Paulo, e a tela conta quantas notas esperam por ela.
 *
 * ═══ A ARMADILHA QUE O CST TEM E O CFOP NÃO ═════════════════════════════════
 *
 * O CST do ICMS tem TRÊS dígitos: **origem (1) + tributação (2)**. O primeiro
 * dígito diz se a mercadoria é nacional, importada, etc. (Convênio s/nº, Tabela
 * A) — e ele é um FATO da mercadoria, que a reclassificação não toca.
 *
 * Escrever '090' direto apagaria a origem de todo produto importado: `100`
 * (estrangeira, tributada) viraria `090` (nacional, outras), afirmando que um
 * produto importado é nacional dentro do SPED. A conversão troca só os dois
 * últimos dígitos.
 */

/** Só dígitos, e no máximo os 3 que o CST tem. */
function digitos(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
}

/**
 * Separa o CST em origem + tributação.
 *
 * Aceita as duas formas que os XMLs trazem: '00' (só a tributação, origem
 * implícita 0) e '000' (origem + tributação). CSOSN do Simples tem 3 dígitos
 * também, mas a tributação dele não pertence a esta tabela — e por isso não é
 * convertido (ver `SITUACOES_CONVERTIVEIS`).
 */
export function partesDoCst(cst) {
    const d = digitos(cst);
    if (!d) return null;
    if (d.length <= 2) return { origem: '0', tributacao: d.padStart(2, '0') };
    return { origem: d.slice(-3, -2), tributacao: d.slice(-2) };
}

/**
 * FAMÍLIAS DE CFOP CUJO CST DE ENTRADA NÃO É O DO FORNECEDOR.
 *
 * A chave é o sufixo do CFOP (3 dígitos), porque a faixa (1/2/3) só diz de onde
 * a mercadoria veio — o destino é o mesmo. Cada entrada carrega a FONTE.
 */
export const CST_POR_DESTINO = {
    556: {
        cst: '90',
        rotulo: 'uso ou consumo',
        fonte: 'Paulo, 18/08/2026: "o CST do fornecedor vai vir como 00, temos que '
            + 'indicar 90 para essas operações" (exemplo do consumo, CFOP 1556).',
    },
    557: {
        cst: '90',
        rotulo: 'uso ou consumo (transferência)',
        fonte: 'Mesma família do 556 — o destino declarado pelo próprio CFOP é uso/consumo; '
            + 'o que muda é a operação de origem (transferência), não o destino.',
    },
};

/**
 * SUFIXOS QUE A REGRA ALCANÇA MAS AINDA NÃO TÊM DECISÃO.
 *
 * Eles NÃO são convertidos — voltam nomeados para virar UMA pergunta com
 * contagem, em vez de um chute aplicado a milhares de linhas.
 */
export const DESTINOS_SEM_DECISAO = {
    551: 'ativo imobilizado (compra)',
    552: 'ativo imobilizado (transferência)',
};

/**
 * TRIBUTAÇÕES QUE SE CONVERTEM.
 *
 * Só a que o Paulo nomeou (00 — tributada integralmente) e a 20 (com redução de
 * base), que é a MESMA operação com base reduzida. Fora disso o CST cru já diz
 * um fato que o 90 apagaria:
 *   • 40/41/50/51 — isenta, não tributada, suspensão, diferimento;
 *   • 60/70 — ST já cobrada, que é justamente o que o livro precisa saber;
 *   • 1xx/2xx/4xx/5xx (CSOSN do Simples) — outra tabela.
 * Esses PRESERVAM, e a preservação é dita.
 */
export const SITUACOES_CONVERTIVEIS = new Set(['00', '20']);

/**
 * O CST que a escrituração deve usar para o item.
 *
 * @param {string} cstDoItem   CST como veio do XML do fornecedor ('00' ou '000')
 * @param {string} cfopEscriturado CFOP com que a nota está sendo escriturada
 * @returns {{cst: string|null, original: string|null, situacao: string, motivo: string, destino: string|null}}
 */
export function cstDoLancamento(cstDoItem, cfopEscriturado) {
    const partes = partesDoCst(cstDoItem);
    const cfop = digitos(cfopEscriturado);
    const original = partes ? `${partes.origem}${partes.tributacao}` : null;

    // Sem CST não se INVENTA um: campo fiscal não recebe default (regra de 06/08).
    if (!partes) {
        return {
            cst: null, original: null, destino: null, situacao: 'sem-cst',
            motivo: 'O item não trouxe CST de ICMS. O CST não é deduzido do CFOP — confira o XML na origem.',
        };
    }
    if (cfop.length !== 4) {
        return { cst: original, original, destino: null, situacao: 'preservado', motivo: 'CFOP ilegível — o CST fica como veio.' };
    }
    // Só a ENTRADA muda de CST: na saída o documento é do próprio cliente.
    if (!/^[123]/.test(cfop)) {
        return { cst: original, original, destino: null, situacao: 'preservado', motivo: 'Saída — o CST é o da nota que o cliente emitiu.' };
    }

    const sufixo = cfop.slice(1);

    if (DESTINOS_SEM_DECISAO[sufixo]) {
        return {
            cst: original, original, destino: DESTINOS_SEM_DECISAO[sufixo], situacao: 'nao-decidido',
            motivo: `Escriturado como ${DESTINOS_SEM_DECISAO[sufixo]}: o CST do fornecedor foi MANTIDO. `
                + 'Diferente do uso/consumo, aqui existe crédito de ICMS controlado em 48 parcelas (CIAP), '
                + 'então converter para 90 seria decisão nova — ainda não tomada.',
        };
    }

    const alvo = CST_POR_DESTINO[sufixo];
    if (!alvo) {
        return { cst: original, original, destino: null, situacao: 'preservado', motivo: 'CFOP de mercadoria — o CST do fornecedor vale.' };
    }
    if (!SITUACOES_CONVERTIVEIS.has(partes.tributacao)) {
        return {
            cst: original, original, destino: alvo.rotulo, situacao: 'preservado-por-situacao',
            motivo: `Escriturado como ${alvo.rotulo}, mas o CST ${original} já declara um fato próprio `
                + '(isenção, não tributação, diferimento ou ST anterior) que o 90 apagaria. Mantido — confira se é o caso.',
        };
    }

    // ⚠️ A ORIGEM É PRESERVADA: ela é fato da mercadoria, não da operação.
    return {
        cst: `${partes.origem}${alvo.cst}`, original, destino: alvo.rotulo, situacao: 'convertido',
        motivo: `Entrada para ${alvo.rotulo}: o CST ${original} é o do FORNECEDOR (para ele foi venda). `
            + `Do nosso lado a operação é "Outras" — ${partes.origem}${alvo.cst}.`,
    };
}

/**
 * Resumo para a tela: o que converteu, o que ficou esperando decisão.
 *
 * Contagem sem causa é meio farol — cada grupo volta com o motivo e com quantas
 * notas ele alcança, que é o que transforma "confira" em uma pergunta única.
 */
export function resumirCst(itens) {
    const conv = [];
    const semDecisao = new Map();
    const preservadoPorSituacao = [];
    const semCst = [];

    for (const it of (itens || [])) {
        const r = cstDoLancamento(it?.cst, it?.cfop);
        if (r.situacao === 'convertido') conv.push({ ...it, ...r });
        else if (r.situacao === 'nao-decidido') {
            const k = r.destino || '?';
            semDecisao.set(k, (semDecisao.get(k) || 0) + 1);
        } else if (r.situacao === 'preservado-por-situacao') preservadoPorSituacao.push({ ...it, ...r });
        else if (r.situacao === 'sem-cst') semCst.push({ ...it, ...r });
    }

    const avisos = [];
    if (semDecisao.size) {
        for (const [destino, n] of semDecisao) {
            avisos.push(
                `${n} item(ns) escriturado(s) como ${destino} mantiveram o CST do fornecedor. `
                + 'Converter para 90 aqui é decisão em aberto — no ativo existe crédito por CIAP.',
            );
        }
    }
    if (preservadoPorSituacao.length) {
        avisos.push(
            `${preservadoPorSituacao.length} item(ns) de uso/consumo vieram com CST que não é 00/20 `
            + '(isenta, ST anterior, diferimento…) e foram MANTIDOS: o 90 apagaria esse fato.',
        );
    }
    if (semCst.length) {
        avisos.push(`${semCst.length} item(ns) sem CST no XML — o CST não se deduz do CFOP; confira na origem.`);
    }
    return { convertidos: conv.length, avisos, semDecisao: [...semDecisao.entries()] };
}
