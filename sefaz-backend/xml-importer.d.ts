export interface MetadadosXml {
    chave: string | null;
    cnpjEmit: string | null;
    cnpjDest: string | null;
    xNome: string | null;
    dhEmi: string | null;
    vNF: number | null;
    tpNF: string | null;
    tipoDoc: string | null;
    tipoNormalizado: string | null;
    schema: string | null;
    /**
     * Só para XML de evento. `chNFeRef` é a chave (44 dígitos) da nota que o
     * evento referencia — é ela que decide se o evento é ANEXADO à nota ou se
     * o import é recusado. Sem ela o evento virava documento fantasma.
     */
    evento: {
        tpEvento: string | null;
        nSeqEvento: string | null;
        dhEvento: string | null;
        xCorrecao: string | null;
        xJust: string | null;
        nProt: string | null;
        cStat: string | null;
        xMotivo: string | null;
        chNFeRef: string | null;
        tipo: string;
        descricao: string;
    } | null;
    numero: string | null;
    serie: string | null;
    natOp: string | null;
    cStat: string | null;
    /** Endereço dos participantes — o E010 do Exportar SAGE depende deles. */
    xNomeDest: string | null;
    ufDest: string | null;
    codMunDest: string | null;
    ieDest: string | null;
    ufEmit: string | null;
    codMunEmit: string | null;
}

export function extrairMetadados(xml: string, schema?: string): MetadadosXml;

export function decidirGravacaoNFe(p: {
    existingData: unknown;
    tipoDoc?: string;
    schema?: string;
    chave?: string;
}): { exists: boolean; upgrade: boolean; incompleto: boolean; duplicado: boolean; merge: boolean };

export function corrigirDirecaoEntradaPropria(p?: { limit?: number }): Promise<{
    examinadas: number; corrigidas: number; erro?: string;
}>;

export function preencherEnderecoDestinatario(p?: {
    limit?: number; empresaId?: string | null; competencia?: string | null;
}): Promise<{ examinadas: number; preenchidas: number; semXml: number; jaTinham: number; erro?: string }>;

/** Versão do extrator de ITENS — subir recoloca a base na fila do backfill. */
export const VERSAO_RELEITURA_ITENS: number;

/**
 * BACKFILL — campos de item que o extrator aprendeu depois (`cstIpi`,
 * `cEnqIpi`, `vBcIpi`, `cstPis`, `cstCofins`), relidos do XML no Storage.
 * Cada contador do retorno é uma CAUSA com ação própria.
 */
export function relerItensFiscais(p?: {
    limit?: number;
    empresaId?: string | null;
    competencia?: string | null;
}): Promise<{
    examinadas: number;
    atualizadas: number;
    semXml: number;
    jaRelidas: number;
    semItens: number;
    naoPareadas: number;
    semDadoNoXml: number;
    porCampo: Record<string, number>;
    naoPareadasDetalhe: Array<{ chave: string; numero: string | null; motivo: string }>;
    erro?: string;
}>;
