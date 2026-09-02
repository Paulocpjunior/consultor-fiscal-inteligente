// ============================================================================
// sefaz-backend/sae-nfce-cancelamento.js  (PURO)
// ----------------------------------------------------------------------------
// "Esta NFC-e está cancelada?" — perguntando ao SAE-NFC-e da SEFAZ-SP.
//
// 🚨 O CASO (02/09, Paulo): *"NFC-E 1194 da empresa 0065 — ARMAZEM DE BICHOS
// está cancelada e ela aparece com valor no consultor; dei o botão reconferir e
// continua com o valor"*, com o id do evento na mão
// (`ID110111` + chave + `01`, ou seja tpEvento **110111 = cancelamento**).
//
// 🔴 **A CAUSA É ESTRUTURAL, e foi MEDIDA no código — não é o botão falhando:**
//
//  1. **A captura de NFC-e pergunta UMA VEZ e nunca mais.** O dedup do
//     `sefaz-sp-nfce-orchestrator` é por EXISTÊNCIA
//     (`if (snap.exists && temItens !== false) jaCompletas++`), então nota já
//     baixada **nunca é rebaixada**. E o cancelamento acontece SEMPRE DEPOIS da
//     autorização — por definição, só se cancela o que foi autorizado. Ou seja:
//     o trilho é cego ao cancelamento por construção, dê o SAE o que der.
//     É a fila da reconferência que não andava (20/08) um trilho adiante.
//
//  2. **O leitor do download descartava tudo que não fosse `<nfeProc>`** —
//     corrigido no mesmo PR (`eventosXml` no `parseDownload`).
//
//  3. **O botão "Reconferir" da tela é do MODELO 55 e DIZ isso**: a própria
//     tela do Paulo mostra *"132 nota(s) ficaram de fora por não serem NF-e
//     (modelo 55) — este webservice só consulta modelo 55"*. Ele não está
//     quebrado; ele está RECUSANDO, com a frase certa. Clicar de novo nunca
//     ia resolver — e é por isso que a saída não é insistir nele, é ter o
//     caminho do modelo 65.
//
// ✂️ **QUEM DECIDE O QUE A RESPOSTA SIGNIFICA CONTINUA SENDO O DONO ÚNICO**
// (`lerRespostaCancelamento`, do `reconferir-cancelamento.js`): este módulo só
// ADAPTA a resposta do SAE para a forma que ele lê. Escrever um segundo leitor
// aqui faria a mesma nota ser julgada de dois jeitos — o defeito que esta casa
// mais paga —, e ele já conhece o evento 110111 com cStat 135/155, o formato
// legado e a disciplina de corroborar pelo TEXTO, nunca só pelo número.
// ============================================================================

import { lerRespostaCancelamento } from './reconferir-cancelamento.js';

/**
 * Recorta os EVENTOS do corpo da resposta do SAE.
 *
 * 📌 Mora AQUI, e não no cliente, porque o `sefaz-sp-nfce-client.js` usa
 * `import.meta` (bundle de CA) e **não carrega no jest** — régua dentro de
 * módulo que o teste não carrega é régua sem prova (a lição do E116 e do
 * `rotina-empresa-insumo`). O cliente IMPORTA daqui.
 *
 * 🚨 A ORDEM É A RÉGUA, e ela foi medida contra o print do Paulo (02/09):
 * `retEvento` — que carrega o cStat da HOMOLOGAÇÃO — é **IRMÃO** de `evento`,
 * não filho. Um recorte `<evento>…</evento>` traz o pedido ASSINADO e deixa o
 * protocolo de fora; aí o leitor vê o `tpEvento 110111` sem cStat nenhum e a
 * nota era liberada como válida. Por isso: embrulho completo > par
 * evento+retEvento > evento solto.
 */
export function recortarEventos(body) {
    const texto = String(body || '');
    return texto.match(/<procEventoNFe[\s>][\s\S]*?<\/procEventoNFe>/gi)
        || texto.match(/<evento[\s>][\s\S]*?<\/retEvento>/gi)
        || texto.match(/<evento[\s>][\s\S]*?<\/evento>/gi)
        || [];
}

/**
 * QUAL evento veio — contador sozinho não diz nada.
 *
 * Foi o print de 02/09 que provou: a tela mostrou `eventos: 1` ao lado de
 * *"nenhum evento de cancelamento"*, e não havia como saber o que tinha vindo.
 */
export function resumirEventos(eventosXml) {
    return (Array.isArray(eventosXml) ? eventosXml : []).map((ev) => ({
        tpEvento: (ev.match(/<tpEvento>\s*(\d+)\s*<\/tpEvento>/) || [])[1] || null,
        cStat: (ev.match(/<cStat>\s*(\d+)\s*<\/cStat>/) || [])[1] || null,
        dhEvento: (ev.match(/<dhRegEvento>\s*([^<]+)/) || [])[1]
            || (ev.match(/<dhEvento>\s*([^<]+)/) || [])[1] || null,
        nProt: (ev.match(/<nProt>\s*(\d+)\s*<\/nProt>/) || [])[1] || null,
        xMotivo: (ev.match(/<xMotivo>\s*([^<]+)/) || [])[1] || null,
    }));
}

/**
 * Adapta a resposta do `baixarXmlNFCe` para a forma que o dono lê:
 * `{ cStat, xMotivo, xmls: [{ xml }] }`.
 *
 * ⚠️ Os EVENTOS vêm PRIMEIRO na lista de propósito: o dono varre em ordem
 * procurando `<tpEvento>110111`, e a autorizada (`nfeProc`) não carrega evento
 * nenhum — pôr a autorizada na frente não muda o veredito, mas deixa a leitura
 * dependente da ordem, que é o tipo de acerto por acidente que envelhece mal.
 */
