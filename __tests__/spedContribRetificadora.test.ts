/**
 * 🔁 ORIGINAL × RETIFICADORA no 0000 do EFD-Contribuições (28/09, Paulo:
 * "pode criar escrituração retificadora, não vamos deixar nada pra trás").
 *
 * Guia Prático 1.35, 0000: campo 03 TIPO_ESCRIT [0,1]; campo 05
 * NUM_REC_ANTERIOR C 041, só na retificadora, só maiúsculas.
 * A asserção cobra o FATO (o que o 0000 escreve e o que é recusado).
 */
// @ts-expect-error módulo .js puro sem tipos
import { conferirTipoEscrituracao, normalizarRecibo, TAMANHO_MAX_RECIBO } from '../sefaz-backend/sped-contrib-escrituracao.js';
// @ts-expect-error módulo .js puro sem tipos
import { buildBloco0Contrib } from '../sefaz-backend/sped-contrib-bloco0.js';
// @ts-expect-error módulo .js puro sem tipos
import { conferirSituacaoEspecial } from '../sefaz-backend/sped-contrib-situacao-especial.js';

const RECIBO = 'AB.12.CD.34.EF.56.GH.78.IJ.90-1';
const dados = (over: any = {}) => ({
    empresa: { cnpj: '63575824000100', nome: 'GIRY COMERCIO E SERVICOS LTDA', dadosFiscais: { uf: 'SP', codMunIBGE: '3505708', indNatPJ: '00', indAtividade: 'servicos' } },
    competencia: '2026-08', competenciaInicio: '2026-08', competenciaFim: '2026-08',
    regimeApuracao: '1', notas: [], itens: [], unidades: [], participantes: [], warnings: [] as string[],
    ...over,
});
const campos0000 = (d: any) => (buildBloco0Contrib(d) as string[]).find((l) => l.startsWith('|0000|'))!.split('|');

describe('conferirTipoEscrituracao', () => {
    it('sem tipo, "0" ou "original" → original, recibo vazio, sem aviso', () => {
        for (const t of [undefined, '', '0', 'original', 'Original']) {
            expect(conferirTipoEscrituracao({ tipoEscrituracao: t })).toEqual({ ok: true, valor: { tipoEscrit: '0', rotulo: 'Original', numRecAnterior: '', aviso: null } });
        }
    });

    it('retificadora exige o recibo; o recibo sai em MAIÚSCULAS e sem espaços', () => {
        expect(conferirTipoEscrituracao({ tipoEscrituracao: '1' })).toMatchObject({ ok: false, erro: expect.stringMatching(/RECIBO/) });
        const r = conferirTipoEscrituracao({ tipoEscrituracao: 'retificadora', numRecAnterior: ' ab.12.cd 34 ' });
        expect(r).toMatchObject({ ok: true, valor: { tipoEscrit: '1', numRecAnterior: 'AB.12.CD34' } });
        expect(r.valor.aviso).toMatch(/TIPO_ESCRIT=1/);
    });

    it('recusa dita: recibo em ORIGINAL, recibo acima de 41, tipo fora do leiaute', () => {
        expect(conferirTipoEscrituracao({ tipoEscrituracao: '0', numRecAnterior: RECIBO })).toMatchObject({ ok: false, erro: expect.stringMatching(/RETIFICADORA/) });
        expect(conferirTipoEscrituracao({ tipoEscrituracao: '1', numRecAnterior: 'X'.repeat(TAMANHO_MAX_RECIBO + 1) })).toMatchObject({ ok: false, erro: expect.stringMatching(/41/) });
        expect(conferirTipoEscrituracao({ tipoEscrituracao: '1', numRecAnterior: 'X'.repeat(TAMANHO_MAX_RECIBO) }).ok).toBe(true);
        expect(conferirTipoEscrituracao({ tipoEscrituracao: '2', numRecAnterior: RECIBO }).ok).toBe(false);
        expect(normalizarRecibo(' a b ')).toBe('AB');
    });
});

describe('o 0000 escreve TIPO_ESCRIT e NUM_REC_ANTERIOR', () => {
    it('sem escrituração informada: 0 e vazio (o de sempre)', () => {
        const c = campos0000(dados());
        expect(c[3]).toBe('0');
        expect(c[5]).toBe('');
    });

    it('retificadora: campo 03 = 1 e campo 05 = recibo; o resto do registro não muda', () => {
        const esc = conferirTipoEscrituracao({ tipoEscrituracao: '1', numRecAnterior: RECIBO }).valor;
        const normal = campos0000(dados());
        const retif = campos0000(dados({ escrituracao: esc }));
        expect(retif[3]).toBe('1');
        expect(retif[5]).toBe(RECIBO);
        expect(retif.length).toBe(normal.length);
        expect(retif.filter((_, i) => i !== 3 && i !== 5)).toEqual(normal.filter((_, i) => i !== 3 && i !== 5));
    });

    it('retificadora + encerramento no mesmo arquivo: os quatro campos convivem', () => {
        const esc = conferirTipoEscrituracao({ tipoEscrituracao: '1', numRecAnterior: RECIBO }).valor;
        const sit = conferirSituacaoEspecial({ situacaoEspecial: '4', dataEvento: '2026-08-20', competencia: '2026-08' }).valor;
        const c = campos0000(dados({ escrituracao: esc, situacaoEspecial: sit }));
        expect([c[3], c[4], c[5], c[6], c[7]]).toEqual(['1', '4', RECIBO, '01082026', '20082026']);
    });

    it('forma crua em `dados` funciona, e inválida RECUSA em vez de sair original', () => {
        expect(campos0000(dados({ escrituracao: { tipoEscrituracao: '1', numRecAnterior: RECIBO } }))[3]).toBe('1');
        expect(() => buildBloco0Contrib(dados({ escrituracao: { tipoEscrituracao: '1' } }))).toThrow(/RECIBO/);
    });
});
