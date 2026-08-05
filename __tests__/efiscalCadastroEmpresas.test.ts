/**
 * Parser da "Listagem do Cadastro de Empresas" do E-Fiscal (HTML/XFRX).
 *
 * Paulo, 05/08: "eu só consegui em html". Validado contra o arquivo real:
 * 1.767 empresas, todas com CNPJ, zero código duplicado, NOVA ERA=1154 e
 * S&P=1200 conferidos. Estes testes travam o layout com um recorte sintético
 * IGUAL ao real (divs posicionados; a I.E. divide a linha com o CNPJ — foi o
 * 1º bug: o rótulo vencia o valor e todo CNPJ saía vazio).
 */
import { parsearCadastroEmpresas } from '../services/efiscalCadastroEmpresasParser';

const div = (top: number, left: number, texto: string) =>
    `<div class="font3" style="position:absolute;top:${top}px;left:${left}px;height:14px;width:32px;">`
    + `<span style='white-space:pre;'>${texto}</span></div>`;

const ficha = (base: number, codigo: string, nome: string, cnpj: string, irpj = 'Lucro Presumido') => [
    div(base + 0, 560, 'Office Fiscal'),
    div(base + 33, 12, 'Listagem do Cadastro de Empresas'),
    div(base + 117, 20, 'Código'), div(base + 117, 108, codigo),
    div(base + 134, 108, nome), div(base + 135, 20, 'Nome'),
    // A linha real: valor do CNPJ em top-1, rótulo I.E. NA MESMA altura do
    // rótulo CNPJ e o valor da I.E. em top-3.
    div(base + 264, 309, '111.185.434.117'),
    div(base + 266, 108, cnpj),
    div(base + 267, 20, 'C.G.C.&#47;C.N.P.J.'), div(base + 267, 284, 'I.E.'),
    div(base + 464, 20, 'IRPJ'), div(base + 464, 149, irpj),
].join('\n');

// Páginas do XFRX reiniciam a coordenada — a 2ª ficha começa "acima" da 1ª.
const HTML = `<html><body>${ficha(40, '0001', 'BRISKA LTDA', '54.121.843&#47;0001-75')}
${ficha(40, '1154', 'COMERCIO DE FRUTAS NOVA ERA LTDA', '29.240.822&#47;0001-21', 'Estimativa')}</body></html>`;

describe('parsearCadastroEmpresas — layout real do XFRX', () => {
    const r = parsearCadastroEmpresas(HTML);

    it('uma ficha por página: código, nome, CNPJ e regime', () => {
        expect(r.empresas).toEqual([
            { codigo: '0001', nome: 'BRISKA LTDA', cnpj: '54121843000175', irpj: 'Lucro Presumido' },
            { codigo: '1154', nome: 'COMERCIO DE FRUTAS NOVA ERA LTDA', cnpj: '29240822000121', irpj: 'Estimativa' },
        ]);
    });

    it('O 1º BUG: a I.E. divide a linha do CNPJ e o rótulo não pode vencer o valor', () => {
        // Se voltasse a vencer, o CNPJ sairia '' e a carga inteira falharia.
        expect(r.empresas[0].cnpj).toBe('54121843000175');
    });

    it('zero ignoradas e zero conflitos no recorte limpo', () => {
        expect(r.ignoradas).toHaveLength(0);
        expect(r.conflitos).toHaveLength(0);
    });
});

describe('farol honesto da carga', () => {
    it('ficha sem CNPJ vira IGNORADA com o motivo — não some da conta', () => {
        const html = `<html>${ficha(40, '0009', 'SEM CNPJ LTDA', '')}</html>`;
        const r = parsearCadastroEmpresas(html);
        expect(r.empresas).toHaveLength(0);
        expect(r.ignoradas[0]).toMatchObject({ codigo: '0009', motivo: expect.stringMatching(/sem CNPJ/) });
    });

    it('mesmo CNPJ com DOIS códigos sai da carga e vira conflito (decisão humana)', () => {
        const html = `<html>${ficha(40, '0001', 'BRISKA LTDA', '54.121.843&#47;0001-75')}
            ${ficha(40, '0002', 'BRISKA LTDA', '54.121.843&#47;0001-75')}</html>`;
        const r = parsearCadastroEmpresas(html);
        expect(r.empresas).toHaveLength(0);
        expect(r.conflitos[0].codigos).toEqual(['0001', '0002']);
    });

    it('o código sai com o zero à esquerda preservado', () => {
        const r = parsearCadastroEmpresas(`<html>${ficha(40, '17', 'X LTDA', '54.121.843&#47;0001-75')}</html>`);
        expect(r.empresas[0].codigo).toBe('0017');
    });
});
