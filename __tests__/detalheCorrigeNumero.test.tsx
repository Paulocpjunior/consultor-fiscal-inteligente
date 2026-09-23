// ============================================================================
// ✏️ A PORTA PARA CORRIGIR O NÚMERO DA NOTA DIGITADA — provada por RENDER
//
// (10/09, Paulo, HANAMI EMBALAGENS: *"O correto seria 9792, oq eu posso fazer
// nesse caso?"*)
//
// A prova é CLICANDO, nunca por varredura de fonte — a lição de 20/08: o campo
// do cérebro do CFOP existia, a varredura dizia que estava certo, e o dedo do
// dono não o achava. E vale dobrado aqui, porque a saída que já existia
// (a retirada) tinha o RÓTULO errado: ela se chamava *"Esta nota não é desta
// empresa"*, o que é FALSO no caso — a nota É da empresa, o número é que está
// errado. Quem lê aquilo conclui, com razão, que o botão não serve.
//
// CNPJs FICTÍCIOS — dado de cliente não entra no repo.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import XmlDocumentoDetalhe from '../components/xml/XmlDocumentoDetalhe';

jest.mock('../services/xmlFiscalService', () => ({
    tirarDocumentoDaEmpresa: jest.fn(),
    marcarNotaCancelada: jest.fn(),
    desmarcarNotaCancelada: jest.fn(),
    corrigirNumeroDaNota: jest.fn(async () => ({ ok: true, mensagem: 'ok' })),
}));
jest.mock('../services/retencaoAjusteService', () => ({
    gravarAjusteRetencao: jest.fn(),
    removerAjusteRetencao: jest.fn(),
    lerAjustesDaCompetencia: jest.fn(async () => ({})),
}));
jest.mock('../services/cfopEscrituradoService', () => ({ gravarCfopEscriturado: jest.fn() }));
jest.mock('../services/cstEscrituradoService', () => ({ gravarCstEscriturado: jest.fn() }));

/** A nota do caso: NF-e de SAÍDA lançada à mão, sem chave. */
const DIGITADA: any = {
    id: 'digitada_emp-1_792_1_2026-08',
    tipo: 'NFe',
    tipoDoc: 'NFe',
    numero: '792',
    serie: '1',
    chave: '',
    direcao: 'saida',
    status: 'autorizado',
    dhEmi: '2026-08-23T10:00:00-03:00',
    competencia: '2026-08',
    empresaId: 'emp-1',
    empresaNome: 'HANAMI TESTE LTDA',
    empresaCnpj: '11222333000181',
    cnpjEmit: '11222333000181',
    xNomeEmit: 'HANAMI TESTE LTDA',
    cnpjDest: '44555666000177',
    xNomeDest: 'CLIENTE TESTE LTDA',
    totais: { vNF: 3545.85 },
    valorTotal: 3545.85,
    origem: 'digitada',
    itens: [{ nItem: '1', cfop: '5102', xProd: 'MERCADORIA', vProd: 3545.85 }],
};

const BOTAO = /Corrigir o número desta nota/;

describe('a porta aparece onde ela resolve', () => {
    it('nota lançada à mão e sem chave OFERECE a correção', () => {
        render(<XmlDocumentoDetalhe documento={DIGITADA} onClose={() => {}} />);
        expect(screen.getByText(BOTAO)).toBeTruthy();
    });

    it('nota com XML NÃO oferece — o número é o que o documento declara', () => {
        render(<XmlDocumentoDetalhe documento={{ ...DIGITADA, origem: 'sefaz' }} onClose={() => {}} />);
        expect(screen.queryByText(BOTAO)).toBeNull();
    });

    it('nota digitada COM chave NÃO oferece — a chave já declara o número', () => {
        render(<XmlDocumentoDetalhe documento={{ ...DIGITADA, chave: '3'.repeat(44) }} onClose={() => {}} />);
        expect(screen.queryByText(BOTAO)).toBeNull();
    });
});

describe('o que a tela DIZ antes do clique', () => {
    it('abre com o número atual preenchido e a consequência escrita', () => {
        const { container } = render(<XmlDocumentoDetalhe documento={DIGITADA} onClose={() => {}} />);
        fireEvent.click(screen.getByText(BOTAO));
        const campo = container.querySelector('input[placeholder="9792"]') as HTMLInputElement;
        expect(campo).toBeTruthy();
        expect(campo.value).toBe('792');
        // 🚨 A LINHA QUE IMPEDE A DUPLICATA: a antiga sai NO MESMO ATO.
        expect(container.textContent).toMatch(/no mesmo ato/);
        expect(container.textContent).toMatch(/não conta duas vezes/i);
    });
});

describe('o rótulo da retirada nomeia as DUAS causas', () => {
    it('não diz mais só "não é desta empresa" — quem lançou errado também usa esta saída', () => {
        const { container } = render(<XmlDocumentoDetalhe documento={DIGITADA} onClose={() => {}} />);
        expect(screen.getByText(/Tirar esta nota do livro/)).toBeTruthy();
        expect(container.textContent).toMatch(/duplicata/i);
    });
});

describe('a nota já corrigida diz o que ACONTECEU com ela', () => {
    it('mostra "corrigida", nunca "tirada desta empresa"', () => {
        const enterrada = {
            ...DIGITADA,
            _deleted: true,
            _corrigidaPara: 'digitada_emp-1_9792_1_2026-08',
            _corrigidaParaNumero: '9792',
            _deletedEm: '2026-09-10T15:00:00.000Z',
            _deletedPorEmail: 'colaborador@exemplo.com.br',
        };
        const { container } = render(<XmlDocumentoDetalhe documento={enterrada} onClose={() => {}} />);
        expect(container.textContent).toMatch(/Nota corrigida/);
        expect(container.textContent).toMatch(/9792/);
        expect(container.textContent).not.toMatch(/Nota tirada desta empresa/);
    });
});
