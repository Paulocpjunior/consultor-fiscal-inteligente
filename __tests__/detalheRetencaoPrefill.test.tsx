// ============================================================================
// ✍️ A RETENÇÃO "SUMIA" AO REABRIR A NOTA — o formulário nascia VAZIO sobre um
// ajuste gravado
//
// (11/09, Paulo, WALDESA · duas NFS-e da mesma prestadora, retenção informada
// à mão: *"quando eu lanço uma NF com as retenções e salvo e vou lançar a
// outra retenção na outra NF, as retenções some da outra NF"*.)
//
// O ajuste ESTAVA gravado — o R-4020 do Contábil, no print dele, trazia as
// duas notas com a retenção ajustada. O que sumia era a TELA: com o formulário
// aberto o carimbo saía de vista e os cinco campos apareciam vazios ("vazio ≠
// zero"), que se lê como "não ficou salvo" — a mesma leitura de 04/09
// (FRONTINI), agora pela porta da EDIÇÃO. A régua que só escreve, outra vez.
//
// A prova é por RENDER, clicando (20/08): varredura de fonte prova o código,
// não o que o dedo encontra.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import XmlDocumentoDetalhe from '../components/xml/XmlDocumentoDetalhe';

const AJUSTE_GRAVADO = {
    ir: 4.68, csll: 3.12,
    motivo: 'cliente emitiu sem informar a retenção',
    autor: 'colaborador@teste.com.br', em: '2026-09-11T13:00:00.000Z',
};
// CNPJs FICTÍCIOS — dado de cliente não entra no repo.
const PRESTADOR = '44555666000177';
const CHAVE_DO_AJUSTE = `${PRESTADOR}-1336030`;

const lerAjustes = jest.fn();
jest.mock('../services/xmlFiscalService', () => ({
    tirarDocumentoDaEmpresa: jest.fn(),
    marcarNotaCancelada: jest.fn(),
    desmarcarNotaCancelada: jest.fn(),
    corrigirNumeroDaNota: jest.fn(),
}));
jest.mock('../services/retencaoAjusteService', () => ({
    gravarAjusteRetencao: jest.fn(),
    removerAjusteRetencao: jest.fn(),
    lerAjustesDaCompetencia: (...a: unknown[]) => lerAjustes(...a),
}));
jest.mock('../services/cfopEscrituradoService', () => ({ gravarCfopEscriturado: jest.fn() }));
jest.mock('../services/cstEscrituradoService', () => ({ gravarCstEscriturado: jest.fn() }));

/** NFS-e TOMADA lançada pelo ✍️ (sem chave — a chave do ajuste é prestador + número). */
const NFSE_TOMADA: any = {
    id: 'digitada_emp_1336030_1_2026-08',
    tipo: 'NFSe', tipoDoc: 'NFSe', modelo: '99',
    numero: '1336030', serie: '1', direcao: 'entrada', status: 'autorizado',
    dhEmi: '2026-09-01T10:02:00-03:00', competencia: '2026-08',
    empresaCnpj: '11222333000181', empresaNome: 'TOMADORA TESTE LTDA',
    prestadorCnpj: PRESTADOR, prestadorNome: 'PRESTADORA TESTE S.A.',
    tomadorCnpj: '11222333000181', tomadorNome: 'TOMADORA TESTE LTDA',
    cnpjEmit: PRESTADOR, xNomeEmit: 'PRESTADORA TESTE S.A.',
    cnpjDest: '11222333000181', xNomeDest: 'TOMADORA TESTE LTDA',
    emitente: { cnpjCpf: PRESTADOR, nome: 'PRESTADORA TESTE S.A.', uf: 'SP' },
    destinatario: { cnpjCpf: '11222333000181', nome: 'TOMADORA TESTE LTDA', uf: 'SP' },
    valorTotal: 311.95, valorServicos: 311.95, totais: { vNF: 311.95 },
    valorPis: 5.15, valorCofins: 23.71, valorInss: 14.51,
    origem: 'digitada', itens: [],
};

beforeEach(() => { lerAjustes.mockReset(); });

describe('reabrir o formulário de retenção sobre um ajuste GRAVADO', () => {
    it('lê o ajuste pela chave da nota (prestador + número) e mostra o carimbo', async () => {
        lerAjustes.mockResolvedValue({ [CHAVE_DO_AJUSTE]: AJUSTE_GRAVADO });
        render(<XmlDocumentoDetalhe documento={NFSE_TOMADA} onClose={() => {}} />);
        expect(await screen.findByText(/Retenção INFORMADA nesta nota/)).toBeTruthy();
        expect(lerAjustes).toHaveBeenCalledWith('11222333000181', '2026-08');
        // O botão DIZ que já existe ajuste — "Informar" sobre nota já informada
        // convida a digitar tudo de novo.
        expect(screen.getByText('✍️ Editar a retenção informada')).toBeTruthy();
    });

    it('os campos abrem PREENCHIDOS com o que foi informado, e o carimbo fica à vista', async () => {
        lerAjustes.mockResolvedValue({ [CHAVE_DO_AJUSTE]: AJUSTE_GRAVADO });
        render(<XmlDocumentoDetalhe documento={NFSE_TOMADA} onClose={() => {}} />);
        fireEvent.click(await screen.findByText('✍️ Editar a retenção informada'));
        // IRRF 4,68 e CSLL 3,12 em pt-BR — o campo é TEXTO (round-trip come a vírgula).
        expect(screen.getByDisplayValue('4,68')).toBeTruthy();
        expect(screen.getByDisplayValue('3,12')).toBeTruthy();
        expect(screen.getByDisplayValue('cliente emitiu sem informar a retenção')).toBeTruthy();
        // Com o formulário ABERTO o carimbo continua na tela — era ele que sumia.
        expect(screen.getByText(/Editando a retenção já INFORMADA nesta nota/)).toBeTruthy();
        expect(screen.getByText(/colaborador@teste\.com\.br/)).toBeTruthy();
        // Campo que ninguém informou continua VAZIO (ausente ≠ zero): nada de "0,00" inventado.
        expect(screen.queryByDisplayValue('0,00')).toBeNull();
    });

    it('sem ajuste gravado o formulário abre vazio, como sempre', async () => {
        lerAjustes.mockResolvedValue({});
        render(<XmlDocumentoDetalhe documento={NFSE_TOMADA} onClose={() => {}} />);
        await waitFor(() => expect(lerAjustes).toHaveBeenCalled());
        fireEvent.click(screen.getByText('✍️ Informar retenção desta nota'));
        expect(screen.queryByText(/Editando a retenção já INFORMADA/)).toBeNull();
        expect(screen.queryByDisplayValue('4,68')).toBeNull();
    });
});
