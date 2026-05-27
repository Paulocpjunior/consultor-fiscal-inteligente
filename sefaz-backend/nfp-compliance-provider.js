// ============================================================================
// sefaz-backend/nfp-compliance-provider.js
//
// Provider de consultas de compliance fiscal via SERPRO Integra Contador.
// Módulos:
//   - Situação Fiscal Federal (SITFIS / CONSULTARSITUACAOFISCAL)
//   - Dívida Ativa / PGFN     (PGFN   / CONSULTARSITUACAOINSCRICAO)
//   - Certidões CND/CPEN/CPN  (CERTIDOES / CONSULTARCERTIDAO)
//   - Obrigações Acessórias    (SITFIS / CONSULTAROBRIGACOES)
//   - Parcelamentos vigentes   (PGFN   / CONSULTARPARCELAMENTO)
//   - Análise completa         (todas acima em paralelo)
//
// Suporta SERPRO_DRY_RUN=1 para desenvolvimento sem chamar API real.
// ============================================================================

import { invokeIntegraContador } from './serpro-client.js';

const DRY_RUN = process.env.SERPRO_DRY_RUN === '1';
const TAG = '[nfp-compliance]';

// ─── Helpers ────────────────────────────────────────────────────────────────

function erroEstruturado(mensagem, codigo = 'SERVICO_INDISPONIVEL') {
    return { ok: false, erro: mensagem, codigo };
}

function cnpjLimpo(cnpj) {
    return (cnpj || '').replace(/\D/g, '').padStart(14, '0').slice(0, 14);
}

// ─── Mock Data (SERPRO_DRY_RUN=1) ───────────────────────────────────────────

function mockSituacaoFiscal(cnpj) {
    return {
        ok: true,
        situacao: 'REGULAR',
        pendencias: [],
        debitos: [
            { tributo: 'IRPJ', competencia: '2025-03', valorOriginal: 4500.00, status: 'aberto' },
        ],
        ultimaConsulta: new Date().toISOString(),
        fonte: 'mock',
    };
}

function mockDividaAtiva(cnpj) {
    return {
        ok: true,
        inscricoes: [
            { numero: '80 6 24 000001-00', valorConsolidado: 12300.50, situacao: 'ATIVA', dataInscricao: '2024-08-15' },
        ],
        valorTotal: 12300.50,
        parcelamentos: [],
        fonte: 'mock',
    };
}

function mockCertidoes(cnpj) {
    const today = new Date().toISOString().slice(0, 10);
    const futureDate = (days) => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
    };
    return {
        ok: true,
        certidoes: [
            {
                esfera: 'federal', orgao: 'Receita Federal / PGFN', tipo: 'CND Federal',
                status: 'negativa', validade: futureDate(180), numero: `CND-${cnpj.slice(0, 8)}-2026`,
                dataEmissao: today, fonte: 'serpro',
            },
            {
                esfera: 'fgts', orgao: 'Caixa Econômica Federal', tipo: 'CRF (FGTS)',
                status: 'positiva', validade: null,
                motivo: 'Recolhimento em atraso comp. 03/2026', fonte: 'serpro',
            },
            {
                esfera: 'trabalhista', orgao: 'Justiça do Trabalho (TST)', tipo: 'CNDT (Trabalhista)',
                status: 'negativa', validade: futureDate(180), numero: `CNDT-${cnpj.slice(0, 8)}`,
                dataEmissao: today, fonte: 'serpro',
            },
            {
                esfera: 'estadual', orgao: 'Sefaz Estadual', tipo: 'CND Estadual (ICMS)',
                status: 'positiva_efeitos_negativa', validade: futureDate(90),
                motivo: 'Parcelamento ICMS ativo', fonte: 'manual',
            },
            {
                esfera: 'municipal', orgao: 'Prefeitura Municipal', tipo: 'CND Municipal (ISS)',
                status: 'negativa', validade: futureDate(90), fonte: 'manual',
            },
        ],
        fonte: 'mock',
    };
}

