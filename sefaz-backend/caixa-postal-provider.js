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

// ── SERPRO Provider (skeleton — implementação futura) ───────────────────────

class SerproProvider {
    constructor() {
        throw new Error(
            'SerproProvider ainda não implementado. ' +
            'Pré-requisitos: contrato Integra Contador na Loja SERPRO + e-CNPJ A1 SP Contábil. ' +
            'Quando ativar, defina CAIXA_POSTAL_MODE=serpro.'
        );
    }

    async listarMensagens(empresaCnpj, opts) {
        // Roteiro futuro:
        // 1. POST /Consultar com idSistema=CAIXAPOSTAL idServico=OBTERLISTAMSGS53
        // 2. Headers: Authorization: Bearer <jwt-com-e-cnpj-a1>
        // 3. Body: { contratante, autorPedidoDados, contribuinte, pedidoDados }
        // 4. Parsear response.dados (string JSON com lista)
        throw new Error('SerproProvider.listarMensagens não implementado');
    }

    async marcarComoLida(mensagemId) {
        throw new Error('SerproProvider.marcarComoLida não implementado');
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
