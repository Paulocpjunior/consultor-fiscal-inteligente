// ============================================================================
// sefaz-backend/caixa-postal-provider.js
// Provider abstrato pra Caixa Postal e-CAC.
//
// Suporta 2 modos:
//   - 'mock'   (default): gera mensagens sintéticas pra testar UI
//   - 'serpro' (futuro):  chama Integra Contador SERPRO (IC-CXPOSTAL)
//
// Troca via env var CAIXA_POSTAL_MODE — sem rebuild.
//
// API Integra Contador SERPRO (referencia, ativa quando contratar):
//   POST https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Consultar
//   Auth: e-CNPJ A1 da SP Contábil + procuração eletrônica eCAC do cliente
//   idSistema: CAIXAPOSTAL
//   idServicos: MSGCONTRIBUINTE51, OBTERINDICADORNOVASMSGS52, OBTERLISTAMSGS53
// ============================================================================

import { invokeIntegraContador } from './serpro-client.js';

const MODE = process.env.CAIXA_POSTAL_MODE || 'mock';

// ── Mock Provider ──────────────────────────────────────────────────────────
// Gera mensagens determinísticas baseadas no CNPJ pra testes consistentes.

const MOCK_TEMPLATES = [
    {
        categoria: 'intimacao',
        assunto: 'Intimação fiscal — Esclarecimento de divergência',
        remetente: 'Receita Federal do Brasil',
        corpo: 'Prezado contribuinte, foi identificada divergência entre o valor declarado em DCTF e os pagamentos realizados no período de competência {COMP}. Solicitamos esclarecimentos no prazo de 30 dias.',
    },
    {
        categoria: 'malha',
        assunto: 'Sua declaração está em malha fiscal',
        remetente: 'Receita Federal do Brasil',
        corpo: 'A declaração referente ao exercício de 2025 foi retida em malha fiscal por inconsistências nos rendimentos declarados. Acesse o e-CAC para regularização.',
    },
    {
        categoria: 'exclusao',
        assunto: 'Termo de Exclusão do Simples Nacional',
        remetente: 'Receita Federal do Brasil',
        corpo: 'Empresa identificada com débitos pendentes. Caso não regularize a situação no prazo de 30 dias, será excluída do Simples Nacional a partir do próximo exercício.',
    },
    {
        categoria: 'informativo',
        assunto: 'Comunicado — Reforma Tributária 2026',
        remetente: 'Receita Federal do Brasil',
        corpo: 'A LC 224/2025 estabelece nova alíquota de IRPJ presumido a partir de 2026. Verifique impactos no seu regime tributário.',
    },
    {
        categoria: 'informativo',
        assunto: 'Confirmação de transmissão DCTF',
        remetente: 'Receita Federal do Brasil',
        corpo: 'A DCTF referente ao período {COMP} foi recebida com sucesso. Número do recibo: {RECIBO}.',
    },
    {
        categoria: 'malha',
        assunto: 'Pendência identificada — PGDAS-D',
        remetente: 'Receita Federal do Brasil',
        corpo: 'O PGDAS-D do período {COMP} apresenta divergências com os XMLs autorizados. Revisão necessária.',
    },
];

function hashCnpj(cnpj) {
    let h = 0;
    for (const c of String(cnpj || '')) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h);
}

class MockProvider {
    async listarMensagens(empresaCnpj, opts = {}) {
        const seed = hashCnpj(empresaCnpj);
        // Gera entre 2 e 8 mensagens determinísticas pra cada CNPJ
        const qty = 2 + (seed % 7);
        const out = [];
        for (let i = 0; i < qty; i++) {
            const tpl = MOCK_TEMPLATES[(seed + i) % MOCK_TEMPLATES.length];
            const diasAtras = (seed * (i + 1)) % 90;
            const data = new Date();
            data.setDate(data.getDate() - diasAtras);
            const comp = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;

            out.push({
                mensagemId: `MOCK-${empresaCnpj}-${i.toString().padStart(4, '0')}`,
                empresaCnpj,
                assunto: tpl.assunto,
                remetente: tpl.remetente,
                categoria: tpl.categoria,
                corpo: tpl.corpo
                    .replace('{COMP}', comp)
                    .replace('{RECIBO}', `${seed}${i}${Math.random().toString().slice(2, 8)}`.slice(0, 12)),
                dataEnvio: data.toISOString(),
                dataLeitura: i < 2 ? null : new Date(data.getTime() + 86400000).toISOString(),  // 2 mais recentes não lidas
                fonte: 'mock',
            });
        }
        return out;
    }

    async marcarComoLida(mensagemId) {
        return { ok: true, mode: 'mock', message: 'Em modo mock: marcação só persiste no Firestore local.' };
    }
}

