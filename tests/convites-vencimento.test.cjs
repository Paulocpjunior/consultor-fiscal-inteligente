const test=require('node:test');const assert=require('node:assert/strict');
const {gerarIcs,dataCivil,vencimentosDoTexto,anexarConvites}=require('../sefaz-backend/convites-vencimento.cjs');
const agora=new Date('2026-10-08T15:00:00Z');
test('agenda mantém data civil, fim exclusivo, UTF-8 e UID estável entre emissões',()=>{
 const eventos=[{titulo:'Guia de contribuição çã '.repeat(9),vencimento:'31/12/2026',identidade:'empresa/doc',descricao:'Teste\nEND:VEVENT;abc,def'}];const s=gerarIcs(eventos,agora);
 assert.match(s,/DTSTART;VALUE=DATE:20261231/);assert.match(s,/DTEND;VALUE=DATE:20270101/);assert.match(s,/TRIGGER:-PT15H/);
 assert.ok(s.split('\r\n').every(l=>Buffer.byteLength(l)<=75));assert.equal((s.match(/BEGIN:VEVENT/g)||[]).length,1);
 assert.equal(s.match(/UID:(.*)/)[1],gerarIcs(eventos,new Date('2027-01-01')).match(/UID:(.*)/)[1]);
 assert.match(s,/DESCRIPTION:Teste\\nEND:VEVENT\\;abc\\,def/);
 assert.throws(()=>dataCivil('31/02/2026'));assert.equal(dataCivil('29/02/2028'),'2028-02-29');
});
test('não confunde emissão/competência com vencimento e recusa data impossível',()=>{
 assert.deepEqual(vencimentosDoTexto('Emissão: 01/10/2026 Competência 09/2026'),[]);
 assert.deepEqual(vencimentosDoTexto('Data de Vencimento: 20/10/2026 VENCIMENTO\n20/10/2026'),['2026-10-20']);
 assert.throws(()=>vencimentosDoTexto('Vencimento: 31/02/2026'));
});
test('arquivo e convite viajam juntos; não lê logo; PDF ilegível é avisado e não inventa prazo',async()=>{
 const a={name:'guia.pdf',contentType:'application/pdf',contentBytes:Buffer.from('pdf').toString('base64')};let lidos=0;
 const r=await anexarConvites({assunto:'DAS Empresa A',anexos:[a,{...a,name:'logo.png',contentId:'logo'}],lerPdf:async()=>{lidos++;return 'Vencimento: 20/10/2026';},agora});
 assert.equal(lidos,1);assert.equal(r.quantidade,1);assert.deepEqual(r.anexos[0],a);assert.equal(r.anexos.at(-1).name,'vencimentos-sp.ics');
 const sem=await anexarConvites({assunto:'Guia',anexos:[a],lerPdf:async()=>'',agora});assert.equal(sem.quantidade,0);assert.equal(sem.avisos.length,1);
 const informado=await anexarConvites({assunto:'Guia',anexos:[a],vencimento:'2026-10-20',lerPdf:async()=>{throw Error('não deve ler');},agora});assert.equal(informado.quantidade,1);assert.equal(informado.avisos.length,0);
});
