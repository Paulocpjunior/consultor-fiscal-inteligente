/**
 * services/formatos.ts — formatadores de TELA que aguentam ausência.
 *
 * Seis cópias de `fmtBRL = (v: number) => v.toLocaleString(...)` e oito de
 * `fmtComp = (c) => c.split('-')...` viviam espalhadas por components/ e
 * services/. As cópias sem guarda DERRUBAM a tela quando o valor vem
 * `undefined`/`null` (campo que o backend não mandou, competência vazia) —
 * `Cannot read properties of undefined (reading 'toLocaleString')` num painel
 * inteiro por causa de uma célula. Formatador de tela não é lugar de exceção:
 * ausência sai como traço, e quem decide se ausência é problema é a régua de
 * quem lê o dado, não o formatador.
 *
 * ⚠️ NÃO é o dono de "que número a pessoa digitou?" (`valorDigitado.ts`) nem
 * de competência (`sefaz-backend/competencia.js`): aqui é só a forma de
 * IMPRIMIR o que já está decidido.
 */

/** Moeda pt-BR; `null`/`undefined`/NaN/texto ilegível viram '—' em vez de exceção. */
export function fmtBRL(v: unknown): string {
    const n = typeof v === 'number' ? v : (v === null || v === undefined || v === '' ? NaN : Number(v));
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** `AAAA-MM` → `MM/AAAA`; vazio devolve '' e forma desconhecida devolve o texto como veio. */
export function fmtComp(c: unknown): string {
    const s = String(c ?? '').trim();
    if (!s) return '';
    const m = s.match(/^(\d{4})-(\d{2})$/);
    return m ? `${m[2]}/${m[1]}` : s;
}
