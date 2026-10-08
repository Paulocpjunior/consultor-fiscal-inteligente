import * as convites from './convites-vencimento.cjs';
import { lerPdfVencimentos } from './convites-pdf.js';
// A Cloud API não lista text/calendar como documento suportado. No WhatsApp
// usa-se o link de agenda, como no DP, na própria legenda: nenhuma segunda
// mensagem que possa falhar depois de o arquivo já ter sido enviado.
export async function legendaComConvite({legenda='',nomeArquivo,mime,base64,vencimento,tipo},lerPdf=lerPdfVencimentos) {
    if (tipo !== 'document') {
        if(vencimento)throw new Error('Convite de vencimento exige envio como documento.');
        return {legenda,quantidade:0,avisos:[]};
    }
    const r=await convites.anexarConvites({assunto:legenda||nomeArquivo,anexos:[{name:nomeArquivo,contentType:mime,contentBytes:base64}],vencimento,lerPdf});
    const links=r.eventos.map(e=>`📅 Vencimento ${e.vencimento.split('-').reverse().join('/')} — adicionar à agenda:\n${convites.linkAgenda({...e,descricao:`Documento: ${nomeArquivo}`})}`);
    const texto=[legenda,...links].filter(Boolean).join('\n\n');
    if(links.length && Array.from(texto).length>1024)throw new Error('A legenda com os convites excede 1.024 caracteres. Reduza o texto ou envie os documentos separadamente.');
    return {legenda:texto,quantidade:r.quantidade,avisos:r.avisos};
}
