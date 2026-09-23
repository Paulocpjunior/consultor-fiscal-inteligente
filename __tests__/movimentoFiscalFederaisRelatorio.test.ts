import { montarMovimentoFiscalContabil } from '../sefaz-backend/movimento-fiscal-contabil.js';
import { linhasServicos } from '../services/relatoriosAgregacoes';

const comum = { tipo: 'NFSe', tipoDoc: 'NFSe', direcao: 'entrada', competencia: '2026-08',
  dhEmi: '2026-08-04T11:13:53', empresaCnpj: '05147016000145', prestadorNome: 'PRESTADOR' };
const documentos = [
  { ...comum, id: 'embratop', numero: '22243', valorTotal: 140, valorPis: 2.31, valorCofins: 10.64, valorCsll: 0, valorIr: 0, valorInss: 0, valorIss: 7 },
  { ...comum, id: 'presenca', numero: '10353', valorTotal: 278.03, valorPis: 1.81, valorCofins: 8.34, valorCsll: 2.78, valorIr: 0, valorInss: 0, valorIss: 5.56 },
];
const consultar = (docs: any[], movimento = 'servicos_tomados') => montarMovimentoFiscalContabil({
  cnpjEmpresa: comum.empresaCnpj, competencia: '2026-08', movimento, documentos: docs,
});

test('NF 22243 sem retencao: ponte usa exatamente os valores do relatorio, preservando bruto e ISS', () => {
  const r = consultar(documentos);
  const relatorio = linhasServicos(documentos as any, 'entrada');
  for (const nota of r.notas) {
    const linha = relatorio.find(l => l.numero === nota.numero)!;
    expect(nota.federaisRelatorio).toMatchObject({ pis: linha.pis, cofins: linha.cofins, csll: linha.csll,
      ir: linha.ir, inss: linha.inss, pccAgregado: linha.csrfSemRateio });
  }
  expect(r.notas.find(n => n.numero === '22243')).toMatchObject({ valor: 140, valorIss: 7,
    federaisRelatorio: { pis: 0, cofins: 0, csll: 0, pccAgregado: 0 } });
  expect(r.notas.reduce((s, n) => s + n.federaisRelatorio.pis, 0)).toBe(1.81);
  expect(r.notas.reduce((s, n) => s + n.federaisRelatorio.cofins, 0)).toBe(8.34);
});

test('PCC agregado marcado no relatorio nao vira CSLL individual na ponte', () => {
  const docs = [{ ...comum, id: '2902', numero: '2902', direcao: 'saida', valorTotal: 1800,
    valorPis: 11.7, valorCofins: 54, valorCsll: 83.7 }];
  const f = consultar(docs, 'servicos_prestados').notas[0].federaisRelatorio;
  expect(f).toMatchObject({ pis: 11.7, cofins: 54, csll: 0, pccAgregado: 83.7, contribuicoesAgregadas: true });
  expect(linhasServicos(docs as any, 'saida')[0].csrfSemRateio).toBe(f.pccAgregado);
});
