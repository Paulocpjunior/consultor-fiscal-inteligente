/**
 * Testes do parser do Livro de ICMS Substituto (Office Fiscal) e do motor de
 * cálculo da GIA-ST. O parser é testado na camada pura (parseGiaStLinhas),
 * sem pdfjs — mesmo desenho do nfsePdfParser.test.ts.
 */

// Mock pdfjs-dist — resolve Worker no top-level e quebra jsdom. Só usamos a
// camada pura parseGiaStLinhas, que não toca pdfjs.
jest.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    version: '0.0.0',
    getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
}));

// Mock firebase — testamos só as funções puras (calcular/validar/montarId).
jest.mock('../services/firebaseConfig', () => ({
    db: {},
    auth: { currentUser: null },
    isFirebaseConfigured: true,
    isFirebaseStorageConfigured: false,
}));

import { parseGiaStLinhas, type LinhaTokens } from '../services/giaStParserService';
import { calcularGiaSt, validarGiaSt, montarIdGuia, type GiaStValores } from '../services/giaStService';

const zero: GiaStValores = {
    c7ValorProdutos: 0, c8ValorIpi: 0, c9DespesasAcessorias: 0,
    c10BcIcmsProprio: 0, c11IcmsProprio: 0, c12BcIcmsSt: 0, c13IcmsRetidoSt: 0,
    c14IcmsDevolucao: 0, c15IcmsRessarcimentos: 0, c16CreditoPeriodoAnterior: 0,
    c17PagamentosAntecipados: 0, c19RepasseRefinarias: 0, c39RepasseOutros: 0,
};

function linha(pagina: number, ...tokens: string[]): LinhaTokens {
    return { pagina, tokens };
}

/** Mini-relatório no formato do Office Fiscal (2 páginas: Entradas + Saídas). */
function relatorioBase(): LinhaTokens[] {
    return [
        linha(1, 'Office Fiscal'),
        linha(1, 'Livro de ICMS Substituto (Operações Interestaduais)'),
        linha(1, 'Empresa:', 'FLANACAR COMERCIO DE AUTO-PECAS LTDA'),
        linha(1, 'I.E.:', '734.041.267.115', 'CGC/CNPJ:', '96.312.889/0001-11'),
        linha(1, 'Mês de Referência/Ano:', '06/2026'),
        linha(1, 'B', 'Entradas de Mercadorias, Bens e/ou Aquisições de Serviços'),
        linha(1, '(AL)', 'ALAGOAS', '1.222,28', '874,29', '40,21', '1.607,10', '296,25'),
        linha(1, '(CE)', 'CEARÁ', '7.121,96', '6.022,67', '256,64', '5.965,02', '888,15'),
        linha(1, 'Totais', '8.344,24', '6.896,96', '296,85', '7.572,12', '1.184,40'),
        linha(2, 'C', 'Saídas de Mercadorias, Bens e/ou Venda de Serviços'),
        linha(2, '(AC)', 'ACRE', '104.736,49', '77.765,71', '3.110,63', '158.323,20', '26.970,78'),
        linha(2, '(SP)', 'SÃO PAULO', '1.265.056,70', '1.032.819,48', '185.907,31', '1.845.799,44', '146.859,55'),
        linha(2, '(ES)', 'ESPIRITO SANTO', '485.471,91', '466.032,37', '18.641,26', '0,00', '0,00'),
        linha(2, 'NULL', '0,00', '0,00', '0,00', '0,00', '0,00'),
        linha(2, 'Totais', '1.855.265,10', '1.576.617,56', '207.659,20', '2.004.122,64', '173.830,33'),
    ];
}

describe('parseGiaStLinhas', () => {
    it('extrai cabeçalho, seções e valores por UF do relatório Office Fiscal', () => {
        const r = parseGiaStLinhas(relatorioBase());

        expect(r.empresaNome).toBe('FLANACAR COMERCIO DE AUTO-PECAS LTDA');
        expect(r.empresaCnpj).toBe('96312889000111');
        expect(r.inscricaoEstadual).toBe('734.041.267.115');
        expect(r.competencia).toBe('2026-06');

        expect(r.entradas.linhas).toHaveLength(2);
        expect(r.saidas.linhas).toHaveLength(3); // NULL ignorada

        const sp = r.saidas.linhas.find(l => l.uf === 'SP')!;
        expect(sp.nomeUf).toBe('SÃO PAULO');
        expect(sp.valorContabil).toBeCloseTo(1265056.70, 2);
        expect(sp.baseCalculo).toBeCloseTo(1032819.48, 2);
        expect(sp.valorIcms).toBeCloseTo(185907.31, 2);
        expect(sp.bcIcmsRetido).toBeCloseTo(1845799.44, 2);
        expect(sp.icmsRetidoFonte).toBeCloseTo(146859.55, 2);

        const al = r.entradas.linhas.find(l => l.uf === 'AL')!;
        expect(al.icmsRetidoFonte).toBeCloseTo(296.25, 2);

        expect(r.validacao.ok).toBe(true);
        expect(r.validacao.divergencias).toHaveLength(0);
    });

    it('acusa divergência quando o total impresso não bate com a soma das UFs', () => {
        const linhas = relatorioBase().map(l =>
            l.tokens[0] === 'Totais' && l.pagina === 2
                ? linha(2, 'Totais', '9.999.999,99', '1.576.617,56', '207.659,20', '2.004.122,64', '173.830,33')
                : l,
        );
        const r = parseGiaStLinhas(linhas);
        expect(r.validacao.ok).toBe(false);
        expect(r.validacao.divergencias.some(d => d.includes('Saídas/valorContabil'))).toBe(true);
    });

    it('rejeita PDF que não é o Livro de ICMS Substituto', () => {
        expect(() => parseGiaStLinhas([
            linha(1, 'DANFE'),
            linha(1, 'Documento Auxiliar da Nota Fiscal Eletrônica'),
        ])).toThrow(/não parece ser/i);
    });

    it('tolera nome de UF quebrado em vários tokens', () => {
        const linhas = [
            linha(1, 'Empresa:', 'X LTDA'),
            linha(1, 'CGC/CNPJ:', '96.312.889/0001-11'),
            linha(1, 'Mês de Referência/Ano:', '06/2026'),
            linha(1, 'C', 'Saídas de Mercadorias'),
            linha(1, '(RN)', 'RIO', 'GRANDE', 'DO', 'NORTE', '524.816,31', '504.847,49', '20.193,89', '0,00', '0,00'),
        ];
        const r = parseGiaStLinhas(linhas);
        expect(r.saidas.linhas[0].uf).toBe('RN');
        expect(r.saidas.linhas[0].nomeUf).toBe('RIO GRANDE DO NORTE');
        expect(r.saidas.linhas[0].valorContabil).toBeCloseTo(524816.31, 2);
    });
});

