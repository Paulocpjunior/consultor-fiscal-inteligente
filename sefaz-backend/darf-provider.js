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
import { sugerirCodigoReceita } from './darf-codigos-receita.js';
import { invokeIntegraContador } from './serpro-client.js';
import { calcularMultaDarf } from './multa-calculator.js';

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

/**
 * Calcula o último dia do mês a partir de ano+mes (mes 1-12).
 * Trata fevereiro, abril, junho, setembro, novembro (que não tem dia 30/31).
 */
function ultimoDiaDoMes(ano, mes) {
    // new Date(ano, mes, 0) retorna o último dia do mes-1 (porque mes em
    // Date e 0-indexed e dia=0 volta pra ultimo dia do anterior).
    // Mes 1-12 input -> use mes diretamente, Date.UTC(ano, mes, 0).
    return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function calcularVencimentoDarf(competencia, tributo, periodicidade = 'trimestral') {
    // Vencimentos padrão RFB:
    //   IRPJ/CSLL Presumido/Real trimestral: ultimo dia util do mes seguinte ao
    //                                         encerramento do trimestre (Lei 9.430/96 art. 5º)
    //   PIS/COFINS mensal: dia 25 do mes seguinte (Lei 9.715/98 + 10.833/03)
    //   IRPJ/CSLL Real estimativa: ultimo dia util do mes seguinte (Lei 9.430/96 art. 5º §1º)
    //
    // Simplificacao: usamos ultimo DIA DO MES (nao dia util). Frontend pode
    // sobrescrever via req.vencimento. Bug anterior: fixo em '30' gerava
    // data invalida pra fevereiro (ex: '2026-02-30').
    const m = String(competencia).match(/^(\d{4})-(\d{2})$/);
    if (!m) return new Date().toISOString().slice(0, 10);
    let ano = parseInt(m[1]), mes = parseInt(m[2]);

    const t = String(tributo || '').toUpperCase();
    const isTri = periodicidade === 'trimestral' && (t === 'IRPJ' || t === 'CSLL');

    if (isTri) {
        // Próximo mês após fim do trimestre da competência
        const trimestre = Math.floor((mes - 1) / 3) + 1;       // 1..4
        const mesFimTrim = trimestre * 3;                       // 3, 6, 9, 12
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
    // Default (IRPJ/CSLL Real estimativa mensal, IRRF etc): ultimo dia do mes seguinte
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
    const dia = ultimoDiaDoMes(ano, mes);
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function resolverCodigoReceita(req) {
    if (req.codigoReceita) return req.codigoReceita;
    const sug = sugerirCodigoReceita(req.regime, req.tributo, req.periodicidade);
    if (!sug) throw new Error(`Codigo de receita nao definido pra ${req.regime}/${req.tributo}`);
    return sug.codigo;
}

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
// no portal autenticado SERPRO. Serviços conhecidos do PAGTOWEB incluem
// COMPARRECADACAO72 (comprovante). O serviço de emissão real (ex:
// EMITEDARF / EMITEGUIADARF) precisa ser confirmado pelo cliente que tem
// acesso ao catálogo da sua conta. Override via env SERPRO_DARF_SERVICO.

const DARF_ID_SISTEMA = process.env.SERPRO_DARF_SISTEMA || 'PAGTOWEB';
const DARF_ID_SERVICO = process.env.SERPRO_DARF_SERVICO || 'EMITEDARF61';  // CONFIRMAR

class SerproProvider {
    async gerarDarf(req) {
        const { empresaCnpj, competencia, valor } = req;
        if (!empresaCnpj || !competencia || !valor) {
            throw new Error('empresaCnpj, competencia e valor obrigatorios');
        }
        const codigoReceita = resolverCodigoReceita(req);
        const periodoAAAAMM = String(competencia).replace(/\D/g, '').slice(0, 6);

        const result = await invokeIntegraContador({
            idSistema: DARF_ID_SISTEMA,
            idServico: DARF_ID_SERVICO,
            contribuinteCnpj: empresaCnpj,
            acao: 'Emitir',
            dados: {
                codigoReceita,
                periodoApuracao: periodoAAAAMM,
                valorPrincipal: valor,
                vencimento: req.vencimento || calcularVencimentoDarf(competencia, req.tributo, req.periodicidade),
            },
        });
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
