
export enum SearchType {
    CFOP = 'CFOP',
    NCM = 'NCM',
    SERVICO = 'Serviço',
    REFORMA_TRIBUTARIA = 'Reforma Tributária',
    SIMPLES_NACIONAL = 'Simples Nacional',
    LUCRO_PRESUMIDO_REAL = 'Lucro Presumido/Real',
    OBRIGACOES_FISCAIS = 'Obrigações & Tarefas',
    IMPORTA_XML = 'Importa XML',
    ANALISE_RELATORIO_SAGE = 'Análise Relatório SAGE',
  ANALISADOR_REGIME = 'Regime Tributário',
  ANALISE_CREDITOS = 'Análise de Créditos',
  SPED_FISCAL = 'SPED Fiscal',
  CAIXA_POSTAL = 'Caixa Postal',
  DAS_SIMPLES = 'DAS Simples Nacional',
  DCTFWEB = 'DCTFWeb',
  EFD_REINF = 'EFD-Reinf × DCTFWeb',
  NFSE_NACIONAL = 'NFS-e Nacional',
  NFSE_NAC_COBERTURA = 'Cobertura ADN (NFS-e Nac.)',
  DAS_COBERTURA_PGDAS = 'Cobertura PGDAS-D',
  DCTFWEB_COBERTURA = 'Cobertura DCTFWeb',
  CAIXA_POSTAL_RADAR = 'Radar fiscal (e-CAC)',
  MINHA_AGENDA = 'Minha Agenda Fiscal',
  RECUPERACAO_PRAZOS = 'Prazos de Prescrição',
  VENCIMENTOS_SEMANA = 'Vencimentos da Semana',
  DIAGNOSTICO_DOCS = 'Diagnóstico Docs Fiscais',
  SIMPLES_SUBLIMITE = 'Sublimite Simples',
  DIAGNOSTICO_CADASTROS = 'Cadastros Incompletos',
  CERT_MONITOR = 'Certificados Digitais',
  DIAGNOSTICO_CONFIG = 'Configurações Operacionais',
  SAUDE_GERAL = 'Saúde Geral',
  DASHBOARD_CEO = 'Dashboard CEO',
  ANOMALIAS = 'Detector de Anomalias',
  SIMULADOR_IBS_CBS = 'Simulador IBS/CBS',
  CARTEIRA = 'Carteira de Clientes',
  AGENTES_A3 = 'Agentes A3',
  EMISSAO_TRIBUTOS = 'Central de Emissões',
  RECUPERACAO_TRIBUTARIA = 'Recuperação Tributária',
  NFP_PRO_CLOUD = 'Consulta Situação Fiscal',
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
    /**
     * (LEGADO) Folha total dos ultimos 12 meses como valor unico. Mantido pra
     * compat com empresas antigas. NOVO: folhaMensal por competencia eh
     * preferencial - Fator R correto depende de janela movel de 12 meses
     * (LC 123/06 art. 18 §5o-M), nao de valor congelado.
     * Quando folhaMensal estiver presente, o calculo usa a janela movel.
     */
    folha12: number;
    /**
     * Folha de pagamento por competencia (chave "YYYY-MM"). Permite calcular
     * Fator R correto sobre os 12 meses anteriores a cada PA.
     */
    folhaMensal?: Record<string, number>;
    faturamentoManual?: Record<string, number>;
    /** Regime de apuracao Simples Nacional. Default 'competencia'. */
    regimeApuracao?: 'competencia' | 'caixa';
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
    /** @deprecated CCM legado top-level. Cadastro unico agora em dadosFiscais.ccmSp.
     *  Mantido so pra leitura de dados antigos (readers fazem fallback). Nao gravar aqui. */
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
    /**
     * Alertas estruturados de faturamento/faixa do Simples Nacional. Opcional
     * pra manter compat com chamadores antigos; quando presente, traz a foto
     * fiscal completa: sublimite ICMS/ISS, limite federal, excesso > 20% (que
     * dispara desenquadramento RETROATIVO), aproximação do limite e mudança
     * de faixa de alíquota.
     */
    alertas_faturamento?: AlertasFaturamentoSimples;
}

/**
 * Foto estruturada dos alertas de faturamento do Simples Nacional.
 * Baseado em LC 123/2006:
 *   - art. 3º II  — limite federal (R$ 4,8M)
 *   - art. 13-A   — sublimite estadual ICMS/ISS (R$ 3,6M)
 *   - art. 30 §1º II — desenquadramento por excesso > 20% (R$ 5,76M)
 */
