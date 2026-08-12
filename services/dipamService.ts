/**
 * dipamService.ts — DIPAM 1.1 e FUNRURAL por sub-rogação (compra de produtor
 * rural). Só I/O: a regra vive em `sefaz-backend/dipam-produtor-rural.js`
 * (puro e testado), porque é ela que decide o que vai declarado à SEFAZ.
 */
import { getAuth } from 'firebase/auth';

export interface DipamPendencia {
    codigo: string;
    mensagem: string;
    acao: string;
    chave?: string;
    numero?: string;
    fornecedor?: string;
    doc?: string;
}

export interface DipamMunicipio {
    codMunIBGE: string;
    municipio: string;
    codigo: string;
    registro1400: string;
    valor: number;
    compras: number;
    devolucoes: number;
    notas: Array<{ chave: string; numero: string; dhEmi: string; valor: number; fornecedor: string }>;
}

export interface FunruralNota {
    chave: string;
    numero: string;
    dhEmi: string;
    fornecedor: string;
    doc: string;
    uf: string;
    ie?: string;
    /** CPF do titular gravado no cadastro (produtor inscrito por CNPJ). */
    cpfTitular?: string | null;
    /** Carimbo da régua que provou a natureza — viaja até o R-2055. */
    naturezaConfianca?: string | null;
    naturezaMotivo?: string | null;
    base: number;
    aliquotas: { inss: number; gilrat: number; senar: number };
    inss: number;
    gilrat: number;
    senar: number;
    total: number;
    declarado: { percentual: number | null; valor: number | null; trecho: string } | null;
    divergencia: { declarado: number; calculado: number; diferenca: number } | null;
}

export interface DipamPainel {
    ok: boolean;
    error?: string;
    competencia?: string;
    codigo?: string;
    dipam?: {
        total: number;
        municipios: DipamMunicipio[];
        municipiosZerados: DipamMunicipio[];
        notas: number;
        registro1400: Array<{ codItemIpm: string; mun: string; valor: number; linha: string }>;
    };
    funrural?: {
        base: number; inss: number; gilrat: number; senar: number; total: number;
        notas: FunruralNota[];
        revisarAliquotas: boolean;
        excluidasArt136?: Array<{
            chave: string;
            numero: string;
            dhEmi: string;
            fornecedor: string;
            doc: string;
            valor: number;
            motivo: string;
        }>;
    };
    notas?: any[];
    pendencias?: DipamPendencia[];
    avisos?: string[];
    farol?: { cor: 'ok' | 'atencao' | 'falha' | 'neutro'; resumo: string };
    cadastro?: {
        adquireDeProdutor: boolean;
        ehProdutorRuralPF: boolean;
        ehCooperativa: boolean;
        funruralSubRogacao: string;
        observacao: string;
        divergencia: { tipo: string; mensagem: string; acao: string } | null;
    };
    lidos?: { documentos: number; produtoresCadastrados: number };
}

export interface DipamVarreduraLinha {
    empresaId: string;
    nome: string;
    cnpj: string;
    regime: string;
    marcadoNoCadastro: boolean;
    dipamTotal: number;
    municipios: number;
    notasDipam: number;
    funruralTotal: number;
    notasFunrural: number;
    pendencias: number;
    farol: { cor: 'ok' | 'atencao' | 'falha' | 'neutro'; resumo: string };
}

export interface ProdutorRural {
    id: string;
    doc: string;
    nome?: string;
    ie?: string;
    uf?: string;
    codMunIBGE?: string;
    municipio?: string;
    natureza?: 'produtor_rural_pf' | 'pessoa_juridica' | 'cooperativa' | null;
    funrural?: 'sub_rogacao' | 'folha' | 'nao_aplica' | null;
    /** Agricultura familiar: FUNRURAL continua em 1,5% (LC 224/2025). */
    seguradoEspecial?: boolean;
    /**
     * CPF do titular quando o produtor está inscrito por CNPJ.
     *
     * O `ideProdutor` do R-2055 identifica a PESSOA (tpInscProd=2, CPF — a única
     * forma provada contra evento aceito), e a nota traz o CNPJ do
     * estabelecimento rural. Vem do CADESP, digitado; nunca deduzido.
     */
    cpfTitular?: string | null;
    observacao?: string;
    confirmadoPor?: string;
    confirmadoEm?: number;
}

async function req<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' } as any;
    const token = await u.getIdToken();
    const res = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init?.headers || {}),
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` } as any;
    return data;
}

export const carregarPainelDipam = (empresaId: string, competencia: string) =>
    req<DipamPainel>(`/api/admin/dipam/painel?empresaId=${encodeURIComponent(empresaId)}&competencia=${competencia}`);

export const varrerDipam = (competencia: string) =>
    req<{ linhas: DipamVarreduraLinha[]; total: number; truncado: number; escopo: string }>(
        `/api/admin/dipam/varredura?competencia=${competencia}`);

export const listarProdutoresRurais = () =>
    req<{ produtores: ProdutorRural[] }>('/api/admin/dipam/produtores');

export const salvarProdutorRural = (produtor: Partial<ProdutorRural> & { doc: string }) =>
    req<{ produtor: ProdutorRural }>('/api/admin/dipam/produtor', {
        method: 'POST',
        body: JSON.stringify(produtor),
    });

/**
 * Relê o município dos XMLs guardados no Storage.
 *
 * "nota sem código IBGE do município de origem" não é erro de cadastro — o dado
 * está no arquivo. Reler a FONTE é recuperação; mandar digitar 323 municípios
 * seria pedir trabalho por algo que já existe.
 */
export const relerMunicipiosDipam = (empresaId: string, competencia: string) =>
    req<{ examinadas: number; preenchidas: number; semXml: number; jaTinham: number; acao: string | null }>(
        '/api/admin/dipam/reler-municipios', {
            method: 'POST',
            body: JSON.stringify({ empresaId, competencia }),
        });

/** Texto do Registro 1400 pronto pra conferir/colar (uma linha por município). */
export function textoRegistro1400(painel: DipamPainel): string {
    return (painel.dipam?.registro1400 || []).map(r => r.linha).join('\n');
}
