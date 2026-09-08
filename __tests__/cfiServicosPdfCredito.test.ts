import { reconhecerCfiServicosPdf, completarCfiServicosPdf } from '../services/cfiServicosPdfCredito';
import * as fs from 'fs';
const linhas = (textos: string[]) => textos.map(str => ({ pagina: 1, tokens: [{ str }] }));
const texto = [
 'Serviços tomados — 08/2026 SP Assessoria Contábil · Consultor Fiscal Inteligente',
 'EMPRESA TESTE · 12.345.678/0001-90 · 1 NFS-e',
 'Data Nº Prestador Base ISS ISS ret. PIS COFINS IR INSS CSLL Líquido',
 '04/08/2026 7 FORNECEDOR…(+5) 80,00 4,00 0,00 0,00 0,00 0,00 0,00 0,00 100,00',
 'TOTAIS (1) 80,00 4,00 0,00 0,00 0,00 0,00 0,00 0,00 100,00',
];
const doc: any = { numero: '7', tipo: 'NFSe', direcao: 'entrada', dhEmi: '2026-08-04',
 valorTotal: 100, valores: { baseCalculo: 80 }, valorIss: 4, valorIssRetido: 0,
 prestadorNome: 'FORNECEDOR LTDA', prestadorCnpj: '98765432000190' };
test('recupera CNPJ e bruto da origem; nao troca valor da NF pela base do ISS', () => {
 const r = reconhecerCfiServicosPdf(linhas(texto))!;
 const p = completarCfiServicosPdf(r, [doc], 200);
 expect(p.notas[0]).toMatchObject({ numero:'7', valorNf:100, baseCalculo:80, cnpjCpf:'98765432000190', razaoSocial:'FORNECEDOR LTDA' });
 expect(p.validacao.ok).toBe(true);
 expect(p.origem).toBe('CFI_PDF_CONFERIDO_DOCUMENTOS');
});
test('bloqueia linha ausente, total divergente, documento ausente e ambiguidade', () => {
 expect(() => reconhecerCfiServicosPdf(linhas(texto.filter((_,i)=>i!==3)))).toThrow(/incompleto/);
 expect(() => reconhecerCfiServicosPdf(linhas(texto.map(t=>t.replace('TOTAIS (1) 80,00','TOTAIS (1) 81,00'))))).toThrow(/divergente/);
 const r = reconhecerCfiServicosPdf(linhas(texto))!;
 expect(() => completarCfiServicosPdf(r, [], 200)).toThrow(/não localizada/);
 expect(() => completarCfiServicosPdf(r, [doc,doc], 200)).toThrow(/ambígua/);
 expect(() => completarCfiServicosPdf(r, [{...doc,prestadorCnpj:''}], 200)).toThrow(/CNPJ/);
 expect(reconhecerCfiServicosPdf(linhas(['E-Fiscal Relação de NFs de Serviços Tomados']))).toBeNull();
});
const testeReal = test;
testeReal('PDF CLUDE real, extraido com pdf.js: 68 notas e totais exatos em 3 paginas', () => {
 const r = reconhecerCfiServicosPdf(JSON.parse(fs.readFileSync(process.env.CFI_PDF_LINHAS || __dirname + '/fixtures/cfi-servicos-68-linhas.json', 'utf8')))!;
 expect(r.quantidade).toBe(68); expect(r.notas).toHaveLength(68); expect(r.paginas).toBe(3);
 expect(r.totais).toEqual({base:332693.74,iss:2198.36,retido:0});
 expect(r.notas.find(n=>n.numero==='143875904')?.data).toBe('02/09/2026');
 expect(r.notas.filter(n=>n.base===0)).toHaveLength(3);
});
