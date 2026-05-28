// ============================================================================
// sefaz-backend/cnd-publica-provider.js
//
// Consulta CNDs públicas (não requerem certificado digital nem procuração).
// Fontes:
//   1. CND Federal (RFB/PGFN) — servicos.receita.fazenda.gov.br
//   2. CRF FGTS (CEF) — consulta-crf.caixa.gov.br
//   3. CNDT Trabalhista (TST) — www.tst.jus.br
//   4. Consulta Optante Simples — www8.receita.fazenda.gov.br
//
// Todas são consultas GET/POST públicas. Timeout de 15s por consulta.
// Falhas são silenciosas (retornam status 'indisponivel').
// ============================================================================

const TIMEOUT = 15000;

function cnpjLimpo(cnpj) {
    return (cnpj || '').replace(/\D/g, '');
}

/**
 * Tenta consultar a CND Federal (Certidão de Débitos Relativos a
 * Créditos Tributários Federais e à Dívida Ativa da União).
 *
 * A API pública da RFB retorna HTML — fazemos scraping básico do resultado.
 */
async function consultarCndFederal(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    try {
        const url = `https://solucoes.receita.fazenda.gov.br/servicos/certidaointernet/cndt/emitir`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'ConsultorFiscal/1.0',
            },
            body: `NI=${cnpjNum}`,
            signal: AbortSignal.timeout(TIMEOUT),
        });

        if (!resp.ok) {
            return { esfera: 'federal', orgao: 'Receita Federal / PGFN', tipo: 'CND Federal', status: 'indisponivel', motivo: `HTTP ${resp.status}` };
        }

        const html = await resp.text();

        if (/certid[aã]o\s+negativa/i.test(html) && !/positiva/i.test(html)) {
            const validade = html.match(/v[aá]lida\s+at[eé]\s+(\d{2}\/\d{2}\/\d{4})/i);
            return {
                esfera: 'federal', orgao: 'Receita Federal / PGFN', tipo: 'CND Federal',
                status: 'negativa',
                validade: validade ? parseDataBR(validade[1]) : null,
                fonte: 'consulta_publica',
            };
        }
        if (/positiva\s+com\s+efeitos?\s+de\s+negativa/i.test(html)) {
            const validade = html.match(/v[aá]lida\s+at[eé]\s+(\d{2}\/\d{2}\/\d{4})/i);
            return {
                esfera: 'federal', orgao: 'Receita Federal / PGFN', tipo: 'CND Federal',
                status: 'positiva_efeitos_negativa',
                validade: validade ? parseDataBR(validade[1]) : null,
                motivo: 'Parcelamento ou suspensão de exigibilidade',
                fonte: 'consulta_publica',
            };
        }
        if (/positiva/i.test(html)) {
            return {
                esfera: 'federal', orgao: 'Receita Federal / PGFN', tipo: 'CND Federal',
                status: 'positiva',
                motivo: 'Débitos pendentes junto à RFB ou PGFN',
                fonte: 'consulta_publica',
            };
        }

        return { esfera: 'federal', orgao: 'Receita Federal / PGFN', tipo: 'CND Federal', status: 'indisponivel', motivo: 'Resposta não identificada', fonte: 'consulta_publica' };
    } catch (err) {
        console.warn('[cnd-publica] CND Federal falhou:', err.message);
        return { esfera: 'federal', orgao: 'Receita Federal / PGFN', tipo: 'CND Federal', status: 'indisponivel', motivo: err.message, fonte: 'consulta_publica' };
    }
}

/**
 * Consulta CRF (Certificado de Regularidade do FGTS) via CEF.
 */
