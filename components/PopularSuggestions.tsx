import React from 'react';
import { SearchType } from '../types';
import { TagIcon, BuildingIcon, DocumentTextIcon, CalculatorIcon, ShieldIcon } from './Icons';

interface PopularSuggestionsProps {
    searchType: SearchType;
    onSelect: (code: string) => void;
}

const popularCfops = [
  { code: '5102', description: 'Venda de mercadoria adquirida de terceiros' },
  { code: '5405', description: 'Venda (Substituição Tributária)' },
  { code: '1202', description: 'Devolução de venda de mercadoria' },
  { code: '5915', description: 'Remessa para conserto' },
  { code: '6102', description: 'Venda interestadual a não contribuinte' },
  { code: '1102', description: 'Compra para comercialização' },
];

const popularNcms = [
  { code: '8517.13.00', description: 'Smartphones' },
  { code: '8703.23.10', description: 'Automóveis de passageiros' },
  { code: '3004.90.39', description: 'Medicamentos' },
  { code: '0901.21.00', description: 'Café torrado, não descafeinado' },
  { code: '6403.99.90', description: 'Calçados' },
  { code: '1006.30.21', description: 'Arroz semibranqueado ou branqueado' },
];

const popularServicos = [
  { code: '7.02', description: 'Execução de obras de construção civil' },
  { code: '1.07', description: 'Suporte técnico em informática' },
  { code: '17.05', description: 'Fornecimento de mão de obra' },
  { code: '14.01', description: 'Manutenção e reparação de bens' },
  { code: '10.05', description: 'Agenciamento e corretagem' },
  { code: '3.05', description: 'Cessão de andaimes e estruturas' },
];

const popularCnaes = [
    { code: '6201-5/01', description: 'Desenvolvimento de programas de computador' },
    { code: '4711-3/02', description: 'Comércio varejista de mercadorias' },
    { code: '4120-4/00', description: 'Construção de edifícios' },
    { code: '6920-6/01', description: 'Atividades de contabilidade' },
    { code: '5611-2/01', description: 'Restaurantes e similares' },
    { code: '4930-2/02', description: 'Transporte rodoviário de carga' },
];

const popularSimples = [
    { code: 'O que é Fator R?', description: 'Entenda o cálculo de 28%' },
    { code: 'Limites de Faturamento', description: 'R$ 4.8M e Sublimites' },
    { code: 'Tabelas dos Anexos', description: 'I, II, III, IV e V' },
    { code: 'Atividades Vedadas', description: 'O que não pode optar' },
    { code: 'Cálculo do DAS', description: 'Como é feito o apuro' },
    { code: 'Simples vs Presumido', description: 'Comparativo básico' },
];

const popularLucro = [
    { code: 'Presunção IRPJ/CSLL', description: 'Base de cálculo Comércio/Serviço' },
    { code: 'PIS/COFINS Cumulativo', description: 'Regras do Lucro Presumido' },
    { code: 'PIS/COFINS Não Cumulativo', description: 'Regras do Lucro Real' },
    { code: 'Adicional de IRPJ', description: '10% sobre excedente de 20k' },
    { code: 'Obrigações Acessórias', description: 'ECD, ECF, DCTF' },
    { code: 'Lucro Real Trimestral', description: 'Vantagens e desvantagens' },
];

export const PopularSuggestions: React.FC<PopularSuggestionsProps> = ({ searchType, onSelect }) => {
    let items = [];
    let icon = <TagIcon className="w-4 h-4" />;
    let label = "Códigos";

    switch (searchType) {
        case SearchType.NCM:
            items = popularNcms;
            icon = <DocumentTextIcon className="w-4 h-4" />;
            label = "NCMs Frequentes";
            break;
        case SearchType.SERVICO:
            items = popularServicos;
            icon = <BuildingIcon className="w-4 h-4" />;
            label = "Serviços Comuns";
            break;
        case SearchType.REFORMA_TRIBUTARIA:
            items = popularCnaes;
            icon = <CalculatorIcon className="w-4 h-4" />;
            label = "CNAEs Impactados";
            break;
        case SearchType.SIMPLES_NACIONAL:
            items = popularSimples;
            icon = <CalculatorIcon className="w-4 h-4" />;
            label = "Consultas Frequentes";
            break;
        case SearchType.LUCRO_PRESUMIDO_REAL:
            items = popularLucro;
            icon = <ShieldIcon className="w-4 h-4" />;
            label = "Tópicos Importantes";
            break;
        case SearchType.CFOP:
        default:
            items = popularCfops;
            label = "CFOPs Populares";
            break;
    }

    return (
        <div className="mt-8 animate-fade-in">
            <div className="flex items-center mb-4">
                <div className="p-2 bg-sky-100 dark:bg-sky-900/30 rounded-full text-sky-600 dark:text-sky-400 mr-3">
                    {icon}
                </div>
                <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {label}
                </h3>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {items.map((item) => (
                    <button
                        key={item.code}
                        onClick={() => onSelect(item.code)}
                        className="btn-press group text-left p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-sky-300 dark:hover:border-sky-500 hover:shadow-md transition-all duration-200"
                    >
                        <div className="flex flex-col">
                            <span className="text-sm font-bold text-sky-700 dark:text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-300">
                                {item.code}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 truncate group-hover:text-slate-700 dark:group-hover:text-slate-200 mt-1">
                                {item.description}
                            </span>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
};