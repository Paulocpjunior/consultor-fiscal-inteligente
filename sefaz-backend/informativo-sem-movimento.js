// ============================================================================
// sefaz-backend/informativo-sem-movimento.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 📭 INFORMATIVO AO CLIENTE: "neste mês não houve movimentação" (03/10).
//
// Paulo, 03/10: *"incluir também, em modo informativo ao cliente, usando o
// mesmo template, que naquele determinado mês não houve movimentação — após o
// colaborador efetivar o fim do mês"*.
//
// A régua:
//  · só sai quando a etapa 1 fechou pela DECLARAÇÃO de sem movimento (autor,
//    data, texto — `sem-movimento-declarado.js`); o app não deduz "sem
//    movimento" de zero nota (ausência ≠ zero);
//  · só depois do FIM DE MÊS gravado — é o ato que dá o mês por fechado;
//  · UMA vez por competência: refechar depois de uma reabertura não manda de
//    novo (o cliente já foi informado), e o carimbo diz quando e para quem;
//  · o texto afirma o FATO (nenhuma nota emitida ou recebida chegou), não
//    "não há imposto": obrigação acessória e tributo fixo existem sem nota.
// ============================================================================

import { montarLayoutEmail, escaparHtml } from './email-layout.js';

/** O mês fechou pela declaração de sem movimento e o cliente ainda não foi informado? */
export function deveEnviarInformativo({ rotina, anterior } = {}) {
    const captura = (rotina?.etapas || []).find((e) => e?.id === 'captura');
    if (!captura || captura.semMovimentoDeclarado !== true) return false;
    if (anterior?.informativoSemMovimento?.enviadoEm) return false;
    return true;
}

const compBr = (c) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(c || ''));
    return m ? `${m[2]}/${m[1]}` : String(c || '');
};

/**
 * Assunto e corpo — o MESMO layout dos e-mails de guia (`montarLayoutEmail`).
 * @returns {{assunto: string, corpoHtml: string}}
 */
export function montarInformativoSemMovimento({ empresaNome, competencia, geradoEm } = {}) {
    const comp = compBr(competencia);
    const nome = String(empresaNome || '').trim();
    const linhas = [
        'Olá, tudo bem?',
        `Informamos que, na competência <strong>${escaparHtml(comp)}</strong>, não houve movimentação fiscal `
            + `registrada para ${nome ? `a <strong>${escaparHtml(nome)}</strong>` : 'a sua empresa'}: `
            + 'nenhuma nota fiscal emitida ou recebida chegou até nós.',
        'O fechamento fiscal do mês foi concluído com essa informação.',
        'Se a empresa teve alguma operação no período que não chegou até o escritório, responda este e-mail '
            + 'para que possamos regularizar.',
        'Atenciosamente,<br/>SP Assessoria Contábil',
    ];
    const conteudoHtml = linhas.map((l) => `<p style="margin:0 0 12px 0;">${l}</p>`).join('');
    return {
        assunto: `Sem movimento ${comp}${nome ? ` — ${nome}` : ''}`,
        corpoHtml: montarLayoutEmail({
            titulo: `SEM MOVIMENTO — ${escaparHtml(nome)}`,
            selo: `Competência ${comp}`,
            conteudoHtml,
            assinatura: `Enviado pelo Consultor Fiscal Inteligente em ${escaparHtml(
                geradoEm || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
            )}.`,
            motivoRodape: 'Você recebeu este informativo porque sua empresa é atendida pelo nosso escritório. '
                + 'Em caso de dúvida, responda este e-mail.',
        }),
    };
}
