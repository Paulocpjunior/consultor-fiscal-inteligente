// ============================================================================
// 🚨 "AGORA NÃO SEI SE FOI DELA" — provado por RENDER, clicando no que a pessoa vê.
//
// 30/08: o colaborador rodou a captura com A3 da empresa 93 (SILVIO FREIRE),
// viu **"1 falha(s)"** com o motivo do cStat 656 e perguntou se a falha era
// daquela empresa. O painel não tinha como responder — e **os dois dados
// estavam no log**: o nome da empresa (`errosResumo[].nome`, gravado desde o
// #28) e a `fonte` da rodada (gravada pelo heartbeat desde sempre).
//
// 📌 E ISTO SE PROVA RENDERIZANDO, nunca por varredura do fonte — é a lição de
// 20/08 (o campo do cérebro do CFOP que a varredura dizia estar certo e o dedo
// do Paulo não achava). O que importa é o que aparece no card.
// ============================================================================
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { CronsHealth } from '../services/capturaDiagnosticoService';

const fetchCronsHealth = jest.fn();
jest.mock('../services/capturaDiagnosticoService', () => ({
    __esModule: true,
    get fetchCronsHealth() { return fetchCronsHealth; },
}));

import CronsHealthPanel from '../components/CronsHealthPanel';

const saude = (linha: Record<string, unknown>): CronsHealth => ({
    geradoEm: new Date().toISOString(),
    totalCrons: 1,
    problemas: 1,
    linhas: [{
        collection: 'sefaz_cron_logs',
        label: 'Captura NF-e (DistDFe)',
        saude: 'falha',
        tsMs: Date.now() - 2 * 60 * 60 * 1000,
        resumo: { sucessos: 0, falhas: 1, totalNovos: 0 },
        ...linha,
    }],
} as unknown as CronsHealth);

beforeEach(() => fetchCronsHealth.mockReset());

describe('🚨 o card responde "foi minha ou do cron?"', () => {
    it('mostra o NOME da empresa que falhou — o caso SILVIO FREIRE', async () => {
        fetchCronsHealth.mockResolvedValue(saude({
            motivoTop: 'SILVIO FREIRE: SEFAZ retornou cStat 656 (Consumo Indevido)',
            fonte: 'sefaz-cron-noturno',
        }));
        render(<CronsHealthPanel />);
        await waitFor(() => expect(screen.getByText(/SILVIO FREIRE/)).toBeTruthy());
    });

    it('e DIZ que a rodada foi automática — não foi ninguém clicando', async () => {
        fetchCronsHealth.mockResolvedValue(saude({
            motivoTop: 'SILVIO FREIRE: cStat 656', fonte: 'sefaz-cron-noturno',
        }));
        const { container } = render(<CronsHealthPanel />);
        await waitFor(() => expect(container.textContent).toMatch(/rodada automática/));
    });

    it('rodada de admin aparece como MANUAL — é o que separa uma da outra', async () => {
        fetchCronsHealth.mockResolvedValue(saude({ motivoTop: 'X: cStat 656', fonte: 'admin-dirigida' }));
        const { container } = render(<CronsHealthPanel />);
        await waitFor(() => expect(container.textContent).toMatch(/alguém clicou/));
    });

    // ⚠️ FONTE DESCONHECIDA SAI CRUA, nunca traduzida para "cron": rotular por
    // dedução mandaria a pessoa procurar no lugar errado.
    it('fonte desconhecida sai como veio', async () => {
        fetchCronsHealth.mockResolvedValue(saude({ motivoTop: 'X', fonte: 'trilho-novo-qualquer' }));
        const { container } = render(<CronsHealthPanel />);
        await waitFor(() => expect(container.textContent).toMatch(/trilho-novo-qualquer/));
    });

    // ⚠️ E LOG ANTIGO NÃO GANHA RÓTULO INVENTADO — ele não gravava a fonte.
    it('sem fonte, o card não afirma nada sobre quem disparou', async () => {
        fetchCronsHealth.mockResolvedValue(saude({ motivoTop: 'X: cStat 656', fonte: null }));
        const { container } = render(<CronsHealthPanel />);
        await waitFor(() => expect(container.textContent).toMatch(/cStat 656/));
        expect(container.textContent).not.toMatch(/rodada automática|alguém clicou/);
    });
});
