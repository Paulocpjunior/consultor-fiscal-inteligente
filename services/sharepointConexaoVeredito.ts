/**
 * 🚨 "✓ CONECTADO" EM VERDE COM 57 ERROS DE TOKEN LOGO ABAIXO.
 *
 * 28/08, print do Paulo no card **Conexão SharePoint**:
 *
 *   ✓ Conectado · spassessoriacontabilcombr.sharepoint.com · /sites/ClientesSP2
 *   Auto-sync diário: ⚠ 28/08/2026, 15:48 · 0 novos · 0 dup · **57 erros** …
 *   SAÍDA: Azure AD token error (400): {"error":"invalid_request",
 *   "error_description":"AADSTS90002: Tenant 'dfa9a1d2-…' not found…"}
 *
 * Duas leituras do mesmo fato no MESMO card — e a verde está EM CIMA, na
 * posição do veredito. Quem bate o olho lê "está conectado" e vai procurar o
 * problema em outro lugar.
 *
 * ═══ POR QUE A VERDE ESTAVA LÁ ══════════════════════════════════════════════
 *
 * O card lia `health.configured`, e esse campo responde **"as variáveis de
 * ambiente estão preenchidas?"** — não "o token funciona". Um tenant que NÃO
 * EXISTE é configurado e quebrado ao mesmo tempo. É a primeira regra
 * permanente deste projeto invertida: **validação por RESULTADO, nunca por
 * status** (a lição do trilho NFS-e SP, semanas verde com 0 sucessos).
 *
 * ⚠️ E aqui o custo não é estético: TUDO que grava no SharePoint passa pelo
 * MESMO proxy — o auto-sync dos XMLs **e** a cópia da guia na pasta IMPOSTOS
 * do rito (`uploadProxy`, em `envio-imposto.js`). Com o token falhando,
 * nenhum imposto é arquivado, o rito não fecha, e o fim de mês daquele cliente
 * fica travado. Foi assim que a VINCENZO GUERRA chegou ao print seguinte.
 *
 * 📌 O veredito passa a sair do RESULTADO da última rodada. Ausência de rodada
 * NÃO vira verde — vira `indeterminado`, porque "não conferi" e "está tudo
 * certo" são fatos diferentes.
 */

export type CorConexao = 'ok' | 'atencao' | 'erro' | 'indeterminado';

export interface VereditoConexao {
    cor: CorConexao;
    titulo: string;
    /** O que aconteceu, com a mensagem REAL do órgão/serviço quando existe. */
    detalhe: string | null;
    /** O que fazer. `null` quando não há nada a fazer. */
    acao: string | null;
}

export interface HealthSharePoint {
    configured?: boolean;
    sharepointHost?: string;
    sitePath?: string;
}

export interface UltimoSync {
    timestamp?: { _seconds?: number } | null;
    totalErros?: number;
    erroFatal?: string | null;
    results?: Array<{ empresaNome?: string; erro?: string; errosDetalhe?: string[] }>;
}

/**
 * A assinatura de uma falha de CREDENCIAL — ela pede ação DIFERENTE de um erro
 * de pasta: aqui não adianta conferir o caminho nem preencher grupo/pasta,
 * porque nenhuma gravação vai passar enquanto o token não sair.
 *
 * `AADSTS90002` é "tenant não encontrado"; os outros cobrem segredo expirado,
 * app revogado e permissão retirada — todos do mesmo balde "o proxy não
 * consegue falar com a Microsoft".
 */
const ASSINATURA_CREDENCIAL = /AADSTS|token error|invalid_client|invalid_request|unauthorized|401|403/i;

/** A primeira mensagem de erro que a rodada guardou, seja de onde for. */
export function primeiroMotivoDoSync(lastSync?: UltimoSync | null): string | null {
    if (lastSync?.erroFatal) return String(lastSync.erroFatal);
    for (const r of (lastSync?.results || [])) {
        const m = r?.erro || (r?.errosDetalhe || [])[0];
        if (m) return `${r?.empresaNome ? `${r.empresaNome}: ` : ''}${m}`;
    }
    return null;
}

