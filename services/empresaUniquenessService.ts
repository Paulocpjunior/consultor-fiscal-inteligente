/**
 * empresaUniquenessService — trava de unicidade de CNPJ na criacao de empresas.
 *
 * Regra (definida com Paulo, 21/05/2026):
 *   - Mesmo CNPJ NUNCA pode existir em simples_empresas E lucro_empresas
 *     ao mesmo tempo (unicidade global entre regimes).
 *   - Trava aplica SO em cadastro novo. Empresas existentes (~213 ate hoje)
 *     nao sao migradas — duplicatas pre-existentes ficam ate auditoria.
 *   - Quando colaborador tentar criar CNPJ duplicado, throw com mensagem
 *     clara informando regime e razao social do cadastro existente.
 *
 * Estrategia:
 *   - CNPJs antigos foram salvos formatados (12.345.678/0001-90), novos
 *     podem ser salvos em qualquer formato. Comparacao SEMPRE normaliza
 *     so digitos antes de bater.
 *   - getDocs nas duas collections (sem where), filtro client-side pelo
 *     CNPJ normalizado. Para SP Assessoria (~213 empresas) e instantaneo.
 *     Quando crescer p/ milhares, vale considerar campo dedicado cnpjDig.
 *
 * NAO eh atomico (race condition teorica entre dois cadastros simultaneos
 * do mesmo CNPJ). YAGNI — chance praticamente zero no fluxo de cadastro
 * manual da contabilidade.
 */
import { collection, getDocs, query, limit as fbLimit, orderBy, startAfter, documentId, type Query, type QuerySnapshot, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebaseConfig';

export interface ResultadoCnpjCheck {
    duplicado: boolean;
    regime?: 'SIMPLES' | 'LUCRO';
    razaoSocial?: string;
    empresaId?: string;
}

const soDigitos = (s: string): string => (s || '').replace(/\D+/g, '');

// Varre UMA coleção INTEIRA (paginada por id, 500/página) atrás do CNPJ.
// O fbLimit(500) único de antes era um ponto cego: empresa além da 500ª
// ficava INVISÍVEL pra trava — com a base em ~388 no Lucro + Simples, o
// estouro era questão de meses (caso WALDESA 24/07 escancarou o risco).
async function buscarCnpjNaColecao(
    colName: 'simples_empresas' | 'lucro_empresas',
    cnpjDig: string,
    regime: 'SIMPLES' | 'LUCRO',
    ignorarEmpresaId?: string,
): Promise<ResultadoCnpjCheck | null> {
    let cursor: QueryDocumentSnapshot | null = null;
    for (;;) {
        const base = collection(db!, colName);
        const consulta: Query = cursor
            ? query(base, orderBy(documentId()), startAfter(cursor), fbLimit(500))
            : query(base, orderBy(documentId()), fbLimit(500));
        const snap: QuerySnapshot = await getDocs(consulta);
        if (snap.empty) return null;
        for (const d of snap.docs) {
            if (ignorarEmpresaId && d.id === ignorarEmpresaId) continue; // a própria (update)
            const data = d.data() as { cnpj?: string; nome?: string; _merged_into?: string; _deleted?: boolean };
            if (data._merged_into) continue; // 23/05: ignora perdedores do merge
            // 24/07: lápide de soft-delete não conta como duplicata — senão
            // excluir uma empresa bloquearia recadastrá-la pra sempre.
            if (data._deleted) continue;
            if (soDigitos(data.cnpj || '') === cnpjDig) {
                return {
                    duplicado: true,
                    regime,
                    razaoSocial: data.nome || '(sem nome)',
                    empresaId: d.id,
                };
            }
        }
        if (snap.docs.length < 500) return null;
        cursor = snap.docs[snap.docs.length - 1];
    }
}

/**
 * Consulta simples_empresas e lucro_empresas (COMPLETAS, paginadas) atrás de
 * qualquer doc com o mesmo CNPJ normalizado. `ignorarEmpresaId` permite usar
 * a trava também em UPDATE (edição de CNPJ) sem acusar a própria empresa.
 */
export async function verificarCnpjDuplicado(cnpj: string, ignorarEmpresaId?: string): Promise<ResultadoCnpjCheck> {
    const cnpjDig = soDigitos(cnpj);
    if (!cnpjDig) return { duplicado: false };
    if (!isFirebaseConfigured || !db) return { duplicado: false };

    try {
        const m = await buscarCnpjNaColecao('simples_empresas', cnpjDig, 'SIMPLES', ignorarEmpresaId);
        if (m) return m;
    } catch (e) {
        console.error('[empresaUniqueness] simples_empresas:', e);
    }
    try {
        const m = await buscarCnpjNaColecao('lucro_empresas', cnpjDig, 'LUCRO', ignorarEmpresaId);
        if (m) return m;
    } catch (e) {
        console.error('[empresaUniqueness] lucro_empresas:', e);
    }
    return { duplicado: false };
}

/**
 * Helper: monta a mensagem de erro padrao quando CNPJ ja existe.
 */
export function mensagemCnpjDuplicado(
    cnpj: string,
    check: ResultadoCnpjCheck,
): string {
    const regimeNome = check.regime === 'SIMPLES'
        ? 'Simples Nacional'
        : check.regime === 'LUCRO'
            ? 'Lucro Presumido/Real'
            : 'outro regime';
    const razao = check.razaoSocial ? ` como "${check.razaoSocial}"` : '';
    return `CNPJ ${cnpj} já cadastrado em ${regimeNome}${razao}. Use o cadastro existente.`;
}
