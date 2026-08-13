/**
 * services/dctfwebService.ts
 *
 * Cliente HTTP para o backend /api/admin/dctfweb.
 * Endpoints:
 *   GET  /status                        -> {mode, ok}
 *   GET  /resumo                        -> resumo agregado dashboard
 *   GET  /declaracoes?{filtros}         -> lista declaracoes
 *   POST /sincronizar                   -> sincroniza 1 empresa
 *   POST /transmitir                    -> transmite declaracao
 *   POST /gerar-darf                    -> gera DARF (ATIVA ou EM_ANDAMENTO)
 *   GET  /declaracao-completa           -> PDF declaracao ATIVA
 *   GET  /recibo                        -> PDF recibo transmissao
 *   POST /mit/encerrar                  -> encerra apuracao MIT
 *   GET  /mit/status                    -> status encerramento MIT
 *   GET  /mit/apuracao                  -> detalhes apuracao MIT
 *   GET  /mit/historico                 -> historico apuracoes do ano
 */
import type {
    User,
    DctfwebDeclaracao, DctfwebResumo, DctfwebSyncStats,
    DctfwebTransmissaoResult, DctfwebDarfResult, DctfwebPdfResult,
    DctfwebDarfsSeparadosResult, DctfwebTrimestraisMesResult, DctfwebDebitosTrimestraisResult,
    DctfwebCategoria, DctfwebMitApuracao, DctfwebMitEncerramentoResult,
    DctfwebMitHistorico,
    DctfwebQuotaAgendada, DctfwebQuotasAgendadasResult,
} from '../types';

import { getAuth } from 'firebase/auth';

const BASE = '/api/admin/dctfweb';

async function authHeaders(_user: User | null): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuario nao autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

export async function getStatus(user: User | null): Promise<{ mode: 'mock' | 'serpro'; ok: boolean }> {
    const res = await fetch(`${BASE}/status`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getStatus: ${res.status}`);
    return res.json();
}

export async function getResumo(user: User | null): Promise<DctfwebResumo> {
    const res = await fetch(`${BASE}/resumo`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getResumo: ${res.status}`);
    return res.json();
}

export interface DctfwebEmpresaOption {
    id: string;
    nome: string;
    cnpj: string;
    fonte: 'lucro';
    regime?: string;
}

export async function listarEmpresasDctfweb(user: User | null): Promise<DctfwebEmpresaOption[]> {
    const res = await fetch(`${BASE}/empresas`, { headers: await authHeaders(user) });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `listarEmpresasDctfweb: ${res.status}`);
    }
    return res.json();
}

export interface ListarFilters {
    empresaCnpj?: string;
    situacao?: 'EM_ANDAMENTO' | 'ATIVA';
    anoPA?: number;
    mesPA?: number;
}

