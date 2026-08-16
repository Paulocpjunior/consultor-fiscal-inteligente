import React, { useState, useCallback, useRef, useEffect, useMemo, Suspense, lazy } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import LoadingSpinner from './components/LoadingSpinner';
import Logo from './components/Logo';
import ErrorBoundary from './components/ErrorBoundary';
import LoginScreen from './components/LoginScreen';
import { useConfirm } from './components/dialog/DialogProvider';
import UpdateBanner from './components/UpdateBanner';
import TaxAlerts from './components/TaxAlerts';
import NewsAlerts from './components/NewsAlerts';
import ReformaNews from './components/ReformaNews';
import FavoritesSidebar from './components/FavoritesSidebar';
import SimplesNacionalSection from './components/sections/SimplesNacionalSection';
import MenuPrincipal from './components/sections/MenuPrincipal';
import InitialStateDisplay from './components/InitialStateDisplay';
import SimilarServicesDisplay from './components/SimilarServicesDisplay';
import AccessLogsModal from './components/AccessLogsModal';
import UserManagementModal from './components/UserManagementModal';
import ConfigAdminModal from './components/ConfigAdminModal';
import { PopularSuggestions } from './components/PopularSuggestions';
import Tooltip from './components/Tooltip';
import Toast from './components/Toast';
import { SearchType, type SearchResult, type ComparisonResult, type FavoriteItem, type HistoryItem, type SimilarService, SimplesNacionalEmpresa, SimplesNacionalNota, SimplesNacionalAnexo, SimplesNacionalImportResult, SimplesNacionalAtividade, User } from './types';
import { fetchFiscalData, fetchComparison, fetchSimilarServices } from './services/geminiService';
import * as simplesService from './services/simplesNacionalService';
import * as authService from './services/authService';
import { InfoIcon, SearchIcon, CalculatorIcon } from './components/Icons';
import { MENU_GRUPOS, searchDescriptions } from './config/menuConfig';
import { getFriendlyErrorMessage } from './services/errorTranslation';
// (FiscalObligationsDashboard, Tarefas, CalendarioFiscal agora dentro de ObrigacoesETarefas)
import { runInitialSync } from './services/cloudSyncService';
import { requestNotificationPermission } from './services/notificacoesService';
import { safeStorage } from './services/safeStorage';
import { resolverModuloDeepLink } from './services/moduloDeepLink';
import {
    lerEmpresaAtiva, gravarEmpresaAtiva, limparEmpresaAtiva, exigeEmpresaAtiva,
    rotuloEmpresaAtiva, fmtCnpjAtiva, type EmpresaAtiva,
} from './services/empresaAtiva';
import AtivarEmpresaScreen from './components/AtivarEmpresaScreen';
import { EmpresaAtivaProvider } from './services/empresaAtivaContext';
// ✅ REMOVIDO: import { auth, isFirebaseConfigured } from './services/firebaseConfig';
// ✅ REMOVIDO: import { onAuthStateChanged } from 'firebase/auth';
// Ambos encapsulados em authService.subscribeAuthState

const ResultsDisplay = lazy(() => import('./components/ResultsDisplay'));
const ComparisonDisplay = lazy(() => import('./components/ComparisonDisplay'));
const ReformaResultDisplay = lazy(() => import('./components/ReformaResultDisplay'));
const LucroPresumidoRealDashboard = lazy(() => import('./components/LucroPresumidoRealDashboard'));
const AnaliseCreditos = lazy(() => import('./components/AnaliseCreditos'));
// VencimentosHub funde Obrigações&Tarefas + Minha Agenda + Vencimentos da
// Semana num só card (mesmo grupo: prazos derivados do regime/cadastro).
const VencimentosHub = lazy(() => import('./components/Vencimentos/VencimentosHub'));
const CentralDocumentosFiscais = lazy(() => import('./components/xml/CentralDocumentosFiscais'));
const RotinaFiscalPainel = lazy(() => import('./components/RotinaFiscalPainel'));
const SpedFiscal = lazy(() => import('./components/SpedFiscal'));
const NftsSp = lazy(() => import('./components/Nfts'));
const AnaliseRelatorioSAGE = lazy(() => import('./components/AnaliseRelatorioSAGE'));
const AnalisadorRegime = lazy(() => import('./components/AnalisadorRegime'));
// Hubs que fundem cada gênero num só card (sub-abas internas):
//  - CaixaPostalHub: Caixa Postal + Radar e-CAC
//  - DasHub: DAS + Cobertura PGDAS-D + Sublimite
//  - NfseNacionalHub: NFS-e Nacional + Cobertura ADN
//  - RecuperacaoHub: Recuperação Tributária + Prazos de Prescrição
const CaixaPostalHub = lazy(() => import('./components/CaixaPostal/CaixaPostalHub'));
const CaixaPostalAlerta = lazy(() => import('./components/CaixaPostal/AlertaPopup'));
const CronCapturaBanner = lazy(() => import('./components/CronCapturaBanner'));
const VencimentosBanner = lazy(() => import('./components/VencimentosBanner'));
// Countdown pro marco CBS/IBS (Reforma Tributária) — 01/08/2026.
const ReformaCountdownBanner = lazy(() => import('./components/ReformaCountdownBanner'));
const DasHub = lazy(() => import('./components/Das/DasHub'));
// DctfwebHub funde DCTFWeb + EFD-Reinf×DCTFWeb + Cobertura DCTFWeb num só card.
const DctfwebHub = lazy(() => import('./components/DCTFWeb/DctfwebHub'));
// Hub que funde as 6 abas de diagnóstico (Saúde/Docs/Cadastros/Certificados/
// Config/Anomalias) num só card com sub-abas internas. Os 6 painéis são
// importados DENTRO do hub agora — não mais soltos aqui.
const DiagnosticoHub = lazy(() => import('./components/Diagnostico/DiagnosticoHub'));
const CarteiraDashboard = lazy(() => import('./components/Carteira'));
const RelatoriosHub = lazy(() => import('./components/Relatorios'));
const SpConnect = lazy(() => import('./components/SpConnect'));

