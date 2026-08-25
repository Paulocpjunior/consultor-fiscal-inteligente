// ============================================================================
// sefaz-backend/whatsapp-chamadas.js — chamada de VOZ/VÍDEO no WhatsApp
// ----------------------------------------------------------------------------
// Pergunta do Paulo (16/08): *"como habilitar ou não a opção de ligação de
// voz/vídeo, já liberado pela Meta Brasil"*.
//
// 🚨 ESTE MÓDULO NÃO LIGA NADA. Ele SONDA e RELATA — e isso é decisão de
// desenho, não falta de trabalho:
//
//  (1) **Payload de API externa não se deduz.** É a lição que o MSG_ISN_023
//      (PGDAS-D sem movimento) e o MS0030 (R-2055) cobraram caro: leiaute
//      deduzido é aceito errado ou recusado inteiro. Aqui a fonte responde —
//      a sonda pergunta e mostra o CRU do que não souber nomear.
//
//  (2) **Ligar chamada muda o WhatsApp DO CLIENTE.** Habilitado, aparece o
//      botão de ligar na conversa dele, do lado do escritório. Se ninguém
//      atender do nosso lado, o cliente liga e **chama no vazio** — e a
//      leitura dele não é "o recurso está desligado", é "a SP não me atende".
//      Isso é pior que não ter o botão. Por isso ligar é decisão do Paulo,
//      com destino de atendimento definido ANTES.
//
// A régua de sempre: **indeterminado nunca vira "desligado"**. Rede que
// piscou não pode fazer alguém concluir que o recurso não existe na conta.
// ============================================================================

/**
 * Onde a chamada pode estar declarada. São CANDIDATOS — a sonda pergunta os
 * dois e relata o que cada um respondeu, em vez de cravar um caminho e
 * concluir "não existe" quando o caminho é que estava errado.
 */
export const CANDIDATOS_SONDA = [
    {
        id: 'settings',
        rotulo: 'Configurações do número (settings)',
        caminho: (phoneNumberId) => `${phoneNumberId}/settings`,
        hipotese: 'A Meta expõe a chamada como uma configuração DO NÚMERO.',
    },
    {
        id: 'campo-do-numero',
        rotulo: 'Campos do próprio número',
        caminho: (phoneNumberId) => `${phoneNumberId}?fields=id,display_phone_number,verified_name,status,quality_rating`,
        hipotese: 'A chamada aparece entre os campos do número (e serve de controle: se ESTE falhar, o problema é o token, não o recurso).',
    },
];

const LIGADO = /^(enabled|enable|true|on|ativo)$/i;
const DESLIGADO = /^(disabled|disable|false|off|inativo)$/i;

/** Acha, em profundidade, qualquer chave que fale de chamada (calling/call). */
export function acharBlocoDeChamada(corpo) {
    const achados = [];
    const visitar = (no, caminho) => {
        if (!no || typeof no !== 'object') return;
        for (const [k, v] of Object.entries(no)) {
            const aqui = caminho ? `${caminho}.${k}` : k;
            if (/^(calling|call_settings|calls?)$/i.test(k)) achados.push({ caminho: aqui, valor: v });
            if (v && typeof v === 'object') visitar(v, aqui);
        }
    };
    visitar(corpo, '');
    return achados;
}

/**
 * Interpreta UMA resposta da Meta. Situações possíveis:
 *  - `ligado` / `desligado`  → a conta respondeu sobre a chamada;
 *  - `nao-declarado`         → respondeu, e não há bloco de chamada (a conta
 *                              não expõe o recurso por este caminho);
 *  - `sem-permissao`         → o token não alcança (ação: permissão, não recurso);
 *  - `indeterminado`         → rede/erro. NUNCA vira "desligado".
 */
