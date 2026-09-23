/**
 * 🚨 A CARTEIRA ERA CORTADA EM 500 VÍNCULOS — EM SILÊNCIO (núcleo PURO)
 *
 * Paulo, 27/08, com o print: *"todas as empresas estavam com responsáveis,
 * hoje fui ver tinha 21 sem. Quando coloco a atribuição, ele indica que já
 * responsável, mas não sai desse STATUS"*.
 *
 * ═══ OS DOIS SINTOMAS ERAM O MESMO DEFEITO ══════════════════════════════════
 *
 * A leitura era `getDocs(query(collection(db,'carteiras'), fbLimit(500)))` —
 * **um teto mudo**. Com 420 empresas e principal + backup, a carteira passou de
 * 500 vínculos, e os que ficaram fora da página não voltavam: a empresa
 * aparecia como "Sem responsável".
 *
 * E é por isso que atribuir dizia *"já atende"*: a conferência de duplicata
 * consulta por `where(empresaId, colaboradorUid)` — **essa** consulta acha o
 * vínculo, porque não passa pela página cortada. O vínculo EXISTIA; quem não o
 * via era a lista.
 *
 * ⚠️ **A SEGUNDA CÓPIA ERA PIOR QUE A PRIMEIRA.** O mesmo teto estava em
 * `getCarteiraScope` (`xmlFiscalService`), que decide QUAIS EMPRESAS O
 * COLABORADOR ENXERGA na Central de XMLs. Ali o vínculo que cai fora da página
 * faz a empresa **sumir da visão dele** — parecendo falha de captura, que é o
 * pior desfecho: manda procurar defeito onde não há.
 *
 * ═══ POR QUE NÃO BASTA "DIZER QUE CORTOU" ═══════════════════════════════════
 *
 * A régua de 30/07 (Legalização) diz que lista cortada SEMPRE informa
 * "mostrando X de N". Ela vale para EXIBIÇÃO. Aqui o corte decide ESCOPO — o
 * que a pessoa vê e sobre o que pode agir —, e escopo truncado não se resolve
 * avisando: resolve-se não truncando. O aviso fica como rede, para o dia em que
 * o teto novo for atingido.
 *
 * ⚠️ **ESTE ARQUIVO É PURO DE PROPÓSITO.** A casca (`carteiraVinculos.ts`)
 * importa o `firebaseConfig`, que usa `import.meta.env` e **não carrega no
 * jest** — régua dentro de módulo que o teste não carrega é régua sem prova.
 */

export const COLECAO_CARTEIRAS = 'carteiras';

/**
 * Teto real: a carteira tem 420 empresas × (principal + backup) e cresce com a
 * casa. 20 mil dá margem de uma ordem de grandeza — e, ao contrário do 500,
 * ele **avisa** quando é atingido em vez de cortar calado.
 */
export const TETO_VINCULOS = 20000;

export interface LeituraDeVinculos<T> {
    vinculos: T[];
    /** `true` = o teto foi atingido e PODE haver mais. Nunca é silêncio. */
    truncado: boolean;
    /** Quantos vínculos de fato voltaram — é o número que se confere na tela. */
    total: number;
}

/**
 * A frase do truncamento — nasce VAZIA quando não houve corte.
 *
 * Alarme sobre lista completa é o que ensina a equipe a ignorar o aviso que
 * importa; e quando ele aparecer, precisa dizer a CONSEQUÊNCIA, porque "lista
 * cortada" sozinho não explica por que uma empresa apareceu sem responsável —
 * e aí a pessoa reatribui à toa, que é o que aconteceu em 27/08.
 */
export function avisoDeTruncamento(leitura: LeituraDeVinculos<unknown> | null): string | null {
    if (!leitura?.truncado) return null;
    return `A carteira passou de ${TETO_VINCULOS} vínculos e a leitura foi cortada — pode haver `
        + 'empresa aparecendo como "Sem responsável" sem estar. Avise o administrador antes de '
        + 'reatribuir: reatribuir por causa disto não corrige nada, porque o vínculo já existe.';
}