function mockObrigacoes(cnpj) {
    return {
        ok: true,
        obrigacoes: [
            { nome: 'DCTFWeb', sigla: 'DCTFWeb', competencia: '2025-04', status: 'entregue' },
            { nome: 'ECD', sigla: 'ECD', competencia: '2024', status: 'entregue' },
            { nome: 'ECF', sigla: 'ECF', competencia: '2024', status: 'pendente' },
            { nome: 'SPED Fiscal', sigla: 'EFD', competencia: '2025-04', status: 'entregue' },
            { nome: 'eSocial', sigla: 'eSocial', competencia: '2025-04', status: 'entregue' },
            { nome: 'FGTS Digital', sigla: 'FGTS', competencia: '2025-03', status: 'atrasada' },
        ],
        fonte: 'mock',
    };
}

// ─── Mocks individuais por sistema (SERPRO_DRY_RUN=1) ──────────────────────

function mockDctfWeb() {
    return { ok: true, entregue: true, situacao: 'ENTREGUE', dataEntrega: '2025-04-15' };
}

function mockESocial() {
    return { ok: true, entregue: true, situacao: 'FECHAMENTO_TRANSMITIDO', dataEntrega: '2025-04-14' };
}

function mockFgtsDigital() {
    return { ok: true, regular: false, depositoDevido: 3200.00, depositoRealizado: 2800.00 };
}

function mockSpedFiscal() {
    return { ok: true, entregue: true, situacao: 'ENTREGUE', dataEntrega: '2025-04-20' };
}

function mockSpedContribuicoes() {
    return { ok: true, entregue: true, situacao: 'ENTREGUE', dataEntrega: '2025-04-18' };
}

function mockEcd() {
    return { ok: true, entregue: true, situacao: 'ENTREGUE', dataEntrega: '2025-05-30' };
}

function mockEcf() {
    return { ok: true, entregue: false, situacao: 'PENDENTE', dataEntrega: null };
}

function mockDas() {
    return { ok: true, gerado: true, valorDas: 1850.00, pago: true };
}

function mockDefis() {
    return { ok: true, entregue: true, situacao: 'ENTREGUE' };
}

function mockParcelamentos(cnpj) {
    return {
        ok: true,
        parcelamentos: [
            { programa: 'REFIS/PERT', valorTotal: 85000.00, parcelas: 60, parcelasPagas: 24, status: 'ativo', dataInicio: '2023-06-01' },
        ],
        fonte: 'mock',
    };
}

// ─── Helpers de competência ─────────────────────────────────────────────────

function computarCompAnterior(comp) {
    const [ano, mes] = comp.split('-').map(Number);
    if (mes === 1) return `${ano - 1}-12`;
    return `${ano}-${String(mes - 1).padStart(2, '0')}`;
}

// ─── Consultas individuais por sistema SERPRO ──────────────────────────────

async function consultarDctfWeb(cnpj, competencia) {
    console.log(TAG, 'consultarDctfWeb', cnpj, competencia);
    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock DCTFWeb');
        return mockDctfWeb();
    }
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'CONSDECCOMPLETA33',
            contribuinteCnpj: cnpj,
            dados: { periodoApuracao: competencia.replace('-', '') },
        });
        return {
            ok: true,
            entregue: !!(resp?.situacao || '').match(/ENTREG/i),
            situacao: resp?.situacao || 'INDETERMINADA',
            dataEntrega: resp?.dataEntrega || resp?.dataTransmissao || null,
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarDctfWeb:', err.message);
        return { ok: false, entregue: false, situacao: 'indisponivel', erro: err.message };
    }
}

async function consultarESocial(cnpj, competencia) {
    console.log(TAG, 'consultarESocial', cnpj, competencia);
    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock eSocial');
        return mockESocial();
    }
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'ESOCIAL',
            idServico: 'CONSULTARFECHAMENTO',
            contribuinteCnpj: cnpj,
            dados: { periodoApuracao: competencia.replace('-', '') },
        });
        const sit = resp?.situacao || resp?.statusFechamento || '';
        return {
            ok: true,
            entregue: !!(sit).match(/TRANSMITID|FECHAD|ENTREG/i),
            situacao: sit || 'INDETERMINADA',
            dataEntrega: resp?.dataFechamento || resp?.dataTransmissao || null,
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarESocial:', err.message);
        return { ok: false, entregue: false, situacao: 'indisponivel', erro: err.message };
    }
}

