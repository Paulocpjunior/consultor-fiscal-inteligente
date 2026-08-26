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

// 🚨 A DIREÇÃO SE LÊ PELA RÉGUA — a nota PRÓPRIA de entrada (art. 136: a
// compra de produtor rural PF, que o adquirente é quem emite) fica GRAVADA
// como 'saida' até o backfill do sync-cron passar. O SPED e o `.FML` já a
// escrituram como ENTRADA desde 22/08; a Central de Documentos — lista,
// filtro, CSV e PDF — continuava dizendo o contrário.
import { direcaoEfetivaDoc } from '../sefaz-backend/xml-metadata-helper.js';
// "É nota de serviço?" — o MESMO dono que separa o bloco A do C no SPED. Ele
// conhece as formas raras do rótulo (o `nfseNacional` do ADN, os blocos
// prestador/tomador do portal), que é o que o `tipo === 'NFSe'` não vê.
import { ehNotaDeServico } from '../sefaz-backend/sped-selecao-documentos.js';

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
    // 🚨 O RÓTULO DA NFS-e TEM MAIS DE UMA FORMA — e o default é NF-e.
    //
    // A captura do **ADN** gravava `tipo: 'nfseNacional'`; o `tipo === 'NFSe'`
    // acima não casa, `emitente`/`totais.vNF` também não (aquele trilho grava
    // `prestadorCnpj` achatado e `valorServico`), então a nota caía no default
    // e a lista a mostrava como nota de **MERCADORIA**, com valor 0,00.
    //
    // A gravação já foi corrigida, mas **o acervo capturado antes continua com
    // o rótulo antigo** — e é a régua da LEITURA que tem de responder por ele,
    // que é a lição de sempre: campo gravado pode não existir na forma que o
    // leitor espera. Quem sabe dizer "é serviço?" é o dono
    // (`ehNotaDeServico`), o MESMO que separa o bloco A do C no SPED.
    if (ehNotaDeServico(d)) return 'NFSe';
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
    // O DONO decide: `direcaoEfetivaDoc` devolve 'entrada' para a nota própria
    // de entrada (tpNF=0) mesmo com o campo gravado 'saida'. O fallback pelo
    // CNPJ continua valendo quando não há direção legível nenhuma (resNFe).
    const direcaoGravada = s(direcaoEfetivaDoc(d) as string, d?.direcao);
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
