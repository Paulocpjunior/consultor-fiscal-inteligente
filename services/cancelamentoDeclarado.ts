/**
 * cancelamentoDeclarado.ts — "esta nota está CANCELADA", quando só o papel diz.
 *
 * 🚨 O CASO (10/09, Paulo, JG SOLUCOES EM TECNOLOGIA · Barueri · NFS-e 76 de
 * R$ 15.004,06): *"essas duas notas são canceladas, importei as notas pelo
 * portal nacional e as mesmas subiram como ativas … poderia existir um campo
 * para cancelarmos quando acontecer isso"*.
 *
 * 📌 **O DOCUMENTO CAPTURADO NÃO SABE DO CANCELAMENTO, e isso não é defeito de
 * captura.** O Padrão Nacional (ADN) entregou a nota como ela estava quando foi
 * transcrita: `status: autorizado`. O cancelamento aconteceu DEPOIS, no sistema
 * da **prefeitura de Barueri** — e o CFI não fala com aquele portal. É o
 * "dedup por EXISTÊNCIA" de 02/09 num trilho municipal: **todo fato que nasce
 * DEPOIS da captura é invisível para quem só pergunta uma vez.**
 *
 * 🚨 E O CUSTO É RECEITA INFLADA: nota cancelada contando no faturamento, no
 * Livro de Serviços, no Resumo por CFOP, na competência e no bloco A do
 * EFD-Contribuições. Nenhum validador acusa — o documento é legítimo. É
 * exatamente o caso MARCOS ANTONIO ZAMBOLIN (02/09), em que a 205 cancelada
 * somou com a 206 que a substituiu e o mês saiu pelo dobro.
 *
 * ─── AS QUATRO DECISÕES QUE MANDAM ──────────────────────────────────────────
 *
 * 1. **É DECLARAÇÃO SOBRE O DOCUMENTO, NUNCA REESCRITA DELE** (a régua de
 *    04/09). O `status` capturado fica como veio — ele é a prova do que a fonte
 *    disse. O que vale sai CARIMBADO com quem afirmou, quando e por quê, e há
 *    caminho de volta. Reescrever o `status` apagaria a diferença entre "a
 *    fonte disse" e "alguém afirmou", que é a única coisa que se confere depois.
 *
 * 2. **QUEM DECIDE É A RÉGUA DA LEITURA** (`docCancelado`, no dono). Uma
 *    declaração que só a tela honrasse seria a "régua que só escreve": o
 *    faturamento continuaria inflado e a pessoa acharia que resolveu.
 *
 * 3. **MOTIVO ESCRITO E AUTOR OBRIGATÓRIOS** (o piso de 15 caracteres da T3 da
 *    DCTFWeb, da retirada da empresa e da reabertura do fim de mês). Marcar
 *    nota VÁLIDA como cancelada **APAGA RECEITA** — é o lado caro do erro
 *    (02/09), e decisão que apaga receita não pode ser um clique anônimo.
 *
 * 4. **SÓ CANCELA — NUNCA "DESCANCELA".** Documento que já diz cancelado não
 *    recebe declaração (não há o que declarar), e o ↩ apenas REMOVE a
 *    declaração, devolvendo a nota à régua do documento. Declarar "esta nota
 *    vale" por cima de um cancelamento da fonte seria o app contradizendo o
 *    órgão.
 */

/** Piso do motivo — o mesmo da retirada da empresa e da T3 da DCTFWeb. */
export const MIN_MOTIVO_CANCELAMENTO = 15;

export interface DocumentoParaCancelar {
    id?: string | null;
    numero?: string | null;
    /** O que a FONTE disse — nunca é reescrito por esta declaração. */
    status?: string | null;
    cStat?: string | null;
    eventos?: unknown[] | null;
    cancelamentoDeclarado?: {
        em?: string | null;
        por?: string | null;
        porEmail?: string | null;
        motivo?: string | null;
    } | null;
}

export interface CancelamentoRecusado { ok: false; motivo: string }
export interface CancelamentoAceito {
    ok: true;
    /** Patch de MERGE — o documento inteiro continua lá. */
    patch: Record<string, unknown>;
    /** O que a tela precisa DIZER depois. */
    avisoDepois: string;
}
export type Cancelamento = CancelamentoAceito | CancelamentoRecusado;

/**
 * A nota já consta cancelada pelo PRÓPRIO documento?
 *
 * Recorte deliberadamente ESTREITO: só o que a fonte gravou. Quem responde
 * "esta nota está cancelada?" para o app inteiro é `docCancelado`, no dono —
 * reimplementar a régua aqui seria a segunda cópia, e ela divergiria no
 * primeiro leiaute novo.
 */
