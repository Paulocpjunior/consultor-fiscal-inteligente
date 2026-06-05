/**
 * Testes do validador estrutural generico do editor SPED.
 * Funciona pra EFD ICMS/IPI e Contribuicoes. O check mais importante:
 * pegar quando a contagem do Bloco 9 (9900/9990/9999) nao bate.
 */

// @ts-expect-error — modulo .js puro
import { parseSpedFiscalParaEdicao } from '../sefaz-backend/sped-fiscal-editor-parser.js';
// @ts-expect-error — modulo .js puro
import { validarEstruturaSped } from '../sefaz-backend/sped-fiscal-editor-validador.js';
// @ts-expect-error — modulo .js puro
import { reconstruirSped } from '../sefaz-backend/sped-fiscal-editor-rebuilder.js';

// SPED fiscal minimo, ja com Bloco 9 CORRETO (gerado pelo rebuilder a partir
// de um esqueleto). Construimos via rebuilder pra garantir consistencia.
function spedFiscalValido(): string {
    const esqueleto = [
        '|0000|017|0|01012026|31012026|EMPRESA|12345678000190|SP|123456789012|3550308||A|',
        '|0001|0|',
        '|0990|2|',
        '|C001|0|',
        '|C990|1|',
        '|E001|0|',
        '|E110|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
        '|E990|2|',
        '|9001|0|',
        '|9990|0|',
        '|9999|0|',
    ].join('\r\n') + '\r\n';
    // Reconstroi pra Bloco 9 ficar 100% consistente.
    const parsed = parseSpedFiscalParaEdicao(esqueleto);
    return reconstruirSped(parsed, []);
}

describe('validarEstruturaSped — arquivo valido', () => {
    it('SPED reconstruido pelo rebuilder passa (Bloco 9 consistente)', () => {
        const txt = spedFiscalValido();
        const parsed = parseSpedFiscalParaEdicao(txt);
        const r = validarEstruturaSped(parsed);
        expect(r.valido).toBe(true);
        expect(r.erros).toHaveLength(0);
    });
});

describe('validarEstruturaSped — pega problemas', () => {
    it('9999 com contagem errada -> invalido', () => {
        // Altera SO o registro 9999 final (ultima linha), nao o 9900 de tipo 9999.
        const linhas = spedFiscalValido().split('\r\n').filter(Boolean);
        const ult = linhas.length - 1;
        expect(linhas[ult].startsWith('|9999|')).toBe(true);
        linhas[ult] = '|9999|999|';
        const parsed = parseSpedFiscalParaEdicao(linhas.join('\r\n') + '\r\n');
        const r = validarEstruturaSped(parsed);
        expect(r.valido).toBe(false);
        expect(r.erros.join(' ')).toMatch(/9999 declara 999/);
    });

    it('9900 de um tipo com contagem errada -> invalido', () => {
        const txt = spedFiscalValido().replace('|9900|C990|1|', '|9900|C990|5|');
        const parsed = parseSpedFiscalParaEdicao(txt);
        const r = validarEstruturaSped(parsed);
        expect(r.valido).toBe(false);
        expect(r.erros.join(' ')).toMatch(/9900 'C990'/);
    });

    it('bloco sem abertura/fechamento -> invalido', () => {
        // Remove o C001 (abertura do bloco C). O C990 fica orfao.
        const txt = spedFiscalValido().replace('|C001|0|\r\n', '');
        const parsed = parseSpedFiscalParaEdicao(txt);
        const r = validarEstruturaSped(parsed);
        expect(r.valido).toBe(false);
        expect(r.erros.join(' ')).toMatch(/Bloco C: registro de abertura C001 ausente/);
    });

    it('0000 nao sendo a primeira linha -> invalido', () => {
        const linhas = spedFiscalValido().split('\r\n').filter(Boolean);
        // troca primeira com segunda
        [linhas[0], linhas[1]] = [linhas[1], linhas[0]];
        const parsed = parseSpedFiscalParaEdicao(linhas.join('\r\n') + '\r\n');
        const r = validarEstruturaSped(parsed);
        expect(r.valido).toBe(false);
        expect(r.erros.join(' ')).toMatch(/Primeira linha deve ser 0000/);
    });

    it('linha mal-formada vira aviso (nao erro fatal)', () => {
        const txt = 'CABECALHO DE EMAIL\r\n' + spedFiscalValido();
        const parsed = parseSpedFiscalParaEdicao(txt);
        const r = validarEstruturaSped(parsed);
        expect(r.avisos.join(' ')).toMatch(/mal-formada/);
    });
});

describe('validarEstruturaSped — round-trip sempre valido', () => {
    it('reconstruir sem edicoes sempre produz arquivo valido', () => {
        const txt = spedFiscalValido();
        const parsed = parseSpedFiscalParaEdicao(txt);
        const out = reconstruirSped(parsed, []);
        const parsedOut = parseSpedFiscalParaEdicao(out);
        expect(validarEstruturaSped(parsedOut).valido).toBe(true);
    });
});