export async function listarDeclaracoes(user: User | null, filters: ListarFilters = {}): Promise<DctfwebDeclaracao[]> {
    const qs = new URLSearchParams();
    if (filters.empresaCnpj) qs.set('empresaCnpj', filters.empresaCnpj);
    if (filters.situacao) qs.set('situacao', filters.situacao);
    if (filters.anoPA) qs.set('anoPA', String(filters.anoPA));
    if (filters.mesPA) qs.set('mesPA', String(filters.mesPA));

    const res = await fetch(`${BASE}/declaracoes?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`listarDeclaracoes: ${res.status}`);
    return res.json();
}

export async function sincronizarEmpresa(user: User | null, payload: {
    empresaId: string; empresaCnpj: string;
    anoPA?: number; mesPA?: number; categoria?: DctfwebCategoria;
}): Promise<DctfwebSyncStats> {
    const res = await fetch(`${BASE}/sincronizar`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `sincronizarEmpresa: ${res.status}`);
    }
    return res.json();
}

/** Erro de transmissão que a TELA precisa tratar, não só mostrar. */
export class TransmissaoBloqueada extends Error {
    /** 403 = não é o dono (T1) · 409 = insumo pendente (T3) ou já transmitida (T5) */
    constructor(
        message: string,
        public readonly status: number,
        public readonly dados: any,
    ) { super(message); this.name = 'TransmissaoBloqueada'; }
}

export async function transmitirDeclaracao(user: User | null, payload: {
    empresaId: string; empresaCnpj: string;
    anoPA: number; mesPA: number; categoria?: DctfwebCategoria;
    /** T5 — retificadora: transmitir DE NOVO a mesma competência. Exige motivo. */
    retificadora?: boolean;
    motivo?: string;
    /** T3 — seguir mesmo com insumo pendente exige justificativa escrita. */
    confirmarInsumosPendentes?: boolean;
    justificativa?: string;
}): Promise<DctfwebTransmissaoResult & { comparacao?: any; retificadora?: boolean }> {
    const res = await fetch(`${BASE}/transmitir`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        // 403/409 não são "erro do sistema": são as travas falando. A tela
        // precisa dos dados (quem é o dono, quais insumos faltam) pra oferecer
        // o caminho, em vez de só repetir a frase.
        if (res.status === 403 || res.status === 409) {
            throw new TransmissaoBloqueada(err.error || 'Transmissão bloqueada', res.status, err);
        }
        throw new Error(err.error || `transmitirDeclaracao: ${res.status}`);
    }
    return res.json();
}

export async function gerarDarf(user: User | null, payload: {
    empresaId?: string; empresaCnpj: string;
    anoPA: number; mesPA: number;
    categoria?: DctfwebCategoria;
    emAndamento?: boolean;
}): Promise<DctfwebDarfResult> {
    const res = await fetch(`${BASE}/gerar-darf`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `gerarDarf: ${res.status}`);
    }
    return res.json();
}

/** Painel "Trimestrais vencendo este mês": empresas da carteira com declaração
 *  ATIVA da competência que fecha o trimestre cujo IRPJ/CSLL vence neste mês. */
export async function listarTrimestraisMes(user: User | null): Promise<DctfwebTrimestraisMesResult> {
    const res = await fetch(`${BASE}/trimestrais-mes`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`listarTrimestraisMes: ${res.status}`);
    return res.json();
}

/** Débitos trimestrais de UMA declaração (sob demanda — 1 chamada SERPRO). */
export async function listarDebitosTrimestrais(user: User | null, params: {
    empresaCnpj: string; anoPA: number; mesPA: number; categoria?: DctfwebCategoria;
}): Promise<DctfwebDebitosTrimestraisResult> {
    const qs = new URLSearchParams({
        empresaCnpj: params.empresaCnpj,
        anoPA: String(params.anoPA),
        mesPA: String(params.mesPA),
    });
    if (params.categoria) qs.set('categoria', params.categoria);
    const res = await fetch(`${BASE}/debitos-trimestrais?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`listarDebitosTrimestrais: ${res.status}`);
    return res.json();
}

export interface DctfwebDebitoApurado {
    codReceita: string;
    codigo: string;
    extensao: string;
    descricao: string;
    valor: number;
}

export interface DctfwebDebitosResult {
    lido: boolean;
    motivo: string | null;
    debitos: DctfwebDebitoApurado[];
    total: number;
    origem: 'xml-declaracao';
    /** DE QUAL declaração vieram os números — lido do próprio XML. */
    identificacao?: { cnpj: string | null; competencia: string | null; perApuracao: string | null; categoriaDCTF: string | null };
    /** A resposta é da pergunta que foi feita? */
    conferencia?: { confere: boolean; conferivel: boolean; problemas: string[] };
}

/**
 * DÉBITOS APURADOS da declaração — a mesma tabela que o e-CAC mostra (tributo,
 * código de receita e valor). Sob demanda: 1 chamada SERPRO.
 *
 * O detalhe do CFI mostrava "Valor do resumo SERPRO: não retornado no resumo" e
 * parava aí; o e-CAC listava tudo. O dado nunca faltou — vinha do mesmo XML da
 * declaração e era descartado fora dos trimestrais.
 */
