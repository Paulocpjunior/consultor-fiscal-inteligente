
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
    SPED_FISCAL = 'SPED Fiscal',
    ANALISADOR_REGIME = 'Regime Tributário',
    ANALISE_CREDITOS = 'Análise de Créditos'
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

export type XmlDirecao = 'entrada' | 'saida' | 'desconhecida';

export type XmlTipoDocumento = 'NFe' | 'NFCe' | 'NFSe' | 'CTe' | 'MDFe' | 'desconhecido';

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
    municipio?: string;
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

    emitente: DocumentoFiscalParticipante;
    destinatario: DocumentoFiscalParticipante;
    totais: DocumentoFiscalTotais;
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
// ─────────────────────────────────────────────────────────────────────────────
// Central de Documentos Fiscais (XML)
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentoFiscalTipo = 'NFe' | 'NFCe' | 'NFSe' | 'CTe';

export type DocumentoFiscalDirecao = 'entrada' | 'saida' | 'desconhecida';

export type DocumentoFiscalOrigem = 'upload_manual' | 'sefaz' | 'sharepoint' | 'email';

export type DocumentoFiscalStatus = 'autorizado' | 'cancelado' | 'denegado' | 'inutilizado' | 'desconhecido';

export interface DocumentoFiscalMeta {
    id: string;
    chave: string;                       // chNFe (44 dígitos) ou identificador NFSe/CTe
    tipo: DocumentoFiscalTipo;
    modelo: string;                      // 55, 65, 57, etc.
    serie: string;
    numero: string;
    dhEmi: number;                       // epoch ms

    cnpjEmitente: string;
    nomeEmitente: string;
    ufEmitente: string;
    cnpjDestinatario: string;
    nomeDestinatario: string;
    ufDestinatario: string;

    valorTotal: number;
    valorIcms: number;
    valorIpi: number;
    valorPis: number;
    valorCofins: number;

    direcao: DocumentoFiscalDirecao;
    status: DocumentoFiscalStatus;

    empresaId?: string;                  // vínculo com empresa cadastrada (Simples ou Lucro)
    empresaCnpj?: string;
    empresaRegime?: 'Simples Nacional' | 'Lucro Presumido' | 'Lucro Real' | 'MEI';

    storagePath: string;                 // caminho do XML cru no Firebase Storage
    storageUrl?: string;                 // download URL (cacheável)
    hashConteudo: string;                // sha-1 ou sha-256 do XML cru, dedup secundária
    tamanhoBytes: number;

