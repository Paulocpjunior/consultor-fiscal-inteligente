
export enum SearchType {
    CFOP = 'CFOP',
    NCM = 'NCM',
    SERVICO = 'Serviço',
    REFORMA_TRIBUTARIA = 'Reforma Tributária',
    SIMPLES_NACIONAL = 'Simples Nacional',
    LUCRO_PRESUMIDO_REAL = 'Lucro Presumido/Real',
    OBRIGACOES_FISCAIS = 'Obrigações Fiscais',
    IMPORTA_XML = 'Importa XML',
    ANALISE_RELATORIO_SAGE = 'Análise Relatório SAGE',
  ANALISADOR_REGIME = 'Regime Tributário',
  ANALISE_CREDITOS = 'Análise de Créditos',
  SPED_FISCAL = 'SPED Fiscal',
  CAIXA_POSTAL = 'Caixa Postal',
  DAS_SIMPLES = 'DAS Simples Nacional',
  NFSE_NACIONAL = 'NFS-e Nacional',
  DASHBOARD_CEO = 'Dashboard CEO'
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
    sources?: GroundingSource[];
    query: string;
    /** Tipo da busca (Reforma, Simples, etc) — quando aplicável. */
    searchType?: SearchType;
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
    /** Campos flat usados opcionalmente por geminiService.proxy. */
    query1?: string;
    query2?: string;
    searchType?: SearchType;
    text?: string;
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
    /** Data de abertura/início de atividade no formato ISO YYYY-MM-DD. */
    dataAbertura?: string;
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
    /**
     * Data de abertura/início de atividade no formato ISO YYYY-MM-DD.
     * Quando preenchida e a empresa tiver menos de 12 meses de atividade,
     * o cálculo do DAS aplica RBT12 proporcionalizado conforme
     * Resolução CGSN 140/2018, art. 21.
     */
    dataAbertura?: string;
    /** Captura automática SEFAZ (cron noturno). Default = true. Admin pode desativar. */
    /** Inscrição Municipal SP capital (CCM). Usado pela captura NFS-e Nota do Milhão. */
    ccmSp?: string;
    /** Data ISO em que o cliente autorizou SP Contábil como contador no portal nfe.prefeitura.sp.gov.br. */
    nfseSpAutorizadoEm?: string;
    capturarSefaz?: boolean;
    /** Dados fiscais para geracao de SPED Fiscal etc. */
    dadosFiscais?: EmpresaDadosFiscais;
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
    /**
     * Indica se o cálculo aplicou a RBT12 proporcionalizada por se tratar
     * de empresa em início de atividade (<12 meses).
     */
    inicioAtividade?: boolean;
    /** Quantidade de meses transcorridos desde a abertura até o mês anterior ao PA. */
    mesesAtividade?: number;
    /** RBT12 proporcionalizada efetivamente usada para enquadramento. */
    rbt12pInterno?: number;
    rbt12pExterno?: number;
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
    aluguel?: number;
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
    saldoCredorPis?: number;
    saldoCredorCofins?: number;

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
    /** Inscrição Municipal SP capital (CCM). */
    ccmSp?: string;
    /** Data ISO em que o cliente autorizou SP Contábil como contador. */
    nfseSpAutorizadoEm?: string;
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
    /** Dados fiscais para geracao de SPED Fiscal etc. */
    dadosFiscais?: EmpresaDadosFiscais;
    createdBy?: string;
    createdByEmail?: string;
    /** Captura automática SEFAZ (cron noturno). Default = true. Admin pode desativar. */
    capturarSefaz?: boolean;
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
    saldoResidualPis?: number;
    saldoResidualCofins?: number;
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
    saldoCredorPis?: number;
    saldoCredorCofins?: number;
}


// ─── Caixa Postal e-CAC ───────────────────────────────────────────────────

export type CaixaPostalCategoria = 'intimacao' | 'malha' | 'exclusao' | 'informativo';

export interface CaixaPostalMensagem {
    id: string;                  // doc id no Firestore
    empresaId: string;
    empresaCnpj: string;
    mensagemId: string;          // id na Receita
    assunto: string;
    remetente: string;
    categoria: CaixaPostalCategoria;
    corpo: string;
    dataEnvio: string;           // ISO
    dataLeitura?: string | null; // null = não lida
    fonte: 'mock' | 'serpro';
    ultimaSincronizacao?: string;
}

export interface CaixaPostalResumo {
    totalMensagens: number;
    naoLidasTotal: number;
    naoLidasPorCategoria: Record<CaixaPostalCategoria, number>;
    empresasComCriticas: number;
    mode: 'mock' | 'serpro';
}

