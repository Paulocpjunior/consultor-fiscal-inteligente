// ============================================================================
// sefaz-backend/competencia.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 "QUAL É A COMPETÊNCIA?" É UMA PERGUNTA SÓ — e tinha DUAS respostas.
//
// A competência circula neste app em quatro formas: `AAAA-MM` (o padrão),
// `MM/AAAA` (o catálogo de obrigações e a coleção de tarefas), `AAAA-MM-DD` (a
// ficha financeira, conforme a época do lançamento) e `AAAAMM` (colagens de
// arquivo). Havia duas funções chamadas `normalizarCompetencia`, e elas
// divergiam nos DOIS sentidos:
//
//   · `envio-imposto.js`  aceitava `AAAAMM` e **recusava** `AAAA-MM-DD`;
//   · `ipi-varredura.js`  aceitava `AAAA-MM-DD` e **recusava** `AAAAMM`.
//
// Cada uma devolvia **null** para a forma que a outra entendia — e null aqui
// não falha: some. Foi assim que o descasamento `MM/AAAA` × `AAAA-MM` mordeu
// três vezes em 15/08, uma delas em silêncio.
//
// ⚠️ `assertCompetencia`/`partesDaCompetencia` do catálogo NÃO são uma terceira
// cópia: eles respondem outra pergunta — *"esta entrada está no formato que o
// catálogo exige?"* — e LANÇAM de propósito, para validar na porta. Régua única
// é o dono da MESMA pergunta, não o dono mais próximo (lição do `ufDoDest`).
// ============================================================================

/**
 * Traz qualquer forma conhecida para `AAAA-MM`.
 *
 * Devolve **null** quando não reconhece — nunca chuta período. Competência
 * chutada é guia emitida para o mês errado.
 *
 * @param {unknown} comp
 * @returns {string|null}
 */
export function normalizarCompetencia(comp) {
    const s = String(comp ?? '').trim();
    if (!s) return null;

    // AAAA-MM e AAAA-MM-DD (a ficha financeira grava as duas).
    let m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(s);
    if (m) return mesValido(m[2]) ? `${m[1]}-${m[2]}` : null;

    // MM/AAAA — catálogo de obrigações e coleção de tarefas.
    m = /^(\d{2})\/(\d{4})$/.exec(s);
    if (m) return mesValido(m[1]) ? `${m[2]}-${m[1]}` : null;

    // AAAAMM — colagem de arquivo (SPED, extrato).
    m = /^(\d{4})(\d{2})$/.exec(s);
    if (m) return mesValido(m[2]) ? `${m[1]}-${m[2]}` : null;

    return null;
}

function mesValido(mm) {
    const n = parseInt(mm, 10);
    return n >= 1 && n <= 12;
}

/**
 * Competência no formato da coleção `tarefas` (`MM/AAAA`).
 * Devolve null quando a entrada não é reconhecível.
 */
export function competenciaTarefa(comp) {
    const n = normalizarCompetencia(comp);
    if (!n) return null;
    const [ano, mes] = n.split('-');
    return `${mes}/${ano}`;
}

/**
 * As formas em que a MESMA competência pode estar GRAVADA — para quem precisa
 * consultar o banco por igualdade e não pode perder o registro gravado noutra
 * forma.
 *
 * 🚨 Foi essa a falta que cegou a trava do DÉBITO REPETIDO: a gravação
 * normaliza para `AAAA-MM` e a consulta perguntava pelo texto cru que veio na
 * requisição. Pedindo `07/2026`, ela achava ZERO envios anteriores e liberava
 * a MESMA cobrança de novo — que é exatamente o que a trava existe para
 * impedir (caso HYPE, 17/08).
 */
export function formasDaCompetencia(comp) {
    const n = normalizarCompetencia(comp);
    if (!n) return [];
    const [ano, mes] = n.split('-');
    const cru = String(comp ?? '').trim();
    const formas = [n, `${mes}/${ano}`, `${ano}${mes}`];
    if (cru && !formas.includes(cru)) formas.push(cru);
    return formas;
}

/**
 * 🚨 A COMPETÊNCIA ENTRAVA NA GERAÇÃO SEM CONFERÊNCIA DE FORMA — e o arquivo
 * saía VAZIO dizendo que a empresa não teve movimento (22/08).
 *
 * As portas do **EFD-Contribuições** e do **EFD ICMS/IPI** só perguntavam se a
 * competência EXISTIA. Chegando `07/2026` ou `202607`, o
 * `where('competencia','==',…)` de `documentos_fiscais` — que grava sempre
 * `AAAA-MM` — devolvia **ZERO documentos**; o orquestrador avisava *"não tem
 * documentos fiscais no período; arquivo será gerado com estrutura mínima"* e
 * **o arquivo saía mesmo assim**, declarando nada à Receita.
 *
 * 🔴 É a ausência PLAUSÍVEL no lugar mais caro: empresa sem movimento é caso
 * legítimo, então o aviso não parece defeito. Mesma família do caso HYPE
 * (17/08), em que a consulta por igualdade de competência liberou a MESMA
 * cobrança duas vezes.
 *
 * ⚠️ **Normaliza em vez de recusar as outras formas** — `07/2026` e `202607`
 * dizem a mesma competência, e é para isso que o dono existe. O que RECUSA é o
 * ILEGÍVEL: competência chutada é arquivo entregue no mês errado.
 *
 * @returns {{ok: true, competencia: string} | {ok: false, erro: string}}
 */
export function competenciaParaGerarArquivo(bruta) {
    const n = normalizarCompetencia(bruta);
    if (n) return { ok: true, competencia: n };
    return {
        ok: false,
        erro: `Competência inválida: "${String(bruta ?? '')}". Use AAAA-MM (ex.: 2026-07). `
            + 'Sem competência legível o arquivo sairia VAZIO — e vazio, aqui, é uma afirmação à Receita.',
    };
}
