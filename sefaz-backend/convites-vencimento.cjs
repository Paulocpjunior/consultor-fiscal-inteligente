'use strict';
// Padrão de agenda do Consultor DP (services/agenda/convite.ts), compartilhado
// por cópia verificada entre apps. Não cria reuniões nem altera vencimentos.
const { createHash } = require('node:crypto');
function dataCivil(valor) {
    const s = String(valor || '').trim();
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : s;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('Vencimento inválido. Informe DD/MM/AAAA ou AAAA-MM-DD.');
    const d = new Date(`${iso}T00:00:00Z`);
    if (!Number.isFinite(+d) || d.toISOString().slice(0,10) !== iso) throw new Error('Data de vencimento inexistente.');
    return iso;
}
function escapar(s) { return String(s).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,''); }
function dobrar(s) {
    const linhas=[]; let atual='', bytes=0;
    for (const c of s) { const n=Buffer.byteLength(c); if(bytes+n>75){linhas.push(atual);atual=' ';bytes=1;} atual+=c;bytes+=n; }
    linhas.push(atual);return linhas.join('\r\n');
}
function gerarIcs(eventos, agora = new Date()) {
    const stamp=agora.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const linhas=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//SP Assessoria Contabil//Vencimentos SaaS//PT-BR','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Vencimentos SP Assessoria'];
    for(const e of eventos){
        const inicio=dataCivil(e.vencimento); const fim=new Date(`${inicio}T00:00:00Z`);fim.setUTCDate(fim.getUTCDate()+1);
        const uid=createHash('sha256').update(JSON.stringify([e.identidade||'',e.titulo,inicio])).digest('hex')+'@agenda.spassessoriacontabil.com.br';
        linhas.push('BEGIN:VEVENT',`UID:${uid}`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${inicio.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${fim.toISOString().slice(0,10).replace(/-/g,'')}`,`SUMMARY:${escapar(e.titulo)}`,`DESCRIPTION:${escapar(e.descricao||e.titulo)}`,'TRANSP:TRANSPARENT','BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${escapar(e.titulo)}`,'TRIGGER:-PT15H','END:VALARM','END:VEVENT');
    }
    linhas.push('END:VCALENDAR');return linhas.map(dobrar).join('\r\n')+'\r\n';
}
// Somente datas imediatamente identificadas como vencimento. Emissão,
// competência, números de documentos e instruções no arquivo não são comandos.
function vencimentosDoTexto(texto) {
    const datas=[];
    for(const m of String(texto||'').matchAll(/(?:data\s+(?:de|do)\s+)?vencimento\s*[:\-–]?\s*(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})(?!\d)/gi)) {
        datas.push(dataCivil(m[1]));
    }
    return [...new Set(datas)];
}
async function anexarConvites({assunto, anexos=[], vencimento, identidade='', lerPdf, agora=new Date()}) {
    const eventos=[];const avisos=[];
    const documentos=anexos.filter(a=>a?.contentBytes&&a?.name&&!a.contentId&&!a.isInline&&!/\.ics$/i.test(a.name));
    if(vencimento){eventos.push({titulo:String(assunto||'Vencimento de documento'),vencimento:dataCivil(vencimento),identidade,descricao:`${assunto}\nConfira os documentos anexados. Vencimento informado no envio.`});}
    for(const a of documentos){
        let datas=[];
        if(a.vencimento) datas=[dataCivil(a.vencimento)];
        else if(!vencimento){
            const bytes=Buffer.from(a.contentBytes,'base64');let texto='';
            if(/\.pdf$/i.test(a.name)||a.contentType==='application/pdf'){
                if(lerPdf){try{texto=await lerPdf(bytes);}catch{avisos.push(`${a.name}: vencimento não lido; confira o documento.`);}}
                if(!texto.trim())avisos.push(`${a.name}: PDF sem texto legível; informe o vencimento no envio.`);
            }else if(/\.(txt|csv|xml|html?)$/i.test(a.name)){texto=bytes.toString('utf8').replace(/<[^>]+>/g,' ');}
            datas=vencimentosDoTexto(texto);
        }
        for(const data of datas)eventos.push({titulo:String(assunto||a.name),vencimento:data,identidade:identidade+'|'+createHash('sha256').update(a.contentBytes).digest('hex'),descricao:`${assunto||a.name}\nDocumento: ${a.name}\nVencimento: ${data.split('-').reverse().join('/')}`});
    }
    if(!eventos.length)return {anexos:[...anexos],quantidade:0,avisos,eventos:[]};
    const conteudo=gerarIcs(eventos,agora);
    // Mesmo documento/evento mantém UID nas novas emissões; nunca suprimir
    // outro .ics anexado pelo operador, pois pode representar outra obrigação.
    return {anexos:[...anexos,{name:'vencimentos-sp.ics',contentType:'text/calendar; charset=utf-8; method=PUBLISH',contentBytes:Buffer.from(conteudo).toString('base64')}],quantidade:eventos.length,avisos,eventos};
}
function linkAgenda(e) {
    const inicio=dataCivil(e.vencimento),fim=new Date(inicio+'T00:00:00Z');fim.setUTCDate(fim.getUTCDate()+1);
    return 'https://calendar.google.com/calendar/render?'+new URLSearchParams({action:'TEMPLATE',text:e.titulo,dates:inicio.replace(/-/g,'')+'/'+fim.toISOString().slice(0,10).replace(/-/g,''),details:e.descricao||e.titulo}).toString();
}
module.exports={linkAgenda,dataCivil,gerarIcs,vencimentosDoTexto,anexarConvites};
