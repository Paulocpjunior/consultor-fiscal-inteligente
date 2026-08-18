/**
 * dfeCaptureService.ts (Fase 2 — captura real via backend)
 */

import { getAuth } from 'firebase/auth';
import type { User, XmlCaptura, EmpresaXmlConfig } from '../types';
import { interpretarCstat } from './cstatHelper';

export interface DfeCaptureRequest {
    empresa: EmpresaXmlConfig;
    user: User;
    desde?: string;
    ate?: string;
    /** Zera o cursor NSU — SEFAZ reenvia ~90 dias de DF-e. Só admin. */
    resetNSU?: boolean;
}

export interface DfeCaptureResultItem {
    chave: string;
    capturado: boolean;
    motivo?: string;
}

export interface DfeDocProcessado {
    nsu: string | null;
    schema: string | null;
    chave: string | null;
    status: 'ok' | 'duplicado' | 'erro-import' | 'excecao-import' | 'erro-descompressao';
    motivo: string | null;
}

export interface DfeCaptureResult {
    sucesso: boolean;
    motivo: string;
    itens: DfeCaptureResultItem[];
    registros?: XmlCaptura[];
    novosXmls?: number;
    duplicados?: number;
    erros?: number;
    ultNSU?: string;
    cStat?: string;
    xMotivo?: string;
    paginas?: number;
    rateLimited?: boolean;
    foraDeJanela?: boolean;
    documentosProcessados?: DfeDocProcessado[];
    /** NSUs que a SEFAZ ainda tem além do cursor (>0 = ainda faltam docs). */
    pendenciaNSU?: number;
    /** Resumos que entraram na fila de Ciência pós-captura. */
    cienciasEnfileiradas?: number;
}

export interface SefazWindow {
    dentro: boolean;
    agoraBRT: string;
    diaSemana: number;
    motivo?: string;
}

export interface SefazState {
    cnpj: string;
    state: {
        ultNSU?: string;
        ultimaSync?: { _seconds: number } | string;
        ultimoColaborador?: string;
        cStatUltimaSync?: string;
        xMotivoUltimaSync?: string;
        paginas?: number;
        maxNSUUltimaSync?: string;
        pendenciaNSU?: number;
    } | null;
    lock: {
        startedAt?: any;
        expiresAt?: any;
        lockedBy?: string;
        ativo?: boolean;
    } | null;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

export async function captureFromSefaz(req: DfeCaptureRequest): Promise<DfeCaptureResult> {
    try {
        const token = await getToken();
        const res = await fetch('/api/admin/sefaz/sync-one', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ empresaId: req.empresa.id, empresaCnpj: String((req.empresa as any).cnpj || '').replace(/\D/g, ''), resetNSU: !!req.resetNSU }),
        });
        const data = await res.json();
        if (res.status === 403) {
            return { sucesso: false, motivo: data.motivo || 'Fora da janela operacional', itens: [], foraDeJanela: true };
        }
        if (res.status === 409) {
            return { sucesso: false, motivo: data.motivo || 'Já sincronizado recentemente', itens: [], ultNSU: data.ultNSU };
        }
        if (res.status === 429) {
            return { sucesso: false, motivo: data.motivo || 'SEFAZ rate limit (cStat 656)', itens: [], rateLimited: true };
        }
        if (!res.ok) {
            return { sucesso: false, motivo: data.error || data.motivo || `Falha HTTP ${res.status}`, itens: [] };
        }
        // Monta motivo verboso: SEFAZ cStat + qty + NSU + AÇÃO acionável.
        // Antes ficava só "cStat=593 Rejeicao: CNPJ-Base..." e ninguém
        // sabia que precisava cadastrar procuração no e-CAC. Agora o
        // interpretarCstat traduz pra ação prática.
        const cStatLabel = data.cStat ? `cStat=${data.cStat}` : '';
        const xMotivo = data.xMotivo ? ` ${data.xMotivo}` : '';
        const nsu = data.ultNSU ? ` · NSU agora=${data.ultNSU}` : '';
        const pag = data.paginas ? ` · ${data.paginas} pág` : '';
        const cInfo = data.cStat ? interpretarCstat(data.cStat, data.xMotivo) : null;
        const acao = cInfo?.acao ? ` ⚠ ${cInfo.acao}` : '';
        const pendencia = (data.pendenciaNSU || 0) > 0
            ? ` · ⏳ ~${data.pendenciaNSU} doc(s) ainda na fila da SEFAZ (capture de novo em ~1h ou aguarde o próximo ciclo)`
            : '';
        const ciencias = (data.cienciasEnfileiradas || 0) > 0
            ? ` · ${data.cienciasEnfileiradas} resumo(s) manifestando (completa vem no próximo ciclo)`
            : '';
        return {
            sucesso: true,
            motivo: `${data.novosXmls || 0} novos · ${data.duplicados || 0} dup · ${data.erros || 0} erros${cStatLabel ? ` · ${cStatLabel}${xMotivo}` : ''}${nsu}${pag}${pendencia}${ciencias}${acao}`,
            itens: [],
            novosXmls: data.novosXmls,
            duplicados: data.duplicados,
            erros: data.erros,
            ultNSU: data.ultNSU,
            cStat: data.cStat,
            documentosProcessados: data.documentosProcessados,
            xMotivo: data.xMotivo,
            paginas: data.paginas,
            pendenciaNSU: data.pendenciaNSU,
            cienciasEnfileiradas: data.cienciasEnfileiradas,
        };
    } catch (err: any) {
        return { sucesso: false, motivo: err.message || 'Erro de rede', itens: [] };
    }
}

