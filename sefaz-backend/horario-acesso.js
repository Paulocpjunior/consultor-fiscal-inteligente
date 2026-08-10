// ============================================================================
// sefaz-backend/horario-acesso.js  (ESM, núcleo PURO)
// ----------------------------------------------------------------------------
// TRAVA DE HORÁRIO DE FUNCIONAMENTO (Paulo, 10/08): define quando cada
// colaborador pode acessar os apps — segurança de uso e segurança jurídica
// (evita hora extra não autorizada, e o registro da tentativa fora do horário
// é a prova de que a pessoa NÃO conseguiu trabalhar fora do expediente).
//
// DECISÕES DO PAULO:
//   · Padrão: TODOS liberados seg–sex 07:00–20:00 (America/São_Paulo).
//   · ADMIN sempre passa — é a válvula de escape (se a régua travar o
//     escritório, o admin entra e conserta/desliga).
//   · Admin cria EXCEÇÕES por colaborador (dias/faixas próprios, ou 24h).
//   · Bloqueio direto (não é modo aviso) — mas ARMADO por env, e o Paulo
//     vira a chave só quando os 5 módulos estiverem cabeados.
//
// SEGURANÇA DA PRÓPRIA TRAVA (o que impede o tiro no pé):
//   · role vem da SESSÃO já autenticada (req.user.role), não de uma leitura
//     nova — admin passa mesmo se o Firestore estiver fora.
//   · Sem exceção configurada = PADRÃO (não é "sem acesso"): a régua conhecida
//     vale sem depender de leitura por usuário.
//   · Config de exceção ilegível NÃO derruba o acesso a mais do que o padrão.
// ============================================================================

const FUSO = 'America/Sao_Paulo';

// Padrão da casa: seg(1)–sex(5), 07:00–20:00. Sáb(6)/Dom(0) fechados.
const PADRAO = {
    dias: [1, 2, 3, 4, 5],
    inicio: '07:00',
    fim: '20:00',
};

const DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "HH:MM" → minutos do dia (0–1439). Retorna null se torto. */
function minutosDoHorario(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
}

/**
 * Dia da semana (0=dom..6=sáb) e minutos do dia de `agora` no fuso de SP —
 * sem depender do fuso do servidor (Cloud Run roda em UTC). Usa Intl, que
 * conhece o horário de verão (embora o Brasil não tenha hoje, fica correto
 * se voltar).
 */
export function momentoEmSaoPaulo(agora = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: FUSO, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const partes = Object.fromEntries(fmt.formatToParts(agora).map((p) => [p.type, p.value]));
    const mapaDia = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const diaSemana = mapaDia[partes.weekday] ?? new Date(agora).getUTCDay();
    let hora = Number(partes.hour);
    if (hora === 24) hora = 0; // Intl às vezes devolve "24" à meia-noite
    const minutos = hora * 60 + Number(partes.minute);
    return { diaSemana, minutos };
}

/**
 * Normaliza uma configuração de horário (a do usuário ou o padrão) para
 * { dias:[int], inicio:min, fim:min, vale24h:bool }. Config torta cai no
 * PADRÃO — nunca em "acesso total" nem em "bloqueado", pra config errada não
 * abrir nem trancar tudo.
 */
export function normalizarConfig(cfg) {
    if (cfg && cfg.vale24h === true) {
        return { dias: [0, 1, 2, 3, 4, 5, 6], inicio: 0, fim: 1439, vale24h: true };
    }
    const base = cfg && typeof cfg === 'object' ? cfg : {};
    const dias = Array.isArray(base.dias) && base.dias.length
        ? base.dias.map(Number).filter((d) => d >= 0 && d <= 6)
        : PADRAO.dias;
    const ini = minutosDoHorario(base.inicio) ?? minutosDoHorario(PADRAO.inicio);
    const fim = minutosDoHorario(base.fim) ?? minutosDoHorario(PADRAO.fim);
    // Faixa invertida (fim < início) é config torta → padrão.
    if (fim <= ini) return normalizarConfig(null);
    return { dias: dias.length ? dias : PADRAO.dias, inicio: ini, fim, vale24h: false };
}

