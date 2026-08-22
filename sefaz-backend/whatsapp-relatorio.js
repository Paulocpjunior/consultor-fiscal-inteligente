// ============================================================================
// sefaz-backend/whatsapp-relatorio.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// 📈 Relatório de atendimento do SP Connect (item 3 da lista de 21/08 —
// "Relatórios de atendimento (volume, tempo de resposta, por fila)" era o
// último 🔴 do de-para). Regras que mandam:
//
// - A CONTA é daqui (pura); a rota só busca as mensagens do período e os
//   docs de conversa — relatório com conta própria na tela diverge sozinho
//   (lição do card 4).
// - "1ª resposta" é a HUMANA (enviadoPor preenchido): a resposta do BOT não
//   é atendimento — contar o menu automático como resposta esconderia
//   exatamente o que o relatório existe pra mostrar (cliente esperando).
// - Conversa SEM resposta humana no período não é excluída nem zera média:
//   sai CONTADA (`semRespostaHumana`) — é o número mais importante do
//   relatório, e média que engole os sem-resposta mente pra baixo.
// - Mensagem de nota interna fica FORA de tudo: é conversa da equipe.
// ============================================================================

/** Minutos entre dois ISO; null se algum lado faltar/ilegível. */
function minutosEntre(aIso, bIso) {
    const a = Date.parse(aIso || '');
    const b = Date.parse(bIso || '');
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
    return (b - a) / 60000;
}

/**
 * Monta o relatório do período a partir das MENSAGENS (já filtradas pelo
 * período na leitura) e do mapa conversaId → { fila }.
 *
 * @param {object} p
 * @param {Array}  p.mensagens  docs de whatsapp_mensagens do período (ordem qualquer)
 * @param {Map|object} p.filaPorConversa  conversaId → fila (null = recepcao)
 * @returns resumo com totais, porFila e porAtendente
 */
export function montarRelatorioAtendimento({ mensagens = [], filaPorConversa = new Map() } = {}) {
    const filaDe = (numero) => {
        const f = filaPorConversa instanceof Map ? filaPorConversa.get(numero) : filaPorConversa?.[numero];
        return f || 'recepcao';
    };

    // Agrupa por conversa, em ordem de tempo — a 1ª resposta se mede por PAR
    // (primeira entrada ainda sem resposta → primeira saída humana depois dela).
    const porConversa = new Map();
    for (const m of mensagens) {
        if (!m || m.direcao === 'interna' || !m.conversaId) continue;
        if (!porConversa.has(m.conversaId)) porConversa.set(m.conversaId, []);
        porConversa.get(m.conversaId).push(m);
    }
    for (const lista of porConversa.values()) {
        lista.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    }

    const filas = new Map();
    const atendentes = new Map();
    const bucketFila = (id) => {
        if (!filas.has(id)) {
            filas.set(id, {
                fila: id, conversas: 0, recebidas: 0, enviadasHumanas: 0, enviadasBot: 0,
                respondidas: 0, semRespostaHumana: 0, somaMinutos1aResposta: 0,
            });
        }
        return filas.get(id);
    };

    let recebidasTotal = 0;
    let enviadasHumanasTotal = 0;
    let enviadasBotTotal = 0;

    for (const [numero, lista] of porConversa.entries()) {
        const fila = filaDe(numero);
        const b = bucketFila(fila);
        b.conversas += 1;

        let esperandoDesde = null;   // timestamp da 1ª entrada ainda sem resposta humana
        let primeiraRespostaMin = null;

        for (const m of lista) {
            if (m.direcao === 'entrada') {
                b.recebidas += 1;
                recebidasTotal += 1;
                if (esperandoDesde === null) esperandoDesde = m.timestamp || null;
            } else if (m.direcao === 'saida') {
                // ⚠️ O executor do bot grava enviadoPor: 'bot' — truthy! Só
                // e-mail de gente conta como humano, senão o menu automático
                // viraria "1ª resposta" e o relatório mentiria pra melhor.
                const humano = Boolean(m.enviadoPor) && m.enviadoPor !== 'bot';
                if (humano) {
                    b.enviadasHumanas += 1;
                    enviadasHumanasTotal += 1;
                    const a = atendentes.get(m.enviadoPor) || { atendente: m.enviadoPor, enviadas: 0, conversas: new Set() };
                    a.enviadas += 1;
                    a.conversas.add(numero);
                    atendentes.set(m.enviadoPor, a);
                    if (esperandoDesde !== null && primeiraRespostaMin === null) {
                        primeiraRespostaMin = minutosEntre(esperandoDesde, m.timestamp);
                    }
                    esperandoDesde = null; // respondida — a próxima entrada reabre a espera
                } else {
                    b.enviadasBot += 1;
                    enviadasBotTotal += 1;
                    // Bot NÃO fecha a espera: menu automático não é atendimento.
                }
            }
        }

        const teveEntrada = lista.some((m) => m.direcao === 'entrada');
        if (teveEntrada) {
            if (primeiraRespostaMin !== null) {
                b.respondidas += 1;
                b.somaMinutos1aResposta += primeiraRespostaMin;
            } else {
                b.semRespostaHumana += 1;
            }
        }
    }

    const porFila = [...filas.values()]
        .map((b) => ({
            fila: b.fila,
            conversas: b.conversas,
            recebidas: b.recebidas,
            enviadasHumanas: b.enviadasHumanas,
            enviadasBot: b.enviadasBot,
            respondidas: b.respondidas,
            semRespostaHumana: b.semRespostaHumana,
            // Média SÓ das respondidas — as sem-resposta saem NOMEADAS ao lado,
            // nunca dissolvidas numa média que parece boa.
            tempoMedio1aRespostaMin: b.respondidas
                ? Math.round((b.somaMinutos1aResposta / b.respondidas) * 10) / 10 : null,
        }))
        .sort((a, b) => b.conversas - a.conversas);

    const porAtendente = [...atendentes.values()]
        .map((a) => ({ atendente: a.atendente, enviadas: a.enviadas, conversas: a.conversas.size }))
        .sort((a, b) => b.enviadas - a.enviadas);

    return {
        conversasComMovimento: porConversa.size,
        recebidas: recebidasTotal,
        enviadasHumanas: enviadasHumanasTotal,
        enviadasBot: enviadasBotTotal,
        semRespostaHumana: porFila.reduce((s, f) => s + f.semRespostaHumana, 0),
        porFila,
        porAtendente,
    };
}
