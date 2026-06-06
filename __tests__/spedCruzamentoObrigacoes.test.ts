/**
 * Testes do cruzamento SPED Fiscal × SPED Contribuições (mesma empresa/período).
 * Engine puro: as NF-e (C100) escrituradas nas duas obrigações têm que bater.
 * Calibração contra arquivos reais não roda aqui (as amostras eram de empresas
 * diferentes) — cobertura por dados sintéticos determinísticos.
 */
// @ts-expect-error — módulo .js puro
import { parseSpedFiscalParaEdicao } from '../sefaz-backend/sped-fiscal-editor-parser.js';
// @ts-expect-error — módulo .js puro
import { cruzarSpedFiscalContrib } from '../sefaz-backend/sped-cruzamento-obrigacoes.js';

const chave = (n: number) => String(n).padStart(44, '0');

function c100(chv: string, vlDoc: string, o: { codSit?: string; numDoc?: string; indOper?: string } = {}): string {
    const { codSit = '00', numDoc = '1', indOper = '0' } = o;
    return `|C100|${indOper}|0|PART|55|${codSit}|1|${numDoc}|${chv}|01012026|01012026|${vlDoc}|0|0,00|0,00|${vlDoc}|9|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`;
}

function spedFiscal(c100s: string[]): any {
    const txt = [
        '|0000|017|0|01012026|31012026|EMP|12345678000190|SP|123|3550308||A|',
        '|0001|0|', '|C001|0|', ...c100s, '|C990|1|',
        '|E001|0|', '|E110|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|', '|E990|2|',
    ].join('\r\n') + '\r\n';
    return parseSpedFiscalParaEdicao(txt);
}

function spedContrib(c100s: string[]): any {
    const txt = [
        '|0000|006|0|01012026|31012026|EMP|12345678000190|SP|3550308|0|0|',
        '|0001|0|', '|C001|0|', ...c100s, '|C990|1|',
        '|M001|0|', '|M200|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|', '|M990|3|',
    ].join('\r\n') + '\r\n';
    return parseSpedFiscalParaEdicao(txt);
}

const A = chave(1), B = chave(2), C = chave(3), D = chave(4), CANC = chave(5);

describe('cruzarSpedFiscalContrib — cenário completo', () => {
    const fiscal = spedFiscal([
        c100(A, '1000,00', { numDoc: '100' }),                 // em ambos, mesmo valor
        c100(B, '2000,00', { numDoc: '101', indOper: '1' }),   // em ambos, valor diverge
        c100(C, '500,00', { numDoc: '102' }),                  // só fiscal
        c100(CANC, '999,00', { numDoc: '103', codSit: '02' }), // cancelada -> ignorar
    ]);
    const contrib = spedContrib([
        c100(A, '1000,00', { numDoc: '100' }),                 // bate
        c100(B, '2200,00', { numDoc: '101', indOper: '1' }),   // diverge (2000 vs 2200)
        c100(D, '700,00', { numDoc: '104' }),                  // só contrib
    ]);

    it('parseia os tipos corretos', () => {
        expect(fiscal.tipoSped).toBe('fiscal');
        expect(contrib.tipoSped).toBe('contribuicoes');
    });

    it('classifica em-ambos, só-fiscal, só-contrib e divergência de valor', () => {
        const r = cruzarSpedFiscalContrib(fiscal, contrib);
        expect(r.aplicavel).toBe(true);
        expect(r.resumo.totalFiscal).toBe(3);   // A, B, C (cancelada fora)
        expect(r.resumo.totalContrib).toBe(3);  // A, B, D
        expect(r.resumo.emAmbos).toBe(2);       // A, B
        expect(r.resumo.soFiscal).toBe(1);      // C
        expect(r.resumo.soContrib).toBe(1);     // D
        expect(r.resumo.divergenciasValor).toBe(1); // B
    });

    it('a divergência de valor é um ERRO com os dois valores', () => {
        const r = cruzarSpedFiscalContrib(fiscal, contrib);
        const div = r.achados.find((a: any) => a.tipo === 'DIVERGENCIA_VALOR');
        expect(div.severidade).toBe('erro');
        expect(div.chave).toBe(B);
        expect(div.vlFiscal).toBe(2000);
        expect(div.vlContrib).toBe(2200);
        expect(div.diferenca).toBe(-200);
    });

    it('só-fiscal e só-contrib são AVISOS (contador decide)', () => {
        const r = cruzarSpedFiscalContrib(fiscal, contrib);
        const sf = r.achados.find((a: any) => a.tipo === 'SO_FISCAL');
        const sc = r.achados.find((a: any) => a.tipo === 'SO_CONTRIB');
        expect(sf.severidade).toBe('aviso');
        expect(sf.chave).toBe(C);
        expect(sc.severidade).toBe('aviso');
        expect(sc.chave).toBe(D);
    });

    it('nota cancelada (COD_SIT 02) não vira achado', () => {
        const r = cruzarSpedFiscalContrib(fiscal, contrib);
        expect(r.achados.some((a: any) => a.chave === CANC)).toBe(false);
    });

    it('aceita os SPEDs em qualquer ordem', () => {
        const r1 = cruzarSpedFiscalContrib(fiscal, contrib);
        const r2 = cruzarSpedFiscalContrib(contrib, fiscal);
        expect(r2.resumo).toEqual(r1.resumo);
    });
});

describe('cruzarSpedFiscalContrib — guardas', () => {
    it('dois SPEDs do mesmo tipo -> não aplicável', () => {
        const r = cruzarSpedFiscalContrib(spedFiscal([c100(A, '10,00')]), spedFiscal([c100(B, '20,00')]));
        expect(r.aplicavel).toBe(false);
        expect(r.motivo).toMatch(/Fiscal.*Contribuicoes/i);
    });

    it('notas idênticas nos dois -> sem achados', () => {
        const f = spedFiscal([c100(A, '1000,00'), c100(B, '500,00')]);
        const c = spedContrib([c100(A, '1000,00'), c100(B, '500,00')]);
        const r = cruzarSpedFiscalContrib(f, c);
        expect(r.achados).toHaveLength(0);
        expect(r.resumo.emAmbos).toBe(2);
    });

    it('diferença de 1 centavo dentro da tolerância -> sem divergência', () => {
        const f = spedFiscal([c100(A, '1000,00')]);
        const c = spedContrib([c100(A, '1000,01')]);
        const r = cruzarSpedFiscalContrib(f, c);
        expect(r.resumo.divergenciasValor).toBe(0);
    });
});
