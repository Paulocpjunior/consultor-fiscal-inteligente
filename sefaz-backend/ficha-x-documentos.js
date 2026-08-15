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
// ═══ O QUE ELE AFIRMA — e, tão importante, o que NÃO afirma ═════════════════
//
// Ele confere EXISTÊNCIA, não valor: "há documentos na competência que
// sustentam haver movimento" ≠ "os documentos somam exatamente o IPI da
// ficha". A conferência de VALOR é do E510/🪞 (por CFOP+CST, contra arquivo).
// Prometer aqui o que só o E510 prova seria a tela de conferência que mente —
// e o veredito diz isso na frase, para ninguém ler "verde" como "conferido".
// ============================================================================

/**
 * @param {object} p
 * @param {number} p.ipiFicha        IPI apurado na ficha digitada
 * @param {number|null} p.documentos quantos docs a competência tem no banco
 *                                   (null = a contagem FALHOU — não é zero!)
 * @returns {{ situacao: 'sem-ipi'|'sem-documento'|'com-lastro'|'contagem-indisponivel',
 *             cor: 'ok'|'atencao'|'falha'|'neutro', mensagem: string, acao: string|null }}
 */
export function conferirFichaContraDocumentos({ ipiFicha, documentos }) {
    const ipi = Number(ipiFicha) || 0;

    if (ipi <= 0) {
        return {
            situacao: 'sem-ipi', cor: 'neutro',
            mensagem: 'Sem IPI na ficha desta competência.',
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
        return {
            situacao: 'sem-documento', cor: 'falha',
            mensagem: 'IPI digitado na ficha SEM NENHUM documento por trás nesta competência — apuração sem lastro.',
            acao: 'Abasteça o banco: destrave a captura (📊 Status por Empresa diz o bloqueio), importe os XMLs, '
                + 'ou lance as notas na aba Importar → ✍️ Lançar nota sem XML.',
        };
    }

    return {
        situacao: 'com-lastro', cor: 'ok',
        // "Verde" aqui é EXISTÊNCIA. Dizer menos que isso deixaria alguém ler
        // este farol como "IPI conferido" — promessa que é do E510.
        mensagem: `${documentos} documento(s) na competência — há lastro. O VALOR se confere no E510 (🪞 CFI × E-Fiscal), não aqui.`,
        acao: null,
    };
}
