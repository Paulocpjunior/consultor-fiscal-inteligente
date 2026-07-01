/**
 * Firestore rejects `undefined` anywhere in a document payload.
 * Keep object fields absent and keep array positions explicit as null.
 */
export function sanitizeForFirestore<T>(value: T): T {
    if (value === undefined) return null as T;
    if (value === null) return value;
    if (value instanceof Date) return value;

    if (Array.isArray(value)) {
        return value.map(item => item === undefined ? null : sanitizeForFirestore(item)) as T;
    }

    if (typeof value === 'object') {
        const clean: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (child === undefined) continue;
            clean[key] = sanitizeForFirestore(child);
        }
        return clean as T;
    }

    return value;
}
