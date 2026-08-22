// ============================================================================
// sefaz-backend/whatsapp-atendimento.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// F3 DO SP CONNECT: triagem, automações e filas — o bloco que substitui o bot
// da plataforma de atendimento. Régua de paridade: os prints reais do bot
// atual (16/08) — saudação com protocolo, menu numérico, fora de horário,
// #sair.
//
// DECISÕES QUE MANDAM:
// - FILA ≠ DEPARTAMENTO DO SAAS. O catálogo `DEPARTAMENTOS` (cadastro
//   central) são os 5 MÓDULOS e não incha (o teste dele diz "nem mais nem
//   menos" de propósito — ele guarda gates de app). RH, Jurídico e Recepção
//   são FILAS DE ATENDIMENTO, catálogo PRÓPRIO, aqui.
// - Recepção atende TODOS (Paulo, 16/08): quem tem a fila 'recepcao' vê
//   todas; os demais veem a(s) própria(s) + Recepção. Admin vê tudo.
// - O BOT NASCE DESLIGADO (`botAtivo: false`): com a plataforma atual ainda
//   respondendo, dois bots no mesmo cliente = menu em dobro. Ligar é decisão
//   na ⚙️ (mesma regra do alertasAtivos da Legalização).
// - Config editável NUNCA cravada no código: DEFAULT é só o primeiro valor.
// - decidirAutomacao é FUNÇÃO PURA: entra estado, sai lista de AÇÕES — quem
//   executa (envia/grava) é a rota. É o que torna o bot testável de verdade.
// ============================================================================

const FUSO = 'America/Sao_Paulo';

/** Catálogo de FILAS de atendimento (id estável; rótulo é o que o cliente vê). */
export const FILAS_ATENDIMENTO = [
    { id: 'recepcao', rotulo: 'Recepção / Front Desk' },
    { id: 'financeiro', rotulo: 'Gestão - Financeiro' },
    { id: 'dp-folha', rotulo: 'Gestão - Departamento Pessoal' },
    { id: 'fiscal', rotulo: 'Gestão - Departamento Fiscal / Impostos' },
    { id: 'contabil', rotulo: 'Gestão - Departamento Contábil' },
    { id: 'legalizacao', rotulo: 'Gestão - Departamento Legalização' },
    { id: 'rh', rotulo: 'Gestão - Recursos Humanos' },
    { id: 'juridico', rotulo: 'Departamento - Jurídico' },
];

const IDS_FILAS = new Set(FILAS_ATENDIMENTO.map((f) => f.id));

export function filaValida(id) {
    return IDS_FILAS.has(String(id || '').trim().toLowerCase());
}

// ─── Papéis do ATENDIMENTO (Paulo, 16/08) — não são os roles do CFI ─────────
// admin (role do CFI)  = tudo, inclusive ⚙️ (alteração sistêmica);
// gestor               = vê tudo, atende tudo, encerra qualquer atendimento,
//                        SÓ NÃO altera configuração;
// colaborador (padrão) = só as filas linkadas, transfere, encerra APENAS o
//                        atendimento que ELE conduz, não altera configuração.
export const PAPEIS_ATENDIMENTO = ['colaborador', 'gestor'];

export function papelValido(p) {
    return PAPEIS_ATENDIMENTO.includes(String(p || '').trim().toLowerCase());
}

/**
 * Filas que um usuário ENXERGA. `filas` = filas de atendimento atribuídas
 * (users.filasAtendimento); sem atribuição, os departamentos de MÓDULO valem
 * como fila (os 5 ids coincidem de propósito). Devolve null = TODAS.
 */
export function filasVisiveis({ role, papelAtendimento, departamentos = [], filasAtendimento = [] }) {
    if (role === 'admin') return null;
    if (String(papelAtendimento || '').toLowerCase() === 'gestor') return null; // gestor vê tudo
    const minhas = (filasAtendimento.length ? filasAtendimento : departamentos)
        .map((d) => String(d || '').trim().toLowerCase())
        .filter((d) => IDS_FILAS.has(d));
    if (minhas.includes('recepcao')) return null; // Recepção atende todos
    return [...new Set([...minhas, 'recepcao'])]; // a própria + Recepção (triagem)
}

