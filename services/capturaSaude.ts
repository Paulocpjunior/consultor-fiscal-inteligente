/**
 * capturaSaude.ts — saúde HONESTA de um trilho de captura (PURO, testável).
 *
 * Lição 22/07/2026: o Diagnóstico mostrava ✅ verde na NFS-e SP com
 * 0 sucessos / 121 falhas e 0 docs em 7 dias — porque o semáforo media só
 * "o cron rodou há <30h". Rodar não é capturar. A partir daqui o farol mede
 * RESULTADO; "executou recentemente" sozinho nunca mais dá verde.
 */

export type NivelSaude = 'ok' | 'atencao' | 'critico';

export interface SaudeCaptura {
    nivel: NivelSaude;
    motivo: string;
}

export interface SinaisCaptura {
    /** ms da última execução do cron (null = nunca) */
    ultimoMs: number | null;
    /** sucessos/falhas da última execução (null = sem log) */
    sucessos: number | null;
    falhas: number | null;
    /** docs capturados nos últimos 7 dias por este trilho */
    docsUltimos7d: number | null;
    /** empresas elegíveis para este trilho */
    elegiveis: number | null;
    agoraMs: number;
}

export function avaliarSaudeCaptura(s: SinaisCaptura): SaudeCaptura {
    const horas = s.ultimoMs ? (s.agoraMs - s.ultimoMs) / 3600000 : null;

    // 1) Nem roda — crítico.
    if (horas === null) return { nivel: 'critico', motivo: 'Nunca executado.' };
    if (horas > 72) return { nivel: 'critico', motivo: `Sem execução há ${Math.floor(horas / 24)} dia(s).` };

    const sucessos = s.sucessos ?? null;
    const falhas = s.falhas ?? null;
    const docs7d = s.docsUltimos7d ?? null;
    const elegiveis = s.elegiveis ?? null;
    const temElegiveis = (elegiveis ?? 0) > 0;

    // 2) Roda mas falha tudo — crítico (o caso NFS-e SP 0/121).
    if (sucessos !== null && falhas !== null && sucessos === 0 && falhas > 0) {
        return { nivel: 'critico', motivo: `TODAS as ${falhas} tentativas da última execução falharam — captura inoperante.` };
    }

    // 3) Roda, "dá certo", mas não entra NADA há 7 dias com empresas elegíveis —
    //    crítico ("sucesso vazio", caso NFS-e Nacional 71/8 com 0 docs).
    if (docs7d !== null && docs7d === 0 && temElegiveis) {
        return { nivel: 'critico', motivo: `0 documentos capturados em 7 dias com ${elegiveis} empresa(s) elegível(is) — rodando sem capturar.` };
    }

    // 4) Mais falha que sucesso — atenção.
    if (sucessos !== null && falhas !== null && falhas > sucessos) {
        return { nivel: 'atencao', motivo: `Falhas (${falhas}) superam sucessos (${sucessos}) na última execução.` };
    }

    // 5) Execução atrasada — atenção.
    if (horas >= 30) {
        return { nivel: 'atencao', motivo: `Última execução há ${Math.floor(horas)}h (esperado <30h).` };
    }

    // 6) Saudável de verdade: recente E com resultado (ou sem ninguém elegível).
    if (!temElegiveis) return { nivel: 'ok', motivo: 'Sem empresas elegíveis no momento.' };
    return { nivel: 'ok', motivo: `Capturando: ${docs7d ?? '—'} doc(s) em 7 dias.` };
}
