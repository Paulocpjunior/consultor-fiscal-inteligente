// ============================================================================
// sefaz-backend/sped-fiscal-periodo.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🏁 PERÍODO DA GERAÇÃO DO EFD ICMS/IPI (De/Até) — SPED de encerramento.
//
// Paulo, 02/10, com o print do IOB SAGE ("Período da Geração: De 01/09/2026
// Até 30/09/2026"): *"preciso entregar o SPED de encerramento das filiais da
// Vinatex, tem que criar esse campo também, igual no EFD"*. O CFI montava o
// 0000 sempre com o mês inteiro, a partir da competência.
//
// Guia Prático EFD ICMS/IPI, registro 0000 (a mesma régua já conferida no
// EFD-Contribuições, `sped-contrib-situacao-especial.js`, e na R20 de
// `sped-c100-regras-comuns.js`):
//   04 DT_INI  primeiro dia do mês, EXCETO no início de atividades;
//   05 DT_FIN  último dia do mês, EXCETO nos casos de encerramento de
//              atividades, fusão, cisão e incorporação.
//
// O 0000 do ICMS/IPI NÃO tem o campo IND_SIT_ESP: a situação especial existe
// só nas datas. Por isso o MOTIVO é exigido aqui, na porta: período que não é
// o mês inteiro sem uma das exceções do Guia é arquivo que o PVA recusa — e
// recusa dita na tela custa menos que no PVA.
//
// ⚠️ "Leiaute não se chuta": nada aqui deduz a data do evento. Sem as datas,
// o arquivo é o mensal normal; com elas, valem as que a pessoa digitou.
// ============================================================================

import { dataDeclaradaDoDocumento } from './xml-metadata-helper.js';
import { dataEntradaDoDocumento } from './data-entrada-escrituracao.js';

/** As exceções do Guia, e QUAL ponta do período cada uma pode mover. */
export const SITUACOES_PERIODO = Object.freeze({
    abertura: Object.freeze({ codigo: 'abertura', rotulo: 'Início de atividades', move: 'DT_INI' }),
    encerramento: Object.freeze({ codigo: 'encerramento', rotulo: 'Encerramento de atividades', move: 'DT_FIN' }),
    cisao: Object.freeze({ codigo: 'cisao', rotulo: 'Cisão', move: 'DT_FIN' }),
    fusao: Object.freeze({ codigo: 'fusao', rotulo: 'Fusão', move: 'DT_FIN' }),
    incorporacao: Object.freeze({ codigo: 'incorporacao', rotulo: 'Incorporação', move: 'DT_FIN' }),
});

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_COMP = /^(\d{4})-(\d{2})$/;

