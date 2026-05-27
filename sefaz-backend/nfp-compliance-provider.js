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
