// ============================================================================
// sefaz-backend/envio-imposto-painel.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Farol da ORDEM TÉCNICA do envio de imposto (#293). A auditoria em
// `impostos_enviados` já grava o resultado de cada etapa, mas ninguém via o
// agregado: quantos envios saíram COMPLETOS (cópia no SharePoint + baixa da
// obrigação + gestor em cópia) e quantos ficaram pela metade — e por quê.
//
// Regra do farol honesto: envio pela metade NÃO é sucesso. Cada pendência sai
// com o MOTIVO e a AÇÃO, e agrupada por causa, que é como a equipe resolve
// (ex.: "12 empresas sem pasta do SharePoint" é UMA tarefa, não 12 mistérios).
// ============================================================================

/**
 * 🚨 ENVIO SEM REGISTRO DA ETAPA NÃO É ENVIO COMPLETO — é envio NÃO CONFERIDO.
 *
 * `pendenciaSharePoint`/`pendenciaBaixa` devolvem null quando não há status
 * gravado, e o painel lia esse null como "etapa cumprida": o envio entrava em
 * `completos` e o resumo afirmava *"todos completos (arquivados e com baixa)"*
 * — uma afirmação que a rodada NUNCA estabeleceu.
 *
 * É a mesma família da conferência CFI × SPED que pulava o confronto de valor
 * em silêncio (22/08): **ausência de alarme não pode ser indistinguível de
 * "está tudo certo"**. Auditoria antiga, gravada antes do rito #293 existir,
 * cai exatamente aqui.
 *
 * ⚠️ `sem-pdf` continua sendo desfecho LEGÍTIMO, não lacuna: há envio sem
 * anexo (aviso de guia já paga), e não há o que arquivar.
 */
const semRegistroSharePoint = (e) => !e?.sharePoint?.status;
const semRegistroBaixa = (e) => !e?.baixa?.status;

/**
 * Motivo legível + ação pra cada pendência de SharePoint.
 * `sem-pdf` não é falha: envio sem anexo (ex.: aviso de guia já paga).
 */
export function pendenciaSharePoint(e) {
    const st = e?.sharePoint?.status;
    if (!st || st === 'arquivado') return null;
    if (st === 'sem-pdf') return null;
    if (st === 'sem-config') {
        return {
            causa: 'Empresa sem pasta do SharePoint',
            acao: 'Preencha grupo + pasta em Central de XMLs → Integrações → SharePoint. Sem isso nenhum imposto é arquivado.',
        };
    }
    return {
        causa: 'Falha ao gravar no SharePoint',
        acao: `Reenvie o arquivo depois de conferir o acesso à pasta. Motivo: ${String(e?.sharePoint?.motivo || 'não informado').slice(0, 160)}`,
    };
}

/** Motivo + ação pra baixa da obrigação. */
export function pendenciaBaixa(e) {
    const st = e?.baixa?.status;
    if (!st || st === 'baixada') return null;
    // 🚨 `ja-baixada` é DESFECHO LEGÍTIMO, não lacuna (27/08): a tarefa existe
    // e já estava concluída em Vencimentos quando o envio foi registrado — é o
    // que acontece com quem entrega a obrigação por fora, dá baixa e SÓ DEPOIS
    // registra o envio. Tratá-la como pendência punia justamente quem seguiu a
    // ordem certa, e travava o fim de mês da empresa.
    if (st === 'ja-baixada') return null;
    if (st === 'sem-tarefa') {
        return {
            causa: 'Sem obrigação correspondente na aba Vencimentos',
            acao: 'A tarefa do mês não existe (cron mensal não gerou ou o tipo não tem obrigação). Gere as tarefas da competência e dê baixa manual desta.',
        };
    }
    return {
        causa: 'Falha ao dar baixa na obrigação',
        acao: `Dê baixa manual na aba Vencimentos e Obrigações. Motivo: ${String(e?.baixa?.motivo || 'não informado').slice(0, 160)}`,
    };
}

