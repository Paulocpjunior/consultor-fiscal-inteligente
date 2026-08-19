/**
 * cstEscrituradoService — grava o CST que a pessoa informou NAQUELA nota.
 *
 * ═══ POR QUE EXISTE ═════════════════════════════════════════════════════════
 *
 * Paulo, 19/08: *"teria a possibilidade de ajustarmos o CST e visualizar o CST
 * que vem na nota do fornecedor?"*. O CST segue o CFOP pela régua automática
 * (`cstDoLancamento`), mas há casos que só quem olha a nota resolve — e a régua
 * já se recusa a converter quando o CST declara um fato próprio (isenção,
 * diferimento, ST anterior).
 *
 * ═══ O CAMPO É A TRIBUTAÇÃO, NÃO O CST INTEIRO ══════════════════════════════
 *
 * ⚠️ A ORIGEM da mercadoria mora no 1º dígito e é fato da MERCADORIA, não da
 * operação. Gravar "090" cru faria todo produto IMPORTADO (origem 1) virar
 * NACIONAL dentro do SPED — a armadilha que a própria régua de conversão já
 * evita. Por isso só a TRIBUTAÇÃO é informada (2 dígitos) e a origem continua
 * vindo do item. Digitar 3 dígitos vale a tributação; a tela diz isso.
 *
 * ═══ O QUE ESTE MÓDULO NÃO FAZ ══════════════════════════════════════════════
 *
 * Não decide CST. Quem decide é `cstDoLancamento` (régua única), lida pelo
 * C170 e pelo C190 do SPED — os dois pela MESMA função, senão o detalhe e o
 * consolidado do mesmo item contariam histórias diferentes. Aqui só se GRAVA.
 *
 * Mesma regra do CFOP por nota: reescrita de dado fiscal sem QUEM e QUANDO não
 * se reconstrói depois, então o carimbo é obrigatório.
 */
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from './firebaseConfig';
import { validarCstEscriturado } from '../sefaz-backend/cst-correlacao.js';

const COLECAO_DOCUMENTOS = 'documentos_fiscais';

export interface GravarCstEscrituradoInput {
    documentoId: string;
    /** Tributação informada (2 dígitos). VAZIO devolve a nota à régua. */
    cst: string;
    /** E-mail de quem informou — sem ele a reescrita fica órfã. */
    porEmail: string;
}

export async function gravarCstEscriturado(i: GravarCstEscrituradoInput): Promise<{ cst: string }> {
    if (!i.documentoId) throw new Error('Documento sem id — não dá para gravar.');
    if (!String(i.porEmail || '').trim()) {
        throw new Error('Sessão sem usuário identificado — saia e entre de novo. '
            + 'O CST informado fica gravado com quem informou.');
    }
    const v = validarCstEscriturado(i.cst);
    if (!v.ok) throw new Error(v.motivo);

    const ref = doc(db, COLECAO_DOCUMENTOS, i.documentoId);
    if (!v.cst) {
        // LIMPAR devolve a nota à régua automática — e apaga o carimbo junto.
        await updateDoc(ref, {
            cstEscriturado: deleteField(),
            cstEscrituradoPor: deleteField(),
            cstEscrituradoEm: deleteField(),
        });
        return { cst: '' };
    }
    await updateDoc(ref, {
        cstEscriturado: v.cst,
        cstEscrituradoPor: i.porEmail,
        cstEscrituradoEm: new Date().toISOString(),
    });
    return { cst: v.cst };
}
