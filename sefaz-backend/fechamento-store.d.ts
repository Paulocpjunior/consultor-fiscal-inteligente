// Tipos de `fechamento-store.js` — a leitura do carimbo do fim de mês.
//
// ⚠️ `.d.ts` à mão é a armadilha das duas formas com outra roupa (20/08).
// Export novo no `.js` entra aqui no MESMO PR.

export const COLECAO_FECHAMENTOS: string;

/**
 * O id do carimbo — **régua única**, e é ela que o FRONTEND importa.
 *
 * O `lerFechamentoDaCompetencia` abaixo fala a API do **admin SDK**
 * (`db.collection(...).doc(...)`), que o navegador não tem — lá o I/O é o SDK
 * modular. O que não pode divergir entre os dois lados é o **ID**: a
 * competência circula em quatro formas neste app, e `${id}_07/2026` é um
 * documento DIFERENTE de `${id}_2026-07`. Montá-lo à mão nos dois lugares daria
 * dois carimbos para o mesmo mês, em silêncio — e a trava
 * `acervoDoFechamento.test.ts` pegou exatamente isso.
 *
 * Devolve `null` quando a empresa ou a competência não são legíveis — nunca
 * chuta um id, porque id chutado é carimbo lido no mês errado.
 */
export function idDoFechamento(empresaId: unknown, competencia: unknown): string | null;

/**
 * O carimbo desta empresa × competência, ou `null`.
 *
 * ⚠️ Falha de leitura devolve `null` de propósito: `null` significa "gere como
 * sempre gerou". Derrubar a geração do SPED porque o Firestore piscou seria
 * trocar um risco de divergência por um app que não entrega o arquivo.
 *
 * Só para o **admin SDK** (backend).
 */
export function lerFechamentoDaCompetencia(
    db: unknown, empresaId: unknown, competencia: unknown,
): Promise<any | null>;

// 03/09 (auditoria): exportações que o .js já entregava e o .d.ts não declarava —
// importador TypeScript não enxergava o símbolo (erro de compilação).
export function lerFechamentosDaCompetencia(db: unknown, competencia: string): Promise<Map<string, any>>;