/**
 * O canal PROVA que a mensagem saiu?
 *
 * Pergunta da equipe (05/08): *"como posso ter certeza de que a guia foi
 * enviada ao cliente?"*. A resposta honesta depende do canal e o app tratava
 * todos igual:
 *
 * - `email-graph`: o SERVIDOR enviou. O Microsoft Graph aceitou a mensagem
 *   (202) e a cópia fica em "Itens Enviados" da caixa remetente — há prova.
 * - `email-app` (mailto / Outlook Web): o app só ABRIU a janela de composição
 *   no e-mail do colaborador. Quem clica em "Enviar" é a pessoa, fora do app —
 *   e se ela fechar a janela, nada sai. Registrar isso como "enviado" é
 *   afirmar um fato que o app não viu.
 * - `whatsapp`: idem — abre o wa.me, o envio é humano.
 * - `whatsapp-api` (09/08): o SERVIDOR enviou pela Cloud API oficial da Meta
 *   e ela devolveu o id da mensagem (fica na auditoria) — há prova, mesma
 *   classe do email-graph. NÃO confundir com `whatsapp` (wa.me).
 */
export function canalComprovaEnvio(canal) {
    const c = String(canal || '').trim().toLowerCase();
    return c === 'email-graph' || c === 'whatsapp-api';
}

/**
 * 🔒 ESTE ENVIO FECHOU O RITO? — dono único da pergunta (27/08).
 *
 * ═══ POR QUE ELE NASCEU ═════════════════════════════════════════════════════
 *
 * A Rotina do Mês reimplementava a resposta:
 *
 *     e.sharePoint?.status === 'arquivado' && e.baixa?.status === 'baixada'
 *
 * e o PAINEL, aqui, já dizia outra coisa: `sem-pdf` é desfecho **LEGÍTIMO**
 * (envio sem anexo — aviso de guia já paga: não há o que arquivar), e
 * `ja-baixada` também. Ou seja: o painel dava o envio por COMPLETO e a Rotina
 * o deixava em ÂMBAR para sempre, travando o fim de mês de uma empresa cujo
 * rito fechou.
 *
 * ⚠️ `sem-tarefa` NÃO é desfecho legítimo e continua sendo pendência — ali a
 * tarefa não existe, e isso é o cron mensal que não gerou. A distinção entre
 * ele e o `ja-baixada` nasceu com o envio DECLARADO, e foi o teste que a
 * cobrou.
 *
 * Duas leituras do mesmo fato — o defeito que esta casa mais paga —, e a de
 * baixo é a que decide se alguém pode virar a página.
 *
 * @returns {{completo: boolean, naoConferido: boolean, pendencias: object[]}}
 */
export function envioCompletoPeloRito(e) {
    const naoConferido = semRegistroSharePoint(e) || semRegistroBaixa(e);
    const pendencias = [pendenciaSharePoint(e), pendenciaBaixa(e)].filter(Boolean);
    return {
        // ⚠️ SEM REGISTRO NÃO É COMPLETO — é NÃO CONFERIDO, e tem ação própria.
        // Auditoria gravada antes do rito #293 existir cai exatamente aqui.
        completo: !naoConferido && pendencias.length === 0,
        naoConferido,
        pendencias,
    };
}

/**
 * Agrega os envios num painel acionável.
 *
 * @param {Array} envios  docs de impostos_enviados (já normalizados)
 * @param {object} [opts]
 * @param {string} [opts.competencia] filtra 'AAAA-MM' (o painel é mensal)
 */
