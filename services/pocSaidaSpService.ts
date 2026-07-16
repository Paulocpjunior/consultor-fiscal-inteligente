/**
 * pocSaidaSpService.ts
 *
 * Cliente do endpoint /api/admin/sefaz/poc-saida-sp (Fase F0).
 *
 * Reconhecimento do portal SEFAZ-SP para captura de NF-e de SAIDA: valida se
 * o A1 da empresa (do cofre) autentica via mTLS e detecta WAF/captcha. Somente
 * leitura — nao grava nada. Usado pelo painel PocSaidaSpRecon (aba admin).
 */

import { getAuth } from 'firebase/auth';

export interface PocCertInfo {
    subjectCN: string;
    issuerCN: string;
    cnpj: string | null;
    raizConfere: boolean;
    notBefore: string;
    notAfter: string;
    expirado: boolean;
    diasParaVencer: number;
}

export interface PocCertDiagnostico {
    ok: false;
    motivo: string;
    baseAlvo?: string;
    basesNoCofre?: string[];
    cert?: { empresaId?: string; cnpj?: string; tipoCert?: string; notAfter?: string };
}

export interface PocWafMarcador { tipo: string; evidencia: string; }

export interface PocSondagem {
    id: string;
    label: string;
    porqueImporta: string;
    urlInicial: string;
    urlFinal: string;
    handshakeMtlsOk: boolean;
    erroTls: string | null;
    tls: { protocolo: string | null; cifra: string | null; servidorAutorizado: boolean } | null;
    statusFinal: number | null;
    tituloPagina: string | null;
    redirects: Array<{ url: string; statusCode: number | undefined; location: string | null }>;
    cookiesSessao: string[];
    waf: { bloqueado: boolean; marcadores: PocWafMarcador[] };
    bodySnippet: string | null;
}

export interface PocSaidaSpResposta {
    ok: boolean;
    fase?: string;
    geradoEm?: string;
    duracaoMs?: number;
    certEmpresa?: { empresaId: string | null; cnpj: string | null };
    certInfo?: PocCertInfo;
    sondagens?: PocSondagem[];
    veredito?: { houveWaf: boolean; algumMtls: boolean; recomendacao: string };
    // Erros (404 cert nao encontrada, 401/403, 500)
    error?: string;
    dica?: string;
    diagnostico?: PocCertDiagnostico | null;
    httpStatus?: number;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

/**
 * Roda o reconhecimento F0 para um CNPJ (ou empresaId). Passe extraUrl para
 * sondar um endpoint adicional (ex.: a URL exata da tela de NF-e emitidas).
 */
export async function rodarReconhecimentoSaidaSp(
    params: { cnpj?: string; empresaId?: string; extraUrl?: string },
): Promise<PocSaidaSpResposta> {
    const token = await getToken();
    const qs = new URLSearchParams();
    if (params.empresaId) qs.set('empresaId', params.empresaId);
    if (params.cnpj) qs.set('cnpj', params.cnpj.replace(/\D/g, ''));
    if (params.extraUrl) qs.set('url', params.extraUrl);

    const res = await fetch(`/api/admin/sefaz/poc-saida-sp?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    let data: PocSaidaSpResposta;
    try {
        data = await res.json();
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta nao-JSON)`, httpStatus: res.status };
    }
    if (!res.ok) return { ...data, ok: false, httpStatus: res.status };
    return data;
}

// ── Teste F0.5: baixar 1 saída completa via consChNFe com o A1 da empresa ────

export interface PocSaidaXmlInfo {
    schema: string | null;
    nsu: string | null;
    tamanho: number;
    ehCompleta: boolean;
    ehResumo: boolean;
    ehEvento: boolean;
    temInfNFe: boolean;
    snippet: string | null;
}

export interface PocSaidaCompletaResposta {
    ok: boolean;
    chave?: string;
    chaveAutoSelecionada?: boolean;
    cnpjEmitente?: string;
    uf?: string;
    certFonte?: { empresaId: string | null; cnpj: string | null };
    cStat?: string | null;
    xMotivo?: string | null;
    totalXmls?: number;
    temCompleta?: boolean;
    veredito?: 'completa_disponivel' | 'nada_encontrado_137' | 'so_resumo' | 'rate_limited_656' | 'inconclusivo';
    interpretacao?: string;
    xmls?: PocSaidaXmlInfo[];
    error?: string;
    dica?: string;
    diagnostico?: PocCertDiagnostico | null;
    httpStatus?: number;
}

/**
 * Baixa UMA nota de saída pela chave via consChNFe usando o A1 da empresa
 * emitente (derivado da própria chave). Somente leitura — não persiste nada.
 */
export async function testarDownloadSaida(chave: string): Promise<PocSaidaCompletaResposta> {
    const chaveLimpa = chave.replace(/\D/g, '');
    return chamarDownload(`chave=${encodeURIComponent(chaveLimpa)}`);
}

/**
 * Auto-seleciona uma saída pendente do CNPJ e testa o download — um clique,
 * sem precisar achar a chave manualmente.
 */
export async function autoTestarDownloadSaida(cnpj: string): Promise<PocSaidaCompletaResposta> {
    const c = cnpj.replace(/\D/g, '');
    return chamarDownload(`cnpj=${encodeURIComponent(c)}`);
}

async function chamarDownload(qs: string): Promise<PocSaidaCompletaResposta> {
    const token = await getToken();
    const res = await fetch(`/api/admin/sefaz/poc-saida-completa?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    let data: PocSaidaCompletaResposta;
    try {
        data = await res.json();
    } catch {
        return { ok: false, error: `HTTP ${res.status} (resposta nao-JSON)`, httpStatus: res.status };
    }
    if (!res.ok) return { ...data, ok: false, httpStatus: res.status };
    return data;
}
