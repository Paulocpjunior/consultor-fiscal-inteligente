// ============================================================================
// sefaz-backend/whatsapp-triagem-ia.js — a IA que LÊ o texto livre do cliente
// ----------------------------------------------------------------------------
// Paulo (25/08): *"o que acha de ligarmos uma IA no bot? Podemos usar o motor
// do gemini 3.7 na minha conta paga"* → *"vamos tocar na sua sugestão"*.
//
// 🚩 O BURACO QUE ELA FECHA, e ele está numa linha do bot de hoje: quando o
// cliente escreve texto em vez de digitar um número, `decidirAutomacao` cai no
// `else` e **reapresenta o menu**. Quem manda "preciso da 2ª via do DAS" recebe
// de volta "digite 1 para Recepção…". É o maior atrito da triagem.
//
// 🚨 O QUE ELA FAZ, E SÓ ISSO: **classifica**. Ela escolhe UMA das filas que já
// existem no menu, ou não escolhe nada. **Ela NÃO responde ao cliente.**
// Bot de escritório contábil respondendo matéria fiscal por conta própria é o
// erro do `1405` no pior lugar que existe: inventado, por escrito, com o nome
// da casa, direto para o cliente. A régua desta casa é não afirmar o que não
// foi medido — a IA no atendimento não é a exceção dela.
//
// DECISÕES QUE MANDAM:
//  · **Saída FECHADA.** A resposta do modelo só vale se for o id de uma fila do
//    menu. Qualquer outra coisa é DESCARTADA e nomeada — nunca vira fila.
//  · **Na dúvida, o comportamento de HOJE.** Confiança abaixo do mínimo, texto
//    ilegível, IA fora do ar ou demorando: cai no menu de sempre. A IA só muda
//    o que ela tem certeza; onde ela não tem, o app não fica pior que antes.
//  · **Nada disto roda em conversa com dono ou com fila** — quem decide isso é
//    `decidirAutomacao`, que só chama a triagem no galho da triagem. É a mesma
//    trava de 17/08 (o bot não fala por cima de atendimento em andamento).
//  · **O cliente vê o que foi entendido**: a confirmação de fila é a MESMA de
//    quando ele digita o número, e o `#menu` continua desfazendo. Classificação
//    errada é visível e reversível pelo próprio cliente.
// ============================================================================

/**
 * Abaixo disto, o app NÃO age — mostra o menu, como sempre fez.
 * 0.7 é deliberadamente alto: encaminhar para a fila errada custa mais que
 * pedir ao cliente para escolher, porque a conversa vai parar na mesa de quem
 * não resolve e o cliente espera sem saber.
 */
export const CONFIANCA_MINIMA_TRIAGEM = 0.7;

