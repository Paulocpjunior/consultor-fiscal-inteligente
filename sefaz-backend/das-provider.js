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

// Default 'serpro' (REAL). 'mock' só com DAS_MODE=mock explícito (dev local).
// Sem config, falha no SERPRO em vez de devolver dado fake pro cliente.
const MODE = process.env.DAS_MODE || 'serpro';

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
     * Consulta se ja existe declaracao transmitida pra esse PA.
     * idSistema=PGDASD idServico=CONSULTIMADECREC14  acao=Consultar
     * Custo: 1 chamada SERPRO (faixa baixa, ~R$ 0,06-0,40).
     *
     * Retorna { existe: true, numeroDeclaracao } ou { existe: false }
     */
    async consultarDeclaracaoPa(req) {
        const { empresaCnpj, competencia } = req;
        const pa = String(competencia).replace(/\D/g, '').slice(0, 6);

        try {
            const result = await invokeIntegraContador({
                idSistema: 'PGDASD',
                idServico: 'CONSULTIMADECREC14',
                contribuinteCnpj: empresaCnpj,
                acao: 'Consultar',
                dados: { periodoApuracao: pa },
            });
            const d = result.dados || {};
            const dec = d.declaracao || d;
            if (dec.numeroDeclaracao) return { existe: true, numeroDeclaracao: dec.numeroDeclaracao };
            return { existe: false };
        } catch (err) {
            // Se SERPRO retornar erro de negocio (404, nao encontrado, etc),
            // tratamos como "nao existe" — declaracao Original
            if (/n[aã]o.*encontrad|404|sem.*declarac/i.test(err.message || '')) {
                return { existe: false };
            }
            // Outros erros sao propagados
            throw err;
        }
    }

    /**
     * Transmite PGDAS-D via TRANSDECLARACAO11 / acao=Declarar.
     * Detecta Retificadora automaticamente via consultarDeclaracaoPa.
     *
     * Espera req.dadosPgdas com payload mapeado pelo pgdasMapper.ts (frontend).
     * Se dadosPgdas nao vier, monta payload minimo com receita total agregada.
     */
    async transmitirPgdasD(req) {
        const { empresaCnpj, competencia, valor, dadosPgdas } = req;
        if (!empresaCnpj || !competencia) throw new Error('empresaCnpj e competencia obrigatorios');

        const pa = Number(String(competencia).replace(/\D/g, '').slice(0, 6));
        const cnpjLimpo = String(empresaCnpj).replace(/\D/g, '');

        // Detecta se ja existe declaracao -> Retificadora
        const consulta = await this.consultarDeclaracaoPa({ empresaCnpj: cnpjLimpo, competencia: pa });
        const tipoDeclaracao = consulta.existe ? 2 : 1;

        // Monta payload completo (com dadosPgdas) ou minimo (fallback)
        let declaracao;
        if (dadosPgdas && dadosPgdas.declaracao) {
            // Frontend ja mandou payload mapeado
            declaracao = { ...dadosPgdas.declaracao, tipoDeclaracao };
        } else {
            // Fallback minimo — provavelmente vai falhar no SERPRO, mas evita crash
            declaracao = {
                tipoDeclaracao,
                receitaPaCompetenciaInterno: valor || 0,
                receitaPaCompetenciaExterno: 0,
                receitaPaCaixaInterno: null,
                receitaPaCaixaExterno: null,
                valorFixoIcms: null,
                valorFixoIss: null,
                receitasBrutasAnteriores: [],
                estabelecimentos: [{ cnpjCompleto: cnpjLimpo, atividades: [] }],
                folhaSalario12m: null,
            };
        }

        const dados = {
            cnpjCompleto: cnpjLimpo,
            pa,
            indicadorTransmissao: true,
            indicadorComparacao: true,
            declaracao,
        };

        const result = await invokeIntegraContador({
            idSistema: 'PGDASD',
            idServico: 'TRANSDECLARACAO11',
            contribuinteCnpj: cnpjLimpo,
            acao: 'Declarar',
            dados,
        });

        const d = result.dados || {};
        return {
            ok: true,
            recibo: d.numeroRecibo || d.recibo || d.numeroDeclaracao || '',
            numeroDeclaracao: d.numeroDeclaracao || '',
            tipoDeclaracao,
            transmitidoEm: d.dataTransmissao || new Date().toISOString(),
            valorDeclarado: valor,
            fonte: 'serpro',
            _raw: d,
        };
    }

    /**
     * Gera o DAS de uma competencia (declaracao ja transmitida).
     * idSistema=PGDASD idServico=GERARDAS12  acao=Emitir
     * Custo: R$ 0,80/DAS (a partir 01/2025).
     */
    async gerarDas(req) {
        const { empresaCnpj, competencia, valor, tipo = 'regular' } = req;
        if (!empresaCnpj || !competencia || !valor) {
            throw new Error('empresaCnpj, competencia e valor obrigatorios');
        }
        if (valor < 10) throw new Error('Valor minimo R$ 10,00');

        const periodoApuracao = String(competencia).replace(/\D/g, '').slice(0, 6);

        const result = await invokeIntegraContador({
            idSistema: 'PGDASD',
            idServico: 'GERARDAS12',
            contribuinteCnpj: empresaCnpj,
            acao: 'Emitir',
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