/**
 * O veredito do card, pelo RESULTADO.
 *
 * @param p.health     resposta do `/api/sharepoint/health` do proxy
 * @param p.lastSync   última rodada do auto-sync (é ela que TENTOU de verdade)
 * @param p.agoraMs    para o teste; default `Date.now()`
 */
export function vereditoConexaoSharePoint(p: {
    health?: HealthSharePoint | null;
    lastSync?: UltimoSync | null;
    agoraMs?: number;
}): VereditoConexao {
    const { health, lastSync } = p;
    const agora = p.agoraMs ?? Date.now();

    if (health === null || health === undefined) {
        return { cor: 'indeterminado', titulo: 'Verificando a conexão…', detalhe: null, acao: null };
    }

    // O proxy nem respondeu, ou respondeu sem credenciais. A tela já explicava
    // isto bem — o que muda é só passar pelo dono.
    if (!health.configured) {
        return {
            cor: 'erro',
            titulo: '✗ Proxy SharePoint indisponível.',
            detalhe: null,
            acao: 'Confira o serviço `consultor-fiscal-proxy` no Cloud Run e os secrets GRAPH_* dele.',
        };
    }

    const motivo = primeiroMotivoDoSync(lastSync);
    const ehCredencial = !!motivo && ASSINATURA_CREDENCIAL.test(motivo);

    // 🚨 CONFIGURADO E QUEBRADO — o caso do print. As variáveis estão lá e a
    // Microsoft recusa o token, então NADA é gravado: nem XML, nem a cópia da
    // guia do rito.
    if (ehCredencial) {
        return {
            cor: 'erro',
            titulo: '✗ Configurado, mas o proxy NÃO consegue autenticar na Microsoft.',
            detalhe: motivo,
            acao: 'Enquanto isto durar, NENHUM arquivo é gravado no SharePoint — nem os XMLs, nem a cópia da '
                + 'guia na pasta IMPOSTOS (é a mesma porta). O fim de mês fica travado na etapa 5. '
                + 'Corrija GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET no serviço '
                + '`consultor-fiscal-proxy` — preencher grupo/pasta do cliente não resolve isto.',
        };
    }

    if (lastSync?.erroFatal) {
        return {
            cor: 'erro',
            titulo: '✗ A última rodada do SharePoint FALHOU.',
            detalhe: String(lastSync.erroFatal),
            acao: 'Enquanto isto durar nenhum arquivo é gravado — inclusive a cópia da guia do rito.',
        };
    }

    const ts = lastSync?.timestamp?._seconds ? lastSync.timestamp._seconds * 1000 : null;
    // ⚠️ SEM RODADA NÃO É VERDE. "Configurado" prova que alguém preencheu as
    // variáveis, não que a gravação funciona — e foi exatamente essa a
    // confusão que este módulo existe para desfazer.
    if (!ts) {
        return {
            cor: 'indeterminado',
            titulo: '⚠ Credenciais preenchidas — sem rodada que confirme a gravação.',
            detalhe: null,
            acao: 'Rode o auto-sync uma vez para saber se o proxy de fato grava.',
        };
    }

    if ((lastSync?.totalErros ?? 0) > 0) {
        return {
            cor: 'atencao',
            titulo: '⚠ Conectado, mas a última rodada teve erros.',
            detalhe: motivo,
            acao: 'Veja o detalhe por empresa no card Auto-Sync abaixo.',
        };
    }

    // Rodada antiga e limpa: conectado, mas o cron pode ter parado. Âmbar,
    // porque "faz três dias que ninguém grava nada" não é um estado normal.
    const horas = (agora - ts) / 3600_000;
    if (horas >= 48) {
        return {
            cor: 'atencao',
            titulo: '⚠ Conectado — mas a última rodada é antiga.',
            detalhe: `Última rodada em ${new Date(ts).toLocaleString('pt-BR')}.`,
            acao: 'Confira o Cloud Scheduler do auto-sync diário.',
        };
    }

    return { cor: 'ok', titulo: '✓ Conectado', detalhe: null, acao: null };
}
