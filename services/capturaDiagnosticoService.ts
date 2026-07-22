/**
 * capturaDiagnosticoService.ts
 *
 * Cliente do endpoint /api/admin/sefaz/captura-diagnostico — estado
 * consolidado das 3 capturas noturnas (NFe DistDFe, NFSe SP, NFSe Nacional).
 *
 * Usado pelo CapturaDiagnosticoPanel pra mostrar ao admin se a captura
 * REAL de XMLs está rodando ou parou.
 */

import { getAuth } from 'firebase/auth';

export interface CronLog {
    executadoEmMs: number | null;
    duracaoMs: number | null;
    totalEmpresas: number | null;
    sucessos: number | null;
    falhas: number | null;
    totalNovos: number | null;
    erroFatal: string | null;
    fonte: string | null;
    /** 'iniciado' = run em andamento (heartbeat); 'sucesso' | 'falha' no fim. */
    status?: string | null;
}

export interface CapturaStatus {
    fonte: string;
    endpointCron: string;
    schedulerEsperado: string;
    ultimoCron: CronLog | null | { erro: string };
    state: {
        total: number;
        travadas: number | null;
        bloqueadas?: number | null;
        totalAtivas?: number | null;
        bloqueiosPorMotivo?: Record<string, number>;
        elegiveisLista?: Array<{ nome: string; cnpj: string }> | null;
    } | { erro: string };
    docsUltimos7d: number | null;
    /** Top motivos de falha da última execução (hoje só NFSe SP envia). */
    topFalhas?: { executadoEm: string | null; top: Array<{ motivo: string; quantidade: number }> } | null;
    /** Total histórico de docs desta fonte (hoje só NFSe Nacional envia) —
     *  separa "nunca capturou" (elegibilidade) de "capturava e parou" (quebra). */
    docsTotalHistorico?: number | null;
}

export interface CapturaDiagnostico {
    janela: {
        dentro: boolean;
        agoraBRT: string;
        motivo?: string;
    };
    capturas: {
        sefazNfe: CapturaStatus;
        nfseSp: CapturaStatus;
        nfseNacional: CapturaStatus;
    };
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

export async function fetchCapturaDiagnostico(): Promise<CapturaDiagnostico> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/captura-diagnostico', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

/**
 * Dispara o cron de NFe manualmente (mesma rota do Cloud Scheduler).
 * Precisa do x-cron-secret — não disponível no front, então este chama
 * o endpoint de admin que roda o cron com a auth Bearer + verifica role.
 */
export type CronLogColecao =
    | 'sefaz_cron_logs'
    | 'nfsesp_cron_logs'
    | 'nfse_nacional_dfe_cron_logs'
    | 'das_cron_logs'
    | 'caixa_postal_cron_logs'
    | 'dctfweb_cron_logs'
    | 'manifestacoes_cron_logs'
    | 'vencimentos_cron_logs';

export interface CronLogErroResumoItem {
    cnpj: string | null;
    ccm: string | null;
    nome: string | null;
    erroPrestador: string | null;
    erroTomador: string | null;
    motivo: string | null;
    status: string | null;
}

export interface CronLogItem extends CronLog {
    id: string;
    processadas?: number | null;
    metodoLogin?: string | null;
    capturadoPor?: string | null;
    periodo?: string | null;
    prestadoresAutorizados?: number | null;
    errosResumo?: CronLogErroResumoItem[] | null;
}

export async function fetchCronLogs(colecao: CronLogColecao, limit = 20): Promise<CronLogItem[]> {
    const token = await getToken();
    const res = await fetch(`/api/admin/sefaz/cron-logs?col=${encodeURIComponent(colecao)}&limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.logs || [];
}

// ── Saúde unificada de TODOS os crons (/api/admin/crons/health) ─────────────
export type CronSaude = 'ok' | 'atrasado' | 'travado' | 'falha' | 'sem-dados' | 'erro-leitura';

export interface CronSaudeLinha {
    collection: string;
    label: string;
    saude: CronSaude;
    tsMs?: number | null;
    idadeHoras?: number | null;
    duracaoMs?: number | null;
    status?: string;
    resumo?: Record<string, number>;
    erro?: string;
}

export interface CronsHealth {
    geradoEm: string;
    totalCrons: number;
    problemas: number;
    linhas: CronSaudeLinha[];
}

export async function fetchCronsHealth(): Promise<CronsHealth> {
    const token = await getToken();
    const res = await fetch('/api/admin/crons/health', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.erro || err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

// ── Guia de caminho de captura de NFS-e por município (2026) ────────────────
export type CaminhoNfse = 'adn' | 'sp-portal' | 'abrasf';

export interface MunicipioCaminho {
    cod: string;
    nome: string;
    uf: string;
    caminho: CaminhoNfse;
    obs: string;
}

export interface NfseMunicipiosGuia {
    padrao2026: CaminhoNfse;
    nota: string;
    municipios: MunicipioCaminho[];
}

export async function fetchNfseMunicipiosCaminho(): Promise<NfseMunicipiosGuia> {
    const token = await getToken();
    const res = await fetch('/api/admin/abrasf/municipios-caminho', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.erro || err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export async function forcarCapturaAgora(fonte: 'sefazNfe' | 'nfseSp' | 'nfseNacional'): Promise<{ ok: boolean; motivo?: string }> {
    const token = await getToken();
    const paths: Record<typeof fonte, string> = {
        sefazNfe: '/api/admin/sefaz/sync-cron-now',
        // 22/07: NFSe SP aponta pro trilho PORTAL CSV — o WS legado (nfsesp-
        // cron-now) devolve 1102 pra tudo e foi aposentado.
        nfseSp: '/api/admin/sefaz/nfsesp-portal-cron-now',
        nfseNacional: '/api/admin/nfse-nacional-dfe/sync-cron-now',
    };
    const res = await fetch(paths[fonte], {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, motivo: data.error || `HTTP ${res.status}` };
    return { ok: true, motivo: data.motivo };
}
