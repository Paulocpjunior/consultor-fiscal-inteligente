// ============================================================================
// sefaz-backend/obrigacao-fora-do-catalogo.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 📋 DECLARAR A ENTREGA DE UMA OBRIGAÇÃO QUE O CATÁLOGO NÃO COBRE.
//
// ═══ O CASO (Paulo, 28/08, CLINICA MEDICA MANTOAN 07/2026) ══════════════════
//
// *"Das empresas que são só serviços e obrigações e envio de impostos, para
// encerrar o mês… já está ok, e pra encerrar o mês essas duas etapas está como
// se não tivesse feita."*
//
// A etapa 4 dizia: *"7 obrigação(ões) entregue(s) · o catálogo NÃO cobre 1
// obrigação(ões) deste regime: INSS Patronal (depende de folha)"*, com a ação
// *"não dê o mês por fechado por causa da lista"*.
//
// 🚨 E ESSA ETAPA NÃO TINHA COMO FECHAR. NUNCA. O INSS patronal depende da
// FOLHA, que vive no módulo de DP — este catálogo não vai cobri-lo em nenhuma
// competência. Ou seja: o app mandava, para sempre, não fechar o mês. É o
// alarme que a pessoa NÃO CONSEGUE apagar (27/08) na forma mais cara: ele não
// só desgasta, ele TRANCA o fim de mês de quem fez todo o trabalho.
//
// ═══ ISTO NÃO FURA "NADA SE MARCA À MÃO" — pelo mesmo motivo do envio ═══════
//
// A trava T1 existe porque **obrigação que não vira tarefa não aparece em
// lugar nenhum**, e o mês fecharia sobre uma lista incompleta sem ninguém ver.
// O que ela protege é a VISIBILIDADE, não a entrega — e a entrega dessas
// obrigações sempre foi humana, por fora, porque o app não tem o prazo nem o
// insumo.
//
// Então o que entra aqui é o mesmo desenho do envio declarado (27/08) e da
// reabertura do fim de mês: **motivo escrito, com autor e data, gravado**. A
// obrigação continua NOMEADA no resumo, agora como DECLARADA — o mês fecha, a
// ressalva fica.
//
// ═══ 🚨 O QUE NÃO É DECLARÁVEL, E É O CORAÇÃO DO MÓDULO ═════════════════════
//
// Só a obrigação PROPOSTA (a que o catálogo admite não cobrir) pode ser
// declarada. As outras três causas de `coberturaIncompleta` têm CONSERTO, e
// declarar por cima delas apagaria o caminho:
//
//  · regime INDEFINIDO   → resolve-se definindo o Regime padrão na ficha;
//  · prazo de OUTRA UF   → a data na tela é de outro estado, e é a causa mais
//                          perigosa: ela PARECE certa;
//  · UF não cadastrada   → resolve-se preenchendo os Dados Fiscais.
//
// Oferecer a declaração nesses casos seria o *"já enviei por fora"* aparecendo
// ao lado de "falta capturar": convidar a declarar o que não foi feito.
// ============================================================================

/** Piso do texto livre — o mesmo da T3 da DCTFWeb, da reabertura e do envio. */
export const MOTIVO_MINIMO = 15;

const ehData = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/**
 * A etapa 4 admite declaração?
 *
 * @param {object} etapa a etapa 'obrigacoes' montada pela Rotina
 * @returns {boolean} true só quando o que a trava aponta é obrigação PROPOSTA
 */
export function podeDeclararCobertura(etapa) {
    if (!etapa?.coberturaIncompleta) return false;
    // ⚠️ Qualquer causa COM CONSERTO tira a porta: ela não resolve, e oferecê-la
    // ali faria alguém declarar por cima de um cadastro que dá para arrumar.
    if (etapa.regimeIndefinido) return false;
    if ((etapa.prazoDeOutraUf || []).length > 0) return false;
    return (etapa.propostas || []).length > 0;
}

