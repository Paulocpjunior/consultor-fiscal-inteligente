import React from 'react';
import { SearchType } from '../types';

const InitialStateDisplay: React.FC<{ searchType: SearchType, mode: 'single' | 'compare' }> = ({ searchType, mode }) => (
    <div className="text-center p-8 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Pronto para começar?</h3>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
            {searchType === SearchType.REFORMA_TRIBUTARIA
                ? mode === 'single'
                    ? 'Selecione uma atividade ou digite um CNAE para obter uma análise de impacto "Antes vs. Depois" da Reforma Tributária.'
                    : 'Digite dois CNAEs nos campos acima para comparar o impacto da Reforma Tributária entre eles.'
                : mode === 'single'
                ? `Digite um código ou descrição de ${searchType} no campo de busca acima para obter uma análise detalhada.`
                : `Digite dois códigos ${searchType === SearchType.SERVICO ? 'de serviço' : searchType} nos campos acima para comparar.`
            }
        </p>
    </div>
);

export default InitialStateDisplay;
