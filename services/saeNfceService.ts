/**
 * saeNfceService.ts
 *
 * Cliente do endpoint /api/admin/sae-nfce/capturar — captura de saída de NFC-e
 * (modelo 65) via SAE-NFC-e da SEFAZ-SP, usando o A1 do próprio contribuinte.
 */

import { getAuth } from 'firebase/auth';

export interface SaeNfceResultado {
    ok: boolean;
    empresaId?: string | null;
    cnpj?: string;
    tpAmb?: number;
    periodo?: { de: string; ate: string };
    chavesEncontradas?: number;
    baixadas?: number;
    importadas?: number;
    duplicadas?: number;
    jaCompletas?: number;
    erros?: number;
    errosDetalhe?: string[];
    limiteAtingido?: boolean;
    parcial?: boolean;
    retomarDataInicial?: string;
    veredito?: string;
    duracaoMs?: number;
    error?: string;
    httpStatus?: number;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

/**
 * Dispara a captura de NFC-e de saída de um contribuinte por período.
 * dataInicial/dataFinal em ISO (ex: 2026-04-01) ou vazio (padrão: últimos 100 dias).
 */
export async function capturarNFCeSaida(params: {
    cnpj?: string;
    empresaId?: string;
    dataInicial?: string;
    dataFinal?: string;
    tpAmb?: number;
}): Promise<SaeNfceResultado> {
    const token = await getToken();
    const res = await fetch('/api/admin/sae-nfce/capturar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            cnpj: params.cnpj ? params.cnpj.replace(/\D/g, '') : undefined,
            empresaId: params.empresaId || undefined,
            dataInicial: params.dataInicial || undefined,
            dataFinal: params.dataFinal || undefined,
            tpAmb: params.tpAmb || 1,
        }),
    });
    let data: SaeNfceResultado;
    try {
        data = await res.json();
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta não-JSON)`, httpStatus: res.status };
    }
    if (!res.ok) return { ...data, ok: false, httpStatus: res.status };
    return data;
}

export interface ReconferirNfceResultado {
    ok: boolean;
    chave?: string;
    origemDaEntrada?: 'chave' | 'id-de-evento';
    cnpjEmitente?: string;
    /** A resposta do órgão, inteira — é ela que responde quando o app não sabe nomear. */
    sefaz?: {
        cStat: string | null; xMotivo: string | null; temAutorizada: boolean; eventos: number;
        /** QUAL evento veio — contador sozinho não responde nada. */
        eventosResumo?: Array<{
            tpEvento: string | null; cStat: string | null;
            dhEvento: string | null; nProt: string | null; xMotivo: string | null;
        }>;
        /** O XML do evento, cru — para a resposta estranha não custar outra rodada. */
        eventosXml?: string[];
    };
    situacao?: 'cancelada' | 'nao-cancelada' | 'nao-cancelada-por-recusa'
        | 'cancelamento-nao-confirmado' | 'indeterminado';
    motivo?: string;
    documentoNaBase?: boolean;
    gravado?: boolean;
    duracaoMs?: number;
    error?: string;
    code?: string;
}

/**
 * "Esta NFC-e está cancelada?" — pergunta ao SAE-NFC-e com o A1 do próprio
 * emitente. Aceita a CHAVE de 44 dígitos ou o ID do evento.
 *
 * ⚠️ Não marca nada à mão: quem afirma o cancelamento é a SEFAZ, e a gravação
 * passa pelo mesmo dono que a reconferência de NF-e usa.
 */
export async function reconferirNfcePorChave(entrada: string): Promise<ReconferirNfceResultado> {
    const token = await getToken();
    const res = await fetch('/api/admin/sae-nfce/reconferir-chave', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: entrada }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ...data, ok: false };
    return { ...data, ok: true };
}

export interface AutXmlHarvestResultado {
    ok: boolean;
    escritorio?: string;
    empresasMonitoradas?: number;
    docs?: number;
    importadasSaida?: number;
    importadasEntrada?: number;
    atualizadas?: number;
    duplicadas?: number;
    eventos?: number;
    semDono?: number;
    erros?: number;
    ultNSU?: string;
    maxNSU?: string;
    rateLimited?: boolean;
    detalhePorEmpresa?: Record<string, { nome: string; saida: number; entrada: number; atualizadas: number; duplicadas: number }>;
    duracaoMs?: number;
    error?: string;
}

/**
 * Dispara a colheita de saída via autXML (DistribuiçãoDFe com o cert do
 * escritório). resetNSU=true refaz o backfill dos ~90 dias.
 */
export async function colherAutXml(resetNSU = false): Promise<AutXmlHarvestResultado> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/autxml-harvest', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetNSU }),
    });
    try {
        const data = await res.json();
        if (!res.ok) return { ...data, ok: false };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta não-JSON)` };
    }
}

