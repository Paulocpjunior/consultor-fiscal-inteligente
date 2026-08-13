// ============================================================================
// reinf-recibo-entrega.js  (PURO — sem Express, sem Firebase, sem rede)
// ----------------------------------------------------------------------------
// O EXTRATO DE ENTREGAS DA EFD-REINF — o que fecha a competência.
//
// Paulo, 13/08, depois de fechar o R-2099 da VINCENZO: *"com relação ao recibo,
// vc pode mandar por email somente o que foi enviado e seu status, salvar pode
// salvar no sharepoint"*. Dispara no FECHAMENTO do R-2099 (é quando o mês fecha
// de verdade), sai da caixa de quem transmitiu com o gestor em cópia — mesmo
// rito das guias (#293).
//
// ═══ POR QUE UM EXTRATO, E NÃO UM E-MAIL POR EVENTO ═════════════════════════
//
// Uma transmissão por cliente por competência já dá dezenas de e-mails no mês.
// O que chega toda hora a pessoa para de abrir — é a lição do robô de auditoria
// que falhava todo dia pelo mesmo motivo e virou ruído. O gestor precisa do
// FECHAMENTO: o mês inteiro numa tela, com o que entrou e o que ficou de fora.
//
// ═══ A TRAVA QUE MANDA: TRANSMITIDO ≠ ENTREGUE ══════════════════════════════
//
// É a mesma régua do `canalComprovaEnvio` das guias, e a mesma do R-2099: o
// protocolo do lote prova que a Receita RECEBEU o arquivo; o RECIBO prova que
// ela PROCESSOU o evento. Entre um e outro cabe uma recusa.
//
// Então evento sem recibo NUNCA aparece como entregue. Ele aparece — nomeado —
// na lista do que falta, porque some é o que faz alguém achar que o mês fechou.
//
// ═══ O QUE NÃO VAI NO E-MAIL ════════════════════════════════════════════════
//
// O CONTEÚDO do evento. É declaração do cliente, e a mesma regra já vale para a
// auditoria do gateway (`reinf_gateway_lotes` guarda ids/protocolo, nunca o
// XML). Aqui viajam identificação, recibo e situação — o que responde "entregou
// ou não", que é a pergunta do gestor.
// ============================================================================

