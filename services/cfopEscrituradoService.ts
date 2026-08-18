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
import { doc, updateDoc, deleteField } from 'firebase/firestore';
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
