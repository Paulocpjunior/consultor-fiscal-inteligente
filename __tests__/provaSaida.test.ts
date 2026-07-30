/**
 * Prova de Saída por numeração (Paulo, 30/07: "não pode ser no chute — temos
 * que ter exatidão de quem recebeu ou não os XML").
 *
 * NF-e é sequencial por série: buraco na sequência capturada = nota faltante
 * com número exato. Este teste trava a análise pura.
 */

// @ts-expect-error — modulo .js puro
import { analisarSequenciasSaida } from '../sefaz-backend/prova-saida.js';

const HOJE = Date.parse('2026-07-30T12:00:00-03:00');
const dia = (n: number) => new Date(HOJE - n * 24 * 3600 * 1000).toISOString();

// chave mod 55: posições 20-21 = '55'
const CHAVE_55 = '35260729240822000202550010000007661000018007';
const CHAVE_65 = '35260729240822000202650010000007661000018007'; // NFC-e (mod 65)

const EMPRESAS = [
    { empresaId: 'E1', cnpj: '29240822000202', nome: 'NOVA ERA FILIAL' },
    { empresaId: 'E2', cnpj: '11222333000144', nome: 'OUTRA LTDA' },
];

const doc = (empresaId: string, numero: number, extras: any = {}) => ({
    empresaId,
    direcao: 'saida',
    chave: CHAVE_55,
    dhEmi: dia(3),
    numero: String(numero),
    serie: '1',
    ...extras,
});

describe('analisarSequenciasSaida', () => {
    it('detecta o buraco com o NÚMERO exato (760,761,763 → falta a 762)', () => {
        const r = analisarSequenciasSaida({
            docs: [doc('E1', 760), doc('E1', 761), doc('E1', 763)],
            empresas: EMPRESAS, hojeMs: HOJE,
        });
        expect(r.totais.empresasComBuraco).toBe(1);
        expect(r.totais.notasFaltantes).toBe(1);
        const e1 = r.empresas.find((e: any) => e.empresaId === 'E1');
        expect(e1.farol).toBe('incompleta');
        expect(e1.series[0]).toMatchObject({ serie: '1', menor: 760, maior: 763, faltantes: [762] });
    });

    it('sequência contínua = exata (sem falso alarme)', () => {
        const r = analisarSequenciasSaida({
            docs: [doc('E1', 100), doc('E1', 101), doc('E1', 102)],
            empresas: EMPRESAS, hojeMs: HOJE,
        });
        expect(r.totais.empresasComBuraco).toBe(0);
        expect(r.empresas[0].farol).toBe('exata');
    });

    it('séries são independentes (buraco na série 2 não contamina a série 1)', () => {
        const r = analisarSequenciasSaida({
            docs: [
                doc('E1', 10), doc('E1', 11),
                doc('E1', 500, { serie: '2' }), doc('E1', 503, { serie: '2' }),
            ],
            empresas: EMPRESAS, hojeMs: HOJE,
        });
        const e1 = r.empresas[0];
        expect(e1.totalFaltantes).toBe(2); // 501 e 502
        const s2 = e1.series.find((s: any) => s.serie === '2');
        expect(s2.faltantes).toEqual([501, 502]);
        const s1 = e1.series.find((s: any) => s.serie === '1');
        expect(s1.totalFaltantes).toBe(0);
    });

    it('ignora NFC-e (mod 65), entrada, fora da janela e sem número (resumo)', () => {
        const r = analisarSequenciasSaida({
            docs: [
                doc('E1', 200),
                doc('E1', 205, { chave: CHAVE_65 }),            // mod 65 — fora
                doc('E1', 210, { direcao: 'entrada' }),          // entrada — fora
                doc('E1', 220, { dhEmi: dia(120) }),             // fora da janela 90d
                doc('E1', 0, { numero: null }),                  // resumo sem número
                doc('E1', 201),
            ],
            empresas: EMPRESAS, hojeMs: HOJE,
        });
        const e1 = r.empresas[0];
        expect(e1.series[0]).toMatchObject({ menor: 200, maior: 201, totalFaltantes: 0 });
        expect(e1.semNumero).toBe(1);
        expect(r.totais.empresasComBuraco).toBe(0);
    });

    it('atribui por raiz do emitente quando o doc não tem empresaId', () => {
        const r = analisarSequenciasSaida({
            docs: [
                { direcao: 'saida', chave: CHAVE_55, dhEmi: dia(2), numero: '50', serie: '1', cnpjEmit: '29240822000202' },
                { direcao: 'saida', chave: CHAVE_55, dhEmi: dia(2), numero: '52', serie: '1', cnpjEmit: '29240822000202' },
            ],
            empresas: EMPRESAS, hojeMs: HOJE,
        });
        expect(r.empresas[0].nome).toBe('NOVA ERA FILIAL');
        expect(r.empresas[0].series[0].faltantes).toEqual([51]);
    });

    it('corta a lista de faltantes mas mantém o total exato', () => {
        const r = analisarSequenciasSaida({
            docs: [doc('E1', 1), doc('E1', 100)],
            empresas: EMPRESAS, hojeMs: HOJE, maxFaltantesLista: 5,
        });
        const s = r.empresas[0].series[0];
        expect(s.totalFaltantes).toBe(98);
        expect(s.faltantes).toEqual([2, 3, 4, 5, 6]);
        expect(s.faltantesTruncado).toBe(true);
        expect(r.totais.notasFaltantes).toBe(98);
    });

    it('empresa sem saída na janela não entra (Cobertura de Saída cuida dela)', () => {
        const r = analisarSequenciasSaida({ docs: [doc('E1', 7)], empresas: EMPRESAS, hojeMs: HOJE });
        expect(r.empresas.map((e: any) => e.empresaId)).toEqual(['E1']);
        expect(r.totais.empresasAnalisadas).toBe(1);
    });
});
