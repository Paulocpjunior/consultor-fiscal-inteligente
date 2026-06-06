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
//   GRAPH_*                       SharePoint sync de XMLs
//
// E modos operacionais (mock vs serpro real):
//   DCTFWEB_MODE / DAS_MODE / DARF_MODE / NFSE_NAC_MODE
//   EMISSAO_BLOQUEADA (kill-switch)
//
// Niveis:
//   critico  feature inteira nao funciona (SERPRO_*, SEFAZ_CRON_SECRET)
//   alto     feature em modo degradado (mock em prod, sem SENTRY)
//   medio    informativo desejavel ausente (CONTADOR_*, GEMINI_MODEL_PRO)
//   ok       tudo configurado
// ============================================================================

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
    { chave: 'STORAGE_BUCKET', categoria: 'firebase', criticidade: 'critico',
        descricao: 'Bucket de armazenamento Firebase',
        impacto: 'Upload de .pfx e download de XMLs falha' },
    // ── SharePoint
    { chave: 'GRAPH_TENANT_ID', categoria: 'sharepoint', criticidade: 'alto',
        descricao: 'Tenant ID do Microsoft Graph',
        impacto: 'SharePoint sync de XMLs não roda' },
    { chave: 'GRAPH_CLIENT_ID', categoria: 'sharepoint', criticidade: 'alto',
        descricao: 'Client ID do app no Azure AD',
        impacto: 'SharePoint sync de XMLs não roda' },
    { chave: 'GRAPH_CLIENT_SECRET', categoria: 'sharepoint', criticidade: 'alto',
        descricao: 'Client secret do app no Azure AD',
        impacto: 'SharePoint sync de XMLs não roda' },
    { chave: 'SHAREPOINT_HOST', categoria: 'sharepoint', criticidade: 'alto',
        descricao: 'Host do SharePoint (ex.: empresa.sharepoint.com)',
        impacto: 'SharePoint sync não localiza o site' },
    // ── Gateway interno
    { chave: 'FISCAL_GATEWAY_TOKEN', categoria: 'integracao', criticidade: 'alto',
        descricao: 'Token compartilhado entre fiscal e contábil',
        impacto: 'Endpoint /internal/plano-contas retorna 401' },
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
    { chave: 'HEALTH_ALERT_TO', categoria: 'alertas', criticidade: 'medio',
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
        ambiente,
    };

    return { resumo, achados };
}