function fmtMin(min) {
    const h = String(Math.floor(min / 60)).padStart(2, '0');
    const m = String(min % 60).padStart(2, '0');
    return `${h}:${m}`;
}

function rotuloJanela(cfg) {
    if (cfg.vale24h) return 'acesso liberado 24h';
    const dias = cfg.dias.slice().sort((a, b) => a - b);
    const nomes = dias.map((d) => DIAS_NOME[d]);
    const seqSemana = dias.length === 5 && dias.every((d, i) => d === i + 1);
    const faixaDias = seqSemana ? 'segunda a sexta' : nomes.join(', ');
    return `${faixaDias}, das ${fmtMin(cfg.inicio)} às ${fmtMin(cfg.fim)}`;
}

/**
 * Decide se o usuário pode acessar AGORA.
 *
 * @param {object} user  { role, email, horarioAcesso? } — role da SESSÃO.
 * @param {object} [opts]
 *   · agora: Date (default now)
 *   · ativo: bool — a chave-mestra (env HORARIO_ACESSO_ATIVO). Quando false,
 *     SEMPRE libera (a trava está montada mas não armada). Default false.
 * @returns {{ permitido, motivo, janela, liberaProximo?, ehAdmin }}
 */
export function decidirAcessoHorario(user, opts = {}) {
    const ativo = opts.ativo === true;
    const agora = opts.agora || new Date();

    // Trava desarmada: tudo passa (mas o resultado diz que está desarmada, pra
    // telemetria não confundir com "dentro do horário").
    if (!ativo) {
        return { permitido: true, motivo: 'trava-desarmada', janela: null, ehAdmin: user?.role === 'admin' };
    }
    // Admin sempre passa — válvula de escape, e vem da sessão (não relê nada).
    if (user && user.role === 'admin') {
        return { permitido: true, motivo: 'admin', janela: null, ehAdmin: true };
    }

    const cfg = normalizarConfig(user && user.horarioAcesso);
    const { diaSemana, minutos } = momentoEmSaoPaulo(agora);
    const dentroDoDia = cfg.dias.includes(diaSemana);
    const dentroDaFaixa = cfg.vale24h || (minutos >= cfg.inicio && minutos <= cfg.fim);
    const janela = rotuloJanela(cfg);

    if (dentroDoDia && dentroDaFaixa) {
        return { permitido: true, motivo: 'dentro-do-horario', janela, ehAdmin: false };
    }

    // Bloqueado — a mensagem DIZ quando libera (farol honesto: não adianta
    // barrar sem dizer o horário permitido).
    let porque;
    if (!dentroDoDia) {
        porque = DIAS_NOME[diaSemana].charAt(0).toUpperCase() + DIAS_NOME[diaSemana].slice(1)
            + ' está fora dos dias de acesso';
    } else if (minutos < cfg.inicio) {
        porque = `ainda não abriu (abre às ${fmtMin(cfg.inicio)})`;
    } else {
        porque = `o expediente já encerrou (fechou às ${fmtMin(cfg.fim)})`;
    }
    return {
        permitido: false,
        motivo: 'fora-do-horario',
        janela,
        porque,
        mensagem: `Acesso fora do horário permitido — ${porque}. Seu acesso é ${janela}. `
            + 'Se precisar de exceção, fale com um administrador.',
        ehAdmin: false,
    };
}

/** A chave-mestra: env liga o bloqueio. Default DESARMADO (montado, não armado). */
export function travaArmada(env = process.env) {
    return String(env.HORARIO_ACESSO_ATIVO || '').trim().toLowerCase() === 'bloqueio';
}

export const _internals = { PADRAO, minutosDoHorario, rotuloJanela, FUSO };