async function consultarFgtsDigital(cnpj, competencia) {
    console.log(TAG, 'consultarFgtsDigital', cnpj, competencia);
    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock FGTS Digital');
        return mockFgtsDigital();
    }
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'FGTS',
            idServico: 'CONSULTARRECOLHIMENTO',
            contribuinteCnpj: cnpj,
            dados: { periodoApuracao: competencia.replace('-', '') },
        });
        const devido = Number(resp?.valorDevido || resp?.depositoDevido || 0);
        const realizado = Number(resp?.valorRecolhido || resp?.depositoRealizado || 0);
        return {
            ok: true,
            regular: realizado >= devido,
            depositoDevido: devido,
            depositoRealizado: realizado,
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarFgtsDigital:', err.message);
        return { ok: false, regular: false, depositoDevido: 0, depositoRealizado: 0, situacao: 'indisponivel', erro: err.message };
    }
}

async function consultarSpedFiscal(cnpj, competencia) {
    console.log(TAG, 'consultarSpedFiscal', cnpj, competencia);
    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock SPED Fiscal');
        return mockSpedFiscal();
    }
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'SPEDFISCAL',
            idServico: 'CONSULTARENTREGA',
            contribuinteCnpj: cnpj,
            dados: { periodoApuracao: competencia.replace('-', '') },
        });
        return {
            ok: true,
            entregue: !!(resp?.situacao || '').match(/ENTREG/i),
            situacao: resp?.situacao || 'INDETERMINADA',
            dataEntrega: resp?.dataEntrega || resp?.dataTransmissao || null,
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarSpedFiscal:', err.message);
        return { ok: false, entregue: false, situacao: 'indisponivel', erro: err.message };
    }
}

async function consultarSpedContribuicoes(cnpj, competencia) {
    console.log(TAG, 'consultarSpedContribuicoes', cnpj, competencia);
    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock SPED Contribuições');
        return mockSpedContribuicoes();
    }
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'SPEDCONTRIB',
            idServico: 'CONSULTARENTREGA',
            contribuinteCnpj: cnpj,
            dados: { periodoApuracao: competencia.replace('-', '') },
        });
        return {
            ok: true,
            entregue: !!(resp?.situacao || '').match(/ENTREG/i),
            situacao: resp?.situacao || 'INDETERMINADA',
            dataEntrega: resp?.dataEntrega || resp?.dataTransmissao || null,
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarSpedContribuicoes:', err.message);
        return { ok: false, entregue: false, situacao: 'indisponivel', erro: err.message };
    }
}

async function consultarEcd(cnpj, anoCalendario) {
    console.log(TAG, 'consultarEcd', cnpj, anoCalendario);
    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock ECD');
        return mockEcd();
    }
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'SPED',
            idServico: 'CONSULTARECD',
            contribuinteCnpj: cnpj,
            dados: { anoCalendario },
        });
        return {
            ok: true,
            entregue: !!(resp?.situacao || '').match(/ENTREG/i),
            situacao: resp?.situacao || 'INDETERMINADA',
            dataEntrega: resp?.dataEntrega || resp?.dataTransmissao || null,
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarEcd:', err.message);
        return { ok: false, entregue: false, situacao: 'indisponivel', erro: err.message };
    }
}

async function consultarEcf(cnpj, anoCalendario) {
    console.log(TAG, 'consultarEcf', cnpj, anoCalendario);
    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock ECF');
        return mockEcf();
    }
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'SPED',
            idServico: 'CONSULTARECF',
            contribuinteCnpj: cnpj,
            dados: { anoCalendario },
        });
        return {
            ok: true,
            entregue: !!(resp?.situacao || '').match(/ENTREG/i),
            situacao: resp?.situacao || 'INDETERMINADA',
            dataEntrega: resp?.dataEntrega || resp?.dataTransmissao || null,
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarEcf:', err.message);
        return { ok: false, entregue: false, situacao: 'indisponivel', erro: err.message };
    }
}

async function consultarDas(cnpj, competencia) {
    console.log(TAG, 'consultarDas', cnpj, competencia);
    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock DAS');
        return mockDas();
    }
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'PGDASD',
            idServico: 'GERARDAS21',
            contribuinteCnpj: cnpj,
            dados: { periodoApuracao: competencia.replace('-', '') },
        });
        return {
            ok: true,
            gerado: !!(resp?.valorApurado || resp?.valorDas),
            valorDas: Number(resp?.valorApurado || resp?.valorDas || 0),
            pago: !!(resp?.situacaoPagamento || '').match(/PAG|QUIT/i),
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarDas:', err.message);
        return { ok: false, gerado: false, valorDas: 0, pago: false, situacao: 'indisponivel', erro: err.message };
    }
}