function jaCanceladaPelaFonte(doc: DocumentoParaCancelar): boolean {
    const status = String(doc.status || '').toLowerCase();
    if (['cancelado', 'cancelada'].includes(status)) return true;
    if (['101', '151'].includes(String(doc.cStat || ''))) return true;
    return (Array.isArray(doc.eventos) ? doc.eventos : []).some((e) => {
        const ev = (e || {}) as Record<string, unknown>;
        return String(ev.tpEvento || '') === '110111' || String(ev.tipo || '') === 'cancelamento';
    });
}

export function declararNotaCancelada(
    doc: DocumentoParaCancelar | null | undefined,
    motivo: string,
    autor: { uid?: string | null; email?: string | null } | null | undefined,
    agora: Date = new Date(),
): Cancelamento {
    if (!doc || !doc.id) {
        return { ok: false, motivo: 'Documento não identificado — recarregue a lista e tente de novo.' };
    }
    // ⚠️ Já cancelada pela FONTE não é erro: é declaração sem objeto. Gravar
    // aqui poria um carimbo humano sobre um fato do órgão, e quem conferisse
    // depois não saberia qual dos dois respondeu.
    if (jaCanceladaPelaFonte(doc)) {
        return {
            ok: false,
            motivo: 'Esta nota JÁ consta como cancelada pelo próprio documento — ela não conta no '
                + 'faturamento nem nos livros. Não há o que declarar.',
        };
    }
    // ⚠️ Repetir sobrescreveria o autor e o motivo originais pelos de agora.
    if (doc.cancelamentoDeclarado && String(doc.cancelamentoDeclarado.em || '').trim()) {
        return {
            ok: false,
            motivo: 'Esta nota já foi declarada cancelada. Para mudar a declaração, remova a atual '
                + 'primeiro (↩) — assim o motivo e o autor originais não são apagados por engano.',
        };
    }
    const texto = String(motivo || '').trim();
    if (texto.length < MIN_MOTIVO_CANCELAMENTO) {
        return {
            ok: false,
            motivo: `Escreva o motivo (mínimo ${MIN_MOTIVO_CANCELAMENTO} caracteres). Marcar como `
                + 'cancelada uma nota que a fonte diz autorizada APAGA RECEITA do livro — daqui a um '
                + 'mês ninguém lembra por quê. Ex.: "cancelada no portal de Barueri, PDF com carimbo".',
        };
    }
    // 🚨 AUTOR OBRIGATÓRIO: é a mesma régua do ajuste de retenção, da retirada
    // da empresa e da reabertura do fim de mês.
    const uid = String(autor?.uid || '').trim();
    const email = String(autor?.email || '').trim();
    if (!uid && !email) {
        return {
            ok: false,
            motivo: 'Sessão expirada — saia e entre de novo. A declaração fica gravada com quem a fez, '
                + 'e sem isso ela não pode ser registrada.',
        };
    }

    return {
        ok: true,
        patch: {
            // MERGE: o `status` capturado NÃO é tocado — ele é a prova do que a
            // fonte disse, e é contra ele que se confere a declaração.
            cancelamentoDeclarado: {
                em: agora.toISOString(),
                por: uid || null,
                porEmail: email || null,
                motivo: texto,
            },
        },
        avisoDepois: `Nota ${doc.numero || ''} declarada CANCELADA. Ela sai do faturamento, do Livro de `
            + 'Serviços, do Resumo por CFOP, da competência e do SPED. O documento não é apagado: fica '
            + 'com o motivo e com quem declarou, e dá para voltar atrás.',
    };
}

/**
 * Remover a declaração — o ↩ que nasce junto do botão que tira do total.
 *
 * A régua de 14/08 (caso NOVA ERA): botão que tira coisa do total nasce com o
 * botão que desfaz, e o desfazer diz QUANTO volta. Aqui o que volta é a nota
 * inteira ao livro, então a frase diz isso.
 */
export function removerCancelamentoDeclarado(
    doc: DocumentoParaCancelar | null | undefined,
): Cancelamento {
    if (!doc || !doc.id) {
        return { ok: false, motivo: 'Documento não identificado — recarregue a lista e tente de novo.' };
    }
    if (!doc.cancelamentoDeclarado || !String(doc.cancelamentoDeclarado.em || '').trim()) {
        return { ok: false, motivo: 'Esta nota não tem cancelamento declarado — não há o que remover.' };
    }
    return {
        ok: true,
        // `null` APAGA o campo no merge do Firestore. Deixar o objeto vazio
        // faria a régua da leitura ver "declaração existe" e continuar tirando
        // a nota do livro — o defeito com outra roupa.
        patch: { cancelamentoDeclarado: null },
        avisoDepois: `Declaração removida. A nota ${doc.numero || ''} volta a valer pelo que o próprio `
            + 'documento diz, e volta a contar no faturamento e nos livros.',
    };
}