export interface CoberturaSaidaEmpresa {
    empresaId: string;
    cnpj: string;
    nome: string;
    regime: string | null;
    ativo: boolean;
    qtdSaida: number;
    ultimaSaida: string | null;
    // Sinal de prioridade: saída na base inteira (inclui resumos e notas fora da
    // janela). >0 com qtdSaida=0 = emite mod 55 mas parou de ser capturado.
    qtdSaidaTotal?: number;
    ultimaSaidaHistorica?: string | null;
}
export interface CoberturaSaidaResultado {
    ok: boolean;
    janelaDias?: number;
    totalEmpresas?: number;
    comSaida?: number;
    semSaida?: number;
    percentualCobertura?: number;
    empresasSemSaida?: CoberturaSaidaEmpresa[];
    // Recortes já priorizados: prioritarias = emite mod 55 mas parou de ser
    // capturado (migrar primeiro); semEvidenciaSaida = sem sinal de que emite.
    prioritarias?: CoberturaSaidaEmpresa[];
    semEvidenciaSaida?: CoberturaSaidaEmpresa[];
    prioritariasCount?: number;
    semEvidenciaCount?: number;
    empresasComSaida?: CoberturaSaidaEmpresa[];
    /** Confirmação por cliente das DUAS ligações possíveis (cofre / autXML). */
    confirmacoes?: ConfirmacaoSaidaEmpresa[];
    confirmadas?: number;
    docsSaidaLidos?: number;
    geradoEm?: string;
    error?: string;
}

/** Prova (ou falta dela) de que a ligação do cliente está valendo. */
export interface ConfirmacaoSaidaEmpresa {
    empresaId: string;
    cnpj: string;
    nome: string;
    ativo: boolean;
    qtdSaida: number;
    ultimaSaida: string | null;
    ultimaSaidaHistorica: string | null;
    /** Notas que chegaram por cada trilho na janela (null = nenhuma). */
    cofre: { qtd: number; ultima: string | null } | null;
    autxml: { qtd: number; ultima: string | null } | null;
    manual: { qtd: number; ultima: string | null } | null;
    confirmado: boolean;
    trilhos: string[];
    titulo: string;
    detalhe: string;
    /** O que cobrar do cliente quando não está confirmado. */
    acao: string | null;
}

/**
 * Relatório de cobertura de saída: quais clientes NÃO tiveram nenhuma NF-e de
 * saída (mod 55) capturada na janela — a lista de "onde falta o CNPJ do
 * escritório no autXML do emissor".
 */
export async function coberturaSaida(janelaDias = 90): Promise<CoberturaSaidaResultado> {
    const token = await getToken();
    const res = await fetch(`/api/admin/sefaz/cobertura-saida?janelaDias=${janelaDias}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    try {
        const data = await res.json();
        if (!res.ok) return { ...data, ok: false };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta não-JSON)` };
    }
}

// ── Prova de Saída por numeração (exatidão, Paulo 30/07) ────────────────────
export interface ProvaSaidaSerie {
    serie: string;
    menor: number;
    maior: number;
    capturadas: number;
    /** Números EXATOS faltando na sequência (até o corte). */
    faltantes: number[];
    totalFaltantes: number;
    faltantesTruncado: boolean;
    /** true = faixa gigante de ausências: histórico não coberto (backfill), não buraco pontual. */
    grandeFaixa?: boolean;
}

export interface ProvaSaidaEmpresa {
    empresaId: string | null;
    cnpj: string;
    nome: string;
    capturadas: number;
    semNumero: number;
    totalFaltantes: number;
    ultimaSaida: string | null;
    farol: 'exata' | 'incompleta';
    series: ProvaSaidaSerie[];
}

export interface ProvaSaidaResultado {
    ok: boolean;
    janelaDias?: number;
    empresas?: ProvaSaidaEmpresa[];
    totais?: {
        empresasAnalisadas: number;
        empresasExatas: number;
        empresasComBuraco: number;
        notasFaltantes: number;
        seriesGrandeFaixa?: number;
        faltantesGrandeFaixa?: number;
        docsForaCadastro?: number;
        chavesInvalidas?: number;
    };
    docsSaidaLidos?: number;
    geradoEm?: string;
    error?: string;
}

