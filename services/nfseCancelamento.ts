// ============================================================================
// services/nfseCancelamento.ts  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 NOTA CANCELADA CONTANDO NO FATURAMENTO — O ERRO QUE SAI DO ESCRITÓRIO.
//
// 02/09, MARCOS ANTONIO ZAMBOLIN INFORMATICA · 08/2026. A NFS-e **205** de
// Santo André está com o carimbo **CANCELADA** na cara do PDF ("Motivo
// Cancelamento: Preenchimento incompleto da NFS-e"), e o app a mostra como
// **🟢 Vigente**. O relatório de Serviços Prestados soma as duas notas —
// **R$ 27.219,10** — quando a receita real do mês é **R$ 13.609,55**: a 206
// SUBSTITUI a 205, e o app contou as duas.
//
// 📌 **NA NFS-e O CANCELAMENTO ESTÁ DENTRO DO DOCUMENTO** — não há evento
// (é a exceção declarada em `docCancelado`: ADN e portal não têm evento, quem
// informa é a própria nota). O leitor conhecia TRÊS formas
// (`NfseCancelamento`, `DataHoraCancelamento`) e a de Santo André não é
// nenhuma delas.
//
// ✂️ Em vez de adivinhar o nome da tag daquela prefeitura — o que produziria
// o mesmo silêncio na PRÓXIMA —, a régua lê o **VOCABULÁRIO do documento**:
// qualquer tag cujo nome fale de CANCELAMENTO e que traga conteúdo. É a mesma
// decisão do explorador do SharePoint: **navegar, não prever**.
//
// ⚠️ **O ERRO AQUI TEM LADOS DE CUSTO DIFERENTE, e por isso a régua é
// CONSERVADORA**: deixar cancelada passar infla o faturamento (o que
// aconteceu); marcar uma nota VÁLIDA como cancelada **apaga receita** de um
// livro fiscal, que é pior. Por isso valor falso (`false`, `não`, `0`) NÃO
// cancela, e a SUBSTITUIÇÃO fica de fora — `NfseSubstituida` e
// `NfseSubstituidora` apontam para lados OPOSTOS (uma diz "fui substituída",
// a outra "eu substituo"), e trocar as duas apagaria a nota boa.
// ============================================================================

export interface TagComTexto {
    tag: string;
    texto: string;
}

/** Valores que NEGAM o cancelamento — sem isso `<PodeCancelar>false</…>` cancelaria. */
const NEGATIVOS = new Set(['false', '0', 'n', 'nao', 'não', 'no']);

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** O nome local da tag — `ns2:MotivoCancelamento` é `MotivoCancelamento`. */
export function nomeLocal(tag: string): string {
    const t = String(tag || '');
    return t.includes(':') ? t.split(':').pop()! : t;
}

export interface CancelamentoDeclarado {
    cancelada: boolean;
    /** A tag que declarou — é ela que explica o veredito para quem confere. */
    tag: string | null;
    /** O que estava escrito nela (o motivo, quando a prefeitura o traz). */
    texto: string | null;
}

/**
 * O documento declara cancelamento?
 *
 * ⚠️ Lê o VOCABULÁRIO: `DataHoraCancelamento`, `MotivoCancelamento`,
 * `NfseCancelamento`, `JustificativaCancelamento`, `CodigoCancelamento`… —
 * qualquer uma delas, de qualquer prefeitura, com conteúdo que não seja uma
 * negação. Listar os nomes conhecidos é a trava por LISTA (13/08): ela cobre o
 * que alguém lembrou, e envelhece na próxima prefeitura, EM SILÊNCIO.
 */
export function cancelamentoDeclarado(tags: TagComTexto[]): CancelamentoDeclarado {
    for (const t of tags || []) {
        const nome = nomeLocal(t?.tag || '');
        if (!/cancelamento/i.test(semAcento(nome))) continue;
        const texto = String(t?.texto ?? '').trim();
        if (!texto) continue;                                   // tag vazia não declara nada
        if (NEGATIVOS.has(semAcento(texto).toLowerCase())) continue;
        return { cancelada: true, tag: nome, texto };
    }
    return { cancelada: false, tag: null, texto: null };
}
