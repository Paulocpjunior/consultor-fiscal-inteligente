/**
 * spedFiscalStorageService.ts
 * Persistência de arquivos SPED importados no Firestore.
 * Salva metadados do arquivo e resultado do parse para histórico.
 */

import {
    collection,
    doc,
    getDocs,
    setDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit as fbLimit,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebaseConfig';
import type { SpedFiscalArquivo, SpedFiscalParseResult, User } from '../types';

const COL_SPED_ARQUIVOS = 'sped_arquivos';

function ensureDb() {
    if (!isFirebaseConfigured || !db) throw new Error('Firestore não configurado.');
    return db;
}

export async function salvarSpedArquivo(
    parseResult: SpedFiscalParseResult,
    user: User,
): Promise<string> {
    const database = ensureDb();
    const arquivo = parseResult.arquivo;
    const id = arquivo.id;

    const docData = {
        ...arquivo,
        importadoPorUid: user.id,
        importadoPorNome: user.name,
        importadoEm: Date.now(),
        resumo: {
            totalC100: parseResult.documentosC100.length,
            totalD100: parseResult.documentosD100.length,
            totalC170: parseResult.documentosC100.reduce((s, c) => s + c.itens.length, 0),
            totalParticipantes: parseResult.participantes.length,
            totalProdutos: parseResult.produtos.length,
            valorTotalC100: parseResult.documentosC100.reduce((s, c) => s + c.valorDocumento, 0),
            icmsTotalC100: parseResult.documentosC100.reduce((s, c) => s + (c.valorIcms || 0), 0),
            ipiTotalC100: parseResult.documentosC100.reduce((s, c) => s + (c.valorIpi || 0), 0),
            temApuracaoIcms: !!parseResult.apuracaoIcms,
            temApuracaoIpi: !!parseResult.apuracaoIpi,
            icmsRecolher: parseResult.apuracaoIcms?.valorIcmsRecolher,
            // 21/08: era `valorIpiRecolher` (fields[3]) — que no leiaute real do
            // E520 é o VL_CRED_IPI. O IPI a recolher é o VL_SD_IPI (campo 8).
            ipiRecolher: parseResult.apuracaoIpi?.valorSaldoDevedorIpi,
            erros: parseResult.erros.length,
            avisos: parseResult.avisos.length,
        },
    };

    await setDoc(doc(database, COL_SPED_ARQUIVOS, id), docData);
    return id;
}

export async function listarSpedArquivos(
    user: User,
    max = 50,
): Promise<SpedFiscalArquivo[]> {
    const database = ensureDb();
    const isMaster = user.role === 'admin' || user.email?.toLowerCase() === 'junior@spassessoriacontabil.com.br';

    const constraints = isMaster
        ? [orderBy('importadoEm', 'desc'), fbLimit(max)]
        : [where('importadoPorUid', '==', user.id), orderBy('importadoEm', 'desc'), fbLimit(max)];

    const snap = await getDocs(query(collection(database, COL_SPED_ARQUIVOS), ...constraints));
    return snap.docs.map(d => ({ ...d.data(), id: d.id } as SpedFiscalArquivo));
}

export async function deletarSpedArquivo(id: string): Promise<void> {
    const database = ensureDb();
    await deleteDoc(doc(database, COL_SPED_ARQUIVOS, id));
}
