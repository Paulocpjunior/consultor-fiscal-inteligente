/**
 * reinfServicosTomadosService — porta do R-2010 (retenção previdenciária sobre
 * serviços TOMADOS).
 *
 * Só I/O. A régua mora em `sefaz-backend/reinf-servicos-tomados.js`, calibrada
 * contra um `evtServTom` REAL com recibo de sucesso da Receita (06/2026) — e é
 * de lá que vem o achado que manda no módulo: **a base de retenção NÃO é o
 * valor bruto** quando houve dedução de material/insumo (IN RFB 971, arts.
 * 121-124). No evento aceito o bruto é 5.755,54 e a base é 4.604,43.
 *
 * Reimplementar qualquer pedaço disso aqui faria a tela prometer um número
 * diferente do que o outro app declara — o pior defeito possível num arquivo
 * fiscal, e a razão de a régua morar num lugar só.
 */

import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export type SituacaoBase =
    | 'base-e-o-bruto'
    | 'aliquota-ambigua-cprb-ou-deducao'
    | 'base-deduzida-nao-informada'
    | 'aliquota-fora-da-regua'
    | 'sem-dados';

export interface ConferenciaBase {
    situacao: SituacaoBase;
    aliquotaAparente: number | null;
    base: number | null;
    baseOrigem: 'bruto-sem-deducao' | 'derivada-da-retencao' | null;
    indCPRB: number | null;
    exigeAcao: boolean;
    motivo: string;
    acao: string | null;
}

/**
 * A nota como o backend entrega — e os nomes são os DELE.
 *
 * Esta interface é o contrato que o app irmão consome para montar o `nfs` do
 * evento (`serie` → `numDocto` → `dtEmissaoNF` → `vlrBruto` → `obs`). Ela
 * nasceu com `dataEmissao`, campo que o payload NUNCA teve — o backend manda
 * `dtEmissao`. Tipo que descreve um campo inexistente não falha na hora: ele
 * espera alguém escrever `n.dataEmissao` num campo de declaração e mandar
 * `undefined` para a Receita. Campo novo no payload entra AQUI no mesmo PR.
 */
export interface NotaR2010 {
    numero?: string | null;
    serie?: string | null;
    /** 'AAAA-MM-DD…' — vira `dtEmissaoNF` no evento. */
    dtEmissao?: string | null;
    chave?: string | null;
    competencia?: string | null;
    vlrBruto: number;
    inssRetido: number;
    baseRetencao: number | null;
    baseOrigem: 'bruto-sem-deducao' | 'derivada-da-retencao' | null;
    /** 0 quando a alíquota PROVA (11%); null quando o app se recusa a escolher. */
    indCPRB: number | null;
    /** O prestador descreve o serviço aqui — é daqui que sai o tpServico. */
    discriminacao?: string | null;
    codigoServicoMunicipal?: string | null;
    /** NULOS de propósito: não estão na nota, são cadastrados por prestador. */
    tpServico: null;
    indObra: null;
    conferencia: ConferenciaBase;
}

export interface PrestadorR2010 {
    cnpjPrestador: string;
    nome: string | null;
    nrInscEstab: string | null;
    /** NULOS de propósito: nenhum dos dois está na NFS-e. */
    indObra: number | null;
    notas: NotaR2010[];
    vlrTotalBruto: number;
    /** NULO quando a base não está provada — parcial seria lido como total. */
    vlrTotalBaseRet: number | null;
    baseCompleta: boolean;
    vlrTotalRetPrinc: number;
    comPendencia: number;
}

export interface PayloadR2010 {
    empresa: { empresaId?: string; nome?: string; regime?: string; cnpj: string };
    documentosLidos: number;
    cnpjTomador: string | null;
    competencia: string | null;
    prestadores: PrestadorR2010[];
    resumo: {
        prestadores: number;
        notas: number;
        semRetencaoPrevidenciaria: number;
        dePessoaFisica: number;
        comPendencia: number;
        semBaseProvada: number;
        vlrTotalBruto: number;
        vlrTotalRetPrinc: number;
    };
    ressalvas: string[];
}

/** As NFS-e tomadas com INSS retido da competência, prontas para o R-2010. */
export async function carregarServicosTomados(cnpj: string, competencia: string): Promise<PayloadR2010> {
    const qs = `cnpj=${encodeURIComponent(cnpj)}&competencia=${encodeURIComponent(competencia)}`;
    const r = await fetch(`/api/admin/reinf/servicos-tomados?${qs}`, { headers: await authHeader() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `Falha ao ler os serviços tomados (HTTP ${r.status})`);
    return j as PayloadR2010;
}
