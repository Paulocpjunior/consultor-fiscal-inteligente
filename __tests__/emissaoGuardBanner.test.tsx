// ============================================================================
// 🚨 O FREIO DE EMISSÃO SÓ SE VIA ABRINDO O CLOUD RUN
//
// `/guard-status` existia e nenhuma tela a chamava (varredura de rotas, 22/08)
// — e o comentário da própria rota dizia que ela existe para "admin ver quais
// tipos estão bloqueados sem precisar abrir o Cloud Run".
//
// Com o freio ligado, quem emite recebe HTTP 423 com uma frase que parece
// defeito do app: a pessoa reporta erro, alguém investiga, e a causa é uma env
// var que ninguém no escritório consegue consultar.
// ============================================================================
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const guard = jest.fn();
jest.mock('../services/taxEmissionService', () => ({
    getGuardStatus: (...a: unknown[]) => guard(...a),
}));

import EmissaoGuardBanner from '../components/TaxEmission/EmissaoGuardBanner';

describe('🚨 freio de emissão — o estado aparece na tela de quem emite', () => {
    beforeEach(() => guard.mockReset());

    it('bloqueado sai VERMELHO, nomeando o tipo E a chave que destrava', async () => {
        guard.mockResolvedValue({
            tudoBloqueado: false,
            porTipo: { DAS: false, DARF: true, DCTFWEB: false, NFSE_NAC: false },
        });
        render(<EmissaoGuardBanner currentUser={null} />);
        await waitFor(() => expect(screen.getByText(/Emissão BLOQUEADA: DARF/)).toBeTruthy());
        // Trava sem caminho é trava que a equipe contorna: a chave vai na frase.
        expect(screen.getByText(/EMISSAO_BLOQUEADA_DARF/)).toBeTruthy();
    });

    it('freio GERAL nomeia a chave geral, não uma por tipo', async () => {
        guard.mockResolvedValue({
            tudoBloqueado: true,
            porTipo: { DAS: true, DARF: true, DCTFWEB: true, NFSE_NAC: true },
        });
        const { container } = render(<EmissaoGuardBanner currentUser={null} />);
        await waitFor(() => expect(screen.getByText(/freio geral ligado/)).toBeTruthy());
        expect((container.textContent || '')).toContain('EMISSAO_BLOQUEADA');
        expect((container.textContent || '')).not.toContain('EMISSAO_BLOQUEADA_DAS');
    });

    // Alarme permanente em estado normal é o que ensina a ignorar alarme.
    it('liberado sai DISCRETO — uma linha, sem caixa vermelha', async () => {
        guard.mockResolvedValue({
            tudoBloqueado: false,
            porTipo: { DAS: false, DARF: false, DCTFWEB: false, NFSE_NAC: false },
        });
        render(<EmissaoGuardBanner currentUser={null} />);
        await waitFor(() => expect(screen.getByText(/Freio de emissão desligado/)).toBeTruthy());
        expect(screen.queryByText(/BLOQUEADA/)).toBeNull();
    });

    // A régua de sempre: falha de leitura não vira afirmação.
    it('falha ao consultar NÃO vira "liberado" — diz que não conferiu', async () => {
        guard.mockResolvedValue(null);
        const { container } = render(<EmissaoGuardBanner currentUser={null} />);
        await waitFor(() => expect(screen.getByText(/não foi possível conferir/)).toBeTruthy());
        const texto = (container.textContent || '').replace(/\s+/g, ' ');
        expect(texto).toMatch(/não quer dizer que a emissão está liberada/);
    });
});