async function consultarDefis(cnpj, anoCalendario) {
    console.log(TAG, 'consultarDefis', cnpj, anoCalendario);
    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock DEFIS');
        return mockDefis();
    }
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'PGDASD',
            idServico: 'CONSULTARDEFIS',
            contribuinteCnpj: cnpj,
            dados: { anoCalendario },
        });
        return {
            ok: true,
            entregue: !!(resp?.situacao || '').match(/ENTREG/i),
            situacao: resp?.situacao || 'INDETERMINADA',
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarDefis:', err.message);
        return { ok: false, entregue: false, situacao: 'indisponivel', erro: err.message };
    }
}

// ─── Situação Fiscal Federal ────────────────────────────────────────────────

export async function consultarSituacaoFiscal(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    console.log(TAG, 'consultarSituacaoFiscal', cnpjNum);

    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock situação fiscal');
        return mockSituacaoFiscal(cnpjNum);
    }

    try {
        const resp = await invokeIntegraContador({
            idSistema: 'SITFIS',
            idServico: 'CONSULTARSITUACAOFISCAL',
            contribuinteCnpj: cnpjNum,
            dados: {},
        });

        return {
            ok: true,
            situacao: resp?.situacaoFiscal || resp?.situacao || 'INDETERMINADA',
            pendencias: resp?.pendencias || [],
            debitos: (resp?.debitos || []).map(d => ({
                tributo: d.tributo || d.descricao || '',
                competencia: d.competencia || d.periodoApuracao || '',
                valorOriginal: Number(d.valorOriginal || d.valor || 0),
                status: d.situacao || 'aberto',
            })),
            ultimaConsulta: new Date().toISOString(),
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarSituacaoFiscal:', err.message);
        return erroEstruturado(err.message);
    }
}

// ─── Dívida Ativa / PGFN ───────────────────────────────────────────────────

export async function consultarDividaAtiva(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    console.log(TAG, 'consultarDividaAtiva', cnpjNum);

    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock dívida ativa');
        return mockDividaAtiva(cnpjNum);
    }

    try {
        const resp = await invokeIntegraContador({
            idSistema: 'PGFN',
            idServico: 'CONSULTARSITUACAOINSCRICAO',
            contribuinteCnpj: cnpjNum,
            dados: {},
        });

        const inscricoes = (resp?.inscricoes || []).map(i => ({
            numero: i.numeroInscricao || i.numero || '',
            valorConsolidado: Number(i.valorConsolidado || i.valor || 0),
            situacao: i.situacao || 'ATIVA',
            dataInscricao: i.dataInscricao || '',
        }));

        return {
            ok: true,
            inscricoes,
            valorTotal: inscricoes.reduce((s, i) => s + i.valorConsolidado, 0),
            parcelamentos: resp?.parcelamentos || [],
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarDividaAtiva:', err.message);
        return erroEstruturado(err.message);
    }
}

// ─── Certidões (CND/CPEN/CPN) — Consulta automatizada por tipo ─────────────

/**
 * Parse a raw SERPRO CND response into a normalised object.
 */
function parseCndResponse(resp) {
    const status = normalizarStatusCertidao(resp?.situacao || resp?.status || resp?.resultado);
    return {
        ok: true,
        status,
        validade: resp?.dataValidade || resp?.validade || resp?.dtValidade || null,
        motivo: resp?.motivoImpedimento || resp?.motivo || resp?.descricao || null,
        numero: resp?.numeroCertidao || resp?.numero || null,
        dataEmissao: resp?.dataEmissao || null,
        pdfBase64: resp?.pdfCertidao || resp?.pdf || resp?.arquivo || null,
    };
}

/**
 * Build a certidão entry from a Promise.allSettled result.
 */
function extrairCertidao(settled, esfera, orgao, tipo) {
    if (settled.status === 'fulfilled' && settled.value?.ok) {
        const v = settled.value;
        return {
            esfera, orgao, tipo,
            status: v.status,
            validade: v.validade,
            motivo: v.motivo,
            numero: v.numero,
            dataEmissao: v.dataEmissao,
            pdfBase64: v.pdfBase64,
            fonte: 'serpro',
        };
    }
    const reason = settled.status === 'rejected'
        ? settled.reason?.message
        : settled.value?.erro || settled.value?.motivo || 'Serviço indisponível';
    return {
        esfera, orgao, tipo,
        status: 'indisponivel',
        validade: null,
        motivo: reason || 'Erro ao consultar via SERPRO',
        fonte: 'serpro',
    };
}

