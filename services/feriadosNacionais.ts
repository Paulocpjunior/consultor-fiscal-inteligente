/**
 * feriadosNacionais — feriados nacionais fixos e móveis (Brasil).
 *
 * Usado pelo calendário fiscal para prorrogar vencimentos que caem
 * em sábado, domingo OU feriado nacional para o próximo dia útil
 * (regra geral CGSN/RFB para tributos federais).
 */

const FERIADOS_FIXOS_MMDD: ReadonlyArray<string> = [
    '01-01', // Confraternização Universal
    '04-21', // Tiradentes
    '05-01', // Dia do Trabalho
    '09-07', // Independência
    '10-12', // N. Sra. Aparecida
    '11-02', // Finados
    '11-15', // Proclamação da República
    '11-20', // Consciência Negra (Lei 14.759/2023, vigência a partir de 2024)
    '12-25', // Natal
];

/**
 * Domingo de Páscoa pelo algoritmo de Meeus/Butcher (gregoriano).
 * Base para feriados móveis (Sexta Santa, Carnaval, Corpus Christi).
 */
function domingoDePascoa(ano: number): Date {
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
    const mes = Math.floor((h + l - 7 * m + 114) / 31);   // 3 = março, 4 = abril
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(ano, mes - 1, dia);
}

function addDias(d: Date, n: number): Date {
    const out = new Date(d.getTime());
    out.setDate(out.getDate() + n);
    return out;
}

function toMMDD(d: Date): string {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}-${dd}`;
}

/**
 * Retorna um Set de chaves "MM-DD" com todos os feriados nacionais
 * (fixos + móveis baseados na Páscoa) de um ano específico.
 *
 * Feriados móveis incluídos: Sexta-feira Santa, Carnaval (terça-feira)
 * e Corpus Christi. Não inclui feriados estaduais/municipais.
 */
export function feriadosDoAno(ano: number): ReadonlySet<string> {
    const pascoa = domingoDePascoa(ano);
    const sextaSanta = addDias(pascoa, -2);
    const carnavalSeg = addDias(pascoa, -48);  // segunda-feira (03/09: o backend já contava; a tela antecipava vencimento para dia sem banco)
    const carnaval = addDias(pascoa, -47);     // terça-feira
    const corpusChristi = addDias(pascoa, 60); // 60 dias após Páscoa

    return new Set<string>([
        ...FERIADOS_FIXOS_MMDD,
        toMMDD(sextaSanta),
        toMMDD(carnavalSeg),
        toMMDD(carnaval),
        toMMDD(corpusChristi),
    ]);
}

/**
 * Verifica se uma data específica é feriado nacional (Brasil).
 */
export function ehFeriadoNacional(d: Date): boolean {
    return feriadosDoAno(d.getFullYear()).has(toMMDD(d));
}

/**
 * Verifica se uma data é dia útil (não é sábado, domingo nem feriado nacional).
 */
export function ehDiaUtil(d: Date): boolean {
    const dia = d.getDay();
    if (dia === 0 || dia === 6) return false;
    return !ehFeriadoNacional(d);
}

/**
 * Prorroga uma data para o próximo dia útil se cair em fim de semana
 * ou feriado nacional. Se já for dia útil, devolve a mesma data.
 *
 * Esta é a regra geral CGSN/RFB para vencimento de tributos:
 *  - DAS (LC 123/2006 c/ Res. CGSN 140 art. 40)
 *  - DCTFWeb / EFD-Contribuições (IN RFB 2.005/2021 art. 10)
 *  - FGTS Digital (Portaria MTE 3.872/2023)
 *
 * NÃO confundir com a regra de antecipação (que se aplica apenas a
 * alguns tributos específicos como DARF de IOF — não os tratados aqui).
 */
export function prorrogarParaDiaUtil(d: Date): Date {
    const out = new Date(d.getTime());
    while (!ehDiaUtil(out)) {
        out.setDate(out.getDate() + 1);
    }
    return out;
}
