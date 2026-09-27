/**
 * services/nfseSpListaJanela.ts  (PURO — testável)
 *
 * 🧊 A LISTA DE NFS-e SP QUE TRAVAVA O NAVEGADOR (Paulo, 25/09): "quando
 * coloco CNPJ, emitidas/recebidas e o período, o consultor fica demorando e
 * quando carrega dá 'Esta página não está respondendo'". O rodapé dizia
 * "… de 20000 carregadas": a tela pedia 5000, mas o paginador ignorava o
 * limite e descia até 20.000 documentos inteiros para o navegador — e depois
 * desenhava as 20.000 linhas de uma vez.
 *
 * Três réguas, todas puras:
 *  - `periodoPadrao`: sem filtro nenhum, a primeira carga é do mês corrente,
 *    não do acervo inteiro;
 *  - `LINHAS_POR_PAGINA` + `linhasVisiveis`: a tabela desenha 200 linhas por
 *    vez e cresce sob demanda — 5.000 linhas de uma vez ainda congelam;
 *  - `textoDaContagem`: farol honesto — "mostrando X de Y" e, quando o teto
 *    foi atingido, DIZ que pode haver mais e manda estreitar o período.
 */

export const LIMITE_DOCS_NFSE_SP = 5000;
export const LINHAS_POR_PAGINA = 200;

/** Primeiro dia do mês de `hojeIso` ('AAAA-MM-DD') — o período da primeira carga. */
export function periodoPadrao(hojeIso: string): { dataInicio: string; dataFim: string } {
    const m = /^(\d{4})-(\d{2})/.exec(String(hojeIso || ''));
    if (!m) return { dataInicio: '', dataFim: '' };
    return { dataInicio: `${m[1]}-${m[2]}-01`, dataFim: '' };
}

/** Quantas linhas a tabela desenha agora (cresce de página em página). */
export function linhasVisiveis(total: number, paginas: number): number {
    const p = Math.max(1, Math.floor(paginas || 1));
    return Math.min(Math.max(0, total || 0), p * LINHAS_POR_PAGINA);
}

export interface ContagemLista {
    filtradas: number;   // depois da busca em memória
    carregadas: number;  // o que veio do banco
    visiveis: number;    // o que está desenhado
    truncado: boolean;   // o teto de leitura foi atingido — pode haver mais
    limite?: number;
}

/** A frase do rodapé: nunca afirma completude que a leitura não estabeleceu. */
export function textoDaContagem(c: ContagemLista): string {
    const limite = c.limite ?? LIMITE_DOCS_NFSE_SP;
    const base = c.visiveis < c.filtradas
        ? `mostrando ${c.visiveis} de ${c.filtradas} (${c.carregadas} carregadas)`
        : `${c.filtradas} de ${c.carregadas} carregadas`;
    if (!c.truncado) return base;
    return `${base} · teto de ${limite} atingido — pode haver mais notas; estreite o período ou informe o CNPJ`;
}
