/**
 * Agregações do menu Relatórios (lista do Paulo, 01/08). A régua das colunas é
 * a MESMA do Exportar SAGE (alocarTributacaoIcms) — relatório nunca inventa
 * conta própria.
 */
import {
    resumoPorCfop, resumoImpostos, linhasServicos, linhasRetencoes, resumoPorUf,
} from '../services/relatoriosAgregacoes';

const nfe = (over: any = {}) => ({
    id: 'x', chave: 'k', tipo: 'NFe', tipoDoc: 'NFe', status: 'autorizado',
    direcao: 'entrada', dhEmi: '2026-06-10T10:00:00-03:00', numero: '1',
    valorTotal: 1000, totais: { vNF: 1000 },
    emitente: { cnpjCpf: '11111111000111', nome: 'FORN', uf: 'SP' },
    destinatario: { cnpjCpf: '22222222000122', nome: 'NOS', uf: 'SP' },
    itens: [{ cfop: '1102', ncm: '08039000', vProd: 1000, vICMS: 0, cst: '41' }],
    ...over,
});

const nfse = (over: any = {}) => ({
    id: 's', chave: 'sk', tipo: 'NFSe', tipoDoc: 'NFSe', status: 'autorizado',
    direcao: 'entrada', dhEmi: '2026-06-05T10:00:00-03:00', numero: '77',
    valorTotal: 2000,
    prestador: { cnpjCpf: '33333333000133', nome: 'PRESTADOR X', municipio: 'SÃO PAULO', uf: 'SP' },
    tomador: { cnpjCpf: '22222222000122', nome: 'NOS', uf: 'SP' },
    valores: { baseCalculo: 2000, iss: 100, valorIssRetido: 100, pis: 13, cofins: 60, ir: 30, inss: 0, csll: 20, liquido: 1877 },
    itens: [],
    ...over,
});

describe('resumoPorCfop', () => {
    it('agrupa por direção+CFOP com as colunas da alocação', () => {
        const r = resumoPorCfop([
            nfe(),
            nfe({ id: 'y', numero: '2', itens: [{ cfop: '1102', vProd: 500, vICMS: 90, vBC: 500, cst: '00' }], valorTotal: 500, totais: { vNF: 500 } }),
            nfe({ id: 'z', numero: '3', direcao: 'saida', itens: [{ cfop: '5102', vProd: 300, vICMS: 54, vBC: 300, cst: '00' }], valorTotal: 300, totais: { vNF: 300 } }),
        ] as any);
        expect(r).toHaveLength(2);
        const e1102 = r.find(l => l.cfop === '1102')!;
        expect(e1102.notas).toBe(2);
        expect(e1102.contabil).toBe(1500);
        expect(e1102.base).toBe(500);      // só a nota tributada
        expect(e1102.isentos).toBe(1000);  // CST 41
        const s5102 = r.find(l => l.cfop === '5102')!;
        expect(s5102.direcao).toBe('saida');
    });

    it('nota com DOIS CFOPs rateia o contábil sem perder centavo', () => {
        const r = resumoPorCfop([nfe({
            valorTotal: 1000.01, totais: { vNF: 1000.01 },
            itens: [
                { cfop: '1102', vProd: 600, vICMS: 108, vBC: 600, cst: '00' },
                { cfop: '1403', vProd: 400, vICMS: 0, cst: '60' },
            ],
        })] as any);
        const soma = r.reduce((s, l) => s + l.contabil, 0);
        expect(soma).toBeCloseTo(1000.01, 2);
    });

    it('cancelada fica fora', () => {
        expect(resumoPorCfop([nfe({ status: 'cancelado' })] as any)).toHaveLength(0);
    });
});

describe('resumoImpostos', () => {
    it('separa débito (saídas) de crédito destacado (entradas) e ISS de NFSe', () => {
        const r = resumoImpostos([
            nfe({ itens: [{ cfop: '1102', vProd: 1000, vICMS: 180, vIPI: 50, cst: '00' }] }),
            nfe({ id: 'v', direcao: 'saida', itens: [{ cfop: '5102', vProd: 2000, vICMS: 360, vIPI: 0, cst: '00' }] }),
            nfse(),                                    // tomado com ISS retido 100
            nfse({ id: 'p', direcao: 'saida', valores: { iss: 250 } }),  // prestado
        ] as any);
        expect(r.icms).toEqual({ creditoEntradas: 180, debitoSaidas: 360, saldo: 180 });
        expect(r.ipi.creditoEntradas).toBe(50);
        expect(r.iss).toEqual({ prestados: 250, retidoTomados: 100 });
    });
});

describe('serviços e retenções', () => {
    it('tomados = NFSe de entrada, com todas as retenções', () => {
        const l = linhasServicos([nfse(), nfe()] as any, 'entrada');
        expect(l).toHaveLength(1);
        expect(l[0]).toMatchObject({ participante: 'PRESTADOR X', iss: 100, issRetido: 100, ir: 30, csll: 20 });
        expect(l[0].retencoesFederaisGravadas).toBe(true);
    });

    it('retenções lista só quem reteve algo', () => {
        const semRet = nfse({ id: 'n2', valores: { baseCalculo: 500, iss: 25, valorIssRetido: 0, pis: 0, cofins: 0, ir: 0, inss: 0, csll: 0, liquido: 500 } });
        const l = linhasRetencoes([nfse(), semRet] as any, 'entrada');
        expect(l).toHaveLength(1);
    });

    it('doc antigo sem ir/inss/csll gravados é sinalizado (ausente ≠ zero retido)', () => {
        const antigo = nfse({ id: 'old', valores: { baseCalculo: 900, iss: 45, pis: 6, cofins: 27, liquido: 867 } });
        const l = linhasServicos([antigo] as any, 'entrada');
        expect(l[0].retencoesFederaisGravadas).toBe(false);
    });
});

describe('resumoPorUf', () => {
    it('agrupa pela UF da CONTRAPARTE (nota própria de entrada = destinatário)', () => {
        const r = resumoPorUf([
            nfe({ emitente: { cnpjCpf: '1', nome: 'A', uf: 'MG' } }),
            nfe({ id: 'b', direcao: 'saida', destinatario: { cnpjCpf: '2', nome: 'B', uf: 'PR' }, valorTotal: 300, totais: { vNF: 300 } }),
            // nota própria de entrada: emitente = empresa; produtor (MG) no destinatário
            nfe({ id: 'c', tpNF: '0', emitente: { cnpjCpf: '22222222000122', nome: 'NOS', uf: 'SP' }, destinatario: { cnpjCpf: '3', nome: 'PRODUTOR', uf: 'MG' }, valorTotal: 500, totais: { vNF: 500 } }),
        ] as any);
        const mg = r.find(l => l.uf === 'MG')!;
        expect(mg.entradasQtd).toBe(2);
        expect(mg.entradasValor).toBe(1500);
        expect(r.find(l => l.uf === 'PR')!.saidasValor).toBe(300);
    });
});
