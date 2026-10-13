/**
 * 📥 BLOCO K IMPORTADO DO TXT DO SPED (13/10, WALDESA) — e a data do K que
 * saía em AAAA-MM-DD.
 *
 * Paulo: "precisa habilitar a opção de importação do arquivo, para subir para
 * o SPED". O sistema do cliente já gera o EFD com o bloco K; a tela lê os
 * registros do Guia Prático (os mesmos que o gerador do CFI escreve).
 *
 * Fatos cobrados: K200/K220/K230/K235 entram com os campos certos (K235
 * pendurado no K230 de antes); arquivo de outro CNPJ ou competência é
 * recusado; quantidade ausente não vira zero; registro que o CFI não gera é
 * contado e dito; e — achado no caminho — o K220/K230/K235 sai com a data em
 * DDMMAAAA (saía `2026-09-15`, recusa do PVA), ida e volta fechando.
 */
import { lerBlocoKDoSped, dataSpedParaIso, numeroSped } from '../sefaz-backend/bloco-k-importacao.js';
// @ts-expect-error — módulo .js puro (sem tipos)
import { dataDoK } from '../sefaz-backend/sped-fiscal-blocoK.js';

const CNPJ = '05049535000502';
const txt = (cnpj = CNPJ, dtIni = '01092026', dtFin = '30092026', extra = '') => [
    `|0000|019|0|${dtIni}|${dtFin}|WALDESA MOTOMERCANTIL LTDA|${cnpj}||SP|123456789|3550308|||A|1|`,
    '|0001|0|',
    '|K001|0|',
    '|K010|1|',
    `|K100|${dtIni}|${dtFin}|`,
    `|K200|${dtFin}|MOTO-01|12,000|0||`,
    `|K200|${dtFin}|PECA-77|3,500|1|FORN01|`,
    '|K220|15092026|PECA-77|PECA-77B|2,000|2,000|',
    '|K230|01092026|30092026|OP-9|MOTO-01|4,000|',
    '|K235|10092026|PECA-77|8,000||',
    '|K235|12092026|PECA-88|4,000|PECA-77|',
    extra,
    '|K280|30092026|MOTO-01|1,000|0,000|0||',
    '|K990|11|',
].filter(Boolean).join('\r\n');

describe('a leitura do TXT', () => {
    it('K200, K220, K230 com os K235 pendurados — campo a campo', () => {
        const r: any = lerBlocoKDoSped(txt(), { cnpjEmpresa: '05.049.535/0005-02', competencia: '2026-09' });
        expect(r.ok).toBe(true);
        expect(r.estoques).toEqual([
            { codItem: 'MOTO-01', qtd: 12, indEst: '0', codPart: '' },
            { codItem: 'PECA-77', qtd: 3.5, indEst: '1', codPart: 'FORN01' },
        ]);
        expect(r.movimentacoes).toEqual([{ dtMov: '2026-09-15', codItemOri: 'PECA-77', codItemDest: 'PECA-77B', qtdOri: 2, qtdDest: 2 }]);
        expect(r.producao).toEqual([{
            dtIniOp: '2026-09-01', dtFinOp: '2026-09-30', codDocOp: 'OP-9', codItem: 'MOTO-01', qtdEnc: 4,
            insumos: [
                { dtSaida: '2026-09-10', codItem: 'PECA-77', qtd: 8, codInsSubst: '' },
                { dtSaida: '2026-09-12', codItem: 'PECA-88', qtd: 4, codInsSubst: 'PECA-77' },
            ],
        }]);
        // O K280 o CFI não gera: contado e dito, não engolido.
        expect(r.naoImportados).toEqual({ K280: 1 });
        expect(r.avisos.join(' ')).toMatch(/K280 \(1\).*PVA/);
    });

    it('arquivo de OUTRO CNPJ: recusa', () => {
        const r: any = lerBlocoKDoSped(txt('05049535000100'), { cnpjEmpresa: CNPJ, competencia: '2026-09' });
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/CNPJ 05049535000100/);
    });

    it('arquivo de OUTRA competência: recusa', () => {
        const r: any = lerBlocoKDoSped(txt(CNPJ, '01082026', '31082026'), { cnpjEmpresa: CNPJ, competencia: '2026-09' });
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/08\/2026.*09\/2026/);
    });

    it('quantidade ausente fica ausente (não vira zero), e é dita', () => {
        const r: any = lerBlocoKDoSped(txt().replace('|MOTO-01|12,000|', '|MOTO-01||'), { cnpjEmpresa: CNPJ, competencia: '2026-09' });
        expect(r.estoques[0].qtd).toBe('');
        expect(r.avisos.join(' ')).toMatch(/1 linha\(s\) sem quantidade/);
    });

    it('sem 0000 ou sem K: recusa dita', () => {
        expect((lerBlocoKDoSped('|K200|30092026|X|1,000|0||') as any).erro).toMatch(/0000/);
        expect((lerBlocoKDoSped(txt().split('\r\n').filter((l) => !/^\|K2[023]/.test(l)).join('\n')) as any).erro).toMatch(/não tem K200/);
    });

    it('formas', () => {
        expect(dataSpedParaIso('15092026')).toBe('2026-09-15');
        expect(dataSpedParaIso('2026')).toBe('');
        expect(numeroSped('1234,567')).toBe(1234.567);
        expect(numeroSped('')).toBe('');
        expect(numeroSped('1.234,5')).toBe('');
    });
});

describe('a data do K no arquivo gerado', () => {
    it('AAAA-MM-DD (da tela) vira DDMMAAAA; DDMMAAAA passa; vazio fica vazio', () => {
        expect(dataDoK('2026-09-15')).toBe('15092026');
        expect(dataDoK('15092026')).toBe('15092026');
        expect(dataDoK('')).toBe('');
    });
    it('ida e volta: o que o TXT trouxe volta igual ao arquivo', () => {
        expect(dataDoK(dataSpedParaIso('01092026'))).toBe('01092026');
    });
});
