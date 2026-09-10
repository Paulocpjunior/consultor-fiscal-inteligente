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
    doc, updateDoc, deleteField, collection, addDoc, where,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { fetchAllDocs } from './firestorePaginate';

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
/** O teto que `firestore.rules` exige no `list` desta coleção. */
const LIMITE_LIST_PARAMETROS = 2000;

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

export interface LeituraParametrosCfop {
    parametros: ParametroCfopDoc[];
    /** Mensagem da falha de LEITURA. `null` = leitura feita (pode ter vindo vazia). */
    erro: string | null;
}

/**
 * Os parâmetros da empresa.
 *
 * 🚨 A CONSULTA PRECISA DO `limit` — SEM ELE A REGRA NEGA (10/09, ELS: Paulo
 * criava o parâmetro do POSTO BORDO 5656 → 1407, o campo limpava e a lista
 * continuava dizendo "Parâmetros ativos (0)"). `firestore.rules` libera o
 * `list` de `cfop_parametros` com `request.query.limit <= 2000`, e consulta sem
 * limite volta *"Missing or insufficient permissions"* — o fato já estava
 * escrito em DOIS comentários desta casa (`giaStService` e `firestorePaginate`)
 * e nunca tinha virado trava. Quem passa o limite é `fetchAllDocs`, que ainda
 * pagina: `fbLimit(2000)` sozinho truncaria em silêncio.
 *
 * ⚠️ FALHA DE LEITURA NÃO É "NÃO HÁ PARÂMETRO". O `catch { return [] }` antigo
 * fazia a recusa do banco ficar indistinguível de "esta empresa não tem
 * parâmetro" — e o custo é duplo: no painel a pessoa lê "não gravou" (e cria de
 * novo, por cima do que já existe) e no `.FML` o arquivo sai pela régua
 * AUTOMÁTICA, ignorando o CFOP que alguém ensinou de propósito. O erro viaja
 * para quem chamou DIZER, do mesmo jeito que o `lerParametrosCfopDaEmpresa` do
 * backend já fazia desde 07/09 — a metade do front tinha ficado para trás.
 */
export async function lerParametrosCfop(empresaId: string): Promise<LeituraParametrosCfop> {
    if (!empresaId) return { parametros: [], erro: null };
    try {
        const snaps = await fetchAllDocs(
            COLECAO_PARAMETROS,
            [where('empresaId', '==', empresaId)],
            { batchSize: LIMITE_LIST_PARAMETROS },
        );
        return {
            parametros: snaps.map(d => ({ id: d.id, ...(d.data() as any) })) as ParametroCfopDoc[],
            erro: null,
        };
    } catch (e: any) {
        return { parametros: [], erro: e?.message || String(e) };
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
