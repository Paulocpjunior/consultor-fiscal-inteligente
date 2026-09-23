/**
 * contadoresService.ts — catálogo de CONTADORES do escritório (pedido do
 * Paulo, 03/08): cadastrar mais de um e escolher o correto por empresa.
 * A empresa guarda uma CÓPIA (contadorNome/Crc/Cpf) + contadorId — PDFs e
 * conferência continuam lendo os campos de sempre; o catálogo é conveniência.
 */
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, isFirebaseConfigured, auth } from './firebaseConfig';
import { fetchAllDocs } from './firestorePaginate';

export interface Contador {
    id: string;
    nome: string;
    crc: string;
    cpf: string;
}

const COLECAO = 'contadores';

/**
 * 🚨 O `list` desta coleção exige `request.query.limit <= 500` nas rules — sem
 * limite a consulta volta *"Missing or insufficient permissions"*, e o catálogo
 * aparece VAZIO (o caller engole no `.catch`). Mesma causa do `cfop_parametros`
 * em 10/09; quem passa o limite e ainda pagina é o `fetchAllDocs`.
 */
export async function listarContadores(): Promise<Contador[]> {
    if (!isFirebaseConfigured || !db) return [];
    const snap = await fetchAllDocs(COLECAO, [], { batchSize: 500 });
    return snap
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(c => c.nome)
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
}

/** Salva/atualiza um contador no catálogo. Id = CPF (dígitos) quando houver. */
export async function salvarContador(p: { nome: string; crc: string; cpf?: string }): Promise<Contador> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase não configurado.');
    const nome = (p.nome || '').trim();
    const crc = (p.crc || '').trim();
    const cpf = String(p.cpf || '').replace(/\D/g, '');
    if (!nome || !crc) throw new Error('Nome e CRC são obrigatórios.');
    const id = cpf || nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    await setDoc(doc(db, COLECAO, id), {
        nome, crc, cpf,
        atualizadoPor: auth?.currentUser?.email || null,
        atualizadoEm: serverTimestamp(),
    }, { merge: true });
    return { id, nome, crc, cpf };
}
