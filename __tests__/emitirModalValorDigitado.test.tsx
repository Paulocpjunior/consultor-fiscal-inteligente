// ============================================================================
// 🚨 "1.500,00" era EMITIDO como R$ 1,50.
//
// `parseFloat(valor.replace(',', '.'))` lia "1.500,00" como 1.5 — e a NFS-e
// Nacional é documento fiscal: emitida, não se desfaz. O modal passou a ler
// pelo dono (`parseValorMoeda`) e o ilegível é RECUSA nomeando o campo, sem
// chamar o serviço. Provado RENDERIZANDO e digitando, como o dedo faz.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const emitir = jest.fn(async (..._a: unknown[]) => ({ numero: '77' }));
jest.mock('../services/nfseNacionalService', () => ({
    emitirNfse: (...a: unknown[]) => emitir(...a),
    getNbsCodigos: jest.fn(async () => []),
    formatBRL: (n: number) => `R$ ${n.toFixed(2)}`,
}));
jest.mock('../components/dialog/DialogProvider', () => ({ useConfirm: () => jest.fn(async () => true) }));

import EmitirModal from '../components/NfseNacional/EmitirModal';

const empresa = { id: 'e1', cnpj: '12345678000199', nome: 'EMPRESA TESTE' } as never;

function preencher(valor: string) {
    fireEvent.change(screen.getByPlaceholderText('00.000.000/0001-00'), { target: { value: '11222333000181' } });
    fireEvent.change(screen.getByPlaceholderText('Nome / Razão social do tomador'), { target: { value: 'TOMADOR' } });
    fireEvent.change(screen.getByPlaceholderText(/Descrição detalhada/), { target: { value: 'Serviço' } });
    fireEvent.change(screen.getByPlaceholderText('1500,00'), { target: { value: valor } });
}

describe('EmitirModal lê o valor pelo dono', () => {
    beforeEach(() => emitir.mockClear());

    it('"1.500,00" emite por 1500 — nunca por 1,50', async () => {
        const toast = jest.fn();
        render(<EmitirModal empresa={empresa} currentUser={null} onClose={() => undefined} onShowToast={toast} />);
        preencher('1.500,00');
        fireEvent.click(screen.getByText('📑 Emitir NFSe'));
        await waitFor(() => expect(emitir).toHaveBeenCalled());
        const payload = (emitir.mock.calls[0] as unknown[])[1] as { servico: { valor: number; aliquotaIss: number } };
        expect(payload.servico.valor).toBe(1500);
        expect(payload.servico.aliquotaIss).toBe(5);
    });

    it('valor ilegível RECUSA nomeando o campo e NÃO chama o serviço', async () => {
        const toast = jest.fn();
        render(<EmitirModal empresa={empresa} currentUser={null} onClose={() => undefined} onShowToast={toast} />);
        preencher('mil e quinhentos');
        fireEvent.click(screen.getByText('📑 Emitir NFSe'));
        await waitFor(() => expect(toast).toHaveBeenCalled());
        expect(toast.mock.calls[0][0]).toMatch(/Não entendi o valor.*mil e quinhentos.*Nada foi emitido/);
        expect(emitir).not.toHaveBeenCalled();
    });
});