/**
 * Quem pode ENCERRAR (ou reabrir) um atendimento: admin e gestor, qualquer
 * um; colaborador, SÓ o que ele conduz — encerrar o próprio atendimento é
 * parte do atendimento (exigir gestor pra tudo viraria gargalo), e encerrar
 * o dos outros é decisão de gestão.
 */
export function podeEncerrar({ role, papelAtendimento, email, atribuidoA }) {
    if (role === 'admin') return true;
    if (String(papelAtendimento || '').toLowerCase() === 'gestor') return true;
    return Boolean(email && atribuidoA === email);
}

/** Conversa é visível? `fila` null = ainda na Recepção. */
export function conversaVisivel(filasDoUsuario, filaDaConversa) {
    if (filasDoUsuario === null) return true;
    return filasDoUsuario.includes(filaDaConversa || 'recepcao');
}

/**
 * 🚨 O MENU PROMETE 8 DEPARTAMENTOS — TEM GENTE EM CADA UM?
 *
 * Pergunta que o dia do corte responde do jeito caro. O bot pergunta ao
 * cliente para qual departamento ele quer ir e MOVE a conversa para aquela
 * fila. A partir daí, quem enxerga a conversa é só quem atende aquela fila
 * (`filasVisiveis`) — mais quem vê tudo: Recepção, gestor e admin.
 *
 * Enquanto os colaboradores não estiverem vinculados às filas na ⚙️ → 👥, o
 * efeito é este: o cliente escolhe "3 - Departamento Pessoal", a conversa sai
 * da Recepção e vai para uma fila **sem ninguém do departamento**. Não é o
 * cliente que percebe — ele acha que foi encaminhado, e espera.
 *
 * ⚠️ **DUAS SITUAÇÕES QUE NÃO PODEM VIRAR UMA**: fila sem ninguém DO
 * DEPARTAMENTO ainda é vista por quem vê tudo (a conversa não some, mas a
 * triagem não entregou o que prometeu); fila que NINGUÉM vê é conversa fora
 * de qualquer tela. As ações são diferentes — vincular alguém × socorrer a
 * conversa agora — e fundir as duas esconderia a segunda dentro da primeira.
 *
 * ⚠️ **LISTA NÃO CARREGADA NÃO É "NINGUÉM"**: sem os atendentes em mãos a
 * resposta é `indeterminado`. Acusar fila órfã porque a leitura falhou é o
 * alarme falso que aparece justo quando está tudo certo — e ensina a ignorar
 * o alarme verdadeiro.
 */
