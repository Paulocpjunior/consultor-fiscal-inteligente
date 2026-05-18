// ============================================================================
// sefaz-backend/emission-orchestrator.js
// Fachada única que despacha emissões por regime + tipo de guia e agrega o
// resumo consolidado de todas as guias emitidas (DAS, DARF, DCTFWeb, NFSe).
//
// Não substitui os providers especializados — apenas centraliza decisão
// e consolida métricas pro dashboard "Central de Emissões".
// ============================================================================

import { emitirDasRegular, emitirDasAvulso, getResumoDas } from './das-orchestrator.js';
import { emitirDarf, getResumoDarf } from './darf-orchestrator.js';
import { getDasMode } from './das-provider.js';
import { getDarfMode } from './darf-provider.js';

/**
 * Despacha emissão pra o provider correto.
 *
 * @param {object} req
 *   tipoGuia: 'DAS_REGULAR' | 'DAS_AVULSO' | 'DARF'
 *   + payload específico do provider
 */
export async function emitirGuia(req) {
    const tipo = String(req.tipoGuia || '').toUpperCase();
    switch (tipo) {
        case 'DAS_REGULAR': return await emitirDasRegular(req);
        case 'DAS_AVULSO':  return await emitirDasAvulso(req);
        case 'DARF':        return await emitirDarf(req);
        default:
            throw new Error(
                `tipoGuia invalido: '${req.tipoGuia}'. ` +
                `Aceitos: DAS_REGULAR, DAS_AVULSO, DARF.`
            );
    }
}

/**
 * Resumo consolidado pra dashboard "Central de Emissões".
 * Une counts/valores de DAS + DARF.
 */
export async function getResumoConsolidado() {
    const [das, darf] = await Promise.all([
        getResumoDas().catch(err => ({ _erro: err.message, totalDas: 0 })),
        getResumoDarf().catch(err => ({ _erro: err.message, totalDarfs: 0 })),
    ]);

    const pendentes      = (das.pendentes || 0)      + (darf.pendentes || 0);
    const vencidos       = (das.vencidos || 0)       + (darf.vencidos || 0);
    const pagos          = (das.pagos || 0)          + (darf.pagos || 0);
    const valorPendente  = (das.valorPendente || 0)  + (darf.valorPendente || 0);
    const valorVencido   = (das.valorVencido || 0)   + (darf.valorVencido || 0);
    const valorPago      = (das.valorPago || 0)      + (darf.valorPago || 0);

    return {
        totalGuias: (das.totalDas || 0) + (darf.totalDarfs || 0),
        pendentes, vencidos, pagos,
        valorPendente, valorVencido, valorPago,
        breakdown: {
            das: {
                total: das.totalDas || 0,
                pendentes: das.pendentes || 0,
                vencidos: das.vencidos || 0,
                pagos: das.pagos || 0,
                valorTotal: (das.valorPendente || 0) + (das.valorVencido || 0) + (das.valorPago || 0),
            },
            darf: {
                total: darf.totalDarfs || 0,
                pendentes: darf.pendentes || 0,
                vencidos: darf.vencidos || 0,
                pagos: darf.pagos || 0,
                valorTotal: (darf.valorPendente || 0) + (darf.valorVencido || 0) + (darf.valorPago || 0),
                porTributo: darf.porTributo || {},
            },
        },
        modes: {
            das: getDasMode(),
            darf: getDarfMode(),
        },
    };
}

/**
 * Catálogo de guias emittáveis por regime tributário.
 * Usado pela UI pra montar selector de tipo de guia.
 */
export function getCatalogoEmissao(regime) {
    const r = String(regime || '').toLowerCase();
    if (r.includes('simples')) {
        return [
            { tipoGuia: 'DAS_REGULAR', label: 'DAS Regular (com PGDAS-D)', tributos: ['DAS'] },
            { tipoGuia: 'DAS_AVULSO',  label: 'DAS Avulso',                tributos: ['DAS'] },
        ];
    }
    if (r.includes('presumido')) {
        return [
            { tipoGuia: 'DARF', label: 'DARF IRPJ Presumido',   tributos: ['IRPJ'],   periodicidade: 'trimestral' },
            { tipoGuia: 'DARF', label: 'DARF CSLL Presumido',   tributos: ['CSLL'],   periodicidade: 'trimestral' },
            { tipoGuia: 'DARF', label: 'DARF PIS Cumulativo',   tributos: ['PIS'],    periodicidade: 'mensal' },
            { tipoGuia: 'DARF', label: 'DARF COFINS Cumulativo',tributos: ['COFINS'], periodicidade: 'mensal' },
        ];
    }
    if (r.includes('real')) {
        return [
            { tipoGuia: 'DARF', label: 'DARF IRPJ Real',         tributos: ['IRPJ'],   periodicidade: 'trimestral' },
            { tipoGuia: 'DARF', label: 'DARF CSLL Real',         tributos: ['CSLL'],   periodicidade: 'trimestral' },
            { tipoGuia: 'DARF', label: 'DARF IRPJ Estimativa',   tributos: ['IRPJ'],   periodicidade: 'mensal' },
            { tipoGuia: 'DARF', label: 'DARF CSLL Estimativa',   tributos: ['CSLL'],   periodicidade: 'mensal' },
            { tipoGuia: 'DARF', label: 'DARF PIS Nao-Cumulativo',tributos: ['PIS'],    periodicidade: 'mensal' },
            { tipoGuia: 'DARF', label: 'DARF COFINS Nao-Cum.',   tributos: ['COFINS'], periodicidade: 'mensal' },
        ];
    }
    return [];
}
