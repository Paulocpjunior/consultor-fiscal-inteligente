/**
 * Saúde honesta da captura — regressão do "verde mentiroso" (22/07/2026):
 * NFS-e SP com 0/121 e 0 docs aparecia ✅ porque o farol só media recência.
 */
import { avaliarSaudeCaptura, avaliarSaudeCofreSaida } from '../services/capturaSaude';

const AGORA = 1_800_000_000_000;
const H = 3600000;

describe('avaliarSaudeCaptura', () => {
    it('caso real NFS-e SP: rodou há 1h com 0 sucessos/121 falhas → CRÍTICO (não verde!)', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 1 * H, sucessos: 0, falhas: 121,
            docsUltimos7d: 0, elegiveis: 149, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('critico');
        expect(r.motivo).toMatch(/TODAS as 121/);
    });

    it('caso real NFS-e Nacional: 71/8 "sucesso" mas 0 docs em 7d → CRÍTICO (sucesso vazio)', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 1 * H, sucessos: 71, falhas: 8,
            docsUltimos7d: 0, elegiveis: 80, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('critico');
        expect(r.motivo).toMatch(/0 documentos.*7 dias/);
    });

    it('caso real NFe: última execução 0/1 (um 656) MAS 12417 docs em 7d → ATENÇÃO, não crítico (falso "inoperante")', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 5 / 60 * H, sucessos: 0, falhas: 1,
            docsUltimos7d: 12417, elegiveis: 107, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('atencao');
        expect(r.motivo).toMatch(/transitório|12417 doc/);
    });

    it('all-failed COM docs7d=0 continua crítico (inoperância real, caso 0/121)', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 1 * H, sucessos: 0, falhas: 121,
            docsUltimos7d: 0, elegiveis: 149, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('critico');
        expect(r.motivo).toMatch(/inoperante/);
    });

    it('caso real NF-e: 60/21, 10743 docs em 7d → OK', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 1 * H, sucessos: 60, falhas: 21,
            docsUltimos7d: 10743, elegiveis: 95, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('ok');
    });

    it('nunca executado → crítico', () => {
        expect(avaliarSaudeCaptura({
            ultimoMs: null, sucessos: null, falhas: null,
            docsUltimos7d: null, elegiveis: 10, agoraMs: AGORA,
        }).nivel).toBe('critico');
    });

    it('sem execução há >72h → crítico mesmo com docs históricos', () => {
        expect(avaliarSaudeCaptura({
            ultimoMs: AGORA - 100 * H, sucessos: 50, falhas: 0,
            docsUltimos7d: 500, elegiveis: 50, agoraMs: AGORA,
        }).nivel).toBe('critico');
    });

    it('mais falha que sucesso → atenção', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 1 * H, sucessos: 10, falhas: 30,
            docsUltimos7d: 200, elegiveis: 50, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('atencao');
    });

    it('execução 30-72h atrás → atenção', () => {
        expect(avaliarSaudeCaptura({
            ultimoMs: AGORA - 40 * H, sucessos: 50, falhas: 2,
            docsUltimos7d: 300, elegiveis: 50, agoraMs: AGORA,
        }).nivel).toBe('atencao');
    });

    it('0 docs em 7d SEM empresas elegíveis → ok (não há o que capturar)', () => {
        expect(avaliarSaudeCaptura({
            ultimoMs: AGORA - 1 * H, sucessos: 0, falhas: 0,
            docsUltimos7d: 0, elegiveis: 0, agoraMs: AGORA,
        }).nivel).toBe('ok');
    });

    it('caso real NFSe Nacional: 3 elegíveis, 0 docs, mas ADN confirma maxNSU alcançado → ATENÇÃO, não crítico', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 2 * H, sucessos: 3, falhas: 0,
            docsUltimos7d: 0, elegiveis: 3, movimentoDisponivel: false, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('atencao');
        expect(r.motivo).toMatch(/nada a capturar|maxNSU/);
    });

    it('0 docs + elegíveis + provedor TEM documento disponível (maxNSU>ultNSU) → CRÍTICO (bug real de captura)', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 1 * H, sucessos: 3, falhas: 0,
            docsUltimos7d: 0, elegiveis: 3, movimentoDisponivel: true, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('critico');
        expect(r.motivo).toMatch(/0 documentos.*7 dias/);
    });

    it('movimentoDisponivel ausente (desconhecido) mantém a rede de segurança: 0 docs + elegíveis = crítico', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 1 * H, sucessos: 5, falhas: 0,
            docsUltimos7d: 0, elegiveis: 5, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('critico');
    });

    // 27/07: run morto por deploy no meio da varredura (NFS-e SP portal).
    it('última execução INTERROMPIDA nunca é verde — âmbar com a ação (forçar captura)', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 1 * H, sucessos: null, falhas: null,
            docsUltimos7d: 40, elegiveis: 188, runInterrompido: true, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('atencao');
        expect(r.motivo).toMatch(/interrompida/i);
        expect(r.motivo).toMatch(/Forçar captura agora/i);
    });

    it('interrompida NÃO mascara problema pior: 0 docs com elegíveis segue crítico', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: AGORA - 1 * H, sucessos: null, falhas: null,
            docsUltimos7d: 0, elegiveis: 188, runInterrompido: true, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('critico');
    });
});

