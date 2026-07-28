/**
 * Exportação IOB/SAGE — E020 campo 11 ("TIPO PARA O INVENTÁRIO").
 *
 * Caso 28/07/2026: o arquivo .FML gerou sem erro, o E-Fiscal disse "importação
 * concluída" e NADA de produto entrou — as 205 linhas E020 voltaram com
 * "Campo 11, tipo para inventário não cadastrado", e o aviso do próprio
 * E-Fiscal explica que linha com erro (X) não é importada.
 *
 * Causa: gravávamos o código 1 FIXO. Essa tabela não é oficial — cada
 * escritório cadastra os seus tipos no E-Fiscal, e um código inexistente
 * derruba a linha. O campo é OPCIONAL no layout: em branco, passa.
 */
import { exportarParaIobSage } from '../services/iobSageExportService';
import type { DocumentoFiscal } from '../types';

// posições 129..132 (1-based) do registro E020
const TIPO_INVENTARIO = [128, 132] as const;

const doc = () => ({
    id: 'd1',
    chave: '3'.repeat(20) + '55' + '1'.repeat(22),
    numero: '123',
    serie: '1',
    direcao: 'entrada',
    dhEmi: '2026-07-10T10:00:00-03:00',
    importadoEm: Date.parse('2026-07-11T10:00:00Z'),
    valorTotal: 1000,
    emitente: { cnpjCpf: '11222333000181', nome: 'FORNECEDOR LTDA', uf: 'SP', ie: '111' },
    destinatario: { cnpjCpf: '32602701000197', nome: 'CLIENTE LTDA', uf: 'SP', ie: '222' },
    itens: [
        { cProd: 'P1', xProd: 'PARAFUSO SEXTAVADO', uCom: 'UN', ncm: '73181500', cfop: '1102', quantidade: 10, valorUnitario: 100, valorTotal: 1000 },
        { cProd: 'P2', xProd: 'PORCA', uCom: 'UN', ncm: '73181600', cfop: '1102', quantidade: 5, valorUnitario: 20, valorTotal: 100 },
    ],
}) as unknown as DocumentoFiscal;

const linhasE020 = (conteudo: string) =>
    conteudo.split('\r\n').filter((l) => l.startsWith('E020'));

const campo11 = (linha: string) => linha.slice(TIPO_INVENTARIO[0], TIPO_INVENTARIO[1]);

describe('E020 campo 11 — tipo para inventário', () => {
    it('por padrão sai em BRANCO (campo opcional) — nunca um código chutado', () => {
        const r = exportarParaIobSage({ documentos: [doc()], numeroEmpresaEfiscal: 587 });
        const linhas = linhasE020(r.conteudo);
        expect(linhas.length).toBe(2);
        for (const l of linhas) expect(campo11(l)).toBe('    ');
    });

    it('REGRESSÃO: não volta a mandar "0001" (foi o que recusou 205 produtos)', () => {
        const r = exportarParaIobSage({ documentos: [doc()], numeroEmpresaEfiscal: 587 });
        for (const l of linhasE020(r.conteudo)) expect(campo11(l)).not.toBe('0001');
    });

    it('quando o escritório informa o código cadastrado, ele vai zero-preenchido', () => {
        const r = exportarParaIobSage({ documentos: [doc()], numeroEmpresaEfiscal: 587, tipoInventario: '2' });
        for (const l of linhasE020(r.conteudo)) expect(campo11(l)).toBe('0002');
    });

    it('a largura fixa do registro continua intacta (486)', () => {
        for (const tipo of ['', '2', '1234']) {
            const r = exportarParaIobSage({ documentos: [doc()], numeroEmpresaEfiscal: 587, tipoInventario: tipo });
            for (const l of linhasE020(r.conteudo)) expect(l).toHaveLength(486);
        }
    });
});
