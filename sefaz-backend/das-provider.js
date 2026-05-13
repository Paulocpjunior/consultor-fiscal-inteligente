// ============================================================================
// sefaz-backend/das-provider.js
// Provider abstrato pra emissao de DAS (Simples Nacional).
//
// Suporta 2 modos:
//   - 'mock'   (default): gera codigo de barras ficticio + PDF simulado
//   - 'serpro' (futuro):  chama Integra Contador SERPRO
//                         idSistema=PGDASD idServico=GERARDAS21
//                         Custo: R$ 0,80/DAS (a partir 01/2025)
//
// Troca via env DAS_MODE — sem rebuild.
// ============================================================================

const MODE = process.env.DAS_MODE || 'mock';

import { invokeIntegraContador } from './serpro-client.js';

// Helpers ─────────────────────────────────────────────────────────────────
function calcularDigitoBarras(c44) {
    // Calculo simplificado de DV — modulo 10 do FEBRABAN
    let soma = 0, peso = 2;
    for (let i = c44.length - 1; i >= 0; i--) {
        soma += parseInt(c44[i], 10) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto === 0 || resto === 1 ? '1' : (11 - resto).toString();
}

function gerarCodigoBarras(cnpj, periodo, valor) {
    // Formato simplificado pra mock:
    //   3 dig banco + 1 moeda + 14 cnpj + 6 periodo (YYYYMM) + 11 valor centavos + 9 padding
    const cnpjLimpo = (cnpj || '').replace(/\D/g, '').padStart(14, '0').slice(0, 14);
    const valorCentavos = Math.round((valor || 0) * 100).toString().padStart(11, '0').slice(-11);
    const periodoNum = (periodo || '').replace(/\D/g, '').padStart(6, '0').slice(0, 6);
    const sem_dv = `190` + `9` + cnpjLimpo + periodoNum + valorCentavos + `0`.repeat(9);
    const dv = calcularDigitoBarras(sem_dv.slice(0, 43));
    return sem_dv.slice(0, 4) + dv + sem_dv.slice(4, 43);
}

function gerarVencimento(competencia) {
    // Vencimento padrao: dia 20 do mes seguinte a competencia
    const m = competencia.match(/^(\d{4})-(\d{2})$/);
    if (!m) return new Date().toISOString().slice(0, 10);
    let ano = parseInt(m[1]), mes = parseInt(m[2]);
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
    return `${ano}-${String(mes).padStart(2, '0')}-20`;
}

// ── Mock Provider ──────────────────────────────────────────────────────────

class MockProvider {
    /**
     * Gera 1 DAS pra empresa.
     * @param {object} req { empresaCnpj, competencia, valor, tipo }
     * @returns {object} { numeroDocumento, codigoBarras, vencimento, valor, pdfUrl, fonte }
     */
    async gerarDas(req) {
        const { empresaCnpj, competencia, valor, tipo = 'regular' } = req;
        if (!empresaCnpj || !competencia || !valor) {
            throw new Error('empresaCnpj, competencia e valor obrigatorios');
        }
        if (valor < 10) throw new Error('Valor minimo R$ 10,00');

        const numero = `MOCK-${competencia.replace('-', '')}-${empresaCnpj.slice(-4)}-${Date.now().toString().slice(-6)}`;
        return {
            numeroDocumento: numero,
            codigoBarras: gerarCodigoBarras(empresaCnpj, competencia, valor),
            vencimento: gerarVencimento(competencia),
            valor,
            pdfUrl: null,  // mock nao gera PDF — UI mostra dados estruturados
            fonte: 'mock',
            tipo,
            mensagem: 'DAS gerado em modo mock. Para producao real, ative DAS_MODE=serpro.',
        };
    }

    /**
     * Transmite PGDAS-D antes da geracao do DAS regular.
     * Em modo serpro: idSistema=PGDASD idServico=ENTREGARDECLARACAO11
     */
    async transmitirPgdasD(req) {
        const { empresaCnpj, competencia, valor } = req;
        return {
            ok: true,
            recibo: `MOCK-PGDAS-${competencia.replace('-','')}-${empresaCnpj.slice(-4)}`,
            transmitidoEm: new Date().toISOString(),
            valorDeclarado: valor,
            fonte: 'mock',
        };
    }
}

// ── SERPRO Provider ────────────────────────────────────────────────────────
// Chama Integra Contador via serpro-client.js. Pré-requisitos:
//   - SERPRO_CONSUMER_KEY, SERPRO_CONSUMER_SECRET, SERPRO_CONTRATANTE_CNPJ env vars
//   - Contrato Integra Contador ativo na Loja SERPRO (PGDASD)
//   - Procuração eletrônica e-CAC da empresa cliente para a SP Contábil
//
// Para validar sem credenciais: SERPRO_DRY_RUN=1 (resposta simulada).

class SerproProvider {
    constructor() {
        // Construtor não chama nada — valida lazy no primeiro uso.
        // Permite que o factory funcione mesmo sem credenciais (importante pra
        // load de módulo em ambiente de teste/build).
    }

    /**
     * Transmite PGDAS-D (declaração do Simples Nacional) antes do DAS regular.
     * idSistema=PGDASD idServico=ENTREGARDECLARACAO11
     *
     * TODO[SERPRO_REAL]: validar payload exato contra documentação após
     * primeira chamada real. Os campos abaixo são baseados na referência
     * pública do Integra Contador; pode precisar ajustar nomes/formatos.
     */
    async transmitirPgdasD(req) {
        const { empresaCnpj, competencia, valor } = req;
        if (!empresaCnpj || !competencia) throw new Error('empresaCnpj e competencia obrigatórios');

        // SERPRO espera período como YYYYMM (sem separador)
        const periodoApuracao = String(competencia).replace(/\D/g, '').slice(0, 6);

        const result = await invokeIntegraContador({
            idSistema: 'PGDASD',
            idServico: 'ENTREGARDECLARACAO11',
            contribuinteCnpj: empresaCnpj,
            dados: {
                periodoApuracao,
                valorDeclaracao: valor,
                // TODO[SERPRO_REAL]: adicionar receita bruta por atividade,
                // folha de pagamento, etc — depende do detalhamento da PGDASD.
            },
        });

        const d = result.dados || {};
        return {
            ok: true,
            recibo: d.numeroRecibo || d.recibo || d.numeroDeclaracao || '',
            transmitidoEm: d.dataTransmissao || new Date().toISOString(),
            valorDeclarado: valor,
            fonte: 'serpro',
            _raw: d,
        };
    }

    /**
     * Gera o DAS de uma competência.
     * idSistema=PGDASD idServico=GERARDAS21
     * Custo: R$ 0,80/DAS (a partir 01/2025).
     */
    async gerarDas(req) {
        const { empresaCnpj, competencia, valor, tipo = 'regular' } = req;
        if (!empresaCnpj || !competencia || !valor) {
            throw new Error('empresaCnpj, competencia e valor obrigatórios');
        }
        if (valor < 10) throw new Error('Valor mínimo R$ 10,00');

        const periodoApuracao = String(competencia).replace(/\D/g, '').slice(0, 6);

        const result = await invokeIntegraContador({
            idSistema: 'PGDASD',
            idServico: 'GERARDAS21',
            contribuinteCnpj: empresaCnpj,
            dados: { periodoApuracao },
        });

        const d = result.dados || {};
        // TODO[SERPRO_REAL]: confirmar campos exatos do response na primeira
        // chamada real. Os nomes abaixo são esperados mas podem variar.
        return {
            numeroDocumento: d.numeroDocumento || d.numeroDarf || '',
            codigoBarras: d.codigoBarras || d.linhaDigitavel || '',
            vencimento: d.dataVencimento || d.vencimento || '',
            valor: d.valorTotal || valor,
            pdfUrl: null,  // PDF vem como base64 no campo docArrecadacaoPdfB64
            pdfBase64: d.docArrecadacaoPdfB64 || d.pdfBase64 || null,
            fonte: 'serpro',
            tipo,
            _raw: d,
        };
    }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let providerInstance = null;
export function getDasProvider() {
    if (providerInstance) return providerInstance;
    providerInstance = MODE === 'serpro' ? new SerproProvider() : new MockProvider();
    return providerInstance;
}
export function getDasMode() { return MODE; }