export interface CaixaPostalSyncStats {
    mode: 'mock' | 'serpro';
    total: number;
    novas: number;
    atualizadas: number;
}


// ─── DAS Simples Nacional ────────────────────────────────────────────────

export type DasTipo = 'regular' | 'avulso';
export type DasStatusPagamento = 'pendente' | 'pago' | 'vencido';

export interface DasEmitido {
    id: string;
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;
    competencia: string;          // YYYY-MM
    tipo: DasTipo;
    valor: number;
    numeroDocumento: string;
    codigoBarras: string;
    vencimento: string;           // YYYY-MM-DD
    pdfUrl?: string | null;
    descricao?: string;            // só pra avulso
    pgdasRecibo?: string;
    pgdasTransmitidoEm?: string;
    emitidoEm: string;
    modeUsado: 'mock' | 'serpro';
    statusPagamento: DasStatusPagamento;
    dataPagamento?: string | null;
    fonte?: string;
    mensagem?: string;
}

export interface DasResumo {
    totalDas: number;
    pendentes: number;
    vencidos: number;
    pagos: number;
    valorPendente: number;
    valorVencido: number;
    valorPago: number;
    mode: 'mock' | 'serpro';
}


// ─── NFS-e Nacional (Resolucao CGSN 189/2026 — vigencia 1° set/2026) ──────

export type NfseNacStatus = 'autorizada' | 'cancelada';

export interface NfseNacionalEmitida {
    id: string;
    empresaId: string;
    numero: string;
    chave: string;                        // 50 chars
    dpsRecibo?: string;
    dataEmissao: string;
    emitidaEm: string;
    status: NfseNacStatus;
    canceladaEm?: string | null;
    motivoCancelamento?: string;
    prestador: {
        cnpj: string;
        im?: string;
        nome?: string;
    };
    tomador: {
        cnpj?: string | null;
        cpf?: string | null;
        nome: string;
        endereco?: any;
    };
    servico: {
        codigoNbs: string;
        descricao: string;
        valor: number;
        aliquotaIss: number;
        issValor: number;
        issRetido: number;
        municipioPrestacao?: string;
    };
    valores: {
        bruto: number;
        deducoes: number;
        issRetido: number;
        liquido: number;
    };
    fonte?: string;
    modeUsado: 'mock' | 'serpro';
    mensagem?: string;
}

export interface NfseNacResumo {
    total: number;
    autorizadas: number;
    canceladas: number;
    valorBrutoTotal: number;
    valorIssTotal: number;
    mode: 'mock' | 'serpro';
}

export interface NbsCodigo {
    codigo: string;
    descricao: string;
}


// ─── Dashboard CEO ────────────────────────────────────────────────────────

export interface DashboardCeoKpis {
    timestamp: string;
    totalEmpresas: number;
    caixaPostal: {
        naoLidasCriticas: number;
        empresasComCriticas: number;
    };
    das: {
        pendentes: number;
        vencidos: number;
        valorVencido: number;
        empresasComVencido: number;
    };
    nfse: {
        mesAtual: number;
        issTotal: number;
    };
    apuracoes: {
        pendentes: number;
    };
}

