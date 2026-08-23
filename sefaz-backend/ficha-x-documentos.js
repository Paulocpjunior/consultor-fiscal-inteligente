// ============================================================================
// sefaz-backend/ficha-x-documentos.js  (ESM, puro)
// ----------------------------------------------------------------------------
// O FAROL FICHA × DOCUMENTOS — imposto digitado precisa de documento por trás.
//
// O caso que o criou (Paulo, 15/08, EXPERTE 06/2026): IPI de R$ 7.352,90
// digitado na ficha, imposto calculado, relatório gerado — e ZERO documento no
// banco. *"a empresa teve IPI, geramos o imposto e relatório: como não houve
// captura de XML?"* Ninguém tinha reparado porque NADA acendia: a ficha e a
// escrituração são trilhos independentes, e o descasamento era invisível.
//
// É o retrato da colcha que o CFI existe para substituir — número digitado sem
// lastro. Este farol cruza os dois trilhos e acende ONDE a pessoa está olhando.
//
// ═══ POR QUE ELE NÃO MORA MAIS SÓ NA VARREDURA DE IPI ═══════════════════════
//
// A doença nunca foi do IPI: é de QUALQUER número apurado numa ficha digitada.
// A prova saiu da própria Rotina do Mês, que é o guia do colaborador: a etapa
// de APURAÇÃO fechava VERDE só por existir ficha — mesmo com a etapa de
// CAPTURA vermelha na linha de cima, dizendo "nenhuma nota capturada". Duas
// leituras do mesmo mês discordando na MESMA tela, que é a armadilha que mais
// mordeu este projeto. Por isso a régua é UMA e os dois pontos a chamam.
//
// ═══ O QUE ELE AFIRMA — e, tão importante, o que NÃO afirma ═════════════════
//
// Ele confere EXISTÊNCIA, não valor: "há documentos na competência que
// sustentam haver movimento" ≠ "os documentos somam exatamente o que a ficha
// diz". A conferência de VALOR é do E510/🪞 (por CFOP+CST, contra arquivo).
// Prometer aqui o que só o E510 prova seria a tela de conferência que mente —
// e o veredito diz isso na frase, para ninguém ler "verde" como "conferido".
//
// ⚠️ E ELE SÓ FALA QUANDO HÁ VALOR. Ficha zerada com banco vazio é "sem
// movimento", que é outro assunto, com outra ação (declaração ao Fisco, e há
// trilho próprio para isso). Acender "sem lastro" ali seria alarme onde não há
// nada a fazer — e alarme sem ação é o que ensina a equipe a ignorar o farol.
// ============================================================================

/**
 * @param {object} p
 * @param {number} p.valorApurado    valor apurado na ficha digitada (0 = nada a cruzar)
 * @param {number|null} p.documentos quantos docs a competência tem no banco
 *                                   (null = a contagem FALHOU — não é zero!)
 * @param {string} [p.rotulo]        como o número se chama na tela ('IPI', 'A apuração'…)
 * @param {boolean} [p.capturaPorAgenteLocal] a empresa tem certificado **A3**
 *   (`tipoCert === 'A3'` em `empresas_certificados`) — ver o bloco abaixo.
 * @returns {{ situacao: 'sem-valor'|'sem-documento'|'sem-documento-agente-local'
 *                      |'com-lastro'|'contagem-indisponivel',
 *             cor: 'ok'|'atencao'|'falha'|'neutro', mensagem: string, acao: string|null }}
 */
export function conferirFichaContraDocumentos({
    valorApurado, documentos, rotulo = 'IPI', capturaPorAgenteLocal = false,
}) {
    const valor = Number(valorApurado) || 0;

    if (valor <= 0) {
        return {
            situacao: 'sem-valor', cor: 'neutro',
            mensagem: `Sem ${rotulo} na ficha desta competência.`,
            acao: null,
        };
    }

    // FALHA DE CONTAGEM NÃO É ZERO. Tratar null como 0 acenderia "sem
    // documento" para empresa com o banco cheio — alarme falso justamente no
    // momento em que está tudo certo, que é o que ensina a ignorar o farol.
    if (documentos === null || documentos === undefined) {
        return {
            situacao: 'contagem-indisponivel', cor: 'neutro',
            mensagem: 'Não foi possível contar os documentos da competência — o farol fica apagado, não verde.',
            acao: 'Recarregue; se persistir, avise o administrador.',
        };
    }

    if (Number(documentos) === 0) {
        // ═══════════════════════════════════════════════════════════════════
        // 🚨 A MESMA AUSÊNCIA, COM OUTRA CAUSA — e outra primeira parada
        //
        // Paulo, 23/08, com o painel de captura: **202 das 404 empresas usam
        // certificado A3**, que NÃO roda no cron em nuvem — quem as captura é
        // o agente local `cfi-a3`. Para elas, "zero documento na nuvem" não
        // aponta captura quebrada: aponta o agente que não rodou (ou não
        // entregou) naquela competência.
        //
        // Mandar essa gente "destravar a captura" é mandar procurar defeito
        // onde não há — em metade da carteira. Causa junto do número, sempre.
        //
        // ⚠️ **A SEVERIDADE NÃO CAI.** O número continua sem lastro: o agente
        // A3 escreve na MESMA coleção, então documento nenhum ali é lacuna de
        // verdade, não desenho. Baixar para âmbar aqui seria trocar um alarme
        // com ação errada por um silêncio falso — e a Rotina do Mês voltaria a
        // dar a competência por fechada.
        // ═══════════════════════════════════════════════════════════════════
        if (capturaPorAgenteLocal) {
            return {
                situacao: 'sem-documento-agente-local', cor: 'falha',
                mensagem: `${rotulo} na ficha SEM NENHUM documento por trás nesta competência — e esta empresa `
                    + 'captura por certificado **A3**, pelo agente local `cfi-a3` (o cron em nuvem não a alcança).',
                acao: 'Confira se o agente cfi-a3 rodou nesta competência (📊 Status por Empresa). '
                    + 'Se rodou e mesmo assim não há documento, importe os XMLs ou lance as notas '
                    + 'na aba Importar → ✍️ Lançar nota sem XML.',
            };
        }
        return {
            situacao: 'sem-documento', cor: 'falha',
            mensagem: `${rotulo} na ficha SEM NENHUM documento por trás nesta competência — apuração sem lastro.`,
            // AS TRÊS PORTAS DE ABASTECER, na ordem em que se tenta. Dizer só
            // "não há documentos" mandaria a pessoa procurar sozinha por onde
            // começar — e o caminho depende de qual das três falhou.
            acao: 'Abasteça o banco: destrave a captura (📊 Status por Empresa diz o bloqueio), importe os XMLs, '
                + 'ou lance as notas na aba Importar → ✍️ Lançar nota sem XML.',
        };
    }

    return {
        situacao: 'com-lastro', cor: 'ok',
        // "Verde" aqui é EXISTÊNCIA. Dizer menos que isso deixaria alguém ler
        // este farol como "conferido" — promessa que é do E510.
        mensagem: `${documentos} documento(s) na competência — há lastro. O VALOR se confere no E510 (🪞 CFI × E-Fiscal), não aqui.`,
        acao: null,
    };
}
