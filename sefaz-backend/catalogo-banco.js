// ============================================================================
// sefaz-backend/catalogo-banco.js  (PURO — sem firebase, testável)
//
// CATÁLOGO DO BANCO: funcionalidade × coleção — o "controle acirrado" pedido
// pelo Paulo (30/07): "algo visível que só eu como desenvolvedor posso ter
// acesso". Toda coleção do Firestore DEVE ter dono declarado aqui:
//  - coleção real que NÃO está no catálogo  → "fora do catálogo" (âmbar):
//    alguém criou banco sem registrar — investigar;
//  - coleção catalogada que não existe mais  → "sem uso" (cinza): candidata a
//    limpeza de catálogo ou feature ainda não rodou.
//
// Regra de manutenção: TODA feature nova que criar coleção adiciona a linha
// aqui no MESMO PR (o painel Sistema denuncia se esquecer).
// ============================================================================

/** @type {Array<{colecao:string, grupo:string, funcionalidade:string, descricao?:string}>} */
export const CATALOGO_BANCO = [
    // ── Cadastro & acesso ──────────────────────────────────────────────────
    { colecao: 'users', grupo: 'Cadastro & Acesso', funcionalidade: 'Usuários e papéis (login, admin/colaborador)' },
    { colecao: 'carteiras', grupo: 'Cadastro & Acesso', funcionalidade: 'Carteira de clientes por colaborador' },
    { colecao: 'simples_empresas', grupo: 'Cadastro & Acesso', funcionalidade: 'Empresas do Simples Nacional (cadastro + apuração)' },
    { colecao: 'lucro_empresas', grupo: 'Cadastro & Acesso', funcionalidade: 'Empresas do Lucro Presumido/Real' },
    { colecao: 'empresas_mesclagens', grupo: 'Cadastro & Acesso', funcionalidade: 'Auditoria de mesclagem de empresas duplicadas' },
    { colecao: 'empresas_certificados', grupo: 'Cadastro & Acesso', funcionalidade: 'Certificados A1/A3 por empresa (metadados)' },
    { colecao: 'sefaz_certificados', grupo: 'Cadastro & Acesso', funcionalidade: 'Certificado do escritório (config)' },
    { colecao: 'sefaz_certificados_historico', grupo: 'Cadastro & Acesso', funcionalidade: 'Histórico de trocas do certificado do escritório' },
    { colecao: 'notificacoes', grupo: 'Cadastro & Acesso', funcionalidade: 'Notificações in-app (sino)' },

    // ── Captura NF-e (DistDFe) ─────────────────────────────────────────────
    { colecao: 'documentos_fiscais', grupo: 'Captura NF-e', funcionalidade: 'TODOS os documentos fiscais (NFe/NFCe/CTe/NFSe) — coração do banco' },
    { colecao: 'xml_capturas', grupo: 'Captura NF-e', funcionalidade: 'Auditoria de cada captura (quem/quando/origem)' },
    { colecao: 'xml_erros', grupo: 'Captura NF-e', funcionalidade: 'Erros de importação de XML' },
    { colecao: 'sefaz_state', grupo: 'Captura NF-e', funcionalidade: 'Cursor NSU por CNPJ (prova de captura)' },
    { colecao: 'sefaz_locks', grupo: 'Captura NF-e', funcionalidade: 'Trava de 1h por CNPJ (anti consumo indevido)' },
    { colecao: 'sefaz_cron_logs', grupo: 'Captura NF-e', funcionalidade: 'Execuções do cron de captura NFe' },
    { colecao: 'manifestacoes_log', grupo: 'Captura NF-e', funcionalidade: 'Auditoria das manifestações (Ciência etc.)' },
    { colecao: 'manifestacoes_cron_logs', grupo: 'Captura NF-e', funcionalidade: 'Execuções do cron de manifestação' },

    // ── NFS-e SP (portal CSV) ──────────────────────────────────────────────
    { colecao: 'nfsesp_cron_logs', grupo: 'NFS-e SP', funcionalidade: 'Execuções do cron NFSe SP (WS legado — aposentado)' },
    { colecao: 'nfsesp_portal_cron_logs', grupo: 'NFS-e SP', funcionalidade: 'Execuções do cron do portal CSV' },
    { colecao: 'nfsesp_portal_locks', grupo: 'NFS-e SP', funcionalidade: 'Trava da varredura do portal' },
    { colecao: 'nfsesp_portal_session', grupo: 'NFS-e SP', funcionalidade: 'Sessão/cookies do portal SP' },
    { colecao: 'nfsesp_portal_state', grupo: 'NFS-e SP', funcionalidade: 'Estado da varredura do portal' },
    { colecao: 'nfsesp_capturas_log', grupo: 'NFS-e SP', funcionalidade: 'Auditoria de capturas NFSe SP' },
    { colecao: 'nfsesp_correcoes_log', grupo: 'NFS-e SP', funcionalidade: 'Correções aplicadas em NFSe SP' },
    { colecao: 'nfsesp_csv_imports', grupo: 'NFS-e SP', funcionalidade: 'Importações de CSV do portal' },
    { colecao: 'nfsesp_empresas_descobertas', grupo: 'NFS-e SP', funcionalidade: 'Prestadores descobertos no portal' },

    // ── NFS-e Nacional (ADN) ───────────────────────────────────────────────
    { colecao: 'nfse_nacional_dfe_state', grupo: 'NFS-e Nacional', funcionalidade: 'Cursor NSU do ADN por empresa' },
    { colecao: 'nfse_nacional_dfe_locks', grupo: 'NFS-e Nacional', funcionalidade: 'Trava da captura ADN' },
    { colecao: 'nfse_nacional_dfe_cron_logs', grupo: 'NFS-e Nacional', funcionalidade: 'Execuções do cron ADN' },
    { colecao: 'nfse_nacional_dfe_log', grupo: 'NFS-e Nacional', funcionalidade: 'Auditoria de consultas ADN' },
    { colecao: 'nfse_nacional_dfe_erros', grupo: 'NFS-e Nacional', funcionalidade: 'Erros da captura ADN' },
    { colecao: 'nfse_nacional_emitidas', grupo: 'NFS-e Nacional', funcionalidade: 'NFS-e emitidas pelo app (emissão nacional)' },
    { colecao: 'nfse_emitidas', grupo: 'NFS-e Nacional', funcionalidade: 'NFS-e emitidas (legado/compat)' },

    // ── Cofre de e-mail & NFC-e ────────────────────────────────────────────
    { colecao: 'cofre_email_runs', grupo: 'Cofre de e-mail', funcionalidade: 'Execuções do ingestor do cofre (xml@)' },
    { colecao: 'cofre_email_mensagens', grupo: 'Cofre de e-mail', funcionalidade: 'Idempotência por mensagem de e-mail' },
    { colecao: 'sefaz_xml_email_state', grupo: 'Cofre de e-mail', funcionalidade: 'Estado do cofre (última saída por empresa)' },
    { colecao: 'sae_nfce_state', grupo: 'Cofre de e-mail', funcionalidade: 'Estado da captura NFC-e saída (SP)' },

    // ── Simples / DAS ──────────────────────────────────────────────────────
    { colecao: 'das_emitidos', grupo: 'Simples · DAS', funcionalidade: 'DAS emitidos (PGDAS-D + guia)' },
    { colecao: 'das_envios_cliente', grupo: 'Simples · DAS', funcionalidade: 'Envios de DAS ao cliente' },
    { colecao: 'das_cron_logs', grupo: 'Simples · DAS', funcionalidade: 'Execuções do cron de DAS/vencimentos' },

    // ── Lucro / DCTFWeb / guias ────────────────────────────────────────────
    { colecao: 'lucro_fichas', grupo: 'Lucro · Federal', funcionalidade: 'Fichas mensais do Lucro (faturamento/apuração)' },
    { colecao: 'dctfweb_declaracoes', grupo: 'Lucro · Federal', funcionalidade: 'Declarações DCTFWeb transmitidas' },
    { colecao: 'dctfweb_mit_preenchimentos', grupo: 'Lucro · Federal', funcionalidade: 'Preenchimentos do MIT' },
    { colecao: 'dctfweb_mit_retificacoes', grupo: 'Lucro · Federal', funcionalidade: 'Auditoria de retificações do MIT' },
    { colecao: 'dctfweb_cron_logs', grupo: 'Lucro · Federal', funcionalidade: 'Execuções do cron DCTFWeb' },
    { colecao: 'dare_solicitacoes', grupo: 'Lucro · Federal', funcionalidade: 'DARE-ICMS emitidos pela API' },
    { colecao: 'impostos_enviados', grupo: 'Lucro · Federal', funcionalidade: 'Auditoria do rito de envio de imposto (#293)' },

    // ── Caixa postal & obrigações ──────────────────────────────────────────
    { colecao: 'caixa_postal_mensagens', grupo: 'Obrigações', funcionalidade: 'Mensagens da caixa postal e-CAC' },
    { colecao: 'caixa_postal_cron_logs', grupo: 'Obrigações', funcionalidade: 'Execuções do cron da caixa postal' },
    { colecao: 'tarefas', grupo: 'Obrigações', funcionalidade: 'Tarefas/obrigações mensais por empresa' },
    { colecao: 'tarefas_cron_logs', grupo: 'Obrigações', funcionalidade: 'Execuções do cron mensal de tarefas' },
    { colecao: 'vencimentos_meta', grupo: 'Obrigações', funcionalidade: 'Metadados de vencimentos/alertas' },
    { colecao: 'vencimentos_cron_logs', grupo: 'Obrigações', funcionalidade: 'Execuções do cron de vencimentos' },
    { colecao: 'cert_alerta_cron_logs', grupo: 'Obrigações', funcionalidade: 'Execuções do alerta de certificado' },

    // ── Integrações & catálogos ────────────────────────────────────────────
    { colecao: 'sharepoint_sync_log', grupo: 'Integrações', funcionalidade: 'Sincronização SharePoint (arquivamento)' },
    { colecao: 'sharepoint_alertas_log', grupo: 'Integrações', funcionalidade: 'Alertas do SharePoint' },
    { colecao: 'produtores_rurais', grupo: 'Catálogos', funcionalidade: 'Fornecedores produtores rurais (natureza CADESP, município e regime do FUNRURAL) — base da DIPAM 1.1' },
    { colecao: 'nbs_codigos_oficiais', grupo: 'Catálogos', funcionalidade: 'Catálogo NBS oficial' },
    { colecao: 'nfp_compliance_cache', grupo: 'Catálogos', funcionalidade: 'Cache de compliance NFP' },
    { colecao: 'items', grupo: 'Catálogos', funcionalidade: '⚠ Nome genérico — verificar origem e renomear ou aposentar' },

    // ── Sistema / observabilidade ──────────────────────────────────────────
    { colecao: 'cron_health_alerta_state', grupo: 'Sistema', funcionalidade: 'Anti-spam do alerta de saúde dos crons' },
    { colecao: 'sistema_banco_snapshots', grupo: 'Sistema', funcionalidade: 'Snapshots diários deste painel (tendência de crescimento)' },
];

