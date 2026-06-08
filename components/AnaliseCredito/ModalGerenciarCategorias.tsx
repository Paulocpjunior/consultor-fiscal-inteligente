/**
 * components/AnaliseCredito/ModalGerenciarCategorias.tsx
 *
 * Modal pra gerenciar categorias customizadas (CRUD). As 11 categorias
 * padrao sao imutaveis. Extraido de AnaliseCreditoExtrato.tsx - issue #100.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  listarCustom,
  criarCategoria,
  renomearCategoria,
  removerCategoria,
  contarFornecedoresNaCategoria,
  type CategoriaCustom,
} from '../../services/categoriasCreditoService';

export interface ModalGerenciarCategoriasProps {
  onFechar: () => void;
  onMudou: () => void;
}

const ModalGerenciarCategorias: React.FC<ModalGerenciarCategoriasProps> = ({ onFechar, onMudou }) => {
  const [custom, setCustom] = useState<CategoriaCustom[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [nova, setNova] = useState('');
  const [criando, setCriando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState('');
  const [usados, setUsados] = useState<Record<string, number>>({});  // id -> contagem
  const [erro, setErroLocal] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const list = await listarCustom();
    setCustom(list);
    // calcula uso pra cada custom (em paralelo)
    const counts: Record<string, number> = {};
    await Promise.all(list.map(async cat => {
      counts[cat.id] = await contarFornecedoresNaCategoria(cat.nome);
    }));
    setUsados(counts);
    setCarregando(false);
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);

  const adicionar = async () => {
    setErroLocal(null);
    if (!nova.trim()) return;
    setCriando(true);
    const r = await criarCategoria(nova);
    setCriando(false);
    if (r.ok) {
      setNova('');
      if (r.jaExistia) setErroLocal(`Categoria "${r.nome}" ja existia — reutilizada.`);
      await recarregar();
      onMudou();
    } else {
      setErroLocal(r.error || 'Erro ao criar');
    }
  };

  const salvarEdicao = async (id: string) => {
    setErroLocal(null);
    if (!editandoNome.trim()) { setEditandoId(null); return; }
    const r = await renomearCategoria(id, editandoNome);
    if (r.ok) {
      setEditandoId(null);
      await recarregar();
      onMudou();
    } else {
      setErroLocal(r.error || 'Erro ao renomear');
    }
  };

  const apagar = async (cat: CategoriaCustom) => {
    setErroLocal(null);
    if (!confirm(`Apagar categoria "${cat.nome}"?`)) return;
    const r = await removerCategoria(cat.id, cat.nome);
    if (r.ok) {
      await recarregar();
      onMudou();
    } else if (r.bloqueado) {
      setErroLocal(`${r.usados} fornecedor(es) ainda usam essa categoria. Reclassifique antes de apagar.`);
    } else {
      setErroLocal(r.error || 'Erro ao apagar');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Gerenciar categorias</h3>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            As 11 categorias padrao (MEDICINA, TI, etc.) sao imutaveis. Voce pode adicionar, renomear e apagar suas proprias categorias.
          </p>

          {/* Adicionar nova */}
          <div className="flex gap-2">
            <input
              value={nova}
              onChange={e => setNova(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') adicionar(); }}
              placeholder="Ex: MARKETING, TREINAMENTO..."
              className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700"
            />
            <button
              onClick={adicionar}
              disabled={criando || !nova.trim()}
              className="px-3 py-1.5 text-sm rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
            >
              {criando ? 'Adicionando...' : '+ Adicionar'}
            </button>
          </div>

          {erro && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded p-2 text-xs text-amber-800 dark:text-amber-200">
              {erro}
            </div>
          )}

          {/* Lista das custom */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">
              Categorias customizadas {custom.length > 0 && `(${custom.length})`}
            </div>
            {carregando ? (
              <p className="p-3 text-xs text-gray-400">Carregando...</p>
            ) : custom.length === 0 ? (
              <p className="p-3 text-xs text-gray-400">Nenhuma categoria customizada ainda. Adicione uma acima.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {custom.map(cat => (
                  <li key={cat.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                    {editandoId === cat.id ? (
                      <>
                        <input
                          value={editandoNome}
                          onChange={e => setEditandoNome(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') salvarEdicao(cat.id); }}
                          className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700"
                          autoFocus
                        />
                        <button onClick={() => salvarEdicao(cat.id)} className="text-teal-600 hover:text-teal-800 text-xs font-semibold">salvar</button>
                        <button onClick={() => setEditandoId(null)} className="text-gray-400 hover:text-gray-600 text-xs">cancelar</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-gray-800 dark:text-gray-200 font-medium">{cat.nome}</span>
                        <span className="text-[11px] text-gray-400">
                          {usados[cat.id] > 0 ? `${usados[cat.id]} usado(s)` : 'nao usado'}
                        </span>
                        <button
                          onClick={() => { setEditandoId(cat.id); setEditandoNome(cat.nome); }}
                          className="text-blue-600 hover:text-blue-800 text-xs"
                          title="Renomear"
                        >✏️</button>
                        <button
                          onClick={() => apagar(cat)}
                          disabled={usados[cat.id] > 0}
                          className="text-red-600 hover:text-red-800 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                          title={usados[cat.id] > 0 ? `${usados[cat.id]} fornecedor(es) usam esta categoria` : 'Apagar'}
                        >🗑️</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button onClick={onFechar} className="px-3 py-1.5 text-sm rounded bg-gray-600 hover:bg-gray-700 text-white font-semibold">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModalGerenciarCategorias;
