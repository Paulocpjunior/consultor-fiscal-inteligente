/**
 * provaCapturaService.ts — "a captura deste CNPJ está completa?", provado
 * contra a FONTE (SEFAZ), não contra concorrente.
 *
 * O cursor do DistDFe responde sozinho: `ultNSU` é até onde lemos, `maxNSU` é
 * até onde a SEFAZ diz ter documento. maxNSU > ultNSU = incompleto, e o app
 * sabe disso sem precisar de nenhuma segunda opinião.
 */
import { getAuth } from 'firebase/auth';

export interface LinhaProva {
    cnpj: string;
    matriz: boolean;
    cadastro: { id: string; nome: string; regime: string; tipoCert?: string; capturarSefaz?: boolean } | null;
    state: {
        ultNSU?: string | null; maxNSU?: string | null; pendenciaNSU?: number | null;
        nsuTravado?: string | null; cStatUltimaSync?: string | null; ultimaSyncMs?: number | null;
    } | null;
    docs: {
        total: number; entradas: number; saidas: number; resumosSemCompleta: number; canceladas: number;
        porCompetencia: Record<string, number>; primeiraEmissao: number | null; ultimaEmissao: number | null;
    };
    veredito: { farol: 'ok' | 'atencao' | 'falha'; codigo: string; motivo: string; acao: string | null };
}

export interface ProvaCaptura {
    ok: boolean;
    error?: string;
    raiz?: string;
    cnpjAlvo?: string | null;
    linhas?: LinhaProva[];
    totalDocs?: number;
    docsSemDono?: number;
    farol?: 'ok' | 'atencao' | 'falha';
    resumo?: string;
    ressalvas?: string[];
    janelaDistDfeDias?: number;
    docsAntesDoCorte?: number;
    geradoEm?: string;
}

export async function provarCaptura(cnpj: string): Promise<ProvaCaptura> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const res = await fetch(`/api/admin/sefaz/prova-captura?cnpj=${encodeURIComponent(cnpj.replace(/\D/g, ''))}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}
