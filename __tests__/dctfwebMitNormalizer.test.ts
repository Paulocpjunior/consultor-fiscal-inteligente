/**
 * Testes do normalizador MIT (DCTFWeb). O shape oficial do MIT vem via
 * MIT/CONSAPURACAO316; o normalizador continua defensivo para payloads antigos
 * e variações retornadas pelo SERPRO.
 * não é público sem cert, o normalizador é defensivo — estes testes travam o
 * comportamento esperado pra cada estrutura plausível + o caso "não consegui
 * ler" (que NUNCA pode virar zeros falsos).
 */

// @ts-expect-error — modulo .js puro
import { normalizarApuracaoMit } from '../sefaz-backend/dctfweb-mit-normalizer.js';

describe('normalizarApuracaoMit — estruturas plausíveis', () => {
    it('debitos[] com codigoReceita + valor numérico', () => {
        const raw = {
            debitos: [
                { codigoReceita: '2362', valor: 1000.00 },  // IRPJ
                { codigoReceita: '2484', valor: 360.00 },   // CSLL
                { codigoReceita: '8109', valor: 65.00 },    // PIS
                { codigoReceita: '2172', valor: 300.00 },   // COFINS
            ],
        };
        const r = normalizarApuracaoMit(raw);
        expect(r.lido).toBe(true);
        expect(r.tributos).toEqual({ IRPJ: 1000, CSLL: 360, PIS: 65, COFINS: 300, IPI: 0 });
        expect(r.totalReconhecido).toBe(1725);
        expect(r.outros).toHaveLength(0);
    });

    it('IRRF (retenção na fonte) por descrição NÃO conta como IRPJ — vai p/ outros', () => {
        const raw = { debitos: [
            { codigo: '9999', descricao: 'IMPOSTO SOBRE A RENDA RETIDO NA FONTE', valor: 500 },
            { codigoReceita: '2362', valor: 1000 }, // IRPJ de verdade
        ] };
        const r = normalizarApuracaoMit(raw);
        expect(r.tributos.IRPJ).toBe(1000);       // só o IRPJ real, sem o IRRF
        expect(r.outros.some((o: any) => o.valor === 500)).toBe(true);
    });

    it('valor em formato BR "1.234,56" string', () => {
        const raw = { debitos: [{ codigo: '2362', valor: '1.234,56' }] };
        const r = normalizarApuracaoMit(raw);
        expect(r.lido).toBe(true);
        expect(r.tributos.IRPJ).toBe(1234.56);
    });

    it('soma múltiplas linhas da mesma família (PIS cumulativo + não-cumulativo)', () => {
        const raw = { tributos: [
            { codigo: '8109', valor: 50 },
            { codigo: '6912', valor: 30 },  // PIS não-cumulativo
        ] };
        const r = normalizarApuracaoMit(raw);
        expect(r.tributos.PIS).toBe(80);
    });

    it('fallback por descrição quando código desconhecido', () => {
        const raw = { debitos: [
            { codigo: '9999', descricao: 'IRPJ - Lucro Real Trimestral', valor: 500 },
            { codigo: '8888', descricao: 'COFINS não cumulativa', valor: 200 },
        ] };
        const r = normalizarApuracaoMit(raw);
        expect(r.tributos.IRPJ).toBe(500);
        expect(r.tributos.COFINS).toBe(200);
    });

    it('código desconhecido E descrição irreconhecível → vai pra outros (não some)', () => {
        const raw = { debitos: [
            { codigo: '2362', valor: 100 },
            { codigo: '1162', descricao: 'INSS Patronal', valor: 999 },  // não é IRPJ/CSLL/PIS/COFINS
        ] };
        const r = normalizarApuracaoMit(raw);
        expect(r.tributos.IRPJ).toBe(100);
        expect(r.outros).toHaveLength(1);
        expect(r.outros[0]).toMatchObject({ codigo: '1162', valor: 999 });
    });

    it('estrutura aninhada apuracao.debitos', () => {
        const raw = { apuracao: { debitos: [{ codigo: '2484', valor: 360 }] } };
        const r = normalizarApuracaoMit(raw);
        expect(r.tributos.CSLL).toBe(360);
    });

    it('nomes alternativos: tributos[] com valorDebito', () => {
        const raw = { tributos: [{ codReceita: '2172', valorDebito: 300 }] };
        const r = normalizarApuracaoMit(raw);
        expect(r.tributos.COFINS).toBe(300);
    });

    it('varredura genérica: array não-nomeado com cara de débito', () => {
        const raw = { qualquerCoisa: [{ codigo: '2362', valor: 700 }] };
        const r = normalizarApuracaoMit(raw);
        expect(r.lido).toBe(true);
        expect(r.tributos.IRPJ).toBe(700);
    });

    it('shape oficial MIT/CONSAPURACAO316 com Debitos por grupo', () => {
        const raw = {
            dadosApuracaoMit: [{
                PeriodoApuracao: { MesApuracao: 5, AnoApuracao: 2026 },
                DadosIniciais: { SemMovimento: false },
                Debitos: {
                    Irpj: { ListaDebitos: [{ IdDebito: 1, CodigoDebito: '159901', ValorDebito: 1000 }] },
                    Csll: { ListaDebitos: [{ IdDebito: 2, CodigoDebito: '203001', ValorDebito: 450 }] },
                    PisPasep: { ListaDebitos: [{ IdDebito: 3, CodigoDebito: '543401', ValorDebito: 65 }] },
                    Cofins: { ListaDebitos: [{ IdDebito: 4, CodigoDebito: '585601', ValorDebito: 300 }] },
                },
            }],
        };

        const r = normalizarApuracaoMit(raw);
        expect(r.lido).toBe(true);
        expect(r.tributos).toEqual({ IRPJ: 1000, CSLL: 450, PIS: 65, COFINS: 300, IPI: 0 });
        expect(r.totalReconhecido).toBe(1815);
        expect(r.outros).toHaveLength(0);
    });
});

describe('normalizarApuracaoMit — honestidade (NUNCA zeros falsos)', () => {
    it('apuracaoMit null → lido=false', () => {
        const r = normalizarApuracaoMit(null);
        expect(r.lido).toBe(false);
        expect(r.motivo).toMatch(/ausente/);
    });

    it('sem array de débitos reconhecível → lido=false', () => {
        const r = normalizarApuracaoMit({ status: 'ENCERRADA', protocolo: 'X' });
        expect(r.lido).toBe(false);
        expect(r.motivo).toMatch(/debitos no response MIT/i);
    });

    it('array existe mas sem valor extraível → lido=false (não retorna zeros)', () => {
        const r = normalizarApuracaoMit({ debitos: [{ foo: 'bar' }, { baz: 1 }] });
        expect(r.lido).toBe(false);
        expect(r.tributos).toEqual({ IRPJ: 0, CSLL: 0, PIS: 0, COFINS: 0, IPI: 0 });
    });
});