export async function listarDebitosDeclaracao(user: User | null, params: {
    empresaCnpj: string; anoPA: number; mesPA: number; categoria?: DctfwebCategoria;
}): Promise<DctfwebDebitosResult> {
    const qs = new URLSearchParams({
        empresaCnpj: params.empresaCnpj,
        anoPA: String(params.anoPA),
        mesPA: String(params.mesPA),
    });
    if (params.categoria) qs.set('categoria', params.categoria);
    const res = await fetch(`${BASE}/debitos?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `listarDebitosDeclaracao: ${res.status}`);
    }
    return res.json();
}

/**
 * Emite 1 DARF avulso (SICALC) por débito da declaração transmitida, cada um
 * com o SEU vencimento (PIS/COFINS dia 25 antecipado × IRPJ/CSLL trimestrais
 * no último dia útil do mês seguinte ao trimestre).
 */
/**
 * As quotas do trimestral que ainda não foram geradas — as do mês e as
 * ATRASADAS (quota que ninguém emitiu não some quando o mês vira; é ela que
 * está gerando multa).
 */
export async function listarQuotasAgendadas(user: User | null, mesRef?: string): Promise<DctfwebQuotasAgendadasResult> {
    const qs = mesRef ? `?mesRef=${encodeURIComponent(mesRef)}` : '';
    const res = await fetch(`${BASE}/quotas-agendadas${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`listarQuotasAgendadas: ${res.status}`);
    return res.json();
}

/** Gera a guia de UMA quota agendada, agora — com o acréscimo do mês corrente. */
export async function emitirQuotaAgendada(user: User | null, id: string): Promise<DctfwebQuotaAgendada & {
    valor: number; juros: number; multa: number; numeroDocumento: string; codigoBarras: string; pdfBase64: string;
    mensagens?: Array<{ codigo?: string; texto?: string }>;
}> {
    const res = await fetch(`${BASE}/quotas-agendadas/emitir`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ id }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `emitirQuotaAgendada: ${res.status}`);
    return j;
}

export async function gerarDarfsSeparados(user: User | null, payload: {
    empresaCnpj: string; anoPA: number; mesPA: number; categoria?: DctfwebCategoria;
    /** IRPJ/CSLL trimestrais em 1 (única), 2 ou 3 quotas (Lei 9.430 art. 5º). */
    quotasTrimestrais?: 1 | 2 | 3;
    /** Emitir só estes códigos de receita (ex.: só trimestrais). Vazio = todos. */
    apenasCodigos?: string[];
}): Promise<DctfwebDarfsSeparadosResult> {
    const res = await fetch(`${BASE}/gerar-darfs-separados`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `gerarDarfsSeparados: ${res.status}`);
    }
    return res.json();
}

export async function consultarDeclaracaoCompleta(user: User | null, params: {
    empresaCnpj: string; anoPA: number; mesPA: number; categoria?: DctfwebCategoria;
}): Promise<DctfwebPdfResult> {
    const qs = new URLSearchParams({
        empresaCnpj: params.empresaCnpj,
        anoPA: String(params.anoPA),
        mesPA: String(params.mesPA),
    });
    if (params.categoria) qs.set('categoria', params.categoria);
    const res = await fetch(`${BASE}/declaracao-completa?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`consultarDeclaracaoCompleta: ${res.status}`);
    return res.json();
}

export async function consultarRecibo(user: User | null, params: {
    empresaCnpj: string; anoPA: number; mesPA: number; categoria?: DctfwebCategoria | number;
}): Promise<DctfwebPdfResult> {
    const qs = new URLSearchParams({
        empresaCnpj: params.empresaCnpj,
        anoPA: String(params.anoPA),
        mesPA: String(params.mesPA),
    });
    if (params.categoria !== undefined) qs.set('categoria', String(params.categoria));
    const res = await fetch(`${BASE}/recibo?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`consultarRecibo: ${res.status}`);
    return res.json();
}

// ── MIT ────────────────────────────────────────────────────────────────────

export async function encerrarApuracaoMit(user: User | null, payload: {
    empresaId?: string; empresaCnpj: string;
    anoPA: number; mesPA: number;
    dadosApuracaoMit?: any;
}): Promise<DctfwebMitEncerramentoResult> {
    const res = await fetch(`${BASE}/mit/encerrar`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `encerrarApuracaoMit: ${res.status}`);
    }
    return res.json();
}

// ── Preenchimento automático de débitos do MIT ─────────────────────────────
// Duas fases: transmitir=false devolve a PROPOSTA (mapeamento família/código/
// valor + período-modelo); transmitir=true monta de novo no servidor e
// transmite o encerramento (ENCAPURACAO314) com log de auditoria.

