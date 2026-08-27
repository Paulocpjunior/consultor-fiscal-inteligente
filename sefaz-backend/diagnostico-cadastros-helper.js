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

    // Quem responde pelo regime é o DONO (`regimeDaEmpresa`, 18/08), com a
    // precedência da casa — cadastro explícito > `regimePadrao` > coleção. Ele
    // sobe para cá porque as pendências do SPED também dependem dele (imune,
    // isenta, Lucro Real), e uma segunda leitura divergiria.
    const r = regimeDaEmpresa({
        ...empresa,
        colecao: empresa.colecao || (regime === 'simples' ? 'simples_empresas' : 'lucro_empresas'),
    });

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
        // A pendência só nasce quando a apuração fica mesmo INDEFINIDA, e aí
        // ela aponta o lugar de resolver.
        if (!r.apuracaoDefinida) {
            add(
                'dadosFiscais.regimeTributario',
                'Regime tributário não definido — escolha Lucro Presumido ou Lucro Real '
                    + 'em Empresas → Dados Fiscais → Regime Tributário',
                'Cálculo de DARF e SPED',
            );
        }
    }

    pendenciasDoSped(df, r, add);

    return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 🚦 OS CAMPOS QUE TRAVAM O ARQUIVO DO SPED — descobertos hoje uma recusa do