export function isSefazCaptureAvailable(): boolean {
    return true;
}

/**
 * Captura de CT-e (18/08) — mesmo contrato de `captureFromSefaz`, mas chama
 * a rota /sync-cte-one, admin-only e SEM a opção resetNSU (o cursor de CT-e
 * é próprio e ainda não tem trilho de "recapturar 90d").
 *
 * PROVA-DE-CONCEITO: este é o caminho pra Paulo testar em produção antes de
 * o CT-e entrar no cron noturno — o webservice `CTeDistribuicaoDFe` nunca
 * foi chamado daqui, e a rede da SEFAZ é bloqueada do ambiente de
 * desenvolvimento, então a única prova real é este clique.
 */
export async function captureCteFromSefaz(req: { empresa: EmpresaXmlConfig; user: User }): Promise<DfeCaptureResult> {
    try {
        const token = await getToken();
        const res = await fetch('/api/admin/sefaz/sync-cte-one', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                empresaId: req.empresa.id,
                empresaCnpj: String((req.empresa as any).cnpj || '').replace(/\D/g, ''),
            }),
        });
        const data = await res.json();
        if (res.status === 403) {
            return { sucesso: false, motivo: data.motivo || 'Fora da janela operacional', itens: [], foraDeJanela: true };
        }
        if (res.status === 409) {
            return { sucesso: false, motivo: data.motivo || 'Já sincronizado recentemente', itens: [] };
        }
        if (res.status === 429) {
            return { sucesso: false, motivo: data.motivo || 'SEFAZ rate limit (cStat 656)', itens: [], rateLimited: true };
        }
        if (!res.ok) {
            return { sucesso: false, motivo: data.error || data.motivo || `Falha HTTP ${res.status}`, itens: [] };
        }
        const cStatLabel = data.cStat ? `cStat=${data.cStat}` : '';
        const xMotivo = data.xMotivo ? ` ${data.xMotivo}` : '';
        const nsu = data.ultNSU ? ` · NSU agora=${data.ultNSU}` : '';
        const pag = data.paginas ? ` · ${data.paginas} pág` : '';
        return {
            sucesso: true,
            motivo: `${data.novosXmls || 0} novo(s) CT-e · ${data.duplicados || 0} dup · ${data.erros || 0} erros${cStatLabel ? ` · ${cStatLabel}${xMotivo}` : ''}${nsu}${pag}`,
            itens: [],
            novosXmls: data.novosXmls,
            duplicados: data.duplicados,
            erros: data.erros,
            ultNSU: data.ultNSU,
            cStat: data.cStat,
            documentosProcessados: data.documentosProcessados,
            xMotivo: data.xMotivo,
            paginas: data.paginas,
            pendenciaNSU: data.pendenciaNSU,
        };
    } catch (err: any) {
        return { sucesso: false, motivo: err.message || 'Erro de rede', itens: [] };
    }
}

export async function scheduleAutoCapture(_e: EmpresaXmlConfig): Promise<{ ok: boolean; motivo: string }> {
    return {
        ok: true,
        motivo: 'Captura automática roda 02:00 BRT seg-sex via Cloud Scheduler. Configure capturarSefaz=true na empresa.',
    };
}

export async function getSefazState(cnpj: string): Promise<SefazState | null> {
    try {
        const token = await getToken();
        const res = await fetch(`/api/admin/sefaz/state/${encodeURIComponent(cnpj)}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

let sefazWindowCache: { expiresAt: number; value: Promise<SefazWindow | null> } | null = null;
const SEFAZ_WINDOW_CACHE_MS = 30_000;

export async function getSefazWindow(): Promise<SefazWindow | null> {
    const now = Date.now();
    if (sefazWindowCache && now < sefazWindowCache.expiresAt) {
        return sefazWindowCache.value;
    }

    sefazWindowCache = {
        expiresAt: now + SEFAZ_WINDOW_CACHE_MS,
        value: (async () => {
            try {
                const token = await getToken();
                const res = await fetch('/api/admin/sefaz/window', {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                if (!res.ok) return null;
                return await res.json();
            } catch {
                return null;
            }
        })(),
    };

    try {
        return await sefazWindowCache.value;
    } catch {
        sefazWindowCache = null;
        return null;
    }
}

export async function toggleSefazCapture(cnpj: string, ativo: boolean): Promise<{ ok: boolean; motivo?: string; ativo?: boolean }> {
    try {
        const token = await getToken();
        const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
        const res = await fetch(`/api/admin/sefaz/toggle/${encodeURIComponent(cnpjLimpo)}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ativo }),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, motivo: data.error || `Falha HTTP ${res.status}` };
        return { ok: true, ativo: data.ativo };
    } catch (err: any) {
        return { ok: false, motivo: err.message || 'Erro de rede' };
    }
}
