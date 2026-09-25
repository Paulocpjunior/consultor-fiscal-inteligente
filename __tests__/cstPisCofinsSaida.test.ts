/**
 * 🧾 CST PADRÃO DE PIS/COFINS NA SAÍDA — "como o SAGE" (Paulo, 25/09: "CST 49
 * para as demais receitas, pode cadastrar").
 *
 * O que se cobra: o tipo da saída vem da descrição OFICIAL do CFOP; o
 * cadastro entra só onde o XML não trouxe CST (sobrepor é opção explícita e
 * dita); sem cadastro nada muda e o aviso conta o que caiu no 01; o cadastro
 * é conferido contra a tabela 4.3.3 antes de gravar.
 */
// @ts-expect-error módulo JS sem tipos
import { tipoDaSaidaPeloCfop, conferirCadastroCst, aplicarCstPadraoNasSaidas, avisosDoCstPadrao, CST_SAIDA, TIPOS_DE_SAIDA } from '../sefaz-backend/cst-pis-cofins-saida.js';
import { buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';

const doc = (numero: number, direcao: 'saida' | 'entrada', itens: Array<Record<string, unknown>>) => ({
    tipo: 'NFe', direcao, numero: String(numero), chave: `ch${numero}`, dataEmissao: '2026-08-10',
    cnpjEmit: '00005430000104', cnpjDest: '11222333000181',
    itens: itens.map((i, k): Record<string, unknown> => ({ nItem: k + 1, codigo: `P${k}`, descricao: 'x', ncm: '08039000', unidade: 'KG', quantidade: 1, vUnCom: 100, vProd: 100, vDesc: 0, vPIS: 0, vCOFINS: 0, vICMS: 0, ...i })),
});
const dir = (n: { direcao: string }) => n.direcao;

describe('tipoDaSaidaPeloCfop — pela descrição oficial', () => {
    it('venda, exportação e outras', () => {
        expect(['5102', '5101', '5405', '5933', '5124', '6102'].map(tipoDaSaidaPeloCfop)).toEqual(['venda', 'venda', 'venda', 'venda', 'venda', 'venda']);
        expect(['7101', '7102', '5501', '5502'].map(tipoDaSaidaPeloCfop)).toEqual(['exportacao', 'exportacao', 'exportacao', 'exportacao']);
        expect(['5949', '5910', '5201', '5152', '5551', '5929'].map(tipoDaSaidaPeloCfop)).toEqual(['outras', 'outras', 'outras', 'outras', 'outras', 'outras']);
        expect(['1102', '9999', '', 'abc'].map(tipoDaSaidaPeloCfop)).toEqual(['desconhecido', 'desconhecido', 'desconhecido', 'desconhecido']);
    });
});

describe('conferirCadastroCst', () => {
    it('aceita só CST de saída (01–09 e 49) e normaliza com dois dígitos', () => {
        const ok = conferirCadastroCst({ venda: '6', outras: '49', exportacao: '', sobreporXml: false });
        expect(ok.ok).toBe(true);
        expect(ok.cadastro).toEqual({ venda: '06', outras: '49', sobreporXml: false });
        const ruim = conferirCadastroCst({ venda: '50', outras: '49' });
        expect(ruim.ok).toBe(false);
        expect(ruim.erros.join('\n')).toMatch(/CST 50/);
        expect(conferirCadastroCst({ sobreporXml: true }).ok).toBe(false);
        // chave inteira ('49') vem antes na ordem do JS — o que se cobra é o CONJUNTO
        expect(Object.keys(CST_SAIDA).sort()).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '49']);
        expect(TIPOS_DE_SAIDA.outras.sugestao).toBe('49');
    });
});

