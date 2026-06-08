import React, { useState, useCallback, useRef, useEffect, useMemo, Suspense, lazy } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorBoundary from './components/ErrorBoundary';
import LoginScreen from './components/LoginScreen';
import { useConfirm } from './components/dialog/DialogProvider';
import UpdateBanner from './components/UpdateBanner';
import TaxAlerts from './components/TaxAlerts';
import NewsAlerts from './components/NewsAlerts';
import ReformaNews from './components/ReformaNews';
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
import { SearchType, type SearchResult, type ComparisonResult, type FavoriteItem, type HistoryItem, type SimilarService, SimplesNacionalEmpresa, SimplesNacionalNota, SimplesNacionalAnexo, SimplesNacionalImportResult, SimplesNacionalAtividade, User } from './types';
import { fetchFiscalData, fetchComparison, fetchSimilarServices } from './services/geminiService';
import * as simplesService from './services/simplesNacionalService';
import * as authService from './services/authService';
import { BuildingIcon, CalculatorIcon, DocumentTextIcon, SearchIcon, TagIcon, InfoIcon, CalendarIcon, DownloadIcon, ScaleIcon, ShieldIcon, BriefcaseIcon, UserGroupIcon, RocketIcon, GlobeIcon, NewspaperIcon, ChatBubbleIcon } from './components/Icons';
// (FiscalObligationsDashboard, Tarefas, CalendarioFiscal agora dentro de ObrigacoesETarefas)
import { runInitialSync } from './services/cloudSyncService';
import { requestNotificationPermission } from './services/notificacoesService';
// ✅ REMOVIDO: import { auth, isFirebaseConfigured } from './services/firebaseConfig';
// ✅ REMOVIDO: import { onAuthStateChanged } from 'firebase/auth';
// Ambos encapsulados em authService.subscribeAuthState

const SimplesNacionalDetalhe = lazy(() => import('./components/SimplesNacionalDetalhe'));
const SimplesNacionalClienteView = lazy(() => import('./components/SimplesNacionalClienteView'));
const ResultsDisplay = lazy(() => import('./components/ResultsDisplay'));
const ComparisonDisplay = lazy(() => import('./components/ComparisonDisplay'));
const ReformaResultDisplay = lazy(() => import('./components/ReformaResultDisplay'));
const LucroPresumidoRealDashboard = lazy(() => import('./components/LucroPresumidoRealDashboard'));
const AnaliseCreditos = lazy(() => import('./components/AnaliseCreditos'));
// VencimentosHub funde Obrigações&Tarefas + Minha Agenda + Vencimentos da
// Semana num só card (mesmo grupo: prazos derivados do regime/cadastro).
const VencimentosHub = lazy(() => import('./components/Vencimentos/VencimentosHub'));
const CentralDocumentosFiscais = lazy(() => import('./components/xml/CentralDocumentosFiscais'));
const SpedFiscal = lazy(() => import('./components/SpedFiscal'));
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
const AgentesA3Dashboard = lazy(() => import('./components/AgentesA3'));
const NfseNacionalHub = lazy(() => import('./components/NfseNacional/NfseNacionalHub'));
const DashboardCeo = lazy(() => import('./components/DashboardCeo'));
// AnomaliasView agora vive dentro do DiagnosticoHub (sub-aba).
const SimuladorReforma = lazy(() => import('./components/SimuladorReforma'));
const TaxEmissionDashboard = lazy(() => import('./components/TaxEmission'));
const RecuperacaoHub = lazy(() => import('./components/RecuperacaoTributaria/RecuperacaoHub'));
const NfpProCloud = lazy(() => import('./components/NfpProCloud'));

