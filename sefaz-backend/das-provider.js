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
import {
    assertValorPgdasCompativel,
    extrairDeclaracaoTransmitidaPgdas,
    montarDadosDeclaracaoPgdas,
    normalizarValoresDevidosPgdas,
} from './pgdas-utils.js';
import {
    extrairAtividadesDeclaradas,
    resumirAtividadesDeclaradas,
    podarBrutoDeclaracao,
} from './pgdas-atividades-declaradas.js';
import { assertValorMinimoDas } from './das-valor-utils.js';
import { normalizarRespostaDasSerpro } from './das-response-normalizer.js';

const PGDAS_VALOR_TOLERANCIA = Number(process.env.PGDAS_VALOR_TOLERANCIA || '0.05');

// Helpers ─────────────────────────────────────────────────────────────────
function parseMaybeJson(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    try { return JSON.parse(trimmed); }
    catch { return value; }
}

function textoErroSerpro(err) {
    const partes = [err?.message, err?.serproMessage];
    const mensagens = Array.isArray(err?.serproMessages) ? err.serproMessages : [];
    for (const msg of mensagens) {
        partes.push(msg?.codigo, msg?.texto, msg?.mensagem, msg?.message);
    }
    return partes.filter(Boolean).join(' ');
}

export function inferirTipoDeclaracaoCorretoPgdas(err) {
    const texto = textoErroSerpro(err);
    if (!/MSG_ISN_041|tipo de declara/i.test(texto)) return null;

    if (/correto\s*(?:é|e)\s*2\s*[-–]?\s*Retificadora/i.test(texto)
        || /2\s*[-–]?\s*Retificadora/i.test(texto)) {
        return 2;
    }
    if (/correto\s*(?:é|e)\s*1\s*[-–]?\s*Original/i.test(texto)
        || /1\s*[-–]?\s*Original/i.test(texto)) {
        return 1;
    }
    return null;
}

/**
 * Extrai os CNPJs de estabelecimentos (filiais) que o SERPRO diz faltarem no
 * payload — erro MSG_ISN_018: "Um ou mais [estabelecimentos] existentes no
 * Cadastro CNPJ não foram enviados no campo Estabelecimento: <cnpj>[, <cnpj>]".
 * O SN-Entregar exige TODOS os estabelecimentos do CNPJ, mesmo sem receita.
 * @returns {string[]} CNPJs completos (14 díg) citados no erro.
 */
export function extrairEstabelecimentosFaltantesPgdas(err) {
    const texto = textoErroSerpro(err);
    if (!/MSG_ISN_018|campo Estabelecimento/i.test(texto)) return [];
    const idx = texto.search(/Estabelecimento/i);
    const trecho = idx >= 0 ? texto.slice(idx) : texto;
    return [...new Set(trecho.match(/\d{14}/g) || [])];
}

/**
 * Devolve uma cópia da declaração com os estabelecimentos faltantes incluídos
 * (sem atividades — a receita permanece agregada na matriz, como o app já
 * apura). Retorna null se não há nada novo a acrescentar.
 */
export function adicionarEstabelecimentosFaltantes(declaracao, cnpjsFaltantes) {
    if (!Array.isArray(cnpjsFaltantes) || !cnpjsFaltantes.length) return null;
    const atuais = new Set(
        (declaracao?.estabelecimentos || []).map((e) => String(e?.cnpjCompleto || '').replace(/\D/g, '')),
    );
    const novos = cnpjsFaltantes
        .map((c) => String(c).replace(/\D/g, ''))
        .filter((c) => c.length === 14 && !atuais.has(c))
        .map((cnpjCompleto) => ({ cnpjCompleto, atividades: [] }));
    if (!novos.length) return null;
    return { ...declaracao, estabelecimentos: [...(declaracao?.estabelecimentos || []), ...novos] };
}

function findNumeroDeclaracaoPgdas(value, depth = 0) {
    if (depth > 8 || value == null) return '';
    const parsed = parseMaybeJson(value);

    if (Array.isArray(parsed)) {
        for (const item of parsed) {
            const found = findNumeroDeclaracaoPgdas(item, depth + 1);
            if (found) return found;
        }
        return '';
    }

    if (typeof parsed !== 'object') return '';

    for (const key of ['numeroDeclaracao', 'idDeclaracao']) {
        const numero = parsed[key];
        if (numero != null && String(numero).trim()) return String(numero).trim();
    }

    for (const key of ['dados', 'declaracaoTransmitida', 'declaracao', 'resultado', 'declaracoes', 'declaracoesTransmitidas']) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            const found = findNumeroDeclaracaoPgdas(parsed[key], depth + 1);
            if (found) return found;
        }
    }
    return '';
}