describe('aplicarCstPadraoNasSaidas', () => {
    const notas = () => [
        doc(1, 'saida', [{ cfop: '5102' }, { cfop: '5949' }, { cfop: '5102', cstPis: '01', cstCofins: '01' }]),
        doc(2, 'saida', [{ cfop: '7102' }, { cfop: '5910', cstPis: '06', cstCofins: '06' }]),
        doc(3, 'entrada', [{ cfop: '1102' }]),
    ];
    it('sem cadastro: nada muda, e o aviso conta o que caiu no 01, por tipo e CFOP', () => {
        const n = notas();
        const r = aplicarCstPadraoNasSaidas(n, {}, { direcaoDoDoc: dir });
        expect(n[0].itens[0].cstPis).toBeUndefined();
        expect(r.temCadastro).toBe(false);
        expect(r.semCadastro.venda.itens).toBe(1);
        expect(r.semCadastro.outras.itens).toBe(1);
        expect(r.semCadastro.exportacao.itens).toBe(1);
        expect(r.mantidosDoXml).toBe(2);
        const avisos = avisosDoCstPadrao(r);
        expect(avisos.find((a: string) => /Demais saídas/.test(a))).toMatch(/CFOP 5949/);
        expect(avisos.find((a: string) => /Demais saídas/.test(a))).toMatch(/sugestão: 49/);
        expect(avisos.some((a: string) => /SOBREPOSTO/.test(a))).toBe(false);
    });
    it('com cadastro: entra só onde o XML não trouxe CST; o do XML fica', () => {
        const n = notas();
        const r = aplicarCstPadraoNasSaidas(n, { venda: '06', outras: '49', exportacao: '08' }, { direcaoDoDoc: dir });
        expect(n[0].itens[0]).toMatchObject({ cstPis: '06', cstCofins: '06', _cstOrigem: 'cadastro-venda' });
        expect(n[0].itens[1]).toMatchObject({ cstPis: '49', cstCofins: '49', _cstOrigem: 'cadastro-outras' });
        expect(n[0].itens[2]).toMatchObject({ cstPis: '01' });        // XML manda
        expect(n[1].itens[0]).toMatchObject({ cstPis: '08', _cstOrigem: 'cadastro-exportacao' });
        expect(n[1].itens[1]).toMatchObject({ cstPis: '06' });        // XML manda
        expect(n[2].itens[0].cstPis).toBeUndefined();                  // entrada não se toca
        expect(r.aplicados.outras.itens).toBe(1);
        expect(r.sobrepostos.outras.itens).toBe(0);
        expect(r.mantidosDoXml).toBe(2);
        expect(avisosDoCstPadrao(r).some((a: string) => /caíram no padrão 01/.test(a))).toBe(false);
    });
    it('sobrepor é opção explícita — e sai DITO, com CFOP e o CST que o emissor declarou', () => {
        const n = notas();
        const r = aplicarCstPadraoNasSaidas(n, { venda: '06', outras: '49', sobreporXml: true }, { direcaoDoDoc: dir });
        expect(n[0].itens[2]).toMatchObject({ cstPis: '06', _cstOrigem: 'cadastro-venda-sobrepos-01' });
        expect(n[1].itens[1]).toMatchObject({ cstPis: '49', _cstOrigem: 'cadastro-outras-sobrepos-06' });
        expect(r.sobrepostos.venda.itens).toBe(1);
        expect(r.sobrepostos.outras.itens).toBe(1);
        const avisos = avisosDoCstPadrao(r).filter((a: string) => /SOBREPOSTO/.test(a)).join(' ');
        expect(avisos).toMatch(/5910/);
        expect(avisos).toMatch(/5102/);
    });
    it('o 49 cadastrado tira a remessa do M210 e do M400 — não é receita tributada nem sem ônus', () => {
        const n = [doc(1, 'saida', [{ cfop: '5102', vProd: 1000 }, { cfop: '5949', vProd: 300 }])];
        aplicarCstPadraoNasSaidas(n, { venda: '01', outras: '49' }, { direcaoDoDoc: dir });
        const warnings: string[] = [];
        const linhas: string[] = buildBlocoM({ notas: n, regimeApuracao: '2', warnings, naturezaReceita: {} });
        const m210 = linhas.find((l) => l.startsWith('|M210|'))!.split('|');
        expect(m210[3]).toBe('1000,00');                                  // VL_REC_BRT só a venda
        expect(linhas.some((l) => l.startsWith('|M400|'))).toBe(false);   // 49 não é sem ônus
        expect(warnings.some((w) => /M400\/M410 NÃO saiu/.test(w))).toBe(false);
    });
});
