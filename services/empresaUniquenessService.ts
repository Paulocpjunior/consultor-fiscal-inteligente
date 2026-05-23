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
import { collection, getDocs } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebaseConfig';

export interface ResultadoCnpjCheck {
    duplicado: boolean;
    regime?: 'SIMPLES' | 'LUCRO';
    razaoSocial?: string;
    empresaId?: string;
}

const soDigitos = (s: string): string => (s || '').replace(/\D+/g, '');

/**
 * Consulta simples_empresas e lucro_empresas atras de qualquer doc com
 * o mesmo CNPJ (normalizado). Retorna o primeiro match.
 */
export async function verificarCnpjDuplicado(cnpj: string): Promise<ResultadoCnpjCheck> {
    const cnpjDig = soDigitos(cnpj);
    if (!cnpjDig) return { duplicado: false };
    if (!isFirebaseConfigured || !db) return { duplicado: false };

    // 1. simples_empresas
    try {
        const snap = await getDocs(collection(db, 'simples_empresas'));
        for (const d of snap.docs) {
            const data = d.data() as { cnpj?: string; nome?: string; _merged_into?: string };
            if (data._merged_into) continue; // 23/05: ignora perdedores do merge
            if (soDigitos(data.cnpj || '') === cnpjDig) {
                return {
                    duplicado: true,
                    regime: 'SIMPLES',
                    razaoSocial: data.nome || '(sem nome)',
                    empresaId: d.id,
                };
            }
        }
    } catch (e) {
        console.error('[empresaUniqueness] simples_empresas:', e);
    }

    // 2. lucro_empresas
    try {
        const snap = await getDocs(collection(db, 'lucro_empresas'));
        for (const d of snap.docs) {
            const data = d.data() as { cnpj?: string; nome?: string; _merged_into?: string };
            if (data._merged_into) continue; // 23/05: ignora perdedores do merge
            if (soDigitos(data.cnpj || '') === cnpjDig) {
                return {
                    duplicado: true,
                    regime: 'LUCRO',
                    razaoSocial: data.nome || '(sem nome)',
                    empresaId: d.id,
                };
            }
        }
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
