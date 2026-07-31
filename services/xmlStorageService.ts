/**
 * xmlStorageService.ts
 * Gerencia upload e download de XMLs originais no Firebase Storage.
 *
 * Regra: o XML original NUNCA é armazenado no Firestore. O Firestore guarda
 * apenas metadados; o blob do arquivo fica em /xmls/{empresaId}/{chave}.xml.
 */

import {
    ref as storageRef,
    uploadString,
    getDownloadURL,
    deleteObject,
} from 'firebase/storage';
import { storage, isFirebaseStorageConfigured } from './firebaseConfig';

const XML_ROOT = 'xmls';

export class XmlStorageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'XmlStorageError';
    }
}

/** Caminho determinístico baseado em empresa + chave da NF-e. */
export function buildStoragePath(empresaId: string, chave: string, fallbackName?: string): string {
    const safeChave = (chave || '').replace(/\D+/g, '') || `manual-${Date.now()}`;
    const safeEmpresa = empresaId || 'sem-empresa';
    const fileBase = safeChave.length === 44 ? safeChave : `${safeChave}-${(fallbackName || 'doc').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    return `${XML_ROOT}/${safeEmpresa}/${fileBase}.xml`;
}

export interface UploadResult {
    storagePath: string;
    storageUrl: string;
}

/** Faz upload do XML original como string UTF-8. */
export async function uploadXml(
    empresaId: string,
    chave: string,
    xmlText: string,
    fallbackName?: string,
): Promise<UploadResult> {
    if (!isFirebaseStorageConfigured || !storage) {
        throw new XmlStorageError('Firebase Storage não está configurado.');
    }
    const path = buildStoragePath(empresaId, chave, fallbackName);
    const ref = storageRef(storage, path);
    const snap = await uploadString(ref, xmlText, 'raw', {
        contentType: 'application/xml',
    });
    const url = await getDownloadURL(snap.ref);
    return { storagePath: path, storageUrl: url };
}

/**
 * Recupera o XML original de uma nota PELA CHAVE, via backend (/xml-bruto).
 *
 * NÃO usa o SDK do Storage no navegador: aquele caminho dependia de três
 * coisas fora do controle da tela — o bucket do build (VITE_FIREBASE_STORAGE_
 * BUCKET pode divergir do STORAGE_BUCKET do importer), o CORS do bucket e as
 * storage.rules (que não cobriam xmls/{empresa}/eventos/…) — e qualquer uma
 * virava "storage/retry-limit-exceeded" sem diagnóstico (31/07). O backend lê
 * do MESMO bucket em que gravou, com a autorização da carteira, e quando o
 * arquivo não existe diz exatamente isso, com a ação.
 */
export async function downloadXmlText(chave: string): Promise<string> {
    const chaveLimpa = (chave || '').replace(/\D/g, '');
    if (chaveLimpa.length !== 44) {
        throw new XmlStorageError('Documento sem chave de acesso completa — não há XML para baixar.');
    }
    const { getAuth } = await import('firebase/auth');
    const u = getAuth().currentUser;
    if (!u) throw new XmlStorageError('Sessão expirada — entre novamente.');
    const token = await u.getIdToken();
    const res = await fetch(`/api/admin/sefaz/xml-bruto?chave=${chaveLimpa}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({} as any));
        throw new XmlStorageError(data.error || `Falha no servidor (HTTP ${res.status}).`);
    }
    return await res.text();
}

/** Remove o XML original do Storage (uso administrativo). */
export async function deleteXml(path: string): Promise<void> {
    if (!isFirebaseStorageConfigured || !storage) return;
    try {
        await deleteObject(storageRef(storage, path));
    } catch (err: any) {
        if (err?.code !== 'storage/object-not-found') throw err;
    }
}

/** Codifica string em base64 (uso para exportação/API, não para armazenamento). */
export function xmlToBase64(xmlText: string): string {
    try {
        return btoa(unescape(encodeURIComponent(xmlText)));
    } catch {
        return btoa(xmlText);
    }
}
