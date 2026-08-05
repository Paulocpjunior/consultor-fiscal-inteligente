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

/** Etapa cumprida? `arquivado`/`baixada` são os únicos desfechos completos. */
function spOk(e) { return e?.sharePoint?.status === 'arquivado'; }
function baixaOk(e) { return e?.baixa?.status === 'baixada'; }

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
 */
export function canalComprovaEnvio(canal) {
    return String(canal || '').trim().toLowerCase() === 'email-graph';
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

        const problemas = [pendenciaSharePoint(e), pendenciaBaixa(e)].filter(Boolean);
        if (problemas.length === 0) painel.completos++;
        else painel.incompletos++;

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
    painel.farol = painel.total === 0 ? 'vazio' : (painel.incompletos > 0 ? 'atencao' : 'ok');
    painel.resumo = painel.total === 0
        ? 'Nenhum imposto enviado nesta competência ainda.'
        : painel.incompletos === 0
            ? `${painel.total} envio(s), todos completos (arquivados e com baixa).`
            : `${painel.completos} de ${painel.total} envio(s) completos — ${painel.incompletos} ficaram pela metade.`;
    return painel;
}
