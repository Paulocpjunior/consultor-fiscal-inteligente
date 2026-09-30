// ─────────────────────────────────────────────────────────────────────────────
// sefaz-backend/guia-iss.js  (PURO — testável)
//
// 🔒 QUAL GUIA DE ISS ESTE ENVIO É — dono único da pergunta (30/09).
//
// ISS próprio e ISS RETIDO como tomadora são DUAS guias do município, de
// naturezas diferentes (ver `aplicarIssNaRotina`). Até aqui a resposta morava
// num regex dentro da Rotina (`/retid/i` no tipo digitado) e a baixa da
// obrigação mandava QUALQUER "ISS" procurar a tarefa do ISS próprio.
//
// Paulo, 30/09 (SILVIO FREIRE LANCHONETE e outras com ISS):
// *"dá ISS retido prestador, porém já foi enviado por fora, já fiz rito também,
// mas essa pendência não sai da tela"*. Dois defeitos juntos:
//
//  1. O registro por fora é TEXTO LIVRE. Quem digitou "ISS" numa empresa que
//     só deve o RETIDO (a lanchonete não presta serviço: o próprio nem existe)
//     fechava o ISS PRÓPRIO — que ninguém devia — e o retido ficava âmbar
//     para sempre.
//  2. A baixa ia atrás da tarefa `ISS` (ISS SP, a do prestador) e, sem ela,
//     gravava `sem-tarefa` — "o cron não gerou". Só que a guia do retido NÃO
//     TEM tarefa em Vencimentos em empresa nenhuma: a pendência mandava "gerar
//     as tarefas e dar baixa manual" numa obrigação que não existe.
//
// A régua, sem dedução esperta:
//  · o texto diz RETIDO/RETENÇÃO/TOMADOR → é a guia do retido;
//  · o texto diz só "ISS" e a empresa deve UMA guia de ISS no mês → é essa
//    (não há outra que ele possa ser);
//  · o texto diz só "ISS" e ela deve as DUAS → continua o próprio, como
//    sempre foi, e a pendência do retido diz COMO registrá-lo.
// ─────────────────────────────────────────────────────────────────────────────

function textoDoTipo(tipo) {
    return String(tipo || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** O tipo digitado nomeia ISS (ISS, ISSQN, "GUIA ISS PMSP"…)? */
export function ehTipoIss(tipo) {
    return /\bISS(QN)?\b/.test(textoDoTipo(tipo));
}

/** O tipo digitado nomeia o ISS RETIDO (retido, retenção, tomador)? */
export function ehTipoIssRetido(tipo) {
    const t = textoDoTipo(tipo);
    return ehTipoIss(t) && /RETID|RETENC|TOMAD/.test(t);
}

/**
 * Qual guia de ISS o envio é, sabendo o que a empresa deve no mês.
 *
 * @param {{tipo?: string}} envio
 * @param {{aRecolher?: number, tomado?: number}} [devido] ISS próprio a
 *   recolher e ISS retido como tomadora, do MESMO núcleo do painel 🏛️ ISS SP.
 *   Sem ele, só o texto decide.
 * @returns {'retido' | 'proprio' | null} null = o envio não é de ISS.
 */
export function guiaIssDoEnvio(envio, devido = {}) {
    const tipo = envio?.tipo;
    if (!ehTipoIss(tipo)) return null;
    if (ehTipoIssRetido(tipo)) return 'retido';
    const deveProprio = Number(devido?.aRecolher || 0) > 0;
    const deveRetido = Number(devido?.tomado || 0) > 0;
    if (deveRetido && !deveProprio) return 'retido';
    return 'proprio';
}