// PVA por vez, que é o gargalo que o Paulo nomeou em 20/08 (*"evitando o vai e
// vem o dia todo"*).
//
// O diagnóstico cobria SEIS campos (CNPJ, nome, UF, IBGE, anexo, CNAE) e
// nenhum deles é o que faz o PVA recusar. Os que fazem são de TABELA OFICIAL,
// o app se recusa a deduzi-los, e a falta só aparece na hora de gerar — quando
// já é uma volta de validador perdida.
//
// 🚨 A TRAVA QUE DECIDE ESTE MÓDULO É "SÓ ACUSA QUEM PRECISA".
//
// Cobrar classificação de estabelecimento industrial de um comércio, ou
// natureza da PJ de uma LTDA comum, faria a carteira inteira nascer em âmbar
// por campo que aquelas empresas nunca vão preencher — e o custo não é a linha
// errada, é o painel INTEIRO perdendo crédito. É literalmente o `tipoTributacao`
// de 26/08, que classificou 236 empresas como ALTO e das quais 234 eram alarme
// falso. Por isso cada pendência aqui nasce de uma CONDIÇÃO lida do próprio
// cadastro, e a condição vai escrita ao lado.
//
// 📌 O QUE FICOU DE FORA, E POR QUÊ (ausência declarada, nunca esquecida):
//  · `perfilEFD` — quem atribui o perfil (A/B/C) é o fisco ESTADUAL, e o
//    cadastro não sabe. Acusar todo mundo seria o fantasma de novo; o app já
//    DIZ no aviso da geração quando o perfil não é A.
//  · `contribuinteIpi` — a régua tem prova POSITIVA (IPI destacado na saída,
//    que só contribuinte destaca). Cobrar do cadastro acenderia em todo
//    comércio que compra de indústria, que é quase toda a carteira.
//  · `contrib1900CodMod`/`CodSit` e o trio do FRETE (bloco D) — dependem da
//    FICHA (receita de locação) e de DOCUMENTO (CT-e), que este helper não vê.
//    Quem avisa é a própria geração, com a recusa literal do PVA.
// ════════════════════════════════════════════════════════════════════════════
function pendenciasDoSped(df, regimeDaFicha, add) {
    const vazio = (v) => v == null || String(v).trim() === '';
    const regime = regimeDaFicha?.regime || 'INDEFINIDO';

    // ── 0002 do EFD ICMS/IPI ────────────────────────────────────────────────
    // CONDIÇÃO: a empresa DECLAROU ser contribuinte de IPI. Aí o registro é
    // obrigatório e o PVA recusa o arquivo sem ele ("Registro filho obrigatório
    // não foi informado · 0002" — PWR 07/2026). É tabela oficial: o app não
    // deduz, e sem o cadastro o registro simplesmente não sai.
    if (String(df.contribuinteIpi || '').toLowerCase() === 'sim' && vazio(df.classEstabIpi)) {
        add(
            'dadosFiscais.classEstabIpi',
            'Contribuinte de IPI sem a classificação do estabelecimento industrial (registro 0002) — '
                + 'preencha em Empresas → Dados Fiscais → Classificação do estabelecimento (IPI)',
            'EFD ICMS/IPI: o 0002 não sai e o PVA RECUSA o arquivo',
        );
    }

    // ── 0000 do EFD-Contribuições, campo 13 ─────────────────────────────────
    // CONDIÇÃO: a entidade NÃO é sociedade empresária comum — imune, isenta ou
    // sem fins lucrativos. Sem o código (Tabela 3.1.3) o arquivo sai declarando
    // '00', *sociedade empresária em geral*, sobre um templo. É o caso que fez
    // o módulo de regime nascer (18/08).
    const naoEhSociedadeComum = regime === 'IMUNE' || regime === 'ISENTA'
        || df.semFinsLucrativos === true;
    if (naoEhSociedadeComum && vazio(df.indNatPJ)) {
        add(
            'dadosFiscais.indNatPJ',
            'Entidade imune/isenta ou sem fins lucrativos sem a natureza da pessoa jurídica '
                + '(IND_NAT_PJ) — preencha em Empresas → Dados Fiscais → Natureza da PJ',
            'EFD-Contribuições: o 0000 declara "00 — sociedade empresária em geral"',
        );
    }

    // ── 0110 do EFD-Contribuições ───────────────────────────────────────────
    // CONDIÇÃO: não-cumulativo (Lucro Real) — só lá existe apropriação de
    // crédito. O campo diz COMO a empresa apropria, que é fato DELA; o gerador
    // cravava '2' (rateio proporcional) e o EFD assinado do CF BANK mostrou '1'.
    if (regime === 'LUCRO_REAL' && vazio(df.indAproCredPisCofins)) {
        add(
            'dadosFiscais.indAproCredPisCofins',
            'Lucro Real sem o método de apropriação de crédito de PIS/COFINS (IND_APRO_CRED) — '
                + 'preencha em Empresas → Dados Fiscais → Apropriação de crédito',
            'EFD-Contribuições: o 0110 sai com "2 — rateio proporcional" por padrão',
        );
    }

    // ── 0500 do EFD-Contribuições ───────────────────────────────────────────
    // CONDIÇÃO: alguém JÁ cadastrou a conta da receita financeira. O 0500 exige
    // a conta INTEIRA — nome e nível vêm do plano de contas da empresa —, e a
    // coerência é TUDO OU NADA: sem eles o COD_CTA também não sai no F100, e a
    // referência órfã é justamente a recusa que o CF BANK pagou (24/08).
    if (!vazio(df.contaContabilReceitaFinanceira)) {
        if (vazio(df.contaContabilReceitaFinanceiraNome)) {
            add(
                'dadosFiscais.contaContabilReceitaFinanceiraNome',
                'Conta da receita financeira cadastrada sem o NOME da conta — '
                    + 'preencha em Empresas → Dados Fiscais → Conta contábil da receita financeira',
                'EFD-Contribuições: o 0500 não sai e o COD_CTA some do F100',
            );
        }
        if (vazio(df.contaContabilReceitaFinanceiraNivel)) {
            add(
                'dadosFiscais.contaContabilReceitaFinanceiraNivel',
                'Conta da receita financeira cadastrada sem o NÍVEL da conta — '
                    + 'preencha em Empresas → Dados Fiscais → Conta contábil da receita financeira',
                'EFD-Contribuições: o 0500 não sai e o COD_CTA some do F100',
            );
        }
    }

    // ── E116 do EFD ICMS/IPI ────────────────────────────────────────────────
    // CONDIÇÃO: contribuinte de ICMS (tem inscrição estadual) FORA de SP. O
    // padrão do gerador é o dia 20, que é o de SP, e o código de receita é
    // ESTADUAL — o app não inventa nenhum dos dois. Dentro de SP o padrão está
    // certo no caso comum, então cobrar ali seria alarme sem ação.
    const uf = String(df.uf || '').trim().toUpperCase();
    const contribuinteIcmsForaDeSp = regime !== 'SIMPLES'
        && uf && uf !== 'SP' && !vazio(df.inscricaoEstadual);
    if (contribuinteIcmsForaDeSp) {
        if (vazio(df.icmsDiaVencimento)) {
            add(
                'dadosFiscais.icmsDiaVencimento',
                `Contribuinte de ICMS em ${uf} sem o dia de vencimento do imposto — `
                    + 'preencha em Empresas → Dados Fiscais → ICMS a recolher (E116)',
                'EFD ICMS/IPI: o E116 sai com o dia 20, que é o prazo de SP',
            );
        }
        if (vazio(df.icmsCodRec)) {
            add(
                'dadosFiscais.icmsCodRec',
                `Contribuinte de ICMS em ${uf} sem o código de receita estadual — `
                    + 'preencha em Empresas → Dados Fiscais → ICMS a recolher (E116)',
                'EFD ICMS/IPI: o E116 sai com o campo do código VAZIO',
            );
        }
    }
}

/**
 * Classifica gravidade pela quantidade de pendências críticas (UF/IBGE/CNPJ).
 *
 * ⚠️ ALTO é o que IMPEDE a entrega — recusa do PVA ou afirmação errada à
 * Receita. MÉDIO é o que sai com um padrão que pode não ser o da empresa: ruim,
 * mas o arquivo passa, e misturar os dois faria a fila perder a ordem.
 */
export function gravidadeCadastro(pendencias) {
    if (!pendencias || !pendencias.length) return 'ok';
    const tem = (c) => pendencias.some((p) => p.campo === c || p.campo.endsWith(`.${c}`));
    if (tem('cnpj') || tem('uf') || tem('codMunIBGE')) return 'critico';
    // `classEstabIpi` é RECUSA do PVA; `indNatPJ` faz o arquivo declarar
    // "sociedade empresária em geral" sobre uma entidade imune.
    if (tem('anexo') || tem('regimeTributario') || tem('classEstabIpi') || tem('indNatPJ')) return 'alto';
    return 'medio';
}
