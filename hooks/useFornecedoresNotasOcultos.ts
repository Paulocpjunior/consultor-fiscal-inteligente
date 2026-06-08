/**
 * hooks/useFornecedoresNotasOcultos.ts
 *
 * Consolida o gerenciamento de "fornecedores ocultos" + "notas ocultas"
 * usado pela tela AnaliseCreditoExtrato. Antes vivia inline (5 useState +
 * 2 useEffect + 2 useMemo) no componente -- migrar pra hook reduz inchaco
 * do componente principal e isola a logica de persistencia (Firestore).
 *
 * Conceitos:
 * - Fornecedor oculto: usuario marca CNPJ como nao-creditavel pra essa
 *   empresa. Pode ser "so desta vez" (Set local) ou "sempre" (Firestore).
 * - Nota oculta: granular -- exclui UMA NF especifica do calculo de credito
 *   (caso de NF cancelada/duplicada/reembolsada). Mesma logica local + persistido.
 *
 * Os calculos de credito usam SEMPRE a UNIAO dos dois Sets (efetivos).
 */
import { useEffect, useMemo, useState } from 'react';
import { listarOcultos } from '../services/fornecedoresOcultosService';
import { listarNotasOcultas } from '../services/notasOcultasService';

interface UseFornecedoresNotasOcultosReturn {
    // Fornecedores
    fornecedoresOcultos: Set<string>;
    setFornecedoresOcultos: React.Dispatch<React.SetStateAction<Set<string>>>;
    fornecedoresOcultosPersistidos: Set<string>;
    setFornecedoresOcultosPersistidos: React.Dispatch<React.SetStateAction<Set<string>>>;
    fornecedoresOcultosEfetivos: Set<string>;
    salvandoExclusaoPersistida: boolean;
    setSalvandoExclusaoPersistida: React.Dispatch<React.SetStateAction<boolean>>;
    confirmandoExclusao: {
        cnpj: string; razaoSocial: string; qtdNotas: number; somaValorNf: number
    } | null;
    setConfirmandoExclusao: React.Dispatch<React.SetStateAction<
        { cnpj: string; razaoSocial: string; qtdNotas: number; somaValorNf: number } | null
    >>;
    // Notas
    notasOcultas: Set<string>;
    setNotasOcultas: React.Dispatch<React.SetStateAction<Set<string>>>;
    notasOcultasPersistidas: Set<string>;
    setNotasOcultasPersistidas: React.Dispatch<React.SetStateAction<Set<string>>>;
    notasOcultasEfetivas: Set<string>;
    confirmandoExclusaoNf: {
        cnpj: string; razaoSocial: string; numero: string; serie: string; emissao: string; valorNf: number
    } | null;
    setConfirmandoExclusaoNf: React.Dispatch<React.SetStateAction<
        { cnpj: string; razaoSocial: string; numero: string; serie: string; emissao: string; valorNf: number } | null
    >>;
    salvandoExclusaoNfPersistida: boolean;
    setSalvandoExclusaoNfPersistida: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useFornecedoresNotasOcultos(empresaId: string | undefined): UseFornecedoresNotasOcultosReturn {
    // ── Fornecedores ────────────────────────────────────────────────────────
    const [fornecedoresOcultos, setFornecedoresOcultos] = useState<Set<string>>(new Set());
    const [confirmandoExclusao, setConfirmandoExclusao] = useState<
        { cnpj: string; razaoSocial: string; qtdNotas: number; somaValorNf: number } | null
    >(null);
    const [fornecedoresOcultosPersistidos, setFornecedoresOcultosPersistidos] = useState<Set<string>>(new Set());
    const [salvandoExclusaoPersistida, setSalvandoExclusaoPersistida] = useState(false);

    useEffect(() => {
        if (!empresaId) {
            setFornecedoresOcultosPersistidos(new Set());
            return;
        }
        let alive = true;
        listarOcultos(empresaId)
            .then(set => { if (alive) setFornecedoresOcultosPersistidos(set); })
            .catch(e => console.error('[AnaliseCredito] listarOcultos:', e));
        return () => { alive = false; };
    }, [empresaId]);

    const fornecedoresOcultosEfetivos = useMemo(() => {
        const s = new Set<string>(fornecedoresOcultos);
        for (const k of fornecedoresOcultosPersistidos) s.add(k);
        return s;
    }, [fornecedoresOcultos, fornecedoresOcultosPersistidos]);

    // ── Notas individuais ──────────────────────────────────────────────────
    const [notasOcultas, setNotasOcultas] = useState<Set<string>>(new Set());
    const [notasOcultasPersistidas, setNotasOcultasPersistidas] = useState<Set<string>>(new Set());
    const [confirmandoExclusaoNf, setConfirmandoExclusaoNf] = useState<
        { cnpj: string; razaoSocial: string; numero: string; serie: string; emissao: string; valorNf: number } | null
    >(null);
    const [salvandoExclusaoNfPersistida, setSalvandoExclusaoNfPersistida] = useState(false);

    useEffect(() => {
        if (!empresaId) {
            setNotasOcultasPersistidas(new Set());
            return;
        }
        let alive = true;
        listarNotasOcultas(empresaId)
            .then(s => { if (alive) setNotasOcultasPersistidas(s); })
            .catch(e => console.error('[AnaliseCredito] listarNotasOcultas:', e));
        return () => { alive = false; };
    }, [empresaId]);

    const notasOcultasEfetivas = useMemo(() => {
        const s = new Set<string>(notasOcultas);
        for (const k of notasOcultasPersistidas) s.add(k);
        return s;
    }, [notasOcultas, notasOcultasPersistidas]);

    return {
        fornecedoresOcultos, setFornecedoresOcultos,
        fornecedoresOcultosPersistidos, setFornecedoresOcultosPersistidos,
        fornecedoresOcultosEfetivos,
        salvandoExclusaoPersistida, setSalvandoExclusaoPersistida,
        confirmandoExclusao, setConfirmandoExclusao,
        notasOcultas, setNotasOcultas,
        notasOcultasPersistidas, setNotasOcultasPersistidas,
        notasOcultasEfetivas,
        confirmandoExclusaoNf, setConfirmandoExclusaoNf,
        salvandoExclusaoNfPersistida, setSalvandoExclusaoNfPersistida,
    };
}
