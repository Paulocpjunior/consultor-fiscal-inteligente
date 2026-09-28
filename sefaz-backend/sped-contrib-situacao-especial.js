/**
 * sped-contrib-situacao-especial.js — registro 0000 do EFD-Contribuições,
 * campos 04 (IND_SIT_ESP), 06 (DT_INI) e 07 (DT_FIN) numa SITUAÇÃO ESPECIAL.
 *
 * GIRY (1365), 28/09: "vou gerar um EFD de encerramento — essa opção será
 * habilitada no consultor? Gerei, validei no PVA e continua como arquivo
 * normal." Não havia campo: o 0000 saía sempre com IND_SIT_ESP vazio e as
 * datas do mês inteiro, e o PVA só oferece a situação na tela dele.
 *
 * Guia Prático EFD-Contribuições, registro 0000:
 *   04 IND_SIT_ESP  0 Abertura · 1 Cisão · 2 Fusão · 3 Incorporação · 4 Encerramento
 *   06 DT_INI       primeiro dia do mês, EXCETO na abertura (data do evento)
 *   07 DT_FIN       último dia do mês, EXCETO em cisão/fusão/incorporação/
 *                   encerramento (data do evento)
 *
 * PURO: recebe o que a tela mandou e a competência; devolve o que o 0000
 * escreve. Nada de default: sem situação, o arquivo é o normal; com situação
 * e sem a data do evento, é recusa dita (a data é o fato, não se deduz).
 */

export const SITUACOES_ESPECIAIS = Object.freeze({
    '0': Object.freeze({ codigo: '0', rotulo: 'Abertura', dataNoCampo: 'DT_INI' }),
    '1': Object.freeze({ codigo: '1', rotulo: 'Cisão', dataNoCampo: 'DT_FIN' }),
    '2': Object.freeze({ codigo: '2', rotulo: 'Fusão', dataNoCampo: 'DT_FIN' }),
    '3': Object.freeze({ codigo: '3', rotulo: 'Incorporação', dataNoCampo: 'DT_FIN' }),
    '4': Object.freeze({ codigo: '4', rotulo: 'Encerramento', dataNoCampo: 'DT_FIN' }),
});

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_COMP = /^(\d{4})-(\d{2})$/;

/** 'AAAA-MM-DD' → 'DDMMAAAA' (formato das datas do SPED). */
export function dataSped(iso) {
    const m = RE_DATA.exec(String(iso || ''));
    return m ? `${m[3]}${m[2]}${m[1]}` : '';
}

function dataValida(iso) {
    const m = RE_DATA.exec(String(iso || ''));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * Confere o pedido da tela.
 * @returns {{ok:true, valor:null}|{ok:true, valor:{indSitEsp:string, rotulo:string, dataEvento:string, dtIni:string|null, dtFin:string|null, aviso:string}}|{ok:false, erro:string}}
 */
export function conferirSituacaoEspecial({ situacaoEspecial, dataEvento, competencia } = {}) {
    const cod = String(situacaoEspecial ?? '').trim();
    if (cod === '') return { ok: true, valor: null };
    const sit = SITUACOES_ESPECIAIS[cod];
    if (!sit) {
        return { ok: false, erro: `Situação especial "${cod}" não existe no leiaute — use 0 Abertura, 1 Cisão, 2 Fusão, 3 Incorporação ou 4 Encerramento.` };
    }
    const data = String(dataEvento || '').trim();
    if (!data) return { ok: false, erro: `Situação especial "${sit.rotulo}" exige a DATA DO EVENTO (AAAA-MM-DD): é ela que vai no ${sit.dataNoCampo} do 0000.` };
    if (!dataValida(data)) return { ok: false, erro: `Data do evento ilegível: "${data}". Use AAAA-MM-DD.` };
    const comp = RE_COMP.exec(String(competencia || ''));
    if (!comp) return { ok: false, erro: 'Competência ilegível (AAAA-MM).' };
    if (data.slice(0, 7) !== `${comp[1]}-${comp[2]}`) {
        return { ok: false, erro: `A data do evento (${data}) está fora da competência ${comp[1]}-${comp[2]}: o arquivo de ${sit.rotulo.toLowerCase()} é o do MÊS do evento.` };
    }
    const dt = dataSped(data);
    const valor = {
        indSitEsp: sit.codigo,
        rotulo: sit.rotulo,
        dataEvento: data,
        dtIni: sit.dataNoCampo === 'DT_INI' ? dt : null,
        dtFin: sit.dataNoCampo === 'DT_FIN' ? dt : null,
        aviso: `Arquivo de ${sit.rotulo.toUpperCase()}: 0000 IND_SIT_ESP=${sit.codigo}, ${sit.dataNoCampo}=${dt} (data do evento). `
            + 'Confira no PVA que a situação especial aparece no 0000 antes de assinar/transmitir.',
    };
    return { ok: true, valor };
}
