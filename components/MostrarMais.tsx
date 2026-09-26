/**
 * components/MostrarMais.tsx
 *
 * Rodapé da lista paginada localmente (`usePaginaLocal`): a contagem honesta
 * ("mostrando X de N") e o botão "Mostrar mais (N restantes)". Quando a lista
 * já está inteira na tela não desenha nada — a tela já diz o total dela.
 * Visual igual ao da lista de NFS-e SP capturadas.
 */
import React from 'react';
import type { PaginaLocal } from './hooks/usePaginaLocal';

interface Props {
    pagina: Pick<PaginaLocal<unknown>, 'restantes' | 'mostrarMais' | 'textoContagem'>;
    className?: string;
}

const MostrarMais: React.FC<Props> = ({ pagina, className }) => {
    if (pagina.restantes <= 0) return null;
    return (
        <div className={`p-3 text-center border-t border-slate-200 dark:border-slate-700 ${className || ''}`}>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{pagina.textoContagem}</div>
            <button
                type="button"
                onClick={pagina.mostrarMais}
                className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 rounded"
            >
                Mostrar mais ({pagina.restantes} restantes)
            </button>
        </div>
    );
};

export default MostrarMais;
