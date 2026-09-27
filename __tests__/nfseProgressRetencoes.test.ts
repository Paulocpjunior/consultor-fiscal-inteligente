import * as fs from 'fs';
import * as path from 'path';
import { lerNfseNacional } from '../sefaz-backend/nfse-nacional-leitura.js';
import { parseNFeXml, buildDocumentoFiscal } from '../services/xmlParserService';
import { linhasServicos } from '../services/relatoriosAgregacoes';
import { federaisDoRelatorio } from '../sefaz-backend/federais-relatorio.js';
for (const [numero, pcc, ir] of [['5725',121.35,39.15],['5747',24.35,0]] as const) {
 test(`PROGRESS ${numero}: XML real preserva PCC agregado e IRRF`,()=>{
  const xml=fs.readFileSync(path.join(__dirname,'fixtures/progress-retencoes',numero+'.xml'),'utf8');
  const lida=lerNfseNacional(xml);
  expect(lida.valores).toMatchObject({ir,csll:pcc,pis:0,cofins:0,pccAgregadoDeclarado:true,retencoesFederaisGravadas:true});
  const parsed=parseNFeXml(xml);
  const doc=buildDocumentoFiscal({id:numero,parsed,xmlHash:'teste',direcao:'entrada',empresaId:'daxx',empresaCnpj:'11775820000171',empresaNome:'DAXX',origem:'manual',importadoPor:'teste'});
  const v=doc.valores;
  expect(v).toMatchObject({ir,csll:pcc,pccAgregadoDeclarado:true});
  const f=federaisDoRelatorio({valores:v},lida.valores.servico!,undefined).valores;
  const rel=linhasServicos([doc] as any,'entrada')[0];
  expect(rel).toMatchObject({ir,csrfSemRateio:pcc,csll:0,pis:0,cofins:0,retencoesFederaisGravadas:true});
  expect(f).toMatchObject({ir,pccAgregado:pcc,pis:0,cofins:0,csll:0,contribuicoesAgregadas:true});
 });
}
test('QUALISERVE 10736: PIS/COFINS retidos no bloco GISS e liquido declarado',()=>{
 const xml=fs.readFileSync(path.join(__dirname,'fixtures/progress-retencoes/10736.xml'),'utf8');
 const parsed=parseNFeXml(xml);
 const v=(parsed as any)._nfseValores;
 expect(v).toMatchObject({pis:57.16,cofins:263.8,ir:131.9,csll:87.93,liquido:8252.69});
 const f=federaisDoRelatorio({valores:v},8793.48).valores;
 expect(f).toMatchObject({pis:57.16,cofins:263.8,ir:131.9,csll:87.93,pccAgregado:0});
 const semRet=parseNFeXml(xml.replace('<tpRetPisCofins>3</tpRetPisCofins>','<tpRetPisCofins>0</tpRetPisCofins>'));
 expect((semRet as any)._nfseValores).toMatchObject({pis:0,cofins:0});
});