export function montarPainelEnvios(envios, { competencia = null } = {}) {
    const lista = (envios || []).filter((e) => !competencia || e.competencia === competencia);

    const painel = {
        competencia: competencia || null,
        total: lista.length,
        completos: 0,
        incompletos: 0,
        // Envio sem registro de etapa: não dá para dizer que o rito fechou.
        // Ele NÃO conta como completo nem como pendência — tem ação própria.
        naoConferidos: [],
        porTipo: {},
        // causa → { qtd, acao, empresas: [...] }: a equipe ataca por CAUSA.
        pendencias: {},
        semGestorEmCopia: [],
        // Envios cujo canal NÃO prova a saída (mailto/Outlook Web/WhatsApp):
        // o app abriu a composição, quem enviou foi a pessoa. Não é pendência
        // do rito — é o limite do que o app pode afirmar.
        semProvaDeEnvio: [],
        enviadosPeloServidor: 0,
        valorTotal: 0,
    };

    for (const e of lista) {
        const tipo = String(e.tipo || '—').toUpperCase();
        painel.porTipo[tipo] = (painel.porTipo[tipo] || 0) + 1;
        if (Number.isFinite(Number(e.valor))) painel.valorTotal += Number(e.valor);

        // Quem responde é o DONO — o painel e a Rotina do Mês perguntam a mesma
        // coisa, e até 27/08 respondiam diferente sobre `sem-pdf`/`sem-tarefa`.
        const rito = envioCompletoPeloRito(e);
        const problemas = rito.pendencias;
        const semRegistro = rito.naoConferido;
        if (problemas.length > 0) painel.incompletos++;
        else if (semRegistro) {
            const faltam = [
                semRegistroSharePoint(e) ? 'arquivamento' : null,
                semRegistroBaixa(e) ? 'baixa' : null,
            ].filter(Boolean).join(' e ');
            if (painel.naoConferidos.length < 200) {
                painel.naoConferidos.push(
                    `${e.empresaNome || e.empresaCnpj || '—'} · ${tipo} ${e.competencia || ''}`.trim()
                    + ` (sem registro de ${faltam})`,
                );
            }
        } else painel.completos++;

        for (const p of problemas) {
            const bucket = painel.pendencias[p.causa] || (painel.pendencias[p.causa] = { qtd: 0, acao: p.acao, empresas: [] });
            bucket.qtd++;
            const rotulo = `${e.empresaNome || e.empresaCnpj || '—'} · ${tipo} ${e.competencia || ''}`.trim();
            if (bucket.empresas.length < 50 && !bucket.empresas.includes(rotulo)) bucket.empresas.push(rotulo);
        }

        // Gestor SEMPRE em cópia é regra da ordem técnica — se faltou, o envio
        // saiu fora do padrão e alguém precisa saber.
        const copias = (e.copiaPara || []).map((c) => String(c).toLowerCase());
        if (!copias.some((c) => c.includes('alexandre@'))) {
            painel.semGestorEmCopia.push(`${e.empresaNome || e.empresaCnpj} · ${tipo}`);
        }

        if (canalComprovaEnvio(e.canal)) painel.enviadosPeloServidor++;
        else if (painel.semProvaDeEnvio.length < 200) {
            painel.semProvaDeEnvio.push(
                `${e.empresaNome || e.empresaCnpj} · ${tipo} ${e.competencia || ''}`.trim(),
            );
        }
    }

    painel.valorTotal = Math.round(painel.valorTotal * 100) / 100;
    // Farol: sem envio nenhum é 'vazio' (não é verde — não houve trabalho);
    // qualquer pendência é 'atencao'; tudo completo é 'ok'.
    const naoConferidos = painel.naoConferidos.length;
    painel.farol = painel.total === 0 ? 'vazio'
        : (painel.incompletos > 0 || naoConferidos > 0) ? 'atencao' : 'ok';
    painel.resumo = painel.total === 0
        ? 'Nenhum imposto enviado nesta competência ainda.'
        : painel.incompletos === 0 && naoConferidos === 0
            ? `${painel.total} envio(s), todos completos (arquivados e com baixa).`
            : painel.incompletos === 0
                // Sem pendência, mas com envio que não dá para conferir: o
                // absoluto some da frase — dizer "todos completos" aqui seria
                // afirmar o que a rodada não estabeleceu.
                ? `${painel.completos} de ${painel.total} envio(s) completos — ${naoConferidos} sem registro das etapas do rito.`
                : `${painel.completos} de ${painel.total} envio(s) completos — ${painel.incompletos} ficaram pela metade`
                  + `${naoConferidos ? ` e ${naoConferidos} sem registro das etapas` : ''}.`;
    return painel;
}
