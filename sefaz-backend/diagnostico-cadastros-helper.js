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
//
// 🚨 O CAMPO `tipoTributacao` NÃO EXISTIA EM LUGAR NENHUM — e era ele que
// classificava 236 empresas como ALTO (26/08, Paulo, com os dois prints: o
// cadastro da A CASTELLANO mostrando "Regime Tributário: Lucro Presumido" e o
// painel dizendo *"tipoTributacao — Tipo (Presumido/Real) não definido"*).
//
// A varredura fechou a questão: `tipoTributacao` aparecia em DOIS lugares no
// repo inteiro — neste helper, que o EXIGIA, e no teste dele, que descrevia a
// exigência. **Nenhuma tela grava, nenhum gerador lê, nenhum importador
// preenche.** Ou seja: era uma pendência IMPOSSÍVEL DE RESOLVER, e como
// ninguém a preenche, ela nascia em **100% das empresas do Lucro**.
//
// É a "rota sem botão" (13/08) na forma mais cara — pendência sem caminho de
// resolução — combinada com a armadilha das duas formas: o modal grava
// `dadosFiscais.regimeTributario` (o campo que nasceu em 18/08, com dono e
// vocabulário próprios) e o painel perguntava por outro nome.
//
// 📌 E o custo não é o alarme errado numa empresa: é o painel INTEIRO perdendo
// crédito. Alarme que aparece em toda a carteira e não tem como ser resolvido
// ensina a equipe a ignorar a lista — inclusive as 3 pendências CRÍTICAS que
// estão certas.
// ============================================================================
import { regimeDaEmpresa } from './regime-tributario.js';

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
        // Quem responde é o DONO (`regimeDaEmpresa`, 18/08): ele lê o campo que
        // a tela de fato grava, com a precedência da casa — cadastro explícito
        // > `regimePadrao` > coleção. A pendência só nasce quando a apuração
        // fica mesmo INDEFINIDA, e aí ela aponta o lugar de resolver.
        const r = regimeDaEmpresa({
            ...empresa,
            colecao: empresa.colecao || 'lucro_empresas',
        });
        if (!r.apuracaoDefinida) {
            add(
                'dadosFiscais.regimeTributario',
                'Regime tributário não definido — escolha Lucro Presumido ou Lucro Real '
                    + 'em Empresas → Dados Fiscais → Regime Tributário',
                'Cálculo de DARF e SPED',
            );
        }
    }

    return out;
}

/** Classifica gravidade pela quantidade de pendências críticas (UF/IBGE/CNPJ). */
export function gravidadeCadastro(pendencias) {
    if (!pendencias || !pendencias.length) return 'ok';
    const tem = (c) => pendencias.some((p) => p.campo === c || p.campo.endsWith(`.${c}`));
    if (tem('cnpj') || tem('uf') || tem('codMunIBGE')) return 'critico';
    if (tem('anexo') || tem('regimeTributario')) return 'alto';
    return 'medio';
}