export function coberturaDasFilas({ menu = [], atendentes = null } = {}) {
    if (!Array.isArray(atendentes)) {
        return { indeterminado: true, motivo: 'a lista de atendentes não foi carregada', filas: [], opcoesSemDono: [] };
    }
    const filasDe = (a) => {
        const brutas = (a?.filasAtendimento?.length ? a.filasAtendimento : (a?.departamentos || []));
        return brutas.map((f) => String(f || '').trim().toLowerCase()).filter((f) => IDS_FILAS.has(f));
    };
    // Quem vê TUDO: admin, gestor e quem tem a fila 'recepcao' (decisão do
    // Paulo, 16/08: a Recepção atende todos).
    const veTudo = atendentes.filter((a) => a?.role === 'admin'
        || String(a?.papelAtendimento || '').toLowerCase() === 'gestor'
        || filasDe(a).includes('recepcao'));

    const filas = FILAS_ATENDIMENTO.map((f) => {
        // 'recepcao' é a casa de quem vê tudo — o "departamento" dela são eles.
        const doDepartamento = f.id === 'recepcao'
            ? atendentes.filter((a) => filasDe(a).includes('recepcao'))
            : atendentes.filter((a) => filasDe(a).includes(f.id));
        const tambemVeem = veTudo.filter((a) => !doDepartamento.includes(a));
        const situacao = doDepartamento.length ? 'coberta'
            : (tambemVeem.length ? 'so-quem-ve-tudo' : 'invisivel');
        return {
            fila: f.id,
            rotulo: f.rotulo,
            doDepartamento: doDepartamento.length,
            tambemVeem: tambemVeem.length,
            situacao,
        };
    });

    const porId = new Map(filas.map((f) => [f.fila, f]));
    // O que o CLIENTE veria: a opção do menu, não o id interno da fila.
    // ⚠️ O RÓTULO QUE VALE É O DO MENU, não o do catálogo: o menu é editável, e
    // quem lê o aviso precisa achar a mesma frase que o cliente recebeu.
    const opcoesSemDono = (menu || [])
        .map((m) => {
            const f = porId.get(m.fila) || {};
            return { ...f, filaRotulo: f.rotulo, opcao: String(m.opcao), rotulo: m.rotulo };
        })
        .filter((m) => m.situacao && m.situacao !== 'coberta');

    return { indeterminado: false, motivo: null, filas, opcoesSemDono };
}

// ─── Config do atendimento ──────────────────────────────────────────────────

/** Primeiro valor da config — TUDO editável na ⚙️ do Connect depois. */
export function configPadraoAtendimento() {
    return {
        botAtivo: false,   // NASCE DESLIGADO — dois bots no mesmo cliente é menu em dobro
        // 🚨 ALCANCE DO BOT — o que torna a CONVIVÊNCIA possível (Paulo, 17/08:
        // *"temos que permanecer com os 2 apps ativos, não faz sentido criar uma
        // opção pra migrar o bot se os 2 não estiverem ativos"*).
        //
        // Os DOIS apps continuam assinados na WABA de propósito: a Ultra Fox é a
        // rede de segurança enquanto o SP Connect é validado. Só que os dois
        // recebem a MESMA mensagem, e se os dois bots responderem o cliente vê
        // menu em dobro. A saída não é desligar a Ultra Fox antes da hora — é
        // limitar QUEM o NOSSO bot atende.
        //
        // 'piloto' = responde só aos números da lista (o teste roda em produção,
        // com os dois de pé, sem que nenhum cliente veja dois menus).
        // 'todos'  = o dia do corte.
        botAlcance: 'piloto',
        // Lista vazia com alcance 'piloto' = bot LIGADO e mudo. É o estado
        // seguro: quem apagar a lista sem querer não solta o bot na carteira.
        botNumerosPiloto: [],
        // Aviso ao CLIENTE quando um atendente transfere a conversa de fila.
        // Também nasce desligado: é o admin que decide quando a casa quer
        // falar isso — e só sai com a janela de 24h aberta (regra da Meta).
        avisarClienteTransferencia: false,
        // Pesquisa de satisfação no ENCERRAMENTO (nota 1-5 pelo WhatsApp).
        // Nasce desligada pela mesma razão de sempre; só sai com a janela
        // aberta, e SÓ a primeira resposta do cliente vale como nota —
        // insistir em avaliação é spam.
        avaliacaoAtiva: false,
        // 🚨 ESCALA DA NOTA — decisão do Paulo (17/08): 1 a 10.
        //
        // Ela existe porque o TEXTO e a RÉGUA divergiram em produção: alguém
        // editou a mensagem para "De 1 a 10" e o `interpretarNota` só aceitava
        // 1-5. O cliente respondeu 10, a nota virou null e NADA avisou — o
        // painel mostraria "0 avaliações" com o cliente tendo respondido.
        // Agora a escala é DADO: a mensagem, a leitura da resposta e o painel
        // leem daqui, e um teste barra mensagem que peça outra escala.
        avaliacaoEscala: 10,
        horario: {
            dias: [1, 2, 3, 4, 5],
            turnos: [{ inicio: '08:00', fim: '12:00' }, { inicio: '13:00', fim: '17:30' }],
        },
        mensagens: {
            saudacao: '{nome}, aguarde um momento, logo te atenderemos!\n\nEm qualquer momento, digite #sair para sair do atendimento.\nProtocolo: {protocolo}',
            menuCabecalho: 'Digite uma das seguintes opções:',
            confirmacaoFila: 'Perfeito! Você foi direcionado para {fila}. Aguarde que logo um atendente responderá.',
            foraDeHorario: 'Obrigado por entrar em contato! Nosso horário de atendimento é de Seg. a Sex das 8:00h às 12:00h e 13:00 às 17:30h.\nVisite nosso site: www.spassessoriacontabil.com.br\n\nPode deixar sua mensagem que retornaremos o mais breve possível!',
            sair: 'Atendimento encerrado. Quando precisar, é só chamar!',
            transferencia: 'Você foi direcionado para {fila}. Um atendente do time já vai continuar seu atendimento.',
            avaliacao: 'Seu atendimento foi encerrado. De 1 a 10, que nota você dá para este atendimento? (responda só com o número)',
            avaliacaoObrigado: 'Obrigado pela avaliação! 💙 Quando precisar, é só chamar.',
        },
        // Menu numérico → fila. Espelha o menu de 8 opções em uso hoje.
        menu: FILAS_ATENDIMENTO.map((f, i) => ({ opcao: String(i + 1), fila: f.id, rotulo: f.rotulo })),
        // ⚡ Respostas rápidas do composer (Paulo, 21/08: "vamos relacionar o
        // que falta e completar" — era a pendência da pergunta 2 do de-para).
        // Estas 4 são as que viviam CRAVADAS na tela; o admin edita na ⚙️ e
        // lista gravada VAZIA é escolha (some os chips), não volta ao padrão.
        respostasRapidas: [
            'Bom dia! Tudo bem?',
            'Recebido, já estamos verificando.',
            'Pode nos enviar o comprovante, por favor?',
            'Ficamos à disposição!',
        ],
        // 🖼️ Imagem enviada junto da confirmação do departamento (Paulo,
        // 20/08, olhando a Ultra Fox: a arte "GESTÃO DE PESSOAS" que ela
        // manda depois do cliente escolher "3"). Mapa fila→URL; fila sem
        // entrada aqui continua só com o texto — nada quebra sem imagem
        // cadastrada. Nasce vazio: imagem é a admin quem sobe, nunca chute.
        imagensPorFila: {},
    };
}

