
import React, { useState, useEffect, useRef } from 'react';
import { SimplesNacionalAnexo, SimplesNacionalAtividade, CnaeSuggestion, SimplesNacionalEmpresa } from '../types';
import { fetchCnpjFromBrasilAPI } from '../services/externalApiService';
import { sugerirAnexoPorCnae } from '../services/simplesNacionalService';
import { fetchCnaeSuggestions, fetchCnaeDescription } from '../services/geminiService';
import { PlusIcon, TrashIcon, SearchIcon, CalculatorIcon, ShieldIcon, CloseIcon } from './Icons';
import LoadingSpinner from './LoadingSpinner';
import { FormattedText } from './FormattedText';

interface SimplesNacionalNovaEmpresaProps {
    onSave: (nome: string, cnpj: string, cnae: string, anexo: SimplesNacionalAnexo | 'auto', atividadesSecundarias?: SimplesNacionalAtividade[]) => void;
    onCancel: () => void;
    onShowToast?: (message: string) => void;
    initialData?: SimplesNacionalEmpresa | null;
}

const anexoDescriptions: Record<SimplesNacionalAnexo, string> = {
    'I': 'Anexo I – Comércio',
    'II': 'Anexo II – Indústria',
    'III': 'Anexo III – Serviços (baixa complexidade)',
    'IV': 'Anexo IV – Serviços (alta complexidade)',
    'V': 'Anexo V – Serviços especiais',
    'III_V': 'Serviços com Fator R (III/V automático)',
};

