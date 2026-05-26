/**
 * NFP Tax Rules Engine
 *
 * Given a CNAE and taxation regime, determines which certidoes, obrigacoes,
 * and impostos are required for a company.
 */

export type RegimeTributario = 'simples_nacional' | 'lucro_presumido' | 'lucro_real' | 'mei';
export type AtividadeTipo = 'comercio' | 'industria' | 'servico' | 'misto';

export interface TaxProfile {
    regime: RegimeTributario;
    atividadeTipo: AtividadeTipo;
    cnae: string;
    descricaoCnae: string;

    certidoesObrigatorias: { esfera: string; tipo: string; orgao: string }[];
    obrigacoesObrigatorias: { sigla: string; nome: string; esfera: string; periodicidade: string }[];
    impostosAplicaveis: { nome: string; esfera: string; aliquotaBase?: string }[];

    observacoes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the atividade type implies ICMS incidence. */
function temIcms(at: AtividadeTipo): boolean {
    return at === 'comercio' || at === 'industria' || at === 'misto';
}

/** Returns true when the atividade type implies ISS incidence. */
function temIss(at: AtividadeTipo): boolean {
    return at === 'servico' || at === 'misto';
}

// ---------------------------------------------------------------------------
// Public: infer atividade from CNAE
// ---------------------------------------------------------------------------

/**
 * Infers the activity type based on the first two digits of the CNAE code.
 *
 * Rules:
 *  - 01-09, 10-33       -> industria
 *  - 45-47              -> comercio
 *  - 41-43              -> misto (construcao)
 *  - 49-99              -> servico
 *  - Default / invalid  -> misto
 */
export function inferirAtividadePorCnae(cnae: string): AtividadeTipo {
    const clean = (cnae || '').replace(/\D/g, '');
    if (clean.length < 2) return 'misto';

    const prefix = parseInt(clean.slice(0, 2), 10);
    if (Number.isNaN(prefix)) return 'misto';

    if (prefix >= 1 && prefix <= 33) return 'industria';
    if (prefix >= 41 && prefix <= 43) return 'misto';       // construcao civil
    if (prefix >= 45 && prefix <= 47) return 'comercio';
    if (prefix >= 49 && prefix <= 99) return 'servico';

    return 'misto';
}

// ---------------------------------------------------------------------------
// Public: infer regime from EmpresaXmlOption.fonte
// ---------------------------------------------------------------------------

/**
 * Derives a RegimeTributario from the `fonte` field of EmpresaXmlOption
 * and an optional `regimePadrao` label.
 */
export function inferirRegimePorFonte(
    fonte: 'simples' | 'lucro',
    regimePadrao?: string,
): RegimeTributario {
    if (fonte === 'simples') return 'simples_nacional';
    // fonte === 'lucro'
    const upper = (regimePadrao || '').toUpperCase();
    if (upper.includes('REAL')) return 'lucro_real';
    // Default to presumido when lucro and no explicit indicator
    return 'lucro_presumido';
}

// ---------------------------------------------------------------------------
// Internal builders
// ---------------------------------------------------------------------------

function buildCertidoes(at: AtividadeTipo): TaxProfile['certidoesObrigatorias'] {
    const list: TaxProfile['certidoesObrigatorias'] = [
        { esfera: 'federal', tipo: 'CND Federal', orgao: 'Receita Federal / PGFN' },
        { esfera: 'federal', tipo: 'CNDT (Trabalhista)', orgao: 'Justica do Trabalho (TST)' },
        { esfera: 'federal', tipo: 'CRF (FGTS)', orgao: 'Caixa Economica Federal' },
    ];
    if (temIcms(at)) {
        list.push({ esfera: 'estadual', tipo: 'CND Estadual', orgao: 'Sefaz Estadual (ICMS)' });
    }
    if (temIss(at)) {
        list.push({ esfera: 'municipal', tipo: 'CND Municipal', orgao: 'Prefeitura Municipal (ISS)' });
    }
    return list;
}

function buildObrigacoes(
    regime: RegimeTributario,
    at: AtividadeTipo,
): TaxProfile['obrigacoesObrigatorias'] {
    const list: TaxProfile['obrigacoesObrigatorias'] = [];

    switch (regime) {
        case 'mei':
            list.push({ sigla: 'DASN-SIMEI', nome: 'DASN-SIMEI', esfera: 'federal', periodicidade: 'anual' });
            break;

        case 'simples_nacional':
            list.push(
                { sigla: 'DCTFWeb', nome: 'DCTFWeb', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'eSocial', nome: 'eSocial', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'FGTS Digital', nome: 'FGTS Digital', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'DEFIS', nome: 'DEFIS', esfera: 'federal', periodicidade: 'anual' },
                { sigla: 'DIRF', nome: 'DIRF', esfera: 'federal', periodicidade: 'anual' },
            );
            break;

        case 'lucro_presumido':
            list.push(
                { sigla: 'DCTFWeb', nome: 'DCTFWeb', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'ECD', nome: 'Escrituracao Contabil Digital', esfera: 'federal', periodicidade: 'anual' },
                { sigla: 'ECF', nome: 'Escrituracao Contabil Fiscal', esfera: 'federal', periodicidade: 'anual' },
                { sigla: 'SPED Contribuicoes', nome: 'SPED Contribuicoes', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'eSocial', nome: 'eSocial', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'FGTS Digital', nome: 'FGTS Digital', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'DIRF', nome: 'DIRF', esfera: 'federal', periodicidade: 'anual' },
                { sigla: 'RAIS', nome: 'RAIS', esfera: 'federal', periodicidade: 'anual' },
            );
            if (temIcms(at)) {
                list.push(
                    { sigla: 'SPED Fiscal', nome: 'SPED Fiscal (EFD ICMS/IPI)', esfera: 'estadual', periodicidade: 'mensal' },
                    { sigla: 'GIA', nome: 'GIA', esfera: 'estadual', periodicidade: 'mensal' },
                );
            }
            break;

        case 'lucro_real':
            list.push(
                { sigla: 'DCTFWeb', nome: 'DCTFWeb', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'DCTF', nome: 'DCTF', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'ECD', nome: 'Escrituracao Contabil Digital', esfera: 'federal', periodicidade: 'anual' },
                { sigla: 'ECF', nome: 'Escrituracao Contabil Fiscal', esfera: 'federal', periodicidade: 'anual' },
                { sigla: 'SPED Fiscal', nome: 'SPED Fiscal (EFD ICMS/IPI)', esfera: 'estadual', periodicidade: 'mensal' },
                { sigla: 'SPED Contribuicoes', nome: 'SPED Contribuicoes', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'eSocial', nome: 'eSocial', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'FGTS Digital', nome: 'FGTS Digital', esfera: 'federal', periodicidade: 'mensal' },
                { sigla: 'DIRF', nome: 'DIRF', esfera: 'federal', periodicidade: 'anual' },
                { sigla: 'RAIS', nome: 'RAIS', esfera: 'federal', periodicidade: 'anual' },
            );
            if (at === 'industria') {
                list.push({ sigla: 'DIPI', nome: 'Declaracao IPI', esfera: 'federal', periodicidade: 'mensal' });
            }
            break;
    }

    return list;
}

function buildImpostos(
    regime: RegimeTributario,
    at: AtividadeTipo,
): TaxProfile['impostosAplicaveis'] {
    const list: TaxProfile['impostosAplicaveis'] = [];

    switch (regime) {
        case 'mei':
            list.push({ nome: 'DAS-MEI', esfera: 'federal', aliquotaBase: 'Fixo mensal (INSS + ICMS/ISS)' });
            break;

        case 'simples_nacional':
            list.push({ nome: 'DAS', esfera: 'federal', aliquotaBase: 'Unificado mensal (aliquota efetiva conforme Anexo)' });
            break;

        case 'lucro_presumido':
            list.push(
                { nome: 'IRPJ', esfera: 'federal', aliquotaBase: '15% + adicional 10% (trimestral)' },
                { nome: 'CSLL', esfera: 'federal', aliquotaBase: '9% (trimestral)' },
                { nome: 'PIS', esfera: 'federal', aliquotaBase: '0,65% (cumulativo)' },
                { nome: 'COFINS', esfera: 'federal', aliquotaBase: '3% (cumulativo)' },
            );
            if (temIcms(at)) {
                list.push({ nome: 'ICMS', esfera: 'estadual', aliquotaBase: 'Variavel por UF e produto' });
            }
            if (temIss(at)) {
                list.push({ nome: 'ISS', esfera: 'municipal', aliquotaBase: '2% a 5% conforme municipio' });
            }
            break;

        case 'lucro_real':
            list.push(
                { nome: 'IRPJ', esfera: 'federal', aliquotaBase: '15% + adicional 10% (trimestral/anual)' },
                { nome: 'CSLL', esfera: 'federal', aliquotaBase: '9%' },
                { nome: 'PIS', esfera: 'federal', aliquotaBase: '1,65% (nao-cumulativo)' },
                { nome: 'COFINS', esfera: 'federal', aliquotaBase: '7,6% (nao-cumulativo)' },
            );
            if (at === 'industria' || at === 'misto') {
                list.push({ nome: 'IPI', esfera: 'federal', aliquotaBase: 'Variavel por NCM' });
            }
            if (temIcms(at)) {
                list.push({ nome: 'ICMS', esfera: 'estadual', aliquotaBase: 'Variavel por UF e produto' });
            }
            if (temIss(at)) {
                list.push({ nome: 'ISS', esfera: 'municipal', aliquotaBase: '2% a 5% conforme municipio' });
            }
            break;
    }

    return list;
}

function buildObservacoes(
    regime: RegimeTributario,
    at: AtividadeTipo,
    cnae: string,
): string[] {
    const obs: string[] = [];

    if (regime === 'mei') {
        obs.push('MEI possui limite de faturamento anual de R$ 81.000,00.');
        obs.push('Obrigatorio apenas a DASN-SIMEI e o pagamento do DAS-MEI mensal.');
    }

    if (regime === 'simples_nacional') {
        obs.push('Simples Nacional: verificar sublimite estadual para ICMS/ISS.');
        if (at === 'servico') {
            obs.push('Atividades de servico podem estar sujeitas ao Fator R (Anexo V).');
        }
    }

    if (regime === 'lucro_presumido') {
        obs.push('Lucro Presumido: apuracao trimestral de IRPJ e CSLL.');
        if (at === 'servico') {
            obs.push('Servicos: base presumida de 32% para IRPJ e CSLL.');
        }
        if (at === 'comercio' || at === 'industria') {
            obs.push('Comercio/Industria: base presumida de 8% (IRPJ) e 12% (CSLL).');
        }
    }

    if (regime === 'lucro_real') {
        obs.push('Lucro Real: PIS e COFINS no regime nao-cumulativo (creditos permitidos).');
        obs.push('Obrigatorio manter escrituracao contabil completa (ECD + ECF).');
        if (at === 'industria') {
            obs.push('Industria: obrigacoes adicionais de IPI e declaracoes acessorias especificas.');
        }
    }

    if (temIcms(at) && regime !== 'mei') {
        obs.push('ICMS: verificar inscricao estadual e obrigacoes Sefaz do estado.');
    }

    if (temIss(at) && regime !== 'mei') {
        obs.push('ISS: verificar inscricao municipal e aliquota do municipio.');
    }

    return obs;
}

// ---------------------------------------------------------------------------
// Public: main profile generator
// ---------------------------------------------------------------------------

/**
 * Generates a complete TaxProfile for the given CNAE and regime.
 */
export function gerarPerfilTributario(params: {
    cnae: string;
    descricaoCnae?: string;
    regime: RegimeTributario;
}): TaxProfile {
    const { cnae, regime } = params;
    const descricaoCnae = params.descricaoCnae || '';
    const atividadeTipo = inferirAtividadePorCnae(cnae);

    return {
        regime,
        atividadeTipo,
        cnae,
        descricaoCnae,
        certidoesObrigatorias: buildCertidoes(atividadeTipo),
        obrigacoesObrigatorias: buildObrigacoes(regime, atividadeTipo),
        impostosAplicaveis: buildImpostos(regime, atividadeTipo),
        observacoes: buildObservacoes(regime, atividadeTipo, cnae),
    };
}

// ---------------------------------------------------------------------------
// Display helpers (used by the component)
// ---------------------------------------------------------------------------

const REGIME_LABELS: Record<RegimeTributario, string> = {
    simples_nacional: 'Simples Nacional',
    lucro_presumido: 'Lucro Presumido',
    lucro_real: 'Lucro Real',
    mei: 'MEI',
};

const ATIVIDADE_LABELS: Record<AtividadeTipo, string> = {
    comercio: 'Comercio',
    industria: 'Industria',
    servico: 'Servico',
    misto: 'Misto',
};

export function regimeLabel(r: RegimeTributario): string {
    return REGIME_LABELS[r] || r;
}

export function atividadeLabel(a: AtividadeTipo): string {
    return ATIVIDADE_LABELS[a] || a;
}

export default {
    inferirAtividadePorCnae,
    inferirRegimePorFonte,
    gerarPerfilTributario,
    regimeLabel,
    atividadeLabel,
};
