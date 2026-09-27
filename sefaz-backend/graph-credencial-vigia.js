// ============================================================================
// sefaz-backend/graph-credencial-vigia.js  (casca de I/O + frase PURA)
// ----------------------------------------------------------------------------
// 🛡️ O MATA-BURRO DA CREDENCIAL DO E-MAIL (Paulo, 24/09: "pode travar e
// passar o mata-burros! isso não pode voltar a acontecer").
//
// O que aconteceu: o segredo do app *Notificacoes* ficou com o Secret ID
// (36 bytes) no lugar do Value, e ninguém soube até uma guia falhar na mão
// da Sandra — porque o próprio alerta noturno de saúde sai POR E-MAIL, pela
// mesma credencial. Credencial morta = alerta mudo.
//
// O vigia sonda a credencial TODO DIA (dentro do cron noturno, ANTES de
// tentar mandar o alerta), grava o veredito num doc que a tela lê
// (`health_alertas/graph-email`) e a Rotina do Mês mostra uma faixa vermelha
// para TODO MUNDO enquanto durar — não depende de e-mail para avisar.
//
// ⚠️ Sonda ≠ envio: pede o token à Microsoft e mostra a resposta. Não manda
// mensagem a ninguém. Invalida o cache antes, senão responderia "ok" sobre a
// credencial antiga por até 1 h.
// ============================================================================

import { isGraphConfigured, getGraphToken, invalidarTokenGraph } from './graph-provider.js';
import { vereditoDaCredencialDeEmail } from './graph-credencial-sonda.js';
import { formaDoClientSecret } from './forma-do-segredo.js';

export const COLECAO_VIGIA = 'health_alertas';
export const DOC_VIGIA = 'graph-email';

/** Sonda a credencial agora. Nunca lança: o veredito é o produto. */
export async function sondarCredencialGraph(env = process.env) {
    const testadoEm = new Date().toISOString();
    const forma = formaDoClientSecret(env.GRAPH_CLIENT_SECRET);
    const base = { testadoEm, appId: env.GRAPH_CLIENT_ID || null, forma: { forma: forma.forma, caracteres: forma.caracteres, ehProblema: forma.ehProblema, diagnostico: forma.diagnostico } };
    if (!isGraphConfigured()) {
        return { ...vereditoDaCredencialDeEmail({ ok: false, configurado: false }), ...base };
    }
    invalidarTokenGraph();
    try {
        await getGraphToken();
        return { ...vereditoDaCredencialDeEmail({ ok: true, configurado: true }), ...base };
    } catch (e) {
        return {
            ...vereditoDaCredencialDeEmail({ ok: false, configurado: true, erro: e.message }),
            ...base,
            respostaMicrosoft: String(e?.message || '').slice(0, 600),
        };
    }
}

/**
 * Sonda e GRAVA o veredito, guardando desde quando falha (`primeiraFalhaEm`)
 * e a última vez que passou (`ultimoOkEm`) — "recusada há 3 dias" diz mais
 * que "recusada".
 */
export async function vigiarCredencialGraph(db, env = process.env) {
    const v = await sondarCredencialGraph(env);
    const ref = db.collection(COLECAO_VIGIA).doc(DOC_VIGIA);
    let anterior = null;
    try { const s = await ref.get(); anterior = s.exists ? s.data() : null; } catch { anterior = null; }
    const doc = {
        ...v,
        primeiraFalhaEm: v.situacao === 'ok' ? null : (anterior?.situacao && anterior.situacao !== 'ok' && anterior?.primeiraFalhaEm ? anterior.primeiraFalhaEm : v.testadoEm),
        ultimoOkEm: v.situacao === 'ok' ? v.testadoEm : (anterior?.ultimoOkEm || null),
    };
    try { await ref.set(doc, { merge: false }); } catch (e) { console.warn('[vigia-graph] não gravou o veredito:', e.message); }
    if (v.situacao !== 'ok') {
        console.error(`[VIGIA-GRAPH] credencial do e-mail ${v.situacao.toUpperCase()} — ${v.titulo} ${v.onde ? `Onde: ${v.onde}` : ''}`);
    }
    return doc;
}

const dataBr = (iso) => {
    const d = new Date(iso || '');
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

/**
 * A faixa que a tela mostra (PURA). `null` quando não há o que dizer.
 * Vigia velho (sem sondar há > 2 dias) também acende: silêncio não é saúde.
 */
export function faixaDoVigia(doc, agoraMs = Date.now()) {
    if (!doc) return { cor: 'amarelo', titulo: 'A credencial do e-mail ainda não foi sondada.', detalhe: 'O vigia noturno não rodou nenhuma vez — o app não sabe se o envio de guia por e-mail funciona. Use "Testar credencial do e-mail" em Diagnóstico → Configurações Operacionais.', desde: null };
    const idade = agoraMs - Date.parse(doc.testadoEm || '');
    if (doc.situacao === 'ok') {
        if (Number.isFinite(idade) && idade > 2 * 24 * 60 * 60 * 1000) {
            return { cor: 'amarelo', titulo: `A credencial do e-mail não é sondada desde ${dataBr(doc.testadoEm)}.`, detalhe: 'O vigia noturno parou de rodar — confira o Cloud Scheduler do health-alerta-cron. Até lá, "ok" é a leitura de antes.', desde: doc.testadoEm };
        }
        return null;
    }
    return {
        cor: 'vermelho',
        titulo: `${doc.titulo || 'A Microsoft recusou a credencial do e-mail.'} Nenhuma guia sai por e-mail pelo app${doc.primeiraFalhaEm ? ` desde ${dataBr(doc.primeiraFalhaEm)}` : ''}.`,
        detalhe: (doc.onde ? `Onde corrigir: ${doc.onde}` : (doc.detalhe || ''))
            + (doc.forma?.ehProblema ? ` Forma do segredo gravado: ${doc.forma.diagnostico}` : '')
            + ' Enquanto isso, "Abrir no Outlook Web" envia pela sua caixa.',
        desde: doc.primeiraFalhaEm || doc.testadoEm,
    };
}
