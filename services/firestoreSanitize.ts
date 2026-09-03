/**
 * Firestore rejects `undefined` anywhere in a document payload.
 * Keep object fields absent and keep array positions explicit as null.
 *
 * 🚨 E NÚMERO QUE NÃO É NÚMERO (NaN, ±Infinity) NÃO ENTRA CALADO. A segunda
 * cópia desta régua (`JSON.parse(JSON.stringify(obj))` no serviço do Simples)
 * transformava NaN em `null` em silêncio — um faturamento que virou NaN por
 * uma conta errada chegava ao banco como "ausente", indistinguível de "não
 * lançado". Aqui a recusa NOMEIA o campo: quem grava conserta a conta, em vez
 * de descobrir meses depois que o mês está vazio.
 */
export function sanitizeForFirestore<T>(value: T, caminho = ''): T {
    if (value === undefined) return null as T;
    if (value === null) return value;
    if (value instanceof Date) return value;

    if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(`Valor inválido em "${caminho || '(raiz)'}": ${String(value)} — nada foi gravado. Confira o cálculo que alimenta este campo.`);
    }

    if (Array.isArray(value)) {
        return value.map((item, i) => item === undefined ? null : sanitizeForFirestore(item, `${caminho}[${i}]`)) as T;
    }

    if (typeof value === 'object') {
        const clean: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (child === undefined) continue;
            clean[key] = sanitizeForFirestore(child, caminho ? `${caminho}.${key}` : key);
        }
        return clean as T;
    }

    return value;
}
