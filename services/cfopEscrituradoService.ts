/**
 * cfopEscrituradoService — grava o CFOP que a pessoa informou NAQUELA nota.
 *
 * ═══ POR QUE POR NF ═════════════════════════════════════════════════════════
 *
 * Paulo, 17/08, comparando o Resumo por CFOP do CFI com o livro de Entradas do
 * E-Fiscal: *"é necessário incluir um campo para lançamento das notas
 * escrituradas, a fim de corrigir esses detalhes e facilitar a conferência"*. E,
 * quando perguntei se era por NOTA ou por ITEM: **"é por NF"**.
 *
 * A decisão é dele e está registrada. A consequência também: nota com itens de
 * CFOPs diferentes passa a sair com UM só — por isso a tela DIZ isso antes do
 * clique (`cfopsDistintosDaNota`), em vez de o total mudar sozinho depois.
 *
 * ═══ O QUE ESTE MÓDULO NÃO FAZ ══════════════════════════════════════════════
 *
 * Não decide CFOP. Quem decide é `cfopDoLancamento` (régua única, em
 * sefaz-backend/cfop-correlacao.js), lido por TODOS os leitores — livro,
 * Resumo por CFOP, C170/C190 do SPED e Exportar SAGE. Aqui só se GRAVA.
 *
 * ⚠️ Reescrita de dado fiscal sem QUEM e QUANDO não se reconstrói depois: o
 * carimbo (`cfopEscrituradoPor`/`cfopEscrituradoEm`) é obrigatório, igual ao
 * `_substituidoEm` da importação com substituição (14/08).
 */
import {
    doc, updateDoc, deleteField, collection, addDoc, getDocs, query, where, orderBy,
} from 'firebase/firestore';
import { db } from './firebaseConfig';

/** A coleção mora aqui porque `COLLECTIONS` do xmlFiscalService não é exportada. */
const COLECAO_DOCUMENTOS = 'documentos_fiscais';
import { validarCfopEscriturado } from '../sefaz-backend/cfop-correlacao.js';

export interface GravarCfopEscrituradoInput {
    documentoId: string;
    /** 'entrada' | 'saida' — decide a FAIXA aceita (1/2/3 × 5/6/7). */
    direcao: 'entrada' | 'saida';
    /** CFOP informado. VAZIO devolve a nota à régua automática. */
    cfop: string;
    /** E-mail de quem informou — sem ele a reescrita fica órfã. */
    porEmail: string;
}

export async function gravarCfopEscriturado(i: GravarCfopEscrituradoInput): Promise<{ cfop: string }> {
    if (!i.documentoId) throw new Error('Documento sem id — não dá para gravar.');
    if (!String(i.porEmail || '').trim()) {
        // Mesma regra do createdBy da nota digitada: a recusa DIZ a causa em vez
        // de deixar o banco responder com "permission denied".
        throw new Error('Sessão sem usuário identificado — saia e entre de novo. '
            + 'O CFOP informado fica gravado com quem informou.');
    }
    const v = validarCfopEscriturado(i.cfop, i.direcao);
    if (!v.ok) throw new Error(v.motivo);

    const ref = doc(db, COLECAO_DOCUMENTOS, i.documentoId);
    if (!v.cfop) {
        // LIMPAR devolve a nota à régua automática — e apaga o carimbo junto,
        // senão sobra "informado por fulano" numa nota que ninguém mais informa.
        await updateDoc(ref, {
            cfopEscriturado: deleteField(),
            cfopEscrituradoPor: deleteField(),
            cfopEscrituradoEm: deleteField(),
        });
        return { cfop: '' };
    }
    await updateDoc(ref, {
        cfopEscriturado: v.cfop,
        cfopEscrituradoPor: i.porEmail,
        cfopEscrituradoEm: new Date().toISOString(),
    });
    return { cfop: v.cfop };
}


