// ============================================================================
// sefaz-backend/whatsapp-presenca.js — quem está no ar AGORA
// ----------------------------------------------------------------------------
// Última linha 🟡 de uso diário do de-para. E o valor dela não é a bolinha na
// lista de gente: é **a hora de transferir**. Hoje quem manda a conversa para o
// Fiscal não sabe se tem alguém do Fiscal no ar — a conversa some da mesa dele
// e vai esperar numa fila vazia, e ninguém fica sabendo até o cliente cobrar.
//
// 🚨 O QUE ESTE MÓDULO SE RECUSA A DIZER: **"offline"**. O app enxerga UMA
// coisa — que o inbox mandou sinal, e quando. Ele não sabe se a pessoa fechou
// a aba, se o computador dormiu, se a rede caiu ou se ela está no telefone com
// o cliente. Chamar tudo isso de "offline" é afirmar o que não foi medido, e
// aqui isso tem consequência: alguém deixaria de transferir para quem está lá.
// Por isso a saída é o FATO — "no ar agora" ou "sem sinal há N min" — e a
// ausência de sinal NUNCA vira ausência da pessoa.
//
// ⚠️ E ausência de sinal também não é motivo para BLOQUEAR transferência: ela
// informa, não impede. Trava sem certeza é trava que a equipe contorna.
// ============================================================================

/** Sinal mais novo que isto = a pessoa está com o inbox aberto agora. */
export const JANELA_NO_AR_MS = 3 * 60 * 1000;

/**
 * De quanto em quanto tempo o inbox manda sinal. Precisa ser BEM menor que a
 * janela, senão a pessoa pisca entre "no ar" e "sem sinal" a cada batida —
 * e indicador que pisca é indicador que ninguém acredita.
 */
export const INTERVALO_SINAL_MS = 60 * 1000;

const ms = (v) => {
    if (!v) return 0;
    if (typeof v?.toMillis === 'function') return v.toMillis();   // Timestamp
    return Date.parse(v) || 0;
};

/**
 * Traduz o último sinal em algo que se pode escrever na tela.
 * Devolve SEMPRE `desde` (minutos) quando há sinal, porque "sem sinal" sem o
 * tempo é a metade inútil da resposta: 4 minutos e 4 horas pedem reações
 * diferentes de quem vai transferir.
 */
export function situacaoDaPresenca(ultimoSinal, agora = Date.now(), janela = JANELA_NO_AR_MS) {
    const em = ms(ultimoSinal);
    if (!em) return { situacao: 'sem-registro', texto: 'sem registro de acesso', minutos: null };
    const decorrido = Math.max(0, agora - em);
    if (decorrido <= janela) return { situacao: 'no-ar', texto: 'no ar agora', minutos: 0 };
    const minutos = Math.floor(decorrido / 60000);
    return {
        situacao: 'sem-sinal',
        // ⚠️ "sem sinal", nunca "ausente": o app mediu o sinal, não a pessoa.
        texto: minutos < 60
            ? `sem sinal há ${minutos} min`
            : `sem sinal há ${Math.floor(minutos / 60)}h`,
        minutos,
    };
}

/**
 * Quem da FILA está no ar — a pergunta que a transferência precisa responder.
 *
 * 🚨 A régua de quem "é" da fila é a MESMA do inbox (`filasVisiveis`), passada
 * de fora: reescrevê-la aqui criaria uma segunda resposta para "quem atende o
 * Fiscal?", e as duas divergiriam no primeiro gestor cadastrado.
 */
export function quemDaFilaEstaNoAr({ fila, atendentes = [], presencas = {}, agora = Date.now() }) {
    const daFila = atendentes.filter((a) => {
        // `filas: null` = vê tudo (gestor, Recepção, dono). Quem vê tudo conta
        // como cobertura da fila — é quem de fato pode pegar a conversa.
        if (a.filas == null) return true;
        return (a.filas || []).includes(fila);
    });
    const comSituacao = daFila.map((a) => ({
        email: a.email,
        nome: a.nome || a.email,
        ...situacaoDaPresenca(presencas[String(a.email || '').toLowerCase()], agora),
    }));
    const noAr = comSituacao.filter((a) => a.situacao === 'no-ar');
    return {
        fila,
        total: comSituacao.length,
        noAr: noAr.length,
        pessoas: comSituacao.sort((a, b) => {
            if (a.situacao === b.situacao) return String(a.nome).localeCompare(String(b.nome));
            return a.situacao === 'no-ar' ? -1 : 1;
        }),
        // 🚨 A frase de AVISO só nasce quando há o que avisar. Fila com gente no
        // ar não ganha alarme — alarme em estado normal é o que ensina a equipe
        // a ignorar os alarmes que importam.
        aviso: comSituacao.length === 0
            ? 'Ninguém está vinculado a esta fila — a conversa vai ficar sem dono até alguém assumir.'
            : (noAr.length === 0
                ? 'Ninguém desta fila está com o inbox aberto agora. A transferência funciona, mas pode demorar a ser vista.'
                : null),
    };
}
