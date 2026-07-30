/**
 * Catálogo do banco (Sistema → Banco de dados, dev-only — Paulo 30/07):
 * toda coleção com dono; órfãs e sem-uso detectadas; delta de crescimento.
 */
// @ts-expect-error — modulo .js puro
import { CATALOGO_BANCO, catalogarColecoes, calcularDeltas } from '../sefaz-backend/catalogo-banco.js';

describe('catálogo do banco', () => {
    it('sem coleção duplicada e todo item com grupo + funcionalidade', () => {
        const nomes = CATALOGO_BANCO.map((c: any) => c.colecao);
        expect(new Set(nomes).size).toBe(nomes.length);
        for (const c of CATALOGO_BANCO) {
            expect(c.colecao).toMatch(/^[a-z0-9_]+$/);
            expect(c.grupo.length).toBeGreaterThan(2);
            expect(c.funcionalidade.length).toBeGreaterThan(5);
        }
    });

    it('cobre as coleções-núcleo do app', () => {
        const nomes = new Set(CATALOGO_BANCO.map((c: any) => c.colecao));
        for (const core of ['documentos_fiscais', 'sefaz_state', 'simples_empresas', 'lucro_empresas', 'users', 'impostos_enviados']) {
            expect(nomes.has(core)).toBe(true);
        }
    });

    it('catalogarColecoes separa: existentes, órfãs e catalogadas sem uso', () => {
        const reais = ['documentos_fiscais', 'users', 'colecao_misteriosa_x'];
        const r = catalogarColecoes(reais);
        expect(r.linhas.map((l: any) => l.colecao).sort()).toEqual(['documentos_fiscais', 'users']);
        expect(r.foraDoCatalogo).toEqual(['colecao_misteriosa_x']);
        expect(r.catalogadasSemUso).toContain('sefaz_state');
        expect(r.catalogadasSemUso).not.toContain('users');
    });

    it('calcularDeltas: diferença quando há snapshot; null quando coleção é nova', () => {
        const deltas = calcularDeltas({ a: 100, b: 50 }, { a: 130, b: 50, c: 7 });
        expect(deltas).toEqual({ a: 30, b: 0, c: null });
        expect(calcularDeltas(null, { a: 5 })).toEqual({ a: null });
    });
});