// ═══════════════════════════════════════════════════════════════════════════
// 🧠 O CÉREBRO — a decisão humana vira PARÂMETRO para as próximas notas
// ═══════════════════════════════════════════════════════════════════════════
//
// Paulo, 18/08: *"um cérebro que, quando o usuário faz a alteração de forma
// manual, ele deve gravar, criando um parâmetro para os próximos meses"*.
//
// A coleção é POR EMPRESA (`empresaId` no doc): o mesmo fornecedor pode ter
// destino diferente em clientes diferentes — o posto que abastece o caminhão de
// um é o fornecedor de revenda do outro.

const COLECAO_PARAMETROS = 'cfop_parametros';

export interface ParametroCfopDoc {
    id?: string;
    empresaId: string;
    cnpjFornecedor: string;
    nomeFornecedor?: string | null;
    cfopOrigem?: string | null;
    cfopDestino: string;
    vigenciaInicio: string;
    ativo: boolean;
    criadoPor?: string | null;
    criadoEm?: string | null;
}

/** Os parâmetros ATIVOS da empresa. Falha de leitura devolve [] — o cérebro é
 *  um palpite melhor, não uma trava: sem ele a régua automática segue valendo. */
export async function lerParametrosCfop(empresaId: string): Promise<ParametroCfopDoc[]> {
    if (!empresaId) return [];
    try {
        const snap = await getDocs(query(
            collection(db, COLECAO_PARAMETROS),
            where('empresaId', '==', empresaId),
        ));
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ParametroCfopDoc[];
    } catch {
        return [];
    }
}

export async function gravarParametroCfop(p: {
    empresaId: string;
    cnpjFornecedor: string;
    nomeFornecedor?: string | null;
    cfopOrigem?: string | null;
    cfopDestino: string;
    vigenciaInicio: string;
    porEmail: string;
}): Promise<void> {
    if (!p.empresaId) throw new Error('Empresa não identificada.');
    if (!String(p.porEmail || '').trim()) {
        throw new Error('Sessão sem usuário identificado — saia e entre de novo. '
            + 'O parâmetro fica gravado com quem o criou.');
    }
    // ⚠️ O destino é validado com a MESMA régua da nota (faixa × direção). O
    // parâmetro se aplica a ENTRADAS, então o CFOP tem que ser de entrada —
    // senão ele espalharia um CFOP torto por todas as notas do fornecedor.
    const v = validarCfopEscriturado(p.cfopDestino, 'entrada');
    if (!v.ok) throw new Error(v.motivo);
    if (!v.cfop) throw new Error('Parâmetro precisa de um CFOP de destino.');
    if (!/^\d{4}-\d{2}$/.test(String(p.vigenciaInicio || ''))) {
        throw new Error('Parâmetro precisa da competência a partir da qual ele vale.');
    }
    await addDoc(collection(db, COLECAO_PARAMETROS), {
        empresaId: p.empresaId,
        cnpjFornecedor: String(p.cnpjFornecedor).replace(/\D/g, ''),
        nomeFornecedor: p.nomeFornecedor || null,
        cfopOrigem: p.cfopOrigem ? String(p.cfopOrigem).replace(/\D/g, '') : null,
        cfopDestino: v.cfop,
        vigenciaInicio: p.vigenciaInicio,
        ativo: true,
        criadoPor: p.porEmail,
        criadoEm: new Date().toISOString(),
    });
}

/**
 * Desliga o parâmetro — NÃO apaga.
 *
 * Apagar tiraria da vista a explicação das competências que ele já datou, e a
 * pergunta "por que esta nota saiu 1407 em julho?" ficaria sem resposta. Mesma
 * regra do calendário municipal desativado.
 */
export async function desligarParametroCfop(id: string, porEmail: string): Promise<void> {
    if (!id) throw new Error('Parâmetro sem id.');
    await updateDoc(doc(db, COLECAO_PARAMETROS, id), {
        ativo: false,
        desligadoPor: porEmail || null,
        desligadoEm: new Date().toISOString(),
    });
}
