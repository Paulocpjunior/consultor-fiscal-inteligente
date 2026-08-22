// ============================================================================
// 🚨 O CAMPO DE DINHEIRO COMIA A VÍRGULA — e a trava de 21/08 cobria UM arquivo
//
// Em 21/08 o caso APATEL (a Declaração de Faturamento saindo com R$ 4,2 BILHÕES
// numa empresa de R$ 42 milhões) ensinou a regra: **input de valor NUNCA é
// controlado por `String(número)`** — o campo re-parseia o próprio texto
// exibido, a tecla da vírgula devolve o inteiro, o render apaga a vírgula da
// tela e os dígitos seguintes grudam. "1234,50" vira 123450, tecla a tecla,
// sem nenhum erro aparecer.
//
// A trava daquele dia foi escrita como **LISTA de um arquivo**
// (`components/Relatorios/index.tsx`) — o vício de 13/08: ela cobre o que eu
// lembrei, e envelhece em silêncio. A classe continuava aberta no
// **✍️ Lançar nota sem XML**, que é a TERCEIRA PORTA de documento fiscal:
//
//   · o **valor do item** era `String(it.vProd)` com `parseFloat(...) || 0` —
//     digitar 1234,50 gravava **123.450,00**, e colar "1.234,56" gravava
//     **R$ 1,23** (o `replace(',', '.')` não tirava o ponto de milhar);
//   · a **alíquota do ISS** e o **ISS devido** tinham o mesmo round-trip:
//     "2,5" virava 25;
//   · e o **valor total da nota**, que parecia seguro, passava por uma SEGUNDA
//     CÓPIA da régua (`num()`), já divergente: ela apagava TODO ponto, então a
//     forma JS com ponto decimal ("3241688.71" — como sai de export de
//     sistema) virava **324.168.871**. O mesmo 100× do APATEL.
//
// Esta nota alimenta livro, SPED, DIPAM e relatórios. A trava agora é
// VARREDURA, e nasce VERDE.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parseValorMoeda, ecoDoValorDigitado } from '../services/valorDigitado';

const RAIZ = join(__dirname, '..');

