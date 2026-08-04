/**
 * A VARREDURA precisa ler o documento com a MESMA régua da apuração.
 *
 * Caso 04/08: depois de corrigir `difal-aquisicao.js`, o painel de UM cliente
 * já achava a nota — mas a tela de varredura continuava dizendo
 * "1 cliente(s) com compra interestadual", porque a ROTA da varredura tinha a
 * leitura antiga (só `emitente.uf`) e uma projeção `.select()` que nem trazia
 * os campos achatados. Corrigir a apuração e esquecer a varredura deixa o
 * cliente invisível na porta de entrada.
 *
 * Estes testes travam a régua sobre o SHAPE que a projeção devolve.
 */
import {
    cnpjEmitente, ufEmitente, modeloDoDoc,
} from '../sefaz-backend/participante-doc-helper.js';

/** Shape do `.select()` da varredura para uma nota capturada da SEFAZ. */
const projecaoCapturaSefaz = {
    empresaId: 'emp1',
    status: 'autorizado',
    valorTotal: 945.43,
    chave: '33260608825779000196550010001104971117647682',
    cnpjEmit: '08825779000196',
    totais: { vST: 0 },
    // sem `modelo`, sem objeto `emitente`, sem `ufEmit` — é o caso real
};

/** Shape do `.select()` para uma nota importada por XML. */
const projecaoImportacaoXml = {
    empresaId: 'emp2',
    status: 'autorizado',
    modelo: '55',
    valorTotal: 651.67,
    chave: '31260600000000000000550010000954271000000000',
    emitente: { cnpjCpf: '11111111000111', uf: 'MG' },
    totais: { vST: 0 },
};

describe('régua da varredura sobre a projeção do Firestore', () => {
    it('nota capturada da SEFAZ é reconhecida (era descartada em silêncio)', () => {
        expect(cnpjEmitente(projecaoCapturaSefaz)).toBe('08825779000196');
        expect(ufEmitente(projecaoCapturaSefaz)).toBe('RJ');   // cUF 33 da chave
        expect(modeloDoDoc(projecaoCapturaSefaz)).toBe('55');  // modelo da chave
    });

    it('nota importada por XML continua funcionando', () => {
        expect(cnpjEmitente(projecaoImportacaoXml)).toBe('11111111000111');
        expect(ufEmitente(projecaoImportacaoXml)).toBe('MG');
        expect(modeloDoDoc(projecaoImportacaoXml)).toBe('55');
    });

    it('a projeção PRECISA trazer chave e cnpjEmit — sem eles a régua não tem fonte', () => {
        // Contra-teste: é isto que acontecia com o .select() antigo.
        const projecaoAntiga = { empresaId: 'emp1', status: 'autorizado', valorTotal: 945.43 };
        expect(cnpjEmitente(projecaoAntiga)).toBe('');
        expect(ufEmitente(projecaoAntiga)).toBe('');
    });
});