const searchDescriptions: Record<SearchType, string> = {
    [SearchType.CFOP]: "Consulte códigos de operação e entenda a aplicação e tributação.",
    [SearchType.NCM]: "Classificação fiscal de mercadorias e incidência de impostos (IPI, ICMS).",
    [SearchType.SERVICO]: "Análise de retenção de ISS, local de incidência e alíquotas.",
    [SearchType.REFORMA_TRIBUTARIA]: "Simule o impacto da Reforma Tributária (IBS/CBS) para sua atividade.",
    [SearchType.SIMPLES_NACIONAL]: "Gestão de empresas do Simples, cálculo de DAS e Fator R.",
    [SearchType.LUCRO_PRESUMIDO_REAL]: "Ficha Financeira e Cadastro para Lucro Presumido/Real.",
    [SearchType.OBRIGACOES_FISCAIS]: "Acompanhamento de obrigações, vencimentos e alertas fiscais.",
    [SearchType.IMPORTA_XML]: "Central de Documentos Fiscais — importação de XMLs/PDFs (NFSe), captura, dashboards e relatórios.",
    [SearchType.ANALISE_RELATORIO_SAGE]: "Analise relatórios SAGE (XLSX/XML) e identifique gaps, canceladas, denegadas e segregação E/S.",
    [SearchType.ANALISADOR_REGIME]: "Compare cenários de tributação (Simples, Lucro Presumido, Lucro Real) e identifique o regime mais vantajoso.",
    [SearchType.ANALISE_CREDITOS]: "Análise de créditos PIS/COFINS, conciliação bancária e mapeamento por categoria fiscal.",
    [SearchType.SPED_FISCAL]: "Geração do arquivo SPED Fiscal (EFD ICMS/IPI) — escrituração digital mensal.",
    [SearchType.CAIXA_POSTAL]: "Caixa Postal e-CAC — mensagens da Receita Federal por empresa (intimações, malha fiscal, comunicados).",
    [SearchType.DAS_SIMPLES]: "DAS Simples Nacional — emissão regular (com PGDAS-D) e avulso, controle de pagamentos por empresa.",
    [SearchType.DCTFWEB]: "DCTFWeb — Declaração de Débitos e Créditos Tributários Federais Previdenciários (empresas Lucro Presumido/Real), com transmissão, DARF e MIT.",
    [SearchType.EFD_REINF]: "EFD-Reinf × DCTFWeb — confere as retenções declaradas na EFD-Reinf (INSS/IRRF/CSRF) contra o débito consolidado na DCTFWeb.",
    [SearchType.NFSE_NAC_COBERTURA]: "Cobertura ADN (NFS-e Nac.) — diagnóstico e habilitação em massa da captura nacional de NFS-e por empresa (somente administradores).",
    [SearchType.DAS_COBERTURA_PGDAS]: "Cobertura PGDAS-D — heatmap por empresa × mês mostrando quais Simples NÃO tiveram DAS emitido (gera autuação automática).",
    [SearchType.DCTFWEB_COBERTURA]: "Cobertura DCTFWeb — heatmap por empresa Lucro × mês mostrando quais NÃO transmitiram a DCTFWeb (gera autuação automática).",
    [SearchType.CAIXA_POSTAL_RADAR]: "Radar fiscal (e-CAC) — mensagens não lidas classificadas por risco real (intimações, malha, exclusão Simples, autos de infração) ordenadas por urgência.",
    [SearchType.MINHA_AGENDA]: "Minha Agenda Fiscal — consolidado por carteira: PGDAS-D / DCTFWeb pendentes + caixa postal crítica em UM lugar, priorizado por risco (0-100).",
    [SearchType.RECUPERACAO_PRAZOS]: "Prazos de Prescrição — para cada oportunidade de recuperação tributária, mostra quanto falta pra expirar (5 anos CTN art 168). URGENTE = ≤90 dias.",
    [SearchType.VENCIMENTOS_SEMANA]: "Vencimentos da Semana — obrigações fiscais que vencem nos próximos 7 dias (ou estão atrasadas), filtradas pela sua carteira. Visão do dia-a-dia.",
    [SearchType.DIAGNOSTICO_DOCS]: "Diagnóstico Docs Fiscais — varredura de saúde das NF-e capturadas: notas sem chave/competência/direção/valor, chaves duplicadas em 2+ docs (somente administradores).",
    [SearchType.SIMPLES_SUBLIMITE]: "Alerta de sublimite Simples — calcula RBT12 de cada empresa Simples e classifica contra teto (R$ 4,8M) e sublimite ICMS/ISS (R$ 3,6M). Risco de exclusão automática.",
    [SearchType.DIAGNOSTICO_CADASTROS]: "Cadastros Incompletos — empresas com UF/IBGE/anexo/CNAE faltando que bloqueiam o SPED ou cálculo do DAS (somente administradores).",
    [SearchType.CERT_MONITOR]: "Certificados Digitais — monitora vencimento dos certs (S&P + por empresa). Cert vencido = SERPRO/SEFAZ/e-CAC param sem aviso.",
    [SearchType.DIAGNOSTICO_CONFIG]: "Configurações Operacionais — detecta env vars faltando (SERPRO/SharePoint/CRON_SECRET/etc) e modos operacionais incorretos. Só admin, sem expor valores.",
    [SearchType.SAUDE_GERAL]: "Saúde Geral — agrega os 4 diagnósticos (cadastros + documentos + certs + configs) numa única tela. Status global OK/MÉDIO/ALTO/CRÍTICO/DEGRADADO.",
    [SearchType.CARTEIRA]: "Carteira de Clientes — atribuição de empresas a colaboradores responsáveis (somente administradores).",
    [SearchType.AGENTES_A3]: "Agentes A3 — gerenciar API keys do agente local cfi-a3 e marcar empresas como A3 (somente administradores).",
    [SearchType.NFSE_NACIONAL]: "NFS-e Nacional (CGSN 189/2026) — emissão e gestão de notas de serviço no padrão nacional, obrigatório set/2026.",
    [SearchType.DASHBOARD_CEO]: "Dashboard CEO — visão executiva unificada com KPIs e recomendações da IA.",
    [SearchType.ANOMALIAS]: "Detector de Anomalias — análise estatística + IA detecta irregularidades no DAS de cada empresa.",
    [SearchType.SIMULADOR_IBS_CBS]: "Simulador IBS/CBS — projeção da carga tributária 2026-2033 sob a Reforma Tributária (LC 214/2025).",
    [SearchType.EMISSAO_TRIBUTOS]: "Central de Emissões — emissão unificada de DAS (Simples) e DARF (IRPJ/CSLL/PIS/COFINS para Presumido e Real) com controle de pagamento.",
    [SearchType.RECUPERACAO_TRIBUTARIA]: "Recuperação Tributária — identifica impostos pagos a maior e oportunidades de restituição/compensação.",
    [SearchType.NFP_PRO_CLOUD]: "Consulta de situação fiscal: débitos, certidões, obrigações, parcelamentos e plano de ação. Acesso restrito a administradores.",
};

