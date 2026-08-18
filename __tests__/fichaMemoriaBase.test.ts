/**
 * fichaMemoriaBase — a base impressa TEM que ser a base que gerou o imposto.
 *
 * Caso real: **KROYA IMPORTADORA 07/2026**, com a planilha que o Paulo manda ao
 * cliente ao lado da ficha do CFI (18/08). A planilha dele:
 *
 *   FATURAMENTO BRUTO ............ 99.258,46
 *   (−) DEDUÇÃO DO IPI ........... 14.198,36
 *   (−) DEDUÇÃO DO ICMS ..........  7.768,70
 *   (−) DEDUÇÃO DO ICMS ST .......      7,83
 *   NOVA BASE PIS/COFINS ......... 77.283,57
 *
 * A ficha imprimia **77.291,40** — exatamente R$ 7,83 a mais, o ICMS-ST.
 *
 * 🚨 E o pior não era a diferença: era a INCOERÊNCIA INTERNA. O núcleo deduzia o
 * ST e os impostos impressos saíam da base CERTA (PIS 502,34 = 0,65% de
 * 77.283,57), mas a tela tinha uma segunda conta "pra exibição" que não deduzia.
 * Ou seja o relatório mostrava uma base que NÃO produz o imposto três linhas
 * abaixo — num papel que vai ao CLIENTE, que divide e acha. É a família do modal
 * de CFOP que exibia 1405 enquanto o arquivo gravava 1403 (12/08):
 * **conferência que promete número diferente do que sai é pior que não ter.**
 *
 * A trava por isso não é "a base é 77.283,57" — é **a base impressa × 0,65% dá o
 * PIS impresso**. Assim ela pega qualquer segunda cópia futura, não só esta.
 */
import { calcularLucro } from '../services/lucroService';
import type { LucroInput } from '../types';
import { saldosDaFicha, itensVisiveis, competenciaSeguinteDe } from '../services/saldoCredorFicha';

const base: LucroInput = {
    regimeSelecionado: 'Presumido',
    periodoApuracao: 'Trimestral',
    mesReferencia: '2026-07',
    faturamentoComercio: 99258.46,
    faturamentoIndustria: 0,
    faturamentoServico: 0,
    faturamentoMonofasico: 0,
    valorIpi: 14198.36,
    valorIcmsSt: 7.83,
    valorDevolucoes: 0,
    icmsVendas: 7768.70,
    receitaFinanceira: 0,
    despesasOperacionais: 0,
    folhaPagamento: 0,
    custoMercadoriaVendida: 0,
    issConfig: { tipo: 'aliquota_municipal', aliquota: 5 },
} as unknown as LucroInput;

describe('KROYA 07/2026 — a memória da base bate com a planilha do cliente', () => {
    const r = calcularLucro(base);
    const m = r.memoriaBase!;

    it('a memória sai do cálculo, com cada dedução nomeada', () => {
        expect(m.faturamentoBruto).toBeCloseTo(99258.46, 2);
        expect(m.deducaoIpi).toBeCloseTo(14198.36, 2);
        expect(m.deducaoIcmsSt).toBeCloseTo(7.83, 2);
        expect(m.deducaoIcmsVendas).toBeCloseTo(7768.70, 2);
    });

    it('base IRPJ/CSLL é líquida de IPI e de ICMS-ST (nunca do ICMS s/ vendas)', () => {
        // 99.258,46 − 14.198,36 − 7,83 = 85.052,27
        expect(m.baseIrpjCsll).toBeCloseTo(85052.27, 2);
    });

    it('base PIS/COFINS é a da planilha do Paulo, ao centavo', () => {
        expect(m.basePisCofins).toBeCloseTo(77283.57, 2);
    });

    it('🚨 a base impressa PRODUZ o imposto impresso — a trava que pega cópia nova', () => {
        const pis = r.detalhamento.find(d => d.imposto.startsWith('PIS'))!;
        const cofins = r.detalhamento.find(d => d.imposto.startsWith('COFINS'))!;
        // Os valores do PDF real da ficha: PIS 502,34 · COFINS 2.318,51.
        expect(pis.valor).toBeCloseTo(502.34, 2);
        expect(cofins.valor).toBeCloseTo(2318.51, 2);
        // E é a MESMA base — se alguém reintroduzir uma conta "de exibição", a
        // igualdade abaixo cai antes de o papel chegar ao cliente.
        expect(pis.baseCalculo).toBeCloseTo(m.basePisCofins, 2);
        expect(m.basePisCofins * 0.0065).toBeCloseTo(pis.valor, 2);
        expect(m.basePisCofins * 0.03).toBeCloseTo(cofins.valor, 2);
    });

    it('sem ICMS-ST a base não muda de comportamento (não é caso especial)', () => {
        const semSt = calcularLucro({ ...base, valorIcmsSt: 0 });
        expect(semSt.memoriaBase!.baseIrpjCsll).toBeCloseTo(85060.10, 2);
        expect(semSt.memoriaBase!.basePisCofins).toBeCloseTo(77291.40, 2);
    });

    it('o Lucro Real também produz a memória — a ficha é a mesma tela', () => {
        const real = calcularLucro({ ...base, regimeSelecionado: 'Real' });
        expect(real.memoriaBase).toBeDefined();
        expect(real.memoriaBase!.deducaoIcmsSt).toBeCloseTo(7.83, 2);
        expect(real.memoriaBase!.basePisCofins).toBeCloseTo(77283.57, 2);
    });
});

