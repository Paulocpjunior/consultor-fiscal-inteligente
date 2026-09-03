// ============================================================================
// sefaz-backend/debito-ja-enviado.js   (PURO — sem io, testável)
//
// ESTE DÉBITO JÁ FOI COBRADO DO CLIENTE NESTA COMPETÊNCIA?
//
// 🚨 POR QUE EXISTE (Paulo, 17/08, autorizando depois do caso HYPE CAFE): o app
// passou a AVISAR que o DARF unificado mistura departamentos, mas a trava ainda
// dependia de o outro departamento LEMBRAR. E não dá para depender de memória:
//
//   · o DARF unificado da DCTFWeb é UMA obrigação do CNPJ, alimentada por TRÊS
//     departamentos (Fiscal/MIT, DP/eSocial, Contábil/Reinf);
//   · a receita PREVIDENCIÁRIA não tem guia avulsa — o 1082 só sai dentro do
//     unificado, que carrega PIS/COFINS de novo;
//   · logo, em todo cliente com folha E faturamento no mesmo mês existe um
//     caminho em que o mesmo débito vai duas vezes ao cliente.
//
// A régua é: **o débito é a unidade, não a guia.** Duas guias diferentes que
// carregam o mesmo `código+extensão` na mesma competência são a MESMA cobrança.
//
// ─── O QUE ESTE MÓDULO NÃO FAZ ──────────────────────────────────────────────
//
// Não decide se pode reenviar. Reenvio LEGÍTIMO existe e é comum: o cliente
// perdeu o e-mail, a declaração foi retificada, o valor mudou. Então o módulo
// NOMEIA a repetição com quem enviou, quando, por qual canal e por quanto — e
// quem decide é a pessoa, com justificativa escrita (o mesmo desenho da trava
// T3 da DCTFWeb, 12/08: bloqueio puro faz a equipe contornar).
//
// ⚠️ E CANAL QUE NÃO PROVA ENVIO VAI MARCADO. Pela regra de 05/08 só
// `email-graph` e `whatsapp-api` provam que saiu; `email-app` (mailto/Outlook
// Web) só abriu a composição. Tratar os dois igual faria o app barrar um
// primeiro envio de verdade por causa de uma janela que alguém abriu e fechou.
// ============================================================================

/** `1082` + extensão `01` → `1082-01`. Sem extensão, só o código. */
export function chaveDebito(d) {
    const cod = String(d?.codigo || d?.codReceita || '').replace(/\D/g, '');
    if (!cod) return null;
    const ext = String(d?.extensao ?? '').replace(/\D/g, '');
    return ext ? `${cod}-${ext}` : cod;
}

/** As chaves de uma guia, sem repetir. */
export function chavesDaGuia(debitos = []) {
    const out = [];
    for (const d of debitos || []) {
        const k = chaveDebito(d);
        if (k && !out.includes(k)) out.push(k);
    }
    return out;
}

/** Canais que PROVAM que a mensagem saiu (regra de 05/08). */
const CANAL_COM_PROVA = new Set(['email-graph', 'whatsapp-api']);

export function canalProvaEnvio(canal) {
    return CANAL_COM_PROVA.has(String(canal || '').trim());
}

// `Number(null)` é 0: débito SEM valor ficava gravado como R$ 0,00 na trava do
// débito repetido. Ausência é null.
const dinheiro = (n) => ((n == null || n === '') ? null : (Number.isFinite(Number(n)) ? Number(n) : null));

/**
 * Cruza a guia que está prestes a sair com o que JÁ foi enviado.
 *
 * @param {object} p
 * @param {Array} p.debitosDaGuia   débitos do DARF atual ({codigo, extensao, valor})
 * @param {Array} p.enviosAnteriores registros de `impostos_enviados` da MESMA
 *   competência e do MESMO CNPJ, cada um com `{debitos[], canal, enviadoPor,
 *   enviadoEm, tipo}`. Registro antigo SEM `debitos` não é ignorado em silêncio.
 * @param {string} [p.logIdAtual] pula o próprio registro num reenvio.
 */
