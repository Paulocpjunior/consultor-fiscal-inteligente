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
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
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

    // 🚨 `onErro` chega como arrow criada no render do chamador (identidade nova
    // a cada render). Pô-la nas deps dos efeitos (03/09, 1ª versão desta
    // correção) fez o efeito rodar de novo a cada render — laço infinito de
    // leitura, pego pelo teste que travou 30 s. A ref guarda a versão mais
    // recente SEM reexecutar nada.
    const onErroRef = useRef(onErro);
    onErroRef.current = onErro;

    // Carrega lista global de custom (independe de empresa)
    useEffect(() => {
        let ativo = true;
        listarCustom().then(list => {
            if (ativo) setCategoriasCustom(list);
        }).catch((e: any) => {
            // Promessa sem catch é lista vazia calada — a pessoa concluiria que
            // não há categoria customizada, quando a leitura é que caiu.
            if (ativo) onErroRef.current('Não deu para carregar as categorias customizadas: ' + (e?.message || 'desconhecido'));
        });
        return () => { ativo = false; };
    }, [categoriasVersao]);

    // Carrega config de credito da empresa selecionada
    useEffect(() => {
        let ativo = true;
        if (!empresaId) { setCategoriasNaoCreditaveis(new Set()); return; }
        carregarCreditConfig(empresaId).then(cfg => {
            if (ativo) setCategoriasNaoCreditaveis(new Set(cfg.categoriasNaoCreditaveis));
        }).catch((e: any) => {
            if (ativo) onErroRef.current('Não deu para carregar a config de crédito desta empresa: ' + (e?.message || 'desconhecido'));
        });
        return () => { ativo = false; };
    }, [empresaId]);

    const toggleCategoriaCredito = useCallback(async (categoria: string) => {
        if (!empresaId) return;
        if (categoria === 'SEM_CATEGORIA') return; // sempre nao-creditavel
        // 🚨 O ROLLBACK É FUNCIONAL, nunca o closure. Dois toggles em voo (A e
        // B): o rollback de A gravava `categoriasNaoCreditaveis` de ANTES de
        // B — e apagava B da tela, que tinha sido salvo com sucesso. Cada
        // toggle inverte só a SUA categoria sobre o estado mais recente.
        const inverter = (prev: Set<string>) => {
            const s = new Set(prev);
            if (s.has(categoria)) s.delete(categoria); else s.add(categoria);
            return s;
        };
        const novo = inverter(categoriasNaoCreditaveis);
        setCategoriasNaoCreditaveis(inverter);  // otimista
        setSalvandoCategoriaCredito(categoria);
        let r: { ok: boolean; error?: string };
        try {
            r = await salvarCreditConfig(empresaId, Array.from(novo));
        } catch (e: any) {
            // Rede que cai também é falha: sem isto o toggle otimista ficava
            // de pé com o spinner preso.
            r = { ok: false, error: e?.message || 'desconhecido' };
        } finally {
            setSalvandoCategoriaCredito(null);
        }
        if (!r.ok) {
            // rollback em caso de falha — desfaz SÓ esta categoria
            setCategoriasNaoCreditaveis(inverter);
            onErroRef.current('Erro ao salvar config de crédito: ' + (r.error || 'desconhecido'));
        }
    }, [empresaId, categoriasNaoCreditaveis]);

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
