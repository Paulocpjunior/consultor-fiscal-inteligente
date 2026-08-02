/**
 * spedAjustesService.ts — CRUD dos ajustes da apuração do ICMS (Registro
 * E111). Coleção `sped_ajustes_apuracao`, doc {empresaId}_{competencia}.
 * O gerador do SPED (backend) lê daqui; a validação do código é a MESMA
 * régua do gerador (sped-ajustes-apuracao.js) — nada de regra paralela.
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, isFirebaseConfigured, auth } from './firebaseConfig';
import type { AjusteApuracao } from '../sefaz-backend/sped-ajustes-apuracao';

export interface AjustesDoc {
    empresaId: string;
    empresaCnpj: string;
    competencia: string;
    ajustes: AjusteApuracao[];
}

const docId = (empresaId: string, competencia: string) => `${empresaId}_${competencia}`;

export async function carregarAjustes(empresaId: string, competencia: string): Promise<AjusteApuracao[]> {
    if (!isFirebaseConfigured || !db) return [];
    const snap = await getDoc(doc(db, 'sped_ajustes_apuracao', docId(empresaId, competencia)));
    return snap.exists() ? ((snap.data() as any).ajustes || []) : [];
}

export async function salvarAjustes(p: AjustesDoc): Promise<void> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase não configurado.');
    await setDoc(doc(db, 'sped_ajustes_apuracao', docId(p.empresaId, p.competencia)), {
        empresaId: p.empresaId,
        empresaCnpj: String(p.empresaCnpj || '').replace(/\D/g, ''),
        competencia: p.competencia,
        ajustes: p.ajustes.map(a => ({
            codigo: String(a.codigo || '').trim().toUpperCase(),
            descricao: String(a.descricao || '').trim(),
            valor: Math.round((Number(a.valor) || 0) * 100) / 100,
        })),
        atualizadoPor: auth?.currentUser?.email || auth?.currentUser?.uid || null,
        atualizadoEm: serverTimestamp(),
    });
}
