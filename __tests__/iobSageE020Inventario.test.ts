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
import { exportarParaIobSage, numeroDaNota, serieDaNota, cfopParaEscriturar } from '../services/iobSageExportService';
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


// ────────────────────────────────────────────────────────────────────────────
// 28/07 (3ª rodada): com as notas finalmente sendo geradas, o E-Fiscal recusou
// 145 delas com "Linha E010 com tamanho inválido: esperado=977, obtido=979".
// Causa: `importadoEm` não existe nos docs da CAPTURA (o backend grava
// `createdAt`); new Date(undefined) vira Invalid Date, que formatava como
// "0NaNNaNNaN" — 10 caracteres num campo de 8, deslocando a linha inteira.
// ────────────────────────────────────────────────────────────────────────────

describe('data inválida não pode mudar a largura da linha', () => {
    const semImportadoEm = () => {
        const d: any = { ...docCapturado() };
        delete d.importadoEm;
        return d as DocumentoFiscal;
    };

    it('doc sem importadoEm gera E010 com os 977 caracteres exatos', () => {
        const r = exportarParaIobSage({ documentos: [semImportadoEm()], numeroEmpresaEfiscal: 587 });
        const e010 = r.conteudo.split('\r\n').filter((l) => l.startsWith('E010'));
        expect(e010).toHaveLength(1);
        expect(e010[0]).toHaveLength(977);
        expect(r.falhas).toHaveLength(0);
        expect(r.estatisticas.notasNoArquivo).toBe(1);
    });

    it('usa createdAt quando é ele que veio da captura', () => {
        const d: any = { ...docCapturado(), createdAt: '2026-07-11T10:00:00Z' };
        delete d.importadoEm;
        const r = exportarParaIobSage({ documentos: [d as DocumentoFiscal], numeroEmpresaEfiscal: 587 });
        const e010 = r.conteudo.split('\r\n').find((l) => l.startsWith('E010'))!;
        expect(e010).toContain('20260711');
        expect(e010).toHaveLength(977);
    });

    it('REGRESSÃO: data inválida vira campo em branco, nunca "NaN"', () => {
        const d: any = { ...docCapturado(), importadoEm: 'data-quebrada', dhEmi: 'xx' };
        const r = exportarParaIobSage({ documentos: [d as DocumentoFiscal], numeroEmpresaEfiscal: 587 });
        for (const linha of r.conteudo.split('\r\n')) {
            if (!linha) continue;
            expect(linha).not.toContain('NaN');
        }
    });

    it('TODAS as linhas do arquivo respeitam a largura do seu registro', () => {
        const TAMANHOS: Record<string, number> = {
            E001: 15, E010: 977, E020: 486, E200: 422, E201: 284, E221: 340, E222: 594, E342: 135,
        };
        const r = exportarParaIobSage({ documentos: [semImportadoEm()], numeroEmpresaEfiscal: 587 });
        for (const linha of r.conteudo.split('\r\n')) {
            if (!linha || linha === '\x1A') continue;
            const reg = linha.slice(0, 4);
            if (TAMANHOS[reg]) expect(linha.replace(/\x1A$/, '')).toHaveLength(TAMANHOS[reg]!);
        }
    });
});


// ────────────────────────────────────────────────────────────────────────────
// 29/07: com as notas entrando, o E-Fiscal apontou 3 erros — e os números se
// explicam entre si:
//   89× E201 campo 08 — "CFOP inválido para o tipo de nota. Informe um CFOP
//        de entradas (1, 2 e 3)" → mandávamos o CFOP do EMITENTE (5xxx/6xxx).
//   56× E200 campo 06 — "só pode conter números e deve ser maior que 0"
//        → notas sem `numero` no documento iam com zero.
//  145× E342 — "nota fiscal não cadastrada" = 89 + 56: toda nota recusada
//        deixa a chave órfã. Corrigidas as duas causas, o E342 se resolve.
// ────────────────────────────────────────────────────────────────────────────

/** Chave real: cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) resto(10). */
const chaveCom = (serie: string, numero: string) =>
    '35' + '2607' + '32602701000197' + '55'
    + serie.padStart(3, '0') + numero.padStart(9, '0') + '1'.repeat(10);

describe('número da nota — resgate pela chave de acesso', () => {
    it('usa o número do documento quando existe', () => {
        expect(numeroDaNota({ numero: '4321', chave: chaveCom('1', '209514') } as any)).toBe(4321);
    });

    it('sem número no documento, extrai da chave (posições 26-34)', () => {
        expect(numeroDaNota({ chave: chaveCom('1', '209514') } as any)).toBe(209514);
        expect(serieDaNota({ chave: chaveCom('7', '209514') } as any)).toBe('7');
    });

    it('REGRESSÃO: E200 não sai mais com número zerado', () => {
        const d: any = { ...docCapturado(), numero: '', chave: chaveCom('1', '209514') };
        const r = exportarParaIobSage({ documentos: [d as DocumentoFiscal], numeroEmpresaEfiscal: 587 });
        const e200 = r.conteudo.split('\r\n').find((l) => l.startsWith('E200'))!;
        expect(e200.slice(15, 25)).toBe('0000209514');
    });
});

describe('CFOP de ENTRADA (E201 campo 08 / E222)', () => {
    it('converte o CFOP do emitente no de entrada', () => {
        expect(cfopParaEscriturar('6102', 'entrada')[0]).toBe('2');
        expect(cfopParaEscriturar('5101', 'entrada')[0]).toBe('1');
        expect(cfopParaEscriturar('7101', 'entrada')[0]).toBe('3');
    });

    it('saída mantém o CFOP original (é a operação da própria empresa)', () => {
        expect(cfopParaEscriturar('5102', 'saida')).toBe('5102');
    });

    it('REGRESSÃO: E201 e E222 não saem mais com CFOP 5xxx/6xxx numa entrada', () => {
        const d: any = {
            ...docCapturado(),
            itens: [{ ...(docCapturado() as any).itens[0], cfop: '6102' }],
        };
        const r = exportarParaIobSage({ documentos: [d as DocumentoFiscal], numeroEmpresaEfiscal: 587 });
        const linhas = r.conteudo.split('\r\n');
        const e201 = linhas.find((l) => l.startsWith('E201'))!;
        const e222 = linhas.find((l) => l.startsWith('E222'))!;
        expect(e201).toMatch(/2102/);
        expect(e201).not.toMatch(/6102/);
        expect(e222).toMatch(/2102/);
    });
});
