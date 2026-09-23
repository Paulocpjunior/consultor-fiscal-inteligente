// ============================================================================
// diagnostico-config-helper.js  (PURO — sem io/firebase, testavel)
//
// Diagnostica configuracoes operacionais do sistema. Detecta env vars
// faltando que silenciosamente quebram features:
//
//   SERPRO_CONSUMER_KEY/SECRET    DCTFWeb/DAS/DARF/Caixa Postal — todas
//   SERPRO_CONTRATANTE_CNPJ       Procuracao na S&P
//   SEFAZ_CRON_SECRET             Todos os crons de sincronizacao
//   STORAGE_BUCKET                Upload .pfx, XMLs
//   FISCAL_GATEWAY_TOKEN          Endpoint /internal de plano-contas
//   GRAPH_*                       ENVIO DE E-MAIL deste serviço (guia ao
//                                 cliente, alertas, cofre) — NÃO é o SharePoint:
//                                 aquele é OUTRO app do Azure, com credenciais
//                                 próprias no PROXY (02/09).
//
// E modos operacionais (mock vs serpro real):
//   DCTFWEB_MODE / DAS_MODE / DARF_MODE / NFSE_NAC_MODE
//   EMISSAO_BLOQUEADA (kill-switch)
//
// Niveis:
//   critico     feature inteira nao funciona (SERPRO_*, SEFAZ_CRON_SECRET)
//   alto        feature em modo degradado (mock em prod, sem SENTRY)
//   medio       informativo desejavel ausente (CONTADOR_*)
//   informativo configurado via DEFAULT do codigo, nao bloqueia (STORAGE_BUCKET,
//               HEALTH_ALERT_TO). Lista pro admin saber que esta funcionando
//               em fallback mas pode setar valor explicito.
//   ok          tudo configurado
//
// IMPORTANTE: 'defaultRuntime' indica que a chave tem fallback no codigo da
// app — se a env var for vazia, NAO eh bug e nao bloqueia produto. So vira
// 'informativo' pro admin enxergar que pode customizar.
// ============================================================================

import { formaDoClientSecret, segredosDeClientSecret } from './forma-do-segredo.js';

/**
 * Definicao das configs verificadas. Centralizado pra adicionar/remover sem
 * mexer na logica.
 */
