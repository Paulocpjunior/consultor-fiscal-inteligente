import React, { useState, useCallback, useRef, useEffect, useMemo, Suspense, lazy } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import LoadingSpinner from './components/LoadingSpinner';
import LoginScreen from './components/LoginScreen';
import TaxAlerts from './components/TaxAlerts';
import NewsAlerts from './components/NewsAlerts';
import ReformaNews from './components/ReformaNews';
import ReformaTributariaNewsBanner from './components/ReformaTributariaNewsBanner';
import FavoritesSidebar from './components/FavoritesSidebar';
import SimplesNacionalDashboard from './components/SimplesNacionalDashboard';
import SimplesNacionalNovaEmpresa from './components/SimplesNacionalNovaEmpresa';
import InitialStateDisplay from './components/InitialStateDisplay';
import SimilarServicesDisplay from './components/SimilarServicesDisplay';
import AccessLogsModal from './components/AccessLogsModal';
import UserManagementModal from './components/UserManagementModal';
import { PopularSuggestions } from './components/PopularSuggestions';
import Tooltip from './components/Tooltip';
import Toast from './components/Toast';
import { SearchType, type SearchResult, type ComparisonResult, type FavoriteItem, type HistoryItem, type SimilarService, type CnaeSuggestion, SimplesNacionalEmpresa, SimplesNacionalNota, SimplesNacionalAnexo, SimplesNacionalImportResult, SimplesNacionalAtividade, User } from './types';
import { fetchFiscalData, fetchComparison, fetchSimilarServices, fetchCnaeSuggestions } from './services/geminiService';
import * as simplesService from './services/simplesNacionalService';
import * as authService from './services/authService';
import { BuildingIcon, CalculatorIcon, ChevronDownIcon, DocumentTextIcon, LocationIcon, SearchIcon, TagIcon, UserIcon, InfoIcon, CalendarIcon, ChatBubbleIcon, DownloadIcon } from './components/Icons';
import FiscalObligationsDashboard from './components/FiscalObligationsDashboard';
// ✅ REMOVIDO: import { auth, isFirebaseConfigured } from './services/firebaseConfig';
// ✅ REMOVIDO: import { onAuthStateChanged } from 'firebase/auth';
// Ambos encapsulados em authService.subscribeAuthState

const SimplesNacionalDetalhe = lazy(() => import('./components/SimplesNacionalDetalhe'));
const SimplesNacionalClienteView = lazy(() => import('./components/SimplesNacionalClienteView'));
const ResultsDisplay = lazy(() => import('./components/ResultsDisplay'));
const ComparisonDisplay = lazy(() => import('./components/ComparisonDisplay'));
const ReformaResultDisplay = lazy(() => import('./components/ReformaResultDisplay'));
const LucroPresumidoRealDashboard = lazy(() => import('./components/LucroPresumidoRealDashboard'));
const ImportaXML = lazy(() => import('./components/ImportaXML'));
const AnalisadorRegime = lazy(() => import('./components/AnalisadorRegime'));

const searchDescriptions: Record<SearchType, string> = {
    [SearchType.CFOP]: "Consulte códigos de operação e entenda a aplicação e tributação.",
    [SearchType.NCM]: "Classificação fiscal de mercadorias e incidência de impostos (IPI, ICMS).",
    [SearchType.SERVICO]: "Análise de retenção de ISS, local de incidência e alíquotas.",
    [SearchType.REFORMA_TRIBUTARIA]: "Simule o impacto da Reforma Tributária (IBS/CBS) para sua atividade.",
    [SearchType.SIMPLES_NACIONAL]: "Gestão de empresas do Simples, cálculo de DAS e Fator R.",
    [SearchType.LUCRO_PRESUMIDO_REAL]: "Ficha Financeira e Cadastro para Lucro Presumido/Real.",
    [SearchType.OBRIGACOES_FISCAIS]: "Acompanhamento de obrigações, vencimentos e alertas fiscais.",
    [SearchType.IMPORTA_XML]: "Importe XMLs de NFe/NFSe para visualizar dados fiscais e impostos.",
};

