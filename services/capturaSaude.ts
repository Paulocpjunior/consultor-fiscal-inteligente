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
    /**
     * O PROVEDOR tem documento disponível além do já capturado?
     *   true  = há doc esperando (maxNSU > ultNSU nalguma elegível) → 0 capturado É falha
     *   false = provedor CONFIRMA que não há nada (maxNSU alcançado) → 0 é correto
     *   null/undefined = desconhecido → mantém a rede de segurança (0 + elegíveis = crítico)
     * Só o NFSe Nacional ADN preenche isto (o ADN devolve maxNSU); os demais
     * trilhos deixam null e seguem a regra clássica do "sucesso vazio".
     */
    movimentoDisponivel?: boolean | null;
    /**
     * Cron roda só em dia útil (seg-sex)? Se sim, as horas de FIM DE SEMANA
     * não contam como atraso — 26/07 (domingo): os 4 cards amarelaram com
     * "há 36h/50h (esperado <30h)" sendo que sábado/domingo não HÁ execução
     * agendada. Farol honesto vale nos dois sentidos: também não pode gritar
     * atraso quando o calendário diz que não era pra rodar.
     */
    cadenciaSegSex?: boolean;
    agoraMs: number;
}

/**
 * Horas de FIM DE SEMANA (sáb/dom, fuso BRT = UTC-3) dentro do intervalo
 * [inicioMs, fimMs]. Pura, usada pra descontar o "atraso" de cron seg-sex.
 */
export function horasFimDeSemanaEntre(inicioMs: number, fimMs: number): number {
    if (!(fimMs > inicioMs)) return 0;
    const HORA = 3600000;
    const OFFSET_BRT = 3 * HORA; // BRT = UTC-3 (sem horário de verão desde 2019)
    let horas = 0;
    // Caminha de hora em hora (intervalos reais aqui são dias, não anos).
    for (let t = inicioMs; t < fimMs; t += HORA) {
        const dia = new Date(t - OFFSET_BRT).getUTCDay(); // 0=dom, 6=sáb em BRT
        if (dia === 0 || dia === 6) horas += Math.min(HORA, fimMs - t) / HORA;
    }
    return horas;
}

export function avaliarSaudeCaptura(s: SinaisCaptura): SaudeCaptura {
    const horasBrutas = s.ultimoMs ? (s.agoraMs - s.ultimoMs) / 3600000 : null;
    // Cron seg-sex: fim de semana não conta como atraso (26/07: painel inteiro
    // amarelou num domingo por "atraso" que era só o calendário).
    const horas = horasBrutas === null
        ? null
        : (s.cadenciaSegSex ? Math.max(0, horasBrutas - horasFimDeSemanaEntre(s.ultimoMs!, s.agoraMs)) : horasBrutas);

    // 1) Nem roda — crítico.
    if (horas === null) return { nivel: 'critico', motivo: 'Nunca executado.' };
    if (horas > 72) return { nivel: 'critico', motivo: `Sem execução há ${Math.floor(horas / 24)} dia(s) útil(eis).` };

    const sucessos = s.sucessos ?? null;
    const falhas = s.falhas ?? null;
    const docs7d = s.docsUltimos7d ?? null;
    const elegiveis = s.elegiveis ?? null;
    const temElegiveis = (elegiveis ?? 0) > 0;

    // 2) Roda mas falha tudo. Só é "inoperante" (crítico) quando NÃO há captura
    //    recente saudável. Uma rodada pequena que pegou um único 656 (rate-limit
    //    transitório, absorvido pelo round-robin) NÃO é inoperância se milhares
    //    de docs entraram em 7 dias — pintar vermelho aí é falso alarme (caso
    //    NFe 0/1 com 12.417 docs/7d). O caso real 0/121 tinha docs7d=0 → segue
    //    crítico. Se há captura recente, vira atenção (última rodada falhou).
    if (sucessos !== null && falhas !== null && sucessos === 0 && falhas > 0) {
        if (docs7d !== null && docs7d > 0) {
            return { nivel: 'atencao', motivo: `Última execução falhou (${falhas} tentativa(s)), mas há ${docs7d} doc(s) capturados em 7 dias — provavelmente transitório (ex.: rate-limit 656). Sincroniza de novo.` };
        }
        return { nivel: 'critico', motivo: `TODAS as ${falhas} tentativas da última execução falharam — captura inoperante.` };
    }

    // 3) Roda, "dá certo", mas não entra NADA há 7 dias com empresas elegíveis.
    if (docs7d !== null && docs7d === 0 && temElegiveis) {
        // 3a) O provedor CONFIRMA que não há documento disponível (maxNSU
        //     alcançado). Não é falha — é elegível sem movimento, comum na
        //     transição do NFSe Nacional ADN (município aderiu, mas ainda não há
        //     emissão/tomada no ambiente nacional). Âmbar (não verde) porque
        //     "elegível e nunca capturou" ainda merece um olhar do humano —
        //     pode ser codMun errado. Mas NÃO é o vermelho de "captura quebrada".
        if (s.movimentoDisponivel === false) {
            return { nivel: 'atencao', motivo: `${elegiveis} elegível(is), mas o provedor não tem documento disponível (maxNSU alcançado) — nada a capturar. Normal na transição do ADN; confira o município se persistir.` };
        }
        // 3b) Sem confirmação do provedor: mantém crítico ("sucesso vazio",
        //     caso NFS-e Nacional 71/8 com 0 docs; NFS-e SP 0/121).
        return { nivel: 'critico', motivo: `0 documentos capturados em 7 dias com ${elegiveis} empresa(s) elegível(is) — rodando sem capturar.` };
    }

    // 4) Mais falha que sucesso — atenção.
    if (sucessos !== null && falhas !== null && falhas > sucessos) {
        return { nivel: 'atencao', motivo: `Falhas (${falhas}) superam sucessos (${sucessos}) na última execução.` };
    }

    // 5) Execução atrasada — atenção (horas ÚTEIS quando o cron é seg-sex).
    if (horas >= 30) {
        return { nivel: 'atencao', motivo: `Última execução há ${Math.floor(horas)}h útil(eis) (esperado <30h${s.cadenciaSegSex ? '; fim de semana não conta' : ''}).` };
    }

    // 6) Saudável de verdade: recente E com resultado (ou sem ninguém elegível).
    if (!temElegiveis) return { nivel: 'ok', motivo: 'Sem empresas elegíveis no momento.' };
    return { nivel: 'ok', motivo: `Capturando: ${docs7d ?? '—'} doc(s) em 7 dias.` };
}

