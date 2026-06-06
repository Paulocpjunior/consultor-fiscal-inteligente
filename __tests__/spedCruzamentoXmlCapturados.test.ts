/**
 * Testes do cruzamento SPED Fiscal × NF-e capturadas (XMLs).
 * Engine puro — sem firebase. Cobertura sintética determinística.
 */
// @ts-expect-error — módulo .js puro
import { parseSpedFiscalParaEdicao } from '../sefaz-backend/sped-fiscal-editor-parser.js';
// @ts-expect-error — módulo .js puro
import { cruzarSpedComCapturadas } from '../sefaz-backend/sped-cruzamento-xml-capturados.js';

const chave = (n: number) => String(n).padStart(44, '0');

function c100(chv: string, vlDoc: string, o: { codSit?: string; numDoc?: string } = {}): string {
    const { codSit = '00', numDoc = '1' } = o;
    return `|C100|0|0|PART|55|${codSit}|1|${numDoc}|${chv}|01012026|01012026|${vlDoc}|0|0,00|0,00|${vlDoc}|9|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`;
}

function spedFiscal(c100s: string[]): any {
    const txt = [
        '|0000|017|0|01012026|31012026|EMP|12345678000190|SP|123|3550308||A|',
        '|0001|0|', '|C001|0|', ...c100s, '|C990|1|',
        '|E001|0|', '|E110|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|', '|E990|2|',
    ].join('\r\n') + '\r\n';
    return parseSpedFiscalParaEdicao(txt);
}

const A = chave(1), B = chave(2), C = chave(3), D = chave(4), CANC = chave(5);

describe('cruzarSpedComCapturadas — cenários centrais', () => {
    const sped = spedFiscal([
        c100(A, '1000,00', { numDoc: '100' }),
        c100(B, '2000,00', { numDoc: '101' }), // valor diverge do capturado
        c100(C, '500,00', { numDoc: '102' }),  // sem captura
    ]);
    const capturadas = [
        { chave: A, numero: '100', status: 'autorizado', valorTotal: 1000, direcao: 'entrada' },
        { chave: B, numero: '101', status: 'autorizado', valorTotal: 2222 }, // diverge
        { chave: D, numero: '103', status: 'autorizado', valorTotal: 750 }, // não escriturada
        { chave: CANC, numero: '999', status: 'cancelado', valorTotal: 999 }, // ignorar
    ];

    it('aceita só SPED Fiscal', () => {
        expect(sped.tipoSped).toBe('fiscal');
        const r = cruzarSpedComCapturadas(sped, capturadas);
        expect(r.aplicavel).toBe(true);
    });

    it('classifica em-ambos, não-escriturada, sem-captura e divergência de valor', () => {
        const r = cruzarSpedComCapturadas(sped, capturadas);
        expect(r.resumo.totalSped).toBe(3);          // A,B,C
        expect(r.resumo.totalCapturadas).toBe(3);    // A,B,D (cancelada fora)
        expect(r.resumo.emAmbos).toBe(2);            // A,B
        expect(r.resumo.naoEscrituradas).toBe(1);    // D
        expect(r.resumo.semCaptura).toBe(1);         // C
        expect(r.resumo.divergenciasValor).toBe(1);  // B
        expect(r.resumo.descartadasCapturadas).toBe(1); // CANC
    });

    it('NÃO ESCRITURADA é ERRO (omissão de escrituração)', () => {
        const r = cruzarSpedComCapturadas(sped, capturadas);
        const a = r.achados.find((x: any) => x.tipo === 'NAO_ESCRITURADA');
        expect(a.severidade).toBe('erro');
        expect(a.chave).toBe(D);
        expect(a.vlCapturado).toBe(750);
    });

    it('SEM_CAPTURA é AVISO (captura incompleta possível)', () => {
        const r = cruzarSpedComCapturadas(sped, capturadas);
        const a = r.achados.find((x: any) => x.tipo === 'SEM_CAPTURA');
        expect(a.severidade).toBe('aviso');
        expect(a.chave).toBe(C);
    });

    it('DIVERGENCIA_VALOR mostra os dois lados', () => {
        const r = cruzarSpedComCapturadas(sped, capturadas);
        const d = r.achados.find((x: any) => x.tipo === 'DIVERGENCIA_VALOR');
        expect(d.severidade).toBe('erro');
        expect(d.vlSped).toBe(2000);
        expect(d.vlCapturado).toBe(2222);
        expect(d.diferenca).toBe(-222);
    });
});

describe('cruzarSpedComCapturadas — variações de shape e guardas', () => {
    const sped = spedFiscal([c100(chave(10), '500,00', { numDoc: '50' })]);

    it('aceita chaveAcesso/vNF/chNFe como aliases', () => {
        const r = cruzarSpedComCapturadas(sped, [
            { chaveAcesso: chave(10), vNF: 500, status: 'autorizado' },
        ]);
        expect(r.resumo.emAmbos).toBe(1);
        expect(r.resumo.naoEscrituradas).toBe(0);
    });

    it('sem status assume válido (compatível com fontes que não populam)', () => {
        const r = cruzarSpedComCapturadas(sped, [{ chave: chave(10), valorTotal: 500 }]);
        expect(r.resumo.emAmbos).toBe(1);
    });

    it('valor=0 no XML vira aviso SEM_VALOR_CAPTURADO (não vira "tudo certo")', () => {
        const r = cruzarSpedComCapturadas(sped, [{ chave: chave(10), valorTotal: 0, status: 'autorizado' }]);
        expect(r.resumo.divergenciasValor).toBe(0);
        expect(r.resumo.emAmbos).toBe(1);
        expect(r.resumo.semValorCapturado).toBe(1);
        const a = r.achados.find((x: any) => x.tipo === 'SEM_VALOR_CAPTURADO');
        expect(a.severidade).toBe('aviso');
    });

    it('SPED Contribuições -> não aplicável (engine só roda contra Fiscal)', () => {
        const txt = '|0000|006|0|01012026|31012026|EMP|12345678000190|SP|3550308|0|0|\r\n'
            + '|0001|0|\r\n|M001|0|\r\n|M200|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|\r\n|M990|3|\r\n';
        const r = cruzarSpedComCapturadas(parseSpedFiscalParaEdicao(txt), []);
        expect(r.aplicavel).toBe(false);
    });

    it('lista de capturadas vazia -> tudo é SEM_CAPTURA', () => {
        const r = cruzarSpedComCapturadas(sped, []);
        expect(r.resumo.semCaptura).toBe(1);
        expect(r.resumo.naoEscrituradas).toBe(0);
    });
});