const dataValida = (iso) => {
    const m = RE_DATA.exec(String(iso || ''));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const sped = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const br = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Primeiro e último dia ('AAAA-MM-DD') de uma competência 'AAAA-MM'. */
export function limitesDaCompetencia(competencia) {
    const m = RE_COMP.exec(String(competencia || ''));
    if (!m) return null;
    const ultimo = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
    return { primeiro: `${m[1]}-${m[2]}-01`, ultimo: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, '0')}` };
}

/**
 * Confere o "Período da geração" que a tela mandou.
 *
 * @param {object} p
 * @param {string} p.competencia   'AAAA-MM' (só o modo mensal tem período parcial)
 * @param {string} [p.dataInicio]  'AAAA-MM-DD'
 * @param {string} [p.dataFim]     'AAAA-MM-DD'
 * @param {string} [p.situacao]    chave de SITUACOES_PERIODO
 * @returns {{ok:true, valor:null}
 *   | {ok:true, valor:{isoIni:string, isoFim:string, dtIni:string, dtFin:string, situacao:string|null, rotulo:string|null, parcial:boolean, aviso:string}}
 *   | {ok:false, erro:string}}
 */
export function conferirPeriodoDaGeracao({ competencia, dataInicio, dataFim, situacao } = {}) {
    const ini = String(dataInicio || '').trim();
    const fim = String(dataFim || '').trim();
    const cod = String(situacao || '').trim();
    if (!ini && !fim && !cod) return { ok: true, valor: null };

    const lim = limitesDaCompetencia(competencia);
    if (!lim) return { ok: false, erro: 'Período da geração só existe no modo MENSAL, com a competência AAAA-MM.' };
    const sit = cod ? SITUACOES_PERIODO[cod] : null;
    if (cod && !sit) {
        return { ok: false, erro: `Situação "${cod}" não é uma das exceções do Guia (início de atividades, encerramento, cisão, fusão ou incorporação).` };
    }
    const isoIni = ini || lim.primeiro;
    const isoFim = fim || lim.ultimo;
    if (!dataValida(isoIni)) return { ok: false, erro: `Data inicial ilegível: "${ini}". Use AAAA-MM-DD.` };
    if (!dataValida(isoFim)) return { ok: false, erro: `Data final ilegível: "${fim}". Use AAAA-MM-DD.` };
    const mes = lim.primeiro.slice(0, 7);
    if (isoIni.slice(0, 7) !== mes || isoFim.slice(0, 7) !== mes) {
        return { ok: false, erro: `O período ${br(isoIni)} a ${br(isoFim)} sai da competência ${mes.slice(5)}/${mes.slice(0, 4)}: o EFD ICMS/IPI é de UM mês, e o arquivo do evento é o do mês em que ele ocorreu.` };
    }
    if (isoIni > isoFim) return { ok: false, erro: `A data inicial (${br(isoIni)}) é depois da final (${br(isoFim)}).` };

    const moveIni = isoIni !== lim.primeiro;
    const moveFim = isoFim !== lim.ultimo;
    if (moveIni && sit?.move !== 'DT_INI') {
        return { ok: false, erro: `Começar em ${br(isoIni)} só vale no INÍCIO DE ATIVIDADES (Guia Prático, 0000 campo DT_INI: primeiro dia do mês, exceto na abertura). Escolha a situação ou use ${br(lim.primeiro)}.` };
    }
    if (moveFim && sit?.move !== 'DT_FIN') {
        return { ok: false, erro: `Terminar em ${br(isoFim)} só vale em ENCERRAMENTO de atividades, cisão, fusão ou incorporação (Guia Prático, 0000 campo DT_FIN: último dia do mês, exceto nesses casos). Escolha a situação ou use ${br(lim.ultimo)}.` };
    }
    if (sit && !moveIni && !moveFim) {
        // Encerramento no último dia do mês (ou abertura no dia 1) é legítimo:
        // as datas são as do mês inteiro e o arquivo é igual ao normal.
    }
    const parcial = moveIni || moveFim;
    const aviso = sit
        ? `Arquivo de ${sit.rotulo.toUpperCase()}: 0000 com DT_INI ${sped(isoIni)} e DT_FIN ${sped(isoFim)} (${br(isoIni)} a ${br(isoFim)}). `
            + 'O 0000 do EFD ICMS/IPI não tem campo de situação especial — ela aparece só nas datas. '
            + 'Confira no PVA antes de assinar/transmitir.'
        : `Período ${br(isoIni)} a ${br(isoFim)}.`;
    return {
        ok: true,
        valor: { isoIni, isoFim, dtIni: sped(isoIni), dtFin: sped(isoFim), situacao: sit?.codigo || null, rotulo: sit?.rotulo || null, parcial, aviso },
    };
}

/**
 * A data com que o documento entra no LIVRO — a MESMA que o C100 escreve no
 * DT_E_S (`sped-fiscal-blocoC.js`): entrada declarada, senão saída/entrada da
 * nota, senão emissão. Uma régua só: recortar por outra data deixaria nota no
 * arquivo com DT_E_S fora do período (o PVA recusa) ou tiraria nota que é dele.
 * @returns {string} 'AAAA-MM-DD' ou ''
 */
export function dataDoDocumentoNoLivro(nota) {
    return dataEntradaDoDocumento(nota)
        || dataDeclaradaDoDocumento(nota?.dhSaiEnt)
        || dataDeclaradaDoDocumento(nota?.dhEmi)
        || '';
}

/**
 * Tira do arquivo o que fica FORA do período parcial — e DIZ o que tirou.
 * Documento depois da data de encerramento não some calado: é sinal de que a
 * data está errada ou de que a filial ainda movimentou.
 *
 * @param {Array} notas
 * @param {{isoIni:string, isoFim:string, rotulo?:string|null}|null} periodo
 */
export function recortarNotasPeloPeriodo(notas, periodo) {
    const lista = Array.isArray(notas) ? notas : [];
    if (!periodo?.isoIni || !periodo?.isoFim) return { docs: lista, fora: [], semData: 0, avisos: [] };
    const docs = [];
    const fora = [];
    let semData = 0;
    for (const n of lista) {
        const d = dataDoDocumentoNoLivro(n);
        if (!d) { semData += 1; docs.push(n); continue; }
        if (d < periodo.isoIni || d > periodo.isoFim) {
            fora.push({ numero: String(n?.numero ?? n?.nNF ?? '').trim() || '(sem número)', data: d, direcao: n?.direcao || null });
            continue;
        }
        docs.push(n);
    }
    const avisos = [];
    if (fora.length) {
        const amostra = fora.slice(0, 10).map((f) => `nº ${f.numero} (${br(f.data)})`).join(', ');
        avisos.push(
            `🏁 ${fora.length} documento(s) da competência ficaram FORA do período ${br(periodo.isoIni)} a ${br(periodo.isoFim)}`
            + `${fora.length > 10 ? ` — mostrando 10 de ${fora.length}` : ''}: ${amostra}. `
            + 'Se a data do evento está certa, esse movimento não pertence a este arquivo; se não está, corrija o período antes de transmitir.',
        );
    }
    if (semData) {
        avisos.push(`🏁 ${semData} documento(s) sem data legível ficaram no arquivo — o recorte pelo período não consegue decidir por eles. Confira-os antes de transmitir.`);
    }
    return { docs, fora, semData, avisos };
}
