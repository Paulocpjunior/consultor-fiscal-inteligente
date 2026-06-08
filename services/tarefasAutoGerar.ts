/**
 * services/tarefasAutoGerar.ts
 *
 * Auto-geracao de tarefas baseadas no regime de cada empresa
 * (calendarioFiscal.OBRIGACOES_POR_REGIME) pra uma competencia alvo.
 *
 * Disparado pela tela Tarefas (Kanban) sempre que o filtro de competencia
 * muda. Idempotente: `criarTarefaAutomatica` ja checa duplicata (empresaId
 * + obrigacao + competencia). Roda em paralelo limitado pra nao saturar.
 *
 * Retorna stats pro callsite poder dar feedback no toast: quantas tarefas
 * foram criadas vs ja existiam.
 */
import { criarTarefaAutomatica } from './tarefasService';
import { obrigacoesAplicaveis } from './calendarioFiscal';
import { getEmpresasParaPerfilCliente } from './xmlFiscalService';
import type { User } from '../types';

export interface AutoGerarStats {
    empresasProcessadas: number;
    obrigacoesAvaliadas: number;
    criadas: number;
    jaExistiam: number;
    erros: number;
}

/**
 * Gera tarefas pra TODAS empresas + obrigacoes aplicaveis na competencia.
 *
 * @param user usuario logado (pra puxar lista de empresas que pode ver)
 * @param competencia formato MM/AAAA (ex: "04/2026")
 */
export async function autoGerarTarefasParaCompetencia(
    user: User | null,
    competencia: string,
): Promise<AutoGerarStats> {
    const stats: AutoGerarStats = {
        empresasProcessadas: 0,
        obrigacoesAvaliadas: 0,
        criadas: 0,
        jaExistiam: 0,
        erros: 0,
    };

    if (!user || !competencia.match(/^\d{2}\/\d{4}$/)) return stats;

    const empresas = await getEmpresasParaPerfilCliente(user);

    // Limita concorrencia pra nao saturar Firestore -- ~6 em paralelo.
    const CONCURRENCY = 6;
    const tarefas: Array<() => Promise<void>> = [];

    for (const emp of empresas) {
        stats.empresasProcessadas++;
        const obrigacoes = obrigacoesAplicaveis(emp.regimeSugerido, competencia);
        for (const regra of obrigacoes) {
            stats.obrigacoesAvaliadas++;
            tarefas.push(async () => {
                const r = await criarTarefaAutomatica({
                    empresaId: emp.id,
                    empresaCnpj: emp.cnpj,
                    empresaNome: emp.nome,
                    regra,
                    competencia,
                });
                if (!r.ok) stats.erros++;
                else if (r.jaExistia) stats.jaExistiam++;
                else stats.criadas++;
            });
        }
    }

    // Executor com pool de concorrencia.
    let cursor = 0;
    async function worker() {
        while (cursor < tarefas.length) {
            const i = cursor++;
            const fn = tarefas[i];
            if (fn) await fn();
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    return stats;
}
