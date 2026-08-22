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

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 COLEÇÃO SEM DONO DECLARADO — a regra existia e só o painel denunciava
//
// A regra é de 31/07: *"toda feature nova que criar coleção adiciona a linha
// aqui no MESMO PR"*, e o painel Sistema→Banco acusa a órfã. Só que o painel
// acusa em TEMPO DE EXECUÇÃO e é dev-only — sete coleções viveram invisíveis
// (cursor e lock do CT-e, estado do ABRASF, as duas auditorias da DCTFWeb, a
// sonda do PGDAS e o log de bloqueio por horário).
//
// Coleção sem dono declarado é coleção que ninguém sabe explicar daqui a três
// meses. Esta varredura fecha a CLASSE: `.collection('x')` no backend sem linha
// no catálogo quebra a build.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 toda coleção do backend tem dono no catálogo', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { readdirSync, readFileSync, statSync } = require('fs');
    const { join } = require('path');
    const RAIZ = join(__dirname, '..', 'sefaz-backend');

    /**
     * Nomes que aparecem em `.collection(...)` e NÃO são coleção de verdade —
     * exceção declarada COM o motivo, nunca afrouxando a varredura.
     */
    const NAO_E_COLECAO: Record<string, string> = {};

    function varrer(dir: string, out: string[] = []): string[] {
        for (const nome of readdirSync(dir)) {
            if (nome.startsWith('.') || nome === 'node_modules') continue;
            const p = join(dir, nome);
            if (statSync(p).isDirectory()) varrer(p, out);
            else if (nome.endsWith('.js') && !nome.endsWith('.d.ts')) out.push(p);
        }
        return out;
    }

    it('nenhuma coleção usada fica fora do catálogo', () => {
        const catalogadas = new Set(CATALOGO_BANCO.map((c: any) => c.colecao));
        const fora: string[] = [];
        for (const arq of varrer(RAIZ)) {
            if (arq.endsWith('catalogo-banco.js')) continue;
            const src = readFileSync(arq, 'utf8');
            for (const m of src.matchAll(/\.collection\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
                const nome = m[1];
                if (catalogadas.has(nome) || NAO_E_COLECAO[nome]) continue;
                const rel = arq.replace(`${join(__dirname, '..')}/`, '');
                const linha = `${nome}  (${rel})`;
                if (!fora.includes(linha)) fora.push(linha);
            }
        }
        if (fora.length) {
            throw new Error(
                '\n\n🚧 COLEÇÃO FORA DO CATÁLOGO\n\n'
                + fora.map((x) => `  · ${x}`).join('\n')
                + '\n\nToda coleção precisa de dono declarado em `catalogo-banco.js` — é o "controle\n'
                + 'acirrado" do Paulo (30/07). Sem a linha, ninguém sabe explicar a coleção daqui a\n'
                + 'três meses, e o painel Sistema→Banco só acusa para quem o abre.\n\n'
                + 'Adicione a linha no MESMO PR que cria a coleção.\n',
            );
        }
    });
});
