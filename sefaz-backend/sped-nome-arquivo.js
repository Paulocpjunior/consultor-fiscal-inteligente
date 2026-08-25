// ============================================================================
// sefaz-backend/sped-nome-arquivo.js  (PURO — testável)
//
// O NOME DO ARQUIVO DO SPED DIZ QUAL GERAÇÃO ELE É.
//
// ═══ POR QUE EXISTE (Paulo, 25/08, PWR 1364 · 07/2026) ══════════════════════
//
// *"Este é o 4º dia, o mesmo erro da mesma empresa sobre o mesmo assunto!!!!!!
// não dá mais pra postergar"* — com o print do M210 do PVA mostrando
// `VL_REC_BRT 38.316,84` e o arquivo que ele mandou ANEXO, no mesmo minuto,
// declarando **37.754,60**.
//
// Os dois estavam certos: o ARQUIVO estava corrigido e o PVA mostrava OUTRO
// arquivo — o par `38.316,84 / 30.958,77` é exatamente o estado de 20/08, em
// que o desconto já saía da BASE e ainda não saía da RECEITA.
//
// 🚨 **E A CAUSA DE NINGUÉM CONSEGUIR PERCEBER ISSO ERA O NOME**: toda geração
// da mesma empresa/competência produzia `SPED_CONTRIB_31947349000169_202607.txt`,
// byte a byte o mesmo nome. Quatro dias de correção ⇒ quatro arquivos
// indistinguíveis na pasta de downloads (o navegador só acrescenta "(1)",
// "(2)"…), e no PVA nada os separa: ele guarda a escrituração IMPORTADA na
// base dele, então a tela continua mostrando a importação antiga até alguém
// reimportar.
//
// 📌 **REGRA QUE FICA: arquivo que a pessoa vai conferir contra outro sistema
// nasce com a HORA da geração no nome.** Print prova o ARQUIVO, não o código —
// e arquivo tem data. Sem a data no nome, "confira se é o arquivo novo" é um
// pedido que ninguém tem como cumprir.
//
// ⚠️ **O CARIMBO É DE BRASÍLIA, não do processo.** O backend roda no Cloud Run,
// que é UTC: um arquivo gerado às 21h de Brasília sairia carimbado com o dia
// SEGUINTE, e aí o nome — que existe justamente para ordenar as gerações —
// passaria a confundir. O Brasil não tem horário de verão desde 2019, então o
// deslocamento é fixo em −03:00.
// ============================================================================

/** Deslocamento de Brasília, em minutos. Fixo desde o fim do horário de verão (2019). */
export const OFFSET_BRASILIA_MIN = -180;

/**
 * O carimbo da geração — `AAAAMMDD-HHMM`, no fuso de Brasília.
 *
 * @param {number} [agoraMs] instante da geração (default: agora).
 * @returns {string} vazio quando o instante é ilegível — nome sem carimbo é
 *   pior que nome nenhum, mas nome com carimbo INVENTADO é o que ordena errado.
 */
export function carimboDaGeracao(agoraMs = Date.now()) {
    const ms = Number(agoraMs);
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms + OFFSET_BRASILIA_MIN * 60 * 1000);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n, casas = 2) => String(n).padStart(casas, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
        + `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/**
 * O nome do arquivo do SPED, com a geração identificada.
 *
 * `SPED_CONTRIB_31947349000169_202607_20260825-1432.txt`
 *
 * ⚠️ O prefixo e a ordem NÃO mudam: quem procura por empresa e competência
 * continua achando pela mesma busca, e a ordenação alfabética passa a ser
 * cronológica dentro da competência — a geração mais nova fica por último.
 *
 * @param {{familia: string, cnpj?: string, periodo: string, agoraMs?: number}} p
 */
export function nomeDoArquivoSped({ familia, cnpj, periodo, agoraMs } = {}) {
    const fam = String(familia || 'SPED').trim();
    const doc = String(cnpj || '').replace(/\D/g, '');
    const per = String(periodo || '').replace(/[^0-9A-Za-z_-]/g, '');
    const carimbo = carimboDaGeracao(agoraMs);
    const partes = [fam, doc, per, carimbo].filter(Boolean);
    return `${partes.join('_')}.txt`;
}

/**
 * O aviso que liga a TELA ao ARQUIVO: o nome da geração e as linhas que a
 * pessoa vai conferir no PVA, copiadas do arquivo que acabou de sair.
 *
 * 🚨 É a outra metade da lição do PWR. O número na tela já existia desde 24/08
 * (*"bruta 38.316,84 − desconto 562,24 = VL_REC_BRT 37.754,60"*) e mesmo assim
 * o dia seguinte começou igual — porque **o PVA guarda a escrituração
 * IMPORTADA na base dele**: enquanto ninguém apagar e reimportar, a tela
 * continua mostrando a importação anterior, com o número velho. O aviso passou
 * a dizer isso, com a AÇÃO, em vez de só repetir o número certo.
 *
 * ⚠️ As linhas vêm do arquivo GERADO, nunca do objeto em memória — auditar a
 * intenção foi o que deixou o C100 sair com modelo 55 e chave 65 por meses.
 *
 * @param {{filename: string, linhas: string[], registros?: string[]}} p
 * @returns {string[]} zero ou um aviso — sem as âncoras, não se afirma nada.
 */
export function avisoDeIdentidadeDoArquivo({ filename, linhas, registros } = {}) {
    const nome = String(filename || '').trim();
    if (!nome) return [];
    const alvo = (registros && registros.length ? registros : ['M210', 'M610', 'E110']);
    const ancoras = (Array.isArray(linhas) ? linhas : [])
        .map(l => String(l || '').replace(/\r?\n$/, ''))
        .filter(l => alvo.some(r => l.startsWith(`|${r}|`)));
    if (!ancoras.length) return [];
    return [
        `Arquivo gerado agora: ${nome} — e ele declara ${ancoras.join(' · ')}. `
        + 'Se o PVA mostrar OUTRO número, ele está exibindo uma importação ANTERIOR: o PVA guarda a '
        + 'escrituração importada na base dele, então apague a escrituração desta competência e importe '
        + 'ESTE arquivo (confira o nome, que agora traz a data e a hora da geração).',
    ];
}