const App: React.FC = () => {
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        if (typeof window !== 'undefined') {
            if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.classList.add('dark');
                return 'dark';
            }
        }
        document.documentElement.classList.remove('dark');
        return 'light';
    });

    // Auth State
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
    const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);

    const [searchType, setSearchType] = useState<SearchType>(SearchType.CFOP);
    const [mode, setMode] = useState<'single' | 'compare'>('single');
    const [query1, setQuery1] = useState('');
    const [query2, setQuery2] = useState('');

    const [cnae, setCnae] = useState('');
    const [cnae2, setCnae2] = useState('');
    const [reformaQuery, setReformaQuery] = useState('');

    const [municipio, setMunicipio] = useState('');
    const [alias, setAlias] = useState('');
    const [responsavel, setResponsavel] = useState('');
    const [regimeTributario, setRegimeTributario] = useState('');
    const [aliquotaIcms, setAliquotaIcms] = useState('');
    const [aliquotaPisCofins, setAliquotaPisCofins] = useState('');
    const [aliquotaIss, setAliquotaIss] = useState('');
    const [userNotes, setUserNotes] = useState('');

    const [result, setResult] = useState<SearchResult | null>(null);
    const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

    const [similarServices, setSimilarServices] = useState<SimilarService[] | null>(null);
    const [isLoadingSimilar, setIsLoadingSimilar] = useState(false);
    const [errorSimilar, setErrorSimilar] = useState<string | null>(null);

    const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    const [cnaeSuggestions, setCnaeSuggestions] = useState<CnaeSuggestion[]>([]);
    const [isLoadingCnaeSuggestions, setIsLoadingCnaeSuggestions] = useState(false);
    const [errorCnaeSuggestions, setErrorCnaeSuggestions] = useState<string | null>(null);
    const cnaeDebounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suggestionsContainerRef = useRef<HTMLDivElement>(null);

    // Simples Nacional State
    const [simplesView, setSimplesView] = useState<'dashboard' | 'detalhe' | 'nova' | 'cliente'>('dashboard');
    const [simplesEmpresas, setSimplesEmpresas] = useState<SimplesNacionalEmpresa[]>([]);
    const [simplesNotas, setSimplesNotas] = useState<Record<string, SimplesNacionalNota[]>>({});
    const [selectedSimplesEmpresaId, setSelectedSimplesEmpresaId] = useState<string | null>(null);
    const [simplesEmpresaToEdit, setSimplesEmpresaToEdit] = useState<SimplesNacionalEmpresa | null>(null);

    // Lucro Presumido/Real State (ID para navegação via histórico)
    const [selectedLucroEmpresaId, setSelectedLucroEmpresaId] = useState<string | null>(null);

    const loadSimplesData = async (user?: User | null) => {
        const targetUser = user || currentUser;
        if (!targetUser) return;
        try {
            const empresas = await simplesService.getEmpresas(targetUser);
            const notas = await simplesService.getAllNotas(targetUser);
            setSimplesEmpresas(empresas);
            setSimplesNotas(notas);
        } catch (e) {
            console.error("Erro ao carregar dados do Simples", e);
        }
    };

    // ✅ ALTERADO: usa subscribeAuthState em vez de onAuthStateChanged manual.
    // O listener dispara imediatamente com o usuário atual (ou null),
    // sincroniza automaticamente em qualquer dispositivo sem relogar.
    useEffect(() => {
        try {
            const storedFavorites = localStorage.getItem('fiscal-consultant-favorites');
            if (storedFavorites) setFavorites(JSON.parse(storedFavorites));

            const storedHistory = localStorage.getItem('fiscal-consultant-history');
            if (storedHistory) setHistory(JSON.parse(storedHistory));

            const unsubscribe = authService.subscribeAuthState((user) => {
                setCurrentUser(user);
                if (user) loadSimplesData(user);
            });

            return () => unsubscribe();
        } catch (e) {
            console.error("Initialization error", e);
        }
    }, []);

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            localStorage.theme = 'dark';
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.theme = 'light';
        }
    }, [theme]);

    const handleLoginSuccess = (user: User) => {
        setCurrentUser(user);
        loadSimplesData(user);
    };

    const handleLogout = () => {
        authService.logout();
        setCurrentUser(null);
        setSimplesEmpresas([]);
    };

    const handleSelectHistoryItem = (item: HistoryItem) => {
        if (item.type === SearchType.SIMPLES_NACIONAL && item.entityId) {
            setSearchType(item.type);
            setSimplesView('detalhe');
            setSelectedSimplesEmpresaId(item.entityId);
        } else if (item.type === SearchType.LUCRO_PRESUMIDO_REAL && item.entityId) {
            setSearchType(item.type);
            setSelectedLucroEmpresaId(item.entityId);
        } else {
            setSearchType(item.type);
            setMode(item.mode);
            setMunicipio(item.municipio || '');
            setAlias(item.alias || '');
            setResponsavel(item.responsavel || '');
            setRegimeTributario(item.regimeTributario || '');
            setReformaQuery(item.reformaQuery || '');
            setUserNotes(item.userNotes || '');

            if (item.type === SearchType.REFORMA_TRIBUTARIA) {
                if (item.mode === 'single') {
                    setReformaQuery(item.queries[0]);
                } else {
                    setCnae(item.queries[0]);
                    setCnae2(item.queries[1]);
                }
            } else {
                setQuery1(item.queries[0]);
                if (item.mode === 'compare' && item.queries[1]) {
                    setQuery2(item.queries[1]);
                }
            }

            const explicitContext = {
                type: item.type,
                mode: item.mode,
                municipio: item.municipio,
                alias: item.alias,
                responsavel: item.responsavel,
                regimeTributario: item.regimeTributario,
                aliquotaIcms: item.aliquotaIcms,
                aliquotaPisCofins: item.aliquotaPisCofins,
                aliquotaIss: item.aliquotaIss,
                userNotes: item.userNotes
            };

            handleSearch(item.queries[0], item.queries[1], explicitContext);
        }
        if (window.innerWidth < 768) setIsSidebarOpen(false);
    };

    const handleHistoryRemove = (id: string) => {
        const newHistory = history.filter(item => item.id !== id);
        setHistory(newHistory);
        localStorage.setItem('fiscal-consultant-history', JSON.stringify(newHistory));
    };

    const handleHistoryClear = () => {
        setHistory([]);
        localStorage.removeItem('fiscal-consultant-history');
    };

    const addHistory = (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
        const newHistoryItem: HistoryItem = {
            ...item,
            id: Date.now().toString(),
            timestamp: Date.now(),
        };
        const updatedHistory = [newHistoryItem, ...history].slice(0, 50);
        setHistory(updatedHistory);
        localStorage.setItem('fiscal-consultant-history', JSON.stringify(updatedHistory));
    };

    const handleSelectFavorite = (item: FavoriteItem) => {
        setSearchType(item.type);
        setMode('single');
        if (item.type === SearchType.REFORMA_TRIBUTARIA) {
            setReformaQuery(item.code);
        } else {
            setQuery1(item.code);
        }
        handleSearch(item.code, undefined, { type: item.type, mode: 'single' });
        if (window.innerWidth < 768) setIsSidebarOpen(false);
    };

    const saveFavorites = (newFavorites: FavoriteItem[]) => {
        setFavorites(newFavorites);
        localStorage.setItem('fiscal-consultant-favorites', JSON.stringify(newFavorites));
    };

    const handleToggleFavorite = () => {
        if (!result) return;
        const code = searchType === SearchType.REFORMA_TRIBUTARIA ? result.query : query1;
        const description = result.text.split('\n')[0].substring(0, 50) + '...';

        const existingIndex = favorites.findIndex(f => f.code === code && f.type === searchType);

        let newFavorites;
        if (existingIndex >= 0) {
            newFavorites = favorites.filter((_, i) => i !== existingIndex);
            setToastMessage("Favorito removido com sucesso!");
        } else {
            newFavorites = [...favorites, { code, description, type: searchType }];
            setToastMessage("Adicionado aos Favoritos!");
        }
        saveFavorites(newFavorites);
    };

    const getFriendlyErrorMessage = (error: any): string => {
        const message = error?.message || '';

        if (message.includes('429') || message.includes('Quota exceeded')) {
            return "Limite de consultas excedido (Erro 429). A IA está sobrecarregada ou sua cota acabou. Por favor, aguarde alguns instantes antes de tentar novamente.";
        }
        if (message.includes('503') || message.includes('Service Unavailable')) {
            return "O serviço de IA está temporariamente indisponível (Erro 503). Isso geralmente é passageiro. Tente novamente em alguns minutos.";
        }
        if (message.includes('400') || message.includes('Invalid argument')) {
            return "A consulta parece inválida ou incompleta (Erro 400). Verifique os dados digitados e tente novamente.";
        }
        if (message.includes('405') || message.includes('Not Allowed')) {
            return "Erro de comunicação com o serviço de IA (Erro 405). O modelo pode não estar disponível. Tente novamente em alguns instantes.";
        }
        if (message.includes('500')) {
            return "Erro interno no servidor da IA (Erro 500). Por favor, tente novamente.";
        }
        if (message.includes('Failed to fetch')) {
            return "Erro de conexão. Verifique sua internet e tente novamente.";
        }
        if (message.includes('pattern') || message.includes('DOMException')) {
            return "Erro ao conectar com a API. Verifique se a chave da API (VITE_GEMINI_API_KEY) está configurada corretamente no arquivo .env.";
        }
        if (message.includes('invalid characters') || message.includes('API Key contains')) {
            return "A chave da API contém caracteres inválidos. Verifique o valor de VITE_GEMINI_API_KEY no arquivo .env.";
        }
        if (message.includes('process is not defined') || message.includes('GEMINI_API_KEY') || message.includes('API Key must be set')) {
            return "A chave da API do Gemini não foi configurada. Por favor, configure a variável VITE_GEMINI_API_KEY no arquivo .env.";
        }
        if (message.includes('filtro de segurança') || message.includes('SAFETY')) {
            return "A consulta foi bloqueada pelo filtro de segurança da IA. Tente reformular sua pergunta.";
        }

        return message || "Ocorreu um erro inesperado ao comunicar com a API.";
    };

    const validateInputs = (q1: string, q2?: string) => {
        const errors: Record<string, string> = {};
        if (!q1.trim()) {
            errors.query1 = "O campo de busca é obrigatório.";
        }
        if (mode === 'compare' && q2 !== undefined && !q2.trim()) {
            errors.query2 = "O segundo campo é obrigatório para comparação.";
        }

        const validateRate = (rate: string, fieldName: string) => {
            if (rate) {
                const num = parseFloat(rate);
                if (isNaN(num) || num < 0 || num > 100) {
                    errors[fieldName] = "Alíquota inválida (0-100).";
                }
            }
        };

        validateRate(aliquotaIcms, 'aliquotaIcms');
        validateRate(aliquotaPisCofins, 'aliquotaPisCofins');
        validateRate(aliquotaIss, 'aliquotaIss');

        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const checkApiKey = async () => {
        if ((import.meta as any).env?.VITE_GEMINI_API_KEY) return true;

        // @ts-ignore
        if (window.aistudio) {
            try {
                // @ts-ignore
                const hasKey = await window.aistudio.hasSelectedApiKey();
                if (!hasKey) {
                    // @ts-ignore
                    await window.aistudio.openSelectKey();
                    return true;
                }
                return true;
            } catch (e) {
                console.error("Erro ao verificar chave da API:", e);
                return false;
            }
        }
        return false;
    };

    const handleSearch = useCallback(async (currentQuery1: string, currentQuery2?: string, contextOverride?: any) => {
        if (isLoading) return;
        if (!validateInputs(currentQuery1, currentQuery2)) return;

        setIsLoading(true);
        setError(null);
        setResult(null);
        setComparisonResult(null);

        await checkApiKey();

        const currentSearchType = contextOverride?.type || searchType;
        const currentMode = contextOverride?.mode || mode;
        const currentMunicipio = contextOverride?.municipio !== undefined ? contextOverride.municipio : municipio;
        const currentAlias = contextOverride?.alias !== undefined ? contextOverride.alias : alias;
        const currentResponsavel = contextOverride?.responsavel !== undefined ? contextOverride.responsavel : responsavel;
        const currentRegime = contextOverride?.regimeTributario !== undefined ? contextOverride.regimeTributario : regimeTributario;
        const currentIcms = contextOverride?.aliquotaIcms !== undefined ? contextOverride.aliquotaIcms : aliquotaIcms;
        const currentPisCofins = contextOverride?.aliquotaPisCofins !== undefined ? contextOverride.aliquotaPisCofins : aliquotaPisCofins;
        const currentIss = contextOverride?.aliquotaIss !== undefined ? contextOverride.aliquotaIss : aliquotaIss;
        const currentUserNotes = contextOverride?.userNotes !== undefined ? contextOverride.userNotes : userNotes;

        if (currentUser) authService.logAction(currentUser.id, currentUser.name, 'search', `${currentSearchType}: ${currentQuery1}`);

        try {
            if (currentMode === 'compare' && currentQuery2) {
                const data = await fetchComparison(currentSearchType, currentQuery1, currentQuery2);
                setComparisonResult(data);
                if (!contextOverride) {
                    addHistory({
                        queries: [currentQuery1, currentQuery2],
                        type: currentSearchType,
                        mode: 'compare',
                        resultSnippet: data.summary.substring(0, 50) + '...'
                    });
                }
            } else {
                const data = await fetchFiscalData(
                    currentSearchType,
                    currentQuery1,
                    currentMunicipio,
                    currentAlias,
                    currentResponsavel,
                    undefined,
                    currentRegime,
                    undefined,
                    currentIcms,
                    currentPisCofins,
                    currentIss,
                    currentUserNotes
                );
                setResult(data);
                if (!contextOverride) {
                    addHistory({
                        queries: [currentQuery1],
                        type: currentSearchType,
                        mode: 'single',
                        municipio: currentMunicipio,
                        alias: currentAlias,
                        responsavel: currentResponsavel,
                        regimeTributario: currentRegime,
                        aliquotaIcms: currentIcms,
                        aliquotaPisCofins: currentPisCofins,
                        aliquotaIss: currentIss,
                        userNotes: currentUserNotes,
                        resultSnippet: data.text.substring(0, 50) + '...'
                    });
                }
            }
        } catch (err) {
            const msg = getFriendlyErrorMessage(err);
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    }, [searchType, mode, municipio, alias, responsavel, regimeTributario, currentUser, aliquotaIcms, aliquotaPisCofins, aliquotaIss, isLoading, userNotes]);

    const handleReformaSearch = useCallback(async (query: string) => {
        if (isLoading) return;
        if (!query.trim()) {
            setValidationErrors({ reformaQuery: "Digite um termo para pesquisar." });
            return;
        }
        setValidationErrors({});
        setIsLoading(true);
        setError(null);
        setResult(null);

        await checkApiKey();

        if (currentUser) authService.logAction(currentUser.id, currentUser.name, 'search_reforma', query);

        try {
            const data = await fetchFiscalData(SearchType.REFORMA_TRIBUTARIA, query, undefined, undefined, undefined, query);
            setResult(data);
            addHistory({
                queries: [query],
                type: SearchType.REFORMA_TRIBUTARIA,
                mode: 'single',
                reformaQuery: query,
                resultSnippet: data.text.substring(0, 50) + '...'
            });
        } catch (err) {
            const msg = getFriendlyErrorMessage(err);
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    }, [currentUser, isLoading]);

    const handleFindSimilar = async () => {
        if (!result || searchType !== SearchType.SERVICO) return;
        setIsLoadingSimilar(true);
        setErrorSimilar(null);
        try {
            const similar = await fetchSimilarServices(result.query);
            setSimilarServices(similar);
        } catch (e) {
            setErrorSimilar("Não foi possível buscar serviços similares.");
        } finally {
            setIsLoadingSimilar(false);
        }
    };

    // Simples Nacional Handlers
    const handleSaveSimplesEmpresa = async (nome: string, cnpj: string, cnae: string, anexo: any, atividadesSecundarias?: any[]) => {
        if (!currentUser) return;

        if (simplesEmpresaToEdit) {
            const finalAnexo = anexo === 'auto' ? simplesService.sugerirAnexoPorCnae(cnae) : anexo;
            const dataToUpdate: Partial<SimplesNacionalEmpresa> = {
                nome, cnpj, cnae, anexo: finalAnexo, atividadesSecundarias: atividadesSecundarias || []
            };

            await simplesService.updateEmpresa(simplesEmpresaToEdit.id, dataToUpdate);
            setSimplesEmpresas(prev => prev.map(e => e.id === simplesEmpresaToEdit.id ? { ...e, ...dataToUpdate } : e));
            setToastMessage("Empresa atualizada com sucesso!");
        } else {
            const newEmpresa = await simplesService.saveEmpresa(nome, cnpj, cnae, anexo, atividadesSecundarias || [], currentUser.id);
            setSimplesEmpresas(prev => [...prev, newEmpresa]);
            if (currentUser) authService.logAction(currentUser.id, currentUser.name, 'create_empresa', nome);
            setToastMessage("Empresa cadastrada com sucesso!");

            addHistory({
                queries: [nome],
                type: SearchType.SIMPLES_NACIONAL,
                mode: 'single',
                entityId: newEmpresa.id
            });
        }
        setSimplesView('dashboard');
        setSimplesEmpresaToEdit(null);
    };

    const handleImportNotas = async (empresaId: string, file: File): Promise<SimplesNacionalImportResult> => {
        try {
            const result = await simplesService.parseAndSaveNotas(empresaId, file);
            if (currentUser) {
                const empresas = await simplesService.getEmpresas(currentUser);
                const notas = await simplesService.getAllNotas(currentUser);
                setSimplesEmpresas(empresas);
                setSimplesNotas(notas);
            }
            if (currentUser) authService.logAction(currentUser.id, currentUser.name, 'import_notas', empresaId);
            setToastMessage(result.successCount > 0 ? `${result.successCount} registros importados com sucesso!` : "Nenhum dado importado.");
            return result;
        } catch (e: any) {
            return { successCount: 0, failCount: 0, errors: [e.message] };
        }
    };

    const handleUpdateFolha12 = (empresaId: string, val: number) => {
        simplesService.updateFolha12(empresaId, val);
        const updated = simplesEmpresas.map(e => e.id === empresaId ? { ...e, folha12: val } : e);
        setSimplesEmpresas(updated);
        setToastMessage("Folha de salários atualizada!");
        return updated.find(e => e.id === empresaId) || null;
    };

    const handleSaveFaturamentoManual = async (empresaId: string, faturamento: any, faturamentoDetalhado?: any) => {
        await simplesService.saveFaturamentoManual(empresaId, faturamento, faturamentoDetalhado);
        const updated = simplesEmpresas.map(e => e.id === empresaId ? {
            ...e,
            faturamentoManual: faturamento,
            faturamentoMensalDetalhado: faturamentoDetalhado || e.faturamentoMensalDetalhado
        } : e);
        setSimplesEmpresas(updated);

        const emp = updated.find(e => e.id === empresaId);
        if (emp) {
            addHistory({
                queries: [`Cálculo: ${emp.nome}`],
                type: SearchType.SIMPLES_NACIONAL,
                mode: 'single',
                entityId: empresaId
            });
        }

        return emp || null;
    };

    const handleUpdateEmpresa = async (empresaId: string, data: Partial<SimplesNacionalEmpresa>) => {
        const updatedList = simplesEmpresas.map(e => e.id === empresaId ? { ...e, ...data } : e);
        setSimplesEmpresas(updatedList);
        await simplesService.updateEmpresa(empresaId, data);
        setToastMessage("Dados da empresa salvos no banco de dados!");
        return updatedList.find(e => e.id === empresaId) || null;
    }

    const isFavorite = useMemo(() => {
        const code = searchType === SearchType.REFORMA_TRIBUTARIA ? reformaQuery : query1;
        return favorites.some(f => f.code === code && f.type === searchType);
    }, [favorites, searchType, query1, reformaQuery]);

    if (!currentUser) {
        return (
            <>
                <LoginScreen onLoginSuccess={handleLoginSuccess} />
                <div className="fixed bottom-4 right-4 flex gap-2">
                    <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} className="p-2 bg-white dark:bg-slate-800 rounded-full shadow-lg">
                        {theme === 'light' ? '🌙' : '☀️'}
                    </button>
                </div>
            </>
        );
    }

    const selectedEmpresa = simplesEmpresas.find(e => e.id === selectedSimplesEmpresaId);

    return (
        <div className="min-h-screen transition-colors" style={{background:"#020026",fontFamily:"'DM Sans',sans-serif"}}>
            <div className="container mx-auto px-4 max-w-7xl">
                <Header
                    theme={theme}
                    toggleTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
                    onMenuClick={() => setIsSidebarOpen(true)}
                    description={searchDescriptions[searchType]}
                    user={currentUser}
                    onLogout={handleLogout}
                    onShowLogs={currentUser.role === 'admin' ? () => setIsLogsModalOpen(true) : undefined}
                    onShowUsers={currentUser.role === 'admin' ? () => setIsUsersModalOpen(true) : undefined}
                />

                <div className="flex flex-col md:flex-row gap-6">
                    <main className="flex-grow min-w-0">
                        {/* Search Type Selection Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2 mb-4">
                            {Object.values(SearchType).filter(t => t !== SearchType.IMPORTA_XML).map((type) => (
                                <button
                                    key={type}
                                    onClick={() => {
                                        setSearchType(type);
                                        setResult(null);
                                        setQuery1('');
                                        setQuery2('');
                                        setError(null);
                                        setValidationErrors({});
                                        setUserNotes('');
                                        if (type === SearchType.SIMPLES_NACIONAL) {
                                            setSimplesView('dashboard');
                                            setSimplesEmpresaToEdit(null);
                                            loadSimplesData(currentUser);
                                        }
                                        if (type === SearchType.LUCRO_PRESUMIDO_REAL) {
                                            setSelectedLucroEmpresaId(null);
                                        }
                                    }}
                                    className="flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-200"
                                    style={{
                                        background: searchType === type ? 'rgba(20,0,255,0.2)' : 'rgba(8,0,122,0.08)',
                                        border: searchType === type ? '1px solid rgba(20,0,255,0.45)' : '1px solid rgba(200,208,255,0.1)',
                                        color: searchType === type ? '#F5F6FF' : 'rgba(200,208,255,0.5)',
                                        transform: searchType === type ? 'scale(1.05)' : 'scale(1)'
                                    }}
                                >
                                    <div className="mb-2">
                                        {type === SearchType.CFOP && <TagIcon className="w-5 h-5" />}
                                        {type === SearchType.NCM && <DocumentTextIcon className="w-5 h-5" />}
                                        {type === SearchType.SERVICO && <BuildingIcon className="w-5 h-5" />}
                                        {type === SearchType.REFORMA_TRIBUTARIA && <CalculatorIcon className="w-5 h-5" />}
                                        {type === SearchType.SIMPLES_NACIONAL && <CalculatorIcon className="w-5 h-5" />}
                                        {type === SearchType.LUCRO_PRESUMIDO_REAL && <BuildingIcon className="w-5 h-5" />}
                                        {type === SearchType.OBRIGACOES_FISCAIS && <CalendarIcon className="w-5 h-5" />}
                                    </div>
                                    <span className="text-xs font-bold text-center leading-tight">{type}</span>
                                </button>
                            ))}
                            {/* NFP Pro Cloud — atalho externo */}
                            <a
                                href="https://consulta-sp.web.app"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-200" style={{background:"rgba(8,0,122,0.08)",border:"1px solid rgba(200,208,255,0.1)",color:"rgba(200,208,255,0.6)"}}
                            >
                                <div className="mb-2">
                                    <DocumentTextIcon className="w-5 h-5" />
                                </div>
                                <span className="text-xs font-bold text-center leading-tight">NFP Pro Cloud</span>
                            </a>
                            {/* Importa XML */}
                            <button
                                onClick={() => {
                                    setSearchType(SearchType.IMPORTA_XML);
                                    setResult(null);
                                    setQuery1('');
                                    setQuery2('');
                                    setError(null);
                                    setValidationErrors({});
                                    setUserNotes('');
                                }}
                                className="flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-200"
                                style={{
                                    background: searchType === SearchType.IMPORTA_XML ? 'rgba(20,0,255,0.2)' : 'rgba(8,0,122,0.08)',
                                    border: searchType === SearchType.IMPORTA_XML ? '1px solid rgba(20,0,255,0.45)' : '1px solid rgba(200,208,255,0.1)',
                                    color: searchType === SearchType.IMPORTA_XML ? '#F5F6FF' : 'rgba(200,208,255,0.5)',
                                    transform: searchType === SearchType.IMPORTA_XML ? 'scale(1.05)' : 'scale(1)'
                                }}
                            >
                                <div className="mb-2">
                                    <DownloadIcon className="w-5 h-5" />
                                </div>
                                <span className="text-xs font-bold text-center leading-tight">Importa XML</span>
                            </button>
                        </div>

                        {/* ✅ NEWS REFORMA TRIBUTÁRIA — aparece em todas as telas */}
                        <ReformaTributariaNewsBanner />

                        {/* Standard Search Views (CFOP, NCM, Serviço, Simples, Lucro, Obrigações) */}
                        {[SearchType.CFOP, SearchType.NCM, SearchType.SERVICO, SearchType.SIMPLES_NACIONAL, SearchType.LUCRO_PRESUMIDO_REAL, SearchType.OBRIGACOES_FISCAIS, SearchType.IMPORTA_XML].includes(searchType) && (
                            <>
                                <div className={`p-6 rounded-xl mb-6 animate-fade-in ${[SearchType.SIMPLES_NACIONAL, SearchType.LUCRO_PRESUMIDO_REAL, SearchType.OBRIGACOES_FISCAIS, SearchType.IMPORTA_XML].includes(searchType) ? 'hidden' : ''}`} style={{background:"rgba(8,0,122,0.08)",border:"1px solid rgba(200,208,255,0.08)"}}>
                                    <div className="flex items-center gap-4 mb-4">
                                        <button
                                            onClick={() => setMode('single')}
                                            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors`} style={{background:mode==='single'?'rgba(20,0,255,0.15)':'transparent',color:mode==='single'?'#5B7FFF':'rgba(200,208,255,0.4)'}}
                                        >
                                            Consulta Individual
                                        </button>
                                        <button
                                            onClick={() => setMode('compare')}
                                            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors`} style={{background:mode==='compare'?'rgba(20,0,255,0.15)':'transparent',color:mode==='compare'?'#5B7FFF':'rgba(200,208,255,0.4)'}}
                                        >
                                            Comparar Tópicos
                                        </button>
                                    </div>

                                    <div className="flex flex-col md:flex-row gap-4">
                                        <div className="flex-grow relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <SearchIcon className="h-5 w-5 text-slate-400" />
                                            </div>
                                            <input
                                                type="text"
                                                value={query1}
                                                onChange={(e) => { setQuery1(e.target.value); if (validationErrors.query1) setValidationErrors({ ...validationErrors, query1: '' }); }}
                                                onKeyDown={(e) => e.key === 'Enter' && handleSearch(query1, query2)}
                                                placeholder={mode === 'single' ? `Digite o termo ou dúvida sobre ${searchType}` : `Primeiro termo ${searchType}`}
                                                className='w-full pl-10 pr-4 py-3 rounded-lg outline-none transition-all font-normal' style={{background:'rgba(255,255,255,0.04)',border:validationErrors.query1?'1px solid #FF4466':'1px solid rgba(200,208,255,0.1)',color:'#F5F6FF'}}
                                                aria-label="Campo de busca principal"
                                                aria-invalid={!!validationErrors.query1}
                                                aria-describedby="query1-error"
                                            />
                                            {validationErrors.query1 && <p id="query1-error" className="text-xs text-red-500 mt-1">{validationErrors.query1}</p>}
                                        </div>

                                        {mode === 'compare' && (
                                            <div className="flex-grow relative animate-fade-in">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                    <SearchIcon className="h-5 w-5 text-slate-400" />
                                                </div>
                                                <input
                                                    type="text"
                                                    value={query2}
                                                    onChange={(e) => { setQuery2(e.target.value); if (validationErrors.query2) setValidationErrors({ ...validationErrors, query2: '' }); }}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch(query1, query2)}
                                                    placeholder={`Segundo termo ${searchType}`}
                                                    className='w-full pl-10 pr-4 py-3 rounded-lg outline-none transition-all font-normal' style={{background:'rgba(255,255,255,0.04)',border:validationErrors.query2?'1px solid #FF4466':'1px solid rgba(200,208,255,0.1)',color:'#F5F6FF'}}
                                                    aria-label="Segundo campo de busca para comparação"
                                                />
                                                {validationErrors.query2 && <p className="text-xs text-red-500 mt-1">{validationErrors.query2}</p>}
                                            </div>
                                        )}

                                        <button
                                            onClick={() => handleSearch(query1, query2)}
                                            disabled={isLoading}
                                            className="btn-press px-6 py-3 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 min-w-[120px]" style={{background:"#1400FF"}}
                                        >
                                            {isLoading ? (
                                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                                <span>Consultar IA</span>
                                            )}
                                        </button>
                                    </div>

                                    {/* Advanced Context Options */}
                                    {[SearchType.CFOP, SearchType.NCM, SearchType.SERVICO].includes(searchType) && (
                                        <div className="mt-6 pt-6" style={{borderTop:"1px solid rgba(200,208,255,0.08)"}}>
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className="text-sm font-medium uppercase tracking-wider flex items-center gap-2" style={{color:"rgba(200,208,255,0.6)"}}>
                                                    <CalculatorIcon className="w-4 h-4 text-sky-500" />
                                                    Contexto Adicional para IA
                                                </h3>
                                                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase" style={{background:"rgba(20,0,255,0.1)",color:"#5B7FFF"}}>Opcional</span>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                <div className="md:col-span-2">
                                                    <label className="text-xs font-medium uppercase flex items-center gap-1 mb-2" style={{color:"rgba(200,208,255,0.4)"}}>
                                                        Notas / Observações da Operação
                                                        <Tooltip content="Adicione contexto específico para a análise da IA.">
                                                            <InfoIcon className="w-3 h-3 text-slate-400 cursor-help" />
                                                        </Tooltip>
                                                    </label>
                                                    <textarea
                                                        value={userNotes}
                                                        onChange={(e) => setUserNotes(e.target.value)}
                                                        className="w-full p-3 text-sm rounded-xl font-normal resize-none h-[108px] outline-none transition-all" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(200,208,255,0.1)",color:"#F5F6FF"}}
                                                        placeholder="Ex: Operação com mercadoria sujeita a ST no destino, venda para consumidor final não contribuinte..."
                                                    />
                                                </div>

                                                <div className="space-y-4">
                                                    <div>
                                                        <label className="text-xs font-medium uppercase flex items-center gap-1 mb-1.5" style={{color:"rgba(200,208,255,0.4)"}}>
                                                            ICMS (%)
                                                            <Tooltip content="Alíquota do ICMS.">
                                                                <InfoIcon className="w-3 h-3 text-slate-400 cursor-help" />
                                                            </Tooltip>
                                                        </label>
                                                        <input
                                                            type="number" min="0" max="100"
                                                            value={aliquotaIcms}
                                                            onChange={e => { setAliquotaIcms(e.target.value); if (validationErrors.aliquotaIcms) setValidationErrors({ ...validationErrors, aliquotaIcms: '' }); }}
                                                            className='w-full p-2 text-sm rounded-lg font-normal outline-none' style={{background:'rgba(255,255,255,0.04)',border:validationErrors.aliquotaIcms?'1px solid #FF4466':'1px solid rgba(200,208,255,0.1)',color:'#F5F6FF'}}
                                                            placeholder="0.00"
                                                        />
                                                        {validationErrors.aliquotaIcms && <p className="text-[10px] text-red-500 mt-1">{validationErrors.aliquotaIcms}</p>}
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium uppercase flex items-center gap-1 mb-1.5" style={{color:"rgba(200,208,255,0.4)"}}>
                                                            PIS/COFINS (%)
                                                            <Tooltip content="Alíquota combinada.">
                                                                <InfoIcon className="w-3 h-3 text-slate-400 cursor-help" />
                                                            </Tooltip>
                                                        </label>
                                                        <input
                                                            type="number" min="0" max="100"
                                                            value={aliquotaPisCofins}
                                                            onChange={e => { setAliquotaPisCofins(e.target.value); if (validationErrors.aliquotaPisCofins) setValidationErrors({ ...validationErrors, aliquotaPisCofins: '' }); }}
                                                            className='w-full p-2 text-sm rounded-lg font-normal outline-none' style={{background:'rgba(255,255,255,0.04)',border:validationErrors.aliquotaPisCofins?'1px solid #FF4466':'1px solid rgba(200,208,255,0.1)',color:'#F5F6FF'}}
                                                            placeholder="0.00"
                                                        />
                                                        {validationErrors.aliquotaPisCofins && <p className="text-[10px] text-red-500 mt-1">{validationErrors.aliquotaPisCofins}</p>}
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium uppercase flex items-center gap-1 mb-1.5" style={{color:"rgba(200,208,255,0.4)"}}>
                                                            ISS (%)
                                                            <Tooltip content="Alíquota do ISS.">
                                                                <InfoIcon className="w-3 h-3 text-slate-400 cursor-help" />
                                                            </Tooltip>
                                                        </label>
                                                        <input
                                                            type="number" min="0" max="100"
                                                            value={aliquotaIss}
                                                            onChange={e => { setAliquotaIss(e.target.value); if (validationErrors.aliquotaIss) setValidationErrors({ ...validationErrors, aliquotaIss: '' }); }}
                                                            className='w-full p-2 text-sm rounded-lg font-normal outline-none' style={{background:'rgba(255,255,255,0.04)',border:validationErrors.aliquotaIss?'1px solid #FF4466':'1px solid rgba(200,208,255,0.1)',color:'#F5F6FF'}}
                                                            placeholder="0.00"
                                                        />
                                                        {validationErrors.aliquotaIss && <p className="text-[10px] text-red-500 mt-1">{validationErrors.aliquotaIss}</p>}
                                                    </div>
                                                </div>
                                            </div>

                                            {searchType === SearchType.SERVICO && (
                                                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl" style={{background:"rgba(8,0,122,0.06)",border:"1px solid rgba(200,208,255,0.07)"}}>
                                                    <div>
                                                        <label className="text-xs font-medium uppercase" style={{color:"rgba(200,208,255,0.4)"}}>Município Prestador</label>
                                                        <input type="text" value={municipio} onChange={e => setMunicipio(e.target.value)} className="w-full mt-1 p-2 text-sm rounded-lg font-normal" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(200,208,255,0.1)",color:"#F5F6FF"}} placeholder="Ex: São Paulo" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium uppercase" style={{color:"rgba(200,208,255,0.4)"}}>Tomador (Opcional)</label>
                                                        <input type="text" value={alias} onChange={e => setAlias(e.target.value)} className="w-full mt-1 p-2 text-sm rounded-lg font-normal" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(200,208,255,0.1)",color:"#F5F6FF"}} placeholder="Ex: Empresa X" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium uppercase" style={{color:"rgba(200,208,255,0.4)"}}>Regime (Opcional)</label>
                                                        <select value={regimeTributario} onChange={e => setRegimeTributario(e.target.value)} className="w-full mt-1 p-2 text-sm rounded-lg font-normal" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(200,208,255,0.1)",color:"#F5F6FF"}}>
                                                            <option value="">Selecione</option>
                                                            <option value="simples">Simples Nacional</option>
                                                            <option value="lucro_presumido">Lucro Presumido</option>
                                                            <option value="lucro_real">Lucro Real</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {/* Reforma Tributária View */}
                        {searchType === SearchType.REFORMA_TRIBUTARIA && (
                            <div className="p-6 rounded-xl mb-6 animate-fade-in" style={{background:"rgba(8,0,122,0.08)",border:"1px solid rgba(200,208,255,0.08)"}}>
                                <div className="flex flex-col md:flex-row gap-4">
                                    <div className="flex-grow">
                                        <input
                                            type="text"
                                            value={reformaQuery}
                                            onChange={(e) => setReformaQuery(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleReformaSearch(reformaQuery)}
                                            placeholder="Digite o CNAE ou descrição da atividade..."
                                            className='w-full pl-4 pr-4 py-3 rounded-lg outline-none font-normal' style={{background:'rgba(255,255,255,0.04)',border:validationErrors.reformaQuery?'1px solid #FF4466':'1px solid rgba(200,208,255,0.1)',color:'#F5F6FF'}}
                                            aria-label="Busca Reforma Tributária"
                                        />
                                        {validationErrors.reformaQuery && <p className="text-xs text-red-500 mt-1">{validationErrors.reformaQuery}</p>}
                                    </div>
                                    <button
                                        onClick={() => handleReformaSearch(reformaQuery)}
                                        disabled={isLoading}
                                        className="btn-press px-6 py-3 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-w-[120px]" style={{background:"#1400FF"}}
                                    >
                                        {isLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span>Analisar Impacto</span>}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Simples Nacional Views */}
                        {searchType === SearchType.SIMPLES_NACIONAL && (
                            <Suspense fallback={<LoadingSpinner />}>
                                {simplesView === 'dashboard' && (
                                    <SimplesNacionalDashboard
                                        empresas={simplesEmpresas}
                                        notas={simplesNotas}
                                        onSelectEmpresa={(id, view) => { setSelectedSimplesEmpresaId(id); setSimplesView(view); }}
                                        onAddNew={() => { setSimplesEmpresaToEdit(null); setSimplesView('nova'); }}
                                        onEdit={(empresa) => { setSimplesEmpresaToEdit(empresa); setSimplesView('nova'); }}
                                        onShowToast={(msg) => setToastMessage(msg)}
                                        currentUser={currentUser}
                                    />
                                )}
                                {simplesView === 'nova' && (
                                    <SimplesNacionalNovaEmpresa
                                        onSave={handleSaveSimplesEmpresa}
                                        onCancel={() => { setSimplesView('dashboard'); setSimplesEmpresaToEdit(null); }}
                                        onShowToast={(msg) => setToastMessage(msg)}
                                        initialData={simplesEmpresaToEdit}
                                    />
                                )}
                                {simplesView === 'detalhe' && selectedEmpresa && (
                                    <SimplesNacionalDetalhe
                                        empresa={selectedEmpresa}
                                        notas={simplesNotas[selectedEmpresa.id] || []}
                                        onBack={() => setSimplesView('dashboard')}
                                        onImport={handleImportNotas}
                                        onUpdateFolha12={handleUpdateFolha12}
                                        onSaveFaturamentoManual={handleSaveFaturamentoManual}
                                        onUpdateEmpresa={handleUpdateEmpresa}
                                        onShowClienteView={() => setSimplesView('cliente')}
                                        onShowToast={(msg) => setToastMessage(msg)}
                                        currentUser={currentUser}
                                    />
                                )}
                                {simplesView === 'cliente' && selectedEmpresa && (
                                    <SimplesNacionalClienteView
                                        empresa={selectedEmpresa}
                                        notas={simplesNotas[selectedEmpresa.id] || []}
                                        onBack={() => setSimplesView('dashboard')}
                                    />
                                )}
                            </Suspense>
                        )}

                        {/* Lucro Presumido View */}
                        {searchType === SearchType.LUCRO_PRESUMIDO_REAL && (
                            <Suspense fallback={<LoadingSpinner />}>
                                <LucroPresumidoRealDashboard
                                    currentUser={currentUser}
                                    externalSelectedId={selectedLucroEmpresaId}
                                    onAddToHistory={addHistory}
                                />
                            </Suspense>
                        )}

                        {/* Fiscal Obligations View */}
                        {searchType === SearchType.OBRIGACOES_FISCAIS && (
                            <FiscalObligationsDashboard />
                        )}

                        {/* Importa XML View */}
                        {searchType === SearchType.IMPORTA_XML && (
                            <Suspense fallback={<LoadingSpinner />}>
                                <ImportaXML
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                        )}

                {\/* Analisador de Regime Tributario *\/}
                {searchType === SearchType.ANALISADOR_REGIME && (
                  <Suspense fallback={<LoadingSpinner />}>
                    <AnalisadorRegime />
                  </Suspense>
                )}

                        {/* Results Display */}
                        <Suspense fallback={<LoadingSpinner />}>
                            {!result && !comparisonResult && ![SearchType.SIMPLES_NACIONAL, SearchType.LUCRO_PRESUMIDO_REAL, SearchType.OBRIGACOES_FISCAIS, SearchType.IMPORTA_XML].includes(searchType) && (
                                <InitialStateDisplay searchType={searchType} mode={mode} />
                            )}

                            {comparisonResult && (
                                <ComparisonDisplay result={comparisonResult} />
                            )}

                            {result && searchType === SearchType.REFORMA_TRIBUTARIA && (
                                <ReformaResultDisplay
                                    result={result}
                                    isFavorite={isFavorite}
                                    onToggleFavorite={handleToggleFavorite}
                                />
                            )}

                            {(result || error) && searchType !== SearchType.REFORMA_TRIBUTARIA && (
                                <ResultsDisplay
                                    result={result}
                                    error={error}
                                    onStartCompare={() => { setMode('compare'); setQuery2(''); }}
                                    isFavorite={isFavorite}
                                    onToggleFavorite={handleToggleFavorite}
                                    onError={(msg) => setError(msg)}
                                    searchType={searchType}
                                    onFindSimilar={handleFindSimilar}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            )}
                        </Suspense>

                        <SimilarServicesDisplay
                            services={similarServices}
                            isLoading={isLoadingSimilar}
                            error={errorSimilar}
                            onSelectService={(code) => { setQuery1(code); handleSearch(code); }}
                        />

                        {[SearchType.CFOP, SearchType.NCM, SearchType.SERVICO, SearchType.REFORMA_TRIBUTARIA, SearchType.SIMPLES_NACIONAL, SearchType.LUCRO_PRESUMIDO_REAL].includes(searchType) && !result && (
                            <PopularSuggestions searchType={searchType} onSelect={(code) => {
                                if (searchType === SearchType.REFORMA_TRIBUTARIA) setReformaQuery(code);
                                else setQuery1(code);
                            }} />
                        )}

                        {![SearchType.SIMPLES_NACIONAL, SearchType.LUCRO_PRESUMIDO_REAL, SearchType.OBRIGACOES_FISCAIS, SearchType.IMPORTA_XML].includes(searchType) && (
                            searchType === SearchType.REFORMA_TRIBUTARIA ? <ReformaNews /> : <NewsAlerts />
                        )}

                        {(result && (searchType === SearchType.SIMPLES_NACIONAL || searchType === SearchType.LUCRO_PRESUMIDO_REAL)) || (searchType !== SearchType.SIMPLES_NACIONAL && searchType !== SearchType.LUCRO_PRESUMIDO_REAL) ? (
                            <TaxAlerts results={result ? [result] : []} searchType={searchType} />
                        ) : null}
                    </main>

                    {/* Sidebar */}
                    <FavoritesSidebar
                        favorites={favorites}
                        onFavoriteRemove={saveFavorites}
                        onFavoriteSelect={handleSelectFavorite}
                        history={history}
                        onHistorySelect={handleSelectHistoryItem}
                        onHistoryRemove={handleHistoryRemove}
                        onHistoryClear={handleHistoryClear}
                        isOpen={isSidebarOpen}
                        onClose={() => setIsSidebarOpen(false)}
                    />
                </div>
                <Footer />
            </div>

            {/* Global Toast Notification */}
            {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}

            {/* Modals */}
            <AccessLogsModal isOpen={isLogsModalOpen} onClose={() => setIsLogsModalOpen(false)} />
            <UserManagementModal
                isOpen={isUsersModalOpen}
                onClose={() => setIsUsersModalOpen(false)}
                currentUserEmail={currentUser.email}
            />
        </div>
    );
};

export default App;
