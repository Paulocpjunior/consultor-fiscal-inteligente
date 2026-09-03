// ============================================================================
// MATA-BURRO: O GUIA APONTA UMA ABA QUE EXISTE — com o NOME que ela tem hoje.
//
// 04/09 (auditoria): o guia da saída mod 55 mandava o colaborador à seção
// "📦 Importação Manual (ZIP)", e a aba se chama "📥 Manual & Cofre (saída
// 55)" desde a consolidação da Central de XMLs. Quem segue o texto procura,
// não acha, e conclui que a função sumiu — é o achado 18 de 21/08 (aviso que
// aponta lugar que não resolve), agora no MATERIAL DA EQUIPE.
//
// A régua: todo rótulo de aba/botão escrito em `<strong>` dentro de um bloco
// `📍 Onde` (`<div class="onde">`) de `public/guia-*.html` tem de existir no
// código das telas (`components/`). A varredura é CONSERVADORA de propósito:
// só confere rótulos que começam com EMOJI (é assim que as abas e os botões
// desta casa se chamam — "📥 Importar", "🌾 DIPAM / Produtor rural"); texto
// corrido em negrito ("3 pontos que mudam") não é rótulo e não é conferido.
// Um "→" separa segmentos, e cada segmento é conferido sozinho.
//
// Exceção se declara em EXCECOES COM o motivo — nunca apagando a varredura.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const PUBLIC = join(RAIZ, 'public');

/** Rótulos que o guia cita e que NÃO moram em components/, com o motivo. */
const EXCECOES: Record<string, string> = {
    // (vazio hoje — todo rótulo citado existe na tela; adicionar aqui só com
    // o motivo escrito, ex.: 'botão do app irmão' ou 'tela do e-CAC').
};

function varrer(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist'].includes(nome) || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) varrer(p, out);
        else if (/\.tsx?$/.test(nome)) out.push(p);
    }
    return out;
}

function decodificar(html: string): string {
    return html
        .replace(/&amp;/g, '&')
        .replace(/&rarr;/g, '→')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]+>/g, '')
        .trim();
}

// Rótulo de aba/botão nesta casa começa com emoji (pictograma). Aspas e
// travessões que embrulham o rótulo são tirados antes de olhar o 1º caractere.
const COMECA_COM_EMOJI = /^\p{Extended_Pictographic}/u;
function ehRotulo(texto: string): boolean {
    const t = texto.replace(/^["“”'‘’«»\s]+|["“”'‘’«»\s.:]+$/g, '');
    return COMECA_COM_EMOJI.test(t);
}

interface Citacao { arquivo: string; rotulo: string }

function rotulosCitados(): Citacao[] {
    const out: Citacao[] = [];
    for (const nome of readdirSync(PUBLIC).filter((f) => /^guia-.*\.html$/.test(f))) {
        const html = readFileSync(join(PUBLIC, nome), 'utf8');
        for (const bloco of html.matchAll(/<div class="onde">([\s\S]*?)<\/div>/g)) {
            for (const m of bloco[1].matchAll(/<strong>([\s\S]*?)<\/strong>/g)) {
                for (const segmento of decodificar(m[1]).split('→')) {
                    const s = segmento.replace(/^["“”'‘’«»\s]+|["“”'‘’«»\s.:]+$/g, '');
                    if (ehRotulo(s)) out.push({ arquivo: `public/${nome}`, rotulo: s });
                }
            }
        }
    }
    return out;
}

describe('📍 o guia aponta aba/botão que EXISTE na tela, com o nome de hoje', () => {
    const citacoes = rotulosCitados();
    const telas = varrer(join(RAIZ, 'components'));
    const fonte = telas.map((p) => readFileSync(p, 'utf8')).join('\n');

    it('a varredura enxerga guias e telas (trava vazia é trava falsa)', () => {
        expect(citacoes.length).toBeGreaterThan(2);
        expect(telas.length).toBeGreaterThan(100);
    });

    it('todo rótulo com emoji citado num bloco "Onde" existe em components/', () => {
        const faltando: string[] = [];
        for (const { arquivo, rotulo } of citacoes) {
            if (EXCECOES[rotulo]) continue;
            if (fonte.includes(rotulo)) continue;
            faltando.push(`${arquivo}: "${rotulo}"`);
        }
        if (faltando.length) {
            throw new Error(
                '\n\n🚧 O GUIA APONTA UMA ABA/BOTÃO QUE A TELA NÃO TEM\n\n'
                + faltando.map((x) => `  · ${x}`).join('\n')
                + '\n\nQuem segue o guia procura esse nome e não acha — e conclui que a função\n'
                + 'sumiu. Ou o rótulo mudou na tela (atualize as DUAS metades do guia e suba a\n'
                + 'guia-revisao), ou o rótulo não é desta tela (declare em EXCECOES com o\n'
                + 'motivo). Nunca apague a varredura.\n',
            );
        }
        expect(faltando).toEqual([]);
    });

    it('toda exceção declarada tem motivo escrito', () => {
        for (const [rotulo, motivo] of Object.entries(EXCECOES)) {
            expect({ rotulo, temMotivo: motivo.trim().length >= 8 }).toEqual({ rotulo, temMotivo: true });
        }
    });

    it('o caso que originou a trava: o guia da saída 55 aponta a aba com o nome de hoje', () => {
        const guia = readFileSync(join(PUBLIC, 'guia-saida-mod55.html'), 'utf8');
        const fonteMd = readFileSync(join(RAIZ, 'docs/guia-colaborador-saida-mod55.md'), 'utf8');
        expect(guia).not.toMatch(/Importação Manual \(ZIP\)/);
        expect(fonteMd).not.toMatch(/Importação Manual \(ZIP\)/);
        expect(decodificar(guia)).toContain('📥 Manual & Cofre (saída 55)');
        expect(fonteMd).toContain('📥 Manual & Cofre (saída 55)');
        // E o nome é o da tela, lido do código — não da memória de quem escreveu.
        expect(readFileSync(join(RAIZ, 'components/xml/CentralDocumentosFiscais.tsx'), 'utf8'))
            .toContain("label: '📥 Manual & Cofre (saída 55)'");
    });
});
