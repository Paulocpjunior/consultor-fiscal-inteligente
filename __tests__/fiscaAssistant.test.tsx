import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FiscaAssistant from '../components/Fisca/FiscaAssistant';
import { EmpresaAtivaProvider } from '../services/empresaAtivaContext';
import { consultarFisca, type FiscaResposta } from '../services/fiscaService';
jest.mock('../services/fiscaService', () => ({ consultarFisca: jest.fn() }));
const consultar = consultarFisca as jest.MockedFunction<typeof consultarFisca>;
const resposta: FiscaResposta = { texto: 'Resposta da empresa A', fontes: [], contexto: { empresa: null, competencia: null, consultadoEm: '2026-10-16T12:00:00Z', fonteCadastro: null, acervo: null } };
function Tela({ id = 'a' }: { id?: string }) {
    return <EmpresaAtivaProvider empresa={{ id, nome: `Empresa ${id}`, cnpj: '12345678000199', fonte: 'simples' }} onTrocar={() => {}} onAtivar={() => {}}>
        <FiscaAssistant key={`usuario:${id}`} />
    </EmpresaAtivaProvider>;
}
function abrir() { fireEvent.click(screen.getByRole('button', { name: 'Conversar com a Físca' })); }
function enviar() { fireEvent.change(screen.getByLabelText('Mensagem para a Físca'), { target: { value: 'Minha dúvida' } }); fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' })); }
beforeEach(() => consultar.mockReset());
test('conferência só fica disponível com empresa e competência explícita', async () => {
    consultar.mockResolvedValue(resposta); render(<Tela />); abrir();
    expect(screen.getByRole('button', { name: /Conferir acervo/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Competência da conversa'), { target: { value: '2026-09' } });
    fireEvent.click(screen.getByRole('button', { name: /Conferir acervo/ }));
    await screen.findByText('Resposta da empresa A');
    expect(consultar.mock.calls[0][0]).toMatchObject({ empresaId: 'a', competencia: '2026-09', analisarAcervo: true });
});
test('troca de empresa aborta pedido e nunca apresenta resposta do cliente anterior', async () => {
    let resolver!: (value: FiscaResposta) => void;
    consultar.mockImplementation(() => new Promise(resolve => { resolver = resolve; }));
    const tela = render(<Tela />); abrir(); enviar();
    const signal = consultar.mock.calls[0][1]; tela.rerender(<Tela id="b" />); abrir();
    expect(signal.aborted).toBe(true);
    await act(async () => { resolver(resposta); });
    expect(screen.queryByText('Resposta da empresa A')).not.toBeInTheDocument(); expect(screen.getByText('Empresa b')).toBeInTheDocument();
});
test('limpar durante consulta descarta resposta pendente', async () => {
    let resolver!: (value: FiscaResposta) => void;
    consultar.mockImplementation(() => new Promise(resolve => { resolver = resolve; }));
    render(<Tela />); abrir(); enviar(); fireEvent.click(screen.getByRole('button', { name: 'Limpar conversa' }));
    await act(async () => { resolver(resposta); });
    expect(screen.queryByText('Resposta da empresa A')).not.toBeInTheDocument(); expect(screen.getByText('Olá, sou a Físca!')).toBeInTheDocument();
});
test('falha mostra erro e permite repetir a pergunta sem inventar resposta', async () => {
    consultar.mockRejectedValue(new Error('Empresa fora da carteira')); render(<Tela />); abrir(); enviar();
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Mensagem para a Físca')).toHaveValue('Minha dúvida');
    expect(screen.queryByText('Resposta da empresa A')).not.toBeInTheDocument();
});
test('Escape fecha e devolve foco ao botão', async () => {
    render(<Tela />); abrir(); fireEvent.keyDown(screen.getByLabelText('Mensagem para a Físca'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Conversar com a Físca' })).toHaveFocus());
});