export function extrairNumeroDeclaracaoConsultaPgdas(result) {
    const transmitida = extrairDeclaracaoTransmitidaPgdas(result);
    const numeroTransmitida = findNumeroDeclaracaoPgdas(transmitida);
    if (numeroTransmitida) return numeroTransmitida;
    return findNumeroDeclaracaoPgdas(result?.dados ?? result);
}

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
        const { empresaCnpj, competencia, tipo = 'regular' } = req;
        const valor = assertValorMinimoDas(req.valor);
        if (!empresaCnpj || !competencia || !valor) {
            throw new Error('empresaCnpj, competencia e valor obrigatorios');
        }

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
            const numeroDeclaracao = extrairNumeroDeclaracaoConsultaPgdas(result);
            if (numeroDeclaracao) return { existe: true, numeroDeclaracao };
            const declaracao = extrairDeclaracaoTransmitidaPgdas(result);
            return declaracao ? { existe: true, numeroDeclaracao: '' } : { existe: false };
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
     * Lê as ATIVIDADES de uma declaração PGDAS-D já transmitida (mesma consulta
     * CONSULTIMADECREC14). Serve pra descobrir o número oficial de uma atividade
     * que o app ainda não mapeia, na única fonte confiável disponível: o que a
     * própria empresa declarou e a Receita aceitou (caso S&P — ISS fixo do
     * escritório contábil). NÃO transmite nada; é consulta pura.
     */
    async consultarAtividadesDeclaradas({ empresaCnpj, competencia }) {
        const pa = String(competencia).replace(/\D/g, '').slice(0, 6);
        const result = await invokeIntegraContador({
            idSistema: 'PGDASD',
            idServico: 'CONSULTIMADECREC14',
            contribuinteCnpj: empresaCnpj,
            acao: 'Consultar',
            dados: { periodoApuracao: pa },
        });
        const atividades = extrairAtividadesDeclaradas(result);
        return {
            pa,
            atividades,
            resumo: resumirAtividadesDeclaradas(atividades),
            // Farol honesto: nenhuma atividade encontrada NÃO significa "empresa
            // sem receita" — pode ser que a consulta devolva só o recibo, sem o
            // detalhamento. Quem chama mostra o motivo em vez de um zero mudo.
            detalhamentoIndisponivel: atividades.length === 0,
            // ...e é EXATAMENTE aqui que mora a resposta do "sem movimento":
            // declaração sem movimento não tem atividade nenhuma de verdade. Sem
            // o bruto, a viagem que traz a FORMA aceita pelo SERPRO se perde.
            bruto: atividades.length === 0 ? podarBrutoDeclaracao(result) : undefined,
        };
    }

    async validarDeclaracaoPgdas({ cnpjLimpo, pa, declaracao }) {
        const dadosValidacao = montarDadosDeclaracaoPgdas({
            cnpjLimpo,
            pa,
            transmitir: false,
            declaracao,
        });

        return invokeIntegraContador({
            idSistema: 'PGDASD',
            idServico: 'TRANSDECLARACAO11',
            contribuinteCnpj: cnpjLimpo,
            acao: 'Declarar',
            dados: dadosValidacao,
        });
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
        let tipoDeclaracao = consulta.existe ? 2 : 1;

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
            };
        }

        // Valida com auto-correção de dois erros conhecidos do SERPRO, até 3x:
        //  - MSG_ISN_041: tipo de declaração (Original x Retificadora) errado
        //  - MSG_ISN_018: estabelecimentos (filiais) do CNPJ faltando no payload
        //    — o app agrega a receita das filiais na matriz, mas o SN-Entregar
        //    exige TODOS os estabelecimentos listados. Inclui os que faltam
        //    (sem receita própria) e revalida. Caso real BRISKA (matriz
        //    .../0001-75 + filial .../0002-56), 09/07/2026.
        let validacao;
        for (let tentativa = 0; ; tentativa++) {
            try {
                validacao = await this.validarDeclaracaoPgdas({ cnpjLimpo, pa, declaracao });
                break;
            } catch (err) {
                if (tentativa >= 3) throw err;
                const tipoCorreto = inferirTipoDeclaracaoCorretoPgdas(err);
                if (tipoCorreto && tipoCorreto !== tipoDeclaracao) {
                    tipoDeclaracao = tipoCorreto;
                    declaracao = { ...declaracao, tipoDeclaracao };
                    continue;
                }
                const comFiliais = adicionarEstabelecimentosFaltantes(
                    declaracao, extrairEstabelecimentosFaltantesPgdas(err),
                );
                if (comFiliais) { declaracao = comFiliais; continue; }
                throw err;
            }
        }

        if (validacao?.dados?._dryRun) {
            return {
                ok: true,
                recibo: `DRY-PGDAS-${String(competencia).replace(/\D/g, '')}-${cnpjLimpo.slice(-4)}`,
                numeroDeclaracao: '',
                tipoDeclaracao,
                transmitidoEm: new Date().toISOString(),
                valorDeclarado: valor,
                fonte: 'serpro-dry-run',
                _raw: validacao.dados,
            };
        }

        let valoresParaComparacao = normalizarValoresDevidosPgdas(validacao);
        if (!valoresParaComparacao.length && (Number(valor) || 0) > 0) {
            const err = new Error(
                'SERPRO validou a declaracao, mas nao devolveu valores devidos para comparacao. ' +
                'Nenhuma declaracao foi transmitida; tente novamente ou confira a apuracao no PGDAS-D.'
            );
            err.code = 'PGDAS_SEM_VALORES_COMPARACAO';
            err.httpStatus = 502;
            throw err;
        }

        assertValorPgdasCompativel({
            valorLocal: valor,
            valoresDevidos: valoresParaComparacao,
            tolerancia: PGDAS_VALOR_TOLERANCIA,
        });

        let dadosTransmissao = montarDadosDeclaracaoPgdas({
            cnpjLimpo,
            pa,
            transmitir: true,
            declaracao,
            valoresParaComparacao,
        });

        let result;
        try {
            result = await invokeIntegraContador({
                idSistema: 'PGDASD',
                idServico: 'TRANSDECLARACAO11',
                contribuinteCnpj: cnpjLimpo,
                acao: 'Declarar',
                dados: dadosTransmissao,
            });
        } catch (err) {
            const tipoCorreto = inferirTipoDeclaracaoCorretoPgdas(err);
            if (!tipoCorreto || tipoCorreto === tipoDeclaracao) throw err;

            tipoDeclaracao = tipoCorreto;
            declaracao = { ...declaracao, tipoDeclaracao };
            const novaValidacao = await this.validarDeclaracaoPgdas({ cnpjLimpo, pa, declaracao });
            const novosValores = normalizarValoresDevidosPgdas(novaValidacao);
            if (!novosValores.length && (Number(valor) || 0) > 0) {
                const semValores = new Error(
                    'SERPRO validou a declaracao, mas nao devolveu valores devidos para comparacao. ' +
                    'Nenhuma declaracao foi transmitida; tente novamente ou confira a apuracao no PGDAS-D.'
                );
                semValores.code = 'PGDAS_SEM_VALORES_COMPARACAO';
                semValores.httpStatus = 502;
                throw semValores;
            }
            assertValorPgdasCompativel({
                valorLocal: valor,
                valoresDevidos: novosValores,
                tolerancia: PGDAS_VALOR_TOLERANCIA,
            });
            valoresParaComparacao = novosValores;

            dadosTransmissao = montarDadosDeclaracaoPgdas({
                cnpjLimpo,
                pa,
                transmitir: true,
                declaracao,
                valoresParaComparacao,
            });
            result = await invokeIntegraContador({
                idSistema: 'PGDASD',
                idServico: 'TRANSDECLARACAO11',
                contribuinteCnpj: cnpjLimpo,
                acao: 'Declarar',
                dados: dadosTransmissao,
            });
        }

        const d = extrairDeclaracaoTransmitidaPgdas(result) || result.dados || {};
        return {
            ok: true,
            recibo: d.numeroRecibo || d.recibo || d.numeroDeclaracao || d.idDeclaracao || '',
            numeroDeclaracao: d.numeroDeclaracao || d.idDeclaracao || '',
            tipoDeclaracao,
            transmitidoEm: d.dataTransmissao || d.dataHoraTransmissao || new Date().toISOString(),
            valorDeclarado: valor,
            valorSerpro: valoresParaComparacao.reduce((sum, item) => sum + item.valor, 0),
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
        const { empresaCnpj, competencia, tipo = 'regular' } = req;
        const valor = assertValorMinimoDas(req.valor);
        if (!empresaCnpj || !competencia || !valor) {
            throw new Error('empresaCnpj, competencia e valor obrigatorios');
        }

        const periodoApuracao = String(competencia).replace(/\D/g, '').slice(0, 6);

        const result = await invokeIntegraContador({
            idSistema: 'PGDASD',
            idServico: 'GERARDAS12',
            contribuinteCnpj: empresaCnpj,
            acao: 'Emitir',
            dados: { periodoApuracao },
        });

        const d = normalizarRespostaDasSerpro(result, valor);
        return {
            numeroDocumento: d.numeroDocumento || '',
            codigoBarras: d.codigoBarras || '',
            vencimento: d.vencimento || '',
            valor: d.valor || valor,
            pdfUrl: d.pdfUrl,
            pdfBase64: d.pdfBase64,
            fonte: 'serpro',
            tipo,
            _raw: d._raw,
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