export function respostaSaeParaLeitura(dl) {
    if (!dl) return { erro: 'Sem resposta do SAE-NFC-e.' };
    const xmls = [];
    for (const ev of (Array.isArray(dl.eventosXml) ? dl.eventosXml : [])) {
        if (ev) xmls.push({ xml: String(ev) });
    }
    if (dl.nfeProcXml) xmls.push({ xml: String(dl.nfeProcXml) });
    return { cStat: dl.cStat || null, xMotivo: dl.xMotivo || null, xmls };
}

// A frase do `indeterminado` do dono fala do trilho DELE (DistDFe): *"pode ser
// certificado sem autorização para este CNPJ ou UF diferente"*. No SAE isso é
// FALSO — o certificado é o do PRÓPRIO emitente (o serviço exige que a chave
// pertença a ele) e não existe escolha de UF. Manter aquela frase aqui mandaria
// procurar no lugar errado, que é justamente o defeito que este módulo nasceu
// para corrigir. **A SITUAÇÃO continua sendo a do dono**; o que muda é só a
// frase do trilho, e ela vai declarada.
const MOTIVO_INDETERMINADO_SAE = 'O SAE-NFC-e não devolveu nem o XML autorizado nem evento para esta chave. '
    + 'Não dá para concluir nada sobre cancelamento — a resposta do órgão vai inteira acima. '
    + 'ATENÇÃO: este webservice pode simplesmente NÃO contar cancelamento (ele existe para entregar a '
    + 'autorizada); se for o caso, a resposta aqui é a prova disso, e o caminho passa a ser trazer o XML '
    + 'do evento de cancelamento por outro meio.';

/**
 * Lê a resposta do SAE-NFC-e e devolve a MESMA forma de veredito das NF-e:
 * `{ situacao, cStat, evento?, motivo }`.
 */
export function lerCancelamentoNfce(dl) {
    const r = lerRespostaCancelamento(respostaSaeParaLeitura(dl));
    if (r.situacao === 'indeterminado' && dl && !dl.erro) {
        return { ...r, motivo: MOTIVO_INDETERMINADO_SAE };
    }
    return r;
}

/**
 * A chave diz o MODELO (posições 21-22) — e a chave não mente.
 *
 * ⚠️ Recusar modelo ≠ 65 aqui é o espelho da recusa que a tela já faz do outro
 * lado (o webservice de mod 55 recusa a NFC-e): perguntar ao SAE por uma NF-e
 * mod 55 devolveria um "não achei" que se leria como "a nota não existe".
 */
export function conferirChaveNfce(chave) {
    const ch = String(chave || '').replace(/\D/g, '');
    if (ch.length !== 44) {
        return { ok: false, motivo: `Chave inválida: são 44 dígitos, recebi ${ch.length}.` };
    }
    const modelo = ch.substring(20, 22);
    if (modelo !== '65') {
        return {
            ok: false,
            modelo,
            motivo: `Esta chave é do modelo ${modelo}, não NFC-e (65). O SAE-NFC-e só responde por modelo 65 — `
                + 'para NF-e (55) use a reconferência de cancelamento da aba 🚫.',
        };
    }
    return { ok: true, chave: ch, modelo, cnpjEmitente: ch.substring(6, 20) };
}

/**
 * O id do EVENTO carrega a chave: `ID` + tpEvento(6) + chave(44) + nSeq(2).
 *
 * 📌 Isto existe porque foi ASSIM que o dono trouxe o caso — ele tinha o id do
 * evento, não a chave. Pedir a chave de volta seria devolver a ele um recorte
 * que o app sabe fazer (a régua de 02/09: quando o app tem como saber a
 * resposta, perguntar não é entrega).
 */
export function chaveDoIdDeEvento(idEvento) {
    const limpo = String(idEvento || '').trim().replace(/^ID/i, '').replace(/\D/g, '');
    if (limpo.length < 50) return null;
    const chave = limpo.substring(6, 50);
    return chave.length === 44 ? chave : null;
}

/**
 * Aceita o que a pessoa colar: chave de 44 dígitos OU id de evento.
 * Devolve `{ ok, chave, origem }` — a ORIGEM vai junto porque ela muda o que
 * a tela pode afirmar: o id de evento já DIZ que houve um evento; a chave
 * sozinha não diz nada.
 */
export function entradaParaChave(texto) {
    const cru = String(texto || '').trim();
    const soDigitos = cru.replace(/\D/g, '');
    if (soDigitos.length === 44) {
        const c = conferirChaveNfce(soDigitos);
        return c.ok ? { ok: true, chave: c.chave, origem: 'chave' } : { ok: false, motivo: c.motivo };
    }
    const daId = chaveDoIdDeEvento(cru);
    if (daId) {
        const c = conferirChaveNfce(daId);
        return c.ok
            ? { ok: true, chave: c.chave, origem: 'id-de-evento', tpEvento: soDigitos.substring(0, 6) }
            : { ok: false, motivo: c.motivo };
    }
    return {
        ok: false,
        motivo: 'Não reconheci a entrada: cole a CHAVE de 44 dígitos da NFC-e ou o ID do evento '
            + '(ID + 6 dígitos de tipo + 44 da chave + 2 de sequência).',
    };
}