/** Escalas que o app entende. Fora daqui, cai no padrão. */
export const ESCALAS_AVALIACAO = [5, 10];
export const ESCALA_AVALIACAO_PADRAO = 10;

/** Número só em dígitos — máscara é enfeite de tela, chave é dígito. */
export function soDigitos(v) {
    return String(v || '').replace(/\D/g, '');
}

/**
 * O bot pode responder a ESTE número?
 *
 * É a trava que permite rodar o SP Connect com a Ultra Fox ainda de pé: os
 * dois apps recebem a mesma mensagem, mas só o nosso decide a quem responde.
 *
 * DUAS RECUSAS DELIBERADAS:
 *  · lista vazia no modo piloto ⇒ NÃO responde a ninguém. Poderia significar
 *    "sem restrição", e é justamente a leitura que soltaria o bot na carteira
 *    inteira quando alguém apagasse a lista sem querer;
 *  · número ilegível ⇒ não responde. Bot que responde ao que não sabe
 *    identificar é bot que escapa do piloto pela porta dos fundos.
 */
export function botAlcancaNumero(config, numero) {
    if (config?.botAlcance === 'todos') return true;
    const alvo = soDigitos(numero);
    if (!alvo) return false;
    // Compara pelos últimos 11 dígitos: o WhatsApp entrega o número com 55 e
    // ora com o 9 do celular, ora sem — casar a string inteira faria o piloto
    // "não pegar" justamente o número que a pessoa cadastrou.
    const cauda = (d) => d.slice(-11);
    return (config?.botNumerosPiloto || []).some((n) => {
        const c = soDigitos(n);
        return c && cauda(c) === cauda(alvo);
    });
}

