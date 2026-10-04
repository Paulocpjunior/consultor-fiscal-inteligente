import { previaEmail } from './comunicacao-modelos.js';
import { enviarEmail, isGraphConfigured } from './graph-provider.js';
import { anexoLogo } from './email-layout.js';
import { numeroCanonicoWhatsapp, listarTemplatesAprovados, enviarTemplateWhatsapp } from './whatsapp-cloud.js';
import { montarVariaveisPorSchema } from './whatsapp-templates.js';
import { cfgDeEnvioDaConversa } from './whatsapp-canais.js';
import { COLECAO_BLOQUEIOS, numeroDeBloqueio } from './whatsapp-bloqueios.js';
async function estaBloqueado(db, numero) {
    const doc = await db.collection(COLECAO_BLOQUEIOS).doc(numeroDeBloqueio(numero)).get();
    return doc.exists && doc.data().ativo !== false;
}
export async function prepararComunicacao(db, ag) {
    // A permissão é conferida novamente na execução, inclusive após rebaixamento.
    const usuario = await db.collection('users').doc(ag.criadoUid).get();
    if (!usuario.exists || usuario.data().role !== 'admin') throw new Error('Administrador criador sem permissão ativa.');
    if (ag.modelo.canal === 'email') {
        if (!isGraphConfigured()) throw new Error('Envio de e-mail não configurado.');
        const previa = previaEmail(ag.modelo, ag.valores);
        const remetente = ag.criadoPor;
        if (!remetente?.endsWith('@spassessoriacontabil.com.br')) throw new Error('Remetente fora do domínio do escritório.');
        return () => enviarEmail({ remetente, para: ag.para, assunto: previa.assunto, corpoHtml: previa.html, anexos: anexoLogo() });
    }
    const numero = numeroCanonicoWhatsapp(ag.para);
    if (await estaBloqueado(db, numero)) throw new Error('Destinatário bloqueado.');
    const conversa = (await db.collection('whatsapp_conversas').doc(numero).get()).data() || {};
    if (conversa.fila && conversa.fila !== ag.modelo.departamento) throw new Error('Conversa pertence a outro departamento.');
    const canal = await cfgDeEnvioDaConversa(db, conversa);
    if (canal.erro) throw new Error(canal.erro);
    const deps = canal.cfg ? { cfg: canal.cfg } : {};
    const atual = (await db.collection('whatsapp_templates').doc(ag.modelo.templateId).get()).data();
    if (!atual || atual.ativo === false || atual.departamento !== ag.modelo.departamento || atual.temDocumento) throw new Error('Template WhatsApp indisponível.');
    const lista = await listarTemplatesAprovados(deps);
    const aprovado = lista.ok && lista.templates.find(t => t.nome === atual.nome && t.idioma === atual.idioma && t.status === 'APPROVED' && t.categoria === 'UTILITY' && !t.temDocumento);
    if (!aprovado || aprovado.corpo !== ag.modelo.whatsapp.corpo || JSON.stringify(atual.variaveis) !== JSON.stringify(ag.modelo.whatsapp.variaveis)) throw new Error('Template alterado ou não aprovado neste canal. Revise o agendamento.');
    const vars = montarVariaveisPorSchema(atual, ag.valores);
    if (!vars.ok) throw new Error('Variáveis ausentes: ' + vars.faltando.join(', '));
    return async () => {
        const envio = await enviarTemplateWhatsapp({ para: numero, template: atual.nome, idioma: atual.idioma, variaveis: vars.variaveis, pdfBase64: null, nomeArquivo: null }, deps);
        if (envio.ok) {
            const texto = aprovado.corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => vars.variaveis[Number(n) - 1]);
            const em = new Date().toISOString();
            await db.collection('whatsapp_mensagens').doc(envio.messageId).set({ conversaId: numero, direcao: 'saida', tipo: 'template', texto, template: atual.nome, timestamp: em, statusEntrega: 'enviado', enviadoPor: ag.criadoPor, origem: 'comunicacao-agendada' });
            await db.collection('whatsapp_conversas').doc(numero).set({ numero, ...(!conversa.fila ? { fila: ag.modelo.departamento } : {}), ultimaMensagem: { resumo: texto.slice(0, 140), direcao: 'saida', em }, atualizadoEm: em }, { merge: true });
        }
        return envio;
    };
}

