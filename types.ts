
export enum SearchType {
    CFOP = 'CFOP',
    NCM = 'NCM',
    SERVICO = 'Serviço',
    REFORMA_TRIBUTARIA = 'Reforma Tributária',
    SIMPLES_NACIONAL = 'Simples Nacional',
    LUCRO_PRESUMIDO_REAL = 'Lucro Presumido/Real',
    OBRIGACOES_FISCAIS = 'Obrigações Fiscais',
    IMPORTA_XML = 'Importa XML'
}

export interface GroundingSource {
    web: {
        uri: string;
        title: string;
    };
}

export interface IbptRates {
    nacional: number;
    importado: number;
    estadual: number;
    municipal: number;
}

export interface SearchResult {
    text: string;
    sources: GroundingSource[];
    query: string;
    timestamp?: number;
    context?: {
        aliquotaIcms?: string;
        aliquotaPisCofins?: string;
        aliquotaIss?: string;
        userNotes?: string;
    };
    ibpt?: IbptRates;
}

export interface ComparisonResult {
    summary: string;
    result1: SearchResult;
    result2: SearchResult;
}

export interface NewsAlert {
    title: string;
    summary: string;
    source: string;
}

export interface SimilarService {
    code: string;
    description: string;
}

export interface CnaeSuggestion {
    code: string;
    description: string;
}

export interface CnaeTaxDetail {
    tributo: string;
    incidencia: string;
    aliquotaMedia: string;
    baseLegal: string;
}

export type UserRole = 'admin' | 'colaborador';

export interface User {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    isVerified?: boolean;
    passwordHash?: string; // Local storage legacy
}

export interface AccessLog {
    id: string;
    userId: string;
    userName: string;
    timestamp: number;
    action: string;
    details?: string;
}

export interface FavoriteItem {
    code: string;
    description: string;
    type: SearchType;
}

export interface HistoryItem {
    id: string;
    queries: string[];
    type: SearchType;
    mode: 'single' | 'compare';
    timestamp: number;
    municipio?: string;
    alias?: string;
    responsavel?: string;
    regimeTributario?: string;
    reformaQuery?: string;
    aliquotaIcms?: string;
    aliquotaPisCofins?: string;
    aliquotaIss?: string;
    userNotes?: string;
    entityId?: string; // For navigation to saved entities
    resultSnippet?: string;
}

export interface CnpjData {
    razaoSocial: string;
    nomeFantasia: string;
    cnaePrincipal: {
        codigo: string;
        descricao: string;
    };
    cnaesSecundarios: {
        codigo: string;
        descricao: string;
    }[];
    logradouro: string;
    numero: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
}

// Simples Nacional Types

export type SimplesNacionalAnexo = 'I' | 'II' | 'III' | 'IV' | 'V' | 'III_V';

export interface SimplesNacionalAtividade {
    cnae: string;
    anexo: SimplesNacionalAnexo;
}

export interface SimplesHistoricoCalculo {
    id: string;
    dataCalculo: number;
    mesReferencia: string;
    rbt12: number;
    aliq_eff: number;
    fator_r: number;
    das_mensal: number;
    anexo_efetivo: SimplesNacionalAnexo;
}

export interface SimplesNacionalEmpresa {
    id: string;
    nome: string;
    cnpj: string;
    cnae: string;
    anexo: SimplesNacionalAnexo;
    atividadesSecundarias?: SimplesNacionalAtividade[];
    folha12: number;
    faturamentoManual?: Record<string, number>;
    faturamentoMensalDetalhado?: Record<string, any>; // Key: MM-YYYY, Value: Record<string (cnae_anexo), number | SimplesDetalheItem>
    historicoCalculos?: SimplesHistoricoCalculo[];
    nomeFantasia?: string;
    createdBy?: string;
    createdByEmail?: string;
}

export interface SimplesNacionalNota {
    id: string;
    empresaId: string;
    data: number;
    valor: number;
    descricao: string;
    origem: string;
    createdBy?: string;
}

export interface SimplesCalculoMensal {
    competencia: string;
    label: string;
    faturamento: number;
    rbt12: number;
    aliquotaEfetiva: number;
    fatorR: number;
    dasCalculado: number;
    anexoAplicado: SimplesNacionalAnexo;
}

