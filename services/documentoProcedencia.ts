// ============================================================================
// services/documentoProcedencia.ts
// ----------------------------------------------------------------------------
// DE ONDE VEIO O DOCUMENTO — e por que alguns campos estão vazios.
//
// A tela de detalhe do XML quebrava ao abrir uma NFS-e capturada pelo portal:
// `d.xmlHash.slice(0, 16)` com `xmlHash` undefined (07/08, ELS COMERCIO DE
// BANANAS, nota 55758/1). O erro imediato era o `.slice`, mas a causa é mais
// interessante: a tela assumia que TODO documento veio de um arquivo XML.
//
// Não veio. A NFS-e do portal de SP entra por CSV/TXT — não existe arquivo
// XML, não existe hash, e não existe chave de acesso de 44 dígitos (isso é da
// NF-e). Esses campos vazios não são falha de captura: são a natureza do
// documento.
//
// Por isso a correção não é só um `?.`. Campo vazio sem explicação faz o
// colaborador procurar um problema que não existe — foi a mesma lição do
// "CNPJ não cadastrado" hoje de manhã. A tela passa a DIZER por que está
// vazio.
// ============================================================================

export interface ProcedenciaDoc {
    /** Tem arquivo XML guardado? */
    temXml: boolean;
    /** Tem chave de acesso de 44 dígitos? */
    temChave: boolean;
    /** Frase curta pra tela, ou null quando não há nada a explicar. */
    explicacao: string | null;
}

const ehTexto = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/**
 * Documentos que NASCEM sem arquivo XML. Não é lista de exceção: é a forma
 * como esses trilhos entregam o documento.
 */
const SEM_XML_POR_NATUREZA = new Set(['portal', 'portal-sp', 'csv', 'txt', 'manual-csv']);

export function procedenciaDoDocumento(d: any): ProcedenciaDoc {
    const temXml = ehTexto(d?.xmlHash) || ehTexto(d?.storageUrl) || ehTexto(d?.storagePath);
    const chave = String(d?.chave ?? '').replace(/\D/g, '');
    const temChave = chave.length === 44;
    const origem = String(d?.origem ?? '').toLowerCase();
    const ehNfse = /nfse/i.test(String(d?.tipoDoc ?? d?.tipo ?? ''));

    if (temXml && temChave) return { temXml, temChave, explicacao: null };

    if (ehNfse && !temXml) {
        return {
            temXml, temChave,
            explicacao: 'NFS-e capturada pelo portal: entra por CSV/TXT, então não há arquivo XML, '
                + 'hash nem chave de acesso de 44 dígitos — isso é a natureza do documento, não falha de captura.',
        };
    }
    if (!temXml && SEM_XML_POR_NATUREZA.has(origem)) {
        return { temXml, temChave, explicacao: 'Documento importado sem arquivo XML (origem: ' + origem + ').' };
    }
    if (!temXml) {
        // Aqui SIM é suspeito: documento que deveria ter XML e não tem.
        return {
            temXml, temChave,
            explicacao: 'Sem arquivo XML guardado. Para NF-e/NFC-e isso é anormal — o XML deveria ter '
                + 'sido arquivado na captura. Vale conferir em Erros & Logs.',
        };
    }
    return {
        temXml, temChave,
        explicacao: temChave ? null : 'Sem chave de acesso de 44 dígitos neste documento.',
    };
}

/** Hash curto pra exibição, ou null quando não há hash. Nunca estoura. */
export function hashCurto(xmlHash: unknown, tamanho = 16): string | null {
    return ehTexto(xmlHash) ? `${String(xmlHash).slice(0, tamanho)}…` : null;
}

/** Data legível, ou null. `new Date(undefined)` renderiza "Invalid Date". */
export function dataLegivel(valor: unknown): string | null {
    if (valor === null || valor === undefined || valor === '') return null;
    const d = new Date(valor as any);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString('pt-BR');
}
