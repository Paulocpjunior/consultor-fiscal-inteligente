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
    return {
        ok: true,
        certidoes: [
            { esfera: 'federal', status: 'negativa', validade: '2026-08-20', motivo: null },
            { esfera: 'estadual', status: 'positiva_efeitos_negativa', validade: '2026-07-15', motivo: 'Parcelamento ativo' },
            { esfera: 'trabalhista', status: 'negativa', validade: '2026-09-01', motivo: null },
            { esfera: 'fgts', status: 'positiva', validade: null, motivo: 'Recolhimento em atraso competência 03/2025' },
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

function mockParcelamentos(cnpj) {
    return {
        ok: true,
        parcelamentos: [
            { programa: 'REFIS/PERT', valorTotal: 85000.00, parcelas: 60, parcelasPagas: 24, status: 'ativo', dataInicio: '2023-06-01' },
        ],
        fonte: 'mock',
    };
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

// ─── Certidões (CND/CPEN/CPN) ──────────────────────────────────────────────

const ESFERAS_CERTIDAO = ['federal', 'estadual', 'trabalhista', 'fgts'];

export async function consultarCertidoes(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    console.log(TAG, 'consultarCertidoes', cnpjNum);

    if (DRY_RUN) {
        console.log(TAG, 'DRY_RUN ativo — retornando mock certidões');
        return mockCertidoes(cnpjNum);
    }

    const certidoes = [];

    for (const esfera of ESFERAS_CERTIDAO) {
        try {
            const resp = await invokeIntegraContador({
                idSistema: 'CERTIDOES',
                idServico: 'CONSULTARCERTIDAO',
                contribuinteCnpj: cnpjNum,
                dados: { esfera },
            });

            certidoes.push({
                esfera,
                status: normalizarStatusCertidao(resp?.situacao || resp?.status),
                validade: resp?.dataValidade || resp?.validade || null,
                motivo: resp?.motivoImpedimento || resp?.motivo || null,
            });
        } catch (err) {
            console.error(TAG, `Erro certidão ${esfera}:`, err.message);
            certidoes.push({
                esfera,
                status: 'indisponivel',
                validade: null,
                motivo: err.message,
            });
        }
    }

    return { ok: true, certidoes };
}

function normalizarStatusCertidao(raw) {
    if (!raw) return 'nao_consultada';
    const s = String(raw).toUpperCase();
    if (s.includes('NEGATIVA') && s.includes('EFEITO')) return 'positiva_efeitos_negativa';
    if (s.includes('NEGATIVA')) return 'negativa';
    if (s.includes('POSITIVA')) return 'positiva';
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

// ─── Análise Completa ───────────────────────────────────────────────────────

export async function analisarEmpresaCompleta(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    console.log(TAG, 'analisarEmpresaCompleta', cnpjNum);

    const [
        situacaoResult,
        dividaResult,
        certidoesResult,
        obrigacoesResult,
        parcelamentosResult,
    ] = await Promise.allSettled([
        consultarSituacaoFiscal(cnpjNum),
        consultarDividaAtiva(cnpjNum),
        consultarCertidoes(cnpjNum),
        consultarObrigacoes(cnpjNum),
        consultarParcelamentos(cnpjNum),
    ]);

    const extrair = (result) => {
        if (result.status === 'fulfilled') return result.value;
        return erroEstruturado(result.reason?.message || 'Erro desconhecido');
    };

    const situacao = extrair(situacaoResult);
    const divida = extrair(dividaResult);
    const certidoes = extrair(certidoesResult);
    const obrigacoes = extrair(obrigacoesResult);
    const parcelamentos = extrair(parcelamentosResult);

    return {
        ok: true,
        cnpj: cnpjNum,
        consultadoEm: new Date().toISOString(),
        situacaoFiscal: situacao,
        dividaAtiva: divida,
        certidoes,
        obrigacoes,
        parcelamentos,
    };
}
