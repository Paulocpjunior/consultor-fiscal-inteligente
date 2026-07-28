/**
 * A MEMÓRIA DE APURAÇÃO tem de bater com o card ao vivo.
 *
 * Caso A CASTELLANO METALURGICA, 2T/2026 (28/07): a tela mostrava IRPJ
 * R$ 25.609,40 (certo) e o relatório impresso R$ 25.658,44 (o valor antigo).
 * Causa: o relatório NÃO usa o estado da tela — ele recalcula a partir da
 * ficha salva, via `convertFichaToInput`, e esse conversor não carregava o
 * campo novo (saldo do trimestre anterior da LC 224/25). Todo campo que muda
 * imposto precisa atravessar esse conversor, senão as duas telas divergem.
 */
import { convertFichaToInput } from '../components/LucroPresumidoReal/fichaCalc';
import { calcularLucro } from '../services/lucroService';
import type { FichaFinanceiraRegistro, LucroPresumidoEmpresa } from '../types';

const empresa = {
    id: 'e1',
    nome: 'A CASTELLANO INDUSTRIA METALURGICA LTDA',
    cnpj: '51227692000146',
    issPadraoConfig: { tipo: 'nao_incide', aliquota: 0 },
    fichaFinanceira: [],
} as unknown as LucroPresumidoEmpresa;

/** Ficha real do 2T/2026 (junho, com abr+mai no acumulado do trimestre). */
const ficha = (over: Partial<FichaFinanceiraRegistro> = {}) => ({
    id: 'f1',
    dataRegistro: 0,
    mesReferencia: '2026-06',
    regime: 'Presumido',
    periodoApuracao: 'Trimestral',
    acumuladoAno: 0,
    saldoLimiteAnteriorLc224: 24_520.97,   // "Saldo do Trimestre Anterior" do relatório oficial

    faturamentoMesComercio: 0,
    faturamentoMesIndustria: 508_907.88,
    faturamentoMesServico: 0,
    faturamentoMesServicoRetido: 0,
    faturamentoMesLocacao: 0,
    faturamentoMesServicoHospitalar: 0,

    dadosTrimestrais: {
        comercio: 0, industria: 1_022_951.63, servico: 0, servicoHospitalar: 0,
        financeira: 0, aluguel: 0, mesesConsiderados: [],
    },

    faturamentoMonofasico: 0,
    valorIpi: 0,
    valorDevolucoes: 0,
    icmsVendas: 68_777.33,
    receitaFinanceira: 9_415.40,
    faturamentoMesTotal: 508_907.88,
    totalGeral: 0,
    despesas: 0, despesasDedutiveis: 0, folha: 0, cmv: 0,
    retencaoPis: 0, retencaoCofins: 0, retencaoIrpj: 1_896.32, retencaoCsll: 0,
    totalImpostos: 0, cargaTributaria: 0,
    ...over,
}) as unknown as FichaFinanceiraRegistro;

const impostoDe = (f: FichaFinanceiraRegistro, nome: string) =>
    calcularLucro(convertFichaToInput(f, empresa)).detalhamento.find(d => d.imposto.startsWith(nome));

describe('relatório impresso × card ao vivo (A CASTELLANO, 2T/2026)', () => {
    it('o IRPJ do relatório é o mesmo da tela: R$ 25.609,40', () => {
        const irpj = impostoDe(ficha(), 'IRPJ')!;
        expect(irpj.baseCalculo).toBeCloseTo(134_022.87, 2);
        expect(irpj.valor).toBeCloseTo(25_609.40, 2);
    });

    it('a CSLL segue igual — no 2T/2026 ela não tem saldo anterior (nonagesimal)', () => {
        const csll = impostoDe(ficha(), 'CSLL')!;
        expect(csll.baseCalculo).toBeCloseTo(196_620.86, 2);
        expect(csll.valor).toBeCloseTo(17_695.88, 2);
    });

    it('REGRESSÃO: sem o saldo atravessar o conversor, voltava o R$ 25.658,44', () => {
        const semSaldo = impostoDe(ficha({ saldoLimiteAnteriorLc224: 0 }), 'IRPJ')!;
        expect(semSaldo.valor).toBeCloseTo(25_658.44, 2);
        expect(semSaldo.valor - impostoDe(ficha(), 'IRPJ')!.valor).toBeCloseTo(49.04, 2);
    });

    it('a observação do relatório mostra o "Total do Limite" do relatório oficial', () => {
        expect(impostoDe(ficha(), 'IRPJ')!.observacao).toMatch(/1\.274\.520,97/);
    });
});

describe('o conversor precisa carregar TUDO que muda imposto', () => {
    it('ICMS-ST destacado deduz a receita bruta também no relatório', () => {
        const semSt = impostoDe(ficha(), 'IRPJ')!;
        const comSt = impostoDe(ficha({ valorIcmsSt: 50_000 } as any), 'IRPJ')!;
        expect(comSt.baseCalculo).toBeLessThan(semSt.baseCalculo);
    });

    it('campos de limite e dedução chegam ao input do cálculo', () => {
        const input = convertFichaToInput(ficha({ valorIcmsSt: 1_234 } as any), empresa);
        expect(input.saldoLimiteAnteriorLc224).toBeCloseTo(24_520.97, 2);
        expect(input.valorIcmsSt).toBe(1_234);
        expect(input.acumuladoTrimestre?.industria).toBeCloseTo(1_022_951.63, 2);
        expect(input.mesReferencia).toBe('2026-06');
        expect(input.periodoApuracao).toBe('Trimestral');
    });
});
