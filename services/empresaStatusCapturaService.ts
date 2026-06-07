/**
 * empresaStatusCapturaService.ts
 *
 * Cliente do endpoint /api/admin/sefaz/empresas-status-captura.
 * Retorna estado por empresa: cert A1/A3, procuração e-CAC, NFSe SP/Nacional.
 */

import { getAuth } from 'firebase/auth';

export interface EmpresaStatusCaptura {
    id: string;
    cnpj: string;
    nome: string;
    regime: 'simples' | 'lucro';
    fonte: 'simples_empresas' | 'lucro_empresas';
    uf: string;
    tipoCert: 'A1' | 'A3' | 'escritorio' | 'nenhum';
    certUploaded: boolean;
    certValido: boolean;
    certVenceEm: string | null;
    usaCertEscritorio: boolean;
    /** Inferida: true se (flag bruta=true) OU (tem cert A1/A3 próprio).
     *  Pra UI mostrar "ativa" amigável, mas atenção: captura via Cloud Run
     *  PRECISA da flag bruta=true (procuração real no e-CAC), pois cert A3
     *  não roda no Cloud Run mesmo sendo próprio. */
    procuracaoEcacAtiva: boolean;
    /** Valor cru do campo no Firestore (procuracaoEcacAtiva no doc da empresa).
     *  Esse é o que o cron e o orchestrator usam — se for false, captura
     *  via cert do escritório (procuração) NÃO é tentada. */
    procuracaoEcacFlagBruta: boolean;
    ccmSp: string;
    nfseSpAutorizado: boolean;
    nfseNacionalDfeAtivo: boolean;
    capturarSefaz: boolean;
    capturaNfeOk: boolean;
    capturaNfseSpOk: boolean;
    capturaNfseNacionalOk: boolean;
    motivosBloqueio: string[];
    responsaveis: { nome: string; papel: 'principal' | 'backup' }[];
    ultimaSyncMs: number | null;
    ultNSU: string | null;
    cStatUltimaSync: string | null;
}

export interface EmpresaStatusResumo {
    total: number;
    semUf: number;
    comCertA1: number;
    comCertA3: number;
    usandoCertEscritorio: number;
    semCertNenhum: number;
    certExpirado: number;
    certVenceEm30d: number;
    comProcuracaoEcac: number;
    semProcuracaoEcac: number;
    ccmSpAutorizado: number;
    nfseNacionalAtivo: number;
    capturaNfeOk: number;
    capturaNfeBloqueada: number;
    capturaNfseSpOk: number;
    capturaNfseNacionalOk: number;
}

export interface EmpresaStatusResponse {
    resumo: EmpresaStatusResumo;
    empresas: EmpresaStatusCaptura[];
    geradoEm: string;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

export async function fetchEmpresasStatusCaptura(): Promise<EmpresaStatusResponse> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/empresas-status-captura', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export type FlagCampo = 'procuracaoEcacAtiva' | 'nfseNacionalDfeAtivo' | 'capturarSefaz';

export async function toggleEmpresaFlag(cnpj: string, campo: FlagCampo, valor: boolean): Promise<{ ok: boolean; atualizadas?: number; error?: string }> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/empresa-toggle-flag', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj, campo, valor }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, atualizadas: data.atualizadas };
}

export async function autoPreencherUf(): Promise<{ ok: boolean; motivo?: string; error?: string }> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/auto-preencher-uf', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, motivo: data.motivo };
}

export function exportarEmpresasCsv(empresas: EmpresaStatusCaptura[]): string {
    const headers = [
        'CNPJ', 'Razão Social', 'Regime', 'Responsável', 'Tipo Cert', 'Cert Válido',
        'Cert Vence', 'Procuração e-CAC', 'CCM SP', 'NFSe SP Autorizado',
        'NFSe Nacional Ativo', 'Captura NFe OK', 'Captura NFSe SP OK',
        'Captura NFSe Nacional OK', 'Motivos Bloqueio',
    ];
    const fmtResponsaveis = (rs: EmpresaStatusCaptura['responsaveis']) =>
        rs.length === 0 ? 'sem responsável' : rs.map(r => `${r.nome} (${r.papel})`).join(' · ');
    const rows = empresas.map(e => [
        e.cnpj, `"${e.nome.replace(/"/g, '""')}"`,
        e.regime,
        `"${fmtResponsaveis(e.responsaveis || []).replace(/"/g, '""')}"`,
        e.tipoCert, e.certValido ? 'sim' : 'não',
        e.certVenceEm || '—',
        e.procuracaoEcacAtiva ? 'sim' : 'não',
        e.ccmSp || '—',
        e.nfseSpAutorizado ? 'sim' : 'não',
        e.nfseNacionalDfeAtivo ? 'sim' : 'não',
        e.capturaNfeOk ? 'sim' : 'NÃO',
        e.capturaNfseSpOk ? 'sim' : 'NÃO',
        e.capturaNfseNacionalOk ? 'sim' : 'NÃO',
        `"${e.motivosBloqueio.join(' · ').replace(/"/g, '""')}"`,
    ].join(','));
    return [headers.join(','), ...rows].join('\n');
}
