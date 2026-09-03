/**
 * consultaNFeChaveService.ts
 *
 * Cliente do endpoint /api/admin/sefaz/consulta-nfe-por-chave.
 *
 * Caso de uso: descobrir se uma NFe especifica (chave de 44 digitos) foi
 * emitida com o CNPJ do escritorio como destinatario, e ler emit/dest/total
 * direto do XML que a SEFAZ devolve. Util pra diagnosticar quando uma NFe
 * "deveria" ter chegado via DistDFe mas nao chegou.
 */

import { getAuth } from 'firebase/auth';

export interface NFeChaveDetalhes {
    emitente: { cnpj: string | null; nome: string | null; uf: string | null };
    destinatario: { cnpj: string | null; nome: string | null; uf: string | null };
    numero: string | null;
    dataEmissao: string | null;
    valorTotal: string | null;
    modelo: string | null;
    natureza: string | null;
}

export interface NFeChaveResposta {
    ok: boolean;
    cStat: string | null;
    xMotivo: string | null;
    chave: string;
    cnpjConsultadoComo: string;
    ufEmitente: string;
    cnpjEmitenteChave: string;
    cnpjEscritorio: string;
    escritorioEhDestinatario: boolean | null;
    detalhes: NFeChaveDetalhes | null;
    xmlsResumo?: { schema: string | null; nsu: string | null; temXml: boolean; tamanho: number; primeiraTag: string | null }[];
    totalXmls?: number;
    importacao?: { schema: string | null; status: string; chave?: string; motivo?: string | null }[] | null;
    /** Cancelamento confirmado (cStat 653): o que foi GRAVADO no documento da base (21/08, MV LIDER). */
    gravacaoCancelamento?: { carimbado: boolean; mensagem: string } | null;
    error?: string;
}

export interface CertEscritorioInfo {
    ok: boolean;
    cnpjEsperado: string;
    cnpjNoCert: string | null;
    cnpjBaseDoCert: string | null;
    cnpjBaseEsperado: string;
    mismatch: boolean | null;
    mismatchBase: boolean | null;
    subject: string;
    cn: string;
    notBefore: string | null;
    notAfter: string | null;
    valido: boolean;
    pfxVersion: string | null;
    erro?: string;
    error?: string;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

export async function getCertEscritorioInfo(): Promise<CertEscritorioInfo> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/cert-escritorio-info', {
        headers: { Authorization: `Bearer ${token}` },
    });
    // HTTP fora do 2xx NÃO é resposta sobre o certificado: 401/403 é a porta
    // (sessão/permissão), 5xx é o servidor. Devolver o JSON cru fazia a tela
    // ler `valido: undefined` como "certificado inválido" — a primeira parada
    // errada. Sai como falha NOMEADA, com o motivo que o backend deu.
    const corpo: any = await res.json().catch(() => ({}));
    if (!res.ok) {
        const motivo = corpo?.error || corpo?.erro || `HTTP ${res.status}`;
        throw new Error(res.status === 401 || res.status === 403
            ? `Não autorizado a ler o certificado do escritório (${motivo}) — entre de novo ou peça acesso de admin.`
            : `Falha ao consultar o certificado do escritório (${motivo}).`);
    }
    return corpo as CertEscritorioInfo;
}

export async function consultarNFePorChave(chave: string, importar = false): Promise<NFeChaveResposta> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/consulta-nfe-por-chave', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: chave.replace(/\D/g, ''), importar }),
    });
    const data = await res.json();
    if (!res.ok) {
        return {
            ok: false, cStat: null, xMotivo: null, chave,
            cnpjConsultadoComo: '', ufEmitente: '', cnpjEmitenteChave: '',
            cnpjEscritorio: '', escritorioEhDestinatario: null, detalhes: null,
            error: data.error || `HTTP ${res.status}`,
        };
    }
    return data;
}
