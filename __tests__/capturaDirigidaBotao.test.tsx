// ============================================================================
// 🎯 A ÚLTIMA DAS SETE ROTAS ÓRFÃS — a captura dirigida ganhou botão
//
// `/sync-targeted` existia e só o CRON a alcançava. Sem ela, forçar a captura
// de um punhado de empresas (as 🎯 prioritárias da Cobertura de Saída, a fila
// de migração) significava disparar a carteira INTEIRA.
//
// 🚨 E o botão NÃO fala com aquela rota: ela é autenticada pelo segredo do
// cron, e o segredo nunca vai ao navegador (já vazou 2× em cola de terminal).
// O botão fala com `/sync-targeted-now`, a porta de admin — mesmo desenho do
// 🚚 CT-e. O LAÇO é o mesmo dos dois lados, senão o ritmo anti-656 divergiria.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const dirigida = jest.fn();

jest.mock('../services/capturaDiagnosticoService', () => ({
    fetchCapturaDiagnostico: jest.fn(),
    forcarCapturaAgora: jest.fn(),
    capturaDirigidaAgora: (...a: unknown[]) => dirigida(...a),
}));
jest.mock('../services/manifestoService', () => ({
    manifestarPendentes: jest.fn(), listarElegiveisManifestacao: jest.fn(),
    manifestarUmaChave: jest.fn(), resetarFalhasInfraManifestacao: jest.fn(),
    resumoManifestacao: () => '',
}));

import { CapturaDirigidaCard } from '../components/CapturaDiagnosticoPanel';

describe('🎯 captura dirigida — lista de CNPJs, não a carteira inteira', () => {
    beforeEach(() => {
        dirigida.mockReset();
        jest.spyOn(window, 'confirm').mockReturnValue(true);
    });

    it('lê a colagem em qualquer forma e manda só dígitos, sem repetido', async () => {
        dirigida.mockResolvedValue({ ok: true, cnpjs: 2, minutosEstimados: 2, logId: 'abc' });
        render(<CapturaDirigidaCard />);
        fireEvent.change(screen.getByPlaceholderText(/31\.947\.349/), {
            target: { value: '31.947.349/0001-69, 44388152000189\n31947349000169' },
        });
        fireEvent.click(screen.getByText(/Forçar captura nesta lista/));
        await waitFor(() => expect(dirigida).toHaveBeenCalled());
        expect(dirigida.mock.calls[0][0]).toEqual(['31947349000169', '44388152000189']);
    });

    // O tempo é consequência do respiro anti-656 — quem clica precisa saber
    // ANTES, senão conclui que travou.
    it('diz quantos reconheceu e quanto tempo leva ANTES do clique', () => {
        render(<CapturaDirigidaCard />);
        fireEvent.change(screen.getByPlaceholderText(/31\.947\.349/), {
            target: { value: '31947349000169 44388152000189 12345678000199' },
        });
        expect(screen.getByText(/3 CNPJ\(s\) reconhecido\(s\) · ~3 min/)).toBeTruthy();
    });

    it('PERGUNTA antes — a rodada consome janela da SEFAZ', async () => {
        (window.confirm as jest.Mock).mockReturnValue(false);
        render(<CapturaDirigidaCard />);
        fireEvent.change(screen.getByPlaceholderText(/31\.947\.349/), {
            target: { value: '31947349000169' },
        });
        fireEvent.click(screen.getByText(/Forçar captura nesta lista/));
        expect(dirigida).not.toHaveBeenCalled();
    });

    // "Deploy verde" nunca foi "capturou nota" (22/07). Aqui é a mesma régua:
    // a resposta é de INÍCIO, e a tela não pode deixar isso ambíguo.
    it('a resposta diz que COMEÇOU, nunca que capturou', async () => {
        dirigida.mockResolvedValue({ ok: true, cnpjs: 1, minutosEstimados: 0, logId: 'log1' });
        const { container } = render(<CapturaDirigidaCard />);
        fireEvent.change(screen.getByPlaceholderText(/31\.947\.349/), {
            target: { value: '31947349000169' },
        });
        fireEvent.click(screen.getByText(/Forçar captura nesta lista/));
        await waitFor(() => {
            const texto = (container.textContent || '').replace(/\s+/g, ' ');
            expect(texto).toMatch(/COMEÇOU, não que capturou/);
        });
    });

    it('sem CNPJ legível DIZ a causa em vez de disparar no escuro', async () => {
        render(<CapturaDirigidaCard />);
        fireEvent.change(screen.getByPlaceholderText(/31\.947\.349/), { target: { value: 'abc 123' } });
        fireEvent.click(screen.getByText(/Forçar captura nesta lista/));
        await waitFor(() => expect(screen.getByText(/Cole ao menos um CNPJ/)).toBeTruthy());
        expect(dirigida).not.toHaveBeenCalled();
    });

    it('recusa do backend sai NOMEADA (ex.: acima do teto de 30)', async () => {
        dirigida.mockResolvedValue({ ok: false, motivo: 'São 40 CNPJs e o máximo por rodada é 30' });
        render(<CapturaDirigidaCard />);
        fireEvent.change(screen.getByPlaceholderText(/31\.947\.349/), {
            target: { value: '31947349000169' },
        });
        fireEvent.click(screen.getByText(/Forçar captura nesta lista/));
        await waitFor(() => expect(screen.getByText(/o máximo por rodada é 30/)).toBeTruthy());
    });

    it('e a tela avisa que a rodada PARA no 656 — insistir contra o limite piora', () => {
        const { container } = render(<CapturaDirigidaCard />);
        expect((container.textContent || '')).toMatch(/PARA no primeiro cStat 656/);
    });
});
