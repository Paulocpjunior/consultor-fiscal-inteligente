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

export async function listarContadores(): Promise<Contador[]> {
    if (!isFirebaseConfigured || !db) return [];
    // 🚨 A LISTA INTEIRA ERA NEGADA — e o catálogo respondia VAZIO, calado.
    //
    // `firestore.rules` exige `request.query.limit <= 500` em /contadores, e a
    // leitura era `getDocs(collection(db, 'contadores'))` SEM limite: para as
    // rules isso é uma query sem `limit`, que NÃO satisfaz `<= 500`, então a
    // resposta é `permission-denied` na lista toda. O modal de Dados Fiscais
    // mostrava "nenhum contador cadastrado" com contadores gravados no banco
    // — a ausência plausível de sempre (03/09).
    //
    // `fetchAllDocs` pagina por cursor com lote de 500 (o cap mais estrito das
    // rules) — satisfaz a regra E não trunca. É o dono de "ler a coleção
    // inteira pelo web SDK"; um `fbLimit(500)` solto aqui seria a segunda cópia
    // da mesma régua (ver o cabeçalho de firestorePaginate.ts).
    const docs = await fetchAllDocs(COLECAO);
    return docs
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
