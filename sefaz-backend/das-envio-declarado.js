// ============================================================================
// sefaz-backend/das-envio-declarado.js  (ESM — núcleo PURO + orquestrador
// com I/O injetado)
// ----------------------------------------------------------------------------
// 📤 "JÁ ENVIEI ESTA GUIA POR FORA" — na Central de DAS, um a um ou em lote.
//
// ═══ O CASO (Paulo, 25/09) ══════════════════════════════════════════════════
//
// *"como fica a baixa do status da guia enviado ao cliente, visto que esse
// status interfere diretamente no controle mensal"*. A Central de DAS tem DOIS
// eixos que a coluna Status misturava na leitura: o **Pagamento** (pendente →
// vencido → pago, e "pago" só entra à mão) e o **Envio** (o rito: cópia,
// baixa da obrigação, auditoria). Guia enviada pelo WhatsApp do escritório ou
// por outra caixa ficava "não enviada" para sempre — e a etapa 5 da Rotina
// daquela competência ficava âmbar sobre trabalho já feito.
//
// A decisão do Paulo: *"Declarar por fora, em lote. Mesma régua que fizemos
// para a cópia no SharePoint … Isso preenche a coluna Envio, fecha a etapa 5
// da Rotina daquela competência e tira a guia do 'não enviado'. Não inventa
// pagamento: o eixo Pagamento continua 'não confirmado' até alguém marcar."*
//
// ═══ A RÉGUA É A QUE JÁ EXISTE ══════════════════════════════════════════════
//
// A declaração é a de `envio-fora-do-app.js` (meio da lista fechada, texto com
// piso, data que não está no futuro, autor) — conferida UMA vez para o lote,
// porque é a mesma pessoa declarando o mesmo ato para várias guias. O rito é o
// de `envio-imposto.js` com canal `fora-do-app`: é ELE que grava em
// `impostos_enviados` (o que a etapa 5 lê) e dá baixa na tarefa DAS da
// competência. Este módulo NÃO reimplementa nada disso; ele só decide QUAIS
// guias entram e o que a Central de DAS grava na guia e no histórico.
//
// ═══ O QUE ELE NUNCA FAZ ════════════════════════════════════════════════════
//
// - Nunca toca `statusPagamento`/`dataPagamento`: envio não é pagamento.
// - Nunca SOBREPÕE um envio já registrado: guia com `ultimoEnvioCliente`
//   (e-mail pelo servidor, com prova) é PULADA e dita — uma declaração sem
//   prova jamais apaga uma prova.
// - Nunca afirma entrega: o snapshot diz `canal: 'fora-do-app'`, e é o
//   `canalComprovaEnvio` (false para ele) que o painel do rito respeita.
// ============================================================================

import { conferirDeclaracao, textoDaDeclaracao, CANAL_FORA_DO_APP } from './envio-fora-do-app.js';

export { CANAL_FORA_DO_APP };

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/**
 * Decide quais guias do lote ENTRAM na declaração e quais são puladas — com o
 * motivo de cada pulo, porque "3 de 5 registradas" sem dizer quais e por quê é
 * lista cortada.
 *
 * @param {Array<object|null>} guias docs de `das_emitidos` (null = id não achado)
 * @param {string[]} [idsPedidos] ids na ordem do pedido (para nomear o não achado)
 */
export function planejarDeclaracaoEmLote(guias, idsPedidos = []) {
    const declarar = [];
    const puladas = [];
    const vistos = new Set();
    const lista = Array.isArray(guias) ? guias : [];
    lista.forEach((g, i) => {
        const id = g?.id || idsPedidos[i] || `#${i + 1}`;
        if (vistos.has(id)) return; // id repetido no pedido: conta uma vez
        vistos.add(id);
        if (!g) {
            puladas.push({ id, motivo: 'Guia não encontrada.' });
            return;
        }
        if (!soDigitos(g.empresaCnpj)) {
            puladas.push({ id, empresaNome: g.empresaNome || '', competencia: g.competencia || null,
                motivo: 'Guia sem CNPJ legível — não dá para registrar o envio.' });
            return;
        }
        const envio = g.ultimoEnvioCliente;
        if (envio && typeof envio === 'object') {
            const quando = String(envio.quando || envio.enviadoEm || '').slice(0, 10);
            const canal = String(envio.canal || '');
            puladas.push({
                id, empresaNome: g.empresaNome || '', competencia: g.competencia || null,
                motivo: `Já tem envio registrado (${canal === CANAL_FORA_DO_APP ? 'declarado' : canal || 'canal não informado'}`
                    + `${quando ? ` em ${quando}` : ''}) — a declaração nunca sobrepõe um envio.`,
            });
            return;
        }
        declarar.push(g);
    });
    return { declarar, puladas };
}

/**
 * O que a guia passa a carregar em `ultimoEnvioCliente`. Mesmo formato do
 * envio por e-mail (a coluna Envio lê os dois), com o canal DIZENDO que foi
 * declarado e sem destinatário — o app não mandou para ninguém.
 */
export function snapshotEnvioDeclarado(declaracao, { enviadoPor, agoraIso } = {}) {
    return {
        canal: CANAL_FORA_DO_APP,
        para: '',
        copiaPara: [],
        anexouPdf: false,
        enviadoPor: enviadoPor || declaracao?.declaradoPor || null,
        enviadoEm: agoraIso || new Date().toISOString(),
        meio: declaracao?.meio || null,
        meioLabel: declaracao?.meioLabel || null,
        quando: declaracao?.quando || null,
        comoFoi: declaracao?.comoFoi || null,
        declaradoPor: declaracao?.declaradoPor || null,
    };
}

