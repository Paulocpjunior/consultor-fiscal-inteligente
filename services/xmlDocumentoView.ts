/**
 * xmlDocumentoView — adapter unificado para acomodar os 2 schemas de documento
 * fiscal que coexistem no Firestore (NF-e tradicional vs NFS-e SP).
 *
 * Por que existe:
 * Hoje os componentes consomem o documento bruto com cascata defensiva como
 * `(d as any).emitente?.nome || (d as any).prestador?.nome || '—'`. Esse padrão
 * se espalhou por XmlDocumentoDetalhe, XmlDocumentosList, XmlRelatorios e
 * XmlExportarIobSage. Isso é ilegível, frágil e impede tipagem real.
 *
 * Estratégia (read-side adapter):
 * - getView(d) recebe o documento bruto (any) e retorna um XmlDocumentoView
 *   com os campos sempre populados (string vazia ou 0 quando ausente).
 * - Os componentes deixam de usar `?.` em cascata: passam a consumir
 *   getView(d).emitente.nome, getView(d).valores.total, etc.
 * - Nenhuma mudança no que é gravado no Firestore — funciona com docs antigos
 *   e novos sem migração.
 *
 * Se um dia o backend padronizar o schema, basta atualizar este arquivo.
 */

export type DocumentoTipo = 'NFe' | 'NFSe';

export interface XmlDocumentoView {
    tipo: DocumentoTipo;
    emitente: {
        nome: string;
        cnpj: string;
        ie: string;
        municipio: string;
        uf: string;
        fantasia: string;
    };
    destinatario: {
        nome: string;
        cnpj: string;
        ie: string;
        municipio: string;
        uf: string;
    };
    valores: {
        total: number;        // vNF (NFe) | valores.liquido (NFSe)
        produtos: number;     // vProd  (só NFe)
        bc: number;           // vBC
        icms: number;         // vICMS
        bcST: number;         // vBCST
        icmsST: number;       // vST
        ipi: number;          // vIPI
        pis: number;          // vPIS  | valores.pis
        cofins: number;       // vCOFINS | valores.cofins
        frete: number;        // vFrete
        desconto: number;     // vDesc
        outros: number;       // vOutro
    };
}

const s = (...vals: any[]): string => {
    for (const v of vals) {
        if (v !== undefined && v !== null && v !== '') return String(v);
    }
    return '';
};

const n = (...vals: any[]): number => {
    for (const v of vals) {
        if (v !== undefined && v !== null && v !== '') {
            const num = typeof v === 'number' ? v : parseFloat(String(v));
            if (!Number.isNaN(num)) return num;
        }
    }
    return 0;
};

/**
 * Detecta o tipo do documento. Se houver `prestador` ou `valores.liquido` é NFSe;
 * se houver `emitente` ou `totais.vNF` é NFe. Quando ambos coexistem (raro,
 * defensivo), prevalece NFe.
 */
function detectTipo(d: any): DocumentoTipo {
    if (d?.tipo === 'NFe' || d?.tipo === 'NFSe') return d.tipo;
    if (d?.emitente || d?.totais?.vNF !== undefined) return 'NFe';
    if (d?.prestador || d?.valores?.liquido !== undefined) return 'NFSe';
    return 'NFe'; // default conservador
}

export function getView(d: any): XmlDocumentoView {
    const tipo = detectTipo(d);

    const emit = d?.emitente ?? {};
    const prest = d?.prestador ?? {};
    const dest = d?.destinatario ?? {};
    const tom = d?.tomador ?? {};
    const tot = d?.totais ?? {};
    const val = d?.valores ?? {};

    return {
        tipo,
        emitente: {
            nome:      s(emit.nome, prest.nome),
            cnpj:      s(emit.cnpjCpf, emit.cnpj, prest.cnpj),
            ie:        s(emit.ie, prest.ie),
            municipio: s(emit.municipio, prest.municipio),
            uf:        s(emit.uf, prest.uf),
            fantasia:  s(emit.fantasia, prest.fantasia),
        },
        destinatario: {
            nome:      s(dest.nome, tom.nome),
            cnpj:      s(dest.cnpjCpf, dest.cnpj, tom.cnpj),
            ie:        s(dest.ie, tom.ie),
            municipio: s(dest.municipio, tom.municipio),
            uf:        s(dest.uf, tom.uf),
        },
        valores: {
            total:    n(tot.vNF, val.liquido),
            produtos: n(tot.vProd),
            bc:       n(tot.vBC),
            icms:     n(tot.vICMS),
            bcST:     n(tot.vBCST),
            icmsST:   n(tot.vST),
            ipi:      n(tot.vIPI),
            pis:      n(tot.vPIS, val.pis),
            cofins:   n(tot.vCOFINS, val.cofins),
            frete:    n(tot.vFrete),
            desconto: n(tot.vDesc),
            outros:   n(tot.vOutro),
        },
    };
}
