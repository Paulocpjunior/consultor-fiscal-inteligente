/**
 * nftsRecusasService — códigos de serviço que a PMSP recusou (erro 310),
 * aprendidos DEPOIS do último deploy.
 *
 * POR QUE NO BANCO: a lista fixa (`CODIGOS_REJEITADOS_PMSP`) só cresce com
 * deploy, e a PMSP vem recusando código novo a cada leva — foram três em
 * 07/2026 e o 02658 em 05/08/2026, todos do grupo de informática que a
 * reformulação de 01/01/2026 mexeu. Esperar entrega pra bloquear um código
 * que já derrubou um lote é a mesma dor do código do ISS fixo: quem descobre
 * é a equipe, no meio da importação.
 *
 * O registro guarda a PROVA (nº do lote e a mensagem da PMSP) — código
 * fiscal bloqueado por engano custa tão caro quanto código errado enviado.
 */
import { collection, doc, getDocs, setDoc, serverTimestamp, query, limit } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';

const COLECAO = 'nfts_codigos_recusados';

export interface RecusaNfts {
    codigo: string;
    /** Nº do lote/identificação da importação que trouxe o erro 310. */
    lote?: string | null;
    /** Mensagem literal da PMSP — a prova. */
    mensagem?: string | null;
    registradoPor?: string | null;
}

const normalizar = (c: string) => String(c || '').replace(/\D/g, '').padStart(5, '0').slice(-5);

/** Conjunto pronto pra `validarNotaNfts(nota, recusados)`. */
export async function carregarRecusasNfts(): Promise<Set<string>> {
    if (!isFirebaseConfigured || !db) return new Set();
    try {
        const snap = await getDocs(query(collection(db, COLECAO), limit(500)));
        const out = new Set<string>();
        snap.forEach((d) => {
            const c = normalizar((d.data() as any)?.codigo || d.id);
            if (/^\d{5}$/.test(c)) out.add(c);
        });
        return out;
    } catch (e) {
        // Falha de leitura NÃO pode virar "nenhum código recusado": a lista
        // fixa continua valendo e a tela segue bloqueando o que já sabe.
        console.warn('[nftsRecusas] leitura falhou:', e);
        return new Set();
    }
}

export async function registrarRecusaNfts(r: RecusaNfts): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured || !db) return { ok: false, error: 'Firebase não configurado.' };
    const codigo = normalizar(r.codigo);
    if (!/^\d{5}$/.test(codigo)) {
        return { ok: false, error: `Código inválido ("${r.codigo}"). O código do serviço da NFTS tem 5 dígitos.` };
    }
    try {
        await setDoc(doc(db, COLECAO, codigo), {
            codigo,
            lote: String(r.lote || '').trim() || null,
            mensagem: String(r.mensagem || '').trim() || null,
            registradoPor: auth?.currentUser?.email || null,
            registradoEm: serverTimestamp(),
        }, { merge: true });
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message || 'Falha ao registrar a recusa.' };
    }
}
