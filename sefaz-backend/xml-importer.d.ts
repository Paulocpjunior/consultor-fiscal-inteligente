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
    /**
     * Logradouro/nº/complemento/bairro dos dois lados — o campo 10 (ENDERECO)
     * do 0150 é **obrigatório sem condição**, e o extrator os descartava.
     */
    logradouroEmit: string | null;
    nroEmit: string | null;
    complementoEmit: string | null;
    bairroEmit: string | null;
    logradouroDest: string | null;
    nroDest: string | null;
    complementoDest: string | null;
    bairroDest: string | null;
    /**
     * Municípios da PRESTAÇÃO do CT-e (`cMunIni`/`cMunFim`) — campos 24 e 25
     * do D100 do EFD ICMS/IPI. `null` fora do CT-e.
     */
    codMunIniCte: string | null;
    codMunFimCte: string | null;
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

/** Resultado dos dois backfills de participante — contado POR CAUSA. */
export interface ResultadoReleituraParticipantes {
    examinadas: number;
    preenchidas: number;
    semXml: number;
    jaTinham: number;
    ganharamMunicipio: number;
    ganharamFornecedor: number;
    /** Quantos ganharam o LOGRADOURO — a recusa 0150.10 do PVA (VINATEX). */
    ganharamEndereco: number;
    semDadoNoXml: number;
    erro?: string;
}

export function preencherEnderecoDestinatario(p?: {
    limit?: number; empresaId?: string | null; competencia?: string | null;
}): Promise<ResultadoReleituraParticipantes>;

/** O MESMO backfill nas DUAS direções (a compra de produtor rural é entrada). */
export function preencherEnderecoParticipantes(p?: {
    limit?: number; empresaId?: string | null; competencia?: string | null;
    direcao?: 'entrada' | 'saida';
}): Promise<ResultadoReleituraParticipantes>;

/** Versão do extrator de PARTICIPANTES — subir recoloca a base na fila. */
export const VERSAO_RELEITURA_PARTICIPANTES: number;

/**
 * Extrai os itens (`<det>`) de uma NF-e completa — `[]` para resumo (resNFe)
 * ou XML sem `<det>`. É o MESMO extrator que a captura e o backfill usam.
 */
export function extrairItens(xml: string): Array<Record<string, unknown>>;

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

/**
 * ♻️ Releitura das notas "VAZIAS" (sem itens/nº) a partir do XML guardado.
 * Quem classifica é a régua pura `releitura-notas-vazias.js`; o resultado
 * responde POR CAUSA (resumo ≠ sem arquivo ≠ preenchida).
 */
export function relerNotasVazias(p?: {
    empresaId?: string | null;
    competencia?: string | null;
    limit?: number;
}): Promise<{
    examinadas: number;
    preenchidas: number;
    ganharamNumero: number;
    soResumo: number;
    semArquivo: number;
    foraDoEscopo: number;
    jaCompletas: number;
    semItemNoXml: number;
    falhas: number;
}>;

/**
 * 🚚 Releitura do CABEÇALHO dos CT-e (CFOP, CST, alíquota e ICMS) a partir do
 * XML guardado. Os outros dois ♻️ não alcançam conhecimento de transporte: um
 * só mexe em campos de ITEM (o CT-e não tem) e o outro o trata como fora do
 * escopo. Quem classifica é a régua pura `cte-cabecalho.js`.
 */
export function relerCabecalhoCtes(p?: {
    empresaId?: string | null;
    competencia?: string | null;
    limit?: number;
}): Promise<{
    examinados: number;
    recuperados: number;
    jaCompletos: number;
    jaRelidos: number;
    semArquivo: number;
    xmlSemCfop: number;
    semMudanca: number;
    falhas: number;
    campos: Record<string, number>;
}>;
