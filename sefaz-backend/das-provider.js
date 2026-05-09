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

// ── SERPRO Provider (skeleton) ──────────────────────────────────────────────

class SerproProvider {
    constructor() {
        throw new Error(
            'SerproProvider DAS ainda nao implementado. ' +
            'Pre-requisitos: contrato Integra Contador na Loja SERPRO + e-CNPJ A1 SP Contabil. ' +
            'Quando ativar, defina DAS_MODE=serpro.'
        );
    }
    async gerarDas() { throw new Error('nao implementado'); }
    async transmitirPgdasD() { throw new Error('nao implementado'); }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let providerInstance = null;
export function getDasProvider() {
    if (providerInstance) return providerInstance;
    providerInstance = MODE === 'serpro' ? new SerproProvider() : new MockProvider();
    return providerInstance;
}
export function getDasMode() { return MODE; }
