// ============================================================================
// sefaz-backend/envio-fora-do-app.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 📋 REGISTRAR UM ENVIO QUE ACONTECEU FORA DO APP.
//
// ═══ O CASO QUE O CRIOU (Paulo, 27/08, AC MASON) ════════════════════════════
//
// *"Essa empresa é só aluguel, a obrigação já foi entregue e as guias enviadas
// para o cliente — como atualizar para ficar verde?"* — e a resposta era: não
// dava. A etapa 5 da Rotina só fecha com o rito #293 (cópia no SharePoint +
// baixa da obrigação), o fim de mês **BLOQUEIA**, e reenviar pelo app
// DUPLICARIA a guia no cliente. A empresa ficava travada por um trabalho que
// já tinha sido feito.
//
// ═══ ISTO NÃO FURA A REGRA "NADA SE MARCA À MÃO" ════════════════════════════
//
// A régua fundadora da Rotina é *"nada aqui marca como feito na mão: se a etapa
// não tem prova, ela não está concluída"*. O que muda aqui não é isso — é QUEM
// é a prova.
//
// A casa já separa os dois mundos desde 05/08 (`canalComprovaEnvio`):
// **`email-graph` PROVA** (o servidor enviou e a cópia está em Itens Enviados);
// **mailto e WhatsApp NÃO provam** — o app só abriu a composição, quem clicou
// em Enviar foi a pessoa. E esses dois SEMPRE fecharam a etapa.
//
// Ou seja: a etapa 5 nunca exigiu prova de ENTREGA. Ela exige o RITO. O que
// este módulo acrescenta é um envio cujo rito se cumpre com o que existe —
// e uma DECLARAÇÃO assinada por alguém, com data e com o meio escrito.
//
// É o desenho do bloqueio da T3 da DCTFWeb e da reabertura do fim de mês:
// **motivo escrito, com autor e data, gravado**. Trava sem caminho é trava que
// a equipe contorna — e aqui o contorno seria pior que o registro: mandar a
// guia de novo ao cliente.
//
// ═══ O QUE ELE NUNCA AFIRMA ═════════════════════════════════════════════════
//
// O canal é `fora-do-app`, e `canalComprovaEnvio` devolve **false** para ele
// por construção. Então o envio entra em `semProvaDeEnvio` no painel do rito, e
// o carimbo do fim de mês registra que aquela guia não tem prova de saída. O
// mês fecha; a ressalva fica.
// ============================================================================

/** Piso do texto livre — o mesmo da T3 da DCTFWeb e da reabertura. */
export const MOTIVO_MINIMO = 15;

export const CANAL_FORA_DO_APP = 'fora-do-app';

/**
 * Os meios que a equipe de fato usa. É lista FECHADA de propósito: "outro"
 * existe, mas obriga a escrever qual — senão o campo vira um balde onde tudo
 * cai e a auditoria não responde nada depois.
 */
export const MEIOS_FORA_DO_APP = Object.freeze([
    { id: 'email-pessoal', label: 'E-mail de outra caixa (fora do app)' },
    { id: 'whatsapp-pessoal', label: 'WhatsApp pessoal / do escritório' },
    { id: 'portal-cliente', label: 'Portal ou sistema do próprio cliente' },
    { id: 'impresso', label: 'Entregue impresso / em mãos' },
    { id: 'outro', label: 'Outro meio (escreva qual)' },
]);

const ehData = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/**
 * Confere a declaração ANTES de gravar.
 *
 * @param {object} p
 * @param {string} p.meio      um dos `MEIOS_FORA_DO_APP`
 * @param {string} p.comoFoi   texto livre — o que a pessoa declara
 * @param {string} p.quando    'AAAA-MM-DD' — o dia em que a guia saiu
 * @param {string} p.quem      e-mail/uid de quem declara
 * @param {string} [p.hojeIso] 'AAAA-MM-DD' (para o teste; default = hoje)
 * @returns {{ok: true, declaracao: object} | {ok: false, erro: string}}
 */
export function conferirDeclaracao({ meio, comoFoi, quando, quem, hojeIso } = {}) {
    const m = String(meio || '').trim();
    if (!MEIOS_FORA_DO_APP.some((x) => x.id === m)) {
        return { ok: false, erro: 'Escolha por qual meio a guia foi enviada ao cliente.' };
    }

    const texto = String(comoFoi || '').trim();
    // ⚠️ O TEXTO É OBRIGATÓRIO, e o piso não é burocracia: é o que faz a
    // auditoria responder "como esta guia chegou ao cliente?" daqui a três
    // meses. Sem ele, a declaração vira um clique — e clique fácil é o que
    // transforma exceção em rotina.
    if (texto.length < MOTIVO_MINIMO) {
        return {
            ok: false,
            erro: `Descreva como a guia chegou ao cliente (mínimo ${MOTIVO_MINIMO} caracteres) — `
                + 'é o que responde a pergunta daqui a três meses.',
        };
    }

    if (!ehData(quando)) {
        return { ok: false, erro: 'Informe a data em que a guia foi enviada (AAAA-MM-DD).' };
    }
    // ⚠️ DATA NO FUTURO É RECUSADA: declarar um envio que ainda não aconteceu
    // fecharia o mês sobre trabalho não feito. Data no PASSADO é legítima — é
    // justamente o caso (a guia saiu antes de alguém registrar).
    const hoje = ehData(hojeIso) ? String(hojeIso) : new Date().toISOString().slice(0, 10);
    if (String(quando) > hoje) {
        return { ok: false, erro: 'A data do envio está no futuro — declare um envio que já aconteceu.' };
    }

    const autor = String(quem || '').trim();
    // Declaração sem autor é declaração de ninguém, e é justamente o autor que
    // a torna aceitável no lugar da prova do servidor.
    if (!autor) return { ok: false, erro: 'Sessão sem usuário — saia e entre de novo para declarar o envio.' };

    return {
        ok: true,
        declaracao: {
            meio: m,
            meioLabel: MEIOS_FORA_DO_APP.find((x) => x.id === m).label,
            comoFoi: texto.slice(0, 600),
            quando: String(quando),
            declaradoPor: autor,
        },
    };
}

/**
 * A frase que a auditoria e o carimbo guardam.
 *
 * Ela DIZ que não há prova — quem ler o histórico daqui a um ano precisa saber
 * disso sem ter que conhecer a régua dos canais.
 */
export function textoDaDeclaracao(d) {
    if (!d) return '';
    const [a, m, dia] = String(d.quando || '').split('-');
    const data = a && m && dia ? `${dia}/${m}/${a}` : String(d.quando || '');
    return `Envio DECLARADO por ${d.declaradoPor} — ${d.meioLabel} em ${data}. `
        + `"${d.comoFoi}". O app NÃO enviou esta guia e não tem prova de entrega.`;
}