export const CONFIGS_MONITORADAS = [
    // ── SERPRO (Integra Contador) — critico
    { chave: 'SERPRO_CONSUMER_KEY', categoria: 'serpro', criticidade: 'critico',
        descricao: 'Consumer key da API Integra Contador',
        impacto: 'DCTFWeb/DAS/DARF/Caixa Postal NÃO funcionam (modo SERPRO)' },
    { chave: 'SERPRO_CONSUMER_SECRET', categoria: 'serpro', criticidade: 'critico',
        descricao: 'Consumer secret da API Integra Contador',
        impacto: 'DCTFWeb/DAS/DARF/Caixa Postal NÃO funcionam (modo SERPRO)' },
    { chave: 'SERPRO_CONTRATANTE_CNPJ', categoria: 'serpro', criticidade: 'critico',
        descricao: 'CNPJ da S&P (contratante das APIs)',
        impacto: 'Procuração eletrônica falha' },
    // ── Crons
    { chave: 'SEFAZ_CRON_SECRET', categoria: 'cron', criticidade: 'critico',
        descricao: 'Secret compartilhado com Cloud Scheduler',
        impacto: 'TODOS os crons noturnos (caixa-postal, DCTFWeb, DAS, NFS-e nac) falham com 403' },
    // ── Storage
    // STORAGE_BUCKET tem default no codigo: '${PROJECT_ID}.firebasestorage.app'
    // (consultorfiscalapp.firebasestorage.app). Sem env var, app usa default
    // e tudo funciona — comprovado: XMLs estao sendo capturados e PDFs
    // subindo normalmente em prod. So marca como informativo pra admin
    // saber que pode trocar de bucket se quiser.
    { chave: 'STORAGE_BUCKET', categoria: 'firebase', criticidade: 'critico',
        defaultRuntime: 'consultorfiscalapp.firebasestorage.app',
        descricao: 'Bucket de armazenamento Firebase',
        impacto: 'Upload de .pfx e download de XMLs falha' },
    // ── E-mail (Microsoft Graph)
    //
    // 🚨 ESTAS TRÊS ESTAVAM CLASSIFICADAS COMO "SHAREPOINT", E ISSO MANDAVA
    // CONSERTAR O APLICATIVO ERRADO (02/09, print do Paulo, no mesmo dia em
    // que ele perguntou DUAS vezes *"o e-mail não tínhamos matado ontem?"*).
    //
    // Medido no código: **neste serviço** (`consultor-fiscal-inteligente`) o
    // `GRAPH_*` é lido por `graph-provider.js` (envio da guia ao cliente),
    // `graph-mail-reader.js` (cofre de e-mail) e `teams-aviso.js` — **nenhum
    // deles é SharePoint**. Quem fala com o SharePoint é o PROXY, que tem as
    // credenciais DELE (app `a876887f…`, Secret Manager `graph-client-secret`).
    //
    // ⚠️ O nome da variável é o MESMO nos dois serviços — é isso que faz
    // "matei ontem" parecer valer para os dois. Um rótulo errado aqui é o
    // achado 18 (21/08) na forma mais cara: a pessoa vai, conserta o que já
    // estava certo, e o e-mail continua morto.
    { chave: 'GRAPH_TENANT_ID', categoria: 'email', criticidade: 'alto',
        descricao: 'Tenant ID do Microsoft Graph (envio de e-mail deste serviço)',
        impacto: 'Nenhum e-mail sai pelo app (guia ao cliente, alertas, cofre de e-mail)' },
    { chave: 'GRAPH_CLIENT_ID', categoria: 'email', criticidade: 'alto',
        descricao: 'Client ID do app de E-MAIL no Azure AD (não é o do SharePoint)',
        impacto: 'Nenhum e-mail sai pelo app (guia ao cliente, alertas, cofre de e-mail)' },
    { chave: 'GRAPH_CLIENT_SECRET', categoria: 'email', criticidade: 'alto',
        descricao: 'Client secret do app de E-MAIL no Azure AD — o do SharePoint é OUTRO, e mora no proxy',
        impacto: 'Nenhum e-mail sai pelo app (guia ao cliente, alertas, cofre de e-mail). '
            + 'Grave em GRAPH_CLIENT_SECRET do serviço consultor-fiscal-inteligente (Cloud Run) — '
            + 'corrigir o segredo do proxy NÃO conserta este.' },
    // SHAREPOINT_HOST so importa se a empresa usa o sync de XML via SharePoint.
    //
    // 🚨 O COMENTÁRIO ANTIGO DIZIA QUE `GRAPH_*` ERA "TAMBÉM" PARA E-MAIL —
    // meia-verdade que sustentou o rótulo errado. Neste serviço o `GRAPH_*` é
    // **SÓ** e-mail: o SharePoint é falado pelo PROXY, com credenciais dele.
    // Marcamos opcional para não alarmar quem não usa o sync de XML.
    { chave: 'SHAREPOINT_HOST', categoria: 'sharepoint', criticidade: 'alto', opcional: true,
        descricao: 'Host do SharePoint (ex.: empresa.sharepoint.com)',
        impacto: 'SharePoint sync de XMLs não roda (só importa se você usa essa via de importação)' },
    // ── Gateway interno
    // FISCAL_GATEWAY_TOKEN protege o endpoint /internal/plano-contas, consumido
    // por um sistema CONTABIL externo. Se nao ha integracao contabil ativa,
    // nao precisa. Opcional pra nao alarmar quem nao usa.
    { chave: 'FISCAL_GATEWAY_TOKEN', categoria: 'integracao', criticidade: 'alto', opcional: true,
        descricao: 'Token compartilhado entre fiscal e contábil',
        impacto: 'Endpoint /internal/plano-contas retorna 401 (só importa se há sistema contábil externo integrado)' },
    // ── Contador (dados do SPED)
    { chave: 'CONTADOR_CRC', categoria: 'contador', criticidade: 'medio',
        descricao: 'CRC do contador responsável',
        impacto: 'SPED Fiscal/Contribuições gerado sem CRC válido' },
    { chave: 'CONTADOR_NOME', categoria: 'contador', criticidade: 'medio',
        descricao: 'Nome do contador responsável',
        impacto: 'SPED gerado sem nome do responsável' },
    { chave: 'CONTADOR_CPF', categoria: 'contador', criticidade: 'medio',
        descricao: 'CPF do contador responsável',
        impacto: 'SPED gerado sem CPF do responsável' },
    // HEALTH_ALERT_TO tem default no codigo: usa GRAPH_REMETENTE (junior@spassessoriacontabil.com.br).
    // Sem env var, alerta noturno ainda chega — so num email so. Marcar
    // como informativo evita falso alarme no painel.
    { chave: 'HEALTH_ALERT_TO', categoria: 'alertas', criticidade: 'medio',
        defaultRuntime: 'GRAPH_REMETENTE (junior@spassessoriacontabil.com.br)',
        descricao: 'Destinatário do alerta noturno health-consolidado',
        impacto: 'Email vai pro GRAPH_REMETENTE (Paulo) por default — sem destinatário dedicado' },
];

