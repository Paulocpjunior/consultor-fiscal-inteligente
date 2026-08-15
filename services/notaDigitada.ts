/**
 * services/notaDigitada.ts — LANÇAR NOTA SEM XML, no MESMO trilho dos XMLs.
 *
 * Paulo, 15/08: *"importação de XML — automática ou manual — tem a mesma
 * finalidade: abastecer o sistema de lançamentos para que possam ser atendidas
 * as obrigações, relatórios, guias. Até mesmo o lançamento de uma nota de
 * forma manual, devemos poder fazer."*
 *
 * ═══ O DESENHO: uma TERCEIRA PORTA, nunca um segundo banco ══════════════════
 *
 * A nota digitada grava em `documentos_fiscais`, com a MESMA forma que o
 * importer grava — campos chatos + itens[] — para que TODO leitor que já
 * existe (SPED, livros, DIPAM, relatórios, varredura de IPI) a enxergue sem
 * uma linha de código nova. Documento que mora em coleção própria vira um
 * segundo mundo que nenhum relatório soma — o defeito da colcha, de novo.
 *
 * O que a distingue é a ORIGEM (`origem: 'digitada'`), carimbada com quem e
 * quando: dado fiscal digitado sem autor não se audita.
 *
 * ═══ AS TRÊS RÉGUAS QUE MANDAM ══════════════════════════════════════════════
 *
 * 1. **XML VENCE DIGITAÇÃO.** A nota digitada é o retrato que a pessoa fez do
 *    documento; o XML é o documento. Quando a captura trouxer o XML da mesma
 *    chave, ele SUBSTITUI a digitada (upgrade no importer) — e uma digitada
 *    nunca sobrescreve um doc que tem XML. Sem essa régua, a digitada de hoje
 *    travaria como "duplicado" o XML verdadeiro de amanhã — a mesma família
 *    da lápide que travava a reimportação (14/08).
 *
 * 2. **CAMPO DE VALOR NÃO TEM DEFAULT.** Valor zero digitado é resposta;
 *    valor ausente é recusa. A mesma régua do SPED (06/08): zero só entra
 *    quando zero É a resposta.
 *
 * 3. **O CFOP DIGITADO É O DA ESCRITURAÇÃO** — na entrada, 1xxx/2xxx/3xxx; na
 *    saída, 5xxx/6xxx/7xxx. Digitar o CFOP do fornecedor numa entrada é o
 *    erro clássico, e a validação barra com a explicação em vez de aceitar e
 *    deixar o livro sair torto.
 */
import type { DocumentoFiscal } from '../types';

export interface ItemDigitado {
    cfop: string;
    /** Valor do item (obrigatório — campo de valor não tem default). */
    vProd: number | null;
    ncm?: string;
    xProd?: string;
    cst?: string;
    vBC?: number;
    vICMS?: number;
    vIPI?: number;
}

export interface NotaDigitadaInput {
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;
    direcao: 'entrada' | 'saida';
    numero: string;
    serie?: string;
    /** Data de emissão AAAA-MM-DD. */
    dhEmi: string;
    /** Chave de 44 dígitos, OPCIONAL — com ela, o XML futuro assume o lugar. */
    chave?: string;
    /** A contraparte: fornecedor na entrada, cliente na saída. */
    participanteNome: string;
    participanteDoc?: string;
    participanteUf?: string;
    valorTotal: number | null;
    itens: ItemDigitado[];
    digitadaPorEmail: string;
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Erros em PORTUGUÊS com a ação — validação que só diz "inválido" ensina a chutar. */
export function validarNotaDigitada(i: NotaDigitadaInput): string[] {
    const erros: string[] = [];
    if (!i.empresaId || soDigitos(i.empresaCnpj).length !== 14) {
        erros.push('Empresa inválida — ative a empresa antes de lançar.');
    }
    if (!String(i.numero || '').trim()) erros.push('Informe o número da nota.');
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(i.dhEmi || ''))) {
        erros.push('Informe a data de emissão (a competência sai dela).');
    }
    if (i.valorTotal === null || i.valorTotal === undefined || !(Number(i.valorTotal) > 0)) {
        erros.push('Informe o valor total da nota (maior que zero). Valor não tem default.');
    }
    const chave = soDigitos(i.chave);
    if (i.chave && chave.length !== 44) {
        erros.push(`A chave de acesso tem 44 dígitos — a informada tem ${chave.length}. Se não tiver a chave, deixe em branco.`);
    }
    if (!String(i.participanteNome || '').trim()) {
        erros.push(i.direcao === 'entrada'
            ? 'Informe o FORNECEDOR — sem ele a nota cai em "fornecedor indefinido" na DIPAM e nos relatórios.'
            : 'Informe o CLIENTE (destinatário).');
    }
    if (!Array.isArray(i.itens) || !i.itens.length) {
        erros.push('Lance ao menos um item com CFOP e valor — é do item que saem livro, DIPAM e SPED.');
    }
    const iniciaisValidas = i.direcao === 'entrada' ? ['1', '2', '3'] : ['5', '6', '7'];
    for (const [idx, it] of (i.itens || []).entries()) {
        const cfop = soDigitos(it.cfop);
        if (cfop.length !== 4) {
            erros.push(`Item ${idx + 1}: CFOP deve ter 4 dígitos.`);
        } else if (!iniciaisValidas.includes(cfop[0])) {
            erros.push(i.direcao === 'entrada'
                ? `Item ${idx + 1}: CFOP ${cfop} é de SAÍDA. Na entrada se lança o CFOP da ESCRITURAÇÃO (1xxx/2xxx/3xxx) — o 5102 do fornecedor vira 1102 aqui.`
                : `Item ${idx + 1}: CFOP ${cfop} é de ENTRADA — numa saída o CFOP é 5xxx/6xxx/7xxx.`);
        }
        if (it.vProd === null || it.vProd === undefined || !(Number(it.vProd) >= 0)) {
            erros.push(`Item ${idx + 1}: informe o valor do item.`);
        }
    }
    return erros;
}

