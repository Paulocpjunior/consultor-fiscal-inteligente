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
