// ============================================================================
// sefaz-backend/graph-credencial-sonda.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 "JÁ TÍNHAMOS MATADO ONTEM A QUESTÃO DO E-MAIL" — e não dava para conferir.
//
// 02/09, Paulo. Ontem a credencial do **SharePoint** foi corrigida, e ela está
// mesmo funcionando (hoje o proxy listou sites e pastas). Mas o e-mail é OUTRO
// aplicativo do Azure, e o único jeito de descobrir isso era **mandar uma guia
// a um cliente e ver falhar** — foi assim que a Sandra descobriu.
//
// 🔴 **E O NOME DA VARIÁVEL É O MESMO NOS DOIS LUGARES**, que é o que faz
// "matar um" parecer ter matado os dois:
//
//   · `GRAPH_CLIENT_SECRET` do **proxy** (`consultor-fiscal-proxy`), vindo do
//     Secret Manager `graph-client-secret:latest` → app **a876887f…** →
//     SharePoint;
//   · `GRAPH_CLIENT_SECRET` do **serviço do CFI**
//     (`consultor-fiscal-inteligente`) → app **59fd4ec9…** → ENVIO DE E-MAIL.
//
// Mesmo nome, dois serviços, dois aplicativos. Renovar um não conserta o outro.
//
// ✂️ A sonda é a régua da casa aplicada ao e-mail: **validação por RESULTADO,
// nunca por status**. Ela PEDE o token à Microsoft e devolve o que ela
// respondeu — sem enviar mensagem a ninguém. É o mesmo desenho do `checkAuth()`
// que o proxy ganhou hoje, e do "PVA de bolso": perguntar antes de doer.
// ============================================================================

import { appDaCredencial, instrucaoDaCredencial } from './sharepoint-erro-credencial.js';

/**
 * Traduz o resultado de um pedido de token em algo com AÇÃO.
 *
 * ⚠️ Recebe o RESULTADO, nunca faz I/O: quem chama a Microsoft é a casca. É o
 * que permite provar as quatro situações sem rede.
 *
 * @param {{ ok: boolean, configurado: boolean, erro?: string }} r
 */
export function vereditoDaCredencialDeEmail(r) {
    const { ok, configurado, erro } = r || {};

    // ⚠️ "Não configurado" é OUTRO problema, com outra ação: falta preencher,
    // não foi recusado. Fundir os dois manda procurar no Azure quando o que
    // falta é a variável.
    if (!configurado) {
        return {
            situacao: 'nao-configurado',
            cor: 'vermelho',
            titulo: 'As credenciais do e-mail não estão preenchidas.',
            detalhe: 'Faltam GRAPH_CLIENT_ID, GRAPH_TENANT_ID ou GRAPH_CLIENT_SECRET no serviço '
                + 'consultor-fiscal-inteligente (Cloud Run). Enquanto isso, nenhum e-mail sai pelo app.',
            app: null,
            onde: null,
        };
    }

    if (ok) {
        return {
            situacao: 'ok',
            cor: 'verde',
            titulo: 'A Microsoft aceitou a credencial do e-mail.',
            detalhe: 'O token saiu. Isto prova a CREDENCIAL — não prova que a caixa do remetente '
                + 'existe nem que a mensagem chegou ao cliente.',
            app: null,
            onde: null,
        };
    }

    const msg = String(erro || '');
    const { id, nome, onde } = appDaCredencial(msg);
    return {
        situacao: 'recusada',
        cor: 'vermelho',
        titulo: 'A Microsoft RECUSOU a credencial do e-mail — nenhum e-mail sai pelo app.',
        // A causa vem do DONO: uma segunda leitura aqui divergiria da que o
        // card do SharePoint mostra para a MESMA resposta.
        detalhe: instrucaoDaCredencial(msg) || msg,
        // 🚨 O ID vem da RESPOSTA, não de uma lista minha: é ele que separa o
        // app do e-mail do app do SharePoint, e foi confundi-los que fez
        // "matamos ontem" valer para um só.
        app: id ? { id, nome } : null,
        onde: onde || null,
    };
}