/**
 * CND Federal (Tributos + Dívida Ativa da União) — RFB/PGFN.
 * SERPRO idSistema: CERTIDOES / EMITIRCNDFEDERAL
 */
async function consultarCndFederalSerpro(cnpj) {
    console.log(TAG, 'consultarCndFederalSerpro', cnpj);
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'CERTIDOES',
            idServico: 'EMITIRCNDFEDERAL',
            contribuinteCnpj: cnpj,
            dados: {},
        });
        return parseCndResponse(resp);
    } catch (err) {
        console.error(TAG, 'CND Federal SERPRO erro:', err.message);
        // Fallback: try the generic CONSULTARCERTIDAO with esfera
        try {
            const resp2 = await invokeIntegraContador({
                idSistema: 'CERTIDOES',
                idServico: 'CONSULTARCERTIDAO',
                contribuinteCnpj: cnpj,
                dados: { esfera: 'federal' },
            });
            return parseCndResponse(resp2);
        } catch (err2) {
            console.error(TAG, 'CND Federal fallback erro:', err2.message);
            return { ok: false, erro: err2.message };
        }
    }
}

/**
 * CRF (Certificado de Regularidade do FGTS) — Caixa Econômica Federal.
 * SERPRO idSistema: FGTS / CONSULTARCRF
 */
async function consultarCrfFgtsSerpro(cnpj) {
    console.log(TAG, 'consultarCrfFgtsSerpro', cnpj);
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'FGTS',
            idServico: 'CONSULTARCRF',
            contribuinteCnpj: cnpj,
            dados: {},
        });
        return parseCndResponse(resp);
    } catch (err) {
        console.error(TAG, 'CRF FGTS SERPRO erro:', err.message);
        // Fallback: try via CERTIDOES
        try {
            const resp2 = await invokeIntegraContador({
                idSistema: 'CERTIDOES',
                idServico: 'EMITIRCRF',
                contribuinteCnpj: cnpj,
                dados: {},
            });
            return parseCndResponse(resp2);
        } catch (err2) {
            console.error(TAG, 'CRF FGTS fallback erro:', err2.message);
            return { ok: false, erro: err2.message };
        }
    }
}

/**
 * CNDT (Certidão Negativa de Débitos Trabalhistas) — TST.
 * SERPRO idSistema: CERTIDOES / EMITIRCNDT
 */
async function consultarCndtTrabalhistaSerpro(cnpj) {
    console.log(TAG, 'consultarCndtTrabalhistaSerpro', cnpj);
    try {
        const resp = await invokeIntegraContador({
            idSistema: 'CERTIDOES',
            idServico: 'EMITIRCNDT',
            contribuinteCnpj: cnpj,
            dados: {},
        });
        return parseCndResponse(resp);
    } catch (err) {
        console.error(TAG, 'CNDT SERPRO erro:', err.message);
        // Fallback: try the generic CONSULTARCERTIDAO with esfera
        try {
            const resp2 = await invokeIntegraContador({
                idSistema: 'CERTIDOES',
                idServico: 'CONSULTARCERTIDAO',
                contribuinteCnpj: cnpj,
                dados: { esfera: 'trabalhista' },
            });
            return parseCndResponse(resp2);
        } catch (err2) {
            console.error(TAG, 'CNDT fallback erro:', err2.message);
            return { ok: false, erro: err2.message };
        }
    }
}