const SimplesNacionalNovaEmpresa: React.FC<SimplesNacionalNovaEmpresaProps> = ({ onSave, onCancel, onShowToast, initialData }) => {
    const [nome, setNome] = useState('');
    const [cnpj, setCnpj] = useState('');
    const [cnae, setCnae] = useState('');
    const [anexo, setAnexo] = useState<'auto' | SimplesNacionalAnexo>('auto');
    const [error, setError] = useState('');

    const [isCnpjLoading, setIsCnpjLoading] = useState(false);
    const [cnpjError, setCnpjError] = useState('');
    const [nomeFantasia, setNomeFantasia] = useState('');
    const [suggestionMessage, setSuggestionMessage] = useState<string | null>(null);

    // Estado para atividades secundárias
    const [atividadesSecundarias, setAtividadesSecundarias] = useState<SimplesNacionalAtividade[]>([]);
    const [newAtividadeCnae, setNewAtividadeCnae] = useState('');
    const [newAtividadeAnexo, setNewAtividadeAnexo] = useState<SimplesNacionalAnexo>('III');

    // Estado para Busca Inteligente de CNAE
    const [cnaeSuggestions, setCnaeSuggestions] = useState<CnaeSuggestion[]>([]);
    const [isSearchingCnae, setIsSearchingCnae] = useState(false);
    const [activeCnaeField, setActiveCnaeField] = useState<'principal' | 'secundario' | null>(null);
    const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);

    // Estado para Validação de CNAE (Modal)
    const [isValidatingCnae, setIsValidatingCnae] = useState<string | null>(null); 
    const [cnaeAnalysis, setCnaeAnalysis] = useState<string | null>(null);

    useEffect(() => {
        if (initialData) {
            setNome(initialData.nome);
            setCnpj(initialData.cnpj);
            setCnae(initialData.cnae);
            setAnexo(initialData.anexo);
            setAtividadesSecundarias(initialData.atividadesSecundarias || []);
            setNomeFantasia(initialData.nomeFantasia || '');
        }
    }, [initialData]);

    useEffect(() => {
      if (anexo === 'auto' && cnae.trim().length >= 2) {
        const suggestedAnexo = sugerirAnexoPorCnae(cnae);
        const anexoDescription = (anexoDescriptions as Record<string, string>)[suggestedAnexo] || 'Anexo desconhecido';
        setSuggestionMessage(`Sugestão automática: ${anexoDescription}`);
      } else {
        setSuggestionMessage(null);
      }
    }, [cnae, anexo]);

    // Fecha sugestões ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
                setCnaeSuggestions([]);
                setActiveCnaeField(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleSearchCnae = (query: string, field: 'principal' | 'secundario') => {
        if (field === 'principal') setCnae(query);
        else setNewAtividadeCnae(query);

        setActiveCnaeField(field);

        if (searchTimeout.current) clearTimeout(searchTimeout.current);

        if (query.length < 3) {
            setCnaeSuggestions([]);
            return;
        }

        setIsSearchingCnae(true);
        searchTimeout.current = setTimeout(async () => {
            try {
                const suggestions = await fetchCnaeSuggestions(query);
                setCnaeSuggestions(suggestions);
            } catch (error) {
                console.error("Erro ao buscar sugestões CNAE:", error);
            } finally {
                setIsSearchingCnae(false);
            }
        }, 600);
    };

    const handleSelectSuggestion = (suggestion: CnaeSuggestion) => {
        if (activeCnaeField === 'principal') {
            setCnae(suggestion.code);
        } else if (activeCnaeField === 'secundario') {
            setNewAtividadeCnae(suggestion.code);
        }
        setCnaeSuggestions([]);
        setActiveCnaeField(null);
    };

    const handleValidateCnae = async (cnaeToValidate?: string) => {
        const targetCnae = cnaeToValidate || cnae;
        if (!targetCnae.trim()) return;
        
        setIsValidatingCnae(targetCnae);
        try {
            const result = await fetchCnaeDescription(targetCnae);
            setCnaeAnalysis(result.text);
        } catch (e) {
            console.error(e);
            setCnaeAnalysis("Erro ao validar CNAE.");
        } finally {
            setIsValidatingCnae(null);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!nome.trim() || !cnpj.trim() || !cnae.trim()) {
            setError('Todos os campos são obrigatórios.');
            return;
        }
        setError('');

        // Lógica de Salvamento Inteligente:
        // Se o usuário preencheu o campo de CNAE Secundário mas esqueceu de clicar no botão "+",
        // nós adicionamos automaticamente para ele antes de salvar.
        let atividadesParaSalvar = [...atividadesSecundarias];
        
        if (newAtividadeCnae.trim()) {
            atividadesParaSalvar.push({
                cnae: newAtividadeCnae,
                anexo: newAtividadeAnexo
            });
        }

        onSave(nome, cnpj, cnae, anexo, atividadesParaSalvar);
        
        if (onShowToast && !initialData) onShowToast("Empresa salva com sucesso!");
    };

    const handleCnpjVerification = async () => {
        if (!cnpj.trim()) {
            setCnpjError('Digite um CNPJ para verificar.');
            return;
        }
        setIsCnpjLoading(true);
        setCnpjError('');
        setNomeFantasia('');
        setError('');
        try {
            const data = await fetchCnpjFromBrasilAPI(cnpj);
            if (data && data.razaoSocial) {
                setNome(data.razaoSocial);
                if (data.nomeFantasia && data.nomeFantasia.toLowerCase() !== data.razaoSocial.toLowerCase()) {
                    setNomeFantasia(data.nomeFantasia);
                }
                if (data.cnaePrincipal) {
                    setCnae(data.cnaePrincipal.codigo);
                }
            }
        } catch (e: any) {
            setCnpjError(e.message || 'Erro ao verificar o CNPJ.');
        } finally {
            setIsCnpjLoading(false);
        }
    };

    const handleAddAtividade = () => {
        if (!newAtividadeCnae.trim()) return;
        
        setAtividadesSecundarias(prev => [
            ...prev, 
            { cnae: newAtividadeCnae, anexo: newAtividadeAnexo }
        ]);
        setNewAtividadeCnae('');
        setNewAtividadeAnexo('III');
    };

    const handleRemoveAtividade = (index: number) => {
        setAtividadesSecundarias(prev => prev.filter((_, i) => i !== index));
    };

    const renderSuggestions = () => {
        if (cnaeSuggestions.length === 0 && !isSearchingCnae) return null;

        return (
            <div ref={suggestionsRef} className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-xl max-h-60 overflow-y-auto animate-fade-in top-full left-0">
                {isSearchingCnae && (
                     <div className="p-4 flex justify-center items-center gap-2 text-sm text-slate-500">
                        <LoadingSpinner small />
                        <span className="ml-2">Buscando na legislação...</span>
                     </div>
                )}
                {!isSearchingCnae && cnaeSuggestions.map((s) => (
                    <button
                        key={s.code}
                        type="button"
                        onClick={() => handleSelectSuggestion(s)}
                        className="w-full text-left px-4 py-3 hover:bg-sky-50 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors"
                    >
                        <div className="flex items-center justify-between">
                            <span className="font-bold text-sky-600 dark:text-sky-400 text-sm">{s.code}</span>
                            <span className="text-[10px] bg-slate-100 dark:bg-slate-600 px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-300 font-bold uppercase">CNAE</span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 truncate font-medium">{s.description}</p>
                    </button>
                ))}
            </div>
        );
    };

    return (
        <div className="max-w-2xl mx-auto animate-fade-in pb-10 relative">
             <div className="p-8 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">
                    {initialData ? 'Editar Empresa' : 'Cadastrar Nova Empresa'}
                </h2>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="cnpj" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                            CNPJ
                        </label>
                        <div className="mt-1 flex gap-2">
                            <input
                                type="text"
                                id="cnpj"
                                value={cnpj}
                                onChange={(e) => setCnpj(e.target.value)}
                                placeholder="00.000.000/0001-00"
                                className="flex-grow w-full pl-4 pr-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                                required
                            />
                            <button
                                type="button"
                                onClick={handleCnpjVerification}
                                disabled={isCnpjLoading}
                                className="btn-press flex-shrink-0 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-wait"
                            >
                                {isCnpjLoading ? '...' : 'Verificar Receita Federal'}
                            </button>
                        </div>
                        {cnpjError && <p className="mt-1 text-xs text-red-500">{cnpjError}</p>}
                    </div>

                    <div>
                        <label htmlFor="nome" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                            Nome da Empresa (Razão Social)
                        </label>
                        <input
                            type="text"
                            id="nome"
                            value={nome}
                            onChange={(e) => setNome(e.target.value)}
                            className="mt-1 w-full pl-4 pr-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                            required
                        />
                         {nomeFantasia && <p className="mt-1 text-xs text-green-600 dark:text-green-400">Nome Fantasia: {nomeFantasia}</p>}
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative">
                            <label htmlFor="cnae" className="block text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-1">
                                CNAE Principal
                                <SearchIcon className="w-3 h-3 text-slate-400" />
                            </label>
                            <div className="flex gap-2 relative">
                                <input
                                    type="text"
                                    id="cnae"
                                    value={cnae}
                                    onChange={(e) => handleSearchCnae(e.target.value, 'principal')}
                                    onFocus={() => setActiveCnaeField('principal')}
                                    placeholder="Código ou descrição..."
                                    className="w-full pl-4 pr-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                                    required
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    onClick={() => handleValidateCnae()}
                                    disabled={!!isValidatingCnae || !cnae.trim()}
                                    className="btn-press px-3 py-2 bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 font-semibold rounded-lg hover:bg-sky-200 dark:hover:bg-sky-800 disabled:opacity-50"
                                    title="Validar CNAE e ver detalhes"
                                >
                                    {isValidatingCnae === cnae ? <LoadingSpinner small /> : <ShieldIcon className="w-5 h-5" />}
                                </button>
                            </div>
                            {activeCnaeField === 'principal' && renderSuggestions()}
                        </div>
                        <div>
                            <label htmlFor="anexo" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Anexo Principal
                            </label>
                            <select
                                id="anexo"
                                value={anexo}
                                onChange={(e) => setAnexo(e.target.value as 'auto' | SimplesNacionalAnexo)}
                                className="w-full pl-4 pr-10 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                            >
                                <option value="auto">Automático (sugerir)</option>
                                <option value="I">Anexo I – Comércio</option>
                                <option value="II">Anexo II – Indústria</option>
                                <option value="III">Anexo III – Serviços (baixa)</option>
                                <option value="IV">Anexo IV – Serviços (alta)</option>
                                <option value="V">Anexo V – Serviços especiais</option>
                                <option value="III_V">III/V (Fator R)</option>
                            </select>
                        </div>
                    </div>
                    {suggestionMessage && (
                        <div className="p-2 bg-sky-50 dark:bg-sky-900/30 border-l-4 border-sky-500 text-sky-700 dark:text-sky-300 text-sm rounded-r-lg flex items-center gap-2">
                             <CalculatorIcon className="w-4 h-4" />
                            <p>{suggestionMessage}</p>
                        </div>
                    )}

                    {/* Seção de Atividades Secundárias */}
                    <div className="border-t border-slate-200 dark:border-slate-700 pt-4 relative">
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                            Atividades Secundárias / Outros CNAEs
                        </h3>
                        <div className="flex gap-2 mb-3 relative items-end">
                             <div className="flex-grow relative">
                                <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">CNAE Secundário</label>
                                <input
                                    type="text"
                                    value={newAtividadeCnae}
                                    onChange={(e) => handleSearchCnae(e.target.value, 'secundario')}
                                    onFocus={() => setActiveCnaeField('secundario')}
                                    placeholder="Busque CNAE Secundário..."
                                    className="w-full pl-3 pr-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                                    autoComplete="off"
                                />
                                {activeCnaeField === 'secundario' && renderSuggestions()}
                             </div>
                             <div className="w-32">
                                 <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">Anexo</label>
                                 <select
                                    value={newAtividadeAnexo}
                                    onChange={(e) => setNewAtividadeAnexo(e.target.value as SimplesNacionalAnexo)}
                                    className="w-full pl-2 pr-2 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                                >
                                    <option value="I">Anexo I</option>
                                    <option value="II">Anexo II</option>
                                    <option value="III">Anexo III</option>
                                    <option value="IV">Anexo IV</option>
                                    <option value="V">Anexo V</option>
                                    <option value="III_V">III/V</option>
                                </select>
                             </div>
                            <button
                                type="button"
                                onClick={handleAddAtividade}
                                className="btn-press p-2 bg-slate-100 dark:bg-slate-700 text-sky-600 dark:text-sky-400 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 h-[38px] w-[38px] flex items-center justify-center"
                                title="Adicionar Atividade"
                            >
                                <PlusIcon className="w-5 h-5" />
                            </button>
                        </div>

                        {atividadesSecundarias.length > 0 && (
                            <ul className="space-y-2">
                                {atividadesSecundarias.map((item, index) => (
                                    <li key={index} className="flex justify-between items-center p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-sm">
                                        <div className="flex items-center gap-3">
                                            <span className="font-semibold text-slate-700 dark:text-slate-200">{item.cnae}</span>
                                            <span className="text-slate-400">|</span>
                                            <span className="text-slate-500 dark:text-slate-400">
                                                {anexoDescriptions[item.anexo].replace('Anexo ', '')}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleValidateCnae(item.cnae)}
                                                disabled={!!isValidatingCnae}
                                                className="p-1 text-sky-600 hover:bg-sky-100 dark:hover:bg-sky-900/30 rounded flex items-center gap-1"
                                                title="Validar"
                                            >
                                                {isValidatingCnae === item.cnae ? <LoadingSpinner small /> : (
                                                    <>
                                                        <ShieldIcon className="w-4 h-4" />
                                                        <span className="text-[10px] font-bold uppercase hidden sm:inline">Validar</span>
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveAtividade(index)}
                                                className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20"
                                            >
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>


                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <div className="flex justify-end gap-4 pt-4">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="btn-press px-6 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="btn-press px-6 py-2 bg-sky-600 text-white font-semibold rounded-lg hover:bg-sky-700"
                        >
                            {initialData ? 'Salvar Alterações' : 'Salvar Empresa'}
                        </button>
                    </div>
                </form>
             </div>

             {/* Modal de Validação CNAE */}
             {cnaeAnalysis && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[100] animate-fade-in" onClick={() => setCnaeAnalysis(null)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="bg-sky-50 dark:bg-sky-900/30 p-4 rounded-t-xl flex justify-between items-center border-b border-sky-100 dark:border-sky-800">
                            <h3 className="text-sky-800 dark:text-sky-200 font-bold text-lg flex items-center gap-2">
                                <ShieldIcon className="w-6 h-6" />
                                Análise Oficial do CNAE
                            </h3>
                            <button onClick={() => setCnaeAnalysis(null)} className="p-1 rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                                <CloseIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto prose prose-slate dark:prose-invert max-w-none text-sm">
                            <FormattedText text={cnaeAnalysis || ''} />
                        </div>
                        <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-b-xl border-t border-slate-200 dark:border-slate-700">
                            <button 
                                onClick={() => setCnaeAnalysis(null)} 
                                className="w-full py-2 bg-sky-600 text-white rounded-lg font-bold hover:bg-sky-700 transition-colors"
                            >
                                Fechar e Continuar
                            </button>
                        </div>
                    </div>
                </div>
             )}
        </div>
    );
};

export default SimplesNacionalNovaEmpresa;
