/**
 * spedAjustesService.ts — CRUD dos ajustes da apuração do ICMS (Registro
 * E111). Coleção `sped_ajustes_apuracao`, doc {empresaId}_{competencia}.
 * O gerador do SPED (backend) lê daqui; a validação do código é a MESMA
 * régua do gerador (sped-ajustes-apuracao.js) — nada de regra paralela.
 */
import { doc, getDoc, setDoc, serverTimestamp, deleteField } from 'firebase/firestore';
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
    /**
     * Só no DIFAL EC 87/15 (E316): o FCP tem código de receita PRÓPRIO e sai em
     * registro separado. Ausente = o E316 do FCP não sai, e a falta é dita.
     */
    codRecFcp?: string;
}

/**
 * 🧭 DIFAL de aquisição DENTRO da apuração (RICMS/SP art. 117) — os dois
 * códigos da tabela 5.1.1 (débito pela alíquota interna · crédito do imposto
 * da origem) e o que a pessoa INFORMOU por nota por cima da proposta do app.
 * Quem lê e consolida é `sefaz-backend/difal-art117-apuracao.js`.
 */
export interface DifalArt117Informado {
    base?: number | null;
    aliqInterna?: number | null;
    icmsDestacado?: number | null;
    naoDevido?: boolean;
    motivo?: string | null;
    por?: string | null;
    em?: string | null;
}

export interface DifalArt117Cfg {
    codigoDebito: string;
    codigoCredito: string;
    porChave: Record<string, DifalArt117Informado>;
}

export interface ConfigAjustesDoc {
    ajustes: AjusteApuracao[];
    /** Código da tabela 5.3 do estado — sem ele o C197 do DIFAL não é gerado. */
    difalCodigoAjusteC197: string;
    /** { 'MG': { dtVcto, codRec } } — uma GNRE por UF de destino. */
    obrigacoesStPorUf: Record<string, ObrigacaoStUf>;
    /**
     * { 'BA': { dtVcto, codRec } } — o E316 do DIFAL/FCP da EC 87/15, uma
     * obrigação por UF de DESTINO. Mesma régua do E250: o código de receita é
     * ESTADUAL e o app não o deduz; sem ele o registro não sai e a falta vai
     * NOMEADA na geração.
     */
    obrigacoesDifalEc87PorUf: Record<string, ObrigacaoStUf>;
    difalArt117: DifalArt117Cfg;
}

const docId = (empresaId: string, competencia: string) => `${empresaId}_${competencia}`;

export async function carregarAjustes(empresaId: string, competencia: string): Promise<AjusteApuracao[]> {
    return (await carregarConfigAjustes(empresaId, competencia)).ajustes;
}

/** O documento INTEIRO — ajustes + as duas configurações que moram nele. */
export async function carregarConfigAjustes(
    empresaId: string, competencia: string,
): Promise<ConfigAjustesDoc> {
    const vazio: ConfigAjustesDoc = {
        ajustes: [], difalCodigoAjusteC197: '', obrigacoesStPorUf: {},
        obrigacoesDifalEc87PorUf: {},
        difalArt117: { codigoDebito: '', codigoCredito: '', porChave: {} },
    };
    if (!isFirebaseConfigured || !db) return vazio;
    const snap = await getDoc(doc(db, 'sped_ajustes_apuracao', docId(empresaId, competencia)));
    if (!snap.exists()) return vazio;
    const d = snap.data() as any;
    return {
        ajustes: d.ajustes || [],
        difalCodigoAjusteC197: d.difalCodigoAjusteC197 || '',
        obrigacoesStPorUf: d.obrigacoesStPorUf || {},
        obrigacoesDifalEc87PorUf: d.obrigacoesDifalEc87PorUf || {},
        difalArt117: {
            codigoDebito: d.difalArt117?.codigoDebito || '',
            codigoCredito: d.difalArt117?.codigoCredito || '',
            porChave: d.difalArt117?.porChave || {},
        },
    };
}

const quemInforma = () => auth?.currentUser?.email || auth?.currentUser?.uid || null;

/**
 * Os DOIS códigos do art. 117 — gravados por CAMINHO (`difalArt117.codigo*`),
 * nunca o bloco inteiro: o informado por nota que outra pessoa gravou entre a
 * leitura e o clique continua lá (o ✕ de 14/08).
 */
export async function salvarDifalArt117Codigos(
    p: { empresaId: string; empresaCnpj: string; competencia: string; codigoDebito: string; codigoCredito: string },
): Promise<void> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase não configurado.');
    await setDoc(doc(db, 'sped_ajustes_apuracao', docId(p.empresaId, p.competencia)), {
        empresaId: p.empresaId,
        empresaCnpj: String(p.empresaCnpj || '').replace(/\D/g, ''),
        competencia: p.competencia,
        difalArt117: {
            codigoDebito: String(p.codigoDebito || '').trim().toUpperCase(),
            codigoCredito: String(p.codigoCredito || '').trim().toUpperCase(),
        },
        atualizadoPor: quemInforma(),
        atualizadoEm: serverTimestamp(),
    }, { merge: true });
}

/**
 * O "campo dentro da nota": o que a pessoa informou por cima da proposta
 * (base, alíquota interna, ICMS da origem, ou "não devido"), carimbado com
 * quem e quando. `null` DESFAZ — volta à proposta do app (deleteField, nunca
 * objeto vazio: meio objeto seria lido como "informado").
 */
export async function salvarDifalArt117Nota(
    p: { empresaId: string; empresaCnpj: string; competencia: string; chave: string; informado: DifalArt117Informado | null },
): Promise<void> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase não configurado.');
    const chave = String(p.chave || '').trim();
    if (!chave) throw new Error('Nota sem chave — não há como guardar o informado.');
    const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
    const valor = p.informado
        ? {
            base: num(p.informado.base),
            aliqInterna: num(p.informado.aliqInterna),
            icmsDestacado: num(p.informado.icmsDestacado),
            naoDevido: p.informado.naoDevido === true,
            motivo: String(p.informado.motivo || '').trim() || null,
            por: quemInforma(),
            em: new Date().toISOString(),
        }
        : deleteField();
    await setDoc(doc(db, 'sped_ajustes_apuracao', docId(p.empresaId, p.competencia)), {
        empresaId: p.empresaId,
        empresaCnpj: String(p.empresaCnpj || '').replace(/\D/g, ''),
        competencia: p.competencia,
        difalArt117: { porChave: { [chave]: valor } },
        atualizadoPor: quemInforma(),
        atualizadoEm: serverTimestamp(),
    }, { merge: true });
}

export async function salvarAjustes(
    p: AjustesDoc & Partial<Pick<ConfigAjustesDoc,
        'difalCodigoAjusteC197' | 'obrigacoesStPorUf' | 'obrigacoesDifalEc87PorUf'>>,
): Promise<void> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase não configurado.');
    // 🚨 MERGE: este documento tem QUATRO donos (ajustes do E111, o código do
    // C197 do DIFAL de aquisição, as obrigações de ST por UF e as do DIFAL da
    // EC 87/15 por UF de destino). Um `setDoc` sem merge APAGARIA o que a outra
    // parte gravou — e apagaria calado, que é o pior jeito de perder um código
    // de tabela estadual que alguém digitou.
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
        ...(p.obrigacoesDifalEc87PorUf !== undefined
            ? { obrigacoesDifalEc87PorUf: p.obrigacoesDifalEc87PorUf }
            : {}),
        atualizadoPor: auth?.currentUser?.email || auth?.currentUser?.uid || null,
        atualizadoEm: serverTimestamp(),
    }, { merge: true });
}
