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
import { getEmpresasParaPerfilCliente } from './xmlFiscalService';
import { obrigacoesDoCliente } from '../sefaz-backend/catalogo-obrigacoes.js';
import { carregarCalendariosMunicipais } from './prazosMunicipaisService';
import type { User } from '../types';

export interface AutoGerarStats {
    empresasProcessadas: number;
    obrigacoesAvaliadas: number;
    criadas: number;
    jaExistiam: number;
    erros: number;
    /** Regime que o catálogo não conhece — nomeado, nunca silencioso. */
    regimesNaoReconhecidos: string[];
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
        // Regime que o catálogo não conhece NÃO some: vem nomeado, senão "0
        // criadas" passa por "nada a fazer".
        regimesNaoReconhecidos: [],
    };

    if (!user || !competencia.match(/^\d{2}\/\d{4}$/)) return stats;

    const empresas = await getEmpresasParaPerfilCliente(user);
    // Calendários municipais: sem eles o ISS não vira tarefa por ESTE caminho
    // — o mesmo defeito que o cron tinha. Falha aqui não derruba a geração: o
    // ISS volta a ser pendência nomeada na Rotina, que é o estado de antes.
    const prazosMunicipais = await carregarCalendariosMunicipais();

    // Limita concorrencia pra nao saturar Firestore -- ~6 em paralelo.
    const CONCURRENCY = 6;
    const tarefas: Array<() => Promise<void>> = [];

    for (const emp of empresas) {
        stats.empresasProcessadas++;
        // 🚨 DOIS VOCABULÁRIOS DE REGIME: aqui vem `LUCRO_REAL_INDUSTRIA` e o
        // catálogo tem `LUCRO_REAL`. `obrigacoesAplicaveis` devolvia lista
        // VAZIA em silêncio — este caminho criava ZERO obrigação para todo
        // cliente do Lucro Real, e a estatística mostrava "0 criadas" como se
        // não houvesse o que criar. `obrigacoesDoCliente` normaliza e ainda
        // resolve o calendário municipal.
        const mes = obrigacoesDoCliente(emp.regimeSugerido, competencia, {
            uf: emp.uf || '', codMunIBGE: emp.codMunIBGE || '', prazosMunicipais,
        });
        if (!mes.regimeReconhecido) stats.regimesNaoReconhecidos.push(emp.nome);
        const obrigacoes = mes.obrigacoes;
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
