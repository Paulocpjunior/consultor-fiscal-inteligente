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
export function decidirDestinoDaTriagem({ resultado, filas, minimo = CONFIANCA_MINIMA_TRIAGEM, erro = null }) {
    if (erro) return { fila: null, situacao: 'ia-indisponivel', detalhe: String(erro).slice(0, 200) };
    if (!resultado) return { fila: null, situacao: 'nao-entendi' };
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