export interface DashboardCeoInsights {
    insights: string;
    geradoEm: string;
    modelo: string;
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

// ─── Central de Documentos Fiscais (XML) ─────────────────────────────────────

export type XmlOrigem =
    | 'manual'
    | 'sefaz'
    | 'sharepoint'
    | 'email'
    | 'api'
    | 'outro';

export type XmlStatusDocumento =
    | 'autorizado'
    | 'cancelado'
    | 'denegado'
    | 'inutilizado'
    | 'rejeitado'
    | 'pendente'
    | 'desconhecido';

/** Tipo de evento NFe (Manual NFe v2.0) */
export type NFeEventoTipo =
    | 'cce'                          // tpEvento 110110 — Carta de Correção
    | 'cancelamento'                 // tpEvento 110111
    | 'epec'                         // tpEvento 110140 — EPEC
    | 'manifestacao_ciencia'         // tpEvento 210200
    | 'manifestacao_confirmacao'     // tpEvento 210210
    | 'manifestacao_desconhecimento' // tpEvento 210220
    | 'manifestacao_nao_realizada'   // tpEvento 210240
    | 'outro';

/** Evento associado a uma NFe (cancelamento, CC-e, manifestação). */
export interface NFeEvento {
    tpEvento?: string;
    tipo: NFeEventoTipo;
    descricao: string;
    nSeqEvento?: string;
    dhEvento?: string;
    nProt?: string;
    cStat?: string;
    xMotivo?: string;
    /** Texto da Carta de Correção (apenas tpEvento 110110). */
    xCorrecao?: string;
    /** Justificativa de cancelamento (apenas tpEvento 110111). */
    xJust?: string;
    storagePath?: string;
    xmlHash?: string;
    schema?: string;
    nsu?: string;
    importadoEm?: any;
    importadoPor?: string;
}

export type XmlDirecao = 'entrada' | 'saida' | 'desconhecida';

export type XmlTipoDocumento = 'NFe' | 'NFCe' | 'NFSe' | 'CTe' | 'MDFe' | 'desconhecido';

/**
 * Dados fiscais complementares de uma empresa, necessarios pra geracao
 * de SPED Fiscal (EFD ICMS/IPI), DCTFWeb, etc.
 *
 * Comum a SimplesNacionalEmpresa e LucroPresumidoEmpresa.
 */
export interface EmpresaDadosFiscais {
    /** Inscrição Estadual (numero ou 'ISENTO'). */
    inscricaoEstadual?: string;
    /** UF (sigla 2 letras, ex: 'SP'). */
    uf?: string;
    /** Codigo do municipio IBGE (7 digitos, ex: '3550308' = Sao Paulo). */
    codMunIBGE?: string;
    /** Endereço sede da empresa. */
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cep?: string;
    /** Contato. */
    email?: string;
    telefone?: string;
    /**
     * Perfil EFD ICMS/IPI (registro 0000 campo 14):
     *   A = Detalhamento completo (notas item-a-item, ICMS-Difal, FCP)
     *   B = Detalhamento resumido (totalizadores diarios)
     *   C = Anual (especifico pra empresas inscritas como microprodutor)
     * Padrao: 'A' (mais completo, atende todos os casos).
     */
    perfilEFD?: 'A' | 'B' | 'C';
    /**
     * Indicador de atividade (registro 0000 campo 15):
     *   'industrial' = 0 (industria, equiparada)
     *   'outras'     = 1 (comercio, servicos, transporte)
     */
    indAtividade?: 'industrial' | 'outras';
    /**
     * Natureza da atividade da empresa, mais granular que indAtividade.
     * Usada pra correlacionar CFOPs de entrada (sufixo correto):
     *   'comercio'  -> compra pra comercializacao (sufixo 102)
     *   'industria' -> compra pra industrializacao (sufixo 101)
     *   'servicos'  -> uso e consumo (sufixo 556)
     *   'misto'     -> mantem conversao mecanica (5->1, 6->2, 7->3)
     *
     * Quando ausente, deriva-se de indAtividade:
     *   industrial -> industria
     *   outras     -> comercio
     */
    naturezaAtividade?: 'comercio' | 'industria' | 'servicos' | 'misto';
    /**
     * Mapa de override manual de CFOP de entrada.
     *   { '6101': '2102', '6102': '2102', ... }
     *
     * Vence sobre a heuristica de naturezaAtividade. Usado quando alguma
     * entrada precisa de CFOP fora do padrao (ex: ativo imobilizado, uso
     * proprio, demonstracao, etc).
     */
    cfopOverrides?: Record<string, string>;
    /** Inscrição Estadual no Substituto Tributario (opcional). */
    inscEstSubstTrib?: string;
    /** Codigo Suframa (opcional, so se zona franca). */
    codSuframa?: string;
}

export interface DocumentoFiscalItem {
    nItem: string;
    cProd: string;
    xProd: string;
    ncm: string;
    cest?: string;
    cfop: string;
    uCom: string;
    qCom: number;
    vUnCom: number;
    vProd: number;
    vDesc?: number;
    vICMS: number;
    vIPI: number;
    vPIS: number;
    vCOFINS: number;
    cst: string;
    orig: string;
}


export interface DocumentoFiscalTotais {
    vBC: number;
    vICMS: number;
    vICMSDeson: number;
    vFCP: number;
    vBCST: number;
    vST: number;
    vFCPST: number;
    vProd: number;
    vFrete: number;
    vSeg: number;
    vDesc: number;
    vII: number;
    vIPI: number;
    vIPIDevol: number;
    vPIS: number;
    vCOFINS: number;
    vOutro: number;
    vNF: number;
}


export interface DocumentoFiscalParticipante {
    cnpjCpf: string;
    nome: string;
    fantasia?: string;
    ie?: string;
    uf?: string;
    /** Nome do municipio (texto). */
    municipio?: string;
    /** Codigo IBGE de 7 digitos (cMun no XML NFe). */
    codMunIBGE?: string;
    /** Endereco — extraido de enderEmit/enderDest do XML quando disponivel. */
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    /** CEP (apenas digitos). */
    cep?: string;
    /** Codigo do pais (cPais no XML). */
    codPais?: string;
    pais?: string;
}

/**
 * Metadados do documento fiscal salvos no Firestore.
 * O XML original fica no Firebase Storage (campo storagePath).
 */

export interface DocumentoFiscal {
    id: string;
    /** Chave de acesso (44 dígitos) — usada para evitar duplicidade. */
    chave: string;
    /** Hash SHA-256 do XML original (detecção adicional de duplicidade). */
    xmlHash: string;
    tipo: XmlTipoDocumento;
    modelo: string;
    serie: string;
    numero: string;
    /** Natureza da operação. */
    natOp: string;
    /** Data/hora de emissão (ISO). */
    dhEmi: string;
    /** Competência calculada a partir da emissão (YYYY-MM). */
    competencia: string;
    direcao: XmlDirecao;
    status: XmlStatusDocumento;

