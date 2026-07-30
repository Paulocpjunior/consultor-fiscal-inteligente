/**
 * Prova de Saída por numeração (Paulo, 30/07: "não pode ser no chute — temos
 * que ter exatidão de quem recebeu ou não os XML").
 *
 * v2: TUDO sai da CHAVE de 44 dígitos (CNPJ emitente, série, nNF) — imune a
 * erro de atribuição. A v1 agrupava por empresa da base e misturava numerações
 * de emitentes diferentes (S&P apareceu com 429 mil "faltantes" falsos).
 */

// @ts-expect-error — modulo .js puro
import { analisarSequenciasSaida, decomporChave } from '../sefaz-backend/prova-saida.js';

const HOJE = Date.parse('2026-07-30T12:00:00-03:00');
const dia = (n: number) => new Date(HOJE - n * 24 * 3600 * 1000).toISOString();

const NOVAERA_FILIAL = '29240822000202';
const NOVAERA_MATRIZ = '29240822000121';
const OUTRA = '11222333000144';
const NAO_CADASTRADA = '99888777000166';

// chave: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) DV(1)
const montarChave = (cnpj: string, serie: number, num: number, mod = '55') =>
    `352607${cnpj}${mod}${String(serie).padStart(3, '0')}${String(num).padStart(9, '0')}1000018007`.slice(0, 44);

const doc = (cnpj: string, num: number, extras: any = {}) => ({
    direcao: 'saida',
    chave: montarChave(cnpj, extras.serie ?? 1, num, extras.mod ?? '55'),
    dhEmi: extras.dhEmi ?? dia(3),
});

const EMPRESAS = [
    { empresaId: 'E1', cnpj: NOVAERA_FILIAL, nome: 'NOVA ERA FILIAL' },
    { empresaId: 'E2', cnpj: OUTRA, nome: 'OUTRA LTDA' },
];

describe('decomporChave', () => {
    it('extrai CNPJ do emitente, modelo, série e número', () => {
        expect(decomporChave(montarChave(NOVAERA_FILIAL, 1, 766))).toEqual({
            cnpjEmit: NOVAERA_FILIAL, modelo: '55', serie: '1', numero: 766,
        });
        expect(decomporChave('123')).toBeNull();
    });
});

describe('analisarSequenciasSaida (v2 — pela chave)', () => {
    it('detecta o buraco com o NÚMERO exato (760,761,763 → falta a 762)', () => {
        const r = analisarSequenciasSaida({
            docs: [doc(NOVAERA_FILIAL, 760), doc(NOVAERA_FILIAL, 761), doc(NOVAERA_FILIAL, 763)],
            empresas: EMPRESAS, hojeMs: HOJE,
        });
        expect(r.totais.empresasComBuraco).toBe(1);
        expect(r.totais.notasFaltantes).toBe(1);
        expect(r.empresas[0].series[0]).toMatchObject({ serie: '1', menor: 760, maior: 763, faltantes: [762] });
    });

    it('NÃO mistura emitentes: matriz e filial da mesma raiz têm sequências separadas', () => {
        // v1 misturava pelo fallback de raiz → buracos falsos gigantes.
        const r = analisarSequenciasSaida({
            docs: [
                doc(NOVAERA_FILIAL, 100), doc(NOVAERA_FILIAL, 101),
                doc(NOVAERA_MATRIZ, 5000), doc(NOVAERA_MATRIZ, 5001),
            ],
            empresas: EMPRESAS, hojeMs: HOJE,
        });
        expect(r.totais.notasFaltantes).toBe(0);
        expect(r.totais.empresasComBuraco).toBe(0);
        // Filial sem cadastro próprio aparece pela raiz, mas com o CNPJ REAL dela.
        expect(r.empresas.map((e: any) => e.cnpj).sort()).toEqual([NOVAERA_MATRIZ, NOVAERA_FILIAL].sort());
    });

    it('faixa gigante vira "histórico não coberto", não buraco acionável', () => {
        const r = analisarSequenciasSaida({
            docs: [doc(NOVAERA_FILIAL, 1), doc(NOVAERA_FILIAL, 400000)],
            empresas: EMPRESAS, hojeMs: HOJE, limiarGrandeFaixa: 5000,
        });
        // Não entra no total acionável…
        expect(r.totais.notasFaltantes).toBe(0);
        expect(r.totais.empresasComBuraco).toBe(0);
        // …mas é reportada à parte, com honestidade.
        expect(r.totais.seriesGrandeFaixa).toBe(1);
        expect(r.totais.faltantesGrandeFaixa).toBe(399998);
        expect(r.empresas[0].series[0].grandeFaixa).toBe(true);
    });

    it('emitente que não é empresa cadastrada fica FORA (contado)', () => {
        const r = analisarSequenciasSaida({
            docs: [doc(NAO_CADASTRADA, 10), doc(NAO_CADASTRADA, 12), doc(NOVAERA_FILIAL, 700)],
            empresas: EMPRESAS, hojeMs: HOJE,
        });
        expect(r.totais.docsForaCadastro).toBe(2);
        expect(r.empresas).toHaveLength(1);
        expect(r.empresas[0].cnpj).toBe(NOVAERA_FILIAL);
    });

    it('ignora NFC-e (mod 65), entrada, fora da janela e chave inválida', () => {
        const r = analisarSequenciasSaida({
            docs: [
                doc(NOVAERA_FILIAL, 200),
                doc(NOVAERA_FILIAL, 205, { mod: '65' }),
                { direcao: 'entrada', chave: montarChave(NOVAERA_FILIAL, 1, 210), dhEmi: dia(1) },
                doc(NOVAERA_FILIAL, 220, { dhEmi: dia(120) }),
                { direcao: 'saida', chave: 'lixo', dhEmi: dia(1) },
                doc(NOVAERA_FILIAL, 201),
            ],
            empresas: EMPRESAS, hojeMs: HOJE,
        });
        expect(r.empresas[0].series[0]).toMatchObject({ menor: 200, maior: 201, totalFaltantes: 0 });
        expect(r.totais.chavesInvalidas).toBe(1);
        expect(r.totais.empresasComBuraco).toBe(0);
    });

    it('séries são independentes e a lista é cortada mantendo o total exato', () => {
        const docsSerie2 = [doc(NOVAERA_FILIAL, 500, { serie: 2 }), doc(NOVAERA_FILIAL, 550, { serie: 2 })];
        const r = analisarSequenciasSaida({
            docs: [doc(NOVAERA_FILIAL, 10), doc(NOVAERA_FILIAL, 11), ...docsSerie2],
            empresas: EMPRESAS, hojeMs: HOJE, maxFaltantesLista: 5,
        });
        const e1 = r.empresas[0];
        const s2 = e1.series.find((s: any) => s.serie === '2');
        expect(s2.totalFaltantes).toBe(49);
        expect(s2.faltantes).toEqual([501, 502, 503, 504, 505]);
        expect(s2.faltantesTruncado).toBe(true);
        const s1 = e1.series.find((s: any) => s.serie === '1');
        expect(s1.totalFaltantes).toBe(0);
        expect(r.totais.notasFaltantes).toBe(49);
    });
});
