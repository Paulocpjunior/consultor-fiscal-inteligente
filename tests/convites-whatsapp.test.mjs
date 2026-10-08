import test from 'node:test';import assert from 'node:assert/strict';
import {legendaComConvite} from '../sefaz-backend/convites-whatsapp.js';
test('link acompanha o documento na mesma legenda e não cria convite para emissão',async()=>{
 const p={legenda:'Guia DAS',nomeArquivo:'DAS.pdf',mime:'application/pdf',base64:'QUJD',tipo:'document'};
 const r=await legendaComConvite(p,async()=> 'Vencimento: 20/10/2026');
 assert.equal(r.quantidade,1);assert.match(r.legenda,/calendar.google.com/);assert.match(r.legenda,/20261020%2F20261021/);
 assert.equal((await legendaComConvite(p,async()=> 'Emissão: 20/10/2026')).legenda,'Guia DAS');
 await assert.rejects(legendaComConvite({...p,legenda:'x'.repeat(1024),vencimento:'2026-10-20'}),/Reduza/);
 await assert.rejects(legendaComConvite({...p,tipo:'audio',vencimento:'2026-10-20'}),/documento/);
});
