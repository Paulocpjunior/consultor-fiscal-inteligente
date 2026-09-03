/**
 * 📊 Simulador IBS/CBS — a tela renderiza, aceita um valor e mostra o resultado
 * (ou RECUSA o que não consegue ler, nomeando o campo).
 *
 * Era um `test.todo` desde sempre — cobertura prometida e nunca entregue (a
 * família do E510 "pronto" que ninguém gerava). O serviço é mockado: a conta
 * mora no backend (`/api/admin/simulador-ibs-cbs`) e o que se prova aqui é a
 * TELA — que ela chama o serviço com o número que a pessoa digitou, e que
 * valor ilegível não vira zero calado (regra de 22/08: input de valor passa
 * pelo `parseValorMoeda`, e ilegível é recusa com o campo nomeado).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../services/simuladorReformaService', () => {
    const real = jest.requireActual('../services/simuladorReformaService');
    return {
        ...real,
        simular: jest.fn(),
        explicarSimulacao: jest.fn(),
    };
});
// react-markdown é ESM; o que importa aqui não é o markdown, é a projeção.
jest.mock('../components/SafeMarkdown', () => ({
    __esModule: true,
    default: ({ text }: { text: string }) => <div>{text}</div>,
}));

import SimuladorReforma from '../components/SimuladorReforma';
import { simular } from '../services/simuladorReformaService';

const simularMock = simular as jest.MockedFunction<typeof simular>;

const PROJECAO = {
    regime: 'Presumido',
    faturamentoAnual: 1500000,
    projecoes: [
        { ano: 2026, pisAtual: 9750, cofinsAtual: 45000, cbs: 1350, ibs: 0, compensacao: 0, cargaTotal: 56100, cargaPctFaturamento: 3.74 },
        { ano: 2027, pisAtual: 0, cofinsAtual: 0, cbs: 132000, ibs: 1500, compensacao: 0, cargaTotal: 133500, cargaPctFaturamento: 8.9 },
    ],
    premissas: { 'CBS 2027': '8,8% cheia (estimativa)' },
    observacoes: ['Alíquotas cheias ainda serão fixadas pelo Senado.'],
};

describe('📊 Simulador IBS/CBS', () => {
    beforeEach(() => {
        simularMock.mockReset();
    });

    it('renderiza o formulário com o botão de simular', () => {
        render(<SimuladorReforma currentUser={null} />);
        expect(screen.getByText('📊 Simulador IBS/CBS')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Simular Reforma 2026-2033/ })).toBeInTheDocument();
    });

    it('aceita o valor digitado (pt-BR, com milhar) e mostra a projeção que o serviço devolveu', async () => {
        simularMock.mockResolvedValue(PROJECAO as any);
        render(<SimuladorReforma currentUser={null} />);

        const campo = screen.getByPlaceholderText('1000000') as HTMLInputElement;
        fireEvent.change(campo, { target: { value: '1.500.000,00' } });
        expect(campo.value).toBe('1.500.000,00'); // o campo guarda TEXTO, não re-formata

        fireEvent.click(screen.getByRole('button', { name: /Simular Reforma 2026-2033/ }));

        await waitFor(() => expect(simularMock).toHaveBeenCalledTimes(1));
        // O número que chegou ao serviço é o que a pessoa digitou — 1,5 milhão,
        // não 1,5 nem 150 milhões (a mordida do APATEL, 21/08).
        expect(simularMock.mock.calls[0][1]).toBe(1500000);
        expect(simularMock.mock.calls[0][2]).toBe('Presumido');

        expect(await screen.findByText(/Projeção 2026-2033 — Presumido/)).toBeInTheDocument();
        expect(screen.getByText('2027')).toBeInTheDocument();
        expect(screen.getByText(/Alíquotas cheias ainda serão fixadas/)).toBeInTheDocument();
    });

    it('valor ilegível é RECUSADO nomeando o campo — nada vai ao serviço', async () => {
        const toast = jest.fn();
        render(<SimuladorReforma currentUser={null} onShowToast={toast} />);

        const campo = screen.getByPlaceholderText('1000000') as HTMLInputElement;
        // "1.2.3,4,5" passa pelo filtro de caracteres do campo e NÃO é um número.
        fireEvent.change(campo, { target: { value: '1.2.3,4,5' } });
        fireEvent.click(screen.getByRole('button', { name: /Simular Reforma 2026-2033/ }));

        await waitFor(() => expect(toast).toHaveBeenCalled());
        expect(toast.mock.calls[0][0]).toMatch(/Não entendi o faturamento/);
        expect(simularMock).not.toHaveBeenCalled();
        expect(screen.queryByText(/Projeção 2026-2033/)).not.toBeInTheDocument();
    });
});