describe('calcularGiaSt', () => {
    it('saldo positivo → campo 18 devido, campo 20 zero, 21 soma repasses', () => {
        const calc = calcularGiaSt({
            ...zero,
            c13IcmsRetidoSt: 1000,
            c14IcmsDevolucao: 100,
            c16CreditoPeriodoAnterior: 150,
            c19RepasseRefinarias: 30,
            c39RepasseOutros: 20,
        });
        expect(calc.c18IcmsStDevido).toBeCloseTo(750, 2);
        expect(calc.c20CreditoPeriodoSeguinte).toBe(0);
        expect(calc.c21TotalRecolher).toBeCloseTo(800, 2);
    });

    it('créditos maiores que o retido → campo 18 zero e campo 20 com o crédito', () => {
        const calc = calcularGiaSt({
            ...zero,
            c13IcmsRetidoSt: 500,
            c15IcmsRessarcimentos: 300,
            c16CreditoPeriodoAnterior: 400,
        });
        expect(calc.c18IcmsStDevido).toBe(0);
        expect(calc.c20CreditoPeriodoSeguinte).toBeCloseTo(200, 2);
        expect(calc.c21TotalRecolher).toBe(0);
    });

    it('arredonda a 2 casas (sem drift de ponto flutuante)', () => {
        const calc = calcularGiaSt({ ...zero, c13IcmsRetidoSt: 0.1, c14IcmsDevolucao: 0.03 });
        expect(calc.c18IcmsStDevido).toBeCloseTo(0.07, 10);
    });
});

describe('validarGiaSt', () => {
    const guiaOk = () => ({
        id: montarIdGuia('96.312.889/0001-11', 'SP', '2026-06'),
        empresaCnpj: '96312889000111',
        empresaNome: 'X LTDA',
        ufFavorecida: 'SP',
        inscricaoEstadualUfFavorecida: '123.456.789.000',
        competencia: '2026-06',
        semMovimento: false,
        retificacao: false,
        dataVencimento: '2026-07-10',
        informacoesComplementares: '',
        origemRelatorio: null,
        ...zero,
        c12BcIcmsSt: 1845799.44,
        c13IcmsRetidoSt: 146859.55,
        ...calcularGiaSt({ ...zero, c12BcIcmsSt: 1845799.44, c13IcmsRetidoSt: 146859.55 }),
    });

    it('guia completa é válida', () => {
        expect(validarGiaSt(guiaOk())).toHaveLength(0);
    });

    it('exige IE na UF favorecida quando há movimento', () => {
        const erros = validarGiaSt({ ...guiaOk(), inscricaoEstadualUfFavorecida: '' });
        expect(erros.some(e => e.includes('Inscrição Estadual'))).toBe(true);
    });

    it('acusa BC sem retenção e retenção sem BC', () => {
        expect(validarGiaSt({ ...guiaOk(), c13IcmsRetidoSt: 0, ...calcularGiaSt({ ...zero, c12BcIcmsSt: 100 }) , c12BcIcmsSt: 100 })
            .some(e => e.includes('13. ICMS Retido por ST = 0'))).toBe(true);
        expect(validarGiaSt({ ...guiaOk(), c12BcIcmsSt: 0 })
            .some(e => e.includes('12. BC ICMS-ST = 0'))).toBe(true);
    });

    it('sem movimento com valores preenchidos é inconsistente', () => {
        const erros = validarGiaSt({ ...guiaOk(), semMovimento: true });
        expect(erros.some(e => e.includes('sem movimento'))).toBe(true);
    });

    it('total a recolher sem vencimento é inconsistente', () => {
        const erros = validarGiaSt({ ...guiaOk(), dataVencimento: '' });
        expect(erros.some(e => e.includes('vencimento'))).toBe(true);
    });

    it('montarIdGuia normaliza CNPJ e competência', () => {
        expect(montarIdGuia('96.312.889/0001-11', 'sp', '2026-06')).toBe('96312889000111_SP_202606');
    });
});
