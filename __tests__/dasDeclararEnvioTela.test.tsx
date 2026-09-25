// ============================================================================
// 📤 A PORTA DO "JÁ ENVIEI POR FORA" NA CENTRAL DE DAS — provada por RENDER
//
// O que importa é o que o dedo do colaborador encontra: a lista das guias que
// vão ser declaradas, o aviso de que o app NÃO envia nada e NÃO marca
// pagamento, o botão que só libera com meio + data + texto, e o resultado do
// backend na tela (inclusive as puladas, ditas).
// ============================================================================
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DeclararEnvioModal from '../components/Das/DeclararEnvioModal';

const declararEnvioDasForaDoApp = jest.fn();
jest.mock('../services/dasService', () => ({
    declararEnvioDasForaDoApp: (...a: unknown[]) => declararEnvioDasForaDoApp(...a),
    formatBRL: (v: number) => `R$ ${v.toFixed(2)}`,
}));
jest.mock('../services/envioImpostoService', () => ({
    meiosForaDoApp: jest.fn(async () => [
        { id: 'whatsapp-pessoal', label: 'WhatsApp pessoal / do escritório' },
        { id: 'outro', label: 'Outro meio (escreva qual)' },
    ]),
}));

const guia = (id: string, extra: Record<string, unknown> = {}) => ({
    id, empresaId: `e-${id}`, empresaCnpj: '11111111000191', empresaNome: `EMPRESA ${id}`,
    competencia: '2026-08', tipo: 'regular', valor: 100, numeroDocumento: '', codigoBarras: '',
    vencimento: '2026-09-20', emitidoEm: '2026-09-01', modeUsado: 'serpro', statusPagamento: 'vencido',
    ...extra,
}) as any;

describe('📤 a porta do envio declarado na Central de DAS', () => {
    beforeEach(() => declararEnvioDasForaDoApp.mockReset());

    it('lista as guias do lote e DIZ que o app não envia nem marca pagamento', async () => {
        render(<DeclararEnvioModal guias={[guia('a'), guia('b')]} currentUser={null} onClose={() => {}} />);
        expect(screen.getByText(/Já enviei estas 2 guias por fora/)).toBeTruthy();
        expect(screen.getByText(/EMPRESA a/)).toBeTruthy();
        expect(screen.getByText(/EMPRESA b/)).toBeTruthy();
        expect(screen.getByText(/não vai enviar nada/)).toBeTruthy();
        expect(screen.getByText(/pagamento continua como está/i)).toBeTruthy();
        await waitFor(() => expect(screen.getByText('WhatsApp pessoal / do escritório')).toBeTruthy());
    });

    it('o botão só libera com meio + data + texto — e manda os ids do lote', async () => {
        declararEnvioDasForaDoApp.mockResolvedValue({
            ok: true, declaradas: [{ id: 'a', empresaNome: 'EMPRESA a', competencia: '2026-08' }],
            puladas: [], erros: [], resumo: '1 guia(s) declarada(s) como enviada(s) por fora do app.',
            declaracao: { texto: 'Envio DECLARADO por ana — o app NÃO enviou esta guia.' },
        });
        const onDeclarado = jest.fn();
        render(<DeclararEnvioModal guias={[guia('a')]} currentUser={null} onClose={() => {}} onDeclarado={onDeclarado} />);
        await waitFor(() => expect(screen.getByText('WhatsApp pessoal / do escritório')).toBeTruthy());

        const botao = screen.getByRole('button', { name: /Registrar o envio/ }) as HTMLButtonElement;
        expect(botao.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('Por qual meio?'), { target: { value: 'whatsapp-pessoal' } });
        fireEvent.change(screen.getByLabelText('Quando a guia saiu?'), { target: { value: '2026-09-10' } });
        expect(botao.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('Como a guia chegou ao cliente?'), { target: { value: 'Mandei pelo WhatsApp do escritório.' } });
        expect(botao.disabled).toBe(false);

        fireEvent.click(botao);
        await waitFor(() => expect(declararEnvioDasForaDoApp).toHaveBeenCalledTimes(1));
        expect(declararEnvioDasForaDoApp.mock.calls[0][1]).toMatchObject({
            dasIds: ['a'], meio: 'whatsapp-pessoal', quando: '2026-09-10', comoFoi: 'Mandei pelo WhatsApp do escritório.',
        });
        await waitFor(() => expect(screen.getByText(/NÃO enviou esta guia/)).toBeTruthy());
        expect(onDeclarado).toHaveBeenCalledTimes(1);
    });

    it('a guia que já tem envio é avisada ANTES e a pulada do backend aparece DEPOIS, com o motivo', async () => {
        declararEnvioDasForaDoApp.mockResolvedValue({
            ok: true, declaradas: [{ id: 'b', empresaNome: 'EMPRESA b', competencia: '2026-08' }],
            puladas: [{ id: 'a', empresaNome: 'EMPRESA a', competencia: '2026-08', motivo: 'Já tem envio registrado (email em 2026-09-01) — a declaração nunca sobrepõe um envio.' }],
            erros: [], resumo: '1 guia(s) declarada(s) como enviada(s) por fora do app · 1 pulada(s).',
            declaracao: { texto: 'x' },
        });
        render(<DeclararEnvioModal
            guias={[guia('a', { ultimoEnvioCliente: { canal: 'email', para: 'c@x', anexouPdf: true, enviadoPor: 'ana', enviadoEm: '2026-09-01T00:00:00Z' } }), guia('b')]}
            currentUser={null} onClose={() => {}}
        />);
        expect(screen.getByText(/1 guia\(s\) já tem envio registrado/)).toBeTruthy();
        await waitFor(() => expect(screen.getByText('WhatsApp pessoal / do escritório')).toBeTruthy());
        fireEvent.change(screen.getByLabelText('Por qual meio?'), { target: { value: 'whatsapp-pessoal' } });
        fireEvent.change(screen.getByLabelText('Como a guia chegou ao cliente?'), { target: { value: 'Mandei pelo WhatsApp do escritório.' } });
        fireEvent.click(screen.getByRole('button', { name: /Registrar o envio/ }));
        await waitFor(() => expect(screen.getByText(/nunca sobrepõe um envio/)).toBeTruthy());
    });

    it('a recusa do backend (400 com a frase do que falta) aparece na tela e nada fecha', async () => {
        declararEnvioDasForaDoApp.mockRejectedValue(new Error('Descreva como a guia chegou ao cliente (mínimo 15 caracteres)'));
        const onDeclarado = jest.fn();
        render(<DeclararEnvioModal guias={[guia('a')]} currentUser={null} onClose={() => {}} onDeclarado={onDeclarado} />);
        await waitFor(() => expect(screen.getByText('WhatsApp pessoal / do escritório')).toBeTruthy());
        fireEvent.change(screen.getByLabelText('Por qual meio?'), { target: { value: 'whatsapp-pessoal' } });
        fireEvent.change(screen.getByLabelText('Como a guia chegou ao cliente?'), { target: { value: 'curto' } });
        fireEvent.click(screen.getByRole('button', { name: /Registrar o envio/ }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/mínimo 15/));
        expect(onDeclarado).not.toHaveBeenCalled();
    });
});
