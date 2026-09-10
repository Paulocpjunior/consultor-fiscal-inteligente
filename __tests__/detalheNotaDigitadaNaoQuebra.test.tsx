// ============================================================================
// 🚨 A TELA MORRIA AO ABRIR A NOTA — "Cannot read properties of undefined
// (reading 'toLocaleString')"
//
// (10/09, Paulo: *"recebo essa mensagem de crash quando abro notas de saída na
// central de documentos fiscais; sempre que eu clico em uma nota fiscal ele me
// força a recarregar a página"*.)
//
// A causa é a **armadilha das duas formas** no ITEM, e ela nasceu de uma
// decisão CERTA do outro lado: o ✍️ Lançar nota sem XML grava
// `vICMS: it.vICMS !== undefined ? Number(it.vICMS) : undefined` — campo em
// branco fica FORA do objeto porque **AUSENTE ≠ ZERO** (04/09). O item
// digitado nunca tem `vUnCom`, `vPIS` nem `vCOFINS`, e o detalhe fazia
// `formatCurrency(p.vUnCom)` — que é `undefined.toLocaleString(...)`.
//
// ⚠️ O `qCom` da MESMA linha já estava guardado (`typeof p.qCom === 'number'`):
// alguém pagou este defeito uma vez e guardou só a coluna que quebrou.
//
// A prova é por RENDER, clicando (a lição de 20/08): varredura de fonte prova
// o CÓDIGO, não o que o dedo encontra.
// ============================================================================
import React from 'react';
import { render, screen } from '@testing-library/react';
import XmlDocumentoDetalhe from '../components/xml/XmlDocumentoDetalhe';

jest.mock('../services/xmlFiscalService', () => ({
    tirarDocumentoDaEmpresa: jest.fn(),
    marcarNotaCancelada: jest.fn(),
    desmarcarNotaCancelada: jest.fn(),
}));
jest.mock('../services/retencaoAjusteService', () => ({
    gravarAjusteRetencao: jest.fn(),
    removerAjusteRetencao: jest.fn(),
    lerAjustesDaCompetencia: jest.fn(async () => ({})),
}));
jest.mock('../services/cfopEscrituradoService', () => ({ gravarCfopEscriturado: jest.fn() }));
jest.mock('../services/cstEscrituradoService', () => ({ gravarCstEscriturado: jest.fn() }));

/**
 * A nota de SAÍDA como o ✍️ Lançar nota sem XML a GRAVA — item sem `vUnCom`,
 * sem `vPIS` e sem `vCOFINS`, e com `vICMS`/`vIPI` ausentes porque ninguém
 * preencheu. CNPJs FICTÍCIOS: dado de cliente não entra no repo.
 */
const NOTA_DIGITADA_SAIDA: any = {
    id: 'doc-digitada-1',
    tipo: 'NFe',
    tipoDoc: 'NFe',
    numero: '000000123',
    serie: '1',
    direcao: 'saida',
    status: 'autorizado',
    natOp: 'VENDA DE MERCADORIA',
    dhEmi: '2026-08-14T10:00:00-03:00',
    empresaCnpj: '11222333000181',
    cnpjEmit: '11222333000181',
    xNomeEmit: 'EMPRESA TESTE LTDA',
    ufEmit: 'SP',
    cnpjDest: '44555666000177',
    xNomeDest: 'CLIENTE TESTE LTDA',
    ufDest: 'SP',
    totais: { vNF: 1500 },
    valorTotal: 1500,
    origem: 'digitada',
    itens: [
        { nItem: '1', cfop: '5102', xProd: 'PRODUTO DIGITADO', vProd: 1500 },
    ],
};

describe('detalhe da nota digitada — item sem campo de valor não derruba a tela', () => {
    it('abre a nota de SAÍDA lançada à mão sem lançar exceção', () => {
        expect(() => render(
            <XmlDocumentoDetalhe documento={NOTA_DIGITADA_SAIDA} onClose={() => {}} />,
        )).not.toThrow();
        expect(screen.getByText('PRODUTO DIGITADO')).toBeTruthy();
    });

    it('campo ausente aparece como "—", NUNCA como R$ 0,00', () => {
        // 🚨 Zero num campo de valor é uma AFIRMAÇÃO ("não houve"), e é
        // justamente por isso que o lançamento manual deixa o campo de fora.
        // Imprimir R$ 0,00 aqui declararia na tela o que ninguém informou.
        const { container } = render(
            <XmlDocumentoDetalhe documento={NOTA_DIGITADA_SAIDA} onClose={() => {}} />,
        );
        const linha = screen.getByText('PRODUTO DIGITADO').closest('tr');
        expect(linha).toBeTruthy();
        const celulas = Array.from(linha!.querySelectorAll('td')).map(td => td.textContent || '');
        // Vl. Unit. · ICMS · IPI · PIS · COFINS não foram informados.
        expect(celulas.filter(t => t.trim() === '—').length).toBeGreaterThanOrEqual(5);
        // O valor que EXISTE continua saindo formatado.
        expect(container.textContent).toContain('1.500,00');
    });

    it('DIZ por que as colunas estão vazias — "—" não pode se ler como captura falhada', () => {
        // A lição de 07/08 (o `xmlHash` da NFS-e do portal): campo vazio sem
        // explicação manda procurar problema que não existe.
        const { container } = render(
            <XmlDocumentoDetalhe documento={NOTA_DIGITADA_SAIDA} onClose={() => {}} />,
        );
        expect(container.textContent).toContain('campo não informado, nunca zero');
    });
});