/**
 * Confere a declaração ANTES de gravar.
 *
 * @param {object} p
 * @param {string[]} p.obrigacoes as obrigações declaradas (as `propostas`)
 * @param {string} p.comoFoi      texto livre — como foram entregues
 * @param {string} p.quando       'AAAA-MM-DD' — quando foram entregues
 * @param {string} p.quem         e-mail/uid de quem declara
 * @param {string} [p.hojeIso]    'AAAA-MM-DD' (para o teste; default = hoje)
 * @returns {{ok: true, declaracao: object} | {ok: false, erro: string}}
 */
export function conferirDeclaracaoCobertura({ obrigacoes, comoFoi, quando, quem, hojeIso } = {}) {
    const lista = (Array.isArray(obrigacoes) ? obrigacoes : [])
        .map((o) => String(o || '').trim())
        .filter(Boolean);
    // A obrigação vai NOMEADA: "declarei que entreguei tudo" não responde nada
    // daqui a três meses, e é o nome que liga a declaração à lista da etapa.
    if (!lista.length) {
        return { ok: false, erro: 'Diga QUAIS obrigações foram entregues por fora — sem o nome, a declaração não responde nada depois.' };
    }

    const texto = String(comoFoi || '').trim();
    if (texto.length < MOTIVO_MINIMO) {
        return {
            ok: false,
            erro: `Descreva como estas obrigações foram entregues (mínimo ${MOTIVO_MINIMO} caracteres) — `
                + 'é o que responde a pergunta daqui a três meses.',
        };
    }

    if (!ehData(quando)) {
        return { ok: false, erro: 'Informe a data da entrega (AAAA-MM-DD).' };
    }
    // ⚠️ DATA NO FUTURO É RECUSADA: declarar entrega que ainda não aconteceu
    // fecharia o mês sobre trabalho não feito.
    const hoje = ehData(hojeIso) ? String(hojeIso) : new Date().toISOString().slice(0, 10);
    if (String(quando) > hoje) {
        return { ok: false, erro: 'A data da entrega está no futuro — declare o que já foi entregue.' };
    }

    const autor = String(quem || '').trim();
    // Declaração sem autor é declaração de ninguém — e é o autor que a torna
    // aceitável no lugar da tarefa que o catálogo não gerou.
    if (!autor) return { ok: false, erro: 'Sessão sem usuário — saia e entre de novo para declarar a entrega.' };

    return {
        ok: true,
        declaracao: {
            obrigacoes: lista.slice(0, 20),
            comoFoi: texto.slice(0, 600),
            quando: String(quando),
            declaradoPor: autor,
        },
    };
}

/**
 * A declaração cobre o que a etapa está apontando?
 *
 * ⚠️ Compara os NOMES: se o catálogo passar a admitir uma obrigação NOVA que a
 * declaração não menciona, a etapa volta a acusar — e é isso que se quer. Uma
 * declaração de julho não pode dar quitação a uma obrigação que apareceu
 * depois dela.
 */
export function coberturaDeclarada(etapa, declaracao) {
    if (!podeDeclararCobertura(etapa) || !declaracao) return { cobre: false, faltam: [] };
    const declaradas = new Set((declaracao.obrigacoes || []).map((o) => String(o).trim()));
    const faltam = (etapa.propostas || []).filter((p) => !declaradas.has(String(p).trim()));
    return { cobre: faltam.length === 0, faltam };
}

/** A frase que fica no resumo da etapa e no carimbo do fim de mês. */
export function textoDaDeclaracaoCobertura(d) {
    if (!d) return '';
    const [a, m, dia] = String(d.quando || '').split('-');
    const data = a && m && dia ? `${dia}/${m}/${a}` : String(d.quando || '');
    return `Entrega DECLARADA por ${d.declaradoPor} em ${data}: ${(d.obrigacoes || []).join(', ')}. `
        + `"${d.comoFoi}". O catálogo NÃO cobre estas obrigações — elas não viraram tarefa automática `
        + 'e o app não tem prova da entrega.';
}