export function interpretarSondaChamadas(status, corpo) {
    if (status == null) {
        return { situacao: 'indeterminado', motivo: 'A sonda não obteve resposta da Meta.', acao: 'Tente de novo; se persistir, é rede ou o token expirou.', bruto: corpo ?? null };
    }
    if (status === 401 || status === 403) {
        return {
            situacao: 'sem-permissao',
            motivo: corpo?.error?.message || `A Meta recusou a consulta (HTTP ${status}).`,
            acao: 'O token precisa da permissão de gestão da conta (whatsapp_business_management). Isso não diz nada sobre a chamada estar ligada ou não.',
            bruto: corpo ?? null,
        };
    }
    if (status >= 400) {
        return {
            situacao: 'indeterminado',
            motivo: corpo?.error?.message || `HTTP ${status}`,
            acao: 'Erro na consulta — não dá pra afirmar que a chamada está desligada.',
            bruto: corpo ?? null,
        };
    }

    const blocos = acharBlocoDeChamada(corpo);
    if (!blocos.length) {
        return {
            situacao: 'nao-declarado',
            motivo: 'A Meta respondeu, e não veio nenhum campo de chamada por este caminho.',
            acao: 'Pode ser que a conta não tenha o recurso, ou que ele se declare em outro lugar — a resposta crua está abaixo.',
            bruto: corpo ?? null,
        };
    }

    // Achou o bloco: procura o estado DENTRO dele, sem inventar o nome do campo.
    for (const b of blocos) {
        const v = b.valor;
        const candidatos = typeof v === 'object' && v
            ? Object.entries(v).filter(([k]) => /status|enabled|state/i.test(k)).map(([, x]) => x)
            : [v];
        for (const c of candidatos) {
            const s = String(c);
            if (LIGADO.test(s)) return { situacao: 'ligado', campo: b.caminho, motivo: `A Meta diz que a chamada está LIGADA (${b.caminho} = ${s}).`, bruto: corpo };
            if (DESLIGADO.test(s)) return { situacao: 'desligado', campo: b.caminho, motivo: `A Meta diz que a chamada está DESLIGADA (${b.caminho} = ${s}).`, bruto: corpo };
        }
    }
    return {
        situacao: 'nao-reconhecido',
        campo: blocos[0].caminho,
        motivo: `Veio um bloco de chamada (${blocos[0].caminho}), mas o formato não é um que eu saiba ler.`,
        acao: 'A resposta crua está abaixo — é dela que sai a régua, e não de suposição.',
        bruto: corpo,
    };
}

/**
 * Junta as respostas dos candidatos numa conclusão. Uma resposta AFIRMATIVA
 * (ligado/desligado) manda; sem nenhuma, o veredito é o mais informativo, e
 * nunca "desligado" por omissão.
 */
export function concluirSonda(resultados = []) {
    const achou = resultados.find((r) => r.situacao === 'ligado' || r.situacao === 'desligado');
    if (achou) {
        return {
            veredito: achou.situacao,
            motivo: achou.motivo,
            respondeuPor: achou.candidato || achou.campo || null,
        };
    }
    if (resultados.some((r) => r.situacao === 'nao-reconhecido')) {
        const r = resultados.find((x) => x.situacao === 'nao-reconhecido');
        return { veredito: 'nao-reconhecido', motivo: r.motivo, acao: r.acao, respondeuPor: r.candidato || null };
    }
    if (resultados.some((r) => r.situacao === 'sem-permissao')) {
        const r = resultados.find((x) => x.situacao === 'sem-permissao');
        return { veredito: 'sem-permissao', motivo: r.motivo, acao: r.acao };
    }
    if (resultados.length && resultados.every((r) => r.situacao === 'nao-declarado')) {
        return {
            veredito: 'nao-declarado',
            motivo: 'Os dois caminhos responderam e nenhum trouxe campo de chamada.',
            acao: 'Confira no Gerenciador de WhatsApp da Meta se a chamada aparece para esta conta. A resposta crua de cada caminho está na tela.',
        };
    }
    return {
        veredito: 'indeterminado',
        motivo: 'Nenhum caminho respondeu de forma conclusiva.',
        acao: 'Não dá pra afirmar que a chamada está desligada — repita a sonda.',
    };
}