// ── SERPRO Provider (Integra-CaixaPostal ATIVO) ─────────────────────────────
// idServicos (idSistema=CAIXAPOSTAL):
//   - INNOVAMSG63        (/Consultar) -> indicador rapido tem msg nova
//   - MSGCONTRIBUINTE61  (/Consultar) -> lista paginada
//   - MSGCONTRIBUINTE62  (/Consultar) -> detalhe por isn

function safeJsonParse(s) {
    if (typeof s !== 'string') return s;
    try { return JSON.parse(s); } catch { return s; }
}

class SerproProvider {
    constructor() {}

    async temNovasMensagens(empresaCnpj) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'CAIXAPOSTAL',
            idServico: 'INNOVAMSG63',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: {},
        });
        const d = safeJsonParse(r.dados) || {};
        const ind = d.indicadorNovasMensagens || d.indicador || d.temNovas || '';
        return { temNovas: /^[ST1]/i.test(String(ind)), _raw: d };
    }

    async listarMensagens(empresaCnpj, opts = {}) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const todas = [];
        let ponteiro = '00000000000000';
        let p = 0;
        const MAX = 10;
        while (p < MAX) {
            const r = await invokeIntegraContador({
                idSistema: 'CAIXAPOSTAL',
                idServico: 'MSGCONTRIBUINTE61',
                contribuinteCnpj: cnpj,
                acao: 'Consultar',
                dados: {
                    categoria: '0',
                    statusLeitura: '0',
                    indicadorPagina: p === 0 ? '0' : '1',
                    ponteiroPagina: ponteiro,
                },
            });
            const d = safeJsonParse(r.dados) || {};
            const conteudo = (d.conteudo && d.conteudo[0]) || d;
            const lista = conteudo.listaMensagens || [];
            for (const m of lista) todas.push(this._mapMensagem(m, cnpj));
            const ultima = String(conteudo.indicadorUltimaPagina || 'S');
            const prox = conteudo.ponteiroProximaPagina;
            if (/^S/i.test(ultima) || !prox || prox === ponteiro) break;
            ponteiro = prox;
            p++;
        }
        return todas;
    }

    async obterDetalhe(empresaCnpj, isn) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'CAIXAPOSTAL',
            idServico: 'MSGCONTRIBUINTE62',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { isn: String(isn) },
        });
        return safeJsonParse(r.dados) || {};
    }

    async marcarComoLida(mensagemId) {
        return { ok: true, mode: 'serpro', message: 'SERPRO nao expoe marcar-lida. Persistencia local.' };
    }

    _mapMensagem(m, cnpj) {
        const isn = m.isn || m.numeroControle || '';
        const data = m.dataEnvio || '';
        const hora = m.horaEnvio || '';
        let dataIso = new Date().toISOString();
        if (/^\d{8}$/.test(data)) {
            const y = data.slice(0,4), mo = data.slice(4,6), dd = data.slice(6,8);
            const hh = /^\d{6}$/.test(hora) ? hora.slice(0,2) : '00';
            const mm = /^\d{6}$/.test(hora) ? hora.slice(2,4) : '00';
            const ss = /^\d{6}$/.test(hora) ? hora.slice(4,6) : '00';
            dataIso = `${y}-${mo}-${dd}T${hh}:${mm}:${ss}-03:00`;
        }
        let leituraIso = null;
        if (/^\d{8}$/.test(m.dataLeitura || '')) {
            const y = m.dataLeitura.slice(0,4), mo = m.dataLeitura.slice(4,6), dd = m.dataLeitura.slice(6,8);
            leituraIso = `${y}-${mo}-${dd}T00:00:00-03:00`;
        }
        const assunto = String(m.assuntoModelo || m.assunto || '').toLowerCase();
        let categoria = 'informativo';
        if (/intima|notifica/.test(assunto)) categoria = 'intimacao';
        else if (/malha|divergencia|inconsistencia/.test(assunto)) categoria = 'malha';
        else if (/exclus|exclud/.test(assunto)) categoria = 'exclusao';
        return {
            mensagemId: String(isn),
            empresaCnpj: cnpj,
            assunto: m.assuntoModelo || m.assunto || '(sem assunto)',
            remetente: m.remetente || 'Receita Federal do Brasil',
            categoria,
            corpo: m.corpo || '',
            dataEnvio: dataIso,
            dataLeitura: leituraIso,
            dataCiencia: /^\d{8}$/.test(m.dataCiencia || '') ? m.dataCiencia : null,
            indicadorLeitura: m.indicadorLeitura || '0',
            numeroControle: m.numeroControle || '',
            fonte: 'serpro',
        };
    }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let providerInstance = null;

export function getCaixaPostalProvider() {
    if (providerInstance) return providerInstance;
    if (MODE === 'serpro') {
        providerInstance = new SerproProvider();
    } else {
        providerInstance = new MockProvider();
    }
    return providerInstance;
}

export function getProviderMode() {
    return MODE;
}