/** O registro do histórico (`das_envios_cliente`), sem o carimbo do servidor. */
export function logEnvioDeclarado(guia, declaracao, { enviadoPor } = {}) {
    return {
        dasId: guia.id || null,
        empresaCnpj: soDigitos(guia.empresaCnpj),
        empresaNome: guia.empresaNome || '',
        competencia: guia.competencia || null,
        valor: Number(guia.valor || 0),
        vencimento: guia.vencimento || null,
        canal: CANAL_FORA_DO_APP,
        para: '',
        copiaPara: [],
        assunto: `DAS ${guia.competencia || ''} — envio declarado por fora do app`.trim(),
        // A frase que diz que o app NÃO enviou — quem abrir o histórico daqui
        // a um ano precisa saber disso sem conhecer a régua dos canais.
        mensagem: textoDaDeclaracao(declaracao),
        anexouPdf: false,
        meio: declaracao?.meio || null,
        meioLabel: declaracao?.meioLabel || null,
        quando: declaracao?.quando || null,
        comoFoi: declaracao?.comoFoi || null,
        declaradoPor: declaracao?.declaradoPor || null,
        enviadoPor: enviadoPor || declaracao?.declaradoPor || null,
    };
}

/**
 * A frase do resultado — farol honesto: pulada e erro saem contados, e a baixa
 * que NÃO achou tarefa em Vencimentos é dita, porque é ela que deixa a etapa 5
 * em atenção mesmo com o envio declarado.
 */
export function resumoDaDeclaracaoEmLote({ declaradas = [], puladas = [], erros = [] } = {}) {
    const partes = [`${declaradas.length} guia(s) declarada(s) como enviada(s) por fora do app`];
    if (puladas.length) partes.push(`${puladas.length} pulada(s)`);
    if (erros.length) partes.push(`${erros.length} com erro`);
    const semTarefa = declaradas.filter((d) => d?.rito?.baixa?.status === 'sem-tarefa').length;
    if (semTarefa) {
        partes.push(`${semTarefa} sem tarefa DAS em Vencimentos (o cron não gerou) — a etapa 5 fica em atenção até a tarefa existir`);
    }
    return partes.join(' · ') + '.';
}

/**
 * Orquestra o lote. Todo I/O entra por parâmetro — é o que permite provar a
 * ordem e o que é gravado sem Firestore.
 *
 * @param {object} p
 * @param {string[]} p.dasIds
 * @param {string} p.meio  @param {string} p.comoFoi  @param {string} p.quando
 * @param {string} p.quem  e-mail/uid de quem declara (autor)
 * @param {(ids: string[]) => Promise<Array<object|null>>} p.carregarGuias
 * @param {(guia: object) => Promise<{ok: boolean, error?: string}>} p.podeAcessar
 * @param {(p: object) => Promise<object>} p.executarRito  o rito de envio-imposto
 * @param {(log: object) => Promise<void>} p.gravarLog     das_envios_cliente
 * @param {(id: string, snapshot: object) => Promise<void>} p.atualizarGuia  das_emitidos
 * @param {string} [p.agoraIso]  @param {string} [p.hojeIso]
 */
export async function declararEnvioDasEmLote({
    dasIds, meio, comoFoi, quando, quem,
    carregarGuias, podeAcessar, executarRito, gravarLog, atualizarGuia,
    agoraIso, hojeIso,
}) {
    const ids = [...new Set((Array.isArray(dasIds) ? dasIds : []).map((x) => String(x || '').trim()).filter(Boolean))];
    if (!ids.length) return { ok: false, status: 400, erro: 'Escolha ao menos uma guia para declarar o envio.' };

    // A declaração é UMA para o lote — mesma pessoa, mesmo ato, várias guias.
    const conf = conferirDeclaracao({ meio, comoFoi, quando, quem, hojeIso });
    if (!conf.ok) return { ok: false, status: 400, erro: conf.erro };
    const declaracao = conf.declaracao;

    const guias = await carregarGuias(ids);
    const plano = planejarDeclaracaoEmLote(guias, ids);
    const declaradas = [];
    const erros = [];
    const puladas = [...plano.puladas];

    for (const guia of plano.declarar) {
        const acesso = await podeAcessar(guia);
        if (!acesso?.ok) {
            puladas.push({ id: guia.id, empresaNome: guia.empresaNome || '', competencia: guia.competencia || null,
                motivo: acesso?.error || 'Sem acesso a esta empresa.' });
            continue;
        }
        try {
            // 1. O RITO — é ele que grava em impostos_enviados (o que a etapa 5
            //    lê) e dá baixa na tarefa DAS da competência.
            const rito = await executarRito({
                empresaId: guia.empresaId || null,
                empresaCnpj: soDigitos(guia.empresaCnpj),
                empresaNome: guia.empresaNome || '',
                tipo: 'DAS',
                competencia: guia.competencia || null,
                canal: CANAL_FORA_DO_APP,
                declaracao,
                valor: guia.valor,
                enviadoPor: quem,
            });
            // 2. O histórico da Central de DAS e 3. a coluna Envio da guia.
            await gravarLog(logEnvioDeclarado(guia, declaracao, { enviadoPor: quem }));
            await atualizarGuia(guia.id, snapshotEnvioDeclarado(declaracao, { enviadoPor: quem, agoraIso }));
            declaradas.push({ id: guia.id, empresaNome: guia.empresaNome || '', competencia: guia.competencia || null, rito });
        } catch (e) {
            erros.push({ id: guia.id, empresaNome: guia.empresaNome || '', competencia: guia.competencia || null,
                motivo: e?.message || String(e) });
        }
    }

    const resultado = { declaradas, puladas, erros };
    return {
        ok: true,
        ...resultado,
        resumo: resumoDaDeclaracaoEmLote(resultado),
        declaracao: { ...declaracao, texto: textoDaDeclaracao(declaracao) },
    };
}