export interface MitPreencherProposta {
    pa: string;
    /** 'completo' = MIT estava sem débitos; 'complemento' = só famílias
     *  faltantes adicionadas; 'criacao' = a apuração não existia e será
     *  CRIADA (DadosIniciais copiados do mês-modelo) e encerrada. */
    modo?: 'completo' | 'complemento' | 'criacao';
    tributosApp: { IRPJ: number; CSLL: number; PIS: number; COFINS: number; IPI?: number };
    mapeamento: Array<{ familia: string; codigo: string; grupo: string; valor: number }>;
    totalProposto: number;
    /** Famílias já lançadas no MIT — preservadas sem alteração */
    jaDeclarados?: Array<{ familia: string; valor: number }>;
    /** Famílias que o usuário DESMARCOU — ficam de fora desta transmissão */
    familiasDesmarcadas?: Array<{ familia: string; valor: number }>;
    modeloPeriodo: string | null;
    alvoIdApuracao: number | null;
    /** Dados iniciais usados na transmissão (conferência — vital no modo criação) */
    dadosIniciaisResumo?: {
        qualificacaoPj: number | null;
        tributacaoLucro: number | null;
        cpfResponsavel: string | null;
    };
}

export interface MitPreencherResult {
    ok: boolean;
    transmitido?: boolean;
    etapa?: 'alvo' | 'modelo' | 'montagem' | 'selecao';
    motivo?: string;
    proposta?: MitPreencherProposta;
    protocolo?: string;
    statusEncerramento?: string;
    /** Campos que o SERPRO recusou ("não deve ser informado") e foram removidos na retransmissão */
    camposRemovidos?: string[];
}

/** 409 da trava de insumos: a DCTFWeb tem insumo pendente de outro departamento. */
export interface TravaInsumosPendentes {
    bloqueado: true;
    veredito: 'incompleto';
    frase: string;
    selos: Array<{ rotulo: string; estado: string; detalhe: string }>;
    acao: string;
}

export async function preencherEncerrarMit(user: User | null, payload: {
    empresaId?: string; empresaCnpj: string;
    anoPA: number; mesPA: number;
    tributosApp: { IRPJ: number; CSLL: number; PIS: number; COFINS: number; IPI?: number };
    /** Quais famílias transmitir agora. Omitido = todas as faltantes. Só restringe. */
    familiasSelecionadas?: string[] | null;
    transmitir: boolean;
    /** Confirma encerrar MESMO com insumo de outro departamento pendente (auditado). */
    confirmarInsumosPendentes?: boolean;
}): Promise<MitPreencherResult | { travaInsumos: TravaInsumosPendentes }> {
    const res = await fetch(`${BASE}/mit/preencher-encerrar`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (res.status === 409) {
        const trava = await res.json().catch(() => null);
        if (trava?.bloqueado) return { travaInsumos: trava as TravaInsumosPendentes };
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `preencherEncerrarMit: ${res.status}`);
    }
    return res.json();
}

// ── Retificação da apuração MIT já encerrada (ADMIN) ──────────────────────
// Reencerra o MIT com os valores do app; a DCTFWeb RETIFICADORA é gerada
// automaticamente pela Receita. Backend exige role admin (403 pros demais).

export interface MitRetificarProposta {
    pa: string;
    modo: 'retificacao';
    tributosApp: { IRPJ: number; CSLL: number; PIS: number; COFINS: number; IPI?: number };
    mapeamento: Array<{
        familia: string; codigo: string; grupo: string;
        antes: number; depois: number; diferenca: number;
        acao: 'ajustado' | 'mantido' | 'incluido';
    }>;
    totalAntes: number;
    totalDepois: number;
    alvoIdApuracao: number | null;
    dadosIniciaisResumo?: {
        qualificacaoPj: number | null;
        tributacaoLucro: number | null;
        cpfResponsavel: string | null;
    };
}

export interface MitRetificarResult {
    ok: boolean;
    transmitido?: boolean;
    etapa?: 'alvo' | 'montagem';
    motivo?: string;
    proposta?: MitRetificarProposta;
    protocolo?: string;
    statusEncerramento?: string;
    camposRemovidos?: string[];
}