async function consultarCrfFgts(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    try {
        const url = `https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'ConsultorFiscal/1.0',
            },
            body: `inscricao=${cnpjNum}&consultar=Consultar`,
            signal: AbortSignal.timeout(TIMEOUT),
        });

        if (!resp.ok) {
            return { esfera: 'fgts', orgao: 'Caixa Econômica Federal', tipo: 'CRF (FGTS)', status: 'indisponivel', motivo: `HTTP ${resp.status}`, fonte: 'consulta_publica' };
        }

        const html = await resp.text();

        if (/regular/i.test(html) && !/irregular/i.test(html)) {
            const validade = html.match(/v[aá]lid[oa]\s+at[eé]\s+(\d{2}\/\d{2}\/\d{4})/i);
            return {
                esfera: 'fgts', orgao: 'Caixa Econômica Federal', tipo: 'CRF (FGTS)',
                status: 'negativa',
                validade: validade ? parseDataBR(validade[1]) : null,
                fonte: 'consulta_publica',
            };
        }
        if (/irregular/i.test(html)) {
            return {
                esfera: 'fgts', orgao: 'Caixa Econômica Federal', tipo: 'CRF (FGTS)',
                status: 'positiva',
                motivo: 'Recolhimento FGTS irregular',
                fonte: 'consulta_publica',
            };
        }

        return { esfera: 'fgts', orgao: 'Caixa Econômica Federal', tipo: 'CRF (FGTS)', status: 'indisponivel', motivo: 'Resposta não identificada', fonte: 'consulta_publica' };
    } catch (err) {
        console.warn('[cnd-publica] CRF FGTS falhou:', err.message);
        return { esfera: 'fgts', orgao: 'Caixa Econômica Federal', tipo: 'CRF (FGTS)', status: 'indisponivel', motivo: err.message, fonte: 'consulta_publica' };
    }
}

/**
 * Consulta CNDT (Certidão Negativa de Débitos Trabalhistas) via TST.
 */
async function consultarCndtTrabalhista(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    try {
        const url = `https://cndt-certidao.tst.jus.br/gerarCertidao`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'ConsultorFiscal/1.0',
            },
            body: `tipoCertidao=2&txtCnpj=${cnpjNum}`,
            signal: AbortSignal.timeout(TIMEOUT),
        });

        if (!resp.ok) {
            return { esfera: 'trabalhista', orgao: 'Justiça do Trabalho (TST)', tipo: 'CNDT (Trabalhista)', status: 'indisponivel', motivo: `HTTP ${resp.status}`, fonte: 'consulta_publica' };
        }

        const html = await resp.text();

        if (/certid[aã]o\s+negativa/i.test(html) && !/positiva/i.test(html)) {
            const validade = html.match(/v[aá]lid[oa]\s+at[eé][\s:]+(\d{2}\/\d{2}\/\d{4})/i);
            return {
                esfera: 'trabalhista', orgao: 'Justiça do Trabalho (TST)', tipo: 'CNDT (Trabalhista)',
                status: 'negativa',
                validade: validade ? parseDataBR(validade[1]) : null,
                fonte: 'consulta_publica',
            };
        }
        if (/positiva/i.test(html)) {
            return {
                esfera: 'trabalhista', orgao: 'Justiça do Trabalho (TST)', tipo: 'CNDT (Trabalhista)',
                status: 'positiva',
                motivo: 'Débitos trabalhistas registrados',
                fonte: 'consulta_publica',
            };
        }

        return { esfera: 'trabalhista', orgao: 'Justiça do Trabalho (TST)', tipo: 'CNDT (Trabalhista)', status: 'indisponivel', motivo: 'Resposta não identificada', fonte: 'consulta_publica' };
    } catch (err) {
        console.warn('[cnd-publica] CNDT falhou:', err.message);
        return { esfera: 'trabalhista', orgao: 'Justiça do Trabalho (TST)', tipo: 'CNDT (Trabalhista)', status: 'indisponivel', motivo: err.message, fonte: 'consulta_publica' };
    }
}

/**
 * Consulta se é optante pelo Simples Nacional via RFB.
 */
async function consultarOptanteSimples(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    try {
        const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjNum}`, {
            headers: { 'User-Agent': 'ConsultorFiscal/1.0' },
            signal: AbortSignal.timeout(TIMEOUT),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        return {
            optanteSimples: data.opcao_simples === true,
            optanteMei: data.opcao_mei === true,
            situacaoCadastral: data.descricao_situacao_cadastral || data.situacao || '',
            porte: data.porte || '',
            naturezaJuridica: data.natureza_juridica || '',
        };
    } catch {
        return null;
    }
}

function parseDataBR(dataBR) {
    if (!dataBR) return null;
    const m = dataBR.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
}

// URLs oficiais para consulta manual quando a automação falha (CAPTCHA)
const URLS_PORTAIS = {
    cnd_federal: 'https://solucoes.receita.fazenda.gov.br/Servicos/certidaointernet/PJ/Emitir',
    crf_fgts: 'https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf',
    cndt: 'https://cndt-certidao.tst.jus.br/inicio.faces',
};

/**
 * Consulta todas as CNDs públicas em paralelo.
 * Sempre inclui portalUrl pra consulta manual quando indisponivel.
 */
export async function consultarCndsPublicas(cnpj) {
    const cnpjNum = cnpjLimpo(cnpj);
    console.log('[cnd-publica] Consultando CNDs para CNPJ', cnpjNum);

    const [cndFederal, crfFgts, cndtTrabalhista, optanteSimples] = await Promise.allSettled([
        consultarCndFederal(cnpjNum),
        consultarCrfFgts(cnpjNum),
        consultarCndtTrabalhista(cnpjNum),
        consultarOptanteSimples(cnpjNum),
    ]);

    const cndFedRes = cndFederal.status === 'fulfilled' ? cndFederal.value : { esfera: 'federal', orgao: 'Receita Federal / PGFN', tipo: 'CND Federal', status: 'indisponivel', fonte: 'consulta_publica' };
    const crfRes = crfFgts.status === 'fulfilled' ? crfFgts.value : { esfera: 'fgts', orgao: 'Caixa Econômica Federal', tipo: 'CRF (FGTS)', status: 'indisponivel', fonte: 'consulta_publica' };
    const cndtRes = cndtTrabalhista.status === 'fulfilled' ? cndtTrabalhista.value : { esfera: 'trabalhista', orgao: 'Justiça do Trabalho (TST)', tipo: 'CNDT (Trabalhista)', status: 'indisponivel', fonte: 'consulta_publica' };

    // Adiciona portalUrl em cada CND para consulta manual
    cndFedRes.portalUrl = URLS_PORTAIS.cnd_federal;
    crfRes.portalUrl = URLS_PORTAIS.crf_fgts;
    cndtRes.portalUrl = URLS_PORTAIS.cndt;

    // Mensagem clara quando indisponivel automaticamente
    if (cndFedRes.status === 'indisponivel') {
        cndFedRes.motivo = 'Portal RFB usa CAPTCHA — consulte manualmente';
    }
    if (cndtRes.status === 'indisponivel') {
        cndtRes.motivo = 'Portal TST usa CAPTCHA — consulte manualmente';
    }

    const certidoes = [cndFedRes, crfRes, cndtRes];
    const dadosSimples = optanteSimples.status === 'fulfilled' ? optanteSimples.value : null;

    return { certidoes, dadosSimples };
}