/**
 * Id DETERMINÍSTICO: relançar a mesma nota corrige a digitação em vez de
 * duplicar o documento. Com chave, o id É a chave — é isso que faz o XML
 * futuro cair NO MESMO documento e fazer o upgrade.
 */
export function idNotaDigitada(i: NotaDigitadaInput): string {
    const chave = soDigitos(i.chave);
    if (chave.length === 44) return chave;
    const comp = String(i.dhEmi || '').slice(0, 7);
    return `digitada_${i.empresaId}_${String(i.numero).trim()}_${String(i.serie || '1').trim()}_${comp}`;
}

/** Monta o documento na MESMA forma que o importer grava. */
export function montarNotaDigitada(i: NotaDigitadaInput): DocumentoFiscal {
    const chave = soDigitos(i.chave);
    const empresaCnpj = soDigitos(i.empresaCnpj);
    const partDoc = soDigitos(i.participanteDoc);
    const competencia = String(i.dhEmi).slice(0, 7);
    // Nota de ENTRADA emitida pela própria empresa não existe na digitação
    // comum; quem digita lança a nota do FORNECEDOR. Então na entrada o
    // emitente é a contraparte, na saída é a empresa — igual ao XML.
    const emitente = i.direcao === 'entrada'
        ? { cnpjCpf: partDoc, nome: i.participanteNome, uf: (i.participanteUf || '').toUpperCase() }
        : { cnpjCpf: empresaCnpj, nome: i.empresaNome, uf: '' };
    const destinatario = i.direcao === 'entrada'
        ? { cnpjCpf: empresaCnpj, nome: i.empresaNome, uf: '' }
        : { cnpjCpf: partDoc, nome: i.participanteNome, uf: (i.participanteUf || '').toUpperCase() };

    return {
        id: idNotaDigitada(i),
        chave: chave.length === 44 ? chave : '',
        xmlHash: '',
        tipo: 'NFe',
        modelo: '55',
        serie: String(i.serie || '1').trim(),
        numero: String(i.numero).trim(),
        tpNF: i.direcao === 'saida' ? '1' : null,
        dhEmi: i.dhEmi,
        competencia,
        direcao: i.direcao,
        // A pessoa afirma lançar de um documento em mãos (DANFE/nota impressa);
        // fica gravado QUEM afirmou — mesma régua do "sem movimento": o app não
        // verifica, a pessoa atesta, e a autoria não some.
        status: 'autorizado',
        empresaId: i.empresaId,
        empresaCnpj,
        empresaNome: i.empresaNome,
        emitente,
        destinatario,
        // Campos CHATOS também — metade dos leitores lê esta forma (11/08).
        cnpjEmit: emitente.cnpjCpf,
        xNomeEmit: emitente.nome,
        ufEmit: emitente.uf,
        cnpjDest: destinatario.cnpjCpf,
        xNomeDest: destinatario.nome,
        ufDest: destinatario.uf,
        totais: { vNF: Number(i.valorTotal) },
        valorTotal: Number(i.valorTotal),
        itens: i.itens.map((it, idx) => ({
            nItem: String(idx + 1),
            cfop: soDigitos(it.cfop),
            ncm: soDigitos(it.ncm) || undefined,
            xProd: it.xProd || `ITEM ${idx + 1} (digitado)`,
            vProd: Number(it.vProd),
            cst: it.cst || undefined,
            vBC: it.vBC !== undefined ? Number(it.vBC) : undefined,
            vICMS: it.vICMS !== undefined ? Number(it.vICMS) : undefined,
            vIPI: it.vIPI !== undefined ? Number(it.vIPI) : undefined,
        })),
        origem: 'digitada',
        digitadaPorEmail: i.digitadaPorEmail,
        digitadaEm: new Date().toISOString(),
        importadoPorEmail: i.digitadaPorEmail,
    } as unknown as DocumentoFiscal;
}

/**
 * Pode gravar por cima do que já existe?
 *
 * · nada lá → grava;
 * · lá está uma DIGITADA → regrava (corrigir digitação é o uso normal);
 * · lá está um doc COM XML → RECUSA com o estado dito: o documento vence o
 *   retrato, e a recusa aponta a saída (conferir/editar não é digitar de novo).
 */
export function podeGravarSobre(existente: { origem?: string; xmlHash?: string } | null | undefined):
    { ok: boolean; motivo?: string } {
    if (!existente) return { ok: true };
    if (existente.origem === 'digitada') return { ok: true };
    return {
        ok: false,
        motivo: 'Já existe este documento com XML no banco — o XML vence a digitação. '
            + 'Confira na Central de Documentos; se o XML estiver errado, o caminho é o ↻ Substituir da importação, não digitar por cima.',
    };
}