export interface DetalhamentoAnexo {
    cnae: string;
    anexo: SimplesNacionalAnexo;
    anexoOriginal: SimplesNacionalAnexo;
    faturamento: number;
    aliquotaNominal: number;
    aliquotaEfetiva: number;
    valorDas: number;
    issRetido: boolean;
    icmsSt: boolean;
    isMonofasico: boolean;
    isImune: boolean;
    isExterior: boolean;
}

export interface SimplesNacionalResumo {
    rbt12: number;
    rbt12Interno: number;
    rbt12Externo: number;
    aliq_nom: number;
    aliq_eff: number;
    das: number;
    das_mensal: number;
    mensal: { [key: string]: number };
    historico_simulado: SimplesCalculoMensal[];
    anexo_efetivo: SimplesNacionalAnexo;
    fator_r: number;
    folha_12: number;
    ultrapassou_sublimite: boolean;
    faixa_index: number;
    detalhamento_anexos?: DetalhamentoAnexo[];
    totalMercadoInterno: number;
    totalMercadoExterno: number;
}

export interface SimplesNacionalImportResult {
    successCount: number;
    failCount: number;
    errors: string[];
}

export interface SimplesItemCalculo {
    cnae: string;
    anexo: SimplesNacionalAnexo;
    valor: number;
    issRetido: boolean;
    icmsSt: boolean;
    isSup: boolean;
    isMonofasico: boolean;
    isImune: boolean;
    isExterior: boolean;
}

export interface SimplesDetalheItem {
    valor: number;
    issRetido: boolean;
    icmsSt: boolean;
    isSup: boolean;
    isMonofasico: boolean;
    isImune: boolean;
    isExterior: boolean;
}

// Lucro Presumido / Real types

export type CategoriaItemEspecial = 'padrao' | 'aplicacao_financeira' | 'importacao' | 'ganho_capital';

export interface ItemFinanceiroAvulso {
    id: string;
    descricao: string;
    valor: number;
    tipo: 'receita' | 'despesa';
    categoriaEspecial?: CategoriaItemEspecial;
    dedutivelIrpj?: boolean; // Para despesas no Real ou exclusão da base
    geraCreditoPisCofins?: boolean; // Para despesas no Real
}

export interface IssConfig {
    tipo: 'aliquota_municipal' | 'sup_fixo';
    aliquota?: number;
    qtdeSocios?: number;
    valorPorSocio?: number;
}

export interface AcumuladoTrimestre {
    comercio: number;
    industria: number;
    servico: number;
    servicoHospitalar: number;
    financeira: number;
    mesesConsiderados: string[];
}

export interface FichaFinanceiraRegistro {
    id: string;
    dataRegistro: number;
    mesReferencia: string;
    regime: 'Presumido' | 'Real';
    periodoApuracao: 'Mensal' | 'Trimestral';
    
    acumuladoAno: number;
    
    faturamentoMesComercio: number;
    faturamentoMesIndustria: number;
    
    faturamentoMesServico: number;
    faturamentoMesServicoRetido: number;
    faturamentoMesLocacao: number;
    faturamentoMesServicoHospitalar: number;
    
    faturamentoFiliaisComercio?: number;
    faturamentoFiliaisIndustria?: number;
    faturamentoFiliaisServico?: number;
    faturamentoFiliaisServicoRetido?: number;
    faturamentoFiliaisLocacao?: number;
    faturamentoFiliaisServicoHospitalar?: number;

    dadosTrimestrais?: AcumuladoTrimestre;

    faturamentoMonofasico: number;
    valorIpi: number;
    valorDevolucoes: number;
    icmsVendas: number;

    receitaFinanceira: number;
    faturamentoMesTotal: number;
    totalGeral: number;
    
    despesas: number;
    despesasDedutiveis: number;
    folha: number;
    cmv: number;
    
    retencaoPis: number;
    retencaoCofins: number;
    retencaoIrpj: number;
    retencaoCsll: number;
    
    ipiRecolher?: number;
    icmsProprioRecolher?: number;
    icmsStRecolher?: number;

    ajustesLucroRealAdicoes?: number;
    ajustesLucroRealExclusoes?: number;
    saldoCredorIcms?: number;
    saldoCredorIpi?: number;

    isEquiparacaoHospitalar?: boolean;
    isPresuncaoReduzida16?: boolean;
    issConfig?: IssConfig;
    itensAvulsos?: ItemFinanceiroAvulso[];
    