// ── Menu agrupado por gênero ────────────────────────────────────────────────
// Cada card tem ícone próprio + cor do grupo, e os grupos têm título. Resolve
// o "layout que foi se perdendo": antes era um grid plano de 38 itens sem
// símbolos. As sub-abas consolidadas (ex: Cobertura, Prazos) NÃO aparecem
// aqui — vivem dentro dos hubs. `label` sobrescreve o nome do enum quando o
// card é um hub-mãe (ex: SAUDE_GERAL → "Diagnóstico & Saúde").
interface MenuCard {
    type: SearchType;
    label?: string;
    Icon: React.FC<{ className?: string }>;
    adminOnly?: boolean;
}
interface MenuGrupo { titulo: string; cor: string; cards: MenuCard[]; }

const MENU_GRUPOS: MenuGrupo[] = [
    {
        titulo: 'Consultas', cor: '#2563eb', cards: [
            { type: SearchType.CFOP, Icon: TagIcon },
            { type: SearchType.NCM, Icon: DocumentTextIcon },
            { type: SearchType.SERVICO, Icon: BuildingIcon },
            { type: SearchType.REFORMA_TRIBUTARIA, Icon: NewspaperIcon },
            { type: SearchType.SIMULADOR_IBS_CBS, Icon: CalculatorIcon },
        ],
    },
    {
        titulo: 'Regimes & Apuração', cor: '#7c3aed', cards: [
            { type: SearchType.SIMPLES_NACIONAL, Icon: CalculatorIcon },
            { type: SearchType.LUCRO_PRESUMIDO_REAL, Icon: BuildingIcon },
            { type: SearchType.ANALISADOR_REGIME, Icon: ScaleIcon },
        ],
    },
    {
        titulo: 'Documentos Fiscais', cor: '#16a34a', cards: [
            { type: SearchType.IMPORTA_XML, label: 'Central de Documentos Fiscais', Icon: DownloadIcon },
            { type: SearchType.SPED_FISCAL, label: 'SPED Fiscal', Icon: DocumentTextIcon },
            { type: SearchType.ANALISE_RELATORIO_SAGE, label: 'Análise SAGE', Icon: DocumentTextIcon },
            { type: SearchType.ANALISE_CREDITOS, Icon: CalculatorIcon },
            { type: SearchType.EMISSAO_TRIBUTOS, Icon: RocketIcon },
        ],
    },
    {
        titulo: 'Vencimentos & Guias', cor: '#d97706', cards: [
            { type: SearchType.OBRIGACOES_FISCAIS, label: 'Vencimentos & Obrigações', Icon: CalendarIcon },
            { type: SearchType.DAS_SIMPLES, Icon: CalculatorIcon },
            { type: SearchType.DCTFWEB, Icon: DocumentTextIcon },
            { type: SearchType.NFSE_NACIONAL, Icon: GlobeIcon },
            { type: SearchType.CAIXA_POSTAL, Icon: ChatBubbleIcon },
        ],
    },
    {
        titulo: 'Fiscalização & Recuperação', cor: '#0891b2', cards: [
            { type: SearchType.SAUDE_GERAL, label: 'Diagnóstico & Saúde', Icon: ShieldIcon },
            { type: SearchType.RECUPERACAO_TRIBUTARIA, Icon: ScaleIcon },
            { type: SearchType.NFP_PRO_CLOUD, label: 'Consulta Situação Fiscal', Icon: SearchIcon, adminOnly: true },
        ],
    },
    {
        titulo: 'Gestão', cor: '#475569', cards: [
            { type: SearchType.DASHBOARD_CEO, Icon: RocketIcon },
            { type: SearchType.CARTEIRA, Icon: UserGroupIcon },
            { type: SearchType.AGENTES_A3, Icon: BriefcaseIcon },
        ],
    },
];

