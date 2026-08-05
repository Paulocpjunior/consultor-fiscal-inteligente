import { analisarRetencoes, validarRetencoesLinha, type LinhaNfseCsv } from '../services/retencoesNfseAnalyzer';

/**
 * Caso FRONTINI (05/08): o Demonstrativo do E-Fiscal listou 4 notas com
 * PIS/COFINS/CSLL retidos e a Análise de Retenções achou UMA. As outras três
 * apareciam com "✓ ok" — errado E com cara de certo.
 *
 * Causa: o extrator exigia "R$" depois do nome do tributo.
 */
const nota = (discriminacao: string, valorServicos = 990): LinhaNfseCsv => ({
    direcao: 'saida',
    numero: '781',
    data: '2026-07-03',
    prestadorCnpj: '09246389000124',
    prestadorNome: 'FRONTINI',
    tomadorCnpj: '59575753000178',
    tomadorNome: 'TOMADOR',
    valorServicos,
    iss: 0,
    codServico: '',
    discriminacao,
} as LinhaNfseCsv);

describe('extração de retenção sem "R$" na discriminação', () => {
    it('lê "PIS 6,44 COFINS 29,70 CSLL 9,90" (formato do caso real)', () => {
        const a = analisarRetencoes(nota('RETENCOES: PIS 6,44 COFINS 29,70 CSLL 9,90'));
        expect(a.pis.valor).toBe(6.44);
        expect(a.cofins.valor).toBe(29.70);
        expect(a.csll.valor).toBe(9.90);
        expect(a.totalRetido).toBeCloseTo(46.04, 2);
    });

    it('continua lendo o formato com R$ (não quebrou o que funcionava)', () => {
        const a = analisarRetencoes(nota('PIS R$ 22,10 COFINS R$ 102,00 CSLL R$ 34,00', 3400));
        expect(a.pis.valor).toBe(22.10);
        expect(a.cofins.valor).toBe(102);
    });

    it('lê com marcador de dedução: "(-) CSLL 27,92"', () => {
        const a = analisarRetencoes(nota('(-) CSLL 27,92', 2791.67));
        expect(a.csll.retido).toBe(true);
        expect(a.csll.valor).toBe(27.92);
    });

    it('NÃO confunde alíquota com valor: "PIS 0,65%" não vira R$ 0,65', () => {
        const a = analisarRetencoes(nota('Aliquotas: PIS 0,65% COFINS 3,00% CSLL 1,00%'));
        expect(a.pis.retido).toBe(false);
        expect(a.pis.mencionadoSemValor).toBe(true);
    });

    it('alíquota escrita SEM o % também é recusada', () => {
        const a = analisarRetencoes(nota('PIS 0,65 COFINS 3,00 CSLL 1,00'));
        expect(a.pis.retido).toBe(false);
        expect(a.cofins.retido).toBe(false);
    });

    it('ignora tributos aproximados do IBPT (Lei 12.741)', () => {
        const a = analisarRetencoes(nota('Trib aprox R$ 120,00 fonte IBPT — PIS 5,00'));
        expect(a.pis.retido).toBe(false);
    });
});

describe('citado sem valor não sai como conforme', () => {
    it('gera inconsistência em vez de "✓ ok"', () => {
        const linha = nota('Retencoes conforme legislacao: PIS, COFINS e CSLL');
        const a = analisarRetencoes(linha);
        const incs = validarRetencoesLinha(linha, a);
        const inc = incs.find(i => i.codigo === 'RETENCAO_CITADA_SEM_VALOR');
        expect(inc).toBeTruthy();
        expect(inc!.mensagem).toMatch(/PIS, COFINS, CSLL/);
        expect(inc!.mensagem).toMatch(/não conseguiu ler/);
    });

    it('nota que nem cita tributo não vira alerta (senão vira ruído)', () => {
        const linha = nota('Servicos de engenharia prestados em julho.');
        const incs = validarRetencoesLinha(linha, analisarRetencoes(linha));
        expect(incs.find(i => i.codigo === 'RETENCAO_CITADA_SEM_VALOR')).toBeFalsy();
    });
});