describe('🚨 as formas que quebravam o ✍️ Lançar nota sem XML', () => {
    it('a vírgula sobrevive — o valor digitado tecla a tecla fecha certo', () => {
        expect(parseValorMoeda('1234,50')).toBeCloseTo(1234.5, 2);
    });

    it('o ponto de milhar colado não vira R$ 1,23', () => {
        expect(parseValorMoeda('1.234,56')).toBeCloseTo(1234.56, 2);
    });

    // 🔴 A divergência da 2ª cópia: `num()` apagava todo ponto e devolvia
    // 324168871 para este mesmo texto.
    it('e a forma JS com ponto decimal NÃO vira cem vezes o valor', () => {
        expect(parseValorMoeda('3241688.71')).toBeCloseTo(3241688.71, 2);
    });

    // Campo de valor não tem default: ilegível é RECUSA, nunca zero.
    it('o ilegível devolve null — nunca zero de conveniência', () => {
        expect(parseValorMoeda('mil reais')).toBeNull();
        expect(parseValorMoeda('')).toBeNull();
    });

    // AUSENTE ≠ ZERO continua valendo, e zero digitado É resposta.
    it('vazio é ausência e zero é resposta — coisas diferentes', () => {
        expect(parseValorMoeda('')).toBeNull();
        expect(parseValorMoeda('0')).toBe(0);
    });

    it('o eco mostra o que o app ENTENDEU, e DIZ quando não entendeu', () => {
        expect(ecoDoValorDigitado('1234,50')?.texto).toBe('= 1.234,50');
        expect(ecoDoValorDigitado('abc')).toEqual({ ok: false, texto: expect.stringContaining('não entendi') });
        // Campo em branco não vira aviso — vazio tem causa própria.
        expect(ecoDoValorDigitado('')).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// A VARREDURA. O que ela procura é a CONJUNÇÃO que produz o defeito: um campo
// de TEXTO cujo `value` re-renderiza um NÚMERO **e** cujo `onChange` converte
// para número. Um dos dois sozinho é inofensivo — `value={it.ncm || ''}` com
// onChange de texto é um campo normal.
//
// ⚠️ `type="number"` fica FORA de propósito: ali o navegador recusa a vírgula
// antes de chegar ao React, então o round-trip não gruda dígito. Cobrá-lo faria
// a trava gritar sobre campo que não tem o defeito — e teste que grita sem
// motivo é teste desligado.
// ═══════════════════════════════════════════════════════════════════════════
const CONVERSAO = /parseFloat\(|parseInt\(|parseValorMoeda\(|Number\(|\bnum\(/;

function telas(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git'].includes(nome) || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) telas(p, out);
        else if (nome.endsWith('.tsx')) out.push(p);
    }
    return out;
}

describe('🚨 nenhum campo de texto é controlado por um NÚMERO', () => {
    it('a varredura não acha nenhum round-trip vivo', () => {
        const infratores: string[] = [];
        for (const arquivo of telas(join(RAIZ, 'components'))) {
            const src = readFileSync(arquivo, 'utf8');
            for (const m of src.matchAll(/<input\b[\s\S]{0,700}?\/>/g)) {
                const tag = m[0];
                if (/type=["'](number|date|checkbox|radio|file|month|color|range)["']/.test(tag)) continue;
                const val = /value=\{([\s\S]*?)\}\s*(?:\n|\s)/.exec(tag);
                const onc = /onChange=\{([\s\S]*?)\}\s*\n/.exec(tag);
                if (!val || !onc) continue;
                // O `value` devolve um número ao campo (String(n), n ?? '', n || '').
                if (!/String\(|\?\?\s*''|\|\|\s*''|\?\?\s*""/.test(val[1])) continue;
                if (!CONVERSAO.test(onc[1])) continue;
                infratores.push(`${relative(RAIZ, arquivo).replace(/\\/g, '/')}:${src.slice(0, m.index).split('\n').length}`);
            }
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 CAMPO DE TEXTO CONTROLADO POR NÚMERO — ele COME a vírgula\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\nO campo re-parseia o próprio texto exibido: na tecla da vírgula o parse\n'
                + 'devolve o inteiro, o render apaga a vírgula da tela e os dígitos seguintes\n'
                + 'grudam. "1234,50" vira 123450 — sem erro nenhum aparecer, e com cara de\n'
                + 'dado certo (caso APATEL, 21/08, num documento ASSINADO).\n\n'
                + 'O desenho certo: o estado guarda TEXTO (rascunho), o onChange só chama\n'
                + '`setTexto(e.target.value)`, e o número sai de `parseValorMoeda` na hora de\n'
                + 'gravar — com o que o app ENTENDEU aparecendo ao lado do campo.\n',
            );
        }
    });
});

describe('🚨 régua única: a pergunta "que número a pessoa digitou?" tem UM dono', () => {
    const form = readFileSync(join(RAIZ, 'components/xml/NotaDigitadaForm.tsx'), 'utf8');

    it('o formulário chama o dono, e as duas cópias locais saíram', () => {
        expect(form).toContain("from '../../services/valorDigitado'");
        // `num()` apagava todo ponto — a divergência que dava 100× no total.
        expect(form).not.toMatch(/const num = \(v: string\)/);
        // E o `|| 0` transformava ilegível em ZERO num campo de valor.
        expect(form).not.toMatch(/parseFloat\(e\.target\.value/);
    });

    it('os três campos guardam TEXTO', () => {
        expect(form).toMatch(/value=\{it\.vProdTexto\}/);
        expect(form).toMatch(/value=\{aliquotaTexto\}/);
        expect(form).toMatch(/value=\{valorIssTexto\}/);
    });

    it('e o ilegível é RECUSADO com o campo nomeado, nunca gravado como zero', () => {
        expect(form).toContain('não entendi');
        expect(form).toMatch(/const ilegiveis = /);
    });

    // A casa antiga continua exportando — quem já importava de lá não muda.
    it('a Declaração continua enxergando a régua pelo nome antigo', () => {
        const antiga = readFileSync(join(RAIZ, 'services/declaracaoFaturamento.ts'), 'utf8');
        expect(antiga).toMatch(/export \{ parseValorMoeda \} from '\.\/valorDigitado'/);
        // Segunda implementação na casa antiga seria a divergência de novo.
        expect(antiga).not.toMatch(/export function parseValorMoeda/);
    });
});