describe('saldo credor: o que ENTROU × o que vai para o mês seguinte', () => {
    it('a competência seguinte é escrita, inclusive virando o ano', () => {
        expect(competenciaSeguinteDe('2026-07')).toBe('08/2026');
        expect(competenciaSeguinteDe('2026-12')).toBe('01/2027');
        expect(competenciaSeguinteDe('')).toBeNull();
        expect(competenciaSeguinteDe('julho')).toBeNull();
    });

    it('KROYA: o saldo CRESCEU no mês — por isso não se deriva', () => {
        const s = saldosDaFicha({
            mesReferencia: '2026-07',
            saldoCredorIcms: 486477.01,
            saldoCredorIcmsTransportar: 521793.35,
            saldoCredorIpi: 5336.84,
            saldoCredorIpiTransportar: 4091.68,
        });
        const icms = s.itens.find(i => i.tributo === 'ICMS')!;
        expect(icms.situacao).toBe('informado');
        expect(icms.transportar).toBeCloseTo(521793.35, 2);
        // Prova de que a derivação "entrou − a recolher" seria MENOR que o real:
        expect(icms.transportar!).toBeGreaterThan(icms.anterior!);
        expect(s.faltaInformar).toBe(false);
    });

    it('🚨 em branco NÃO vira zero — o relatório diz que não foi informado', () => {
        const s = saldosDaFicha({
            mesReferencia: '2026-07',
            saldoCredorIcms: 486477.01,
        });
        const icms = s.itens.find(i => i.tributo === 'ICMS')!;
        expect(icms.situacao).toBe('nao-informado');
        expect(icms.transportar).toBeNull();
        expect(icms.texto).toMatch(/não informado/);
        // A ação vai na frase: em branco ≠ sem saldo.
        expect(icms.texto).toMatch(/não quer dizer que não há saldo/);
        expect(s.faltaInformar).toBe(true);
    });

    it('zero DIGITADO é resposta: o crédito acabou', () => {
        const s = saldosDaFicha({
            mesReferencia: '2026-07',
            saldoCredorIcms: 1000,
            saldoCredorIcmsTransportar: 0,
        });
        const icms = s.itens.find(i => i.tributo === 'ICMS')!;
        expect(icms.situacao).toBe('zerado');
        expect(icms.texto).toMatch(/consumido nesta competência/);
        expect(s.faltaInformar).toBe(false);
    });

    it('empresa sem saldo nenhum não vira alarme nem bloco na tela', () => {
        const s = saldosDaFicha({ mesReferencia: '2026-07' });
        expect(s.faltaInformar).toBe(false);
        expect(itensVisiveis(s)).toHaveLength(0);
    });

    it('Number(null) não engana: null é ausência, 0 é resposta', () => {
        const s = saldosDaFicha({ mesReferencia: '2026-07', saldoCredorIpiTransportar: 0 });
        expect(s.itens.find(i => i.tributo === 'IPI')!.situacao).toBe('zerado');
        expect(s.itens.find(i => i.tributo === 'ICMS')!.situacao).toBe('nao-informado');
    });
});