/**
 * PROVA EXATA por numeração: NF-e é sequencial por série — buraco na
 * sequência capturada = nota faltante COM NÚMERO (ou inutilizada, a
 * confirmar). Zero dependência de SIEG/cliente.
 */
export async function provaSaida(janelaDias = 90): Promise<ProvaSaidaResultado> {
    const token = await getToken();
    const res = await fetch(`/api/admin/sefaz/prova-saida?janelaDias=${janelaDias}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    try {
        const data = await res.json();
        if (!res.ok) return { ...data, ok: false };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta não-JSON)` };
    }
}

export interface DocLocalizado {
    chave: string;
    numero: string | null;
    serie: string | null;
    dhEmi: string | null;
    competencia: string | null;
    empresaId: string | null;
    empresaNome: string;
    empresaCnpj: string | null;
    cnpjEmit: string | null;
    cnpjDest: string | null;
    xNomeEmit: string | null;
    /**
     * Direção pela RÉGUA (`direcaoEfetivaDoc` no backend), não o campo cru — a
     * compra de produtor rural (art. 136) fica gravada como 'saida' e mandaria
     * procurar do lado errado justamente nesta tela, que é o "onde está a nota?".
     */
    direcao: string | null;
    /** `tpNF` do documento — é ele que sustenta a direção acima. */
    tpNF: string | null;
    valorTotal: number | null;
    tipoDoc: string | null;
    temItens: boolean | null;
    origem: string | null;
}

/**
 * "Onde está esta nota?" — procura em TODA a base, ignorando filtro de
 * empresa. A aba XMLs só busca dentro da empresa filtrada, então nota que caiu
 * no cliente errado (ou sem dono) sumia da tela.
 */
export async function localizarDocumento(q: string): Promise<{ ok: boolean; total?: number; docs?: DocLocalizado[]; error?: string }> {
    const token = await getToken();
    const res = await fetch(`/api/admin/sae-nfce/localizar-doc?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ...data, ok: true };
}

export interface ReparoSemDonoResultado {
    ok: boolean;
    analisados?: number;
    reparados?: number;
    semDonoConhecido?: number;
    semCnpjNoDoc?: number;
    porEmpresa?: Record<string, number>;
    aplicar?: boolean;
    cursor?: string | null;
    acabou?: boolean;
    error?: string;
}

/**
 * Notas que ficaram SEM DONO (empresaId nulo) por causa das importações em
 * lote antigas — existem na base mas somem do filtro por empresa. `aplicar`
 * false = ensaio (só conta); true = devolve a posse.
 */
export async function repararNotasSemDono(
    opts: { aplicar?: boolean; cursor?: string | null; maxDocs?: number } = {},
): Promise<ReparoSemDonoResultado> {
    const token = await getToken();
    const res = await fetch('/api/admin/sae-nfce/reparar-sem-dono', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            aplicar: opts.aplicar === true,
            cursor: opts.cursor || undefined,
            maxDocs: opts.maxDocs || undefined,
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ...data, ok: true };
}

export interface XmlEmailIngestResultado {
    ok: boolean;
    caixa?: string;
    empresasMonitoradas?: number;
    mensagens?: number;
    anexos?: number;
    importadasSaida?: number;
    importadasEntrada?: number;
    atualizadas?: number;
    duplicadas?: number;
    eventos?: number;
    semDono?: number;
    erros?: number;
    detalhePorEmpresa?: Record<string, { nome: string; saida: number; entrada: number; atualizadas: number; duplicadas: number }>;
    anexosNaoXml?: string[];
    errosDetalhe?: string[];
    /** Links no corpo do e-mail (ISS.NET-DF, pacote de ERP) — #318. */
    links?: number;
    linksBaixados?: number;
    xmlsDeLink?: number;
    /** Hosts recusados pela allowlist — é a lista do que autorizar. */
    linksBloqueados?: string[];
    duracaoMs?: number;
    error?: string;
}

/**
 * Dispara a ingestão de XML por e-mail (o "cofre" do CFI): lê a caixa
 * configurada (anexo .xml, .zip e link no corpo) e importa — saída mod 55
 * inclusive. `janelaDias`/`maxMensagens` servem ao BACKFILL manual: o cofre só
 * lia e-mail NÃO-LIDO até 27/07, então tudo que alguém abriu no Outlook ficou
 * para trás e precisa de uma varredura com janela maior.
 */
export async function ingerirXmlEmail(
    opts: { mailbox?: string; janelaDias?: number; maxMensagens?: number } = {},
): Promise<XmlEmailIngestResultado> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/xml-email-ingest', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mailbox: opts.mailbox || undefined,
            janelaDias: opts.janelaDias || undefined,
            maxMensagens: opts.maxMensagens || undefined,
        }),
    });
    try {
        const data = await res.json();
        if (!res.ok) return { ...data, ok: false };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta não-JSON)` };
    }
}

