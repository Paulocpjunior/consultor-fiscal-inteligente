/**
 * sped-contrib-escrituracao.js — registro 0000 do EFD-Contribuições,
 * campos 03 (TIPO_ESCRIT) e 05 (NUM_REC_ANTERIOR): ORIGINAL × RETIFICADORA.
 *
 * Paulo, 28/09 (na sequência da situação especial da GIRY): "pode criar
 * escrituração retificadora, não vamos deixar nada pra trás".
 *
 * Guia Prático EFD-Contribuições 1.35, registro 0000:
 *   03 TIPO_ESCRIT        valores válidos [0, 1] — 0 original, 1 retificadora
 *   05 NUM_REC_ANTERIOR   C 041 — "somente deve ser preenchido quando a
 *                         escrituração se referir a retificação de escrituração
 *                         já transmitida, original ou retificadora … o número do
 *                         recibo deve ser informado somente com letras maiúsculas"
 *
 * PURO. Sem tipo → original. Retificadora sem recibo, recibo acima de 41
 * caracteres, ou recibo em ORIGINAL são recusas ditas — nunca arquivo
 * "quase certo" em silêncio (o PVA recusaria depois, e a volta custa um dia).
 */

export const TIPOS_ESCRITURACAO = Object.freeze({
    '0': Object.freeze({ codigo: '0', rotulo: 'Original' }),
    '1': Object.freeze({ codigo: '1', rotulo: 'Retificadora' }),
});
export const TAMANHO_MAX_RECIBO = 41;

function codigoDoTipo(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (s === '' || s === '0' || s === 'original') return '0';
    if (s === '1' || s === 'retificadora') return '1';
    return null;
}

/** Recibo como o Guia manda: sem espaços, MAIÚSCULAS. */
export function normalizarRecibo(v) {
    return String(v ?? '').replace(/\s+/g, '').toUpperCase();
}

/**
 * @returns {{ok:true, valor:{tipoEscrit:'0'|'1', rotulo:string, numRecAnterior:string, aviso:string|null}}|{ok:false, erro:string}}
 */
export function conferirTipoEscrituracao({ tipoEscrituracao, numRecAnterior } = {}) {
    const cod = codigoDoTipo(tipoEscrituracao);
    if (cod === null) {
        return { ok: false, erro: `Tipo de escrituração "${tipoEscrituracao}" não existe no leiaute — use 0 Original ou 1 Retificadora.` };
    }
    const recibo = normalizarRecibo(numRecAnterior);
    if (cod === '0') {
        if (recibo) {
            return { ok: false, erro: 'Número do recibo anterior só entra na RETIFICADORA (0000 campo 05). Se este arquivo retifica um já transmitido, marque "Retificadora"; se é original, apague o recibo.' };
        }
        return { ok: true, valor: { tipoEscrit: '0', rotulo: 'Original', numRecAnterior: '', aviso: null } };
    }
    if (!recibo) {
        return { ok: false, erro: 'Retificadora exige o NÚMERO DO RECIBO da escrituração anterior (o que o PVA/Receitanet devolveu na transmissão que está sendo retificada) — 0000 campo 05.' };
    }
    if (recibo.length > TAMANHO_MAX_RECIBO) {
        return { ok: false, erro: `Recibo com ${recibo.length} caracteres; o leiaute aceita até ${TAMANHO_MAX_RECIBO} (0000 campo 05, C 041). Confira se copiou só o número.` };
    }
    return {
        ok: true,
        valor: {
            tipoEscrit: '1',
            rotulo: 'Retificadora',
            numRecAnterior: recibo,
            aviso: `Arquivo RETIFICADOR: 0000 TIPO_ESCRIT=1, NUM_REC_ANTERIOR=${recibo}. `
                + 'A retificadora substitui a escrituração inteira daquele período — confira no PVA antes de assinar/transmitir.',
        },
    };
}
