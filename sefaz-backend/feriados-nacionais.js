/**
 * feriados-nacionais (backend) — port em ES Modules de services/feriadosNacionais.ts
 * para uso no calendario-obrigacoes do sefaz-backend.
 *
 * Mantenha em sincronia com o TS — feriados fixos e algoritmo de Pascoa.
 *
 * ⚠️ ESCOPO: só feriados NACIONAIS (fixos + móveis pela Páscoa). Feriados
 * ESTADUAIS (9 de julho em SP, 20 de novembro onde ainda é estadual…) e
 * MUNICIPAIS (aniversário da cidade, padroeiro) NÃO estão cobertos — quem
 * paga guia estadual/municipal num dia desses precisa conferir o calendário
 * do ente. Cobri-los é decisão do dono, não dedução: é uma tabela por
 * município, com vigência, e a régua da casa é "prazo não se inventa".
 *
 * 🏦 CARNAVAL: a segunda-feira entrou em 03/09. Ela não é feriado nacional
 * por lei, mas os BANCOS não abrem (Res. CMN/Febraban) — e guia não se paga
 * com o banco fechado, então para efeito de "dia útil de PAGAMENTO" ela vale
 * tanto quanto a terça. Antecipar um vencimento para a segunda de Carnaval
 * era mandar pagar num dia sem compensação.
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
        toMMDD(addDias(pascoa, -2)),   // Sexta-feira Santa
        toMMDD(addDias(pascoa, -48)),  // Carnaval — segunda-feira (bancos fechados)
        toMMDD(addDias(pascoa, -47)),  // Carnaval — terça-feira
        toMMDD(addDias(pascoa, 60)),   // Corpus Christi
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
