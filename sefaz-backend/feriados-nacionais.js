/**
 * feriados-nacionais (backend) — port em ES Modules de services/feriadosNacionais.ts
 * para uso no calendario-obrigacoes do sefaz-backend.
 *
 * Mantenha em sincronia com o TS — feriados fixos e algoritmo de Pascoa.
 */

const FERIADOS_FIXOS_MMDD = [
    '01-01', '04-21', '05-01', '09-07', '10-12',
    '11-02', '11-15', '11-20', '12-25',
];

function domingoDePascoa(ano) {
    const a = ano % 19;
    const b = Math.floor(ano / 100);
    const c = ano % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(ano, mes - 1, dia);
}

function addDias(d, n) {
    const out = new Date(d.getTime());
    out.setDate(out.getDate() + n);
    return out;
}

function toMMDD(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}-${dd}`;
}

const cacheFeriadosPorAno = new Map();

export function feriadosDoAno(ano) {
    const cached = cacheFeriadosPorAno.get(ano);
    if (cached) return cached;
    const pascoa = domingoDePascoa(ano);
    const set = new Set([
        ...FERIADOS_FIXOS_MMDD,
        toMMDD(addDias(pascoa, -2)),
        toMMDD(addDias(pascoa, -47)),
        toMMDD(addDias(pascoa, 60)),
    ]);
    cacheFeriadosPorAno.set(ano, set);
    return set;
}

export function ehFeriadoNacional(d) {
    return feriadosDoAno(d.getFullYear()).has(toMMDD(d));
}

export function ehDiaUtil(d) {
    const dia = d.getDay();
    if (dia === 0 || dia === 6) return false;
    return !ehFeriadoNacional(d);
}
