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

/**
 * Filas que um usuário ENXERGA. `filas` = filas de atendimento atribuídas
 * (users.filasAtendimento); sem atribuição, os departamentos de MÓDULO valem
 * como fila (os 5 ids coincidem de propósito). Devolve null = TODAS.
 */
export function filasVisiveis({ role, departamentos = [], filasAtendimento = [] }) {
    if (role === 'admin') return null;
    const minhas = (filasAtendimento.length ? filasAtendimento : departamentos)
        .map((d) => String(d || '').trim().toLowerCase())
        .filter((d) => IDS_FILAS.has(d));
    if (minhas.includes('recepcao')) return null; // Recepção atende todos
    return [...new Set([...minhas, 'recepcao'])]; // a própria + Recepção (triagem)
}

/** Conversa é visível? `fila` null = ainda na Recepção. */
export function conversaVisivel(filasDoUsuario, filaDaConversa) {
    if (filasDoUsuario === null) return true;
    return filasDoUsuario.includes(filaDaConversa || 'recepcao');
}

// ─── Config do atendimento ──────────────────────────────────────────────────

/** Primeiro valor da config — TUDO editável na ⚙️ do Connect depois. */
export function configPadraoAtendimento() {
    return {
        botAtivo: false,   // NASCE DESLIGADO — dois bots no mesmo cliente é menu em dobro
        // Aviso ao CLIENTE quando um atendente transfere a conversa de fila.
        // Também nasce desligado: é o admin que decide quando a casa quer
        // falar isso — e só sai com a janela de 24h aberta (regra da Meta).
        avisarClienteTransferencia: false,
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
        },
        // Menu numérico → fila. Espelha o menu de 8 opções em uso hoje.
        menu: FILAS_ATENDIMENTO.map((f, i) => ({ opcao: String(i + 1), fila: f.id, rotulo: f.rotulo })),
    };
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
        avisarClienteTransferencia: typeof gravada.avisarClienteTransferencia === 'boolean'
            ? gravada.avisarClienteTransferencia : p.avisarClienteTransferencia,
        horario: gravada.horario && Array.isArray(gravada.horario.turnos) ? gravada.horario : p.horario,
        mensagens: { ...p.mensagens, ...(gravada.mensagens || {}) },
        menu: menuGravado.length ? menuGravado : p.menu,
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
export function decidirAutomacao({ conversa = {}, textoMensagem, nomeContato, config, agora = new Date(), protocoloNovo }) {
    const acoes = [];
    if (!config?.botAtivo) return acoes;             // desligado = silêncio total
    const texto = String(textoMensagem || '').trim();

    // #sair encerra a triagem em qualquer estado.
    if (/^#?sair$/i.test(texto)) {
        acoes.push({ tipo: 'resetarTriagem' });
        acoes.push({ tipo: 'responder', texto: config.mensagens.sair });
        return acoes;
    }

    // #menu reapresenta o menu em QUALQUER estado — é assim que o CLIENTE pede
    // outro departamento sozinho: a triagem reseta e a escolha seguinte
    // re-roteia. Comando EXPLÍCITO de propósito: numa conversa já triada, um
    // "2" solto é resposta ao atendente ("quantas parcelas? 2"), nunca menu.
    if (/^#?menu$/i.test(texto)) {
        acoes.push({ tipo: 'resetarTriagem' });
        acoes.push({ tipo: 'responder', texto: montarTextoMenu(config) });
        return acoes;
    }

    const dentro = dentroDoHorario(config.horario, agora);
    const hojeSp = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(agora);

    // Conversa ainda SEM fila = está na triagem.
    if (!conversa.fila) {
        const escolha = interpretarEscolha(texto, config);
        if (escolha) {
            acoes.push({ tipo: 'definirFila', fila: escolha.fila });
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
    if (!dentro && conversa.ausenciaAvisadaEm !== hojeSp) {
        acoes.push({ tipo: 'responder', texto: config.mensagens.foraDeHorario });
        acoes.push({ tipo: 'marcarAusenciaEnviada', dia: hojeSp });
    }

    return acoes;
}