/** Modos operacionais — string esperada ('serpro' em prod). */
export const MODOS_OPERACIONAIS = [
    { chave: 'DCTFWEB_MODE', esperadoEmProd: 'serpro', default: 'serpro',
        descricao: 'Modo do provider DCTFWeb (serpro=real, mock=teste)' },
    { chave: 'DAS_MODE', esperadoEmProd: 'serpro', default: 'serpro',
        descricao: 'Modo do provider DAS (serpro=real, mock=teste)' },
    { chave: 'DARF_MODE', esperadoEmProd: 'serpro', default: 'serpro',
        descricao: 'Modo do provider DARF' },
    { chave: 'NFSE_NAC_MODE', esperadoEmProd: 'serpro', default: 'serpro',
        descricao: 'Modo do provider NFS-e Nacional' },
    { chave: 'CAIXA_POSTAL_MODE', esperadoEmProd: 'serpro', default: 'serpro',
        descricao: 'Modo do provider Caixa Postal' },
];

/**
 * @param {object} env  process.env (ou mock)
 * @param {string} ambiente  'prod' | 'staging' | 'dev'
 * @returns {{ resumo: object, achados: Array }}
 */
export function diagnosticarConfig(env, ambiente = 'prod') {
    const e = env || {};
    const achados = [];

    // 1. Configs obrigatorias
    for (const c of CONFIGS_MONITORADAS) {
        const valor = e[c.chave];
        if (!valor || String(valor).trim() === '') {
            // Se tem defaultRuntime, a feature NAO esta quebrada — esta
            // rodando no fallback. Rebaixa criticidade pra 'informativo'.
            if (c.defaultRuntime) {
                achados.push({
                    tipo: 'env_via_default',
                    chave: c.chave,
                    categoria: c.categoria,
                    criticidade: 'informativo',
                    descricao: c.descricao,
                    impacto: `Usando default do código: "${c.defaultRuntime}". Setar a env var só se quiser customizar.`,
                });
            } else if (c.opcional) {
                // Gate de feature opcional (SharePoint sync, gateway contabil).
                // Nao alarma — so importa se a empresa USA aquela integracao.
                achados.push({
                    tipo: 'env_opcional',
                    chave: c.chave,
                    categoria: c.categoria,
                    criticidade: 'opcional',
                    descricao: c.descricao,
                    impacto: c.impacto,
                });
            } else {
                achados.push({
                    tipo: 'env_vazia',
                    chave: c.chave,
                    categoria: c.categoria,
                    criticidade: c.criticidade,
                    descricao: c.descricao,
                    impacto: c.impacto,
                });
            }
        }
    }

    // 2. Modos operacionais — mock em prod vira aviso
    for (const m of MODOS_OPERACIONAIS) {
        const valor = e[m.chave] || m.default;
        if (ambiente === 'prod' && valor !== m.esperadoEmProd) {
            achados.push({
                tipo: 'modo_inadequado',
                chave: m.chave,
                categoria: 'modo',
                criticidade: 'alto',
                descricao: m.descricao,
                impacto: `Em modo "${valor}" em ambiente de produção (esperado: ${m.esperadoEmProd})`,
                valorAtual: valor,
            });
        }
    }

    // 2b. FORMA do que está gravado — não basta estar PREENCHIDO.
    //
    // 🚨 Em 01-02/09 os dois client secrets do Azure estavam preenchidos, e os
    // dois guardavam o *Secret ID* (GUID de 36 caracteres) em vez do Valor: a
    // Microsoft recusava com AADSTS7000215 e o painel dizia "configurado".
    // "Preenchido" é STATUS; a forma é RESULTADO — a régua da casa desde 22/07.
    //
    // ⚠️ Por VARREDURA (`*_CLIENT_SECRET`), nunca por lista: credencial nova
    // entra sozinha. E só acusa o que se prova (GUID e espaço) — ver
    // `forma-do-segredo.js`.
    for (const chave of segredosDeClientSecret(e)) {
        const forma = formaDoClientSecret(e[chave]);
        if (!forma.ehProblema || forma.forma === 'vazio') continue; // vazio já é `env_vazia`
        const def = CONFIGS_MONITORADAS.find((c) => c.chave === chave);
        achados.push({
            tipo: 'segredo_forma_errada',
            chave,
            categoria: def ? def.categoria : 'sharepoint',
            criticidade: 'critico',
            descricao: def ? def.descricao : 'Client secret de app do Azure AD',
            impacto: `O segredo está preenchido (${forma.caracteres} caracteres) e a Microsoft vai RECUSAR `
                + `(AADSTS7000215). ${forma.diagnostico}`,
        });
    }

    // 3. Kill-switch EMISSAO_BLOQUEADA — checa se está coerente
    const bloqueada = String(e.EMISSAO_BLOQUEADA || '').toLowerCase();
    if (ambiente === 'prod' && bloqueada !== 'true' && bloqueada !== 'false') {
        achados.push({
            tipo: 'flag_indefinida',
            chave: 'EMISSAO_BLOQUEADA',
            categoria: 'kill-switch',
            criticidade: 'medio',
            descricao: 'Kill-switch global de emissão (DAS/DARF/DCTFWeb)',
            impacto: 'Valor ausente — depende do default do código (verificar)',
        });
    }

    const resumo = {
        total: CONFIGS_MONITORADAS.length + MODOS_OPERACIONAIS.length + 1, // +1 = EMISSAO_BLOQUEADA
        criticos: achados.filter((a) => a.criticidade === 'critico').length,
        altos: achados.filter((a) => a.criticidade === 'alto').length,
        medios: achados.filter((a) => a.criticidade === 'medio').length,
        // Informativos: vars sem env mas com default no codigo (nao bloqueia).
        informativos: achados.filter((a) => a.criticidade === 'informativo').length,
        // Opcionais: gates de feature opcional (SharePoint, gateway contabil)
        // que so importam se a empresa usa aquela integracao.
        opcionais: achados.filter((a) => a.criticidade === 'opcional').length,
        ambiente,
    };

    return { resumo, achados };
}
