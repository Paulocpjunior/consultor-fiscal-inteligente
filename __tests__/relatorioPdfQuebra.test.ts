/**
 * 📄 O RELATÓRIO SAÍA COM O NOME ABREVIADO, SEM CNPJ — E COM 24 MB (08/09,
 * Paulo, CLUDE tomados 08/2026: *"este relatório está trazendo as informações
 * sem CNPJ e com nomes abreviados"*).
 *
 * Duas causas: a coluna do prestador imprimia só o nome, cortado pela largura
 * (o corte honesto é certo numa lista de notas e errado num NOME); e o logo
 * de 2.456 px entrava DECODIFICADO uma vez por página num PDF sem compressão.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { linhasDaCelula } from '../services/relatorioPdf';

const RAIZ = join(__dirname, '..');
const semComentario = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('linhasDaCelula — a coluna que QUEBRA e a que CORTA dizendo quanto', () => {
    it('sem quebra: o corte honesto continua (`…(+N)`)', () => {
        const [l] = linhasDaCelula('PREVERMED SERVICOS SST - SAUDE E SEGURANCA DO TRABALHO LTDA', 20, false);
        expect(l).toMatch(/…\(\+\d+\)$/);
        expect(l.length).toBeLessThanOrEqual(20 + 3);
    });

    it('com quebra: o nome INTEIRO sai em linhas, nenhuma letra some', () => {
        const nome = 'PREVERMED SERVICOS SST - SAUDE E SEGURANCA DO TRABALHO LTDA';
        const ls = linhasDaCelula(nome, 24, true);
        expect(ls.length).toBeGreaterThan(1);
        expect(ls.every((l) => l.length <= 24)).toBe(true);
        expect(ls.join(' ')).toBe(nome);
    });

    it('`\\n` na célula é quebra pedida — nome numa linha, CNPJ na outra', () => {
        expect(linhasDaCelula('EMPRESA X\n11.222.333/0001-81', 30, true)).toEqual(['EMPRESA X', '11.222.333/0001-81']);
    });

    it('palavra maior que a coluna é partida, não perdida', () => {
        const ls = linhasDaCelula('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10, true);
        expect(ls.join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    });

    it('célula vazia ocupa uma linha', () => {
        expect(linhasDaCelula('', 10, true)).toEqual(['']);
    });
});

describe('🔌 a casca e o relatório de serviços usam a quebra, e o PDF sai comprimido', () => {
    it('o jsPDF nasce com `compress: true` e o logo passa pela redução', () => {
        const f = semComentario(readFileSync(join(RAIZ, 'services/relatorioPdf.ts'), 'utf8'));
        expect(f).toMatch(/new jsPDF\(\{[^}]*compress: true/);
        expect(f).toMatch(/logoCache = await reduzirLogo\(original, \d+\)/);
        // A linha da tabela mede a altura pela célula mais alta.
        expect(f).toMatch(/linhasDaCelula\(fmtCell\(v\), maxChars, !!p\.colunas\[i\]\?\.quebra\)/);
    });

    it('Serviços tomados/prestados: coluna do participante com quebra, nome + CNPJ na célula', () => {
        const f = semComentario(readFileSync(join(RAIZ, 'components/Relatorios/index.tsx'), 'utf8'));
        expect(f).toMatch(/titulo: direcao === 'entrada' \? 'Prestador' : 'Tomador', largura: \d+, quebra: true/);
        expect(f).toMatch(/`\$\{l\.participante\}\\n\$\{l\.doc \? \(fmtCnpj\(l\.doc\) \|\| l\.doc\) : 'CNPJ não gravado'\}`/);
    });
});
