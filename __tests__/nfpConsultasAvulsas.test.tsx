// ============================================================================
// 🚨 AS TRÊS ROTAS DO NFP GANHARAM BOTÃO (Paulo, 22/08: "e NFP tbm deve ser
// corrigido")
//
// `/situacao-fiscal`, `/divida-ativa` e `/cnds-publicas` existiam no backend e
// a tela do NFP só chamava `/analise-completa`. A completa é um allSettled de
// CINCO consultas: quando UMA caía, ou se refazia a varredura inteira —
// queimando quota PAGA nas quatro que já tinham dado certo — ou se ficava sem
// o pedaço.
//
// 📌 A prova é por RENDER, não por varredura de fonte (lição de 20/08: a
// varredura dizia que o campo do cérebro do CFOP estava certo e o dedo do
// Paulo não o encontrava).
// ============================================================================
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const situacao = jest.fn();
const divida = jest.fn();
const cnds = jest.fn();

jest.mock('../services/nfpProCloudService', () => ({
    consultarSituacaoFiscal: (...a: unknown[]) => situacao(...a),
    consultarDividaAtiva: (...a: unknown[]) => divida(...a),
    consultarCndsPublicas: (...a: unknown[]) => cnds(...a),
}));

import ConsultasAvulsas from '../components/NfpProCloud/ConsultasAvulsas';

const CNPJ = '31.947.349/0001-69';

describe('🚨 NFP — as três consultas avulsas existem na TELA', () => {
    beforeEach(() => { situacao.mockReset(); divida.mockReset(); cnds.mockReset(); });

    it('cada botão chama a SUA rota, com o CNPJ só em dígitos', async () => {
        situacao.mockResolvedValue({ ok: true, pendencias: [] });
        render(<ConsultasAvulsas cnpj={CNPJ} />);
        fireEvent.click(screen.getByText(/Situação fiscal/));
        await waitFor(() => expect(situacao).toHaveBeenCalledWith('31947349000169'));
        expect(divida).not.toHaveBeenCalled();
        expect(cnds).not.toHaveBeenCalled();
    });

    it('dívida ativa e CNDs são botões PRÓPRIOS — repetir UMA é o motivo da tela', async () => {
        divida.mockResolvedValue({ ok: true, inscricoes: [] });
        cnds.mockResolvedValue({ certidoes: [] });
        render(<ConsultasAvulsas cnpj={CNPJ} />);
        fireEvent.click(screen.getByText(/Dívida ativa/));
        await waitFor(() => expect(divida).toHaveBeenCalledWith('31947349000169'));
        fireEvent.click(screen.getByText(/CNDs/));
        await waitFor(() => expect(cnds).toHaveBeenCalledWith('31947349000169'));
    });

    // Quem clica precisa saber qual clique gasta dinheiro. SERPRO é pago por
    // consulta; portal público, não.
    it('a tela DIZ qual consulta consome quota paga', () => {
        render(<ConsultasAvulsas cnpj={CNPJ} />);
        expect(screen.getByText(/Situação fiscal · SERPRO/)).toBeTruthy();
        expect(screen.getByText(/Dívida ativa da União · SERPRO/)).toBeTruthy();
        expect(screen.getByText(/CNDs \(portais públicos\) · público/)).toBeTruthy();
    });

    // Prometer gravação que não acontece é a família do "Já importado" sem
    // estado: a pessoa vê o número e conclui que ele entrou no plano de ação.
    it('e DIZ que é consulta pura — não grava a análise', () => {
        const { container } = render(<ConsultasAvulsas cnpj={CNPJ} />);
        const texto = (container.textContent || '').replace(/\s+/g, ' ');
        expect(texto).toMatch(/consulta pura/i);
        expect(texto).toMatch(/não grava/i);
    });

    it('resultado vazio NÃO é lido como "nada devido" — ausência não é prova', async () => {
        situacao.mockResolvedValue({ ok: true, pendencias: [] });
        const { container } = render(<ConsultasAvulsas cnpj={CNPJ} />);
        fireEvent.click(screen.getByText(/Situação fiscal/));
        await waitFor(() => {
            const texto = (container.textContent || '').replace(/\s+/g, ' ');
            expect(texto).toMatch(/não prova que não há débito ou pendência/);
        });
    });

    it('sem CNPJ o botão DIZ a causa em vez de consultar no escuro', async () => {
        render(<ConsultasAvulsas cnpj="" />);
        fireEvent.click(screen.getByText(/Situação fiscal/));
        await waitFor(() => expect(screen.getByText(/Selecione uma empresa/)).toBeTruthy());
        expect(situacao).not.toHaveBeenCalled();
    });

    it('falha do órgão sai NOMEADA, nunca como resultado vazio', async () => {
        divida.mockRejectedValue(new Error('SERPRO indisponível (503)'));
        render(<ConsultasAvulsas cnpj={CNPJ} />);
        fireEvent.click(screen.getByText(/Dívida ativa/));
        await waitFor(() => expect(screen.getByText(/SERPRO indisponível \(503\)/)).toBeTruthy());
    });
});
