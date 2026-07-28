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


// ────────────────────────────────────────────────────────────────────────────
// 28/07 (2ª rodada): o E-Fiscal disse "importação feita com sucesso" e as
// Notas Fiscais de Entrada continuaram VAZIAS. O .FML tinha E001 + 204 E020 e
// NENHUM E200 — só o cadastro de produtos. Causa: o exportador só reconhecia
// o participante nos objetos `emitente`/`destinatario`, mas a CAPTURA grava
// achatado (cnpjEmit/cnpjDest/xNomeEmit) — e a exceção virava console.warn.
// ────────────────────────────────────────────────────────────────────────────

/** Documento como a CAPTURA grava: participante achatado, sem objetos. */
const docCapturado = () => ({
    id: 'd2',
    chave: '35' + '2607' + '32602701000197' + '55' + '1'.repeat(22),
    numero: '4321',
    serie: '1',
    direcao: 'entrada',
    dhEmi: '2026-07-10T10:00:00-03:00',
    importadoEm: Date.parse('2026-07-11T10:00:00Z'),
    valorTotal: 500,
    cnpjEmit: '11222333000181',
    xNomeEmit: 'FORNECEDOR DE TECIDOS LTDA',
    cnpjDest: '32602701000197',
    itens: [
        { cProd: 'T1', xProd: 'TECIDO OXFORD', uCom: 'MT', ncm: '54075210', cfop: '1102', quantidade: 100, valorUnitario: 5, valorTotal: 500 },
    ],
}) as unknown as DocumentoFiscal;

describe('nota capturada pela SEFAZ entra no arquivo (não só o produto)', () => {
    it('gera E200 mesmo sem os objetos emitente/destinatario', () => {
        const r = exportarParaIobSage({ documentos: [docCapturado()], numeroEmpresaEfiscal: 587 });
        const linhas = r.conteudo.split('\r\n');
        expect(linhas.filter((l) => l.startsWith('E200'))).toHaveLength(1);
        expect(linhas.filter((l) => l.startsWith('E010'))).toHaveLength(1);
        expect(linhas.filter((l) => l.startsWith('E020'))).toHaveLength(1);
        expect(r.estatisticas.notasNoArquivo).toBe(1);
        expect(r.falhas).toHaveLength(0);
    });

    it('a UF do emitente sai da chave de acesso quando não há objeto', () => {
        const r = exportarParaIobSage({ documentos: [docCapturado()], numeroEmpresaEfiscal: 587 });
        const e200 = r.conteudo.split('\r\n').find((l) => l.startsWith('E200'))!;
        expect(e200).toContain('SP'); // cUF 35
    });

    it('REGRESSÃO: arquivo com produto e NENHUMA nota não passa despercebido', () => {
        // Sem CNPJ de emitente não dá pra montar a nota. O documento tem que
        // aparecer em `falhas` — era exatamente isso que virava console.warn.
        const semEmitente = { ...docCapturado(), cnpjEmit: undefined } as unknown as DocumentoFiscal;
        const r = exportarParaIobSage({ documentos: [semEmitente], numeroEmpresaEfiscal: 587 });
        expect(r.estatisticas.notasNoArquivo).toBe(0);
        expect(r.falhas.length).toBeGreaterThan(0);
        expect(r.falhas[0]!.motivo).toMatch(/sem CNPJ do emitente/i);
        expect(r.falhas[0]!.documento).toMatch(/NF 4321/);
    });

    it('uma nota problemática não derruba as outras — e é reportada', () => {
        const ok = docCapturado();
        const ruim = { ...docCapturado(), id: 'd3', numero: '9999', cnpjEmit: undefined } as unknown as DocumentoFiscal;
        const r = exportarParaIobSage({ documentos: [ok, ruim], numeroEmpresaEfiscal: 587 });
        expect(r.estatisticas.notasNoArquivo).toBe(1);
        expect(r.falhas).toHaveLength(1);
        expect(r.falhas[0]!.documento).toMatch(/NF 9999/);
    });
});