/** Texto que nem vale uma chamada: dígito, comando, saudação solta. */
const RUIDO = /^(#?menu|#?sair|oi+|ol[aá]|bom dia|boa tarde|boa noite|obrigad[oa]|ok|blz|👍|\d{1,2})$/i;

/**
 * As filas que a IA pode escolher saem do MENU CONFIGURADO, nunca de uma lista
 * escrita aqui: o Paulo edita o menu na ⚙️, e uma segunda lista divergiria no
 * primeiro item que ele mudasse. Sub-opções entram como destinos legítimos —
 * elas são folhas do mesmo mapa.
 */
export function filasParaTriagem(config) {
    const vistas = new Set();
    const filas = [];
    for (const item of config?.menu || []) {
        const folhas = Array.isArray(item.submenu) && item.submenu.length ? item.submenu : [item];
        for (const f of folhas) {
            const id = String(f?.fila || '').trim().toLowerCase();
            if (!id || vistas.has(id)) continue;
            vistas.add(id);
            filas.push({ fila: id, rotulo: String(f?.rotulo || id) });
        }
    }
    return filas;
}

/** Vale gastar uma chamada com este texto? */
export function valeClassificar(texto) {
    const t = String(texto || '').trim();
    if (t.length < 4) return false;      // "1", "ok", "oi"
    if (RUIDO.test(t)) return false;
    return true;
}

/**
 * O prompt. Duas coisas importam aqui e as duas são trava:
 *  · a lista de destinos vai DENTRO do prompt, e o modelo é mandado escolher
 *    dela ou devolver `nenhuma` — pedir "escolha o departamento" sem a lista é
 *    convidar a inventar;
 *  · ele é proibido de responder ao cliente. O prompt diz isso com todas as
 *    letras porque modelo prestativo tenta ajudar, e "ajudar" aqui é o dano.
 */
export function montarPromptTriagem({ texto, filas }) {
    const lista = filas.map((f) => `- ${f.fila}: ${f.rotulo}`).join('\n');
    return [
        'Você faz a TRIAGEM de mensagens de clientes de um escritório de contabilidade.',
        'Sua ÚNICA tarefa é escolher para qual departamento a mensagem deve ir.',
        '',
        'Departamentos possíveis (use exatamente o identificador da esquerda):',
        lista,
        '',
        'REGRAS:',
        '1. Escolha UM identificador da lista acima, ou "nenhuma" se não estiver claro.',
        '2. NUNCA responda a dúvida do cliente. NUNCA dê informação fiscal, contábil,',
        '   jurídica ou de prazo. Você só classifica.',
        '3. Se a mensagem for genérica ("preciso de ajuda", "bom dia"), use "nenhuma".',
        '4. confianca é de 0 a 1: o quanto você tem certeza da escolha.',
        '',
        'Responda SOMENTE com JSON, sem texto em volta:',
        '{"fila":"<identificador ou nenhuma>","confianca":0.0,"motivo":"<3 a 8 palavras>"}',
        '',
        'Mensagem do cliente:',
        '"""',
        String(texto || '').slice(0, 1500),
        '"""',
    ].join('\n');
}

/**
 * Lê a resposta do modelo. Devolve `null` para tudo que não for uma escolha
 * legítima — inclusive fila que não existe no menu.
 *
 * ⚠️ O modelo às vezes embrulha o JSON em ```json … ```; isso é forma, não
 * conteúdo, e se desembrulha. O que NÃO se conserta é fila inventada.
 */
export function interpretarRespostaTriagem(bruto, filas) {
    const validas = new Set((filas || []).map((f) => String(f.fila).toLowerCase()));
    const texto = String(bruto || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let obj;
    try { obj = JSON.parse(texto); } catch {
        // Última tentativa: o primeiro objeto que apareça no meio de prosa.
        const m = texto.match(/\{[\s\S]*\}/);
        if (!m) return null;
        try { obj = JSON.parse(m[0]); } catch { return null; }
    }
    const fila = String(obj?.fila || '').trim().toLowerCase();
    if (!fila || fila === 'nenhuma') return null;
    if (!validas.has(fila)) return { fila: null, confianca: 0, motivo: 'fila-inexistente', invalida: fila };
    const c = Number(obj?.confianca);
    return {
        fila,
        confianca: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0,
        motivo: String(obj?.motivo || '').slice(0, 120),
    };
}

/**
 * A decisão final. Devolve SEMPRE uma situação nomeada — "não classificou" e
 * "não deu para perguntar" pedem a mesma ação hoje (mostrar o menu), mas são
 * fatos diferentes, e um contador só faria os dois parecerem a mesma coisa
 * quando alguém for olhar por que a triagem não está pegando.
 */
export function decidirDestinoDaTriagem({ resultado, filas, minimo = CONFIANCA_MINIMA_TRIAGEM, erro = null, bruto = null }) {
    if (erro) return { fila: null, situacao: 'ia-indisponivel', detalhe: String(erro).slice(0, 200) };
    // 📊 03/10 (painel do Paulo: 486 de 500 "não entendeu"): "não entendeu"
    // sem o POR QUÊ não se investiga. Três coisas diferentes caíam no mesmo
    // balde — o modelo escolheu "nenhuma" (mensagem genérica, que é o
    // esperado), devolveu algo ilegível (defeito de prompt/modelo) ou não
    // devolveu nada (bloqueio/corte). O detalhe nasce do BRUTO, nunca de
    // dedução, e o painel agrupa.
    if (!resultado) return { fila: null, situacao: 'nao-entendi', detalhe: motivoDoNaoEntendi(bruto) };
    if (!resultado.fila) {
        // O modelo escolheu algo que não existe. Isso é DEFEITO do prompt ou
        // do modelo, não do cliente — por isso sai nomeado, com o que ele
        // devolveu, em vez de virar um "não entendi" genérico.
        return { fila: null, situacao: 'fila-inexistente', detalhe: resultado.invalida || null };
    }
    if (resultado.confianca < minimo) {
        return { fila: null, situacao: 'sem-certeza', confianca: resultado.confianca, sugeria: resultado.fila };
    }
    const rotulo = (filas || []).find((f) => f.fila === resultado.fila)?.rotulo || resultado.fila;
    return {
        fila: resultado.fila, rotulo, situacao: 'classificada',
        confianca: resultado.confianca, motivo: resultado.motivo || null,
    };
}

/** Por que o "não entendi": lido da resposta crua do modelo. */
export function motivoDoNaoEntendi(bruto) {
    const t = String(bruto ?? '').trim();
    if (!t) return 'resposta vazia do modelo';
    if (/"fila"\s*:\s*"nenhuma"/i.test(t) || /^nenhuma$/i.test(t)) return 'modelo escolheu "nenhuma" (mensagem genérica)';
    return `resposta ilegível: ${t.replace(/\s+/g, ' ').slice(0, 120)}`;
}

/** Agrupa o detalhe do "não entendi" em três classes (+ os registros antigos, sem detalhe). */
export function classeDoNaoEntendi(detalhe) {
    const d = String(detalhe || '');
    if (!d) return 'sem detalhe (registro anterior a 03/10)';
    if (d.startsWith('modelo escolheu "nenhuma"')) return 'nenhuma (genérica)';
    if (d.startsWith('resposta vazia')) return 'resposta vazia';
    if (d.startsWith('resposta ilegível')) return 'resposta ilegível';
    return d.slice(0, 60);
}

// ═══ 📊 O PAINEL DA IA — "a IA está pegando?" deixa de ser palpite (28/09) ══
// Paulo (27/09): *"a IA está ativa?"*. A resposta honesta era "ligada, mas
// não sei se está trabalhando": cada decisão só ia para o console.log do
// Cloud Run. Agora cada decisão vira UM registro em `whatsapp_triagem_ia_log`
// — inclusive as que NÃO classificaram (sem-certeza, nao-entendi,
// ia-indisponivel, fila-inexistente) — e a aba 🤖 soma os últimos 7 dias.
//
// DECISÕES:
//  · O texto do cliente entra CORTADO (80 chars): é o que faz "sem-certeza"
//    ser lido ("ah, era só um 'oi tudo bem?'"), e não vaza mais do que a
//    própria conversa já mostra. Nunca o texto inteiro.
//  · `ia-indisponivel` distingue o motivo (sem chave / tempo esgotado / erro):
//    são três ações diferentes para o mesmo contador.
//  · A soma é PURA e recebe `agora` — trava não lê relógio.

export const COLECAO_TRIAGEM_IA_LOG = 'whatsapp_triagem_ia_log';
export const SITUACOES_TRIAGEM = ['classificada', 'sem-certeza', 'nao-entendi', 'fila-inexistente', 'ia-indisponivel'];

/** Um registro de decisão — o que a rota grava (best-effort, nunca lança). */
export function registroDeTriagem({ numero, texto, destino, modelo = null, agora = new Date() }) {
    const d = destino || {};
    return {
        em: new Date(agora).toISOString(),
        numero: String(numero || ''),
        situacao: SITUACOES_TRIAGEM.includes(d.situacao) ? d.situacao : 'nao-entendi',
        fila: d.fila || d.sugeria || null,
        rotulo: d.rotulo || null,
        confianca: Number.isFinite(d.confianca) ? d.confianca : null,
        motivo: d.motivo || null,
        detalhe: d.detalhe ? String(d.detalhe).slice(0, 200) : null,
        textoResumo: String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        modelo: modelo || null,
    };
}

/**
 * Soma os registros de uma janela. Devolve contadores por situação, as filas
 * mais escolhidas, os motivos de indisponibilidade, e as últimas decisões —
 * tudo do que veio, sem inventar zero como "tudo certo".
 */
export function resumirTriagemIa(registros, { agora = new Date(), dias = 7, ultimas = 10 } = {}) {
    const desde = new Date(new Date(agora).getTime() - dias * 24 * 60 * 60 * 1000).toISOString();
    // `em` tem de ser DATA legível: comparar string com string deixaria "lixo"
    // (l > 2) passar como se fosse hoje — pego pela trava na 1ª rodada.
    const naJanela = (registros || []).filter((r) => r && typeof r.em === 'string' && Number.isFinite(Date.parse(r.em)) && r.em >= desde);
    const contadores = Object.fromEntries(SITUACOES_TRIAGEM.map((s) => [s, 0]));
    const porFila = {};
    const motivosIndisponivel = {};
    const motivosNaoEntendi = {};
    for (const r of naJanela) {
        const s = SITUACOES_TRIAGEM.includes(r.situacao) ? r.situacao : 'nao-entendi';
        contadores[s] += 1;
        if (s === 'classificada' && r.fila) porFila[r.fila] = (porFila[r.fila] || 0) + 1;
        if (s === 'ia-indisponivel') {
            const k = String(r.detalhe || 'sem detalhe').slice(0, 60);
            motivosIndisponivel[k] = (motivosIndisponivel[k] || 0) + 1;
        }
        if (s === 'nao-entendi') {
            const k = classeDoNaoEntendi(r.detalhe);
            motivosNaoEntendi[k] = (motivosNaoEntendi[k] || 0) + 1;
        }
    }
    const ordenados = [...naJanela].sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : 0));
    const total = naJanela.length;
    return {
        dias, desde, total,
        contadores,
        // "pegou" = classificou. Sem chamada nenhuma, a taxa é null, não 0%.
        taxaClassificada: total ? Math.round((contadores.classificada / total) * 100) : null,
        filas: Object.entries(porFila).sort((a, b) => b[1] - a[1]).map(([fila, quantidade]) => ({ fila, quantidade })),
        motivosIndisponivel: Object.entries(motivosIndisponivel).sort((a, b) => b[1] - a[1]).map(([motivo, quantidade]) => ({ motivo, quantidade })),
        motivosNaoEntendi: Object.entries(motivosNaoEntendi).sort((a, b) => b[1] - a[1]).map(([motivo, quantidade]) => ({ motivo, quantidade })),
        ultimaEm: ordenados[0]?.em || null,
        ultimas: ordenados.slice(0, ultimas),
    };
}