export interface CofreKpis {
    hoje: { saida: number; entrada: number; erros: number };
    mes: { saida: number; entrada: number; erros: number };
    total: { saida: number; entrada: number; erros: number; execucoes: number };
    porDia: Array<{ dia: string; saida: number; entrada: number }>;
    ultimaExecMs: number | null;
}
export interface CofreRun {
    ranAtMs: number; mensagens: number; anexos: number; saida: number; entrada: number;
    atualizadas: number; duplicadas: number; erros: number; semDono: number;
    pendencias?: Array<{ assunto: string; from: string | null; anexos: string[] }>;
    errosDetalhe?: string[]; origem?: string;
}
export interface CofreHistoricoResultado {
    ok: boolean; caixa?: string; kpis?: CofreKpis; runs?: CofreRun[]; error?: string;
}
export interface CofrePendencia { assunto: string; from: string | null; recebidoEm: string | null; anexos: string[]; }
export interface CofrePendenciasResultado {
    ok: boolean; caixa?: string; total?: number; pendencias?: CofrePendencia[]; error?: string;
}

/** Histórico das execuções do cofre + KPIs agregados (Fase 1 — controle). */
export async function historicoCofre(limit = 60): Promise<CofreHistoricoResultado> {
    const token = await getToken();
    const res = await fetch(`/api/admin/sefaz/xml-email-ingest/historico?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    try {
        const data = await res.json();
        if (!res.ok) return { ...data, ok: false };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta não-JSON)` };
    }
}

/** E-mails travados na caixa (anexo sem .xml importável) — ao vivo. */
export async function pendenciasCofre(): Promise<CofrePendenciasResultado> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/xml-email-ingest/pendencias', {
        headers: { Authorization: `Bearer ${token}` },
    });
    try {
        const data = await res.json();
        if (!res.ok) return { ...data, ok: false };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta não-JSON)` };
    }
}

export interface ArquivoSpResultado {
    ok: boolean;
    empresasComConfig?: number;
    candidatos?: number;
    arquivados?: number;
    semConfig?: number;
    semStorage?: number;
    semCaminho?: number;
    erros?: number;
    errosDetalhe?: string[];
    porEmpresa?: Record<string, { arquivados: number }>;
    error?: string;
}

/** Arquiva no SharePoint os XMLs do cofre ainda não arquivados (Fase 3). */
export async function arquivarSharePoint(maxDocs?: number): Promise<ArquivoSpResultado> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/xml-email-arquivo-sp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxDocs: maxDocs || undefined }),
    });
    try {
        const data = await res.json();
        if (!res.ok) return { ...data, ok: false };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta não-JSON)` };
    }
}

export interface LoteImportResultado {
    ok: boolean;
    recebidos?: number;
    importadas?: number;
    duplicadas?: number;
    atualizadas?: number;
    /** Já existiam SEM dono (ou noutra empresa) e foram trazidas para esta. */
    reatribuidas?: number;
    /**
     * Onde as notas do lote foram parar. Responde ao "importei 36 e não acho":
     * a competência do app é a da EMISSÃO (dhEmi), não a do nome da pasta.
     */
    conferencia?: {
        conferidas: number;
        porCompetencia: Record<string, number>;
        resumosSemValor: number;
        emOutraEmpresa: number;
        naoEncontradas: number;
    } | null;
    erros?: number;
    errosDetalhe?: string[];
    empresaId?: string;
    empresaNome?: string;
    error?: string;
}

/**
 * Envia um lote de XMLs (strings) para importação server-side pelo mesmo
 * importer da captura (dedup por chave + upgrade resumo→completa).
 * Usado pela Importação em Massa (ZIP) e pelo trilho A3.
 */
export async function importarXmlsLote(cnpj: string, xmls: string[]): Promise<LoteImportResultado> {
    const token = await getToken();
    const res = await fetch('/api/admin/sae-nfce/importar-xmls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj: cnpj.replace(/\D/g, ''), xmls }),
    });
    try {
        const data = await res.json();
        if (!res.ok) return { ...data, ok: false };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta não-JSON)` };
    }
}
