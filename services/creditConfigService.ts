/**
 * creditConfigService — config de credito PIS/COFINS por empresa-cliente.
 *
 * Hoje armazena APENAS a lista de categorias marcadas como "nao gera credito"
 * por empresa. Items em categorias nao-creditaveis ficam com base 0 (tanto
 * no agrupamento por categoria quanto no baseTotal global).
 *
 * Doc: empresa_credito_config/{empresaId}
 *   - categoriasNaoCreditaveis: string[]   (nomes normalizados)
 *   - atualizadoPor: string | null
 *   - atualizadoEm: serverTimestamp
 *
 * Regras Firestore: leitura e escrita para qualquer logado
 * (mesmo padrao de categorias_fornecedor).
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';

const COLLECTION = 'empresa_credito_config';

export interface EmpresaCreditConfig {
    categoriasNaoCreditaveis: string[];
}

/** Carrega config de uma empresa. Retorna { categoriasNaoCreditaveis: [] } se nao existir. */
export async function carregarCreditConfig(
    empresaId: string,
): Promise<EmpresaCreditConfig> {
    const vazio: EmpresaCreditConfig = { categoriasNaoCreditaveis: [] };
    if (!isFirebaseConfigured || !empresaId) return vazio;
    try {
        const snap = await getDoc(doc(db, COLLECTION, empresaId));
        if (!snap.exists()) return vazio;
        const data = snap.data() as Partial<EmpresaCreditConfig>;
        return {
            categoriasNaoCreditaveis: Array.isArray(data.categoriasNaoCreditaveis)
                ? data.categoriasNaoCreditaveis.filter((c): c is string => typeof c === 'string')
                : [],
        };
    } catch (e) {
        console.error('[creditConfig] carregar:', e);
        return vazio;
    }
}

/**
 * Salva a lista completa de categorias nao-creditaveis pra empresa.
 * Sobrescreve a config anterior. Deduplica antes de gravar.
 */
export async function salvarCreditConfig(
    empresaId: string,
    categoriasNaoCreditaveis: string[],
): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured) {
        return { ok: false, error: 'Firebase nao configurado' };
    }
    if (!empresaId) {
        return { ok: false, error: 'empresaId obrigatorio' };
    }
    try {
        const lista = Array.from(new Set(
            categoriasNaoCreditaveis.filter(c => typeof c === 'string' && c.trim() !== ''),
        ));
        await setDoc(doc(db, COLLECTION, empresaId), {
            categoriasNaoCreditaveis: lista,
            atualizadoPor: auth?.currentUser?.uid || null,
            atualizadoEm: serverTimestamp(),
        });
        return { ok: true };
    } catch (e) {
        console.error('[creditConfig] salvar:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}
