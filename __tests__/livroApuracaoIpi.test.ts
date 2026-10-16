/**
 * 🏭 LIVRO DE APURAÇÃO DO IPI (modelo 8) NOS RELATÓRIOS (16/10).
 *
 * Paulo mandou o modelo do e-Fiscal (PWR · 09/2026): Entradas CFOP 1.101 com
 * 2.054,16 em "Outras", Saídas 5.101 com 71.310,79 em "Outras", e o
 * Demonstrativo com saldo credor anterior 7.343,69 transportado inteiro.
 *
 * Fatos cobrados: as colunas seguem a CST do IPI (com imposto → base e
 * imposto; isenta/NT/imune/alíquota zero → Isentas; o resto → Outras); as
 * linhas agrupam por família de CFOP com subtotal e total; o demonstrativo é
 * o E520 (débito, crédito, saldo anterior, saldo devedor ou credor); e o
 * livro e o arquivo saem do MESMO dono (`apurarIpi`).
 */
import { montarRaipi, colunasDoGrupoIpi } from '../sefaz-backend/apuracao-ipi-raipi.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { apurarIpi } from '../sefaz-backend/sped-fiscal-blocoE.js';

describe('as colunas seguem a CST do IPI', () => {
    it('com imposto: base e imposto; o que sobra do contábil vai em Outras', () => {
        expect(colunasDoGrupoIpi({ cfop: '5101', cst: '50', vlCont: 1150, vlBc: 1000, vlIpi: 100 }))
            .toEqual({ vlCont: 1150, bc: 1000, imposto: 100, isentas: 0, outras: 50 });
    });
    it.each(['01', '02', '03', '04', '52', '53'])('CST %s sem imposto: Isentas/Não tributadas', (cst) => {
        expect(colunasDoGrupoIpi({ cfop: '1101', cst, vlCont: 300, vlBc: 0, vlIpi: 0 }).isentas).toBe(300);
    });
    it.each(['05', '49', '55', '99', '00'])('CST %s sem imposto: Outras', (cst) => {
        expect(colunasDoGrupoIpi({ cfop: '1101', cst, vlCont: 300, vlBc: 0, vlIpi: 0 }).outras).toBe(300);
    });
});

describe('o modelo da PWR · 09/2026', () => {
    const livro = montarRaipi({
        gera: true, vlSdAnt: 7343.69, vlDeb: 0, vlCred: 0, vlSdIpi: 0, vlScIpi: 7343.69,
        e510: {
            avisos: [],
            grupos: [
                { cfop: '1101', cst: '49', vlCont: 2054.16, vlBc: 0, vlIpi: 0 },
                { cfop: '5101', cst: '99', vlCont: 71310.79, vlBc: 0, vlIpi: 0 },
            ],
        },
    });

    it('Entradas: 1.000 do Estado, CFOP 1.101 com 2.054,16 em Outras', () => {
        expect(livro.entradas.familias).toEqual([{
            titulo: '1.000 - Entradas ou Aquisições de Serviços do Estado',
            linhas: [{ cfop: '1.101', vlCont: 2054.16, bc: 0, imposto: 0, isentas: 0, outras: 2054.16 }],
            subtotal: { vlCont: 2054.16, bc: 0, imposto: 0, isentas: 0, outras: 2054.16 },
        }]);
        expect(livro.entradas.total.vlCont).toBe(2054.16);
    });

    it('Saídas: 5.000 para o Estado, CFOP 5.101 com 71.310,79 em Outras', () => {
        expect(livro.saidas.familias[0].titulo).toBe('5.000 - Saídas ou Prestações de Serviços para o Estado');
        expect(livro.saidas.total).toEqual({ vlCont: 71310.79, bc: 0, imposto: 0, isentas: 0, outras: 71310.79 });
    });

    it('Demonstrativo: 009 e 010 com o saldo anterior, 012 transporta 7.343,69', () => {
        const d = Object.fromEntries(livro.demonstrativo.map((l) => [l.codigo, l.soma]));
        expect(d).toMatchObject({ '001': 0, '004': 0, '005': 0, '008': 0, '009': 7343.69, '010': 7343.69, '011': 0, '012': 7343.69 });
        expect(livro.devedor).toBe(false);
        expect(livro.saldoCredorATransportar).toBe(7343.69);
    });
});

describe('o livro e o E520 saem do mesmo dono', () => {
    const saida = {
        direcao: 'saida', tpNF: '1', modelo: '55', numero: '10', status: 'autorizado',
        itens: [{ cfop: '6101', cstIpi: '50', vProd: 1000, vBcIpi: 1000, vIPI: 100 }],
    };
    const entrada = {
        direcao: 'entrada', tpNF: '0', modelo: '55', numero: '20', status: 'autorizado',
        itens: [{ cfop: '5101', cstIpi: '50', vProd: 400, vBcIpi: 400, vIPI: 40 }],
    };
    const dados: any = {
        notas: [saida, entrada], saldoCredorIpiAnterior: 0, warnings: [],
        regimeEscrituracao: 'LUCRO_PRESUMIDO',
        empresa: { cnpj: '31947349000169', dadosFiscais: { uf: 'SP', contribuinteIpi: 'sim' } },
    };
    const ap = apurarIpi(dados);
    const livro = montarRaipi(ap);

    it('o débito e o crédito do livro são os do E520', () => {
        expect(ap.gera).toBe(true);
        expect(ap.vlDeb).toBe(100);
        expect(ap.vlCred).toBe(40);   // a fixture alcança o ramo do crédito
        expect(livro.saidas.total.imposto).toBe(ap.vlDeb);
        expect(livro.entradas.total.imposto).toBe(ap.vlCred);
        const d = Object.fromEntries(livro.demonstrativo.map((l) => [l.codigo, l.soma]));
        expect(d['001']).toBe(ap.vlDeb);
        expect(d['005']).toBe(ap.vlCred);
        expect(d['011']).toBe(ap.vlSdIpi);
        expect(livro.avisos).toEqual([]);
    });

    it('empresa marcada como NÃO contribuinte: o dono diz, e o arquivo não leva o bloco', () => {
        const nc = apurarIpi({ ...dados, empresa: { ...dados.empresa, dadosFiscais: { uf: 'SP', contribuinteIpi: 'nao' } } });
        expect(nc).toMatchObject({ gera: false, naoContribuinte: true });
    });
});
