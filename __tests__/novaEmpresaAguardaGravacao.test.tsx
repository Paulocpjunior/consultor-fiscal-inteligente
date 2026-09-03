// ============================================================================
// 🚨 "Empresa salva com sucesso!" saía ANTES de a gravação resolver.
//
// O handler chamava `onSave(...)` (assíncrono) e, na linha seguinte, o toast —
// com a gravação ainda no ar, e mesmo quando ela falhava. O formulário passou
// a AGUARDAR: sucesso só depois do resolve; falha fica escrita no próprio
// formulário e o toast de sucesso não sai.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../services/externalApiService', () => ({ fetchCnpjFromBrasilAPI: jest.fn() }));
jest.mock('../services/simplesNacionalService', () => ({ sugerirAnexoPorCnae: () => 'III', updateEmpresa: jest.fn() }));
jest.mock('../services/geminiService', () => ({ fetchCnaeSuggestions: jest.fn(async () => []), fetchCnaeDescription: jest.fn(async () => '') }));
jest.mock('../components/EmpresaDadosFiscaisModal', () => () => null);
// react-markdown é ESM puro e não transforma no jest — aqui só interessa o formulário.
jest.mock('../components/FormattedText', () => ({ FormattedText: () => null }));

import SimplesNacionalNovaEmpresa from '../components/SimplesNacionalNovaEmpresa';

function montar(onSave: (...a: unknown[]) => Promise<void>) {
    const toast = jest.fn();
    const r = render(<SimplesNacionalNovaEmpresa onSave={onSave} onCancel={() => undefined} onShowToast={toast} />);
    fireEvent.change(r.container.querySelector('#cnpj') as HTMLInputElement, { target: { value: '11.222.333/0001-81' } });
    fireEvent.change(r.container.querySelector('#nome') as HTMLInputElement, { target: { value: 'EMPRESA NOVA' } });
    fireEvent.change(r.container.querySelector('#cnae') as HTMLInputElement, { target: { value: '62' } });
    fireEvent.submit(r.container.querySelector('form') as HTMLFormElement);
    return toast;
}

describe('SimplesNacionalNovaEmpresa aguarda a gravação', () => {
    it('gravação que FALHA: erro no formulário, nenhum toast de sucesso', async () => {
        const toast = montar(async () => { throw new Error('permissão negada'); });
        await waitFor(() => expect(screen.getByText(/NÃO foi gravada/)).toBeInTheDocument());
        expect(screen.getByText(/permissão negada/)).toBeInTheDocument();
        expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/sucesso/));
    });

    it('gravação que RESOLVE: o toast sai só depois', async () => {
        let resolver: () => void = () => undefined;
        const onSave = jest.fn(() => new Promise<void>((res) => { resolver = res; }));
        const toast = montar(onSave);
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        expect(toast).not.toHaveBeenCalled();
        resolver();
        await waitFor(() => expect(toast).toHaveBeenCalledWith('Empresa salva com sucesso!'));
    });
});