const texto = (v) => String(v ?? '').trim();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtBRL = (v) => `R$ ${r2(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * DE-PARA elemento do XML → código do evento.
 *
 * O gateway guarda o ELEMENTO (`evtAqProd`), porque é ele que o assinador acha
 * pelo id; a pessoa, o e-CAC e o extrato falam em CÓDIGO (`R-2055`). Sem este
 * de-para o extrato do fechamento sairia dizendo "evtAqProd entregue" para
 * quem passou o mês inteiro procurando o R-2055 — e nomear errado, num papel
 * que serve de prova, é pior que não nomear.
 *
 * Os pares vêm dos eventos REAIS que este projeto já transmitiu ou leu:
 * evtAqProd (R-2055 aceito em produção restrita, VINCENZO 07/2026), evtServTom
 * (R-2010 aceito, 06/2026), evtRetPJ (R-4020 homologado no app irmão),
 * evtRetPF (R-4010), evtInfoContri (R-1000) e evtFech* (R-2099).
 *
 * Elemento desconhecido NÃO vira palpite: sai `null` e o extrato mostra o
 * elemento cru. Inventar um código faz alguém dar por entregue um evento que
 * não é o que ele pensa.
 */
export const CODIGO_DO_EVENTO = {
    evtInfoContri: 'R-1000',
    evtTabProcesso: 'R-1070',
    evtServTom: 'R-2010',
    evtServPr: 'R-2020',
    evtAssDespRec: 'R-2030',
    evtAssDespRep: 'R-2040',
    evtComProd: 'R-2050',
    evtAqProd: 'R-2055',
    evtFech: 'R-2099',
    evtFechaEvPer: 'R-2099',
    evtRetPF: 'R-4010',
    evtRetPJ: 'R-4020',
    evtBenefFin: 'R-4040',
    evtRetRec: 'R-4080',
    evtFechaEvPerRet: 'R-4099',
};

/** Código do evento a partir do elemento — ou o elemento cru, nunca um chute. */
export function codigoDoEvento(elemento) {
    const e = texto(elemento);
    if (!e) return null;
    return CODIGO_DO_EVENTO[e] || null;
}

/** Competência 'AAAA-MM' → 'MM/AAAA' (é como o e-CAC mostra). */
export function competenciaHumana(comp) {
    const m = /^(\d{4})-(\d{2})$/.exec(texto(comp));
    return m ? `${m[2]}/${m[1]}` : texto(comp) || '—';
}

/**
 * A situação de UMA entrega. Três, e só três.
 *
 * `recusado` vence `entregue`: evento que voltou com ocorrência não entrou,
 * mesmo que o lote tenha protocolo.
 */
export function situacaoDaEntrega(e) {
    const ocorrencias = Array.isArray(e?.ocorrencias) ? e.ocorrencias.filter(Boolean) : [];
    if (ocorrencias.length) {
        return {
            situacao: 'recusado',
            detalhe: ocorrencias.map((o) => texto(o.codigo ? `${o.codigo} — ${o.descricao || ''}` : o.descricao || o))
                .filter(Boolean).join(' · ') || 'A Receita devolveu ocorrência sem descrição legível.',
        };
    }
    if (texto(e?.recibo)) {
        return { situacao: 'entregue', detalhe: `Recibo ${texto(e.recibo)}` };
    }
    // Protocolo é o lote RECEBIDO; recibo é o evento PROCESSADO. Entre um e
    // outro cabe uma recusa — por isso protocolo sozinho não fecha nada.
    return {
        situacao: 'sem-recibo',
        detalhe: texto(e?.protocolo)
            ? `Lote ${texto(e.protocolo)} foi recebido, mas o recibo do evento não foi colhido. `
              + 'Recebido não é processado: consulte o lote antes de dar a competência por fechada.'
            : 'Sem protocolo e sem recibo — não há prova de que este evento chegou à Receita.',
    };
}

/**
 * Monta o extrato da competência: o que foi enviado e o status de cada um.
 *
 * @param {object} p
 * @param {string} p.competencia
 * @param {object} p.empresa        { nome, cnpj }
 * @param {Array}  p.entregas       [{ evento, tipo, recibo, protocolo, ocorrencias, transmitidoEm }]
 * @param {object} [p.conferencia]  saída de `conferirTotalizadorR2099`
 * @param {object} [p.fechamento]   { recibo, processadoEm } do R-2099
 */
export function montarExtratoEntregas({ competencia, empresa = {}, entregas = [], conferencia = null, fechamento = null } = {}) {
    const linhas = (Array.isArray(entregas) ? entregas : []).map((e) => {
        const s = situacaoDaEntrega(e);
        return {
            evento: texto(e?.evento) || '—',
            tipo: texto(e?.tipo) || null,
            recibo: texto(e?.recibo) || null,
            protocolo: texto(e?.protocolo) || null,
            transmitidoEm: texto(e?.transmitidoEm) || null,
            ...s,
        };
    });

    const entregues = linhas.filter((l) => l.situacao === 'entregue');
    const recusados = linhas.filter((l) => l.situacao === 'recusado');
    const semRecibo = linhas.filter((l) => l.situacao === 'sem-recibo');

    // O FAROL da competência. Fechado exige as três coisas: nada recusado,
    // nada sem recibo, e o totalizador batendo. Faltando qualquer uma, não é
    // verde — porque quem lê "fechado" para de olhar.
    let farol;
    if (!linhas.length) {
        farol = {
            cor: 'atencao',
            resumo: 'Nenhum evento da EFD-Reinf nesta competência. Se o cliente tem retenção ou compra de '
                + 'produtor rural, isso é falha de apuração ou de captura — não é ausência de obrigação.',
        };
    } else if (recusados.length) {
        farol = {
            cor: 'falha',
            resumo: `${recusados.length} evento(s) RECUSADO(S) pela Receita. A competência não está entregue.`,
        };
    } else if (semRecibo.length) {
        farol = {
            cor: 'falha',
            resumo: `${semRecibo.length} evento(s) sem recibo. Transmitido não é entregue: o protocolo prova que `
                + 'a Receita recebeu o lote, o recibo prova que ela processou o evento.',
        };
    } else if (conferencia && conferencia.situacao === 'divergente') {
        farol = {
            cor: 'falha',
            resumo: 'Todos os eventos foram entregues, mas o totalizador do R-2099 NÃO bate com a apuração — '
                + 'e é contra o totalizador que a guia é paga.',
        };
    } else if (conferencia && conferencia.situacao === 'nao-conferido') {
        farol = {
            cor: 'atencao',
            resumo: `${entregues.length} evento(s) entregue(s), mas sem o totalizador do R-2099 não dá para `
                + 'afirmar que a Receita entendeu os mesmos valores.',
        };
    } else {
        farol = {
            cor: 'ok',
            resumo: `${entregues.length} evento(s) entregue(s) e conferido(s) contra o totalizador do R-2099.`,
        };
    }

    return {
        competencia: texto(competencia) || null,
        competenciaHumana: competenciaHumana(competencia),
        empresa: { nome: texto(empresa?.nome) || null, cnpj: texto(empresa?.cnpj).replace(/\D/g, '') || null },
        fechamento: fechamento ? {
            recibo: texto(fechamento.recibo) || null,
            processadoEm: texto(fechamento.processadoEm) || null,
        } : null,
        linhas,
        resumo: {
            total: linhas.length,
            entregues: entregues.length,
            recusados: recusados.length,
            semRecibo: semRecibo.length,
        },
        conferencia: conferencia || null,
        farol,
    };
}

/**
 * Assunto e corpo do e-mail do fechamento.
 *
 * O ASSUNTO carrega o farol: quem recebe 30 destes por mês precisa saber, pela
 * lista, qual abrir primeiro. Assunto igual para tudo é a mesma doença do
 * e-mail por evento.
 */
export function montarEmailFechamento(extrato) {
    const emoji = { ok: '✅', atencao: '🟡', falha: '🔴' }[extrato?.farol?.cor] || '🟡';
    const nome = extrato?.empresa?.nome || extrato?.empresa?.cnpj || '—';
    const assunto = `${emoji} EFD-Reinf ${extrato?.competenciaHumana} — ${nome}`;

    const partes = [extrato?.farol?.resumo || ''];

    if (extrato?.fechamento?.recibo) {
        partes.push(`Fechamento (R-2099): recibo ${extrato.fechamento.recibo}`
            + (extrato.fechamento.processadoEm ? ` · processado em ${extrato.fechamento.processadoEm}` : '') + '.');
    }

    const linhasTexto = (extrato?.linhas || []).map((l) => {
        const marca = { entregue: '✓', recusado: '✗', 'sem-recibo': '!' }[l.situacao] || '·';
        return `${marca} ${l.evento}${l.tipo ? ` (${l.tipo})` : ''} — ${l.detalhe}`;
    });
    if (linhasTexto.length) partes.push(linhasTexto.join('\n'));

    // A conferência do totalizador vai por INTEIRO quando não bate: é ela que
    // diz quanto e onde, e mandar só "divergente" obrigaria a abrir o sistema.
    if (extrato?.conferencia?.resumo) partes.push(extrato.conferencia.resumo);

    // O que NÃO vai: o conteúdo dos eventos. É declaração do cliente — a mesma
    // regra da auditoria do gateway.
    partes.push('Este extrato traz identificação, recibo e situação. O conteúdo dos eventos não é enviado '
        + 'por e-mail: ele é declaração do cliente e fica no sistema.');

    return { assunto, corpo: partes.filter(Boolean).join('\n\n') };
}

/**
 * Nome do arquivo do extrato no SharePoint. Um por empresa × competência —
 * refechar a competência SOBRESCREVE, e é isso que se quer: o extrato é o
 * estado atual, não um histórico de tentativas (o histórico fica na auditoria).
 */
export function nomeArquivoExtrato(extrato) {
    const cnpj = texto(extrato?.empresa?.cnpj).replace(/\D/g, '') || 'sem-cnpj';
    const comp = texto(extrato?.competencia).replace(/\D/g, '') || 'sem-competencia';
    return `reinf-entregas-${cnpj}-${comp}.pdf`;
}

/** Só para o resumo do painel — o total conferido, quando houve conferência. */
export function totalConferido(conferencia) {
    if (!conferencia || conferencia.situacao !== 'confere') return null;
    return fmtBRL((conferencia.linhas || []).reduce((s, l) => s + (Number(l.apurado) || 0), 0));
}