/** Merge raso da config gravada sobre o padrão — campo novo nunca some. */
export function resolverConfig(gravada) {
    const p = configPadraoAtendimento();
    if (!gravada || typeof gravada !== 'object') return p;
    // Item de menu com fila inválida é filtrado; se NADA sobrar, volta ao
    // padrão — menu vazio seria triagem morta em silêncio.
    const menuGravado = Array.isArray(gravada.menu) ? gravada.menu.filter((m) => filaValida(m.fila)) : [];
    return {
        botAtivo: typeof gravada.botAtivo === 'boolean' ? gravada.botAtivo : p.botAtivo,
        // 🚨 RETROCOMPATIBILIDADE: config gravada ANTES deste campo existir e
        // com o bot LIGADO respondia a todo mundo — é o que ela fazia, e uma
        // migração não pode emudecer o bot em silêncio (o efeito só apareceria
        // com o cliente sem resposta, e ninguém ligaria uma coisa à outra).
        // Config NOVA nasce em 'piloto', que é o lado seguro.
        botAlcance: gravada.botAlcance === 'todos' ? 'todos'
            : (gravada.botAlcance === 'piloto' ? 'piloto'
                : (gravada.botAtivo === true ? 'todos' : p.botAlcance)),
        botNumerosPiloto: Array.isArray(gravada.botNumerosPiloto)
            ? gravada.botNumerosPiloto.map(soDigitos).filter(Boolean)
            : p.botNumerosPiloto,
        avisarClienteTransferencia: typeof gravada.avisarClienteTransferencia === 'boolean'
            ? gravada.avisarClienteTransferencia : p.avisarClienteTransferencia,
        avaliacaoAtiva: typeof gravada.avaliacaoAtiva === 'boolean' ? gravada.avaliacaoAtiva : p.avaliacaoAtiva,
        avaliacaoEscala: ESCALAS_AVALIACAO.includes(Number(gravada.avaliacaoEscala))
            ? Number(gravada.avaliacaoEscala) : p.avaliacaoEscala,
        horario: gravada.horario && Array.isArray(gravada.horario.turnos) ? gravada.horario : p.horario,
        mensagens: { ...p.mensagens, ...(gravada.mensagens || {}) },
        menu: menuGravado.length ? menuGravado : p.menu,
        // Ao contrário do menu (vazio = triagem morta ⇒ volta ao padrão),
        // respostas rápidas VAZIAS são escolha legítima — só some o atalho.
        respostasRapidas: Array.isArray(gravada.respostasRapidas)
            ? gravada.respostasRapidas.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 20)
            : p.respostasRapidas,
        // Entrada com fila inválida ou URL vazia é DESCARTADA, não gravada —
        // mesma régua do menu: dado torto não vira "imagem quebrada" na
        // conversa do cliente.
        imagensPorFila: gravada.imagensPorFila && typeof gravada.imagensPorFila === 'object'
            ? Object.fromEntries(Object.entries(gravada.imagensPorFila)
                .filter(([fila, url]) => filaValida(fila) && typeof url === 'string' && url.trim()))
            : p.imagensPorFila,
    };
}

// ─── Horário de funcionamento (fuso de SP, com almoço) ──────────────────────