export async function consultarCertidoes(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    console.log(TAG, 'consultarCertidoes', cnpjNum);

    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock certidões');
        return mockCertidoes(cnpjNum);
    }

    // Query each CND type in parallel via SERPRO-specific endpoints
    const [cndFederal, crfFgts, cndtTrabalhista] = await Promise.allSettled([
        consultarCndFederalSerpro(cnpjNum),
        consultarCrfFgtsSerpro(cnpjNum),
        consultarCndtTrabalhistaSerpro(cnpjNum),
    ]);

    const certidoes = [
        extrairCertidao(cndFederal, 'federal', 'Receita Federal / PGFN', 'CND Federal'),
        extrairCertidao(crfFgts, 'fgts', 'Caixa Econômica Federal', 'CRF (FGTS)'),
        extrairCertidao(cndtTrabalhista, 'trabalhista', 'Justiça do Trabalho (TST)', 'CNDT (Trabalhista)'),
        // Estadual and Municipal — no standard SERPRO API, require manual portal access
        {
            esfera: 'estadual', orgao: 'Sefaz Estadual', tipo: 'CND Estadual (ICMS)',
            status: 'nao_consultada', motivo: 'Consulta manual via portal da SEFAZ do estado',
            fonte: 'manual',
        },
        {
            esfera: 'municipal', orgao: 'Prefeitura Municipal', tipo: 'CND Municipal (ISS)',
            status: 'nao_consultada', motivo: 'Consulta manual via portal da prefeitura',
            fonte: 'manual',
        },
    ];

    return { ok: true, certidoes, fonte: 'serpro' };
}

function normalizarStatusCertidao(raw) {
    if (!raw) return 'nao_consultada';
    const s = String(raw).toUpperCase();
    if (s.includes('NEGATIVA') && s.includes('EFEITO')) return 'positiva_efeitos_negativa';
    if (s.includes('NEGATIVA')) return 'negativa';
    if (s.includes('POSITIVA')) return 'positiva';
    if (s.includes('REGULAR') && !s.includes('IRREGULAR')) return 'negativa';
    if (s.includes('IRREGULAR')) return 'positiva';
    return 'indisponivel';
}

// ─── Obrigações Acessórias ──────────────────────────────────────────────────

export async function consultarObrigacoes(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    console.log(TAG, 'consultarObrigacoes', cnpjNum);

    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock obrigações');
        return mockObrigacoes(cnpjNum);
    }

    try {
        const resp = await invokeIntegraContador({
            idSistema: 'SITFIS',
            idServico: 'CONSULTAROBRIGACOES',
            contribuinteCnpj: cnpjNum,
            dados: {},
        });

        return {
            ok: true,
            obrigacoes: (resp?.obrigacoes || []).map(o => ({
                nome: o.nomeObrigacao || o.nome || '',
                sigla: o.sigla || '',
                competencia: o.competencia || o.periodoApuracao || '',
                status: normalizarStatusObrigacao(o.situacao || o.status),
            })),
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarObrigacoes:', err.message);
        return erroEstruturado(err.message);
    }
}

function normalizarStatusObrigacao(raw) {
    if (!raw) return 'nao_verificada';
    const s = String(raw).toUpperCase();
    if (s.includes('ENTREG')) return 'entregue';
    if (s.includes('PENDEN')) return 'pendente';
    if (s.includes('ATRAS')) return 'atrasada';
    if (s.includes('DISPENS')) return 'dispensada';
    return 'nao_verificada';
}

// ─── Parcelamentos vigentes ─────────────────────────────────────────────────

export async function consultarParcelamentos(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    console.log(TAG, 'consultarParcelamentos', cnpjNum);

    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock parcelamentos');
        return mockParcelamentos(cnpjNum);
    }

    try {
        const resp = await invokeIntegraContador({
            idSistema: 'PGFN',
            idServico: 'CONSULTARPARCELAMENTO',
            contribuinteCnpj: cnpjNum,
            dados: {},
        });

        return {
            ok: true,
            parcelamentos: (resp?.parcelamentos || []).map(p => ({
                programa: p.programa || p.nomePrograma || '',
                valorTotal: Number(p.valorTotal || p.valorConsolidado || 0),
                parcelas: Number(p.quantidadeParcelas || p.parcelas || 0),
                parcelasPagas: Number(p.parcelasPagas || 0),
                status: normalizarStatusParcelamento(p.situacao || p.status),
                dataInicio: p.dataAdesao || p.dataInicio || '',
            })),
        };
    } catch (err) {
        console.error(TAG, 'Erro consultarParcelamentos:', err.message);
        return erroEstruturado(err.message);
    }
}

function normalizarStatusParcelamento(raw) {
    if (!raw) return 'ativo';
    const s = String(raw).toUpperCase();
    if (s.includes('ATIV') || s.includes('REGULAR')) return 'ativo';
    if (s.includes('INADIMP') || s.includes('IRREGULAR')) return 'inadimplente';
    if (s.includes('QUIT')) return 'quitado';
    if (s.includes('CANCEL') || s.includes('RESCIND')) return 'cancelado';
    return 'ativo';
}

