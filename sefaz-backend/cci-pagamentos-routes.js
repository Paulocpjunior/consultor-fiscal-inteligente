// Consulta PAGTOWEB exclusiva da Contabilidade. A carteira pertence ao CCI.
import { Router } from 'express';
import admin from 'firebase-admin';
import { crossProjectAuth, PROJETO } from './require-cross-project-auth.js';
import { montarFiltroPagamentos, lerRetornoPagamentos, SERVICO_PAGAMENTOS } from './dp-pagamentos.js';
import { invokeIntegraContador, getSerproConfig } from './serpro-client.js';

export async function confirmarEmpresaContabil({ token, cnpj, base = process.env.CCI_URL, fetchImpl = fetch }) {
    if (!token || !/^\d{14}$/.test(cnpj)) throw Object.assign(new Error('Informe a empresa e autentique-se no CCI.'), { status: 403 });
    let url;
    try { url = new URL(base); } catch { throw Object.assign(new Error('Configure CCI_URL no CFI para conferir o acesso à empresa.'), { status: 503 }); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw Object.assign(new Error('CCI_URL deve ser a origem HTTPS do CCI, sem credenciais ou caminho.'), { status: 503 });
    }
    const r = await fetchImpl(`${url.origin}/api/empresas/${cnpj}/pagamentos-receita/acesso`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if ([401, 403, 404].includes(r.status)) throw Object.assign(new Error('Sem acesso a esta empresa no CCI. Confira sua carteira com o administrador.'), { status: 403 });
    if (!r.ok) throw Object.assign(new Error('Não foi possível conferir a carteira do CCI. Tente novamente.'), { status: 502 });
    const d = await r.json();
    if (d.ok !== true || d.cnpj !== cnpj) throw Object.assign(new Error('O CCI não confirmou o acesso ao CNPJ solicitado.'), { status: 403 });
}

export function criarHandlerConsulta({ confirmar = confirmarEmpresaContabil, consultar = invokeIntegraContador,
    config = getSerproConfig, auditar = async (dados) => {
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
        await admin.firestore().collection('cci_pagamentos_log').add({ ...dados, em: admin.firestore.FieldValue.serverTimestamp() });
    } } = {}) {
    return async (req, res) => {
        const cnpj = String(req.body?.cnpj || '').replace(/\D/g, '');
        if (!/^\d{14}$/.test(cnpj)) return res.status(400).json({ ok: false, error: 'Informe um CNPJ com 14 dígitos.' });
        const filtro = montarFiltroPagamentos(req.body || {});
        if (filtro.erro) return res.status(400).json({ ok: false, error: filtro.erro });
        const log = async (status, quantidade = null) => {
            // Lista fechada: mensagens do provedor podem conter valores ou dados pessoais.
            try { await auditar({ porUid: req.user?.uid || null, projetoOrigem: PROJETO.contabil,
                cnpj, status, quantidade, primeiroDaPagina: filtro.dados.primeiroDaPagina,
                tamanhoDaPagina: filtro.dados.tamanhoDaPagina }); }
            catch { console.warn('[cci-pagamentos] Falha na auditoria da consulta.'); }
        };
        try {
            await confirmar({ token: (req.headers.authorization || '').replace(/^Bearer\s+/i, ''), cnpj });
        } catch (e) {
            await log('acesso_nao_confirmado');
            return res.status(e.status || 502).json({ ok: false, error: e.message });
        }
        try {
            const r = await consultar({ ...SERVICO_PAGAMENTOS, contribuinteCnpj: cnpj, dados: filtro.dados });
            const resposta = lerRetornoPagamentos(r, { numerosDocumento: filtro.numerosDocumento,
                tamanhoDaPagina: filtro.dados.tamanhoDaPagina, dryRun: config().dryRun });
            await log(resposta.ok ? 'consultado' : 'resposta_recusada', resposta.ok ? resposta.documentos.length : null);
            return res.status(resposta.ok ? 200 : 502).json(resposta);
        } catch (e) {
            await log('falha_provedor');
            return res.status(502).json({ ok: false, fonte: 'serpro', error: e.message,
                mensagens: Array.isArray(e.serproMessages) ? e.serproMessages : [] });
        }
    };
}
const router = Router();
router.post('/pagamentos/consultar', crossProjectAuth([PROJETO.contabil]), criarHandlerConsulta());
export default router;
