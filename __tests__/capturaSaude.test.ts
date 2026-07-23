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
