// ============================================================================
// sefaz-backend/pgdas-atividades-declaradas.js
//
// Núcleo PURO: extrai as ATIVIDADES (idAtividade) de uma declaração PGDAS-D já
// transmitida, a partir da resposta do CONSULTIMADECREC14.
//
// PARA QUE SERVE (caso S&P, 03/08/2026): o app precisa declarar a receita com a
// atividade CERTA — ex.: "Escritórios de serviços contábeis autorizados pela
// legislação municipal a pagar o ISS em valor fixo em guia do Município"
// (LC 123 art. 18 §22-A). O NÚMERO dessa atividade está na tabela do SERPRO,
// que não é acessível de dentro do app. A fonte confiável que sobra é a própria
// empresa: o que ela já declarou e a Receita aceitou. É o mesmo princípio do
// preenchimento do MIT (códigos de débito copiados do mês-modelo) — nunca
// chutar código de tributo.
//
// O shape da resposta do SERPRO VARIA (ora objeto, ora string JSON, ora
// aninhado em dados/declaracao/estabelecimentos). Por isso a extração é uma
// VARREDURA PROFUNDA por qualquer objeto que tenha idAtividade, em vez de um
// caminho fixo que quebraria no primeiro formato diferente.
// ============================================================================

const PROFUNDIDADE_MAX = 12;

function parseMaybeJson(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return value;
    try { return JSON.parse(trimmed); }
    catch { return value; }
}

function numeroOuNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function round2(n) {
    const v = Number(n);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/**
 * Qualificações tributárias da receita, quando vierem junto — imunidade,
 * isenção/redução, exigibilidade suspensa etc., POR TRIBUTO (o PGDAS-D
 * qualifica ICMS e IPI em campos separados — caso POLO CULTURAL, 11/08).
 *
 * Além do par (codigoTributo, id), leva a qualificação INTEIRA em `bruto`:
 * é a etapa de DESCOBERTA — os nomes reais dos campos (parcela de isenção,
 * percentual de redução...) saem de uma declaração ACEITA, nunca de chute
 * (Jaguarexport 07/2026 isenção ICMS; POLO CULTURAL 06/2026 imunidade
 * ICMS+IPI). É com esse bruto que o mapper vai ser ligado depois.
 */
function extrairQualificacoes(receitas) {
    const out = [];
    for (const receita of Array.isArray(receitas) ? receitas : []) {
        const quals = receita?.qualificacoesTributarias || receita?.qualificacoes || [];
        for (const q of Array.isArray(quals) ? quals : []) {
            const codigoTributo = numeroOuNull(q?.codigoTributo ?? q?.codTributo);
            const id = numeroOuNull(q?.id ?? q?.idQualificacao);
            if (codigoTributo !== null || id !== null) out.push({ codigoTributo, id, bruto: q });
        }
    }
    return out;
}

/**
 * Varre a resposta inteira e devolve as atividades encontradas, agregando o
 * valor por idAtividade (o mesmo id pode aparecer em vários estabelecimentos).
 *
 * @returns {Array<{idAtividade:number, valorAtividade:number, ocorrencias:number,
 *                  qualificacoes:Array<{codigoTributo:number|null,id:number|null}>}>}
 */
export function extrairAtividadesDeclaradas(resposta) {
    const porId = new Map();

    const visitar = (valor, profundidade) => {
        if (profundidade > PROFUNDIDADE_MAX || valor == null) return;
        const parsed = parseMaybeJson(valor);
        if (parsed == null || typeof parsed !== 'object') return;

        if (Array.isArray(parsed)) {
            for (const item of parsed) visitar(item, profundidade + 1);
            return;
        }

        const idAtividade = numeroOuNull(parsed.idAtividade ?? parsed.codigoAtividade);
        if (idAtividade !== null && idAtividade > 0) {
            const atual = porId.get(idAtividade) || {
                idAtividade, valorAtividade: 0, ocorrencias: 0, qualificacoes: [],
            };
            atual.valorAtividade = round2(
                atual.valorAtividade + round2(parsed.valorAtividade ?? parsed.valor ?? 0),
            );
            atual.ocorrencias += 1;
            for (const q of extrairQualificacoes(parsed.receitasAtividade ?? parsed.receitas)) {
                // Dedup pelo CONTEÚDO (não só tributo+id): duas parcelas do
                // mesmo tributo com valores diferentes são achados diferentes.
                const chaveQ = JSON.stringify([q.codigoTributo, q.id, q.bruto]);
                const jaTem = atual.qualificacoes
                    .some((x) => JSON.stringify([x.codigoTributo, x.id, x.bruto]) === chaveQ);
                if (!jaTem) atual.qualificacoes.push(q);
            }
            porId.set(idAtividade, atual);
        }

        for (const v of Object.values(parsed)) visitar(v, profundidade + 1);
    };

    visitar(resposta, 0);

    return Array.from(porId.values()).sort((a, b) => a.idAtividade - b.idAtividade);
}

/**
 * BRUTO PODADO — pra quando a declaração NÃO TEM atividade nenhuma.
 *
 * "Nenhuma atividade" tem DUAS causas opostas e o app não pode confundi-las:
 * a consulta pode ter devolvido só o recibo (sem detalhamento), OU a declaração
 * é mesmo SEM MOVIMENTO — e aí ela realmente não tem atividade (o relatório da
 * Receita imprime "Nenhuma atividade selecionada"; GS ODONTOLOGIA 07/2026,
 * transmitida e aceita em 11/08/2026).
 *
 * O segundo caso é justamente o que precisa ser descoberto: o app tentou
 * declarar sem movimento com `estabelecimentos: [{cnpj, atividades: []}]` e o
 * SERPRO recusou com MSG_ISN_023. Devolver "não veio detalhamento" e jogar a
 * resposta fora desperdiça a única viagem que traz a FORMA aceita.
 *
 * Poda porque a resposta do CONSULTIMADECREC14 carrega PDF em base64 — texto
 * gigante que não diz nada sobre a estrutura e que estouraria a tela e o log.
 * A poda troca o conteúdo pelo TAMANHO: some o volume, fica o campo (campo
 * omitido em silêncio faria procurar estrutura que existe).
 */
export function podarBrutoDeclaracao(valor, profundidade = 0, limite = 400) {
    if (profundidade > PROFUNDIDADE_MAX) return '[omitido: profundidade máxima]';
    const parsed = parseMaybeJson(valor);
    if (parsed == null) return parsed;
    if (typeof parsed === 'string') {
        return parsed.length > limite
            ? `[omitido: ${parsed.length} caracteres]`
            : parsed;
    }
    if (typeof parsed !== 'object') return parsed;
    if (Array.isArray(parsed)) return parsed.map((v) => podarBrutoDeclaracao(v, profundidade + 1, limite));
    const out = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = podarBrutoDeclaracao(v, profundidade + 1, limite);
    return out;
}

/**
 * O QUE A RECEITA DISSE quando não veio atividade.
 *
 * ELS COMERCIO DE BANANAS 07/2026 (12/08/2026): o bloco cru trouxe a resposta e
 * ela não era nenhuma das duas hipóteses da tela —
 *
 *   {"status":200,"dados":"","mensagens":[{"codigo":"[Aviso-PGDASD-MSG_ISN_005]",
 *    "texto":"Não há declaração transmitida para o período informado: 202607."}]}
 *
 * Ou seja: uma TERCEIRA causa — não existe declaração naquela competência. Ler
 * a mensagem é o que separa "procure outra competência" de "some conferir o
 * detalhamento", que mandam a pessoa para lados opostos.
 *
 * Mensagem que este módulo não conhece NÃO vira palpite: sai como
 * `mensagemDaReceita` para a tela mostrar do jeito que veio.
 */
export function interpretarConsultaAtividades(resposta) {
    const msgs = [];
    const visitar = (v, d = 0) => {
        if (d > PROFUNDIDADE_MAX || v == null) return;
        const p = parseMaybeJson(v);
        if (p == null || typeof p !== 'object') return;
        if (Array.isArray(p)) { p.forEach((x) => visitar(x, d + 1)); return; }
        const texto = p.texto ?? p.mensagem ?? p.descricao;
        const codigo = p.codigo ?? p.cod;
        if (typeof texto === 'string' && texto.trim()) msgs.push({ codigo: codigo || null, texto: texto.trim() });
        Object.values(p).forEach((x) => visitar(x, d + 1));
    };
    visitar(resposta, 0);

    const junto = msgs.map((m) => `${m.codigo || ''} ${m.texto}`).join(' | ');
    const semDeclaracao = /MSG_ISN_005/i.test(junto)
        || /n[ãa]o h[áa] declara[çc][ãa]o transmitida/i.test(junto);

    if (semDeclaracao) {
        return {
            situacao: 'sem-declaracao',
            mensagemDaReceita: msgs,
            titulo: 'Não existe declaração transmitida nesta competência.',
            explicacao: 'A Receita respondeu que não há PGDAS-D entregue para o período — '
                + 'então não há o que consultar aqui. Isso NÃO é falha do app nem da empresa: '
                + 'é ausência de entrega.',
            acao: 'Escolha uma competência que já foi declarada e aceita. E se esta competência '
                + 'deveria ter sido entregue, ela está VENCENDO — a MAED é de R$ 50,00 por competência.',
        };
    }
    // ⚠️ PREMISSA DERRUBADA POR RESPOSTA REAL (12/08/2026).
    //
    // Eu supunha que o CONSULTIMADECREC14 devolvesse a declaração ESTRUTURADA —
    // era essa a aposta do botão "🔎 Atividades declaradas". A resposta de uma
    // competência ENTREGUE mostrou outra coisa:
    //
    //   "dados": { "numeroDeclaracao": "...", "recibo": {..pdf..},
    //              "declaracao": {..pdf..}, "maed": null }
    //
    // Só PDF. Não vem idAtividade, não vem qualificação, não vem
    // {codigoTributo, id}. Ou seja: o número da isenção/imunidade NÃO sai por
    // esta porta, e insistir aqui é gastar clique do colaborador à toa.
    //
    // (E bate com a história: o código 9 do ISS fixo NUNCA veio desta consulta —
    // veio do input escondido do e-CAC. A fonte sempre foi o formulário.)
    const temPdf = /"?(recibo|declaracao)"?\s*[:=]/.test(JSON.stringify(resposta || ''))
        || !!(resposta?.dados?.recibo || resposta?.dados?.declaracao);
    const numeroDeclaracao = resposta?.dados?.numeroDeclaracao || null;
    if (temPdf) {
        return {
            situacao: 'so-pdf',
            numeroDeclaracao,
            mensagemDaReceita: msgs,
            titulo: 'A declaração EXISTE, mas esta consulta devolve só os PDFs.',
            explicacao: 'O SERPRO respondeu com o recibo e a declaração em PDF — e nada de estrutura: '
                + 'não vêm códigos de atividade nem qualificação tributária. '
                + 'O número da isenção/imunidade não sai por aqui.',
            acao: 'O número vive no FORMULÁRIO do e-CAC: abra o PGDAS-D da competência, botão direito no '
                + 'campo do tributo (ICMS/IPI) → Inspecionar → copie o <select> inteiro (Copy outerHTML). '
                + 'O value de cada <option> é o id. Foi assim que saiu o código 9 do ISS fixo.',
        };
    }

    return {
        situacao: msgs.length ? 'sem-atividade-com-mensagem' : 'sem-atividade',
        mensagemDaReceita: msgs,
        titulo: 'A consulta respondeu e não veio atividade nenhuma.',
        explicacao: 'Duas causas opostas: a Receita devolveu só o recibo/valores, SEM o detalhamento; '
            + 'ou a declaração é SEM MOVIMENTO — e aí ela realmente não tem atividade '
            + '(o relatório da Receita imprime "Nenhuma atividade selecionada").',
        acao: 'A resposta crua abaixo diz qual das duas é. Se for uma declaração sem movimento '
            + 'aceita, é ela que destrava o "Declarar sem movimento" pelo app.',
    };
}

/**
 * Ids que o app JÁ sabe montar (pgdasMapper). Um id declarado que não está
 * aqui é justamente o que estamos procurando — a atividade que a empresa usa
 * e o app ainda não mapeia.
 */
export const IDS_ATIVIDADE_CONHECIDOS = [1, 2, 3, 4, 5, 6, 11, 12, 14, 15, 17, 18, 29, 30, 31];

export const ROTULO_ATIVIDADE_CONHECIDA = {
    1: 'Comércio (Anexo I)',
    2: 'Comércio com ST/monofásico (Anexo I)',
    3: 'Comércio para o exterior (Anexo I)',
    4: 'Indústria (Anexo II)',
    5: 'Indústria com ST/monofásico (Anexo II)',
    6: 'Indústria para o exterior (Anexo II)',
    11: 'Serviços Anexo V — ISS próprio município',
    12: 'Serviços Anexo V — ISS retido pelo tomador',
    14: 'Serviços Anexo III — ISS próprio município',
    15: 'Serviços Anexo III — ISS retido pelo tomador',
    17: 'Serviços Anexo IV — ISS próprio município',
    18: 'Serviços Anexo IV — ISS retido pelo tomador',
    29: 'Serviços Anexo V para o exterior',
    30: 'Serviços Anexo III para o exterior',
    31: 'Serviços Anexo IV para o exterior',
};

/**
 * Classifica o que foi encontrado, separando o que o app já sabe montar do que
 * é NOVO (o achado que interessa). Farol honesto: resposta sem atividade
 * nenhuma não é "empresa sem atividade" — é consulta que não trouxe o
 * detalhamento, e o motivo vai escrito.
 */
export function resumirAtividadesDeclaradas(atividades) {
    const lista = Array.isArray(atividades) ? atividades : [];
    const conhecidas = lista.filter((a) => IDS_ATIVIDADE_CONHECIDOS.includes(a.idAtividade));
    const novas = lista.filter((a) => !IDS_ATIVIDADE_CONHECIDOS.includes(a.idAtividade));
    return {
        total: lista.length,
        conhecidas: conhecidas.map((a) => ({ ...a, rotulo: ROTULO_ATIVIDADE_CONHECIDA[a.idAtividade] || null })),
        novas,
        temNova: novas.length > 0,
    };
}