    /** Empresa cadastrada no app à qual este documento pertence. */
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;

    emitente?: DocumentoFiscalParticipante;
    /** Prestador (NFSe). Mutuamente exclusivo com emitente. */
    prestador?: DocumentoFiscalParticipante;
    destinatario?: DocumentoFiscalParticipante;
    /** Tomador (NFSe). Mutuamente exclusivo com destinatario. */
    tomador?: DocumentoFiscalParticipante;
    totais?: DocumentoFiscalTotais;
    /** Valores NFSe (liquido, pis, cofins, iss). */
    valores?: { liquido?: number; pis?: number; cofins?: number; iss?: number; baseCalculo?: number; deducoes?: number };
    itens: DocumentoFiscalItem[];
    infAdic?: string;

    /** Caminho do XML original no Firebase Storage. */
    storagePath?: string;
    storageUrl?: string;
    /** Tamanho original do arquivo XML em bytes. */
    tamanhoBytes?: number;
    fileName?: string;

    origem: XmlOrigem;
    importadoPor: string;
    importadoPorEmail?: string;
    importadoEm: number;
    createdBy?: string;
    createdByEmail?: string;
    /** Eventos NFe associados (cancelamento, CC-e, manifestação, etc). */
    eventos?: NFeEvento[];
    /** Quando o cancelamento foi homologado (preenchido se status = 'cancelado'). */
    canceladoEm?: string;
    canceladoProtocolo?: string;
    /** Stub temporário: doc criado com eventos antes da NFe original chegar. */
    eventosBeforeNFe?: boolean;
}

/**
 * Log de captura/importação para auditoria.
 */
export interface XmlCaptura {
    id: string;
    documentoId?: string;
    chave?: string;
    empresaId?: string;
    origem: XmlOrigem;
    status: 'sucesso' | 'duplicado' | 'erro';
    mensagem?: string;
    fileName?: string;
    tamanhoBytes?: number;
    usuarioId: string;
    usuarioNome?: string;
    usuarioEmail?: string;
    timestamp: number;
}

/**
 * Erro de importação registrado para análise.
 */
export interface XmlErro {
    id: string;
    fileName?: string;
    chave?: string;
    empresaId?: string;
    origem: XmlOrigem;
    mensagem: string;
    detalhe?: string;
    usuarioId: string;
    usuarioEmail?: string;
    timestamp: number;
    resolvido?: boolean;
}

/**
 * Configuração específica de uma empresa para o módulo XML.
 * Não armazenamos certificado digital — apenas referência.
 */
export interface EmpresaXmlConfig {
    id: string;
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;
    monitorada: boolean;
    capturaSefazAtiva: boolean;
    capturaSharePointAtiva: boolean;
    sharePointFolderUrl?: string;
    /** Referência ao certificado armazenado no backend seguro. NUNCA o conteúdo. */
    certificadoRef?: CertificadoDigitalInfo;
    ultimaCaptura?: number;
    proximaCaptura?: number;
    createdBy?: string;
    updatedAt?: number;
}

/**
 * Apenas metadados do certificado digital. O arquivo .pfx/.p12 NUNCA trafega
 * pelo front-end nesta fase — o backend seguro é o responsável.
 */
export interface CertificadoDigitalInfo {
    /** ID lógico no backend seguro (placeholder enquanto não há captura real). */
    backendRef?: string;
    nomeTitular?: string;
    cnpjTitular?: string;
    validoAte?: string;
    fingerprint?: string;
    cadastradoEm?: number;
}
