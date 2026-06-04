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
    chave: string;
    numero: string;
    serie: string;
    modelo: string;
    direcao: string;
    resumoOnly: boolean;
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
function extractChaveMeta(chave: string): { modelo: string; serie: string; numero: string } {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) return { modelo: '', serie: '', numero: '' };
    return {
        modelo: c.substring(20, 22),
        serie: String(parseInt(c.substring(22, 25), 10) || ''),
        numero: String(parseInt(c.substring(25, 34), 10) || ''),
    };
}

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

    const chaveRaw = s(d?.chave);
    const chaveMeta = extractChaveMeta(chaveRaw);

    const schemaStr = s(d?.schema);
    const resumoOnly = d?.tipoDoc === 'resNFe' || schemaStr.startsWith('resNFe');

    const cnpjEmpresa = s(d?.empresaCnpj).replace(/\D/g, '');
    const cnpjEmitFlat = s(d?.cnpjEmit, emit.cnpjCpf, emit.cnpj).replace(/\D/g, '');
    const cnpjDestFlat = s(d?.cnpjDest, dest.cnpjCpf, dest.cnpj).replace(/\D/g, '');
    let direcaoFallback = '';
    if (cnpjEmpresa) {
        if (cnpjEmitFlat === cnpjEmpresa) direcaoFallback = 'saida';
        else if (cnpjDestFlat === cnpjEmpresa) direcaoFallback = 'entrada';
        else if (cnpjEmitFlat) direcaoFallback = 'entrada'; // empresa nao eh emit, assume entrada (resNFe so traz emit)
    }
    // 'desconhecida' deve ser tratada como vazia pra acionar o fallback.
    // resNFe vinha gravado com direcao='desconhecida' antes do fallback amplo.
    const direcaoGravada = s(d?.direcao);
    const direcaoFinal = (direcaoGravada && direcaoGravada !== 'desconhecida') ? direcaoGravada : direcaoFallback;

    return {
        tipo,
        chave:   chaveRaw,
        numero:  s(d?.numero, chaveMeta.numero),
        serie:   s(d?.serie, chaveMeta.serie),
        modelo:  s(d?.modelo, chaveMeta.modelo),
        direcao: direcaoFinal,
        resumoOnly,
        emitente: {
            nome:      s(emit.nome, prest.nome, d?.xNomeEmit, d?.xNome),
            cnpj:      s(emit.cnpjCpf, emit.cnpj, prest.cnpj, d?.cnpjEmit),
            ie:        s(emit.ie, prest.ie),
            municipio: s(emit.municipio, prest.municipio),
            uf:        s(emit.uf, prest.uf),
            fantasia:  s(emit.fantasia, prest.fantasia),
        },
        destinatario: {
            nome:      s(dest.nome, tom.nome, d?.xNomeDest),
            cnpj:      s(dest.cnpjCpf, dest.cnpj, tom.cnpj, d?.cnpjDest),
            ie:        s(dest.ie, tom.ie),
            municipio: s(dest.municipio, tom.municipio),
            uf:        s(dest.uf, tom.uf),
        },
        valores: {
            total:    n(tot.vNF, val.liquido, d?.valorTotal, d?.vNF),
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