    origem: DocumentoFiscalOrigem;
    createdBy: string;
    createdByEmail?: string;
    createdAt: number;
    updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPED Fiscal (EFD ICMS/IPI) — schema canônico (camelCase, números reais,
// C100 com itens e resumos aninhados, status de arquivo, gravidade de
// inconsistência). Este é o modelo de domínio usado pelo parser, pelo
// conferencer XML × SPED e pelo dashboard.
// ─────────────────────────────────────────────────────────────────────────────

export type SpedRegistroTipo =
    | '0000'
    | '0150'
    | '0200'
    | 'C100'
    | 'C170'
    | 'C190'
    | 'D100'
    | 'E110'
    | 'E520'
    | 'OUTRO';

export type SpedFiscalStatus =
    | 'IMPORTADO'
    | 'PROCESSADO'
    | 'COM_ERROS'
    | 'CONFERIDO';

export type SpedInconsistenciaTipo =
    | 'XML_NAO_ESCRITURADO'
    | 'SPED_SEM_XML'
    | 'VALOR_DIVERGENTE'
    | 'ICMS_DIVERGENTE'
    | 'CFOP_DIVERGENTE'
    | 'CST_DIVERGENTE'
    | 'NOTA_CANCELADA_ESCRITURADA'
    | 'CHAVE_INVALIDA'
    | 'DOCUMENTO_DUPLICADO'
    | 'REGISTRO_INCOMPLETO';

export type SpedInconsistenciaGravidade =
    | 'BAIXA'
    | 'MEDIA'
    | 'ALTA'
    | 'CRITICA';

export interface SpedFiscalArquivo {
    id: string;
    empresaId?: string;
    cnpj?: string;
    razaoSocial?: string;
    competencia?: string;          // mmYYYY (derivado do registro 0000)
    periodoInicial?: string;       // ddmmYYYY
    periodoFinal?: string;         // ddmmYYYY
    nomeArquivo: string;
    tamanhoBytes: number;
    importadoPorUid?: string;
    importadoPorNome?: string;
    importadoEm: number;           // epoch ms
    status: SpedFiscalStatus;
    totalLinhas: number;
    totalRegistros: number;
    /** opcional — preenchido se o TXT também for guardado no Firebase Storage */
    storagePath?: string;
    storageUrl?: string;
    hashArquivo?: string;          // sha-256 do TXT
}

export interface SpedRegistro0000 {
    tipo: '0000';
    codVer?: string;
    codFin?: string;
    dtIni?: string;
    dtFin?: string;
    nome?: string;
    cnpj?: string;
    cpf?: string;
    uf?: string;
    ie?: string;
    codMun?: string;
    im?: string;
    suframa?: string;
    indPerfil?: string;
    indAtiv?: string;
}

export interface SpedParticipante0150 {
    tipo: '0150';
    codPart: string;
    nome?: string;
    codPais?: string;
    cnpj?: string;
    cpf?: string;
    ie?: string;
    codMun?: string;
    suframa?: string;
    endereco?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
}

export interface SpedProduto0200 {
    tipo: '0200';
    codItem: string;
    descrItem?: string;
    codBarra?: string;
    codAntItem?: string;
    unidInv?: string;
    tipoItem?: string;
    codNcm?: string;
    exIpi?: string;
    codGen?: string;
    codLst?: string;
    aliqIcms?: number;
    cest?: string;
}

export interface SpedDocumentoC100 {
    tipo: 'C100';
    indOper?: string;          // 0=entrada, 1=saída
    indEmit?: string;          // 0=própria, 1=terceiros
    codPart?: string;
    codMod?: string;
    codSit?: string;           // 00=regular, 02=cancelado, 04=denegado, 05=inutilizado, 06=complementar, 07=substituto, 08=regular extemporâneo
    serie?: string;
    numDoc?: string;
    chave?: string;            // chNFe (44 dígitos)
    dataDoc?: string;          // ddmmYYYY
    dataES?: string;
    valorDocumento: number;
    valorDesconto?: number;
    valorMercadoria?: number;
    valorIcms?: number;
    valorIpi?: number;
    valorPis?: number;
    valorCofins?: number;
    itens: SpedItemC170[];
    resumos: SpedResumoC190[];
}

export interface SpedItemC170 {
    tipo: 'C170';
    numItem?: string;
    codItem?: string;
    descricaoComplementar?: string;
    quantidade?: number;
    unidade?: string;
    valorItem?: number;
    valorDesconto?: number;
    cstIcms?: string;
    cfop?: string;
    natBcCred?: string;
    valorBcIcms?: number;
    aliquotaIcms?: number;
    valorIcms?: number;
    valorBcIcmsSt?: number;
    aliquotaSt?: number;
    valorIcmsSt?: number;
    indApur?: string;
    cstIpi?: string;
    codEnq?: string;
    valorBcIpi?: number;
    aliquotaIpi?: number;
    valorIpi?: number;
    cstPis?: string;
    valorBcPis?: number;
    aliquotaPis?: number;
    valorPis?: number;
    cstCofins?: string;
    valorBcCofins?: number;
    aliquotaCofins?: number;
    valorCofins?: number;
}

export interface SpedResumoC190 {
    tipo: 'C190';
    cstIcms?: string;
    cfop?: string;
    aliquotaIcms?: number;
    valorOperacao?: number;
    valorBcIcms?: number;
    valorIcms?: number;
    valorBcIcmsSt?: number;
    valorIcmsSt?: number;
    valorReducaoBc?: number;
    valorIpi?: number;
    codObs?: string;
}

export interface SpedDocumentoD100 {
    tipo: 'D100';
    indOper?: string;
    indEmit?: string;
    codPart?: string;
    codMod?: string;
    codSit?: string;
    serie?: string;
    subSerie?: string;
    numDoc?: string;
    chave?: string;
    dataDoc?: string;
    dataAP?: string;
    tpCtE?: string;
    chaveCteRef?: string;
    valorDocumento: number;
    valorDesconto?: number;
    valorServico?: number;
    valorBcIcms?: number;
    valorIcms?: number;
}

export interface SpedApuracaoE110 {
    tipo: 'E110';
    valorTotalDebitos?: number;
    valorAjustesDebitos?: number;
    valorTotalAjustesDebitos?: number;
    valorEstornosCreditos?: number;
    valorTotalCreditos?: number;
    valorAjustesCreditos?: number;
    valorTotalAjustesCreditos?: number;
    valorEstornosDebitos?: number;
    saldoCredorAnterior?: number;
    valorSaldoDevedor?: number;
    valorDeducoes?: number;
    valorIcmsRecolher?: number;
    valorSaldoCredorTransportar?: number;
}

export interface SpedApuracaoE520 {
    tipo: 'E520';
    valorSaldoDevedorIpi?: number;
    valorDeducoesIpi?: number;
    valorIpiRecolher?: number;
    valorSaldoCredorIpi?: number;
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


