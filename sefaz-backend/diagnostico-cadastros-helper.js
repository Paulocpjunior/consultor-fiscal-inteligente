// ============================================================================
// diagnostico-cadastros-helper.js  (PURO — sem io/firebase, testavel)
//
// Verifica campos obrigatorios de uma empresa (Simples ou Lucro) que sao
// exigidos por outras partes do sistema:
//
//   uf, codMunIBGE       SPED Fiscal gerador (sped-fiscal-orchestrator)
//   cnpj                 todos os cruzamentos / DAS / DCTFWeb
//   nome/razaoSocial     identificacao em todos os paineis
//   regime               anexo do Simples / DCTFWeb categoria
//   atividade            (Simples) tabela de aliquota / Anexo
//
// Cada campo faltante e' uma "pendencia" que impede UM caminho do sistema.
// O painel lista quem tem o que faltando.
// ============================================================================

/**
 * @param {object} empresa  shape de simples_empresas/* ou lucro_empresas/*
 * @param {string} regime   'simples' | 'lucro'
 * @returns {Array<{ campo:string, descricao:string, impacto:string }>}
 */
export function pendenciasCadastro(empresa, regime) {
    const out = [];
    const add = (campo, descricao, impacto) => out.push({ campo, descricao, impacto });

    if (!empresa) return out;
    const df = empresa.dadosFiscais || {};

    if (!empresa.cnpj || String(empresa.cnpj).replace(/\D/g, '').length !== 14) {
        add('cnpj', 'CNPJ inválido ou ausente', 'TUDO — não cruza com nada');
    }
    if (!empresa.nome && !empresa.razaoSocial) {
        add('nome', 'Sem nome/razão social', 'Identificação visual nos painéis');
    }

    // Dados fiscais — obrigatorios pro SPED Fiscal gerador
    if (!df.uf) {
        add('dadosFiscais.uf', 'UF da empresa não cadastrada', 'SPED Fiscal não gera');
    }
    if (!df.codMunIBGE) {
        add('dadosFiscais.codMunIBGE', 'Código IBGE do município faltando', 'SPED Fiscal não gera');
    }

    // Especificos por regime
    if (regime === 'simples') {
        if (!empresa.anexo) {
            add('anexo', 'Anexo do Simples não definido', 'Cálculo do DAS falha');
        }
        // CNAE principal e usado pra fator R / segregacao
        if (!df.cnae && !empresa.cnae) {
            add('cnae', 'CNAE principal não cadastrado', 'Análise de regime / segregação por anexo');
        }
    }
    if (regime === 'lucro') {
        if (!empresa.tipoTributacao) {
            add('tipoTributacao', 'Tipo (Presumido/Real) não definido', 'Cálculo de DARF e SPED');
        }
    }

    return out;
}

/** Classifica gravidade pela quantidade de pendências críticas (UF/IBGE/CNPJ). */
export function gravidadeCadastro(pendencias) {
    if (!pendencias || !pendencias.length) return 'ok';
    const tem = (c) => pendencias.some((p) => p.campo === c || p.campo.endsWith(`.${c}`));
    if (tem('cnpj') || tem('uf') || tem('codMunIBGE')) return 'critico';
    if (tem('anexo') || tem('tipoTributacao')) return 'alto';
    return 'medio';
}