describe('avaliarSaudeCofreSaida (saída mod 55 pelo cofre de e-mail)', () => {
    it('cofre nunca leu a caixa → crítico', () => {
        expect(avaliarSaudeCofreSaida({
            ultimoMs: null, saida7d: null, entregando7d: null, monitoradas: 38, agoraMs: AGORA,
        }).nivel).toBe('critico');
    });

    it('cofre parado há >72h → crítico (infra da caixa)', () => {
        const r = avaliarSaudeCofreSaida({
            ultimoMs: AGORA - 100 * H, saida7d: 50, entregando7d: 20, monitoradas: 38, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('critico');
        expect(r.motivo).toMatch(/sem leitura/);
    });

    it('caso real hoje: cron roda, mas 0 saída em 7d com 38 monitoradas → crítico (trilho ocioso, adoção 0)', () => {
        const r = avaliarSaudeCofreSaida({
            ultimoMs: AGORA - 1 * H, saida7d: 0, entregando7d: 0, monitoradas: 38, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('critico');
        expect(r.motivo).toMatch(/não apontaram o emissor/);
    });

    it('entra saída mas só 1 de 38 entrega → ATENÇÃO (funciona, falta onboarding) — não verde-mentiroso', () => {
        const r = avaliarSaudeCofreSaida({
            ultimoMs: AGORA - 1 * H, saida7d: 12, entregando7d: 1, monitoradas: 38, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('atencao');
        expect(r.motivo).toMatch(/1 de 38/);
    });

    it('maioria entregando → ok', () => {
        const r = avaliarSaudeCofreSaida({
            ultimoMs: AGORA - 1 * H, saida7d: 900, entregando7d: 30, monitoradas: 38, agoraMs: AGORA,
        });
        expect(r.nivel).toBe('ok');
        expect(r.motivo).toMatch(/Recebendo saída/);
    });
});

// ── Fim de semana não é atraso (26/07: painel inteiro amarelou num domingo) ──
import { horasFimDeSemanaEntre } from '../services/capturaSaude';

describe('cadenciaSegSex — fim de semana não conta como atraso', () => {
    // Sex 24/07/2026 05:00 UTC (02:00 BRT) → Dom 26/07/2026 12:00 UTC (09:00 BRT)
    const SEX_CRON = Date.parse('2026-07-24T05:00:00Z');
    const DOM_MANHA = Date.parse('2026-07-26T12:00:00Z');

    it('horasFimDeSemanaEntre conta só sáb/dom em BRT', () => {
        // Sex 02:00 BRT → dom 09:00 BRT = 55h brutas; sábado inteiro (24h) +
        // domingo 00:00-09:00 BRT (9h) = 33h de fim de semana.
        expect(horasFimDeSemanaEntre(SEX_CRON, DOM_MANHA)).toBeCloseTo(33, 0);
        // Intervalo todo em dias úteis → 0.
        expect(horasFimDeSemanaEntre(Date.parse('2026-07-21T12:00:00Z'), Date.parse('2026-07-22T12:00:00Z'))).toBe(0);
    });

    it('domingo de manhã com cron seg-sex que rodou sexta → OK, não atraso', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: SEX_CRON, sucessos: 5, falhas: 0, docsUltimos7d: 100,
            elegiveis: 10, cadenciaSegSex: true, agoraMs: DOM_MANHA,
        });
        expect(r.nivel).toBe('ok'); // 55h brutas - 33h de fds = 22h úteis < 30h
    });

    it('sem a flag, o mesmo cenário segue como atraso (rede de segurança intacta)', () => {
        const r = avaliarSaudeCaptura({
            ultimoMs: SEX_CRON, sucessos: 5, falhas: 0, docsUltimos7d: 100,
            elegiveis: 10, agoraMs: DOM_MANHA,
        });
        expect(r.nivel).toBe('atencao');
    });
});
