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

/**
 * A obrigação do ICMS-ST a recolher de UMA UF (registro E250).
 *
 * 🚨 O gerador LIA `obrigacoesStPorUf` e ninguém escrevia (varredura de 21/08):
 * o E250 NUNCA saía, e o aviso mandava "informe no cadastro" — um cadastro que
 * não existia. Vencimento e código de receita da GNRE são de tabela ESTADUAL:
 * o app não os deduz, mas agora eles têm onde ser digitados.
 */
export interface ObrigacaoStUf {
    /** DDMMAAAA, como o registro pede. */
    dtVcto: string;
    codRec: string;
}

export interface ConfigAjustesDoc {
    ajustes: AjusteApuracao[];
    /** Código da tabela 5.3 do estado — sem ele o C197 do DIFAL não é gerado. */
    difalCodigoAjusteC197: string;
    /** { 'MG': { dtVcto, codRec } } — uma GNRE por UF de destino. */
    obrigacoesStPorUf: Record<string, ObrigacaoStUf>;
}

const docId = (empresaId: string, competencia: string) => `${empresaId}_${competencia}`;

export async function carregarAjustes(empresaId: string, competencia: string): Promise<AjusteApuracao[]> {
    return (await carregarConfigAjustes(empresaId, competencia)).ajustes;
}

/** O documento INTEIRO — ajustes + as duas configurações que moram nele. */
export async function carregarConfigAjustes(
    empresaId: string, competencia: string,
): Promise<ConfigAjustesDoc> {
    const vazio: ConfigAjustesDoc = { ajustes: [], difalCodigoAjusteC197: '', obrigacoesStPorUf: {} };
    if (!isFirebaseConfigured || !db) return vazio;
    const snap = await getDoc(doc(db, 'sped_ajustes_apuracao', docId(empresaId, competencia)));
    if (!snap.exists()) return vazio;
    const d = snap.data() as any;
    return {
        ajustes: d.ajustes || [],
        difalCodigoAjusteC197: d.difalCodigoAjusteC197 || '',
        obrigacoesStPorUf: d.obrigacoesStPorUf || {},
    };
}

export async function salvarAjustes(
    p: AjustesDoc & Partial<Pick<ConfigAjustesDoc, 'difalCodigoAjusteC197' | 'obrigacoesStPorUf'>>,
): Promise<void> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase não configurado.');
    // 🚨 MERGE: este documento tem TRÊS donos (ajustes do E111, o código do
    // C197 do DIFAL e as obrigações de ST por UF). Um `setDoc` sem merge
    // APAGARIA o que a outra parte gravou — e apagaria calado, que é o pior
    // jeito de perder um código de tabela estadual que alguém digitou.
    await setDoc(doc(db, 'sped_ajustes_apuracao', docId(p.empresaId, p.competencia)), {
        empresaId: p.empresaId,
        empresaCnpj: String(p.empresaCnpj || '').replace(/\D/g, ''),
        competencia: p.competencia,
        ajustes: p.ajustes.map(a => ({
            codigo: String(a.codigo || '').trim().toUpperCase(),
            descricao: String(a.descricao || '').trim(),
            valor: Math.round((Number(a.valor) || 0) * 100) / 100,
        })),
        ...(p.difalCodigoAjusteC197 !== undefined
            ? { difalCodigoAjusteC197: String(p.difalCodigoAjusteC197 || '').trim().toUpperCase() }
            : {}),
        ...(p.obrigacoesStPorUf !== undefined ? { obrigacoesStPorUf: p.obrigacoesStPorUf } : {}),
        atualizadoPor: auth?.currentUser?.email || auth?.currentUser?.uid || null,
        atualizadoEm: serverTimestamp(),
    }, { merge: true });
}