// /connect é o app SP CONNECT (substituto da Ultra Fox, vive no Teams) — a
// mesma SPA, outra casa. Decidido no load: trocar de app é trocar de URL.
const MODO_SP_CONNECT = typeof window !== 'undefined' && window.location.pathname.startsWith('/connect');
const AgentesA3Dashboard = lazy(() => import('./components/AgentesA3'));
const NfseNacionalHub = lazy(() => import('./components/NfseNacional/NfseNacionalHub'));
const DashboardCeo = lazy(() => import('./components/DashboardCeo'));
// AnomaliasView agora vive dentro do DiagnosticoHub (sub-aba).
const SimuladorReforma = lazy(() => import('./components/SimuladorReforma'));
const TaxEmissionDashboard = lazy(() => import('./components/TaxEmission'));
const RecuperacaoHub = lazy(() => import('./components/RecuperacaoTributaria/RecuperacaoHub'));
const NfpProCloud = lazy(() => import('./components/NfpProCloud'));
const GiaStPanel = lazy(() => import('./components/GiaSt/GiaStPanel'));


const App: React.FC = () => {
    const confirm = useConfirm();
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        if (typeof window !== 'undefined') {
            const stored = safeStorage.getItem('theme');
            const preferDark = stored == null && window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (stored === 'dark' || preferDark) {
                document.documentElement.classList.add('dark');
                return 'dark';
            }
        }
        document.documentElement.classList.remove('dark');
        return 'light';
    });

    // Auth State
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    // Enquanto o Firebase restaura a sessão persistida (onAuthStateChanged é
    // assíncrono), currentUser ainda é null — sem esta flag a tela de login
    // piscava, o navegador disparava o autofill de senha nela e o popup ficava
    // "flutuando" sobre o app depois do auto-login.
    const [isAuthResolved, setIsAuthResolved] = useState(false);
    const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
    const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);
    const [isConfigAdminOpen, setIsConfigAdminOpen] = useState(false);

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

    // Simples Nacional State
    const [simplesView, setSimplesView] = useState<'dashboard' | 'detalhe' | 'nova' | 'cliente'>('dashboard');
    const [simplesEmpresas, setSimplesEmpresas] = useState<SimplesNacionalEmpresa[]>([]);
    const [simplesNotas, setSimplesNotas] = useState<Record<string, SimplesNacionalNota[]>>({});
    const [selectedSimplesEmpresaId, setSelectedSimplesEmpresaId] = useState<string | null>(null);
    const [simplesEmpresaToEdit, setSimplesEmpresaToEdit] = useState<SimplesNacionalEmpresa | null>(null);

    // Lucro Presumido/Real State (ID para navegação via histórico)
    const [selectedLucroEmpresaId, setSelectedLucroEmpresaId] = useState<string | null>(null);
    // ─── EMPRESA ATIVA — o escopo da sessão, não um filtro de tela ──────────
    //
    // Paulo, 15/08: *"login colaborador → ATIVAR EMPRESA. Ativar empresa é o
    // que determina o que a pessoa vai ou não fazer."* Ela mora AQUI, no topo,
    // porque é da sessão inteira — cada painel com o seu seletor foi
    // exatamente o que ele apontou como errado.
    const [empresaAtiva, setEmpresaAtiva] = useState<EmpresaAtiva | null>(null);
    const [trocandoEmpresa, setTrocandoEmpresa] = useState(false);
    // Entrou SEM ativar, só para consultas de tabela. A incongruência que o
    // Paulo pegou: a tela dizia "consulta não precisa de empresa" e o portão
    // barrava tudo. A exceção precisa de PORTA, não só de frase.
    const [soConsultas, setSoConsultas] = useState(false);

    /**
     * ═══ ATIVAR EMPRESA É O PRIMEIRO PASSO — e antes dele o banco fica quieto ══
     *
     * Paulo, 14/08: *"Ativar Empresa é o primeiro passo do colaborador, é isso
     * que define o que ele pode ou não fazer e em qual empresa; além disso não
     * carregamos nenhuma informação do banco de dados até que o colaborador
     * ative a empresa, ganhamos tempo e agilidade"*.
     *
     * O que este carregamento fazia: `getAllNotas` = `fetchAllDocs('simples_notas')`,
     * **todas as notas de TODAS as empresas da casa**, em toda entrada no
     * painel. Quem ia mexer em UMA empresa pagava a espera de ~400 — e o
     * cadastro das empresas, que é o que a busca precisa, é leve.
     *
     * Agora entra só o CADASTRO. As notas de cada empresa chegam quando ela é
     * ATIVADA (`carregarNotasDaEmpresa`), que é o momento em que se sabe de qual
     * empresa é o trabalho.
     */
    const loadSimplesData = async (user?: User | null) => {
        const targetUser = user || currentUser;
        if (!targetUser) return;
        try {
            setSimplesEmpresas(await simplesService.getEmpresas(targetUser));
        } catch (e) {
            console.error("Erro ao carregar dados do Simples", e);
        }
    };

    /**
     * As notas de UMA empresa, na ativação.
     *
     * Guarda por empresa: reativar a mesma não repete a leitura. `force` existe
     * para depois de importar/alterar, quando o que está em memória ficou velho.
     */
    const carregarNotasDaEmpresa = useCallback(async (empresaId: string, force = false) => {
        const id = String(empresaId || '').trim();
        if (!id) return;
        if (!force && simplesNotas[id]) return;
        try {
            const notas = await simplesService.getNotasDaEmpresa(id, currentUser);
            setSimplesNotas(prev => ({ ...prev, [id]: notas }));
        } catch (e) {
            console.error("Erro ao carregar as notas da empresa", e);
        }
    }, [currentUser, simplesNotas]);

    // ✅ ALTERADO: usa subscribeAuthState em vez de onAuthStateChanged manual.
    // O listener dispara imediatamente com o usuário atual (ou null),
    // sincroniza automaticamente em qualquer dispositivo sem relogar.
    useEffect(() => {
        try {
            setFavorites(safeStorage.getJSON<FavoriteItem[]>('fiscal-consultant-favorites', []));
            setHistory(safeStorage.getJSON<HistoryItem[]>('fiscal-consultant-history', []));

            const unsubscribe = authService.subscribeAuthState((user) => {
                setCurrentUser(user);
                setIsAuthResolved(true);
                if (user) {
                    loadSimplesData(user);
                    runInitialSync(user); // fire-and-forget: sync localStorage -> Firestore
                    requestNotificationPermission(); // fire-and-forget: pede permissão push
                }
            });

            return () => unsubscribe();
        } catch (e) {
            console.error("Initialization error", e);
            setIsAuthResolved(true); // não deixa o app preso no splash em caso de erro
        }
    }, []);

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            safeStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            safeStorage.setItem('theme', 'light');
        }
    }, [theme]);

    // Deep-link ?modulo=<slug> — URL fixa por app (ex.: /?modulo=legalizacao).
    // Só seleciona o card depois do login resolvido; o gate de acesso do menu
    // e do backend continuam valendo.
    useEffect(() => {
        if (!isAuthResolved || !currentUser) return;
        const tipo = resolverModuloDeepLink(window.location.search);
        if (tipo) setSearchType(tipo);
    }, [isAuthResolved, currentUser]);

    const handleLoginSuccess = (user: User) => {
        setCurrentUser(user);
        loadSimplesData(user);
        requestNotificationPermission(); // fire-and-forget: pede permissão push
    };

    const handleLogout = () => {
        // SAIR LIMPA A ATIVAÇÃO: a sequência começa no login (Paulo, 15/08 —
        // "o começo de tudo é com a sequência: login → ATIVAR EMPRESA").
        limparEmpresaAtiva(currentUser?.id);
        setEmpresaAtiva(null);
        authService.logout();
        setCurrentUser(null);
        setSimplesEmpresas([]);
    };

    /**
     * ATIVAR = TROCAR DE CLIENTE, e por isso LIMPA o que estava carregado.
     *
     * Dado de um cliente aparecendo na tela de outro é o pior erro possível
     * neste app — e é silencioso. Trocar zera a seleção dos painéis e volta
     * ao menu, em vez de deixar a tela anterior com os números do cliente que
     * acabou de sair de cena.
     */
    const ativarEmpresa = (e: EmpresaAtiva) => {
        if (currentUser?.id) gravarEmpresaAtiva(currentUser.id, e);
        setEmpresaAtiva(e);
        setTrocandoEmpresa(false);
        setSelectedSimplesEmpresaId(e.fonte === 'simples' ? e.id : null);
        setSelectedLucroEmpresaId(e.fonte === 'lucro' ? e.id : null);
        setResult(null);
        setError(null);
    };

    // Recarregar a página NÃO desativa: punir o F5 não protege ninguém. Quem
    // desativa é o LOGOUT, que é onde a sequência recomeça.
    useEffect(() => {
        if (!currentUser?.id) { setEmpresaAtiva(null); return; }
        setEmpresaAtiva(lerEmpresaAtiva(currentUser.id));
    }, [currentUser?.id]);

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
        safeStorage.setJSON('fiscal-consultant-history', newHistory);
    };

    const handleHistoryClear = () => {
        setHistory([]);
        safeStorage.removeItem('fiscal-consultant-history');
    };

    const addHistory = (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
        const newHistoryItem: HistoryItem = {
            ...item,
            id: Date.now().toString(),
            timestamp: Date.now(),
        };
        setHistory(prev => {
            const updatedHistory = [newHistoryItem, ...prev].slice(0, 50);
            safeStorage.setJSON('fiscal-consultant-history', updatedHistory);
            return updatedHistory;
        });
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
        safeStorage.setJSON('fiscal-consultant-favorites', newFavorites);
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
    const handleSaveSimplesEmpresa = async (nome: string, cnpj: string, cnae: string, anexo: any, atividadesSecundarias?: any[], dataAbertura?: string) => {
        if (!currentUser) return;

        if (simplesEmpresaToEdit) {
            const finalAnexo = anexo === 'auto' ? simplesService.sugerirAnexoPorCnae(cnae) : anexo;
            const dataToUpdate: Partial<SimplesNacionalEmpresa> = {
                nome, cnpj, cnae, anexo: finalAnexo, atividadesSecundarias: atividadesSecundarias || [],
                dataAbertura: dataAbertura || undefined,
            };

            await simplesService.updateEmpresa(simplesEmpresaToEdit.id, dataToUpdate);
            setSimplesEmpresas(prev => prev.map(e => e.id === simplesEmpresaToEdit.id ? { ...e, ...dataToUpdate } : e));
            setToastMessage("Empresa atualizada com sucesso!");
        } else {
            try {
                const newEmpresa = await simplesService.saveEmpresa(nome, cnpj, cnae, anexo, atividadesSecundarias || [], currentUser.id, dataAbertura);
                setSimplesEmpresas(prev => [...prev, newEmpresa]);
                if (currentUser) authService.logAction(currentUser.id, currentUser.name, 'create_empresa', nome);
                setToastMessage("Empresa cadastrada com sucesso!");

                addHistory({
                    queries: [nome],
                    type: SearchType.SIMPLES_NACIONAL,
                    mode: 'single',
                    entityId: newEmpresa.id
                });
            } catch (err: any) {
                // Erro de CNPJ duplicado ou outra falha de save
                setToastMessage(err?.message || 'Erro ao cadastrar empresa.');
                return;  // nao fecha o form — usuario pode corrigir
            }
        }
        setSimplesView('dashboard');
        setSimplesEmpresaToEdit(null);
    };

    const handleImportNotas = async (empresaId: string, file: File): Promise<SimplesNacionalImportResult> => {
        try {
            const result = await simplesService.parseAndSaveNotas(empresaId, file);
            if (currentUser) {
                // Só o cadastro e as notas DESTA empresa: importar numa empresa
                // não é motivo para reler o banco inteiro.
                setSimplesEmpresas(await simplesService.getEmpresas(currentUser));
                await carregarNotasDaEmpresa(empresaId, true);
            }
            if (result.faturamentoManual) {
                setSimplesEmpresas(prev => prev.map(e =>
                    e.id === empresaId ? { ...e, faturamentoManual: result.faturamentoManual } : e
                ));
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

    // Splash enquanto a sessão persistida é restaurada: renderizar o LoginScreen
    // aqui fazia o form piscar e o gerenciador de senhas do navegador abrir o
    // autofill sobre uma tela que já ia sumir (auto-login sem confirmação).
    if (!isAuthResolved) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{background:"var(--bg-page)"}}>
                <Logo className="h-20 w-auto" />
                <LoadingSpinner />
                <p className="text-sm" style={{color:"var(--text-muted)"}}>Verificando sessão…</p>
            </div>
        );
    }

    if (!currentUser) {
        return (
            <>
                <LoginScreen onLoginSuccess={handleLoginSuccess} />
                <div className="fixed bottom-4 right-4 flex gap-2">
                    <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} className="p-2 bg-white dark:bg-slate-800 rounded-full shadow-lg" aria-label="Alternar tema claro/escuro">
                        {theme === 'light' ? '🌙' : '☀️'}
                    </button>
                </div>
                <UpdateBanner />
            </>
        );
    }

    // ─── 💬 SP CONNECT É APP PRÓPRIO, NÃO CARD (Paulo, 16/08) ───────────────
    //
    // O SP Connect substitui a Ultra Fox e vive no TEAMS — atendente do DP,
    // da Legalização e do RH nunca abre o CFI. Em /connect a MESMA SPA vira o
    // app SP Connect: login unificado, tela cheia, SEM menu do CFI e SEM o
    // portão de empresa ativa (conversa é da carteira toda, não de um
    // cliente). O motor continua neste serviço (credencial não trafega); o
    // que muda é a CASA do produto. A aba do Teams aponta pra <url>/connect.
    if (MODO_SP_CONNECT) {
        return (
            <ErrorBoundary modulo="SP Connect">
                <div className="min-h-screen" style={{ background: 'var(--bg-page)' }}>
                    <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="text-lg">💬</span>
                            <div className="min-w-0">
                                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100 leading-tight">SP Connect</p>
                                <p className="text-[10px] text-slate-400 leading-tight">WhatsApp API Oficial · +55 11 3337-1554</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="hidden sm:block text-[11px] text-slate-400 truncate max-w-[220px]">{currentUser.email}</span>
                            <button onClick={handleLogout} className="text-[11px] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Sair</button>
                        </div>
                    </header>
                    <main className="p-3 sm:p-4">
                        <Suspense fallback={<LoadingSpinner />}>
                            <SpConnect currentUser={currentUser} />
                        </Suspense>
                    </main>
                    <UpdateBanner />
                </div>
            </ErrorBoundary>
        );
    }

    // ─── O PORTÃO DA SEQUÊNCIA ──────────────────────────────────────────────
    //
    // login → ATIVAR EMPRESA → módulos. Sem empresa ativa a tela não é o menu:
    // é a ativação. Não adianta deixar entrar e responder vazio depois — isso
    // é justamente o que fazia cada módulo perguntar "qual empresa?" de novo.
    if (trocandoEmpresa || (!empresaAtiva && !soConsultas)) {
        return (
            <>
                <AtivarEmpresaScreen
                    currentUser={currentUser}
                    atual={empresaAtiva}
                    onAtivar={ativarEmpresa}
                    // Cancelar volta: para a empresa que já estava ativa, ou
                    // para o modo consulta de onde a pessoa veio.
                    onCancelar={(empresaAtiva || soConsultas) ? () => setTrocandoEmpresa(false) : undefined}
                    onSoConsultas={() => {
                        setSoConsultas(true);
                        setTrocandoEmpresa(false);
                        setSearchType(SearchType.CFOP);
                    }}
                />
                <UpdateBanner />
            </>
        );
    }

    const selectedEmpresa = simplesEmpresas.find(e => e.id === selectedSimplesEmpresaId);

    // Seleção de card do menu — reseta estado de busca e trata casos especiais
    // (Simples carrega dados; Lucro limpa empresa). Único handler pra todos os
    // cards (antes era repetido inline em cada botão).
    const selecionarTipo = (type: SearchType) => {
        setSearchType(type);
        setResult(null);
        setQuery1('');
        setQuery2('');
        setError(null);
        setValidationErrors({});
        setUserNotes('');
        // MÓDULO QUE TRABALHA SOBRE UM CLIENTE ABRE NA EMPRESA ATIVA.
        //
        // Era aqui que a sequência se perdia: entrar no card do Lucro fazia
        // `setSelectedLucroEmpresaId(null)` e devolvia a LISTA de ~400
        // empresas — como se a ativação não tivesse acontecido. Paulo, 15/08:
        // *"já começou errado ... ativar empresa é o que determina o que a
        // pessoa vai ou não fazer"*.
        //
        // Módulo de CARTEIRA (Rotina, Vencimentos, Dashboard) segue vendo o
        // conjunto: ele responde sobre o todo, e prendê-lo a um cliente seria
        // trocar um erro por outro. `exigeEmpresaAtiva` é quem separa os dois.
        const daEmpresaAtiva = exigeEmpresaAtiva(type);
        // No modo consulta, card que trabalha SOBRE um cliente pede a ativação
        // na hora do clique — o destino fica guardado e abre depois de ativar.
        if (daEmpresaAtiva && !empresaAtiva) {
            setSearchType(type);
            setTrocandoEmpresa(true);
            return;
        }
        if (type === SearchType.SIMPLES_NACIONAL) {
            setSimplesView('dashboard');
            setSimplesEmpresaToEdit(null);
            loadSimplesData(currentUser);
            setSelectedSimplesEmpresaId(
                daEmpresaAtiva && empresaAtiva?.fonte === 'simples' ? empresaAtiva.id : null,
            );
        }
        if (type === SearchType.LUCRO_PRESUMIDO_REAL) {
            setSelectedLucroEmpresaId(
                daEmpresaAtiva && empresaAtiva?.fonte === 'lucro' ? empresaAtiva.id : null,
            );
        }
    };

    /**
     * Rotina do Mês → tela da etapa. O painel diz ONDE o cliente parou; este
     * mapa é o que faz o "próximo passo" virar um clique só (e já abre a ficha
     * da empresa certa quando a etapa é a apuração).
     */
    const irParaEtapaDaRotina = (etapaId: string, empresa: { id?: string; regime?: string } | null) => {
        if (etapaId === 'captura' || etapaId === 'validacao') {
            selecionarTipo(SearchType.IMPORTA_XML);
            return;
        }
        if (etapaId === 'apuracao') {
            if (empresa?.regime === 'simples') {
                selecionarTipo(SearchType.SIMPLES_NACIONAL);
                if (empresa?.id) setSelectedSimplesEmpresaId(empresa.id);
            } else {
                selecionarTipo(SearchType.LUCRO_PRESUMIDO_REAL);
                if (empresa?.id) setSelectedLucroEmpresaId(empresa.id);
            }
            return;
        }
        selecionarTipo(SearchType.OBRIGACOES_FISCAIS); // obrigações e guias (rito)
    };

    return (
      <EmpresaAtivaProvider empresa={empresaAtiva} onTrocar={() => setTrocandoEmpresa(true)} onAtivar={ativarEmpresa}>
        <div className="min-h-screen transition-colors bg-slate-50 dark:bg-[var(--bg-page)]" style={{fontFamily:"'DM Sans',sans-serif"}}>
            <div className="container mx-auto px-4 max-w-screen-2xl">
                <Header
                    theme={theme}
                    toggleTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
                    onMenuClick={() => setIsSidebarOpen(true)}
                    description={searchDescriptions[searchType]}
                    user={currentUser}
                    onLogout={handleLogout}
                    onShowLogs={currentUser.role === 'admin' ? () => setIsLogsModalOpen(true) : undefined}
                    onShowUsers={currentUser.role === 'admin' ? () => setIsUsersModalOpen(true) : undefined}
                    onShowConfigAdmin={currentUser.role === 'admin' ? () => setIsConfigAdminOpen(true) : undefined}
                />

                {/* ─── EM QUEM VOCÊ ESTÁ MEXENDO ─────────────────────────────
                    O escopo da sessão fica VISÍVEL o tempo todo. Sem isto, a
                    empresa ativa seria um estado invisível — e estado invisível
                    que decide onde o lançamento cai é como se lança no cliente
                    errado sem ninguém desconfiar. */}
                <div className="flex items-center gap-2 flex-wrap mb-3 px-3 py-2 rounded-lg"
                     style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-muted)' }}>
                        Empresa ativa
                    </span>
                    <span className="text-sm font-bold min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>
                        {rotuloEmpresaAtiva(empresaAtiva)}
                    </span>
                    {empresaAtiva && (
                        <>
                            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                                {fmtCnpjAtiva(empresaAtiva.cnpj)}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded"
                                  style={{ background: 'var(--bg-page)', color: 'var(--text-muted)' }}>
                                {empresaAtiva.fonte === 'simples' ? 'Simples Nacional' : 'Lucro Presumido/Real'}
                            </span>
                        </>
                    )}
                    {!empresaAtiva && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--bg-page)', color: 'var(--text-muted)' }}>
                            modo consulta — só tabelas e visões da carteira
                        </span>
                    )}
                    <button
                        onClick={() => setTrocandoEmpresa(true)}
                        className="btn-press ml-auto text-[11px] px-2.5 py-1 rounded-lg whitespace-nowrap"
                        style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                    >
                        {empresaAtiva ? '⇄ Trocar empresa' : '⚡ Ativar empresa'}
                    </button>
                </div>

                <div className="flex flex-col md:flex-row gap-6">
                    <main className="flex-grow min-w-0">
                        <ErrorBoundary modulo="App">
                            <Suspense fallback={null}>
                                <ReformaCountdownBanner
                                    onIrParaReforma={() => setSearchType(SearchType.SIMULADOR_IBS_CBS)}
                                />
                                <VencimentosBanner
                                    currentUser={currentUser}
                                    onClickIrTarefas={() => setSearchType(SearchType.OBRIGACOES_FISCAIS)}
                                />
                                <CronCapturaBanner currentUser={currentUser} onShowToast={(msg) => setToastMessage(msg)} />
                            </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary modulo="App">
                            <Suspense fallback={null}>
                                <CaixaPostalAlerta
                                    currentUser={currentUser}
                                    onIrParaCaixaPostal={() => setSearchType(SearchType.CAIXA_POSTAL)}
                                    onIrParaObrigacoes={() => setSearchType(SearchType.OBRIGACOES_FISCAIS)}
                                />
                            </Suspense>
                        </ErrorBoundary>
                        <MenuPrincipal
                            currentUser={currentUser}
                            searchType={searchType}
                            onSelecionar={selecionarTipo}
                        />

                        {/* Standard Search Views (CFOP, NCM, Serviço, Simples, Lucro, Obrigações) */}
                        {[SearchType.CFOP, SearchType.NCM, SearchType.SERVICO, SearchType.SIMPLES_NACIONAL, SearchType.LUCRO_PRESUMIDO_REAL, SearchType.OBRIGACOES_FISCAIS, SearchType.IMPORTA_XML].includes(searchType) && (
                            <>
                                <div className={`p-6 rounded-xl mb-6 animate-fade-in ${[SearchType.SIMPLES_NACIONAL, SearchType.LUCRO_PRESUMIDO_REAL, SearchType.OBRIGACOES_FISCAIS, SearchType.IMPORTA_XML].includes(searchType) ? 'hidden' : ''}`} style={{background:"var(--bg-elevated)",border:"1px solid var(--border-subtle)"}}>
                                    <div className="flex items-center gap-4 mb-4">
                                        <button
                                            onClick={() => setMode('single')}
                                            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors`} style={{background:mode==='single'?'var(--accent-soft)':'transparent',color:mode==='single'?'var(--accent)':'var(--text-muted)'}}
                                        >
                                            Consulta Individual
                                        </button>
                                        <button
                                            onClick={() => setMode('compare')}
                                            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors`} style={{background:mode==='compare'?'var(--accent-soft)':'transparent',color:mode==='compare'?'var(--accent)':'var(--text-muted)'}}
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
                                                className='w-full pl-10 pr-4 py-3 rounded-lg outline-none transition-all font-normal' style={{background:'var(--bg-card)',border:validationErrors.query1?'1px solid var(--danger)':'1px solid var(--border-default)',color:'var(--text-primary)'}}
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
                                                    className='w-full pl-10 pr-4 py-3 rounded-lg outline-none transition-all font-normal' style={{background:'var(--bg-card)',border:validationErrors.query2?'1px solid var(--danger)':'1px solid var(--border-default)',color:'var(--text-primary)'}}
                                                    aria-label="Segundo campo de busca para comparação"
                                                />
                                                {validationErrors.query2 && <p className="text-xs text-red-500 mt-1">{validationErrors.query2}</p>}
                                            </div>
                                        )}

                                        <button
                                            onClick={() => handleSearch(query1, query2)}
                                            disabled={isLoading}
                                            className="btn-press px-6 py-3 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 min-w-[120px]" style={{background:"var(--accent)"}}
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
                                        <div className="mt-6 pt-6" style={{borderTop:"1px solid var(--border-subtle)"}}>
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className="text-sm font-medium uppercase tracking-wider flex items-center gap-2" style={{color:"var(--text-secondary)"}}>
                                                    <CalculatorIcon className="w-4 h-4 text-sky-500" />
                                                    Contexto Adicional para IA
                                                </h3>
                                                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase" style={{background:"var(--accent-soft)",color:"var(--accent)"}}>Opcional</span>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                <div className="md:col-span-2">
                                                    <label className="text-xs font-medium uppercase flex items-center gap-1 mb-2" style={{color:"var(--text-muted)"}}>
                                                        Notas / Observações da Operação
                                                        <Tooltip content="Adicione contexto específico para a análise da IA.">
                                                            <InfoIcon className="w-3 h-3 text-slate-400 cursor-help" />
                                                        </Tooltip>
                                                    </label>
                                                    <textarea
                                                        value={userNotes}
                                                        onChange={(e) => setUserNotes(e.target.value)}
                                                        className="w-full p-3 text-sm rounded-xl font-normal resize-none h-[108px] outline-none transition-all" style={{background:"var(--bg-card)",border:"1px solid var(--border-default)",color:"var(--text-primary)"}}
                                                        placeholder="Ex: Operação com mercadoria sujeita a ST no destino, venda para consumidor final não contribuinte..."
                                                    />
                                                </div>

                                                <div className="space-y-4">
                                                    <div>
                                                        <label className="text-xs font-medium uppercase flex items-center gap-1 mb-1.5" style={{color:"var(--text-muted)"}}>
                                                            ICMS (%)
                                                            <Tooltip content="Alíquota do ICMS.">
                                                                <InfoIcon className="w-3 h-3 text-slate-400 cursor-help" />
                                                            </Tooltip>
                                                        </label>
                                                        <input
                                                            type="number" min="0" max="100"
                                                            value={aliquotaIcms}
                                                            onChange={e => { setAliquotaIcms(e.target.value); if (validationErrors.aliquotaIcms) setValidationErrors({ ...validationErrors, aliquotaIcms: '' }); }}
                                                            className='w-full p-2 text-sm rounded-lg font-normal outline-none' style={{background:'var(--bg-card)',border:validationErrors.aliquotaIcms?'1px solid var(--danger)':'1px solid var(--border-default)',color:'var(--text-primary)'}}
                                                            placeholder="0.00"
                                                        />
                                                        {validationErrors.aliquotaIcms && <p className="text-[10px] text-red-500 mt-1">{validationErrors.aliquotaIcms}</p>}
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium uppercase flex items-center gap-1 mb-1.5" style={{color:"var(--text-muted)"}}>
                                                            PIS/COFINS (%)
                                                            <Tooltip content="Alíquota combinada.">
                                                                <InfoIcon className="w-3 h-3 text-slate-400 cursor-help" />
                                                            </Tooltip>
                                                        </label>
                                                        <input
                                                            type="number" min="0" max="100"
                                                            value={aliquotaPisCofins}
                                                            onChange={e => { setAliquotaPisCofins(e.target.value); if (validationErrors.aliquotaPisCofins) setValidationErrors({ ...validationErrors, aliquotaPisCofins: '' }); }}
                                                            className='w-full p-2 text-sm rounded-lg font-normal outline-none' style={{background:'var(--bg-card)',border:validationErrors.aliquotaPisCofins?'1px solid var(--danger)':'1px solid var(--border-default)',color:'var(--text-primary)'}}
                                                            placeholder="0.00"
                                                        />
                                                        {validationErrors.aliquotaPisCofins && <p className="text-[10px] text-red-500 mt-1">{validationErrors.aliquotaPisCofins}</p>}
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium uppercase flex items-center gap-1 mb-1.5" style={{color:"var(--text-muted)"}}>
                                                            ISS (%)
                                                            <Tooltip content="Alíquota do ISS.">
                                                                <InfoIcon className="w-3 h-3 text-slate-400 cursor-help" />
                                                            </Tooltip>
                                                        </label>
                                                        <input
                                                            type="number" min="0" max="100"
                                                            value={aliquotaIss}
                                                            onChange={e => { setAliquotaIss(e.target.value); if (validationErrors.aliquotaIss) setValidationErrors({ ...validationErrors, aliquotaIss: '' }); }}
                                                            className='w-full p-2 text-sm rounded-lg font-normal outline-none' style={{background:'var(--bg-card)',border:validationErrors.aliquotaIss?'1px solid var(--danger)':'1px solid var(--border-default)',color:'var(--text-primary)'}}
                                                            placeholder="0.00"
                                                        />
                                                        {validationErrors.aliquotaIss && <p className="text-[10px] text-red-500 mt-1">{validationErrors.aliquotaIss}</p>}
                                                    </div>
                                                </div>
                                            </div>

                                            {searchType === SearchType.SERVICO && (
                                                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl" style={{background:"var(--bg-elevated)",border:"1px solid var(--border-subtle)"}}>
                                                    <div>
                                                        <label className="text-xs font-medium uppercase" style={{color:"var(--text-muted)"}}>Município Prestador</label>
                                                        <input type="text" value={municipio} onChange={e => setMunicipio(e.target.value)} className="w-full mt-1 p-2 text-sm rounded-lg font-normal" style={{background:"var(--bg-card)",border:"1px solid var(--border-default)",color:"var(--text-primary)"}} placeholder="Ex: São Paulo" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium uppercase" style={{color:"var(--text-muted)"}}>Tomador (Opcional)</label>
                                                        <input type="text" value={alias} onChange={e => setAlias(e.target.value)} className="w-full mt-1 p-2 text-sm rounded-lg font-normal" style={{background:"var(--bg-card)",border:"1px solid var(--border-default)",color:"var(--text-primary)"}} placeholder="Ex: Empresa X" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium uppercase" style={{color:"var(--text-muted)"}}>Regime (Opcional)</label>
                                                        <select value={regimeTributario} onChange={e => setRegimeTributario(e.target.value)} className="w-full mt-1 p-2 text-sm rounded-lg font-normal" style={{background:"var(--bg-card)",border:"1px solid var(--border-default)",color:"var(--text-primary)"}}>
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
                            <div className="p-6 rounded-xl mb-6 animate-fade-in" style={{background:"var(--bg-elevated)",border:"1px solid var(--border-subtle)"}}>
                                <div className="flex flex-col md:flex-row gap-4">
                                    <div className="flex-grow">
                                        <input
                                            type="text"
                                            value={reformaQuery}
                                            onChange={(e) => setReformaQuery(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleReformaSearch(reformaQuery)}
                                            placeholder="Digite o CNAE ou descrição da atividade..."
                                            className='w-full pl-4 pr-4 py-3 rounded-lg outline-none font-normal' style={{background:'var(--bg-card)',border:validationErrors.reformaQuery?'1px solid var(--danger)':'1px solid var(--border-default)',color:'var(--text-primary)'}}
                                            aria-label="Busca Reforma Tributária"
                                        />
                                        {validationErrors.reformaQuery && <p className="text-xs text-red-500 mt-1">{validationErrors.reformaQuery}</p>}
                                    </div>
                                    <button
                                        onClick={() => handleReformaSearch(reformaQuery)}
                                        disabled={isLoading}
                                        className="btn-press px-6 py-3 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-w-[120px]" style={{background:"var(--accent)"}}
                                    >
                                        {isLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span>Analisar Impacto</span>}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Simples Nacional Views */}
                        {searchType === SearchType.SIMPLES_NACIONAL && (
                            <SimplesNacionalSection
                                simplesView={simplesView}
                                setSimplesView={setSimplesView}
                                simplesEmpresas={simplesEmpresas}
                                setSimplesEmpresas={setSimplesEmpresas}
                                simplesNotas={simplesNotas}
                                selectedEmpresa={selectedEmpresa}
                                setSelectedSimplesEmpresaId={setSelectedSimplesEmpresaId}
                                onAtivarEmpresa={carregarNotasDaEmpresa}
                                simplesEmpresaToEdit={simplesEmpresaToEdit}
                                setSimplesEmpresaToEdit={setSimplesEmpresaToEdit}
                                currentUser={currentUser}
                                setToastMessage={setToastMessage}
                                onSaveSimplesEmpresa={handleSaveSimplesEmpresa}
                                onImportNotas={handleImportNotas}
                                onUpdateFolha12={handleUpdateFolha12}
                                onSaveFaturamentoManual={handleSaveFaturamentoManual}
                                onUpdateEmpresa={handleUpdateEmpresa}
                            />
                        )}

                        {/* Lucro Presumido View */}
                        {searchType === SearchType.LUCRO_PRESUMIDO_REAL && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <LucroPresumidoRealDashboard
                                    currentUser={currentUser}
                                    externalSelectedId={selectedLucroEmpresaId}
                                    onAddToHistory={addHistory}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* Obrigações & Tarefas (Dashboard + Kanban + Calendário) */}
                        {/* Vencimentos & Obrigações — hub que funde Obrigações&Tarefas +
                            Minha Agenda + Vencimentos da Semana (mesmo grupo: prazos
                            derivados do regime/cadastro de cada empresa). */}
                        {searchType === SearchType.OBRIGACOES_FISCAIS && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <VencimentosHub
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* Rotina do Mês — a linha do processo (captura → validação →
                            apuração → obrigações → guias), por cliente. */}
                        {searchType === SearchType.ROTINA_FISCAL && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <RotinaFiscalPainel onIrPara={irParaEtapaDaRotina} />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* Central de Documentos Fiscais (XML) */}
                        {searchType === SearchType.IMPORTA_XML && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <CentralDocumentosFiscais
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* Análise Relatório SAGE View */}
                        {searchType === SearchType.ANALISE_RELATORIO_SAGE && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <AnaliseRelatorioSAGE
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* SPED Fiscal (EFD ICMS/IPI) View */}
                        {searchType === SearchType.SPED_FISCAL && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <SpedFiscal
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* NFTS SP — Gerador de Lotes (Prefeitura de Sao Paulo) */}
                        {searchType === SearchType.NFTS_SP && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <NftsSp
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* Caixa Postal — hub que funde Caixa Postal + Radar e-CAC. */}
                        {searchType === SearchType.CAIXA_POSTAL && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <CaixaPostalHub
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* GIA-ST — guia do ICMS-ST a partir do Livro de ICMS Substituto (Office Fiscal). */}
                        {searchType === SearchType.GIA_ST && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <GiaStPanel
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* DAS Simples — hub que funde Painel DAS + Cobertura PGDAS-D + Sublimite. */}
                        {searchType === SearchType.DAS_SIMPLES && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <DasHub
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* DCTFWeb — hub que funde Painel + Cobertura + EFD-Reinf×DCTFWeb. */}
                        {searchType === SearchType.DCTFWEB && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <DctfwebHub
                                    currentUser={currentUser}
                                    onShowToast={setToastMessage}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* EFD_REINF agora é sub-aba do DctfwebHub. */}

                        {/* Sub-abas consolidadas em hubs:
                            NFSE_NAC_COBERTURA → NfseNacionalHub
                            DAS_COBERTURA_PGDAS + SIMPLES_SUBLIMITE → DasHub
                            DCTFWEB_COBERTURA → DctfwebHub
                            CAIXA_POSTAL_RADAR → CaixaPostalHub
                            MINHA_AGENDA + VENCIMENTOS_SEMANA → VencimentosHub
                            RECUPERACAO_PRAZOS → RecuperacaoHub
                            DIAGNOSTICO_DOCS/CADASTROS/CERT_MONITOR/CONFIG/ANOMALIAS → DiagnosticoHub */}

                        {searchType === SearchType.SAUDE_GERAL && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <DiagnosticoHub
                                    currentUser={currentUser}
                                    onShowToast={setToastMessage}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.CARTEIRA && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <CarteiraDashboard
                                    currentUser={currentUser}
                                    onShowToast={setToastMessage}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.AGENTES_A3 && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <AgentesA3Dashboard
                                    currentUser={currentUser}
                                    onShowToast={setToastMessage}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}


                        {/* NFS-e Nacional — hub que funde Painel + Cobertura ADN. */}
                        {searchType === SearchType.NFSE_NACIONAL && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <NfseNacionalHub
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.RELATORIOS && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <RelatoriosHub
                                    currentUser={currentUser ?? null}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.DASHBOARD_CEO && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <DashboardCeo
                                    currentUser={currentUser ?? null}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                    onNavigateTo={(target) => {
                                        if (target === 'caixa-postal') setSearchType(SearchType.CAIXA_POSTAL);
                                        else if (target === 'das') setSearchType(SearchType.DAS_SIMPLES);
                                        else if (target === 'nfse') setSearchType(SearchType.NFSE_NACIONAL);
                                        else if (target === 'apuracoes') setSearchType(SearchType.SIMPLES_NACIONAL);
                                    }}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* ANOMALIAS agora é sub-aba do DiagnosticoHub (card SAUDE_GERAL). */}

                        {searchType === SearchType.SIMULADOR_IBS_CBS && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <SimuladorReforma
                                    currentUser={currentUser ?? null}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.EMISSAO_TRIBUTOS && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <TaxEmissionDashboard
                                    currentUser={currentUser ?? null}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* Recuperação — hub que funde Recuperação Tributária + Prazos de Prescrição. */}
                        {searchType === SearchType.RECUPERACAO_TRIBUTARIA && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <RecuperacaoHub
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.NFP_PRO_CLOUD && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <NfpProCloud
                                    currentUser={currentUser ?? null}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                {/* Analisador de Regime Tributario */}
                {searchType === SearchType.ANALISADOR_REGIME && (
                  <ErrorBoundary modulo="App">
                  <Suspense fallback={<LoadingSpinner />}>
                    <AnalisadorRegime />
                  </Suspense>
                  </ErrorBoundary>
                )}

                        {/* Análise de Créditos Fiscais */}
                        {searchType === SearchType.ANALISE_CREDITOS && (
                            <ErrorBoundary modulo="App">
                            <Suspense fallback={<LoadingSpinner />}>
                                <AnaliseCreditos currentUser={currentUser ?? null} />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* Results Display */}
                        <ErrorBoundary modulo="App">
                        <Suspense fallback={<LoadingSpinner />}>
                            {/* InitialStateDisplay e o prompt "digite no campo de busca acima".
                                So faz sentido nas abas que TEM barra de busca (CFOP/NCM/Servico/
                                Reforma). Os demais SearchType sao dashboards com componente proprio
                                e renderizavam essa mensagem morta apontando pra uma busca inexistente
                                (allowlist em vez do antigo blocklist de 4 abas). */}
                            {!result && !comparisonResult && [SearchType.CFOP, SearchType.NCM, SearchType.SERVICO, SearchType.REFORMA_TRIBUTARIA].includes(searchType) && (
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
                        </ErrorBoundary>

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
                currentUserRole={currentUser.role}
            />
            <ConfigAdminModal
                isOpen={isConfigAdminOpen}
                onClose={() => setIsConfigAdminOpen(false)}
                onOpenUsers={() => setIsUsersModalOpen(true)}
            />

            {/* Aviso global de nova versão / hard refresh */}
            <UpdateBanner />
        </div>
      </EmpresaAtivaProvider>
    );
};

export default App;
