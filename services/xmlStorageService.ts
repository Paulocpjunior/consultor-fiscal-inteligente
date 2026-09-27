/**
 * xmlStorageService.ts
 * Gerencia upload e download de XMLs originais no Firebase Storage.
 *
 * Regra: o XML original NUNCA é armazenado no Firestore. O Firestore guarda
 * apenas metadados; o blob do arquivo fica em /xmls/{empresaId}/{chave}.xml.
 */

import {
    ref as storageRef,
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

export async function uploadArquivoOriginal(empresaId: string, path: string, file: Blob): Promise<UploadResult> {
    const { getAuth } = await import('firebase/auth');
    const user = getAuth().currentUser;
    if (!user) throw new XmlStorageError('Sessão expirada. Entre novamente.');
    const form = new FormData();
    form.append('empresaId', empresaId); form.append('storagePath', path); form.append('arquivo', file, 'original');
    const response = await fetch('/api/admin/sefaz/arquivo-original-upload', {
        method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}` }, body: form,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new XmlStorageError(result.error || 'Não foi possível guardar o arquivo original.');
    return result;
}

/** Faz upload do XML original como string UTF-8. */
export async function uploadXml(
    empresaId: string,
    chave: string,
    xmlText: string,
    fallbackName?: string,
): Promise<UploadResult> {
    const path = buildStoragePath(empresaId, chave, fallbackName);
    return uploadArquivoOriginal(empresaId, path, new Blob([xmlText], { type: 'application/xml' }));
}

export async function baixarArquivoOriginal(documentoId: string, pdf = false): Promise<void> {
    const { getAuth } = await import('firebase/auth');
    const user = getAuth().currentUser;
    if (!user) throw new XmlStorageError('Sessão expirada. Entre novamente.');
    const response = await fetch(`/api/admin/sefaz/arquivo-original/${encodeURIComponent(documentoId)}`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    });
    if (!response.ok) throw new XmlStorageError((await response.json()).error || 'Falha ao baixar arquivo');
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url; a.download = `documento.${pdf ? 'pdf' : 'xml'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