const App: React.FC = () => {
    const confirm = useConfirm();
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
                if (user) {
                    loadSimplesData(user);
                    runInitialSync(user); // fire-and-forget: sync localStorage -> Firestore
                    requestNotificationPermission(); // fire-and-forget: pede permissão push
                }
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
        requestNotificationPermission(); // fire-and-forget: pede permissão push
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
        setHistory(prev => {
            const updatedHistory = [newHistoryItem, ...prev].slice(0, 50);
            localStorage.setItem('fiscal-consultant-history', JSON.stringify(updatedHistory));
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
                    <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} className="p-2 bg-white dark:bg-slate-800 rounded-full shadow-lg" aria-label="Alternar tema claro/escuro">
                        {theme === 'light' ? '🌙' : '☀️'}
                    </button>
                </div>
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
        if (type === SearchType.SIMPLES_NACIONAL) {
            setSimplesView('dashboard');
            setSimplesEmpresaToEdit(null);
            loadSimplesData(currentUser);
        }
        if (type === SearchType.LUCRO_PRESUMIDO_REAL) {
            setSelectedLucroEmpresaId(null);
        }
    };

    return (
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
                />

                <div className="flex flex-col md:flex-row gap-6">
                    <main className="flex-grow min-w-0">
                        <ErrorBoundary>
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
                        <ErrorBoundary>
                            <Suspense fallback={null}>
                                <CaixaPostalAlerta
                                    currentUser={currentUser}
                                    onIrParaCaixaPostal={() => setSearchType(SearchType.CAIXA_POSTAL)}
                                    onIrParaObrigacoes={() => setSearchType(SearchType.OBRIGACOES_FISCAIS)}
                                />
                            </Suspense>
                        </ErrorBoundary>
                        {/* Menu agrupado por gênero — ícone + cor por grupo, seções com título.
                            Config em MENU_GRUPOS (module-level). Sub-abas consolidadas
                            não aparecem aqui (vivem dentro dos hubs). */}
                        <div className="space-y-2 mb-3">
                            {MENU_GRUPOS.map((grupo) => {
                                const cards = grupo.cards.filter(c => !c.adminOnly || currentUser.role === 'admin');
                                if (cards.length === 0) return null;
                                return (
                                    <div key={grupo.titulo}>
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span className="inline-block h-3 w-1 rounded" style={{ background: grupo.cor }} />
                                            <h3 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{grupo.titulo}</h3>
                                        </div>
                                        {/* Card compacto horizontal: ícone + rótulo lado a lado, baixo.
                                            Mais colunas por linha pra reduzir altura (era empilhado/grande). */}
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5">
                                            {cards.map(({ type, label, Icon }) => {
                                                const ativo = searchType === type;
                                                return (
                                                    <button
                                                        key={type}
                                                        onClick={() => selecionarTipo(type)}
                                                        title={searchDescriptions[type] || (label ?? type)}
                                                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150"
                                                        style={{
                                                            background: ativo ? grupo.cor : 'var(--bg-elevated)',
                                                            border: `1px solid ${ativo ? grupo.cor : 'var(--border-default)'}`,
                                                            color: ativo ? '#fff' : 'var(--text-secondary)',
                                                        }}
                                                    >
                                                        <span className="flex-shrink-0" style={{ color: ativo ? '#fff' : grupo.cor }}><Icon className="w-4 h-4" /></span>
                                                        <span className="text-[11px] font-semibold text-left leading-tight line-clamp-2">{label ?? type}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

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
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                {simplesView === 'dashboard' && (
                                    <SimplesNacionalDashboard
                                        empresas={simplesEmpresas}
                                        notas={simplesNotas}
                                        onSelectEmpresa={(id, view) => { setSelectedSimplesEmpresaId(id); setSimplesView(view); }}
                                        onAddNew={() => { setSimplesEmpresaToEdit(null); setSimplesView('nova'); }}
                                        onEdit={(empresa) => { setSimplesEmpresaToEdit(empresa); setSimplesView('nova'); }}
                                        onDelete={async (empresa) => {
                                            const ok = await confirm({
                                                title: `Excluir empresa "${empresa.nome}"?`,
                                                message: `CNPJ ${empresa.cnpj}. Essa ação não pode ser desfeita.`,
                                                variant: 'danger',
                                                confirmLabel: 'Excluir',
                                            });
                                            if (!ok) return;
                                            try {
                                                await simplesService.deleteEmpresa(empresa.id);
                                                setSimplesEmpresas(prev => prev.filter(e => e.id !== empresa.id));
                                                if (currentUser) authService.logAction(currentUser.id, currentUser.name, 'delete_empresa', empresa.nome);
                                                setToastMessage(`Empresa "${empresa.nome}" excluída.`);
                                            } catch (err: any) {
                                                const msg = err?.code === 'permission-denied'
                                                    ? 'Sem permissão para excluir esta empresa (só admin ou criador).'
                                                    : (err?.message || 'Erro ao excluir empresa.');
                                                setToastMessage(msg);
                                                console.error('[deleteEmpresa Simples]', err);
                                            }
                                        }}
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
                            </ErrorBoundary>
                        )}

                        {/* Lucro Presumido View */}
                        {searchType === SearchType.LUCRO_PRESUMIDO_REAL && (
                            <ErrorBoundary>
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
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                <VencimentosHub
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* Central de Documentos Fiscais (XML) */}
                        {searchType === SearchType.IMPORTA_XML && (
                            <ErrorBoundary>
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
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                <AnaliseRelatorioSAGE
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* SPED Fiscal (EFD ICMS/IPI) View */}
                        {searchType === SearchType.SPED_FISCAL && (
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                <SpedFiscal
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* Caixa Postal — hub que funde Caixa Postal + Radar e-CAC. */}
                        {searchType === SearchType.CAIXA_POSTAL && (
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                <CaixaPostalHub
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* DAS Simples — hub que funde Painel DAS + Cobertura PGDAS-D + Sublimite. */}
                        {searchType === SearchType.DAS_SIMPLES && (
                            <ErrorBoundary>
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
                            <ErrorBoundary>
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
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                <DiagnosticoHub
                                    currentUser={currentUser}
                                    onShowToast={setToastMessage}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.CARTEIRA && (
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                <CarteiraDashboard
                                    currentUser={currentUser}
                                    onShowToast={setToastMessage}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.AGENTES_A3 && (
                            <ErrorBoundary>
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
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                <NfseNacionalHub
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.DASHBOARD_CEO && (
                            <ErrorBoundary>
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
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                <SimuladorReforma
                                    currentUser={currentUser ?? null}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.EMISSAO_TRIBUTOS && (
                            <ErrorBoundary>
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
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                <RecuperacaoHub
                                    currentUser={currentUser}
                                    onShowToast={(msg) => setToastMessage(msg)}
                                />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {searchType === SearchType.NFP_PRO_CLOUD && (
                            <ErrorBoundary>
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
                  <ErrorBoundary>
                  <Suspense fallback={<LoadingSpinner />}>
                    <AnalisadorRegime />
                  </Suspense>
                  </ErrorBoundary>
                )}

                        {/* Análise de Créditos Fiscais */}
                        {searchType === SearchType.ANALISE_CREDITOS && (
                            <ErrorBoundary>
                            <Suspense fallback={<LoadingSpinner />}>
                                <AnaliseCreditos currentUser={currentUser ?? null} />
                            </Suspense>
                            </ErrorBoundary>
                        )}

                        {/* Results Display */}
                        <ErrorBoundary>
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

            {/* Aviso global de nova versão / hard refresh */}
            <UpdateBanner />
        </div>
    );
};

export default App;
