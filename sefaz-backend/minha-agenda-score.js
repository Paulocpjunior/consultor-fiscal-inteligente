// ============================================================================
// minha-agenda-score.js  (PURO — sem io/firebase, testavel)
//
// Calcula o score 0-100 do risco fiscal por empresa na Minha Agenda. As
// regras sao fiscais (cap por categoria, peso por urgencia) e merecem
// captura de regressao — qualquer mudanca no peso muda a prioridade do
// dia de TODOS os colaboradores.
//
// Regras:
//   PGDAS-D / DCTFWeb gaps:
//     +15 por gap, cap 40 (= 3 meses já saturam a fonte)
//   Mensagens nao lidas:
//     +25 por critica, cap 50 (= 2 criticas saturam)
//     +10 por alta,    cap 20 (= 2 altas saturam)
//     +3  por media,   cap 10 (= ~3 medias saturam)
//   Total: cap 100.
// ============================================================================

const PESO_GAP = 15;
const CAP_PGDAS = 40;
const CAP_DCTFWEB = 40;
const PESO_MSG_CRITICA = 25;
const CAP_MSG_CRITICA = 50;
const PESO_MSG_ALTA = 10;
const CAP_MSG_ALTA = 20;
const PESO_MSG_MEDIA = 3;
const CAP_MSG_MEDIA = 10;
const CAP_TOTAL = 100;

/**
 * @param {object} args
 * @param {string} args.regime           'simples' | 'lucro'
 * @param {number} [args.pgdasGaps=0]    qtd de competencias sem DAS (so simples)
 * @param {number} [args.dctfwebGaps=0]  qtd de competencias sem DCTFWeb (so lucro)
 * @param {number} [args.msgCriticas=0]  mensagens criticas nao lidas
 * @param {number} [args.msgAltas=0]
 * @param {number} [args.msgMedias=0]
 * @returns {{ score:number, pendencias:string[] }}
 */
export function calcularScoreAgenda(args) {
    const {
        regime, pgdasGaps = 0, dctfwebGaps = 0,
        msgCriticas = 0, msgAltas = 0, msgMedias = 0,
    } = args || {};

    let score = 0;
    const pendencias = [];

    // PGDAS so para Simples; DCTFWeb so para Lucro — entradas trocadas sao ignoradas.
    if (regime === 'simples' && pgdasGaps > 0) {
        score += Math.min(CAP_PGDAS, pgdasGaps * PESO_GAP);
        pendencias.push(`PGDAS-D pendente em ${pgdasGaps} mes(es)`);
    }
    if (regime === 'lucro' && dctfwebGaps > 0) {
        score += Math.min(CAP_DCTFWEB, dctfwebGaps * PESO_GAP);
        pendencias.push(`DCTFWeb pendente em ${dctfwebGaps} mes(es)`);
    }

    if (msgCriticas > 0) {
        score += Math.min(CAP_MSG_CRITICA, msgCriticas * PESO_MSG_CRITICA);
        pendencias.push(`${msgCriticas} mensagem(ns) CRITICA(s) nao lida(s)`);
    }
    if (msgAltas > 0) {
        score += Math.min(CAP_MSG_ALTA, msgAltas * PESO_MSG_ALTA);
        pendencias.push(`${msgAltas} mensagem(ns) ALTA(s) nao lida(s)`);
    }
    if (msgMedias > 0) {
        score += Math.min(CAP_MSG_MEDIA, msgMedias * PESO_MSG_MEDIA);
    }

    return { score: Math.min(CAP_TOTAL, score), pendencias };
}

export const _pesos = {
    PESO_GAP, CAP_PGDAS, CAP_DCTFWEB,
    PESO_MSG_CRITICA, CAP_MSG_CRITICA,
    PESO_MSG_ALTA, CAP_MSG_ALTA,
    PESO_MSG_MEDIA, CAP_MSG_MEDIA,
    CAP_TOTAL,
};