/**
 * O que o Paulo precisa saber ANTES de ligar. Não é aviso legal: é o efeito
 * que a decisão tem no cliente, e ele não aparece em lugar nenhum da tela da
 * Meta.
 */
// ============================================================================
// CONFIGURAÇÃO DA CHAMADA (Paulo, 23/08: caminho 1 — SIP → HitPhone; e a
// regra: *"as ligações devem obedecer os mesmos horários das mensagens"*).
//
// ESTE MÓDULO CONTINUA SEM I/O: aqui só nascem os PAYLOADS e as conferências.
// Quem escreve na Meta é a rota `/chamadas/configurar` — admin, com a
// consequência escrita antes do clique, nunca efeito de diagnóstico.
//
// DUAS DECISÕES DE DESENHO:
//  · O horário NÃO é uma segunda grade: `montarCallHoursDoAtendimento` PROJETA
//    o `config.horario` do atendimento (o mesmo que decide o `foraDeHorario`
//    das mensagens) para o formato da Meta. Duas grades divergiriam em
//    silêncio — "mensagem responde e ligação não" é a leitura dupla de sempre.
//  · O formato da ESCRITA ainda não foi provado contra resposta real da Meta
//    (a régua do payload-não-se-deduz). Por isso a rota RE-LÊ as settings
//    depois de gravar e devolve o que a Meta GUARDOU — a conferência é por
//    RESULTADO (`conferirCallHours`), e recusa da Meta volta CRUA na tela.
// ============================================================================

const FUSO_CHAMADAS = 'America/Sao_Paulo';
const DIAS_META = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** "HH:MM" → "HHMM" da Meta. null se ilegível — horário não recebe default. */
function horaMeta(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    const h = Number(m[1]); const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, '0')}${m[2]}`;
}

/**
 * Projeta o horário do ATENDIMENTO (dias + turnos, o dono das mensagens) para
 * o `call_hours` da Meta. Turno ilegível RECUSA a projeção inteira — grade
 * meio-projetada abriria a chamada em horário que a mensagem não atende.
 */
export function montarCallHoursDoAtendimento(horario) {
    const dias = (horario?.dias || []).map(Number).filter((d) => d >= 0 && d <= 6);
    const turnos = Array.isArray(horario?.turnos) ? horario.turnos : [];
    if (!dias.length || !turnos.length) {
        return { ok: false, erro: 'O horário das mensagens está sem dias ou sem turnos — confira a aba 🤖 Bot e mensagens antes de aplicar à chamada.' };
    }
    const weekly = [];
    for (const d of [...new Set(dias)].sort((a, b) => a - b)) {
        for (const t of turnos) {
            const abre = horaMeta(t.inicio); const fecha = horaMeta(t.fim);
            if (!abre || !fecha || fecha <= abre) {
                return { ok: false, erro: `Turno ilegível no horário das mensagens ("${t.inicio}"–"${t.fim}") — corrija lá; a chamada não recebe grade deduzida.` };
            }
            weekly.push({ day_of_week: DIAS_META[d], open_time: abre, close_time: fecha });
        }
    }
    return {
        ok: true,
        callHours: { status: 'ENABLED', timezone_id: FUSO_CHAMADAS, weekly_operating_hours: weekly },
    };
}

/**
 * Valida o destino SIP que o admin digita (a resposta do HitPhone). Recusa
 * com o motivo — tronco torto gravado na Meta é chamada caindo no nada.
 */
export function validarSipDestino(entrada) {
    const hostname = String(entrada?.hostname || '').trim().toLowerCase();
    if (!hostname) return { ok: false, erro: 'Informe o hostname SIP que o HitPhone passar (ex.: sip.empresa.com.br).' };
    if (/[\s/@:]|^-|\.$/.test(hostname) || !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(hostname)) {
        return { ok: false, erro: `Hostname SIP inválido: "${entrada?.hostname}" — só o nome do servidor, sem esquema (sip:// ou https://), porta ou espaços.` };
    }
    const porta = Number(entrada?.porta);
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
        return { ok: false, erro: 'Informe a porta SIP que o HitPhone passar (com TLS costuma ser 5061).' };
    }
    return { ok: true, hostname, porta };
}

