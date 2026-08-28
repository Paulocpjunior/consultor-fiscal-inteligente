/**
 * Agregações do menu Relatórios (lista do Paulo, 01/08). A régua das colunas é
 * a MESMA do Exportar SAGE (alocarTributacaoIcms) — relatório nunca inventa
 * conta própria.
 */
import {
    resumoPorCfop, resumoImpostos, linhasServicos, linhasRetencoes, resumoPorUf,
    nfCanceladasFaltantes, formatarFaixas, lerFaltantes, resumoPorParticipante,
    resumoPorAliquota, resumoPorProduto, servicosPorCodigo,
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

/** Contexto da correlação — comércio é o caso comum da carteira. */
const CTX = { naturezaAtividade: 'comercio' };

// ============================================================================
// O CFOP DA ENTRADA É O CORRELACIONADO, NÃO O DO FORNECEDOR.
//
// Paulo, 14/08, apontando o Livro de Entradas: *"o relatório é com base nos
// CFOPs de saída dos fornecedores dos nossos clientes, ou seja tudo que o
// cliente compra vira CFOP de entrada de acordo com a correlação necessária"*.
//
// O XML de uma compra é do FORNECEDOR e traz o CFOP de SAÍDA dele. Quem
// escritura a entrada lança 1102/2102. A régua já existia (`correlacionarCfop`,
// usada pelo Exportar SAGE e pelo modal) — faltava nos relatórios, que era o
// TERCEIRO lugar a precisar dela.
// ============================================================================
describe('correlação do CFOP nas ENTRADAS', () => {
    const compra = (cfop: string, over: Record<string, unknown> = {}) => nfe({
        direcao: 'entrada',
        itens: [{ cfop, vProd: 1000, vICMS: 180, vBC: 1000, cst: '00' }],
        valorTotal: 1000, totais: { vNF: 1000 },
        ...over,
    });

    it('compra interna: o 5102 do fornecedor vira 1102 no livro', () => {
        const r = resumoPorCfop([compra('5102')] as any, CTX);
        expect(r.map(l => l.cfop)).toEqual(['1102']);
    });

    it('compra INTERESTADUAL: 6102 vira 2102 — o estado do fornecedor não se perde', () => {
        const r = resumoPorCfop([compra('6102')] as any, CTX);
        expect(r.map(l => l.cfop)).toEqual(['2102']);
    });

    it('indústria compra para INDUSTRIALIZAR: o sufixo muda para 101', () => {
        // É por isso que a natureza da atividade tem de viajar junto — e por
        // isso a tela e o PDF dizem qual foi usada e de onde ela veio.
        const r = resumoPorCfop([compra('5102')] as any, { naturezaAtividade: 'industria' });
        expect(r.map(l => l.cfop)).toEqual(['1101']);
    });

    it('SAÍDA não é correlacionada — o CFOP já é o da empresa', () => {
        const r = resumoPorCfop([nfe({
            direcao: 'saida',
            itens: [{ cfop: '5102', vProd: 300, vICMS: 54, vBC: 300, cst: '00' }],
            valorTotal: 300, totais: { vNF: 300 },
        })] as any, CTX);
        expect(r.map(l => l.cfop)).toEqual(['5102']);
    });

    it('nota própria de entrada (art. 136) já nasce 1xxx e passa INTACTA', () => {
        // Compra de produtor rural: a nota é emitida pelo próprio cliente, com
        // CFOP de entrada. Correlacionar de novo seria mexer no que já está certo.
        const r = resumoPorCfop([compra('1102')] as any, CTX);
        expect(r.map(l => l.cfop)).toEqual(['1102']);
    });

    it('override manual do cadastro VENCE a correlação automática', () => {
        const r = resumoPorCfop([compra('5102')] as any, {
            naturezaAtividade: 'comercio',
            cfopOverrides: { '5102': '1556' },
        });
        expect(r.map(l => l.cfop)).toEqual(['1556']);
    });
});

describe('resumoPorCfop', () => {
    it('agrupa por direção+CFOP com as colunas da alocação', () => {
        const r = resumoPorCfop([
            nfe(),
            nfe({ id: 'y', numero: '2', itens: [{ cfop: '1102', vProd: 500, vICMS: 90, vBC: 500, cst: '00' }], valorTotal: 500, totais: { vNF: 500 } }),
            nfe({ id: 'z', numero: '3', direcao: 'saida', itens: [{ cfop: '5102', vProd: 300, vICMS: 54, vBC: 300, cst: '00' }], valorTotal: 300, totais: { vNF: 300 } }),
        ] as any, CTX);
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
        })] as any, CTX);
        const soma = r.reduce((s, l) => s + l.contabil, 0);
        expect(soma).toBeCloseTo(1000.01, 2);
    });

    it('cancelada fica fora', () => {
        expect(resumoPorCfop([nfe({ status: 'cancelado' })] as any, CTX)).toHaveLength(0);
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

    it('retenções lista só quem reteve algo — mas exclui só quem tem CERTEZA de zero (campos gravados)', () => {
        const semRet = nfse({ id: 'n2', valores: { baseCalculo: 500, iss: 25, valorIssRetido: 0, pis: 0, cofins: 0, ir: 0, inss: 0, csll: 0, liquido: 500 } });
        const l = linhasRetencoes([nfse(), semRet] as any, 'entrada');
        expect(l).toHaveLength(1);
        expect(l[0].ir).toBe(30);   // a que reteve (default da fábrica), não a semRet
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 CASO CLUDE (Paulo, 19/08) — o relatório sumia justamente as notas que
    // precisava mostrar. "0 NFS-e" para uma competência com 67 notas tomadas,
    // porque nota sem IR/INSS/CSLL gravado soma ZERO igual a nota CONFIRMADA
    // sem retenção — e o filtro só olhava a soma. As duas foram pro mesmo
    // balde: sumido. "Deve conter as notas com os devidos impostos retidos" —
    // sumir a nota é o jeito mais silencioso de errar essa promessa.
    // ═══════════════════════════════════════════════════════════════════════
    it('nota SEM os campos gravados entra na lista (não sabemos se reteve, não afirmamos que não)', () => {
        const antiga = nfse({ id: 'old', valores: { baseCalculo: 900, iss: 45, pis: 6, cofins: 27, liquido: 867 } }); // sem ir/inss/csll
        const l = linhasRetencoes([antiga] as any, 'entrada');
        expect(l).toHaveLength(1);
        expect(l[0].retencoesFederaisGravadas).toBe(false);
    });

    it('doc antigo sem ir/inss/csll gravados é sinalizado (ausente ≠ zero retido)', () => {
        const antigo = nfse({ id: 'old', valores: { baseCalculo: 900, iss: 45, pis: 6, cofins: 27, liquido: 867 } });
        const l = linhasServicos([antigo] as any, 'entrada');
        expect(l[0].retencoesFederaisGravadas).toBe(false);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 A SEGUNDA METADE DO CASO CLUDE (19/08): o documento TEM as retenções —
    // na OUTRA forma. O importador do CSV do portal grava `valorIr`/`valorInss`
    // ACHATADOS na raiz, e o relatório só lia `valores.*`: nota com IR gravado
    // imprimia "?". A leitura agora é do DONO (lerRetencoesFederaisDoDoc),
    // nunca uma segunda cópia.
    // ═══════════════════════════════════════════════════════════════════════
    it('forma ACHATADA do portal (valorIr/valorInss na raiz) aparece — e sem "?"', () => {
        const csv = nfse({
            id: 'csv', valores: undefined,
            valorTotal: 1000, valorPis: 6.5, valorCofins: 30, valorIr: 15, valorInss: 0, valorCsll: 10,
        });
        const l = linhasServicos([csv] as any, 'entrada');
        expect(l[0].ir).toBe(15);
        expect(l[0].inss).toBe(0);
        expect(l[0].csll).toBe(10); // 1% da base — CSLL de verdade
        expect(l[0].retencoesFederaisGravadas).toBe(true);
        expect(l[0].csrfSemRateio).toBe(0);
    });

    // Caso CLINIPAR (07/08, conferido contra o print do IOB): base 590,10 e a
    // coluna "CSLL" do export = 27,44 = PIS 3,84 + COFINS 17,70 + CSLL 5,90 —
    // o TOTAL das três. Somar como CSLL contaria PIS e COFINS em dobro.
    it('CSLL com assinatura de 4,65% é o TOTAL (CSRF): sai da coluna, vai marcada', () => {
        const clinipar = nfse({
            id: 'clinipar', valores: undefined,
            valorTotal: 590.10, valorPis: 3.84, valorCofins: 17.70, valorCsll: 27.44,
        });
        const l = linhasServicos([clinipar] as any, 'entrada');
        expect(l[0].csll).toBe(0);
        expect(l[0].csrfSemRateio).toBe(27.44);
        expect(l[0].pis).toBe(3.84);    // PIS/COFINS individuais são de verdade
        expect(l[0].cofins).toBe(17.70);
        // E a nota NÃO some da aba Retenções — a retenção existe, sem rateio.
        expect(linhasRetencoes([clinipar] as any, 'entrada')).toHaveLength(1);
    });

    // Caso ATLAS SCHINDLER (07/08, NFS-e 00375235): PIS 56,32 (1,65%) e COFINS
    // 259,41 (7,60%) são o tributo da OPERAÇÃO do prestador (não-cumulativo),
    // não retenção; a retenção real é a CSRF 158,72 (4,65%).
    it('PIS/COFINS da OPERAÇÃO (1,65%/7,60%) não viram retenção; a CSRF vai marcada', () => {
        const atlas = nfse({
            id: 'atlas', valores: undefined,
            valorTotal: 3413.24, valorPis: 56.32, valorCofins: 259.41, valorCsll: 158.72,
        });
        const l = linhasServicos([atlas] as any, 'entrada');
        expect(l[0].pis).toBe(0);
        expect(l[0].cofins).toBe(0);
        expect(l[0].pisCofinsOperacao).toBe(315.73);
        expect(l[0].csll).toBe(0);
        expect(l[0].csrfSemRateio).toBe(158.72);
        expect(linhasRetencoes([atlas] as any, 'entrada')).toHaveLength(1);
    });
});

describe('servicosPorCodigo (colaborador via Paulo, 10/08)', () => {
    // Duas notas do 0107, uma do 0205 e uma SEM código — o grupo vazio não some.
    const docs = [
        nfse({ id: 'a', codigoServico: '0107', discriminacao: 'Assessoria contábil mensal' }),
        nfse({
            id: 'b', codigoServico: '0107', discriminacao: 'Assessoria contábil mensal',
            valorTotal: 1000,
            valores: { baseCalculo: 1000, iss: 50, valorIssRetido: 0, pis: 6.5, cofins: 30, ir: 15, inss: 0, csll: 10, liquido: 938.5 },
        }),
        nfse({
            id: 'c', codigoServico: '0205', discriminacao: 'Consultoria tributária',
            valorTotal: 500,
            valores: { baseCalculo: 500, iss: 25, valorIssRetido: 25, pis: 0, cofins: 0, ir: 0, inss: 0, csll: 0, liquido: 475 },
        }),
        nfse({
            id: 'd', discriminacao: 'Nota do trilho sem código',
            valorTotal: 300,
            valores: { baseCalculo: 300, iss: 15, valorIssRetido: 0, pis: 0, cofins: 0, ir: 0, inss: 0, csll: 0, liquido: 300 },
        }),
    ];

    it('subtotal por código com todas as retenções e o total retido do grupo', () => {
        const g = servicosPorCodigo(docs as any, 'entrada');
        expect(g.map(x => x.codigo)).toEqual(['0107', '0205', '']);
        const g0107 = g[0];
        expect(g0107).toMatchObject({ notas: 2, bruto: 3000, issRetido: 100, ir: 45, pis: 19.5, cofins: 90, csll: 30 });
        // ISS retido 100 + IR 45 + PIS 19.5 + COFINS 90 + CSLL 30 = 284.5
        expect(g0107.totalRetido).toBeCloseTo(284.5, 2);
        expect(g0107.descricaoExemplo).toBe('Assessoria contábil mensal');
    });

    it('nota sem código vira grupo nomeado, POR ÚLTIMO — nunca some do total', () => {
        const g = servicosPorCodigo(docs as any, 'entrada');
        const sem = g[g.length - 1];
        expect(sem.codigo).toBe('');
        expect(sem.rotulo).toBe('Sem código de serviço');
        expect(sem.notas).toBe(1);
        const totalBruto = g.reduce((t, x) => t + x.bruto, 0);
        expect(totalBruto).toBe(3800); // 2000 + 1000 + 500 + 300 — a sem-código conta
    });

    it('nota antiga sem campos federais conta no aviso do grupo', () => {
        const antigo = nfse({ id: 'old', codigoServico: '0107', valores: { baseCalculo: 900, iss: 45, liquido: 855 } });
        const g = servicosPorCodigo([antigo] as any, 'entrada');
        expect(g[0].semCamposGravados).toBe(1);
    });

    it('direção filtra: prestados não mistura com tomados', () => {
        const prestada = nfse({ id: 'p', direcao: 'saida', codigoServico: '0107' });
        const g = servicosPorCodigo([prestada, ...docs] as any, 'saida');
        expect(g).toHaveLength(1);
        expect(g[0].notas).toBe(1);
    });
});

describe('nfCanceladasFaltantes', () => {
    const propria = (numero: string, over: any = {}) => nfe({
        id: `n${numero}`, numero, serie: '001', modelo: '55', direcao: 'saida',
        emitente: { cnpjCpf: '22222222000122', nome: 'NOS', uf: 'SP' },
        destinatario: { cnpjCpf: '1', nome: 'CLIENTE', uf: 'SP' },
        ...over,
    });

    it('acha buracos e canceladas por série; cancelada NÃO é faltante', () => {
        const r = nfCanceladasFaltantes([
            propria('100'), propria('101', { status: 'cancelado' }), propria('104'),
        ] as any, '22.222.222/0001-22');
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            modelo: '55', serie: '1', primeiro: 100, ultimo: 104,
            autorizadas: 2, canceladas: [101], faltantes: [102, 103], faltantesTotal: 2,
        });
    });

    it('nota própria de entrada (tpNF=0, direção já normalizada) consome número do talão', () => {
        const r = nfCanceladasFaltantes([
            propria('200'),
            propria('201', { direcao: 'entrada', tpNF: '0', destinatario: { cnpjCpf: '3', nome: 'PRODUTOR', uf: 'SP' } }),
            propria('202'),
        ] as any, '22222222000122');
        expect(r[0].faltantesTotal).toBe(0);
    });

    it('nota de FORNECEDOR não entra na conta da numeração', () => {
        const r = nfCanceladasFaltantes([propria('300'), nfe({ numero: '999' })] as any, '22222222000122');
        expect(r).toHaveLength(1);
        expect(r[0].ultimo).toBe(300);
    });

    it('formatarFaixas compacta sequências', () => {
        expect(formatarFaixas([3, 4, 5, 9, 11, 12])).toBe('3–5, 9, 11–12');
        expect(formatarFaixas([7])).toBe('7');
        expect(formatarFaixas([])).toBe('');
    });

    /**
     * Caso LAV COMÉRCIO DE AUTOPEÇAS (Eunice, 12/08): 759 faltantes, e a
     * pergunta foi pela sequência completa — para conferir uma a uma. Com mais
     * buracos do que notas, a lista não é o produto: a captura da saída é que
     * não está trazendo as notas, e a ação é outra.
     */
    describe('lerFaltantes — a causa junto do número', () => {
        const serie = (over: any) => ({
            modelo: '55', serie: '1', primeiro: 1, ultimo: 100, autorizadas: 0,
            canceladas: [], faltantes: [], faltantesTotal: 0, ...over,
        });

        it('mais buracos que notas ⇒ é CAPTURA, e manda para a Cobertura de Saída', () => {
            const r = lerFaltantes([serie({ primeiro: 1, ultimo: 1000, faltantesTotal: 900 })] as any);
            expect(r.causa).toBe('captura-incompleta');
            expect(r.faltantes).toBe(900);
            expect(r.capturadas).toBe(100);
            expect(r.acao).toMatch(/Cobertura de Saída/);
            expect(r.acao).toMatch(/não é uma lista para conferir uma a uma|não é\s*\n?\s*uma lista/);
            expect(r.acao).toMatch(/641/);
        });

        it('poucos buracos num talão capturado ⇒ AÍ SIM se confere número a número', () => {
            const r = lerFaltantes([serie({ primeiro: 1, ultimo: 100, faltantesTotal: 3 })] as any);
            expect(r.causa).toBe('buraco-pontual');
            expect(r.acao).toMatch(/número a número/);
            expect(r.acao).toMatch(/inutilização/);
        });

        it('sem buraco não inventa alarme', () => {
            expect(lerFaltantes([serie({})] as any).causa).toBe('continua');
            expect(lerFaltantes([]).causa).toBe('continua');
        });

        it('soma as séries antes de decidir — a causa é da EMPRESA, não da série', () => {
            const r = lerFaltantes([
                serie({ serie: '1', primeiro: 1, ultimo: 500, faltantesTotal: 480 }),
                serie({ serie: '3', primeiro: 900, ultimo: 985, faltantesTotal: 1 }),
            ] as any);
            expect(r.causa).toBe('captura-incompleta');
            expect(r.faltantes).toBe(481);
        });
    });
});

describe('resumoPorParticipante', () => {
    it('ranqueia a contraparte por valor, juntando NFe e NFSe', () => {
        const r = resumoPorParticipante([
            nfe(), nfe({ id: 'b', valorTotal: 400, totais: { vNF: 400 } }), nfse(),
        ] as any, 'entrada');
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({ nome: 'PRESTADOR X', notas: 1, valor: 2000 });
        expect(r[1]).toMatchObject({ doc: '11111111000111', notas: 2, valor: 1400 });
    });

    // ⚠️ A FIXTURE GANHOU O `empresaCnpj` EM 26/08, e trocá-la é o CERTO: ela
    // era internamente inconsistente — usava a forma PÓS-backfill
    // (`direcao: 'entrada'`) sem o campo que o backfill EXIGE para virar a
    // direção. `corrigirDirecaoEntradaPropria` só vira a nota quando
    // `cnpjEmit === empresaCnpj`, então documento real nesse estado sempre o
    // tem. Sem ele, a fixture descrevia um mundo que a produção não vive — a
    // mesma correção que o `livroNotaProdutor` sofreu em 22/08.
    it('nota própria de entrada aponta o DESTINATÁRIO (produtor) como contraparte', () => {
        const r = resumoPorParticipante([nfe({
            tpNF: '0', empresaCnpj: '22222222000122',
            emitente: { cnpjCpf: '22222222000122', nome: 'NOS', uf: 'SP' },
            destinatario: { cnpjCpf: '52998224725', nome: 'PRODUTOR PF', uf: 'MG' },
        })] as any, 'entrada');
        expect(r[0]).toMatchObject({ nome: 'PRODUTOR PF', uf: 'MG' });
    });

    // 🚨 E O CASO QUE A CÓPIA ERRAVA passa a ser exigido aqui: `tpNF=0` de um
    // TERCEIRO não é "nossa" nota própria, e a contraparte é o EMITENTE. Sem
    // isso a coluna mostraria o próprio cliente como fornecedor (KROYA ×
    // GOLDLOG, 17/08).
    it('tpNF=0 de TERCEIRO mantém a contraparte no emitente', () => {
        const r = resumoPorParticipante([nfe({
            tpNF: '0', empresaCnpj: '22222222000122',
            emitente: { cnpjCpf: '99999999000199', nome: 'OUTRA EMPRESA', uf: 'PR' },
            destinatario: { cnpjCpf: '52998224725', nome: 'CLIENTE DELE', uf: 'MG' },
        })] as any, 'entrada');
        expect(r[0]).toMatchObject({ nome: 'OUTRA EMPRESA', uf: 'PR' });
    });
});

describe('resumoPorAliquota', () => {
    it('agrupa tributadas por alíquota e separa isentas/outras (régua do SAGE)', () => {
        const r = resumoPorAliquota([nfe({
            itens: [
                { cfop: '1102', vProd: 500, vBC: 500, vICMS: 90, aliqIcms: 18, cst: '00' },
                { cfop: '1102', vProd: 300, vBC: 300, vICMS: 54, aliqIcms: 18, cst: '00' },
                { cfop: '1102', vProd: 200, vICMS: 0, cst: '41' },
                { cfop: '1403', vProd: 100, vICMS: 0, cst: '60' },
            ],
        })] as any);
        const t18 = r.find(l => l.aliquota === 18)!;
        expect(t18).toMatchObject({ itens: 2, base: 800, icms: 144 });
        expect(r.find(l => l.rotulo.startsWith('Isentas'))!.valor).toBe(200);
        expect(r.find(l => l.rotulo.startsWith('Outras'))!.valor).toBe(100);
    });

    it('sem pICMS gravado, deriva a alíquota de vICMS/vBC', () => {
        const r = resumoPorAliquota([nfe({
            itens: [{ cfop: '1102', vProd: 1000, vBC: 1000, vICMS: 120, cst: '00' }],
        })] as any);
        expect(r[0].aliquota).toBe(12);
    });
});

describe('resumoPorProduto', () => {
    it('agrega por NCM+descrição com qtd, notas e CFOPs', () => {
        const r = resumoPorProduto([
            nfe({ itens: [{ cfop: '1102', ncm: '08039000', xProd: 'Banana', vProd: 600, qCom: 10, uCom: 'KG', vICMS: 0, cst: '41' }] }),
            nfe({ id: 'b', itens: [{ cfop: '1403', ncm: '08039000', xProd: 'banana ', vProd: 400, qCom: 5, uCom: 'kg', vICMS: 0, cst: '60' }] }),
            nfe({ id: 'c', itens: [{ cfop: '1102', ncm: '10063021', xProd: 'Arroz', vProd: 100, qCom: 2, uCom: 'SC', vICMS: 0, cst: '41' }] }),
        ] as any, 'entrada', CTX);
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({ produto: 'BANANA', ncm: '08039000', qtd: 15, notas: 2, unidade: 'KG', valor: 1000, cfops: '1102 1403' });
    });
});

describe('resumoPorUf', () => {
    it('agrupa pela UF da CONTRAPARTE (nota própria de entrada = destinatário)', () => {
        const r = resumoPorUf([
            nfe({ emitente: { cnpjCpf: '1', nome: 'A', uf: 'MG' } }),
            nfe({ id: 'b', direcao: 'saida', destinatario: { cnpjCpf: '2', nome: 'B', uf: 'PR' }, valorTotal: 300, totais: { vNF: 300 } }),
            // nota própria de entrada: emitente = empresa; produtor (MG) no destinatário
            // ⚠️ `empresaCnpj` acrescentado em 26/08 pelo mesmo motivo do teste
            // acima: o backfill só vira a direção quando ele bate com o emitente.
            nfe({ id: 'c', tpNF: '0', empresaCnpj: '22222222000122', emitente: { cnpjCpf: '22222222000122', nome: 'NOS', uf: 'SP' }, destinatario: { cnpjCpf: '3', nome: 'PRODUTOR', uf: 'MG' }, valorTotal: 500, totais: { vNF: 500 } }),
        ] as any);
        const mg = r.find(l => l.uf === 'MG')!;
        expect(mg.entradasQtd).toBe(2);
        expect(mg.entradasValor).toBe(1500);
        expect(r.find(l => l.uf === 'PR')!.saidasValor).toBe(300);
    });
});