export async function retificarMit(user: User | null, payload: {
    empresaId?: string; empresaCnpj: string;
    anoPA: number; mesPA: number;
    tributosApp: { IRPJ: number; CSLL: number; PIS: number; COFINS: number; IPI?: number };
    transmitir: boolean;
}): Promise<MitRetificarResult> {
    const res = await fetch(`${BASE}/mit/retificar`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `retificarMit: ${res.status}`);
    }
    return res.json();
}

export async function consultarStatusEncerramentoMit(user: User | null, params: {
    empresaCnpj: string; protocolo?: string; anoPA?: number; mesPA?: number;
}): Promise<{ statusEncerramento: string; protocolo: string; fonte: 'mock' | 'serpro'; _raw?: any }> {
    const qs = new URLSearchParams({ empresaCnpj: params.empresaCnpj });
    if (params.protocolo) qs.set('protocolo', params.protocolo);
    if (params.anoPA) qs.set('anoPA', String(params.anoPA));
    if (params.mesPA) qs.set('mesPA', String(params.mesPA));
    const res = await fetch(`${BASE}/mit/status?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`consultarStatusEncerramentoMit: ${res.status}`);
    return res.json();
}

export async function consultarApuracaoMit(user: User | null, params: {
    empresaCnpj: string; anoPA: number; mesPA: number;
}): Promise<DctfwebMitApuracao> {
    const qs = new URLSearchParams({
        empresaCnpj: params.empresaCnpj,
        anoPA: String(params.anoPA),
        mesPA: String(params.mesPA),
    });
    const res = await fetch(`${BASE}/mit/apuracao?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`consultarApuracaoMit: ${res.status}`);
    return res.json();
}

export async function consultarApuracoesAno(user: User | null, params: {
    empresaCnpj: string; anoPA: number;
}): Promise<DctfwebMitHistorico> {
    const qs = new URLSearchParams({
        empresaCnpj: params.empresaCnpj,
        anoPA: String(params.anoPA),
    });
    const res = await fetch(`${BASE}/mit/historico?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`consultarApuracoesAno: ${res.status}`);
    return res.json();
}

// ── Helpers de display ─────────────────────────────────────────────────────

function cleanBase64(base64: string): string {
    return base64.includes(',') ? base64.split(',').pop() || '' : base64;
}

export function pdfBlobFromBase64(base64: string): Blob {
    const byteChars = atob(cleanBase64(base64));
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'application/pdf' });
}

export function createPdfObjectUrlFromBase64(base64: string): string {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        return URL.createObjectURL(pdfBlobFromBase64(base64));
    }
    return `data:application/pdf;base64,${cleanBase64(base64)}`;
}

export function revokePdfObjectUrl(url: string): void {
    if (url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
    }
}

export function downloadPdfFromBase64(base64: string, filename: string): void {
    if (!base64) return;
    const url = createPdfObjectUrlFromBase64(base64);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => revokePdfObjectUrl(url), 60000);
}

export function openPdfFromBase64(base64: string): void {
    if (!base64) return;
    const url = createPdfObjectUrlFromBase64(base64);
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => revokePdfObjectUrl(url), 60000);
}

export function formatPaLabel(anoPA: number, mesPA: number): string {
    return `${String(mesPA).padStart(2, '0')}/${anoPA}`;
}

export function situacaoLabel(s: string): string {
    const map: Record<string, string> = {
        EM_ANDAMENTO: 'Em andamento',
        ATIVA: 'Transmitida',
        ENCERRADA: 'Encerrada',
        DESCONHECIDA: 'Desconhecida',
    };
    return map[s] || s;
}

export function situacaoColorClass(s: string): string {
    const map: Record<string, string> = {
        EM_ANDAMENTO: 'bg-amber-100 text-amber-800',
        ATIVA: 'bg-emerald-100 text-emerald-800',
        ENCERRADA: 'bg-slate-100 text-slate-800',
        DESCONHECIDA: 'bg-slate-100 text-slate-500',
    };
    return map[s] || 'bg-slate-100 text-slate-700';
}
