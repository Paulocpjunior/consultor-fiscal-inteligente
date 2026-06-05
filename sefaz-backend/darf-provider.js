// ============================================================================
// sefaz-backend/darf-provider.js
// Provider de emissão de DARF (Documento de Arrecadação de Receitas Federais).
//
// Modos:
//   - 'mock'   (default): gera código de barras FEBRABAN local + payload simulado
//   - 'serpro' (futuro):  chama Integra Contador SERPRO — produto DARF/PAGTOWEB
//                         idSistema=PAGAMENTOWEB  idServico=EMITEGUIADARF
//                         (nomes podem variar — confirmar no catálogo SERPRO)
//
// Troca via env DARF_MODE — sem rebuild.
// ============================================================================

import { gerarBarrasDarf, gerarLinhaDigitavelArrecadacao } from './febraban-barcode.js';
import { invokeIntegraContador } from './serpro-client.js';
import { calcularMultaDarf } from './multa-calculator.js';
import {
    montarPayloadDarfSerpro, resolverCodigoReceita, calcularVencimentoDarf,
} from './darf-payload-builder.js';

// Re-exporta pra darf-routes (preview) continuar importando daqui.
export { montarPayloadDarfSerpro };

// Default 'serpro' (REAL). 'mock' só com DARF_MODE=mock explícito (dev local).
// Sem config, falha no SERPRO em vez de devolver dado fake pro cliente.
const MODE = process.env.DARF_MODE || 'serpro';

/**
 * Calcula multa + juros de DARF atrasada. Delega para o calcularMultaDarf
 * central (Lei 9.430/96 art. 61) pra manter consistencia com o que e
 * exibido em outros lugares do app (DAS, vencimentos de obrigacoes).
 *
 * Antes existia uma implementacao local com SELIC 0,9% (diferente da
 * usada no multa-calculator que e 1,05%), gerando valores DIVERGENTES
 * pra mesma DARF dependendo de qual fluxo a calculasse. Unificado aqui.
 */
function calcularAcrescimos(valor, vencimento, dataPagamento) {
    const venc = new Date(vencimento);
    const pgto = new Date(dataPagamento);
    if (isNaN(venc) || isNaN(pgto) || pgto <= venc) {
        return { multa: 0, juros: 0, valorTotal: valor };
    }
    const r = calcularMultaDarf(valor, venc, pgto);
    if (!r) return { multa: 0, juros: 0, valorTotal: valor };
    return { multa: r.multaValor, juros: r.jurosValor, valorTotal: r.total };
}

// ultimoDiaDoMes / calcularVencimentoDarf / resolverCodigoReceita /
// montarPayloadDarfSerpro -> movidos pra darf-payload-builder.js (PURO,
// testavel sem undici). Importados no topo deste arquivo.

// ── Mock Provider ──────────────────────────────────────────────────────────

class MockProvider {
    /**
     * @param {object} req
     *   empresaCnpj, competencia (YYYY-MM), valor,
     *   regime ('Presumido'|'Real'), tributo ('IRPJ'|'CSLL'|'PIS'|'COFINS'|'IRRF'),
     *   periodicidade ('mensal'|'trimestral')?,
     *   codigoReceita? (sobrescreve sugestão),
     *   vencimento? (sobrescreve cálculo padrão),
     *   dataPagamento? (se atrasado, calcula multa+juros)
     */
    async gerarDarf(req) {
        const { empresaCnpj, competencia, valor } = req;
        if (!empresaCnpj || !competencia || !valor) {
            throw new Error('empresaCnpj, competencia e valor obrigatorios');
        }
        if (valor < 10) throw new Error('Valor minimo DARF: R$ 10,00');

        const codigoReceita = resolverCodigoReceita(req);
        const periodoAAAAMM = String(competencia).replace(/\D/g, '').slice(0, 6);
        const vencimento = req.vencimento
            || calcularVencimentoDarf(competencia, req.tributo, req.periodicidade);

        const acrescimos = req.dataPagamento
            ? calcularAcrescimos(valor, vencimento, req.dataPagamento)
            : { multa: 0, juros: 0, valorTotal: valor };

        const barras = gerarBarrasDarf({
            cnpj: empresaCnpj,
            periodo: periodoAAAAMM,
            valor: acrescimos.valorTotal,
            codigoReceita,
        });

        const numero = `MOCK-DARF-${codigoReceita}-${periodoAAAAMM}-${empresaCnpj.slice(-4)}-${Date.now().toString().slice(-6)}`;

        return {
            numeroDocumento: numero,
            codigoBarras: barras,
            linhaDigitavel: gerarLinhaDigitavelArrecadacao(barras),
            codigoReceita,
            vencimento,
            valorPrincipal: valor,
            multa: acrescimos.multa,
            juros: acrescimos.juros,
            valor: acrescimos.valorTotal,
            pdfBase64: null,
            fonte: 'mock',
            mensagem: 'DARF gerada em modo mock. Para producao real, ative DARF_MODE=serpro.',
        };
    }
}

// ── SERPRO Provider ────────────────────────────────────────────────────────
// Produto PAGTOWEB do Integra Contador (Pagamento e Arrecadação Web).
// Ref: https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador
//
// Pré-requisitos pra ativar:
//   - Contratar o produto PAGTOWEB na Loja SERPRO (separado do PGDASD)
//   - SERPRO_CONSUMER_KEY/SECRET válidos (já configurados pra DAS)
//   - Procuração eletrônica e-CAC ativa entre escritório e empresa cliente
//
// TODO[SERPRO_REAL]: confirmar o nome exato do idServico de EMISSÃO de DARF
// no portal autenticado SERPRO. idSistema/idServico (PAGTOWEB/EMITEDARF61)
// + builder do payload vivem em darf-payload-builder.js (configuravel via
// env SERPRO_DARF_SISTEMA / SERPRO_DARF_SERVICO). Use POST /darf/preview pra
// inspecionar o payload exato antes de emitir.

class SerproProvider {
    async gerarDarf(req) {
        const { valor } = req;
        const payload = montarPayloadDarfSerpro(req);   // mesmo builder do preview
        const codigoReceita = payload.dados.codigoReceita;

        const result = await invokeIntegraContador(payload);
        const d = result.dados || {};
        return {
            numeroDocumento: d.numeroDocumento || d.numeroDarf || '',
            codigoBarras:    d.codigoBarras || d.linhaDigitavel || '',
            linhaDigitavel:  d.linhaDigitavel || '',
            codigoReceita,
            vencimento:      d.dataVencimento || d.vencimento || '',
            valorPrincipal:  valor,
            multa:           d.valorMulta || 0,
            juros:           d.valorJuros || 0,
            valor:           d.valorTotal || valor,
            pdfBase64:       d.docArrecadacaoPdfB64 || d.pdfBase64 || null,
            fonte: 'serpro',
            _raw: d,
        };
    }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let providerInstance = null;
export function getDarfProvider() {
    if (providerInstance) return providerInstance;
    providerInstance = MODE === 'serpro' ? new SerproProvider() : new MockProvider();
    return providerInstance;
}
export function getDarfMode() { return MODE; }
