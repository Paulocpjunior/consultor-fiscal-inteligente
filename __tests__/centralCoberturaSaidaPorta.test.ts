/**
 * Cobertura de Saída tem porta própria (28/09).
 *
 * Paulo, print da Novidade de 25/09: "esta tela não está ativa". O caminho
 * "Captura → Cobertura de Saída → ✅ O cliente fez certo?" nunca existiu como
 * aba — o bloco morava no fim da página Importar → Manual & Cofre.
 *
 * Fatos cobrados (não redação):
 *  1. o grupo Captura da Central tem a sub-aba `cobertura-saida`;
 *  2. os três painéis de cobertura montam no bloco dessa aba, e em NENHUM
 *     outro bloco (montagem dupla = leitura dupla do Firestore);
 *  3. a Novidade que ensina o caminho nomeia um rótulo de sub-aba que existe.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const central = readFileSync(join(RAIZ, 'components/xml/CentralDocumentosFiscais.tsx'), 'utf8');

/** Blocos `{tab === 'x' && (` → texto até o próximo `{tab === `. */
function blocosPorTab(src: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /\{tab === '([a-z_-]+)' && \(/g;
    const marcas: Array<{ id: string; ini: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) marcas.push({ id: m[1]!, ini: m.index });
    marcas.forEach((mk, i) => {
        const fim = marcas[i + 1]?.ini ?? src.length;
        out[mk.id] = (out[mk.id] || '') + src.slice(mk.ini, fim);
    });
    return out;
}

/** Sub-abas do grupo Captura: `{ id: '…', label: '…' }` dentro do array `subs` de `id: 'captura'`. */
function subAbasDeCaptura(src: string): Array<{ id: string; label: string }> {
    const ini = src.indexOf("id: 'captura', label:");
    expect(ini).toBeGreaterThan(0);
    const fim = src.indexOf('],', ini);
    const trecho = src.slice(ini, fim);
    return [...trecho.matchAll(/\{ id: '([a-z_-]+)', label: '([^']+)' \}/g)].map((x) => ({ id: x[1]!, label: x[2]! }));
}

const PAINEIS = ['<AptidaoSaidaPanel', '<AutXmlHarvest', '<CofreChecklistPanel'];

describe('📤 Cobertura de Saída é uma sub-aba de Captura', () => {
    it("o grupo Captura lista a sub-aba 'cobertura-saida'", () => {
        const subs = subAbasDeCaptura(central);
        expect(subs.map((s) => s.id)).toContain('cobertura-saida');
    });

    it('os três painéis de cobertura montam no bloco da aba, e só nele', () => {
        const blocos = blocosPorTab(central);
        expect(Object.keys(blocos)).toContain('cobertura-saida');
        for (const p of PAINEIS) {
            const onde = Object.entries(blocos).filter(([, corpo]) => corpo.includes(p)).map(([id]) => id);
            expect({ painel: p, montaEm: onde }).toEqual({ painel: p, montaEm: ['cobertura-saida'] });
        }
    });

    it('a Novidade que ensina o caminho nomeia um rótulo de sub-aba que existe em Captura', () => {
        const html = readFileSync(join(RAIZ, 'public/novidades-cfi.html'), 'utf8');
        const linhasOnde = html.split('\n').filter((l) => l.includes('<strong>Onde:</strong>') && l.includes('Cobertura de Saída'));
        expect(linhasOnde.length).toBeGreaterThan(0);
        const rotulos = subAbasDeCaptura(central).map((s) => s.label);
        const rotuloCobertura = rotulos.find((r) => r.includes('Cobertura de Saída'));
        expect(rotuloCobertura).toBeDefined();
        for (const l of linhasOnde) expect(l).toContain(rotuloCobertura!);
    });
});