/**
 * Monta o payload da escrita — SÓ com o pedaço pedido. A rota re-lê depois:
 * se a semântica do POST for de substituição (e não merge) e algo sumir, isso
 * aparece na leitura de volta, nunca fica invisível.
 */
export function montarPayloadChamadas(mudanca = {}) {
    const calling = {};
    if (mudanca.callHours) calling.call_hours = mudanca.callHours;
    if (typeof mudanca.iconeVisivel === 'boolean') {
        calling.call_icon_visibility = mudanca.iconeVisivel ? 'DEFAULT' : 'DISABLE_ALL';
    }
    if (mudanca.sip) {
        calling.sip = { status: 'ENABLED', servers: [{ hostname: mudanca.sip.hostname, port: mudanca.sip.porta }] };
    }
    if (!Object.keys(calling).length) return { ok: false, erro: 'Nenhuma mudança pedida.' };
    return { ok: true, payload: { calling } };
}

/** O bloco `calling` de uma resposta de settings (ou null, dito). */
export function lerCallingDasSettings(corpo) {
    const blocos = acharBlocoDeChamada(corpo);
    const b = blocos.find((x) => /(^|\.)calling$/i.test(x.caminho));
    return b && typeof b.valor === 'object' ? b.valor : null;
}

/**
 * Conferência por RESULTADO: o que a Meta GUARDOU × a projeção do horário das
 * mensagens. É ela que denuncia grade defasada (alguém mudou o horário do
 * atendimento e não reaplicou aqui) — a Meta não lê nossa config sozinha.
 */
export function conferirCallHours(callingGravado, horario) {
    const proj = montarCallHoursDoAtendimento(horario);
    if (!proj.ok) return { situacao: 'horario-ilegivel', motivo: proj.erro };
    const gravado = callingGravado?.call_hours;
    if (!gravado || !Array.isArray(gravado.weekly_operating_hours)) {
        return { situacao: 'sem-call-hours', motivo: 'A Meta não tem horário de chamada gravado — hoje o botão do cliente vale 24h.' };
    }
    const chave = (w) => `${String(w.day_of_week).toUpperCase()}|${w.open_time}|${w.close_time}`;
    const meta = new Set(gravado.weekly_operating_hours.map(chave));
    const nosso = new Set(proj.callHours.weekly_operating_hours.map(chave));
    const faltam = [...nosso].filter((k) => !meta.has(k));
    const sobram = [...meta].filter((k) => !nosso.has(k));
    const fusoDiverge = gravado.timezone_id && gravado.timezone_id !== FUSO_CHAMADAS;
    if (!faltam.length && !sobram.length && !fusoDiverge) {
        return { situacao: 'igual', motivo: 'O horário da chamada na Meta é o MESMO das mensagens.' };
    }
    const detalhes = [];
    if (fusoDiverge) detalhes.push(`fuso gravado ${gravado.timezone_id} ≠ ${FUSO_CHAMADAS}`);
    if (faltam.length) detalhes.push(`faltam na Meta: ${faltam.join(', ')}`);
    if (sobram.length) detalhes.push(`sobram na Meta: ${sobram.join(', ')}`);
    return {
        situacao: 'diverge',
        motivo: `O horário da chamada DIVERGE do das mensagens (${detalhes.join(' · ')}). Reaplique aqui — a regra da casa é uma grade só.`,
    };
}

