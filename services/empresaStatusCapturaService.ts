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
    tipoCert: 'A1' | 'A1-raiz' | 'A3' | 'escritorio' | 'nenhum';
    certUploaded: boolean;
    certValido: boolean;
    certVenceEm: string | null;
    usaCertEscritorio: boolean;
    usaA1MesmaRaiz?: boolean;
    /** Valor operacional da procuração e-CAC no cadastro. Certificado próprio
     *  não é tratado como procuração. */
    procuracaoEcacAtiva: boolean;
    /** Valor cru do campo no Firestore (procuracaoEcacAtiva no doc da empresa).
     *  Esse é o que o cron e o orchestrator usam — se for false, captura
     *  via cert do escritório (procuração) NÃO é tentada. */
    procuracaoEcacFlagBruta: boolean;
    /** true = empresa arquivada (soft-delete); só aparece com incluirArquivadas. */
    arquivada?: boolean;
    ccmSp: string;
    nfseSpAutorizado: boolean;
    /** Trilho do portal SP-capital se aplica? false = município do cadastro
     *  não é SP capital — NFS-e vem pelo Padrão Nacional (ADN). */
    nfseSpAplicavel?: boolean;
    municipioNfse?: string | null;
    nfseNacionalDfeAtivo: boolean;
    capturarSefaz: boolean;
    capturaNfeOk: boolean;
    capturaNfseSpOk: boolean;
    capturaNfseNacionalOk: boolean;
    capturaNfseNacionalVia?: 'cloud-a1' | 'a3-local' | 'inativa' | 'bloqueada';
    motivosBloqueio: string[];
    /** dadosFiscais completo — semeia o modal "Completar cadastro". */
    dadosFiscais?: import('../types').EmpresaDadosFiscais;
    responsaveis: { nome: string; papel: 'principal' | 'backup' }[];
    ultimaSyncMs: number | null;
    ultNSU: string | null;
    cStatUltimaSync: string | null;
    /**
     * Empresa A3 é capturada pelo agente local `cfi-a3`, fora do cron em
     * nuvem — e o painel dizia "✓ Captura OK" só porque alguém marcou A3 no
     * cadastro. Aqui vem se o agente ENTREGOU, e quando.
     */
    coberturaA3?: import('../sefaz-backend/captura-a3-cobertura').CoberturaA3;
}

