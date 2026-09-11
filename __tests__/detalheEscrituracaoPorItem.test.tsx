// ============================================================================
// ✂️ A PORTA POR ITEM — provada por RENDER, clicando (Sandra, 11/09)
//
// *"aqui nesse informar CFOP e CST só consigo colocar um CFOP e um CST só"*.
// A prova é CLICANDO (a lição de 20/08): a varredura de fonte já exige o
// botão; aqui o dedo abre o ✏️, acha o ✂️, e a tabela mostra os DOIS itens com
// o que cada um recebe HOJE. CNPJs FICTÍCIOS — dado de cliente não entra no repo.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import XmlDocumentoDetalhe from '../components/xml/XmlDocumentoDetalhe';

const gravarEscrituracaoItem = jest.fn(async (..._a: any[]) => ({ cfop: '1407', cst: '60' }));
jest.mock('../services/xmlFiscalService', () => ({
    tirarDocumentoDaEmpresa: jest.fn(),
    marcarNotaCancelada: jest.fn(),
    desmarcarNotaCancelada: jest.fn(),
    corrigirNumeroDaNota: jest.fn(),
}));
jest.mock('../services/retencaoAjusteService', () => ({
    gravarAjusteRetencao: jest.fn(),
    removerAjusteRetencao: jest.fn(),
    lerAjustesDaCompetencia: jest.fn(async () => ({})),
}));
jest.mock('../services/cfopEscrituradoService', () => ({
    gravarCfopEscriturado: jest.fn(),
    gravarEscrituracaoItem: (...a: any[]) => gravarEscrituracaoItem(...a),
}));
jest.mock('../services/cstEscrituradoService', () => ({ gravarCstEscriturado: jest.fn() }));

const MISTA: any = {
    id: 'mista-1', tipo: 'NFe', tipoDoc: 'NFe', numero: '5929', serie: '1', chave: '3'.repeat(44),
    direcao: 'entrada', tpNF: '1', status: 'autorizado', dhEmi: '2026-08-10T10:00:00-03:00', competencia: '2026-08',
    empresaId: 'emp-1', empresaCnpj: '11222333000181', cnpjEmit: '44555666000177', xNomeEmit: 'FORNECEDOR TESTE',
    cnpjDest: '11222333000181', xNomeDest: 'DISTRIBUIDORA TESTE', totais: { vNF: 300 }, valorTotal: 300,
    itens: [
        { nItem: '1', cfop: '5929', cst: '060', xProd: 'PRODUTO COM ST', vProd: 100, qCom: 1 },
        { nItem: '2', cfop: '5929', cst: '000', xProd: 'PRODUTO DE CONSUMO', vProd: 200, qCom: 1 },
    ],
};

const abrir = (doc: any) => {
    const r = render(<XmlDocumentoDetalhe documento={doc} onClose={() => {}} currentUser={{ email: 'sandra@sp.com.br' } as any} />);
    fireEvent.click(screen.getByText(/Informar CFOP e CST desta nota/));
    return r;
};

describe('o ✂️ nasce onde a limitação aparecia', () => {
    it('nota com 2 itens oferece "Informar por item" dentro do ✏️', () => {
        abrir(MISTA);
        expect(screen.getByText(/Informar por item \(2 itens\)/)).toBeTruthy();
    });

    it('nota de UM item não oferece — por item e por nota seriam a mesma coisa', () => {
        abrir({ ...MISTA, itens: [MISTA.itens[0]] });
        expect(screen.queryByText(/Informar por item/)).toBeNull();
    });

    it('a tabela mostra os dois produtos e o que cada um recebe hoje', () => {
        const { container } = abrir(MISTA);
        fireEvent.click(screen.getByText(/Informar por item/));
        expect(container.textContent).toMatch(/PRODUTO COM ST/);
        expect(container.textContent).toMatch(/PRODUTO DE CONSUMO/);
        // Pela régua, 5929 na entrada vira 1929 nos dois — é isso que a Sandra corrige.
        expect((container.textContent!.match(/1929/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(container.textContent).toMatch(/O item informado vence/);
    });

    it('nota já informada por item DIZ quais itens, com o ✏️ fechado', () => {
        render(<XmlDocumentoDetalhe
            documento={{ ...MISTA, escrituracaoItens: { '1': { cfop: '1407', cst: '60', por: 'sandra@sp.com.br' } } }}
            onClose={() => {}}
        />);
        expect(screen.getByText(/1 item\(ns\) com CFOP\/CST próprios — item nº 1/)).toBeTruthy();
    });
});

describe('gravar por item chama o service UMA vez por item alterado', () => {
    it('só o item digitado é gravado; o outro não vira chamada', async () => {
        const { container } = abrir(MISTA);
        fireEvent.click(screen.getByText(/Informar por item/));
        const inputs = container.querySelectorAll('table input');
        // linha 1: CFOP e CST; linha 2: CFOP e CST
        fireEvent.change(inputs[0], { target: { value: '1407' } });
        fireEvent.change(inputs[1], { target: { value: '60' } });
        fireEvent.click(screen.getByText(/Gravar por item/));
        await screen.findByText(/1 item\(ns\) informado\(s\)/);
        expect(gravarEscrituracaoItem).toHaveBeenCalledTimes(1);
        expect((gravarEscrituracaoItem.mock.calls[0] as any[])[0]).toMatchObject({
            documentoId: 'mista-1', direcao: 'entrada', nItem: '1', cfop: '1407', cst: '60', porEmail: 'sandra@sp.com.br',
        });
    });
});