function minutosDoDia(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

export function dentroDoHorario(horario, agora = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const p = Object.fromEntries(fmt.formatToParts(agora).map((x) => [x.type, x.value]));
    const dia = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
    if (!(horario?.dias || []).includes(dia)) return false;
    const agoraMin = (Number(p.hour === '24' ? 0 : p.hour)) * 60 + Number(p.minute);
    return (horario?.turnos || []).some((t) => {
        const i = minutosDoDia(t.inicio); const f = minutosDoDia(t.fim);
        return i != null && f != null && agoraMin >= i && agoraMin < f;
    });
}

// ─── Protocolo, templates e menu ────────────────────────────────────────────

/**
 * Protocolo no estilo do bot atual (número solto) e ÚNICO por construção:
 * segundos desde 2020 + 1 dígito aleatório — 10 dígitos hoje.
 * (Formato é apresentação; se o Paulo escolher outro, muda AQUI, num lugar.)
 */
export function gerarProtocolo(agora = new Date(), aleatorio = Math.floor(Math.random() * 10)) {
    const base = Math.floor((agora.getTime() - Date.parse('2020-01-01T00:00:00Z')) / 1000);
    return `${base}${aleatorio}`;
}

/** Placeholders {nome} {protocolo} {fila} — desconhecido fica como está (visível). */
export function renderMensagem(template, dados = {}) {
    return String(template || '').replace(/\{(nome|protocolo|fila)\}/g, (m, k) => {
        const v = dados[k];
        return (v == null || v === '') ? m : String(v);
    });
}

export function montarTextoMenu(config) {
    const linhas = (config.menu || []).map((m) => `${m.opcao} - ${m.rotulo}`);
    return `${config.mensagens.menuCabecalho}\n\n${linhas.join('\n')}`;
}

/**
 * Resposta do cliente é uma NOTA de avaliação (1-5)? Aceita "5", "5.",
 * " 5 ", "nota 5" e "5 estrelas". Qualquer outra coisa devolve null — a
 * nota nunca é deduzida de texto livre.
 */
export function interpretarNota(texto, escala = ESCALA_AVALIACAO_PADRAO) {
    const max = ESCALAS_AVALIACAO.includes(Number(escala)) ? Number(escala) : ESCALA_AVALIACAO_PADRAO;
    const t = String(texto || '').trim().toLowerCase()
        .replace(/^nota\s+/, '').replace(/\s*(estrelas?|⭐+)$/, '').replace(/[.)!]$/, '').trim();
    if (!/^\d{1,2}$/.test(t)) return null;
    const n = Number(t);
    // Fora da escala NÃO vira nota — e quem chama precisa saber a diferença
    // entre "não é nota" e "é nota inválida" (ver `leituraDaNota`).
    return n >= 1 && n <= max ? n : null;
}

/**
 * A resposta do cliente, classificada. Existe porque `null` fundia dois casos
 * com AÇÕES OPOSTAS: "isso não é uma nota, é outro assunto" (segue o fluxo) e
 * "isso é um número FORA da escala" (o cliente tentou avaliar e nós perdemos).
 * O segundo tem que ser DITO, senão a nota some em silêncio — que foi
 * exatamente o defeito de 17/08.
 */
export function leituraDaNota(texto, escala = ESCALA_AVALIACAO_PADRAO) {
    const max = ESCALAS_AVALIACAO.includes(Number(escala)) ? Number(escala) : ESCALA_AVALIACAO_PADRAO;
    const t = String(texto || '').trim().toLowerCase()
        .replace(/^nota\s+/, '').replace(/\s*(estrelas?|⭐+)$/, '').replace(/[.)!]$/, '').trim();
    if (!/^\d{1,2}$/.test(t)) return { tipo: 'nao-e-nota', nota: null };
    const n = Number(t);
    if (n >= 1 && n <= max) return { tipo: 'nota', nota: n };
    return { tipo: 'fora-da-escala', nota: null, informado: n, escala: max };
}

/**
 * A mensagem de avaliação combina com a escala configurada?
 *
 * É a trava do defeito real: o texto dizia "De 1 a 10" e a régua aceitava
 * 1-5. Procura a faixa escrita no texto e compara — texto sem faixa explícita
 * não é acusado (nem toda redação diz o intervalo).
 */
