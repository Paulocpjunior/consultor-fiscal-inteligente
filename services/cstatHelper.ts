/**
 * cstatHelper.ts  (PURO — sem io, testável)
 *
 * Traduz códigos cStat da SEFAZ em mensagens acionáveis pro admin/contador.
 * Sem isso, a UI mostrava só "cStat=593 Rejeicao: CNPJ-Base consultado
 * difere..." e ninguém sabia que ação tomar.
 *
 * Lista oficial: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=tW+YMyk/50s=
 *
 * Categorias:
 *   ok      = capturou XMLs ou NSU em dia
 *   atencao = não bloqueia, mas vale revisar (rate-limit, schema futuro)
 *   erro    = capturas paradas até admin resolver
 */

export type CstatCategoria = 'ok' | 'atencao' | 'erro';

export interface CstatInfo {
    cStat: string;
    titulo: string;
    categoria: CstatCategoria;
    /** Ação prática que o admin precisa tomar pra destravar. null quando OK. */
    acao: string | null;
}

const TABELA: Record<string, Omit<CstatInfo, 'cStat'>> = {
    '137': {
        titulo: 'Nada novo (NSU em dia)',
        categoria: 'ok',
        acao: null,
    },
    '138': {
        titulo: 'Documentos retornados',
        categoria: 'ok',
        acao: null,
    },
    '215': {
        titulo: 'Falha de schema',
        categoria: 'erro',
        acao: 'XML mal-formado — abrir issue pra atualizar o cliente SEFAZ.',
    },
    '252': {
        titulo: 'Ambiente inválido',
        categoria: 'erro',
        acao: 'Variável SEFAZ_AMBIENTE não bate. Conferir Cloud Run env vars.',
    },
    '280': {
        titulo: 'Certificado inválido / expirado',
        categoria: 'erro',
        acao: 'Renovar o certificado A1 da empresa/mesma raiz CNPJ ou usar o agente A3 local.',
    },
    '281': {
        titulo: 'Certificado vencido',
        categoria: 'erro',
        acao: 'Renovar cert da S&P em Configurações > Certificado Digital.',
    },
    '283': {
        titulo: 'Certificado não pertence ao CNPJ',
        categoria: 'erro',
        acao: 'Cert do escritório no Secret Manager é de outro CNPJ. Subir o .pfx correto da S&P.',
    },
    '593': {
        titulo: 'Certificado não pertence à raiz CNPJ consultada',
        categoria: 'erro',
        acao:
            'Para NFe Distribuição (DF-e), use certificado A1 próprio ou de outra empresa da mesma raiz CNPJ. ' +
            'Procuração e-CAC do escritório não substitui certificado neste serviço. Se a empresa usa A3, execute pelo agente local cfi-a3.',
    },
    '656': {
        titulo: 'Consumo indevido (rate-limit SEFAZ)',
        categoria: 'atencao',
        acao: 'SEFAZ está limitando o CNPJ consultor. Reduzir frequência do cron ou intercalar requests entre UFs.',
    },
};

/**
 * @param cStat        Código retornado pela SEFAZ (string ou número).
 * @param xMotivoRaw   Texto bruto que veio junto (fallback se o cStat não estiver na tabela).
 */
export function interpretarCstat(cStat: string | number | null | undefined, xMotivoRaw?: string | null): CstatInfo {
    const code = String(cStat ?? '').trim();
    const info = TABELA[code];
    if (info) return { cStat: code, ...info };

    // cStat desconhecido — devolve genérico mas categoriza com heurística.
    const xMotivo = (xMotivoRaw || '').toLowerCase();
    const categoria: CstatCategoria =
        !code ? 'erro' :
        /reje[ic]/.test(xMotivo) || /erro/.test(xMotivo) ? 'erro' :
        'atencao';
    return {
        cStat: code,
        titulo: xMotivoRaw || `cStat ${code}`,
        categoria,
        acao: code
            ? 'Consultar tabela oficial SEFAZ pra esse cStat — não há ação automatizada mapeada.'
            : null,
    };
}

/** Helper só pra UI: cor de badge associada à categoria. */
export function corCategoriaCstat(c: CstatCategoria): { bg: string; text: string } {
    switch (c) {
        case 'ok':      return { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300' };
        case 'atencao': return { bg: 'bg-amber-100 dark:bg-amber-900/30',     text: 'text-amber-700 dark:text-amber-300' };
        case 'erro':    return { bg: 'bg-red-100 dark:bg-red-900/30',         text: 'text-red-700 dark:text-red-300' };
    }
}
