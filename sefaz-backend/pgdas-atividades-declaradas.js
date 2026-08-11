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