export function conferirEscalaNaMensagem(mensagem, escala) {
    const max = ESCALAS_AVALIACAO.includes(Number(escala)) ? Number(escala) : ESCALA_AVALIACAO_PADRAO;
    const m = /\b(?:de\s*)?([0-9]{1,2})\s*(?:a|até|-|–)\s*([0-9]{1,2})\b/i.exec(String(mensagem || ''));
    if (!m) return { ok: true, semFaixaNoTexto: true, escala: max };
    const fim = Number(m[2]);
    if (fim === max) return { ok: true, escala: max };
    return {
        ok: false,
        escala: max,
        noTexto: fim,
        erro: `A mensagem pede nota até ${fim} e a escala configurada vai até ${max}. `
            + `Quem responder ${fim} teria a nota DESCARTADA sem ninguém saber — ajuste os dois para o mesmo número.`,
    };
}

/**
 * 🚨 A CONVERSA ESTÁ SENDO CONDUZIDA POR UMA PESSOA?
 *
 * Esta é a trava que faltava para o dia do corte, e ela nasceu de ler o que
 * aconteceria quando o alcance virar 'todos' — não de um defeito reportado.
 *
 * O bot só age quando a conversa NÃO tem fila (`!conversa.fila`), e "sem
 * fila" foi lido, até aqui, como "está na triagem". **Não é.** Assumir a
 * conversa (🙋), responder um texto ou mandar um anexo gravam `atribuidoA`
 * e NÃO gravam `fila` — quem grava fila é a triagem do bot ou a
 * transferência. Ou seja: toda conversa que uma pessoa está conduzindo hoje
 * está, para o bot, "na triagem".
 *
 * O efeito no dia em que o alcance virar 'todos' seria este: o cliente
 * responde à colaboradora e recebe, por cima da resposta dela, *"aguarde um
 * momento, logo te atenderemos"* + o menu de 8 opções — e ainda ganharia um
 * protocolo NOVO numa conversa que já estava em andamento. As conversas que
 * já existem no app (as de antes do bot, e as que vierem do backup da Ultra
 * Fox) são exatamente as que têm `fila: null`, então isso não seria caso
 * raro: seria o comportamento padrão do primeiro dia.
 *
 * A régua é o DONO, não a fila: existe alguém conduzindo ⇒ a triagem já
 * acabou, tenha ela passado pelo menu ou não. Conversa **resolvida** solta a
 * trava de propósito — cliente que volta depois de encerrado é atendimento
 * novo, e aí a triagem é o certo.
 */
export function emConducaoHumana(conversa) {
    if (!conversa || typeof conversa !== 'object') return false;
    if ((conversa.status || 'aberta') !== 'aberta') return false;
    return Boolean(conversa.atribuidoA);
}

/** Resposta do cliente casa com uma opção do menu? Aceita "1", "1.", " 1 ". */
export function interpretarEscolha(texto, config) {
    const t = String(texto || '').trim().replace(/[.)]$/, '');
    if (!/^\d{1,2}$/.test(t)) return null;
    const item = (config.menu || []).find((m) => String(m.opcao) === t);
    return item ? { fila: item.fila, rotulo: item.rotulo } : null;
}