export interface EmpresaStatusResumo {
    total: number;
    semUf: number;
    comCertA1: number;
    comCertA3: number;
    /** Das A3, quantas o agente local nunca entregou documento. */
    a3SemEntrega?: number;
    a3ComEntrega?: number;
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

export interface EmpresaStatusActionResult {
    ok: boolean;
    atualizadas?: number;
    error?: string;
    code?: string;
    cnpj?: string;
    status?: number;
}

function formatarCnpjDisplay(cnpj?: string | null): string {
    const digits = (cnpj || '').replace(/\D/g, '');
    return digits.length === 14
        ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
        : (cnpj || '');
}

export function formatarMotivoBloqueioCaptura(motivo: string): string {
    const raw = motivo || '';
    if (/flag nfseNacionalDfeAtivo desabilitada/i.test(raw)) {
        return 'NFS-e Nacional ADN desativada no cadastro. Ative NFS-e Nacional para incluir esta empresa na captura ADN.';
    }
    if (/NFSe SP: falta Inscrição Municipal \(ccmSp\)/i.test(raw)) {
        return 'NFS-e SP: falta Inscrição Municipal (CCM) nos dados fiscais da empresa.';
    }
    if (/NFSe SP: falta autorização do escritório/i.test(raw)) {
        return 'NFS-e SP: falta autorizar o escritório no portal nfe.prefeitura.sp.gov.br.';
    }
    if (/Tipo A3 sem procuração e-CAC/i.test(raw)) {
        return 'NFe: certificado A3 roda pelo agente local. Para captura em nuvem, use A1 próprio ou A1 da mesma raiz CNPJ.';
    }
    if (/sem certificado A1 pr[oó]prio\/mesma raiz CNPJ/i.test(raw) || /Sem certificado A1\/A3 e sem procuração e-CAC ativa/i.test(raw)) {
        return 'NFe: sem certificado A1 próprio/mesma raiz CNPJ ou marcação A3. Procuração e-CAC do escritório não substitui certificado na consulta NFe DistDFe.';
    }
    if (/UF não cadastrada/i.test(raw)) {
        return 'NFe: UF não cadastrada. Preencha a UF nos dados fiscais da empresa.';
    }
    return raw
        .replace(/\bNFSe\b/g, 'NFS-e')
        .replace(/\bNFSe Nacional\b/g, 'NFS-e Nacional')
        .replace(/\bNFSe SP\b/g, 'NFS-e SP')
        .replace(/\bCloud Run\b/g, 'captura automática em nuvem');
}

export function formatarErroAcaoStatusCaptura(
    erro: string | { error?: string; code?: string; cnpj?: string; status?: number } | null | undefined,
    empresa?: Pick<EmpresaStatusCaptura, 'nome' | 'cnpj'> | null,
    acao = 'salvar a alteração',
): string {
    const msg = typeof erro === 'string' ? erro : (erro?.error || '');
    const code = typeof erro === 'string' ? '' : (erro?.code || '');
    const cnpj = formatarCnpjDisplay((typeof erro === 'string' ? '' : erro?.cnpj) || empresa?.cnpj || '');
    const nome = empresa?.nome || 'empresa selecionada';

    if (code === 'EMPRESA_NAO_ENCONTRADA' || /empresa n[aã]o encontrada/i.test(msg)) {
        return `Não consegui ${acao}: ${nome}${cnpj ? ` (${cnpj})` : ''} não foi localizada no cadastro atual. Atualize o painel e confira se o CNPJ ainda existe em Simples ou Lucro Presumido/Real.`;
    }
    if (/apenas administradores/i.test(msg)) {
        return `Seu usuário não tem permissão para ${acao}. Faça login com perfil administrador.`;
    }
    if (/cnpj inv[aá]lido/i.test(msg)) {
        return `Não consegui ${acao}: o CNPJ informado está inválido. Atualize o painel e tente novamente.`;
    }
    return `Não consegui ${acao}: ${msg || 'falha inesperada'}.`;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

export async function fetchEmpresasStatusCaptura(incluirArquivadas = false): Promise<EmpresaStatusResponse> {
    const token = await getToken();
    const qs = incluirArquivadas ? '?incluirArquivadas=1' : '';
    const res = await fetch(`/api/admin/sefaz/empresas-status-captura${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export type FlagCampo = 'procuracaoEcacAtiva' | 'nfseNacionalDfeAtivo' | 'capturarSefaz';

export async function toggleEmpresaFlag(cnpj: string, campo: FlagCampo, valor: boolean): Promise<EmpresaStatusActionResult> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/empresa-toggle-flag', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj, campo, valor }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}`, code: data.code, cnpj: data.cnpj, status: res.status };
    return { ok: true, atualizadas: data.atualizadas };
}

/** Salva campos do cadastro (dadosFiscais) de uma empresa — merge por
 *  dot-notation no backend (não clobbera outros campos). Admin e colaborador —
 *  preencher cadastro é trabalho da equipe; a auditoria grava quem alterou. */
export async function salvarEmpresaDadosFiscais(
    cnpj: string,
    dadosFiscais: import('../types').EmpresaDadosFiscais,
): Promise<{ ok: boolean; atualizadas?: number; error?: string }> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/empresa-dados-fiscais', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj, dadosFiscais }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, atualizadas: data.atualizadas };
}

/** Corrige o REGIME movendo a empresa entre simples_empresas ⇄ lucro_empresas
 *  (preserva o id — vínculos ficam intactos). Admin-only. */
export async function corrigirRegimeEmpresa(
    cnpj: string,
    regimeNovo: 'simples' | 'lucro',
): Promise<{ ok: boolean; movidas?: number; msg?: string; error?: string }> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/empresa-corrigir-regime', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj, regimeNovo }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, movidas: data.movidas, msg: data.msg };
}

/** Arquiva (soft-delete reversível) ou desarquiva uma empresa. Admin-only. */
export async function arquivarEmpresa(
    cnpj: string,
    desarquivar = false,
): Promise<{ ok: boolean; msg?: string; error?: string }> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/empresa-arquivar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj, desarquivar }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, msg: data.msg };
}

/** Exclui DEFINITIVAMENTE (só se a empresa não tiver documentos). Admin-only.
 *  Retorna code='TEM_DOCUMENTOS' + totalDocs quando a trava barra. */
export async function excluirEmpresa(
    cnpj: string,
): Promise<{ ok: boolean; msg?: string; error?: string; code?: string; totalDocs?: number }> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/empresa-excluir', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj, confirmar: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}`, code: data.code, totalDocs: data.totalDocs };
    return { ok: true, msg: data.msg };
}

/** Apaga o lock SEFAZ de 1h pra essa empresa. Próximo disparo do
 *  orchestrator vai criar o lock de novo. Útil quando admin precisa
 *  testar rerun na mesma janela. Admin-only. */
export async function resetLockSefaz(cnpj: string): Promise<{ ok: boolean; hadLock?: boolean; msg?: string; error?: string }> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/empresa-reset-lock', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, hadLock: data.hadLock, msg: data.msg };
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

/** Preenche dadosFiscais.codMunIBGE via BrasilAPI para todas as empresas sem
 *  código de município (elegibilidade NFSe Nacional depende disso). Admin. */
export async function autoPreencherMunicipio(): Promise<{ ok: boolean; motivo?: string; error?: string }> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/auto-preencher-municipio', {
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
        `"${e.motivosBloqueio.map(formatarMotivoBloqueioCaptura).join(' · ').replace(/"/g, '""')}"`,
    ].join(','));
    return [headers.join(','), ...rows].join('\n');
}