    totalImpostos: number;
    cargaTributaria: number;
    aplicouLc224?: boolean;
}

export interface LucroPresumidoEmpresa {
    id: string;
    nome: string;
    cnpj: string;
    nomeFantasia?: string;
    endereco?: string;
    cnaePrincipal?: {
        codigo: string;
        descricao: string;
    };
    cnaesSecundarios?: {
        codigo: string;
        descricao: string;
    }[];
    tiposAtividade?: {
        comercio: boolean;
        industria: boolean;
        servico: boolean;
    };
    regimePadrao?: 'Presumido' | 'Real';
    issPadraoConfig?: IssConfig;
    isEquiparacaoHospitalar?: boolean;
    isPresuncaoReduzida16?: boolean;
    retencoesPadrao?: {
        pis: number;
        cofins: number;
        irpj: number;
        csll: number;
    };
    fichaFinanceira: FichaFinanceiraRegistro[];
    createdBy?: string;
    createdByEmail?: string;
}

export interface PlanoCotas {
    disponivel: boolean;
    numeroCotas: number;
    valorPrimeiraCota: number;
    valorDemaisCotas: number;
    vencimentos: string[];
}

export interface DetalheImposto {
    imposto: string;
    baseCalculo: number;
    aliquota: number;
    valor: number;
    observacao?: string;
    cotaInfo?: PlanoCotas;
}

export interface LucroResult {
    regime: 'Presumido' | 'Real';
    periodo: 'Mensal' | 'Trimestral';
    detalhamento: DetalheImposto[];
    totalImpostos: number;
    cargaTributaria: number;
    lucroLiquidoEstimado: number;
    alertaLc224?: boolean;
}

export interface LucroInput {
    regimeSelecionado: 'Presumido' | 'Real';
    periodoApuracao: 'Mensal' | 'Trimestral';
    mesReferencia?: string;
    faturamentoComercio: number;
    faturamentoIndustria: number;
    faturamentoServico: number;
    faturamentoServicoRetido?: number;
    faturamentoLocacao?: number;
    faturamentoServicoHospitalar?: number;
    
    faturamentoFiliais?: {
        comercio: number;
        industria: number;
        servico: number;
        servicoRetido: number;
        locacao: number;
        servicoHospitalar: number;
    };

    faturamentoMonofasico: number;
    valorIpi?: number;
    valorDevolucoes?: number;
    icmsVendas?: number;

    receitaFinanceira: number;
    despesasOperacionais: number;
    despesasDedutiveis: number;
    folhaPagamento: number;
    custoMercadoriaVendida: number;
    issConfig: IssConfig;
    retencaoPis: number;
    retencaoCofins: number;
    retencaoIrpj: number;
    retencaoCsll: number;
    isEquiparacaoHospitalar?: boolean;
    isPresuncaoReduzida16?: boolean;
    itensAvulsos?: ItemFinanceiroAvulso[];
    acumuladoAno?: number;
    acumuladoTrimestre?: AcumuladoTrimestre;
    
    ipiRecolher?: number;
    icmsProprioRecolher?: number;
    icmsStRecolher?: number;

    ajustesLucroRealAdicoes?: number;
    ajustesLucroRealExclusoes?: number;
    saldoCredorIcms?: number;
    saldoCredorIpi?: number;
}

// Fiscal Obligations Types

export type FiscalStatus = 'pending' | 'completed' | 'overdue' | 'warning';

export type FiscalBranch = 'Varejo' | 'Indústria' | 'Serviço' | 'Agronegócio' | 'E-commerce' | 'Todos';

export type TaxationRegime = 'Simples Nacional' | 'Lucro Presumido' | 'Lucro Real' | 'MEI' | 'Todos';

export interface FiscalObligation {
    id: string;
    title: string;
    description: string;
    dueDate: number;
    status: FiscalStatus;
    branch: FiscalBranch;
    regime: TaxationRegime;
    frequency: 'Mensal' | 'Trimestral' | 'Anual' | 'Eventual';
    category: 'Federal' | 'Estadual' | 'Municipal';
}

export interface ManagerAlert {
    id: string;
    type: 'overdue' | 'upcoming' | 'info';
    message: string;
    obligationId?: string;
    timestamp: number;
}
