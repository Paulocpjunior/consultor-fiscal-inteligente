// ============================================================================
// sefaz-backend/dp-email-pacote.js  (ESM, PURO — testável em jest)
// ----------------------------------------------------------------------------
// E-mail do Consultor DP ao cliente (pacote da folha: holerites, resumo,
// arquivo bancário, agenda) pela MESMA régua do CFI e do CCI (Paulo,
// 08/10/2026: "com a mesma regra criada no CFI e no CCI, onde podemos enviar
// arquivos em anexo aos clientes"): Graph sendMail, remetente = colaborador
// logado (graph-remetente.js), casca da marca (email-layout.js) com o
// departamento Pessoal, destinatário lido com DIAGNÓSTICO (endereço torto é
// recusado com o motivo, nunca descartado calado).
//
// Aqui fica só o que é puro: validar o pedido e montar o corpo. A rota
// (dp-integration-routes.js, /email/enviar) faz carteira, envio e auditoria.
// ============================================================================

import { lerDestinatarios, recusaDeDestinatario } from './email-destinatarios-helper.js';
import { montarLayoutEmail, textoParaHtml, escaparHtml } from './email-layout.js';

export const DEPARTAMENTO_DP = 'Departamento Pessoal';
/**
 * sendMail com anexo no próprio JSON aceita até ~3 MB de anexos (acima disso
 * o Graph exige sessão de upload). Recusar antes é dizer o caminho; deixar
 * o Graph recusar seria um 413 sem explicação.
 */
export const LIMITE_ANEXOS_BYTES = 3 * 1024 * 1024;
const MAX_ANEXOS = 10;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const bytesDoBase64 = (b64) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
const nomeSeguro = (n) => String(n || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120);

/**
 * @returns {{ok: false, status: number, error: string} | {ok: true, para: string[], assunto: string, mensagem: string,
 *   titulo: string, empresaNome: string, competencia: string, anexos: Array<{name: string, contentType: string, contentBytes: string, bytes: number}>}}
 */
export function validarPedidoEmailDp(body) {
    const b = body || {};
    const lidos = lerDestinatarios(b.para);
    if (lidos.vazio) return { ok: false, status: 400, error: 'Informe o e-mail do cliente (para).' };
    const recusa = recusaDeDestinatario(lidos);
    if (recusa) return { ok: false, status: 400, error: recusa };

    const mensagem = String(b.mensagem || '').trim();
    if (!mensagem) return { ok: false, status: 400, error: 'A mensagem do e-mail está vazia.' };
    if (mensagem.length > 10000) return { ok: false, status: 400, error: 'Mensagem longa demais (até 10.000 caracteres).' };
    const empresaNome = String(b.empresaNome || '').trim().slice(0, 150);
    const titulo = String(b.titulo || '').trim().slice(0, 150) || 'Documentos da folha';
    const competencia = /^\d{4}-\d{2}$/.test(String(b.competencia || '')) ? String(b.competencia) : '';
    const assunto = (String(b.assunto || '').trim() || [titulo, empresaNome].filter(Boolean).join(' · ')).slice(0, 200);

    const lista = Array.isArray(b.anexos) ? b.anexos : [];
    if (lista.length > MAX_ANEXOS) return { ok: false, status: 400, error: `No máximo ${MAX_ANEXOS} anexos por e-mail.` };
    const anexos = [];
    let total = 0;
    for (const [i, a] of lista.entries()) {
        const b64 = String(a?.base64 || '').replace(/\s+/g, '');
        const name = nomeSeguro(a?.nome);
        if (!name || !b64 || !BASE64.test(b64)) return { ok: false, status: 400, error: `Anexo ${i + 1} sem nome ou com conteúdo inválido.` };
        const bytes = bytesDoBase64(b64);
        total += bytes;
        anexos.push({ name, contentType: String(a?.mime || '') || 'application/octet-stream', contentBytes: b64, bytes });
    }
    if (total > LIMITE_ANEXOS_BYTES) {
        return { ok: false, status: 413, error: `Anexos com ${(total / 1048576).toFixed(1)} MB: o envio direto aceita até 3 MB. Baixe o pacote e anexe pelo Outlook.` };
    }
    return { ok: true, para: lidos.validos, assunto, mensagem, titulo, empresaNome, competencia, anexos };
}

/** Corpo do e-mail: a mensagem da equipe, o selo da competência e a lista do que vai anexo (farol honesto). */
export function montarEmailPacoteDp({ titulo, empresaNome, competencia, mensagem, anexos = [], geradoEm }) {
    const comp = competencia ? competencia.split('-').reverse().join('/') : '';
    const lista = anexos.length
        ? `<p style="margin:12px 0 0 0; font-size:13px; color:#166534; background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:10px 14px;">📎 Em anexo: ${anexos.map((a) => escaparHtml(a.name)).join(', ')}.</p>`
        : `<p style="margin:12px 0 0 0; font-size:13px; color:#92400E; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; padding:10px 14px;">⚠️ Este e-mail não tem anexos.</p>`;
    return montarLayoutEmail({
        titulo: `${escaparHtml(titulo)}${empresaNome ? ` — ${escaparHtml(empresaNome)}` : ''}`,
        selo: comp ? `Competência ${comp}` : undefined,
        conteudoHtml: `<p style="margin:0 0 12px 0;">${textoParaHtml(mensagem)}</p>${lista}`,
        departamento: DEPARTAMENTO_DP,
        assinatura: `Enviado pelo Consultor DP em ${escaparHtml(geradoEm || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}.`,
        motivoRodape: 'Você recebeu este e-mail porque sua empresa é atendida pelo nosso escritório. Em caso de dúvida, responda este e-mail.',
    });
}
