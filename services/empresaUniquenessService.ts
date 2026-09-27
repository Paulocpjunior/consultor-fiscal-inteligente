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
 * A busca global roda no backend e retorna somente a existencia/regime,
 * sem expor cadastros fora da carteira do colaborador. Falhas nao liberam
 * o cadastro como se o CNPJ estivesse disponivel.
 */
import { db, isFirebaseConfigured } from './firebaseConfig';
import { carteiraApi } from './carteiraAcessos';

export interface ResultadoCnpjCheck {
    duplicado: boolean;
    regime?: 'SIMPLES' | 'LUCRO';
    razaoSocial?: string;
    empresaId?: string;
}

const soDigitos = (s: string): string => (s || '').replace(/\D+/g, '');

/**
 * Consulta simples_empresas e lucro_empresas (COMPLETAS, paginadas) atrás de
 * qualquer doc com o mesmo CNPJ normalizado. `ignorarEmpresaId` permite usar
 * a trava também em UPDATE (edição de CNPJ) sem acusar a própria empresa.
 */
export async function verificarCnpjDuplicado(cnpj: string, ignorarEmpresaId?: string): Promise<ResultadoCnpjCheck> {
    const cnpjDig = soDigitos(cnpj);
    if (!cnpjDig) return { duplicado: false };
    if (!isFirebaseConfigured || !db) return { duplicado: false };

    return carteiraApi('/verificar-cnpj', 'POST', { cnpj: cnpjDig, ignorarEmpresaId });
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
