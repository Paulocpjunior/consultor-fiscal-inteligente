import { DEPARTAMENTOS_WHATSAPP } from './whatsapp-templates.js';
import { montarLayoutEmail, textoParaHtml, escaparHtml } from './email-layout.js';

export const DEPARTAMENTOS = [...DEPARTAMENTOS_WHATSAPP];
export const FUSO = 'America/Sao_Paulo';
export const MODELOS = 'comunicacao_modelos';
export const AGENDAS = 'comunicacao_agendas';
export const EXECUCOES = 'comunicacao_execucoes';
export function exigir(condicao, mensagem) { if (!condicao) throw Object.assign(new Error(mensagem), { status: 400 }); }
export function variaveis(texto) {
    const chaves = [...new Set([...String(texto).matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}\}/g)].map(m => m[1]))];
    exigir(!String(texto).replace(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}\}/g, '').match(/[{}]/), 'Variável inválida. Use {{cliente}}, {{competencia}}, {{documentos}} ou outra chave sem espaços.');
    return chaves;
}
export function validarModelo(e = {}) {
    exigir(DEPARTAMENTOS.includes(e.departamento), 'Selecione o departamento.');
    exigir(['email', 'whatsapp'].includes(e.canal), 'Selecione o canal.');
    const nome = String(e.nome || '').trim();
    exigir(nome.length > 0 && nome.length <= 100, 'Nome obrigatório (até 100 caracteres).');
    const assunto = String(e.assunto || '').trim();
    const corpo = String(e.corpo || '').trim();
    if (e.canal === 'email') {
        exigir(assunto.length > 0 && assunto.length <= 200 && !/[\r\n]/.test(assunto), 'Assunto obrigatório, até 200 caracteres, em uma linha.');
        exigir(corpo.length > 0 && corpo.length <= 10000, 'Mensagem obrigatória, até 10.000 caracteres.');
    }
    const templateId = String(e.templateId || '');
    if (e.canal === 'whatsapp') exigir(/^[a-z0-9_-]{1,600}$/.test(templateId), 'Escolha um template cadastrado do WhatsApp.');
    return { nome, departamento: e.departamento, canal: e.canal, assunto: e.canal === 'email' ? assunto : '', corpo: e.canal === 'email' ? corpo : '', templateId: e.canal === 'whatsapp' ? templateId : '', variaveis: e.canal === 'email' ? variaveis(assunto + '\n' + corpo) : [], ativo: e.ativo !== false };
}
export function preencher(texto, valores = {}) {
    for (const chave of variaveis(texto)) exigir(Object.hasOwn(valores, chave) && typeof valores[chave] === 'string' && valores[chave].trim(), `Preencha a variável ${chave}.`);
    return texto.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}\}/g, (_, k) => valores[k]);
}
export function previaEmail(modelo, valores) {
    const assunto = preencher(modelo.assunto, valores);
    exigir(!/[\r\n]/.test(assunto) && assunto.length <= 300, 'Assunto preenchido inválido.');
    const corpo = preencher(modelo.corpo, valores);
    return { assunto, corpo, html: montarLayoutEmail({ titulo: escaparHtml(assunto), conteudoHtml: textoParaHtml(corpo), departamento: `Departamento ${modelo.departamento}` }) };
}
// Conversão de hora civil pelo fuso explícito, independente do computador/servidor.
export function partesSP(iso) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
export function dataSP(local) {
    exigir(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local), 'Data e hora inválidas.');
    const civil = Date.parse(local + 'Z');
    exigir(Number.isFinite(civil), 'Data inválida.');
    let instante = civil;
    for (let i = 0; i < 3; i++) {
        const p = partesSP(instante);
        instante += civil - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    }
    const p = partesSP(instante);
    exigir(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === local, 'Data inexistente no calendário.');
    return new Date(instante).toISOString();
}
export function validarAgenda(e, modelo, agora = new Date()) {
    exigir(modelo?.ativo, 'Modelo inativo ou inexistente.');
    const inicio = dataSP(String(e.inicio || ''));
    exigir(Date.parse(inicio) >= agora.getTime() + 60000, 'Agende com pelo menos um minuto de antecedência.');
    exigir(['unica', 'diaria', 'semanal', 'mensal'].includes(e.recorrencia), 'Recorrência inválida.');
    const fim = e.fim ? dataSP(String(e.fim)) : null;
    exigir(e.recorrencia === 'unica' || fim, 'Informe a data final da recorrência.');
    exigir(!fim || (fim >= inicio && Date.parse(fim) - Date.parse(inicio) <= 366 * 86400000), 'Fim deve ser posterior ao início e no máximo um ano depois.');
    const para = String(e.para || '').trim();
    exigir(modelo.canal === 'email' ? /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(para) : /^\+?\d{10,15}$/.test(para), 'Informe um destinatário válido (WhatsApp com código do país).');
    const valores = e.valores && typeof e.valores === 'object' && !Array.isArray(e.valores) ? e.valores : {};
    exigir(Object.keys(valores).length <= 50 && Object.values(valores).every(v => typeof v === 'string' && v.length <= 4000), 'Valores inválidos (máximo 4.000 caracteres por campo).');
    for (const chave of modelo.variaveis) exigir(Object.hasOwn(valores, chave) && valores[chave].trim(), `Preencha ${chave}.`);
    if (modelo.canal === 'email') previaEmail(modelo, valores);
    return { modeloId: e.modeloId, modelo: modelo, para, valores, inicio, inicioLocal: e.inicio, proximoEm: inicio, fim, recorrencia: e.recorrencia, fuso: FUSO, status: 'pausado' };
}
export function proximaOcorrencia(ag, agora) {
    if (ag.recorrencia === 'unica') return null;
    const original = ag.inicioLocal;
    const [y, m, d] = original.slice(0, 10).split('-').map(Number);
    for (let i = 1; i <= 370; i++) {
        let dia;
        if (ag.recorrencia === 'mensal') {
            const base = new Date(Date.UTC(y, m - 1 + i, 1));
            const limite = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
            dia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(d, limite)));
        } else dia = new Date(Date.UTC(y, m - 1, d + i * (ag.recorrencia === 'semanal' ? 7 : 1)));
        const iso = dataSP(dia.toISOString().slice(0, 10) + original.slice(10));
        if (ag.fim && iso > ag.fim) return null;
        if (iso > agora.toISOString() && iso > ag.proximoEm) return iso;
    }
    return null;
}