// ─── O CÉREBRO: decide as ações do bot pra UMA mensagem recebida ────────────
//
// Entra o estado; sai uma lista de ações pra rota executar:
//   {tipo:'responder', texto}  ·  {tipo:'definirFila', fila}
//   {tipo:'gravarProtocolo', protocolo}  ·  {tipo:'marcarAusenciaEnviada'}
//   {tipo:'resetarTriagem'}
export function decidirAutomacao({ conversa = {}, numero, textoMensagem, nomeContato, config, agora = new Date(), protocoloNovo }) {
    const acoes = [];
    if (!config?.botAtivo) return acoes;             // desligado = silêncio total
    // Fora do alcance = silêncio TOTAL, igual a desligado. É o que permite
    // testar o bot com a Ultra Fox de pé sem cliente nenhum ver menu em dobro.
    if (!botAlcancaNumero(config, numero)) return acoes;
    const texto = String(textoMensagem || '').trim();

    // #sair: o CLIENTE encerra o próprio atendimento — a triagem reseta, a
    // conversa fica resolvida (encerradaPor 'cliente') e, com a pesquisa
    // ligada, a nota é pedida na sequência (a janela está aberta: ele acabou
    // de escrever).
    if (/^#?sair$/i.test(texto)) {
        acoes.push({ tipo: 'resetarTriagem' });
        acoes.push({ tipo: 'resolverConversa', por: 'cliente' });
        acoes.push({ tipo: 'responder', texto: config.mensagens.sair });
        if (config.avaliacaoAtiva) {
            acoes.push({ tipo: 'responder', texto: config.mensagens.avaliacao });
            acoes.push({ tipo: 'marcarAguardandoAvaliacao' });
        }
        return acoes;
    }

    // #menu reapresenta o menu em QUALQUER estado — é assim que o CLIENTE pede
    // outro departamento sozinho: a triagem reseta e a escolha seguinte
    // re-roteia. Comando EXPLÍCITO de propósito: numa conversa já triada, um
    // "2" solto é resposta ao atendente ("quantas parcelas? 2"), nunca menu.
    if (/^#?menu$/i.test(texto)) {
        acoes.push({ tipo: 'resetarTriagem' });
        // Pedir o menu no meio de um atendimento é o cliente dizendo que quer
        // OUTRO departamento. Manter o dono anterior deixaria a conversa na
        // fila nova com atendente da fila velha — o mesmo estado torto que a
        // transferência evita limpando a atribuição.
        acoes.push({ tipo: 'liberarConducao' });
        acoes.push({ tipo: 'responder', texto: montarTextoMenu(config) });
        return acoes;
    }

    const dentro = dentroDoHorario(config.horario, agora);
    const hojeSp = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(agora);

    // Conversa SEM fila E SEM dono = está na triagem. Com dono, quem conduz é
    // gente: o bot não saúda, não mostra menu e não define fila por cima.
    if (!conversa.fila && !emConducaoHumana(conversa)) {
        const escolha = interpretarEscolha(texto, config);
        if (escolha) {
            acoes.push({ tipo: 'definirFila', fila: escolha.fila });
            // Imagem ANTES do texto — é a ordem que a Ultra Fox usa (a arte
            // do departamento, depois o "aguarde"). Fila sem imagem
            // cadastrada pula esta ação, sem falha nem substituto genérico.
            const imagem = config.imagensPorFila?.[escolha.fila];
            if (imagem) acoes.push({ tipo: 'enviarImagem', url: imagem, fila: escolha.fila });
            acoes.push({ tipo: 'responder', texto: renderMensagem(config.mensagens.confirmacaoFila, { fila: escolha.rotulo }) });
        } else {
            // 1º contato ganha protocolo + saudação; sempre reapresenta o menu.
            if (!conversa.protocolo && protocoloNovo) {
                acoes.push({ tipo: 'gravarProtocolo', protocolo: protocoloNovo });
                acoes.push({
                    tipo: 'responder',
                    texto: renderMensagem(config.mensagens.saudacao, { nome: nomeContato || 'Olá', protocolo: protocoloNovo }),
                });
            }
            acoes.push({ tipo: 'responder', texto: montarTextoMenu(config) });
        }
    }

    // Fora do horário: avisa UMA vez por dia por conversa (anti-metralhadora).
    // Este SEGUE valendo com a conversa em condução humana, de propósito: não
    // é o bot tomando a conversa, é o cliente sabendo que ninguém vai
    // responder às 22h — calar aqui faria ele esperar resposta a noite toda.
    if (!dentro && conversa.ausenciaAvisadaEm !== hojeSp) {
        acoes.push({ tipo: 'responder', texto: config.mensagens.foraDeHorario });
        acoes.push({ tipo: 'marcarAusenciaEnviada', dia: hojeSp });
    }

    return acoes;
}
