// Tipos de `competencia.js` — o dono da pergunta "qual é a competência?".
//
// Nasceu em 26/08, quando a trava do **fim de mês** passou a precisar dela no
// FRONTEND: a ficha grava `mesReferencia` em quatro formas, e comparar com
// `===` é justamente o descasamento que já mordeu três vezes em 15/08.
//
// ⚠️ `.d.ts` à mão é a armadilha das duas formas com outra roupa (20/08): tipo
// e implementação são duas declarações do mesmo fato. Export novo no `.js`
// entra aqui no MESMO PR.

/** Traz qualquer forma conhecida para `AAAA-MM`. `null` = não reconhecida —
 *  nunca chuta período, porque competência chutada é guia no mês errado. */
export function normalizarCompetencia(comp: unknown): string | null;

/** Competência no formato da coleção `tarefas` (`MM/AAAA`). */
export function competenciaTarefa(comp: unknown): string | null;

/** TODAS as formas em que a competência pode estar GRAVADA — para consultar
 *  acervo antigo, anterior à normalização. */
export function formasDaCompetencia(comp: unknown): string[];

/**
 * A porta da GERAÇÃO de arquivo. Normaliza as outras formas legítimas
 * (`07/2026`, `202607`) e RECUSA o ilegível — competência chutada é arquivo
 * entregue no mês errado, e o vazio ali é uma afirmação à Receita.
 *
 * ⚠️ Devolve o resultado, NÃO lança: quem monta o arquivo precisa da frase
 * para pôr na tela. (Eu escrevi `: string` aqui na primeira versão e o `tsc`
 * pegou na hora, através dos testes que já a usavam — é para isso que o
 * `.d.ts` existe.)
 */
export function competenciaParaGerarArquivo(bruta: unknown):
    { ok: true; competencia: string } | { ok: false; erro: string };