export interface SinaisCofreSaida {
    /** ms da última leitura da caixa (null = nunca) */
    ultimoMs: number | null;
    /** saída mod 55 importada pelo cofre nos últimos 7 dias */
    saida7d: number | null;
    /** clientes distintos que entregaram alguma saída nos últimos 7 dias */
    entregando7d: number | null;
    /** universo de empresas monitoradas (denominador da adoção) */
    monitoradas: number | null;
    agoraMs: number;
}

/**
 * Saúde HONESTA do trilho de SAÍDA mod 55 pelo cofre de e-mail. Diferente dos
 * outros trilhos, a saída não depende de a SEFAZ entregar (ela nunca entrega ao
 * emissor — Rejeição 641): depende de o CLIENTE apontar o emissor pro cofre. Por
 * isso o farol mede ADOÇÃO, não só "o cron rodou":
 *   - cofre parado/nunca leu           → crítico (infra quebrada)
 *   - 0 saída em 7d                     → crítico (ninguém entregando — trilho ocioso)
 *   - entra saída, mas < metade adota   → atenção (funciona, falta onboarding)
 *   - maioria entregando                → ok
 * O crítico aqui NÃO significa "captura quebrada" e sim "trilho vazio"; o âmbar
 * é o estado real enquanto os clientes migram da SIEG. Evita o verde-mentiroso
 * de "1 cliente entrega → verde" escondendo 300 sem configurar.
 */
export function avaliarSaudeCofreSaida(s: SinaisCofreSaida): SaudeCaptura {
    const horas = s.ultimoMs ? (s.agoraMs - s.ultimoMs) / 3600000 : null;
    if (horas === null) return { nivel: 'critico', motivo: 'Cofre nunca leu a caixa.' };
    if (horas > 72) return { nivel: 'critico', motivo: `Cofre sem leitura há ${Math.floor(horas / 24)} dia(s) — verifique a integração da caixa.` };

    const saida = s.saida7d ?? 0;
    const entregando = s.entregando7d ?? 0;
    const mon = s.monitoradas ?? 0;

    if (saida === 0) {
        return {
            nivel: 'critico',
            motivo: mon > 0
                ? `Nenhuma saída mod 55 entrou no cofre em 7 dias (${mon} empresas monitoradas) — os clientes ainda não apontaram o emissor pro cofre.`
                : 'Nenhuma saída mod 55 entrou no cofre em 7 dias.',
        };
    }

    if (mon > 0 && entregando / mon < 0.5) {
        return {
            nivel: 'atencao',
            motivo: `Recebendo saída, mas só ${entregando} de ${mon} clientes entregaram em 7d — adoção parcial; configure o cofre nos demais (veja Cobertura de Saída).`,
        };
    }

    return { nivel: 'ok', motivo: `Recebendo saída: ${saida} nota(s) de ${entregando} cliente(s) em 7 dias.` };
}