/**
 * Cruza as coleções REAIS do banco com o catálogo.
 * @param {string[]} colecoesReais nomes vindos de listCollections()
 * @returns {{ linhas: Array, foraDoCatalogo: string[], catalogadasSemUso: string[] }}
 */
export function catalogarColecoes(colecoesReais) {
    const reais = new Set((colecoesReais || []).filter(Boolean));
    const catalogadas = new Set(CATALOGO_BANCO.map((c) => c.colecao));

    const linhas = CATALOGO_BANCO
        .filter((c) => reais.has(c.colecao))
        .map((c) => ({ ...c, existe: true }));

    const foraDoCatalogo = [...reais].filter((r) => !catalogadas.has(r)).sort();
    const catalogadasSemUso = CATALOGO_BANCO
        .filter((c) => !reais.has(c.colecao))
        .map((c) => c.colecao)
        .sort();

    return { linhas, foraDoCatalogo, catalogadasSemUso };
}

/**
 * Delta de crescimento entre o snapshot anterior e as contagens de agora.
 * @param {Record<string, number>|null} snapshotAnterior colecao → count
 * @param {Record<string, number>} countsAtuais
 */
export function calcularDeltas(snapshotAnterior, countsAtuais) {
    const out = {};
    for (const [colecao, atual] of Object.entries(countsAtuais || {})) {
        const antes = snapshotAnterior?.[colecao];
        out[colecao] = (typeof antes === 'number') ? atual - antes : null;
    }
    return out;
}