// ─── Análise Completa (parametrizada por regime) ───────────────────────────

export async function analisarEmpresaCompleta(cnpj, regime = 'lucro_presumido') {
    const cnpjNum = cnpjLimpo(cnpj);
    console.log(TAG, 'analisarEmpresaCompleta', cnpjNum, 'regime:', regime);

    const now = new Date();
    const competenciaAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const competenciaAnterior = computarCompAnterior(competenciaAtual);
    const anoCalendarioAnterior = String(now.getFullYear() - 1);

    const extrair = (result) => {
        if (result.status === 'fulfilled') return result.value;
        return erroEstruturado(result.reason?.message || 'Erro desconhecido');
    };

    // Always query these (all regimes)
    const baseQueries = [
        consultarSituacaoFiscal(cnpjNum),
        consultarDividaAtiva(cnpjNum),
        consultarCertidoes(cnpjNum),
        consultarParcelamentos(cnpjNum),
    ];

    // Regime-specific obligation queries
    const obrigQueries = [];

    if (regime !== 'mei') {
        obrigQueries.push(
            consultarDctfWeb(cnpjNum, competenciaAnterior).then(r => ({ sigla: 'DCTFWeb', competencia: competenciaAnterior, ...r })),
            consultarESocial(cnpjNum, competenciaAnterior).then(r => ({ sigla: 'eSocial', competencia: competenciaAnterior, ...r })),
            consultarFgtsDigital(cnpjNum, competenciaAnterior).then(r => ({ sigla: 'FGTS Digital', competencia: competenciaAnterior, ...r })),
        );
    }

    if (regime === 'simples_nacional') {
        obrigQueries.push(
            consultarDas(cnpjNum, competenciaAnterior).then(r => ({ sigla: 'DAS', competencia: competenciaAnterior, ...r })),
            consultarDefis(cnpjNum, anoCalendarioAnterior).then(r => ({ sigla: 'DEFIS', competencia: anoCalendarioAnterior, ...r })),
        );
    }

    if (regime === 'lucro_presumido' || regime === 'lucro_real') {
        obrigQueries.push(
            consultarEcd(cnpjNum, anoCalendarioAnterior).then(r => ({ sigla: 'ECD', competencia: anoCalendarioAnterior, ...r })),
            consultarEcf(cnpjNum, anoCalendarioAnterior).then(r => ({ sigla: 'ECF', competencia: anoCalendarioAnterior, ...r })),
            consultarSpedContribuicoes(cnpjNum, competenciaAnterior).then(r => ({ sigla: 'SPED Contribuicoes', competencia: competenciaAnterior, ...r })),
            consultarSpedFiscal(cnpjNum, competenciaAnterior).then(r => ({ sigla: 'SPED Fiscal', competencia: competenciaAnterior, ...r })),
        );
    }

    // Run all in parallel
    const [baseResults, obrigResults] = await Promise.all([
        Promise.allSettled(baseQueries),
        Promise.allSettled(obrigQueries),
    ]);

    // Extract base results
    const [situacaoR, dividaR, certidoesR, parcelamentosR] = baseResults;

    // Build obrigacoes from individual system queries
    const obrigacoes = obrigResults.map(r => {
        if (r.status === 'fulfilled') return r.value;
        return { sigla: '?', ok: false, entregue: false, situacao: 'indisponivel' };
    }).map(o => ({
        nome: o.sigla === 'DAS' ? 'DAS Simples Nacional' : o.sigla,
        sigla: o.sigla,
        competencia: o.competencia || competenciaAnterior,
        status: o.entregue ? 'entregue' : o.regular ? 'entregue' : o.gerado ? (o.pago ? 'entregue' : 'pendente') : 'pendente',
    }));

    return {
        ok: true,
        cnpj: cnpjNum,
        regime,
        consultadoEm: new Date().toISOString(),
        situacaoFiscal: extrair(situacaoR),
        dividaAtiva: extrair(dividaR),
        certidoes: extrair(certidoesR),
        obrigacoes: { ok: true, obrigacoes },
        parcelamentos: extrair(parcelamentosR),
    };
}