/**
 * 🚨 O QUE A META TEM LIGADO — os interruptores que o painel NÃO lia.
 *
 * Estado em 25/08: SBC provado de pé (TLS, certificado público, SIP 200 OK),
 * ícone visível, horário conferido, tronco "gravado" — e a ligação recusada
 * DENTRO da janela, às 09:15, com "SP Assessoria não pode receber ligações do
 * WhatsApp".
 *
 * O painel afirmava "✅ Tronco gravado na Meta" olhando SÓ para
 * `sip.servers[]` existir. Mas guardar o endereço do servidor NÃO é o SIP
 * estar LIGADO: `calling.status` e `sip.status` são interruptores próprios, e
 * nenhum dos dois aparecia na tela. A escrita manda `status: 'ENABLED'` e
 * ninguém RE-LIA se a Meta guardou ligado — é status passando por resultado
 * dentro do nosso próprio painel de diagnóstico, que é a primeira regra
 * permanente deste projeto invertida mais uma vez.
 *
 * ⚠️ AUSENTE NÃO É LIGADO. Campo que a Meta não declara vira
 * 'nao-declarado', nunca ENABLED por otimismo: foi assumir o que não foi
 * medido que fez este painel ficar verde enquanto o cliente ouvia "não pode
 * receber ligações".
 */
export function lerEstadoDaChamada(calling) {
    const c = calling && typeof calling === 'object' ? calling : null;
    const ler = (v) => (v === undefined || v === null || v === '' ? 'nao-declarado' : String(v).toUpperCase());
    const estado = {
        chamada: ler(c?.status),
        sip: ler(c?.sip?.status),
        icone: ler(c?.call_icon_visibility),
        horarios: ler(c?.call_hours?.status),
        servidores: Array.isArray(c?.sip?.servers) ? c.sip.servers.length : 0,
    };
    const impedimentos = [];
    if (!c) {
        impedimentos.push({
            campo: 'calling', motivo: 'A Meta não devolveu bloco de chamada nenhum para este número.',
            acao: 'Rode a sonda de novo; se persistir, o número pode não ter a chamada habilitada na conta.',
        });
    } else {
        if (estado.chamada !== 'ENABLED') {
            impedimentos.push({
                campo: 'calling.status',
                motivo: `A CHAMADA do número está "${estado.chamada}" na Meta — enquanto isso, toda ligação é recusada com "não pode receber ligações do WhatsApp".`,
                acao: 'Habilite a chamada no WhatsApp Manager (Números → o número → Ligações).',
            });
        }
        // Servidor gravado com o SIP desligado é exatamente o caso que faz o
        // painel parecer pronto: o endereço está lá e ninguém atende por ele.
        if (estado.servidores > 0 && estado.sip !== 'ENABLED') {
            impedimentos.push({
                campo: 'sip.status',
                motivo: `O servidor SIP está gravado, mas o SIP está "${estado.sip}" — endereço guardado NÃO é tronco ligado.`,
                acao: 'Clique em 📞 Cadastrar tronco SIP de novo: a escrita manda status ENABLED junto.',
            });
        }
        if (estado.servidores === 0) {
            impedimentos.push({
                campo: 'sip.servers',
                motivo: 'Nenhum servidor SIP gravado — a ligação não tem para onde ir.',
                acao: 'Cadastre o tronco (hostname + porta) na aba ☎️.',
            });
        }
        if (estado.icone === 'DISABLE_ALL') {
            impedimentos.push({
                campo: 'call_icon_visibility',
                motivo: 'O botão ☎️ está OCULTO para os clientes.',
                acao: 'Mostre o botão na aba ☎️ (mas só depois de haver quem atenda).',
            });
        }
    }
    return { estado, impedimentos, ok: impedimentos.length === 0 };
}

// ============================================================================
// EVENTOS DE CHAMADA NO WEBHOOK (Paulo, 23/08 — "pode seguir"): a ligação
// recebida/perdida vira LINHA NA CONVERSA do Connect, senão o cliente liga e
// ninguém fica sabendo que ligou.
//
// 🚨 O leiaute do webhook `calls` NÃO está provado contra evento real (nenhuma
// chamada chegou ainda). Por isso o extrator é TOLERANTE e leva o CRU junto de
// cada evento: o que ele não souber ler fica NOMEADO (`ilegiveis`), nunca
// descartado calado — é do primeiro evento real que sai a régua definitiva.
// ============================================================================