export function conferirDebitosJaEnviados({ debitosDaGuia = [], enviosAnteriores = [], logIdAtual = null } = {}) {
    const daGuia = new Map();
    for (const d of debitosDaGuia || []) {
        const k = chaveDebito(d);
        if (k) daGuia.set(k, { chave: k, descricao: String(d?.descricao || '').trim(), valor: dinheiro(d?.valor) });
    }

    const repetidos = [];
    // Envio antigo que não guardou a composição: ele PODE conter estes débitos e
    // não dá para saber. Some da conta seria dizer "nunca foi enviado", que é a
    // afirmação que dobra a cobrança — então vira ressalva NOMEADA.
    const semComposicao = [];

    for (const env of enviosAnteriores || []) {
        if (!env || (logIdAtual && env.id === logIdAtual)) continue;
        const chaves = chavesDaGuia(env.debitos);
        if (!chaves.length) {
            semComposicao.push({
                id: env.id || null,
                tipo: env.tipo || null,
                canal: env.canal || null,
                enviadoPor: env.enviadoPor || null,
                enviadoEm: env.enviadoEm || null,
                prova: canalProvaEnvio(env.canal),
            });
            continue;
        }
        for (const k of chaves) {
            if (!daGuia.has(k)) continue;
            const antes = (env.debitos || []).find((d) => chaveDebito(d) === k);
            const agora = daGuia.get(k);
            repetidos.push({
                chave: k,
                descricao: agora.descricao || String(antes?.descricao || '').trim(),
                valorAgora: agora.valor,
                valorAntes: dinheiro(antes?.valor),
                // Valor diferente é sinal de RETIFICAÇÃO — reenvio provavelmente
                // legítimo. O app diz os dois números; não escolhe.
                valorMudou: agora.valor != null && dinheiro(antes?.valor) != null
                    && Math.abs(agora.valor - dinheiro(antes?.valor)) > 0.005,
                canal: env.canal || null,
                prova: canalProvaEnvio(env.canal),
                enviadoPor: env.enviadoPor || null,
                enviadoEm: env.enviadoEm || null,
                tipo: env.tipo || null,
                logId: env.id || null,
            });
        }
    }

    return {
        repetidos,
        semComposicao,
        /** Há débito repetido COM prova de envio? É o caso mais duro. */
        temRepetidoComProva: repetidos.some((r) => r.prova),
        /** Bloqueia o envio automático — a pessoa ainda pode seguir com motivo. */
        bloqueia: repetidos.length > 0,
        /** Não deu para afirmar nada sobre um envio anterior. */
        incerto: semComposicao.length > 0,
    };
}

const brl = (n) => (n == null ? '—' : `R$ ${Number(n).toFixed(2).replace('.', ',')}`);

const quando = (v) => {
    if (!v) return 'data não registrada';
    try {
        const d = typeof v === 'string' ? new Date(v) : (v.toDate ? v.toDate() : new Date(v));
        if (Number.isNaN(d.getTime())) return 'data não registrada';
        return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return 'data não registrada'; }
};

/**
 * A frase que a pessoa lê antes de decidir. Diz O QUE repete, QUEM mandou,
 * QUANDO, e se o canal PROVA que saiu.
 */
export function avisoDeRepeticao(conferencia) {
    if (!conferencia) return null;
    if (!conferencia.bloqueia && !conferencia.incerto) return null;

    if (!conferencia.bloqueia) {
        const n = conferencia.semComposicao.length;
        return {
            titulo: 'Não dá para afirmar que este débito nunca foi enviado',
            texto: `Há ${n} envio(s) desta competência gravado(s) ANTES de o app passar a guardar `
                + 'quais débitos foram na guia. Pode ser que já tenham incluído estes códigos.',
            acao: 'Confira com o outro departamento antes de enviar — a partir de agora o app registra a composição '
                + 'e passa a barrar sozinho.',
            severidade: 'atencao',
        };
    }

    const linhas = conferencia.repetidos.map((r) => {
        const canal = r.prova
            ? `${r.canal} (com prova de envio)`
            : `${r.canal || 'canal não registrado'} — este canal NÃO prova que a mensagem saiu`;
        const valor = r.valorMudou
            ? `antes ${brl(r.valorAntes)}, agora ${brl(r.valorAgora)} — o valor MUDOU (retificação?)`
            : brl(r.valorAgora);
        return `• ${r.chave}${r.descricao ? ` ${r.descricao}` : ''} · ${valor} · enviado por `
            + `${r.enviadoPor || 'não registrado'} em ${quando(r.enviadoEm)} · ${canal}`;
    });

    return {
        titulo: conferencia.temRepetidoComProva
            ? 'ESTE DÉBITO JÁ FOI ENVIADO AO CLIENTE'
            : 'Este débito já teve um envio registrado',
        texto: `A guia carrega débito(s) que já saíram nesta competência:\n${linhas.join('\n')}`,
        acao: conferencia.temRepetidoComProva
            ? 'Enviar de novo cobra o cliente DUAS VEZES pelo mesmo débito. Só siga se for reenvio '
              + 'proposital (cliente perdeu a guia, ou a declaração foi retificada) — e diga o motivo, '
              + 'que fica gravado com o seu nome.'
            : 'O canal anterior não prova que a mensagem saiu, então pode ser que o cliente nunca tenha '
              + 'recebido. Confirme antes de reenviar, e diga o motivo.',
        severidade: conferencia.temRepetidoComProva ? 'erro' : 'atencao',
    };
}
