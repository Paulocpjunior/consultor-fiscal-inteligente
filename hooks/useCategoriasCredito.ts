/**
 * hooks/useCategoriasCredito.ts
 *
 * Consolida o estado das categorias de credito da AnaliseCreditoExtrato:
 * - Categorias customizadas (lista global em Firestore, alem das 11 fixas)
 * - Categorias marcadas como NAO-creditaveis por empresa (config persistida)
 * - Toggle pra ligar/desligar uma categoria (com otimistic update + rollback)
 * - Lista completa de categorias (fixas + custom, ordenadas A-Z)
 *
 * Recebe a empresaId pra carregar a config dela. Quando muda de empresa,
 * recarrega a config.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listarCustom, type CategoriaCustom } from '../services/categoriasCreditoService';
import { carregarCreditConfig, salvarCreditConfig } from '../services/creditConfigService';
import { CATEGORIAS_CREDITO } from '../services/analiseCreditoExtratoService';

interface Return {
    categoriasCustom: CategoriaCustom[];
    setCategoriasCustom: React.Dispatch<React.SetStateAction<CategoriaCustom[]>>;
    categoriasVersao: number;
    setCategoriasVersao: React.Dispatch<React.SetStateAction<number>>;
    modalCategoriasAberto: boolean;
    setModalCategoriasAberto: React.Dispatch<React.SetStateAction<boolean>>;
    categoriasNaoCreditaveis: Set<string>;
    salvandoCategoriaCredito: string | null;
    toggleCategoriaCredito: (categoria: string) => Promise<void>;
    todasCategorias: string[];
}

export function useCategoriasCredito(
    empresaId: string | undefined,
    onErro: (msg: string) => void,
): Return {
    const [categoriasCustom, setCategoriasCustom] = useState<CategoriaCustom[]>([]);
    const [categoriasVersao, setCategoriasVersao] = useState(0);
    const [modalCategoriasAberto, setModalCategoriasAberto] = useState(false);

    const [categoriasNaoCreditaveis, setCategoriasNaoCreditaveis] = useState<Set<string>>(new Set());
    const [salvandoCategoriaCredito, setSalvandoCategoriaCredito] = useState<string | null>(null);

    // Carrega lista global de custom (independe de empresa)
    useEffect(() => {
        let ativo = true;
        listarCustom().then(list => {
            if (ativo) setCategoriasCustom(list);
        });
        return () => { ativo = false; };
    }, [categoriasVersao]);

    // Carrega config de credito da empresa selecionada
    useEffect(() => {
        let ativo = true;
        if (!empresaId) { setCategoriasNaoCreditaveis(new Set()); return; }
        carregarCreditConfig(empresaId).then(cfg => {
            if (ativo) setCategoriasNaoCreditaveis(new Set(cfg.categoriasNaoCreditaveis));
        });
        return () => { ativo = false; };
    }, [empresaId]);

    const toggleCategoriaCredito = useCallback(async (categoria: string) => {
        if (!empresaId) return;
        if (categoria === 'SEM_CATEGORIA') return; // sempre nao-creditavel
        const novo = new Set(categoriasNaoCreditaveis);
        if (novo.has(categoria)) novo.delete(categoria);
        else novo.add(categoria);
        setCategoriasNaoCreditaveis(novo);  // otimista
        setSalvandoCategoriaCredito(categoria);
        const r = await salvarCreditConfig(empresaId, Array.from(novo));
        setSalvandoCategoriaCredito(null);
        if (!r.ok) {
            // rollback em caso de falha
            setCategoriasNaoCreditaveis(categoriasNaoCreditaveis);
            onErro('Erro ao salvar config de crédito: ' + (r.error || 'desconhecido'));
        }
    }, [empresaId, categoriasNaoCreditaveis, onErro]);

    const todasCategorias = useMemo(() => {
        const customNomes = categoriasCustom.map(c => c.nome);
        return [...CATEGORIAS_CREDITO, ...customNomes].sort((a, b) => a.localeCompare(b));
    }, [categoriasCustom]);

    return {
        categoriasCustom, setCategoriasCustom,
        categoriasVersao, setCategoriasVersao,
        modalCategoriasAberto, setModalCategoriasAberto,
        categoriasNaoCreditaveis,
        salvandoCategoriaCredito,
        toggleCategoriaCredito,
        todasCategorias,
    };
}
