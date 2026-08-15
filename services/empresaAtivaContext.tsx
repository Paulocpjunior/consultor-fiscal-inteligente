/**
 * services/empresaAtivaContext.tsx — a empresa ativa CHEGA em qualquer módulo.
 *
 * Paulo, 15/08: *"ativar empresa é o que determina o que a pessoa vai ou não
 * fazer"*. O portão (PR #688) garantiu que existe uma empresa ativa; este
 * contexto é o que faz os MÓDULOS usarem ela em vez de perguntarem de novo.
 *
 * Por que contexto e não prop: os cards são carregados por `lazy()` e estão a
 * três ou quatro níveis de distância do App. Descer a empresa por prop
 * significaria tocar em toda a cadeia a cada tela nova — e a que esquecesse
 * ficaria com seletor próprio outra vez, que é exatamente o defeito que se
 * está tirando.
 *
 * `trocar()` abre o mesmo trocador global do cabeçalho: a troca é UMA em todo
 * o app. Dois jeitos de trocar de cliente seria a mesma divergência silenciosa
 * de sempre, só que sobre em qual empresa a pessoa está mexendo.
 */
import React, { createContext, useContext, useMemo } from 'react';
import type { EmpresaAtiva } from './empresaAtiva';

interface Ctx {
    empresa: EmpresaAtiva | null;
    /** Abre o trocador global (a tela de ativação). */
    trocar: () => void;
    /**
     * Ativa DIRETO, sem passar pela tela.
     *
     * Existe por um caso real: ao arrastar XMLs de outro cliente, o modal de
     * validação oferece trocar de empresa — mandar a pessoa ao trocador global
     * ali perderia os arquivos pendentes. É a MESMA ativação (mesmo estado,
     * mesma limpeza), só chamada de dentro; um segundo caminho de troca com
     * regra própria seria a divergência de sempre, agora sobre em qual cliente
     * o trabalho cai.
     */
    ativar: (e: EmpresaAtiva) => void;
}

const EmpresaAtivaCtx = createContext<Ctx>({ empresa: null, trocar: () => {}, ativar: () => {} });

export const EmpresaAtivaProvider: React.FC<{
    empresa: EmpresaAtiva | null;
    onTrocar: () => void;
    onAtivar: (e: EmpresaAtiva) => void;
    children: React.ReactNode;
}> = ({ empresa, onTrocar, onAtivar, children }) => {
    const valor = useMemo(() => ({ empresa, trocar: onTrocar, ativar: onAtivar }), [empresa, onTrocar, onAtivar]);
    return <EmpresaAtivaCtx.Provider value={valor}>{children}</EmpresaAtivaCtx.Provider>;
};

/**
 * A empresa ativa da sessão.
 *
 * Devolve `null` só fora do Provider (teste isolado, Storybook). Dentro do app
 * ela nunca é nula: o portão do App não deixa passar sem ativação — e é por
 * isso que módulo nenhum precisa mais de um seletor para começar a trabalhar.
 */
export function useEmpresaAtiva(): Ctx {
    return useContext(EmpresaAtivaCtx);
}

/** Atalho para quem só precisa do id (o caso mais comum nos painéis). */
export function useEmpresaAtivaId(): string {
    return useContext(EmpresaAtivaCtx).empresa?.id || '';
}