export interface AlertasFaturamentoSimples {
    /** RBT12 > R$ 3,6M — ICMS/ISS saem do DAS, demais continuam no Simples. */
    sublimite_icms_iss: { atingido: boolean; valor_limite: number };
    /** RBT12 > R$ 4,8M — vedação ao Simples; empresa precisa migrar regime. */
    limite_federal: { atingido: boolean; valor_limite: number };
    /**
     * RBT12 > R$ 5,76M (excesso de 20%). Desenquadramento RETROATIVO ao
     * mês seguinte ao excesso (LC 123 art. 30 §1º II).
     */
    excesso_maior_20_pct: { atingido: boolean; valor_limite: number };
    /** RBT12 entre 90% e 100% do limite federal (R$ 4,32M a R$ 4,8M). */
    proximo_limite_federal: {
        atingido: boolean;
        valor_alerta: number;
        margem_ate_limite: number;
    };
    /** Empresa nos últimos 10% da faixa atual e ainda dentro do Simples. */
    proxima_mudanca_faixa: null | {
        aliquota_nominal_proxima: number;
        limite_faixa_atual: number;
        margem_ate_proxima_faixa: number;
    };
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
    /**
     * Base de credito PIS/COFINS no Lucro Real (apenas Lei 10.637/02 art. 3 e
     * Lei 10.833/03 art. 3 - aluguel PJ, energia, insumos, depreciacao etc).
     * NAO incluir folha de salario (vedacao art. 3 §2 I), aluguel PF, mao-de-obra PF.
     * Se nao informado, cai em `despesasDedutiveis` por compat — porem isso
     * MAJORA credito indevidamente. Migracao: front passa a separar.
     */
    despesasGeramCreditoPisCofins?: number;
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


// ─── Caixa Postal (multi-canal) ─────────────────────────────────────────

export type CaixaPostalCategoria =
    | 'intimacao' | 'malha' | 'exclusao' | 'informativo'
    // DET (Domicílio Eletrônico Trabalhista)
    | 'det_notificacao' | 'det_auto_infracao'
    // DEC (Domicílio Eletrônico do Contribuinte)
    | 'dec_intimacao' | 'dec_comunicado'
    // DJE (Diário de Justiça Eletrônico)
    | 'dje_citacao' | 'dje_intimacao'
    // e-MAC (Ministério da Agricultura)
    | 'emac_notificacao'
    // Prefeitura SP (NFS-e e ISS)
    | 'prefeitura_sp_nfse' | 'prefeitura_sp_iss' | 'prefeitura_sp_comunicado';

export type CaixaPostalFonte = 'ecac' | 'det' | 'dec' | 'dje' | 'emac' | 'prefeitura_sp';

export interface CaixaPostalMensagem {
    id: string;                  // doc id no Firestore
    empresaId: string;
    empresaCnpj: string;
    empresaNome?: string;
    mensagemId: string;          // id na Receita / órgão
    assunto: string;
    remetente: string;
    categoria: CaixaPostalCategoria;
    corpo: string;
    dataEnvio: string;           // ISO
    dataLeitura?: string | null; // null = não lida
    fonte: CaixaPostalFonte | 'mock' | 'serpro';
    ultimaSincronizacao?: string;
    prazoResposta?: string | null; // ISO — prazo legal p/ resposta (DET/DEC)
}

export interface CaixaPostalResumo {
    totalMensagens: number;
    naoLidasTotal: number;
    naoLidasPorCategoria: Record<string, number>;
    naoLidasPorFonte?: Record<CaixaPostalFonte, number>;
    empresasComCriticas: number;
    mode: 'mock' | 'serpro';
}

export interface CaixaPostalSyncStats {
    mode: 'mock' | 'serpro';
    total: number;
    novas: number;
    atualizadas: number;
    porCanal?: Record<CaixaPostalFonte, { total: number; novas: number }>;
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
    pdfBase64?: string | null;
    descricao?: string;            // só pra avulso
    pgdasRecibo?: string;
    pgdasTransmitidoEm?: string;
    emitidoEm: string;
    modeUsado: 'mock' | 'serpro';
    statusPagamento: DasStatusPagamento;
    dataPagamento?: string | null;
    fonte?: string;
    mensagem?: string;
    /**
     * Estimativa de atualização monetária quando o DAS está vencido. Calculada
     * pelo cron noturno (processarCronDas) com base em Lei 9.430/96 art. 61 +
     * LC 123 art. 35: multa de mora 0,33%/dia (máx 20%) + juros SELIC mensal
     * acumulada + 1% no mês do pagamento. SELIC é estimativa conservadora —
     * valor REAL deve ser confirmado no DAS gerado pelo SERPRO antes do pagamento.
     */
    multaEstimada?: {
        dias: number;
        multaPct: number;
        multaValor: number;
        jurosPct: number;
        jurosValor: number;
        total: number;       // valor + multa + juros
        calculadoEm: string; // ISO YYYY-MM-DD
    };
}

export interface DasResumo {
    totalDas: number;
    pendentes: number;
    vencidos: number;
    pagos: number;
    valorPendente: number;
    valorVencido: number;
    /** Somatório de valor original + multa + juros estimados (DAS vencidos). */
    valorVencidoAtualizado?: number;
    /** Somatório só da parcela de multa+juros adicionais (informativo). */
    valorMultaEstimada?: number;
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
        cIndOp?: string;
        cClassTrib?: string;
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
    cIndOpSugerido?: string;       // Indicador de Operação (sugerido)
    cClassTribSugerido?: string;   // Classificação Tributária (sugerido — '00000000' = placeholder)
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
    /** Cobertura PGDAS-D / DCTFWeb no mês anterior (quem não emitiu/transmitiu) */
    cobertura?: {
        mesAnterior: string;
        pgdasPendentes: number;
        pgdasTotal: number;
        dctfwebPendentes: number;
        dctfwebTotal: number;
    };
    /** Empresas Simples em risco de sair do regime por RBT12 */
    sublimite?: {
        tetoUltrapassou: number;
        tetoCritico: number;
        sublimiteUltrapassou: number;
        sublimiteCritico: number;
    };
}

export interface DashboardCeoInsights {
    insights: string;
    geradoEm: string;
    modelo: string;
}


// ─── Previsão DAS (D4a) ────────────────────────────────────────────────────

export interface DasPrevisaoMes {
    competencia: string;
    dasProvavel: number;
    dasMin: number;
    dasMax: number;
    rbt12Projetado: number;
    mudancaFaixa: { limite: number; mensagem: string } | null;
    confianca: number;
}

export interface DasPrevisaoResponse {
    empresa: { id: string; nome: string; anexo: string; cnpj: string };
    historico: { competencia: string; das: number; aliquotaEfetiva: number; rbt12: number }[];
    estatistica: { slope: number; r2: number; qtdMesesAnalisados: number };
    previsao: DasPrevisaoMes[];
    aviso?: string;
}

export interface DasPrevisaoIaResponse {
    analise: string;
    geradoEm: string;
    modelo: string;
}


// ─── Painel de Ação (D4b) ──────────────────────────────────────────────────

export type AcaoUrgencia = 'alta' | 'media' | 'baixa';
export type AcaoTipo = 'caixa-postal' | 'das-vencido' | 'apuracao-pendente';
export type AcaoModulo = 'caixa-postal' | 'das' | 'simples' | 'nfse';

export interface AcaoPendente {
    tipo: AcaoTipo;
    urgencia: AcaoUrgencia;
    empresaCnpj: string;
    empresaId: string;
    empresaNome?: string;
    titulo: string;
    descricao: string;
    acao: string;
    modulo: AcaoModulo;
}

export interface AcoesResponse {
    timestamp: string;
    totalAcoes: number;
    porUrgencia: { alta: number; media: number; baixa: number };
    acoes: AcaoPendente[];
}


// ─── Calendário Fiscal ─────────────────────────────────────────────────────

export type ObrigacaoTipo =
    // Federais — pagamento principal
    | 'DAS' | 'DAS-MEI'
    // Folha
    | 'INSS' | 'FGTS'
    // Declarações federais
    | 'DCTF' | 'DCTFWEB' | 'EFD-REINF' | 'ESOCIAL'
    // IR / contribuições
    | 'IRRF' | 'PIS-COFINS' | 'DARF-IRPJ' | 'DARF-CSLL'
    // Anuais
    | 'DEFIS' | 'DASN-SIMEI' | 'ECD' | 'ECF' | 'DIRF' | 'DIRPF'
    // SPED
    | 'SPED-FISCAL' | 'SPED-CONTRIB'
    // Estaduais (ICMS)
    | 'GIA' | 'ICMS' | 'ICMS-ST' | 'DESTDA'
    // Municipais (ISS)
    | 'ISS' | 'DMS';

export interface ObrigacaoFiscal {
    tipo: ObrigacaoTipo;
    descricao: string;
    empresaId: string;
    empresaNome: string;
    empresaCnpj: string;
    anexo?: string;
    vencimento: string;          // YYYY-MM-DD
    regime: string;
    urgencia: 'mensal' | 'trimestral' | 'anual';
}

export interface CalendarioResponse {
    ano: number;
    mes: number;
    geradoEm: string;
    stats: {
        total: number;
        vencidas: number;
        proximas7Dias: number;
        porTipo: Record<string, number>;
    };
    obrigacoes: ObrigacaoFiscal[];
    limitacoes: string;
}


// ─── Detector de Anomalias DAS ─────────────────────────────────────────────

export type AnomaliaTipo = 'salto_faturamento' | 'mudanca_anexo' | 'das_abaixo_esperado';
export type AnomaliaSeveridade = 'alta' | 'media' | 'baixa';

export interface AnomaliaDetectada {
    tipo: AnomaliaTipo;
    severidade: AnomaliaSeveridade;
    competencia: string;
    descricao: string;
    dados: Record<string, any>;
}

export interface AnomaliasEmpresa {
    empresaId: string;
    empresaNome: string;
    empresaCnpj: string;
    qtdAnomalias: number;
    severidadeMax: AnomaliaSeveridade;
    anomalias: AnomaliaDetectada[];
}

export interface AnomaliasGlobalResponse {
    geradoEm: string;
    totalEmpresas: number;
    empresasComAnomalia: number;
    resultados: AnomaliasEmpresa[];
}

export interface AnomaliaIaResponse {
    analise: string;
    modelo: string;
    geradoEm: string;
}


// ─── Conferência PGDAS-D ───────────────────────────────────────────────────

export interface PgdasExtraido {
    cnpj?: string;
    competencia?: string;
    anexoAplicado?: string;
    rbt12?: number;
    rbt12Proporcional?: number;
    faturamentoMes?: number;
    fatorR?: number;
    aliqEfetiva?: number;
    valorDas?: number;
    receitas?: {
        mercadoInternoComercio?: number;
        mercadoInternoIndustria?: number;
        mercadoInternoServicos?: number;
        exportacao?: number;
        comST?: number;
        monofasica?: number;
        retidoNaFonte?: number;
        imunidade?: number;
    };
    deducoes?: {
        icmsRetidoST?: number;
        issRetidoFonte?: number;
        outrasRetencoes?: number;
    };
    tributosDiscriminados?: {
        irpj?: number;
        csll?: number;
        pis?: number;
        cofins?: number;
        cpp?: number;
        icms?: number;
        iss?: number;
    };
}

export interface PgdasDivergencia {
    campo: string;
    valorPgdas: any;
    valorApp: any;
    diferenca: any;
    diferencaPct: number | null;
    severidade: 'alta' | 'media' | 'baixa';
}

export interface PgdasValidacao {
    tipo: string;
    severidade: 'alta' | 'media' | 'baixa';
    descricao: string;
}

export interface PgdasConferirResponse {
    empresa: { id: string; nome: string; cnpj: string; anexo: string };
    extraido: PgdasExtraido;
    calculoAppCorrespondente: any | null;
    divergencias: PgdasDivergencia[];
    validacoes: PgdasValidacao[];
    temCalculoNoApp: boolean;
    geradoEm: string;
}

export interface PgdasExplicarResponse {
    analise: string;
    modelo: string;
    geradoEm: string;
}


// ─── Simulador IBS/CBS Reforma Tributária ──────────────────────────────────

export type RegimeReforma = 'Simples' | 'Presumido' | 'Real';

export interface ProjecaoAno {
    ano: number;
    regime?: string;
    regimeMantido?: string;
    pisAtual?: number;
    cofinsAtual?: number;
    pisCofinsLiquido?: number;
    cbs?: number;
    ibs?: number;
    compensacao?: number;
    cargaPisCofinsLiquida?: number;
    cargaIvaDualLiquida?: number;
    cargaTotal: number;
    cargaPctFaturamento?: number;
    dasAnual?: number;
    observacao?: string | null;
}

export interface SimulacaoReforma {
    faturamentoAnual: number;
    regime: RegimeReforma;
    projecoes: ProjecaoAno[];
    cronograma: Record<string, any>;
    premissas: Record<string, string>;
    observacoes: string[];
    geradoEm: string;
}

export interface SimuladorIaResponse {
    analise: string;
    modelo: string;
    geradoEm: string;
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

export type CategoriaOperacao =
    | 'compra'
    | 'venda'
    | 'servico_prestado'
    | 'servico_tomado'
    | 'devolucao'
    | 'transferencia'
    | 'remessa'
    | 'outro';

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
    /**
     * Inscrição Municipal SP capital (CCM) — usada pra consultar NFSe SP.
     * O modal Dados Fiscais grava aqui; o backend tambem espera no top-level
     * empresa.ccmSp (espelhado no onSave). Ver EmpresaDadosFiscaisModal.
     */
    ccmSp?: string;
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
    /** Base de cálculo do ICMS do item (extraído de <vBC> do bloco ICMS interno). */
    vBC?: number;
    /** Alíquota do ICMS em % (extraído de <pICMS>). */
    aliqIcms?: number;
    /** Modalidade de determinação da BC do ICMS (CST 20/70). */
    modBC?: string;
    /** Percentual de redução da BC do ICMS em % (CST 20/70). */
    pRedBC?: number;
    vICMS: number;
    /** Base de cálculo do ICMS-ST. */
    vBCST?: number;
    /** Alíquota do ICMS-ST em %. */
    aliqST?: number;
    /** Valor do ICMS-ST. */
    vICMSST?: number;
    vIPI: number;
    /** Alíquota do IPI em %. */
    aliqIPI?: number;
    vPIS: number;
    /** Alíquota do PIS em %. */
    aliqPIS?: number;
    vCOFINS: number;
    /** Alíquota do COFINS em %. */
    aliqCOFINS?: number;
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
    categoriaOperacao?: CategoriaOperacao;
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
    /** Valor total normalizado: vNF (NFe), vTPrest (CTe), vRec (NFSe). Gravado pelo importer. */
    valorTotal?: number;
    /** Tipo do documento (normalizado para o frontend). Espelha `tipo` mas vem do schema do XML. */
    tipoDoc?: XmlTipoDocumento;
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


/* ==========================================================================
 * DCTFWeb — Integra Contador SERPRO
 * ========================================================================== */

export type DctfwebCategoria =
    | 'GERAL_MENSAL' | 'GERAL_13' | 'AFERICAO' | 'ESPETACULO'
    | 'RECLAMATORIA' | 'MIT';

export type DctfwebSituacao = 'EM_ANDAMENTO' | 'ATIVA' | 'ENCERRADA' | 'DESCONHECIDA';

export interface DctfwebDeclaracao {
    id: string;
    empresaId?: string;
    empresaCnpj: string;
    categoria: DctfwebCategoria;
    categoriaCodigo?: number;
    anoPA: number;
    mesPA: number;
    situacao: DctfwebSituacao;
    valorTotal?: number;
    inssRetido?: number;
    cprbDevido?: number;
    dataVencimento?: string;
    numeroRecibo?: string;
    transmitidoEm?: string | null;
    fonte?: 'mock' | 'serpro';
    ultimaSincronizacao?: string;
    _erro?: string | null;
}

export interface DctfwebResumo {
    totalDeclaracoes: number;
    pendentes: number;
    transmitidas: number;
    empresasComPendente: number;
    mode: 'mock' | 'serpro';
}

export interface DctfwebSyncStats {
    mode: 'mock' | 'serpro';
    total: number;
    novas: number;
    atualizadas: number;
    anoPA: number;
    mesPA: number;
}

export interface DctfwebTransmissaoResult {
    ok: boolean;
    categoria: DctfwebCategoria;
    numeroRecibo: string;
    transmitidoEm: string;
    situacao: DctfwebSituacao;
    fonte: 'mock' | 'serpro';
    _raw?: any;
}

export interface DctfwebDarfResult {
    valor: number;
    numeroDocumento: string;
    codigoBarras: string;
    vencimento: string;
    pdfBase64: string;
    fonte: 'mock' | 'serpro';
    _raw?: any;
}

export interface DctfwebPdfResult {
    pdfBase64: string;
    categoria?: DctfwebCategoria | number;
    anoPA: number;
    mesPA: number;
    fonte: 'mock' | 'serpro';
}

export type DctfwebMitStatus =
    | 'PROCESSANDO' | 'ENCERRADA' | 'ERRO' | 'DESCONHECIDO';

export interface DctfwebMitApuracao {
    apuracaoMit: any;
    apuracaoResumo?: any;
    idApuracao?: number;
    motivo?: string;
    apuracoes?: any[];
    fonte: 'mock' | 'serpro';
}

export interface DctfwebMitEncerramentoResult {
    ok: boolean;
    statusEncerramento: DctfwebMitStatus;
    protocolo: string;
    idApuracao?: number | null;
    avisosDctf?: string[];
    fonte: 'mock' | 'serpro';
    _raw?: any;
}

export interface DctfwebMitHistorico {
    ano: number;
    apuracoes: any[];
    fonte: 'mock' | 'serpro';
}

export const DCTFWEB_CATEGORIA_LABELS: Record<DctfwebCategoria, string> = {
    GERAL_MENSAL: 'Mensal',
    GERAL_13: '13º Salário',
    AFERICAO: 'Aferição de Obra',
    ESPETACULO: 'Espetáculo Desportivo',
    RECLAMATORIA: 'Reclamatória Trabalhista',
    MIT: 'MIT - Módulo Inclusão de Tributos',
};


/* ==========================================================================
 * DARF — Documento de Arrecadação de Receitas Federais
 * Lucro Presumido e Lucro Real (IRPJ, CSLL, PIS, COFINS, IRRF).
 * ========================================================================== */

export type DarfRegime = 'Presumido' | 'Real';
export type DarfTributo = 'IRPJ' | 'CSLL' | 'PIS' | 'COFINS' | 'IRRF';
export type DarfPeriodicidade = 'mensal' | 'trimestral';
export type DarfStatusPagamento = 'pendente' | 'pago' | 'vencido';

export interface DarfCodigoReceita {
    key?: string;
    codigo: string;       // 4 dígitos (ex: '2089')
    descricao: string;
}

export interface DarfEmitido {
    id: string;
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;
    regime: DarfRegime;
    tributo: DarfTributo;
    competencia: string;            // YYYY-MM
    periodicidade: DarfPeriodicidade;
    codigoReceita: string;
    numeroDocumento: string;
    codigoBarras: string;
    linhaDigitavel?: string;
    vencimento: string;             // YYYY-MM-DD
    valorPrincipal: number;
    multa: number;
    juros: number;
    valor: number;                  // total (principal + multa + juros)
    pdfBase64?: string | null;
    descricao?: string;
    observacao?: string;
    emitidoEm: string;
    modeUsado: 'mock' | 'serpro';
    statusPagamento: DarfStatusPagamento;
    dataPagamento?: string | null;
    fonte?: string;
    mensagem?: string;
    /**
     * Estimativa de atualização monetária quando a DARF está vencida. Calculada
     * pelo cron noturno (processarVencimentos) com base em Lei 9.430/96 art. 61:
     * multa de mora 0,33%/dia (máx 20%) + juros SELIC mensal + 1% no mês do
     * pagamento. SELIC é estimativa conservadora — valor REAL deve ser
     * confirmado no DARF gerado pelo SERPRO antes do pagamento.
     */
    multaEstimada?: {
        dias: number;
        multaPct: number;
        multaValor: number;
        jurosPct: number;
        jurosValor: number;
        total: number;
        calculadoEm: string;
    };
}

export interface DarfResumo {
    totalDarfs: number;
    pendentes: number;
    vencidos: number;
    pagos: number;
    valorPendente: number;
    valorVencido: number;
    /** Somatório de principal + multa + juros estimados (DARFs vencidos). */
    valorVencidoAtualizado?: number;
    /** Somatório só da parcela de multa+juros adicionais (informativo). */
    valorMultaEstimada?: number;
    valorPago: number;
    porTributo: Record<string, { qtd: number; valor: number }>;
    mode: 'mock' | 'serpro';
}

export interface DarfEmissaoInput {
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;
    regime: DarfRegime;
    tributo: DarfTributo;
    competencia: string;            // YYYY-MM
    valor: number;                  // principal
    periodicidade?: DarfPeriodicidade;
    codigoReceita?: string;         // override (default = sugerido pelo backend)
    vencimento?: string;            // YYYY-MM-DD (override)
    dataPagamento?: string;         // se atrasado, calcula multa+juros
    descricao?: string;
    observacao?: string;
}


/* ==========================================================================
 * Central de Emissões — fachada unificada (DAS + DARF + DCTFWeb + NFSe).
 * ========================================================================== */

export type TipoGuia = 'DAS_REGULAR' | 'DAS_AVULSO' | 'DARF';

export interface CatalogoEmissaoItem {
    tipoGuia: TipoGuia;
    label: string;
    tributos: string[];
    periodicidade?: DarfPeriodicidade;
}

export interface EmissaoResumoConsolidado {
    totalGuias: number;
    pendentes: number;
    vencidos: number;
    pagos: number;
    valorPendente: number;
    valorVencido: number;
    /** Soma de multa+juros estimados (DAS + DARF) sobre o total vencido. */
    valorMultaEstimada?: number;
    valorPago: number;
    breakdown: {
        das: {
            total: number;
            pendentes: number;
            vencidos: number;
            pagos: number;
            valorTotal: number;
        };
        darf: {
            total: number;
            pendentes: number;
            vencidos: number;
            pagos: number;
            valorTotal: number;
            porTributo: Record<string, { qtd: number; valor: number }>;
        };
    };
    modes: {
        das: 'mock' | 'serpro';
        darf: 'mock' | 'serpro';
    };
}

export const DARF_TRIBUTO_LABELS: Record<DarfTributo, string> = {
    IRPJ:   'IRPJ',
    CSLL:   'CSLL',
    PIS:    'PIS/PASEP',
    COFINS: 'COFINS',
    IRRF:   'IRRF',
};


// ─── Recuperação Tributária ──────────────────────────────────────────────

export type RecuperacaoTeseId =
    | 'pis_cofins_monofasico'
    | 'icms_base_pis_cofins'
    | 'icms_st_mva_excedente'
    | 'das_segregacao_incorreta'
    | 'iss_local_incorreto'
    | 'inss_verbas_indenizatorias';

export type RecuperacaoStatus = 'nao_analisada' | 'em_analise' | 'oportunidade' | 'sem_oportunidade' | 'em_execucao' | 'recuperado';

export interface RecuperacaoTese {
    id: RecuperacaoTeseId;
    nome: string;
    descricao: string;
    regimesAplicaveis: string[];
    prazoDecadencial: number; // anos
    fundamentoLegal: string;
}

export interface RecuperacaoAnaliseItem {
    competencia: string;
    descricao: string;
    valorOriginal: number;
    valorRecuperavel: number;
    detalhes?: Record<string, any>;
}

export interface RecuperacaoEmpresaTese {
    teseId: RecuperacaoTeseId;
    status: RecuperacaoStatus;
    valorEstimado: number;
    periodoAnalisado: { inicio: string; fim: string };
    itens: RecuperacaoAnaliseItem[];
    analisadoEm?: string;
    observacoes?: string;
}

export interface RecuperacaoEmpresaResumo {
    empresaId: string;
    empresaNome: string;
    empresaCnpj: string;
    regime: string;
    totalRecuperavel: number;
    teses: RecuperacaoEmpresaTese[];
    ultimaAnalise?: string;
}

export interface RecuperacaoGlobalResumo {
    geradoEm: string;
    totalEmpresas: number;
    empresasComOportunidade: number;
    totalRecuperavel: number;
    porTese: Record<RecuperacaoTeseId, { empresas: number; valor: number }>;
    resultados: RecuperacaoEmpresaResumo[];
}

export interface RecuperacaoParecerIa {
    analise: string;
    modelo: string;
    geradoEm: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPED Fiscal — Análise e Conferência (importação de TXT EFD ICMS/IPI)
// ─────────────────────────────────────────────────────────────────────────────

export type SpedFiscalStatus = 'IMPORTADO' | 'PROCESSADO' | 'COM_ERROS' | 'CONFERIDO';

export type SpedInconsistenciaTipo =
    | 'XML_NAO_ESCRITURADO' | 'SPED_SEM_XML' | 'VALOR_DIVERGENTE'
    | 'ICMS_DIVERGENTE' | 'CFOP_DIVERGENTE' | 'CST_DIVERGENTE'
    | 'NOTA_CANCELADA_ESCRITURADA' | 'CHAVE_INVALIDA' | 'DOCUMENTO_DUPLICADO' | 'REGISTRO_INCOMPLETO';

export type SpedInconsistenciaGravidade = 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';

export interface SpedFiscalArquivo {
    id: string;
    empresaId?: string;
    cnpj?: string;
    razaoSocial?: string;
    competencia?: string;
    periodoInicial?: string;
    periodoFinal?: string;
    nomeArquivo: string;
    tamanhoBytes: number;
    importadoPorUid?: string;
    importadoPorNome?: string;
    importadoEm: number;
    status: SpedFiscalStatus;
    totalLinhas: number;
    totalRegistros: number;
}

export interface SpedRegistro0000 {
    tipo: '0000'; codVer?: string; codFin?: string; dtIni?: string; dtFin?: string;
    nome?: string; cnpj?: string; cpf?: string; uf?: string; ie?: string;
    codMun?: string; im?: string; suframa?: string; indPerfil?: string; indAtiv?: string;
}

export interface SpedParticipante0150 {
    tipo: '0150'; codPart: string; nome?: string; codPais?: string;
    cnpj?: string; cpf?: string; ie?: string; codMun?: string; suframa?: string;
    endereco?: string; numero?: string; complemento?: string; bairro?: string;
}

export interface SpedProduto0200 {
    tipo: '0200'; codItem: string; descrItem?: string; codBarra?: string;
    codAntItem?: string; unidInv?: string; tipoItem?: string; codNcm?: string;
    exIpi?: string; codGen?: string; codLst?: string; aliqIcms?: number; cest?: string;
}

export interface SpedItemC170 {
    tipo: 'C170'; numItem?: string; codItem?: string; descricaoComplementar?: string;
    quantidade?: number; unidade?: string; valorItem?: number; valorDesconto?: number;
    cstIcms?: string; cfop?: string; natBcCred?: string;
    valorBcIcms?: number; aliquotaIcms?: number; valorIcms?: number;
    valorBcIcmsSt?: number; aliquotaSt?: number; valorIcmsSt?: number;
    indApur?: string; cstIpi?: string; codEnq?: string;
    valorBcIpi?: number; aliquotaIpi?: number; valorIpi?: number;
    cstPis?: string; valorBcPis?: number; aliquotaPis?: number; valorPis?: number;
    cstCofins?: string; valorBcCofins?: number; aliquotaCofins?: number; valorCofins?: number;
}

export interface SpedResumoC190 {
    tipo: 'C190'; cstIcms?: string; cfop?: string; aliquotaIcms?: number;
    valorOperacao?: number; valorBcIcms?: number; valorIcms?: number;
    valorBcIcmsSt?: number; valorIcmsSt?: number; valorReducaoBc?: number;
    valorIpi?: number; codObs?: string;
}

export interface SpedDocumentoC100 {
    tipo: 'C100'; indOper?: string; indEmit?: string; codPart?: string;
    codMod?: string; codSit?: string; serie?: string; numDoc?: string;
    chave?: string; dataDoc?: string; dataES?: string;
    valorDocumento: number; valorDesconto?: number; valorMercadoria?: number;
    valorIcms?: number; valorIpi?: number; valorPis?: number; valorCofins?: number;
    itens: SpedItemC170[]; resumos: SpedResumoC190[];
}

export interface SpedDocumentoD100 {
    tipo: 'D100'; indOper?: string; indEmit?: string; codPart?: string;
    codMod?: string; codSit?: string; serie?: string; subSerie?: string;
    numDoc?: string; chave?: string; dataDoc?: string; dataAP?: string;
    tpCtE?: string; chaveCteRef?: string;
    valorDocumento: number; valorDesconto?: number; valorServico?: number;
    valorBcIcms?: number; valorIcms?: number;
}

export interface SpedApuracaoE110 {
    tipo: 'E110'; valorTotalDebitos?: number; valorAjustesDebitos?: number;
    valorTotalAjustesDebitos?: number; valorEstornosCreditos?: number;
    valorTotalCreditos?: number; valorAjustesCreditos?: number;
    valorTotalAjustesCreditos?: number; valorEstornosDebitos?: number;
    saldoCredorAnterior?: number; valorSaldoDevedor?: number;
    valorDeducoes?: number; valorIcmsRecolher?: number;
    valorSaldoCredorTransportar?: number;
}

export interface SpedApuracaoE520 {
    tipo: 'E520'; valorSaldoDevedorIpi?: number; valorDeducoesIpi?: number;
    valorIpiRecolher?: number; valorSaldoCredorIpi?: number;
}

export interface SpedFiscalParseResult {
    arquivo: SpedFiscalArquivo;
    registro0000?: SpedRegistro0000;
    participantes: SpedParticipante0150[];
    produtos: SpedProduto0200[];
    documentosC100: SpedDocumentoC100[];
    documentosD100: SpedDocumentoD100[];
    apuracaoIcms?: SpedApuracaoE110;
    apuracaoIpi?: SpedApuracaoE520;
    erros: string[];
    avisos: string[];
}

export interface SpedFiscalInconsistencia {
    id: string;
    tipo: SpedInconsistenciaTipo;
    gravidade: SpedInconsistenciaGravidade;
    chave?: string;
    documento?: string;
    descricao: string;
    valorXml?: number;
    valorSped?: number;
    status: 'ABERTA' | 'EM_ANALISE' | 'CORRIGIDA' | 'JUSTIFICADA';
}

export interface SpedFiscalConferenceResult {
    totalXmls: number;
    totalDocumentosSped: number;
    documentosConferidos: number;
    inconsistencias: SpedFiscalInconsistencia[];
}


// ─── NFP Pro Cloud ────────────────────────────────────────────────────────

export type NfpEsfera = 'federal' | 'estadual' | 'municipal';
export type NfpGravidade = 'alta' | 'media' | 'baixa';
export type NfpStatusDebito = 'aberto' | 'parcelado' | 'em_analise' | 'quitado' | 'prescrito';
export type NfpStatusCertidao = 'positiva' | 'negativa' | 'positiva_efeitos_negativa' | 'indisponivel' | 'nao_consultada';
export type NfpStatusObrigacao = 'entregue' | 'pendente' | 'atrasada' | 'dispensada' | 'nao_verificada';
export type NfpTipoAcao = 'civil' | 'trabalhista' | 'tributaria' | 'criminal';

export interface NfpDebito {
    id: string;
    empresaId: string;
    esfera: NfpEsfera;
    orgao: string;
    descricao: string;
    valorOriginal: number;
    dataVencimento: string;
    valorAtualizado?: number;
    dataAtualizacao?: string;
    status: NfpStatusDebito;
    parcelamentoId?: string;
    observacao?: string;
}

export interface NfpParcelamento {
    id: string;
    empresaId: string;
    esfera: NfpEsfera;
    programa: string;
    valorTotal: number;
    parcelas: number;
    parcelasPagas: number;
    valorParcela: number;
    status: 'ativo' | 'inadimplente' | 'quitado' | 'cancelado';
    dataInicio: string;
    dataFim?: string;
}

export type NfpFonteCertidao = 'serpro' | 'consulta_publica' | 'manual';

export interface NfpCertidao {
    id: string;
    empresaId: string;
    esfera: NfpEsfera;
    orgao: string;
    tipo: string;
    status: NfpStatusCertidao;
    dataConsulta?: string;
    dataValidade?: string;
    dataEmissao?: string;
    numeroCertidao?: string;
    motivoImpedimento?: string;
    urlDocumento?: string;
    /** PDF da certidao em base64, quando disponibilizado pelo SERPRO. */
    pdfBase64?: string;
    /** Origem da consulta: SERPRO, portal publico, ou manual. */
    fonte?: NfpFonteCertidao;
    /** URL do portal oficial para consulta manual quando SERPRO/scraping falha (CAPTCHA). */
    portalUrl?: string;
}

export interface NfpObrigacao {
    id: string;
    empresaId: string;
    nome: string;
    sigla: string;
    esfera: NfpEsfera;
    periodicidade: 'mensal' | 'trimestral' | 'anual' | 'eventual';
    competencia?: string;
    status: NfpStatusObrigacao;
    dataEntrega?: string;
    prazoLegal?: string;
    observacao?: string;
}

export interface NfpAcaoJudicial {
    id: string;
    empresaId: string;
    tipo: NfpTipoAcao;
    numero?: string;
    vara?: string;
    descricao: string;
    valorCausa?: number;
    status: 'em_andamento' | 'encerrada' | 'arquivada';
    dataDistribuicao?: string;
    observacao?: string;
}

export interface NfpPlanoAcao {
    id: string;
    empresaId: string;
    descricao: string;
    gravidade: NfpGravidade;
    esfera: NfpEsfera;
    prazo?: string;
    responsavel?: string;
    status: 'pendente' | 'em_andamento' | 'concluida';
    tipo?: NfpTipoAcao;
}

export interface NfpAnaliseEmpresa {
    empresaId: string;
    empresaNome: string;
    empresaCnpj: string;
    dataAnalise: string;
    analisadoPor: string;
    fonte: 'certificado_escritorio' | 'certificado_cliente' | 'offline';
    debitos: NfpDebito[];
    parcelamentos: NfpParcelamento[];
    certidoes: NfpCertidao[];
    obrigacoes: NfpObrigacao[];
    acoes: NfpAcaoJudicial[];
    planoAcao: NfpPlanoAcao[];
}
