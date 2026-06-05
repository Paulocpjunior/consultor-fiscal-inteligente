// ============================================================================
// darf-payload-builder.js  (PURO)
//
// Monta o payload do Integra Contador SERPRO pra emissao de DARF + helpers de
// codigo de receita e vencimento. Extraido de darf-provider.js pra ser
// TESTAVEL: darf-provider importa serpro-client -> undici, que nao carrega no
// jest. Este modulo importa SO a tabela de codigos (darf-codigos-receita, pura).
//
// O mesmo builder serve o ENVIO real (SerproProvider.gerarDarf) e o PREVIEW
// (GET /darf/preview) — garante que o admin ve no preview exatamente o que
// sera enviado.
// ============================================================================

import { sugerirCodigoReceita } from './darf-codigos-receita.js';

// idSistema/idServico configuraveis por env (o EMITEDARF61 e SUPOSTO —
// TODO[SERPRO_REAL]: confirmar no catalogo PAGTOWEB da conta SERPRO).
const DARF_ID_SISTEMA = process.env.SERPRO_DARF_SISTEMA || 'PAGTOWEB';
const DARF_ID_SERVICO = process.env.SERPRO_DARF_SERVICO || 'EMITEDARF61';

export function ultimoDiaDoMes(ano, mes) {
    return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

export function calcularVencimentoDarf(competencia, tributo, periodicidade = 'trimestral') {
    const m = String(competencia).match(/^(\d{4})-(\d{2})$/);
    if (!m) return new Date().toISOString().slice(0, 10);
    let ano = parseInt(m[1]), mes = parseInt(m[2]);

    const t = String(tributo || '').toUpperCase();
    const isTri = periodicidade === 'trimestral' && (t === 'IRPJ' || t === 'CSLL');

    if (isTri) {
        const trimestre = Math.floor((mes - 1) / 3) + 1;
        const mesFimTrim = trimestre * 3;
        mes = mesFimTrim + 1;
        if (mes > 12) { mes = 1; ano += 1; }
        const dia = ultimoDiaDoMes(ano, mes);
        return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
    if (t === 'PIS' || t === 'COFINS') {
        mes += 1;
        if (mes > 12) { mes = 1; ano += 1; }
        return `${ano}-${String(mes).padStart(2, '0')}-25`;
    }
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
    const dia = ultimoDiaDoMes(ano, mes);
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function resolverCodigoReceita(req) {
    if (req.codigoReceita) return req.codigoReceita;
    const sug = sugerirCodigoReceita(req.regime, req.tributo, req.periodicidade);
    if (!sug) throw new Error(`Codigo de receita nao definido pra ${req.regime}/${req.tributo}`);
    return sug.codigo;
}

/**
 * Monta o EXATO payload que seria enviado ao Integra Contador SERPRO.
 * @returns {{ idSistema, idServico, contribuinteCnpj, acao, dados }}
 */
export function montarPayloadDarfSerpro(req) {
    const { empresaCnpj, competencia, valor } = req;
    if (!empresaCnpj || !competencia || !valor) {
        throw new Error('empresaCnpj, competencia e valor obrigatorios');
    }
    const codigoReceita = resolverCodigoReceita(req);
    const periodoApuracao = String(competencia).replace(/\D/g, '').slice(0, 6);
    const vencimento = req.vencimento
        || calcularVencimentoDarf(competencia, req.tributo, req.periodicidade);
    return {
        idSistema: DARF_ID_SISTEMA,
        idServico: DARF_ID_SERVICO,
        contribuinteCnpj: empresaCnpj,
        acao: 'Emitir',
        dados: { codigoReceita, periodoApuracao, valorPrincipal: valor, vencimento },
    };
}
