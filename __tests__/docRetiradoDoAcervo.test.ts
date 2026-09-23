// ============================================================================
// A LÁPIDE, lida num lugar só — `docRetiradoDoAcervo` / `docContaNoLivro`
//
// Ela existe porque a retirada valia na LISTAGEM e não no ARQUIVO (10/09): os
// dois orquestradores do SPED liam `documentos_fiscais` sem olhar a lápide, e a
// nota tirada do livro continuava saindo no arquivo entregue à Receita.
// ============================================================================
import { docRetiradoDoAcervo, docContaNoLivro, CAMPOS_PARA_DOC_RETIRADO } from '../sefaz-backend/xml-metadata-helper.js';

describe('as DUAS lápides, um só fato', () => {
    it('a nota TIRADA do livro não conta', () => {
        expect(docRetiradoDoAcervo({ _deleted: true })).toBe(true);
        expect(docContaNoLivro({ _deleted: true })).toBe(false);
    });

    it('o PERDEDOR de merge não conta — e era ele que o EFD-Contribuições também ignorava', () => {
        expect(docRetiradoDoAcervo({ _merged_into: 'doc-vencedor' })).toBe(true);
        expect(docContaNoLivro({ _merged_into: 'doc-vencedor' })).toBe(false);
    });

    it('a nota REINCLUÍDA volta a contar — `_deleted: false` é a volta atrás', () => {
        expect(docRetiradoDoAcervo({ _deleted: false })).toBe(false);
        expect(docContaNoLivro({ _deleted: false })).toBe(true);
    });

    it('documento comum conta, e ausência não é lápide', () => {
        expect(docContaNoLivro({ numero: '792' })).toBe(true);
        expect(docContaNoLivro({ _merged_into: '' })).toBe(true);
        expect(docContaNoLivro({ _merged_into: null })).toBe(true);
    });

    it('nulo não derruba a régua — ela é lida em laço sobre a carteira inteira', () => {
        expect(docRetiradoDoAcervo(null)).toBe(false);
        expect(docRetiradoDoAcervo(undefined)).toBe(false);
    });

    it('a projeção declara os campos — campo fora do `.select()` some da leitura', () => {
        // A régua de 22/08 (`projecaoNaoCegaARegua`): sem o campo na projeção,
        // a lápide responde "não retirada" com toda confiança.
        expect([...CAMPOS_PARA_DOC_RETIRADO]).toEqual(['_deleted', '_merged_into']);
    });
});
