// ============================================================================
// O CFI pode ser embutido no Teams — e SÓ no Teams.
//
// O frame-ancestors do server.js é a porta do embutimento (aba de canal e app
// do tenant — desenho-modulo-comunicacao.md §10). Abrir demais reabre
// clickjacking; fechar de volta pro padrão quebra a aba do Teams em silêncio.
// Este teste trava a lista nos DOIS sentidos.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const fonte = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

const ANCESTRAIS_PERMITIDOS = [
    "'self'",
    'https://teams.microsoft.com',
    'https://*.cloud.microsoft',
    'https://*.office.com',
];

function extrairFrameAncestors(src: string): string[] {
    const m = src.match(/frameAncestors:\s*\[([^\]]*)\]/);
    if (!m) return [];
    // Tira UMA camada de aspas: "'self'" (keyword CSP, aspas internas ficam)
    // e 'https://…' (vira o domínio cru).
    return m[1].split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/^["']/, '').replace(/["']$/, ''));
}

describe('frame-ancestors do server.js (CFI dentro do Teams)', () => {
    it('existe e permite exatamente o self + os domínios do Teams', () => {
        const lista = extrairFrameAncestors(fonte);
        expect(lista.sort()).toEqual([...ANCESTRAIS_PERMITIDOS].sort());
    });

    it('o X-Frame-Options do helmet está desligado — frame-ancestors é quem responde', () => {
        // Com os dois ligados e regras diferentes, navegador antigo obedeceria
        // o XFO (SAMEORIGIN) e a aba do Teams abriria em branco sem erro no
        // nosso log — o pior jeito de quebrar.
        expect(fonte).toMatch(/xFrameOptions:\s*false/);
    });

    it('nenhum domínio fora da lista consegue entrar sem tocar neste teste', () => {
        const lista = extrairFrameAncestors(fonte);
        const forasteiros = lista.filter((d) => !ANCESTRAIS_PERMITIDOS.includes(d));
        expect(forasteiros).toEqual([]);
    });
});
