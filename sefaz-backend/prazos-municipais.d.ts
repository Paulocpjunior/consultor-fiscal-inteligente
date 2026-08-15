/**
 * Calendário municipal (ISS) — o app não INVENTA prazo, guarda o que alguém
 * conferiu, com vigência. O `.d.ts` entra no mesmo PR que o módulo.
 */
export function ehCodigoIbgeMunicipio(v: unknown): boolean;

export function validarPrazoMunicipal(p: any): { ok: boolean; erros: string[] };

/** A competência ('AAAA-MM') cai dentro da vigência do cadastro? */
export function vigenteNaCompetencia(cadastro: any, competencia: string): boolean;

export interface PrazoMunicipalResolvido {
    codMunIBGE: string;
    obrigacao: string;
    diaVencimento: number;
    mesesApos: number;
    ajusteDiaNaoUtil: 'antecipa' | 'prorroga';
    baseLegal: string;
    municipioNome: string | null;
    vigenciaInicio: string | null;
    vigenciaFim: string | null;
    cadastradoPorEmail: string | null;
    cadastradoEm: string | null;
}

export function resolverPrazoMunicipal(
    cadastros: any[],
    p: { codMunIBGE?: string; obrigacao: string; competencia: string },
): {
    achou: boolean;
    prazo: PrazoMunicipalResolvido | null;
    motivo: string;
    /** `municipio-ausente` = a ação é no cadastro do CLIENTE, não no calendário. */
    situacao: 'cadastrado' | 'municipio-sem-cadastro' | 'municipio-ausente' | 'fora-de-vigencia';
};

export function idPrazoMunicipal(p: any): string;

/** Fila POR MUNICÍPIO: cadastrar uma cidade resolve todos os clientes dela. */
export function municipiosSemCalendario(
    clientes: any[],
    cadastros: any[],
    opts?: { obrigacao?: string; competencia?: string },
): {
    municipios: Array<{
        codMunIBGE: string; municipioNome: string | null; situacao: string;
        total: number; clientes: Array<{ id: string | null; nome: string; cnpj: string }>;
        /** Clientes cobertos até esta linha, na ordem da fila. */
        acumulado: number;
        coberturaAcumuladaPct: number;
    }>;
    totalMunicipios: number;
    totalClientes: number;
    /** Quantas cidades bastam para cobrir 80% dos clientes pendentes. */
    cidadesPara80: number;
    /** Cliente sem município cadastrado — a ação é OUTRA. */
    clientesSemMunicipio: number;
};