function tsChamadaParaIso(t) {
    const n = Number(t) * (String(t || '').length > 11 ? 1 : 1000);
    return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

/** Tradução best-effort do evento — desconhecido fica como veio, visível. */
export function traduzirEventoChamada(evento) {
    const mapa = {
        connect: 'conectada', connected: 'conectada', accept: 'atendida', accepted: 'atendida',
        terminate: 'encerrada', terminated: 'encerrada', ended: 'encerrada',
        ringing: 'tocando', missed: 'perdida', rejected: 'recusada', reject: 'recusada',
        failed: 'falhou', no_answer: 'não atendida', unanswered: 'não atendida',
    };
    const e = String(evento || '').toLowerCase();
    return mapa[e] || (e || 'evento');
}

/**
 * Extrai os eventos de CHAMADA do payload do webhook (field "calls"). Devolve
 * { valido, chamadas[], ilegiveis[] } — cada chamada com o bruto junto.
 */
export function extrairEventosChamada(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (p.object !== 'whatsapp_business_account') return { valido: false, chamadas: [], ilegiveis: [] };
    const chamadas = [];
    const ilegiveis = [];
    for (const entry of (Array.isArray(p.entry) ? p.entry : [])) {
        for (const change of (Array.isArray(entry?.changes) ? entry.changes : [])) {
            const value = change?.value || {};
            const lista = Array.isArray(value.calls) ? value.calls : [];
            // Aceita pelo FIELD ou pela presença do array — a Meta pode nomear
            // o field de um jeito que ainda não vimos; o array é a substância.
            if (change?.field !== 'calls' && !lista.length) continue;
            const phoneNumberId = value.metadata?.phone_number_id || null;
            for (const c of lista) {
                const bruto = c && typeof c === 'object' ? c : { valor: c };
                const callId = bruto.id ? String(bruto.id) : null;
                if (!callId) { ilegiveis.push(bruto); continue; } // sem id não há idempotência
                const direcaoCrua = String(bruto.direction || '').toUpperCase();
                const deNegocio = direcaoCrua.includes('BUSINESS');
                // O CLIENTE é o outro lado: na chamada que ELE inicia, é o from;
                // na que NÓS iniciamos, é o to. Sem direção legível, from.
                const clienteCru = deNegocio ? (bruto.to ?? bruto.from) : (bruto.from ?? bruto.to);
                const cliente = String(clienteCru || '').replace(/\D/g, '') || null;
                if (!cliente) { ilegiveis.push(bruto); continue; }
                const duracao = Number(bruto.duration ?? bruto.session?.duration);
                chamadas.push({
                    callId,
                    conversaId: cliente,
                    direcao: deNegocio ? 'saida' : 'entrada',
                    evento: String(bruto.event ?? bruto.status ?? '').toLowerCase() || null,
                    duracaoSegundos: Number.isFinite(duracao) && duracao > 0 ? duracao : null,
                    timestamp: tsChamadaParaIso(bruto.timestamp),
                    phoneNumberId,
                    bruto,
                });
            }
        }
    }
    return { valido: true, chamadas, ilegiveis };
}

/** A linha que aparece na conversa. */
export function resumoDaChamada(c) {
    const lado = c.direcao === 'saida' ? 'para o cliente' : 'do cliente';
    const dur = c.duracaoSegundos
        ? ` · ${Math.floor(c.duracaoSegundos / 60)}m${String(c.duracaoSegundos % 60).padStart(2, '0')}s` : '';
    return `☎️ Ligação de WhatsApp ${lado} — ${traduzirEventoChamada(c.evento)}${dur}`;
}

export const ANTES_DE_LIGAR = [
    {
        titulo: 'O botão aparece no WhatsApp DO CLIENTE',
        texto: 'Habilitada, a chamada fica disponível na conversa dele, do lado do escritório. Não é um recurso só nosso: é uma porta que se abre para fora.',
    },
    {
        titulo: 'Chamada sem quem atenda é pior que chamada nenhuma',
        texto: 'Se o cliente liga e ninguém atende, a leitura dele não é "o recurso está desligado" — é "a SP não me atende". Antes de ligar, é preciso definir QUEM atende, em qual horário, e o que acontece fora dele.',
    },
    {
        titulo: 'O SP Connect hoje não é um telefone',
        texto: 'O painel atende mensagem, não chamada de voz. Ligar a chamada na Meta sem um destino que toque (HitPhone, ramal, celular do plantão) faz o telefone tocar no vazio.',
    },
    {
        titulo: 'Ligar e desligar não é neutro',
        texto: 'Cliente que já usou o botão e o encontra sumido entende como serviço retirado. A decisão vale mais tomada uma vez, com o destino pronto, do que testada e revertida.',
    },
];

// ═══ ☎️ PERMISSÃO DE LIGAÇÃO (fase 2 — a SAÍDA) ═════════════════════════════
// Regra da Meta: a EMPRESA só pode ligar para o cliente depois que ELE
// autorizar — o pedido chega como um cartão "Permitir" na conversa do
// WhatsApp dele, e a autorização vale por período limitado. Sem ela a Meta
// recusa a chamada de saída. (Paulo, 24/08: "pode construir o botão".)

/**
 * ☎️ Corpo da CHAMADA DE SAÍDA — a empresa liga para o cliente.
 *
 * 🚨 A PONTE COM O QUE JÁ EXISTE: no modo SIP quem toca o telefone do
 * colaborador é a PRÓPRIA Meta — ela recebe este pedido, chama o cliente e
 * entrega a perna de voz no NOSSO tronco (o mesmo `sip.spassessoriacontabil
 * .com.br:5061` da entrada), que já disca o ramal 221 no HitPhone. Ou seja:
 * a saída reaproveita o caminho provado da entrada, e não existe segundo
 * tronco a configurar.
 *
 * ⚠️ SEM SDP de propósito: SDP é a descrição de mídia de quem faz a ponte de
 * voz — no modo SIP quem faz é o nosso SBC, via INVITE da Meta. Mandar um SDP
 * inventado daqui descreveria uma ponte que este servidor não abre.
 *
 * ⚠️ E O LEIAUTE NÃO ESTÁ PROVADO: a recusa da Meta volta CRUA na tela (é o
 * desenho do tronco e do pedido de permissão) — quem ensina o campo que falta
 * é a resposta dela, nunca a minha memória.
 */
export function montarChamadaParaCliente(numero) {
    return {
        messaging_product: 'whatsapp',
        to: numero,
        action: 'connect',
    };
}

/** Corpo do pedido de permissão (interactive/call_permission_request). */
export function montarPedidoPermissaoLigacao(numero) {
    return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: numero,
        type: 'interactive',
        interactive: {
            type: 'call_permission_request',
            action: { name: 'call_permission_request' },
        },
    };
}

/**
 * Lê a RESPOSTA do cliente no webhook de mensagem (interactive/
 * call_permission_reply). Tolerante de propósito — o leiaute ainda não foi
 * provado contra resposta real, então o BRUTO viaja junto e qualquer coisa
 * fora da forma volta null (a mensagem entra como interactive comum, nunca
 * some). `expiration_timestamp` chega em SEGUNDOS (convenção dos webhooks
 * da Meta); só 'accept' vale como aceite — o resto é recusa.
 */
export function respostaDePermissaoLigacao(m) {
    if (m?.type !== 'interactive') return null;
    const i = m.interactive;
    if (i?.type !== 'call_permission_reply') return null;
    const r = i.call_permission_reply || {};
    const exp = Number(r.expiration_timestamp);
    return {
        resposta: String(r.response || '').toLowerCase() === 'accept' ? 'aceita' : 'recusada',
        expiraEm: Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : null,
        bruto: i,
    };
}

/** A linha legível que entra na conversa quando a resposta chega. */
export function resumoDaPermissao(p) {
    if (!p) return null;
    return p.resposta === 'aceita'
        ? '✅ O cliente AUTORIZOU ligações de WhatsApp'
        : '🚫 O cliente recusou ligações de WhatsApp';
}
