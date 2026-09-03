/**
 * documentoRetirada.ts — tirar da empresa uma nota que entrou errada (PURO).
 *
 * 🚨 O CASO (03/09, Paulo): *"lancei uma nota da J.P. PISSATO na empresa SILVIO
 * FREIRE, e o consultor não deu nenhum erro avisando de que eu estava
 * importando na empresa errada, e eu não me atentei tbm. **Como resolver?**"*
 *
 * 📌 A resposta era: **não tinha como** — e isso foi MEDIDO. `deleteDocumento`
 * existe em `xmlFiscalService` desde sempre e **NENHUMA tela a chama**: é a
 * "rota sem botão" (13/08), código morto com cara de entrega. O documento
 * entrou no livro da empresa errada e não havia caminho nenhum para tirá-lo.
 *
 * 🚨 E O CUSTO É DOS DOIS LADOS: a nota INFLA o serviço tomado de quem não a
 * tomou (Livro, competência, bloco A do EFD-Contribuições) e SOME do livro de
 * quem tomou. Nenhum validador acusa — o documento é legítimo e o cadastro das
 * duas empresas está certo.
 *
 * ─── AS TRÊS DECISÕES QUE MANDAM ────────────────────────────────────────────
 *
 * 1. **LÁPIDE, NUNCA APAGAR DE VERDADE.** É a régua de 24/07 (caso WALDESA): o
 *    `deleteDoc` físico leva junto a prova de que a nota esteve ali, de quem a
 *    pôs e de quando. Reescrita de dado fiscal sem quem/quando não se
 *    reconstrói — e aqui a pergunta *"por que o livro de agosto mudou?"* vai
 *    ser feita. `_deleted` já é filtrado por toda a listagem.
 *
 * 2. **TIRAR DE UMA NÃO PÕE NA OUTRA — e a frase DIZ isso.** Sem essa linha,
 *    quem tira acha que resolveu e a nota fica faltando nas DUAS empresas, que
 *    é livro a MENOR: o erro caro. A nota tem de ser importada na empresa
 *    certa, e a tela manda fazer isso.
 *
 * 3. **MOTIVO ESCRITO E AUTOR OBRIGATÓRIOS** (o piso de 15 caracteres da T3 da
 *    DCTFWeb e da reabertura do fim de mês): tirar nota de livro é decisão, e
 *    decisão sem dono não se confere depois. Um mês daqui ninguém lembra por
 *    que aquela nota saiu.
 */

/** Piso do motivo — o mesmo da T3 da DCTFWeb e da reabertura do fim de mês. */
export const MIN_MOTIVO_RETIRADA = 15;

export interface DocumentoParaRetirar {
    id?: string | null;
    numero?: string | null;
    empresaNome?: string | null;
    empresaCnpj?: string | null;
    competencia?: string | null;
    /** Lápide que já esteja lá — retirar duas vezes não é operação. */
    _deleted?: boolean;
}

export interface RetiradaRecusada {
    ok: false;
    motivo: string;
}

export interface RetiradaAceita {
    ok: true;
    /** Patch de MERGE — nunca substitui o documento. */
    patch: Record<string, unknown>;
    /** O que a tela precisa DIZER depois de tirar. */
    avisoDepois: string;
}

export type Retirada = RetiradaAceita | RetiradaRecusada;

/**
 * Decide se a nota pode sair da empresa, e monta a lápide.
 *
 * @param doc     o documento como está no banco
 * @param motivo  o que a pessoa escreveu
 * @param autor   { uid, email } de quem está tirando
 * @param agora   injetável nos testes
 */
export function retirarDocumentoDaEmpresa(
    doc: DocumentoParaRetirar | null | undefined,
    motivo: string,
    autor: { uid?: string | null; email?: string | null } | null | undefined,
    agora: Date = new Date(),
): Retirada {
    if (!doc || !doc.id) {
        return { ok: false, motivo: 'Documento não identificado — recarregue a lista e tente de novo.' };
    }
    // ⚠️ Já retirada NÃO é erro de sistema: é operação que já aconteceu, e
    // repetir sobrescreveria o autor e o motivo originais com os de agora.
    if (doc._deleted) {
        return {
            ok: false,
            motivo: 'Esta nota JÁ foi tirada desta empresa — ela não conta mais no livro daqui. '
                + 'Se ela ainda não está na empresa certa, importe-a lá.',
        };
    }
    const texto = String(motivo || '').trim();
    if (texto.length < MIN_MOTIVO_RETIRADA) {
        return {
            ok: false,
            motivo: `Escreva o motivo (mínimo ${MIN_MOTIVO_RETIRADA} caracteres): tirar nota do livro é `
                + 'decisão, e daqui a um mês ninguém lembra por que ela saiu. '
                + 'Ex.: "nota é da J.P. PISSATO, importada aqui por engano".',
        };
    }
    // 🚨 AUTOR OBRIGATÓRIO: decisão sem dono não se confere depois — é a mesma
    // régua do ajuste de retenção e da reabertura do fim de mês.
    const uid = String(autor?.uid || '').trim();
    const email = String(autor?.email || '').trim();
    if (!uid && !email) {
        return {
            ok: false,
            motivo: 'Sessão expirada — saia e entre de novo. A retirada fica gravada com quem a fez, '
                + 'e sem isso ela não pode ser registrada.',
        };
    }

    return {
        ok: true,
        // MERGE, nunca `set`: o documento inteiro continua lá — a lápide só o
        // tira das listas e dos recortes, e `_deleted: false` o traz de volta.
        patch: {
            _deleted: true,
            _deletedEm: agora.toISOString(),
            _deletedPor: uid || null,
            _deletedPorEmail: email || null,
            _deletedMotivo: texto,
        },
        // 🚨 A LINHA QUE IMPEDE O LIVRO A MENOS: tirar daqui NÃO põe lá.
        avisoDepois: `Nota ${doc.numero || ''} tirada de ${doc.empresaNome || 'esta empresa'}`
            + `${doc.competencia ? ` (competência ${doc.competencia})` : ''}. `
            + 'ATENÇÃO: isto NÃO a moveu para a empresa certa — importe-a lá, senão ela fica faltando '
            + 'nas duas. O documento não foi apagado: ele fica registrado com o motivo e com quem tirou.',
    };
}

/** A frase do estado, para a nota que já saiu — quem/quando/por quê. */
export function explicarRetirada(doc: {
    _deleted?: boolean;
    _deletedEm?: string | null;
    _deletedPorEmail?: string | null;
    _deletedMotivo?: string | null;
} | null | undefined): string | null {
    if (!doc?._deleted) return null;
    const quando = doc._deletedEm ? new Date(doc._deletedEm) : null;
    const data = quando && !Number.isNaN(quando.getTime())
        ? quando.toLocaleDateString('pt-BR')
        : null;
    return `Tirada desta empresa${data ? ` em ${data}` : ''}`
        + `${doc._deletedPorEmail ? ` por ${doc._deletedPorEmail}` : ''}`
        + `${doc._deletedMotivo ? ` — "${doc._deletedMotivo}"` : ''}. `
        + 'Ela não conta no livro daqui; o documento continua guardado.';
}
