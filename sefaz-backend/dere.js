// ============================================================================
// sefaz-backend/dere.js  (PURO — sem I/O, testável)
// ----------------------------------------------------------------------------
// 🏦 DeRE — Declaração Eletrônica de Regimes Específicos (IBS/CBS/IS).
//
// O que este módulo RESPONDE, para a carteira e para um cliente:
//   · QUEM está na DeRE (pelo dono `dere-regimes.js`);
//   · QUANDO ela vence numa competência (pelo catálogo, que é o dono do prazo);
//   · QUAIS eventos a competência exige, e em que fase do cronograma estamos;
//   · a FILA da carteira: obrigadas, candidatas a confirmar (CNAE), regimes
//     não confirmados, e o que ficou de fora — DITO, nunca sumido.
//
// O que ele NÃO FAZ, e por quê (decisão desta rodada, 02/09):
//   · **não gera nem transmite evento**. O leiaute (XSD 1.0.0) não pôde ser
//     lido nesta rede, e montar XML de declaração por dedução é o `1405` num
//     arquivo que a Receita processa. E o INSUMO dos eventos periódicos é
//     CONTÁBIL (plano de contas comentado, balancete mensal) — mora no
//     Consultor Contábil, não aqui. Onde a geração deve nascer é decisão do
//     dono; enquanto ela não existir, a tela diz que a entrega é por fora.
//
// FONTES: ver `FONTES_DERE` em dere-regimes.js — e a ressalva de que o manual
// e os leiautes foram conhecidos por RESUMO, não lidos.
// ============================================================================

import { OBRIGACAO_DERE, calcularVencimento, compararCompetencias, competenciaIsoDe } from './catalogo-obrigacoes.js';
import { decidirDereNoCadastro, FONTES_DERE, REGIMES_ESPECIFICOS_IBS_CBS } from './dere-regimes.js';

/** Primeira competência com escrituração mensal (Ato Conjunto RFB/CGIBS 4/2026). */
export const VIGENCIA_DERE = OBRIGACAO_DERE.vigenciaDesde;

/**
 * O CRONOGRAMA — as três datas do Ato Conjunto 4/2026, na leitura oficial de
 * 26/08: 01/10/2026 é o INÍCIO da recepção dos eventos de tabela (não é prazo
 * final); 15/11/2026 é o prazo da 1ª escrituração mensal (competência 10/2026),
 * e os eventos de tabela precisam estar processados ANTES dela.
 */
export const CRONOGRAMA_DERE = Object.freeze([
    {
        dataIso: '2026-10-01',
        marco: 'Ambiente da DeRE passa a receber os EVENTOS DE TABELA (D-1001 e D-1011).',
        detalhe: 'É início de recepção, não prazo final — mas eles precisam estar processados com sucesso antes da '
            + '1ª escrituração mensal (15/11/2026).',
        fonte: FONTES_DERE.ESCLARECIMENTO_26_08,
    },
    {
        dataIso: '2026-11-15',
        marco: 'Prazo da 1ª escrituração mensal — competência 10/2026 (eventos periódicos).',
        detalhe: 'Dia 15 do mês seguinte à competência; o prazo NÃO se prorroga quando cai em dia não útil '
            + '(15/11/2026 é domingo — a política da casa antecipa para 13/11).',
        fonte: FONTES_DERE.ATO_CONJUNTO_4,
    },
    {
        dataIso: '2027-01-01',
        marco: 'Obrigatoriedade alcança os demais eventos da DeRE.',
        detalhe: 'Cronograma do Ato Conjunto 4/2026 conforme divulgação oficial; o detalhe de QUAIS eventos '
            + 'entram nesta fase não foi lido (leiautes bloqueados nesta rede).',
        fonte: FONTES_DERE.ATO_CONJUNTO_4,
    },
]);

/**
 * OS EVENTOS — códigos e nomes conforme divulgação oficial (sped.rfb.gov.br,
 * leiautes 1.0.0 de 23/02/2026 e esclarecimento de 26/08/2026).
 *
 * ⚠️ O conteúdo de cada evento (campos, XSD) NÃO está aqui — não foi lido. O
 * que está é o que a tela precisa para dizer "este mês exige isto".
 *
 * `grupo`: 'tabela' (enviado uma vez, vale até ser alterado) · 'mensal'
 * (por competência) · 'retorno' (a Receita devolve; ninguém envia).
 * `mensalDesde`: competência a partir da qual o evento mensal é exigido.
 */
export const EVENTOS_DERE = Object.freeze([
    { codigo: 'D-1001', nome: 'Informações do Contribuinte', grupo: 'tabela', desde: '2026-10-01',
        nota: 'Regime específico PRINCIPAL e até três secundários — é aqui que a empresa declara em qual regime está.' },
    { codigo: 'D-1011', nome: 'Plano Geral de Contas Comentado (PGCC)', grupo: 'tabela', desde: '2026-10-01',
        nota: 'Obrigatório para todo contribuinte da DeRE. Insumo CONTÁBIL — o plano de contas mora no Consultor Contábil.' },
    { codigo: 'D-1101', nome: 'Balancete Mensal', grupo: 'mensal', mensalDesde: '10/2026',
        nota: 'Insumo CONTÁBIL (balancete). Não sai deste app.' },
    { codigo: 'D-1106', nome: 'Identificação de Aplicações Financeiras', grupo: 'mensal', mensalDesde: '10/2026' },
    { codigo: 'D-1121', nome: 'Relação de Deduções Utilizadas na Apuração', grupo: 'mensal', mensalDesde: '10/2026' },
    { codigo: 'D-2101', nome: 'Débito em Operações com Títulos de Dívida com Oferta Pública', grupo: 'mensal', mensalDesde: '10/2026' },
    { codigo: 'D-1199', nome: 'Fechamento Mensal', grupo: 'mensal', mensalDesde: '10/2026',
        nota: 'Fecha a competência — é o análogo do R-2099 da Reinf.' },
    { codigo: 'D-9001', nome: 'Retorno — Eventos de Tabela', grupo: 'retorno' },
    { codigo: 'D-9101', nome: 'Retorno Totalizador — Balancete Mensal', grupo: 'retorno' },
    { codigo: 'D-9106', nome: 'Retorno Totalizador — Aplicações Financeiras', grupo: 'retorno' },
    { codigo: 'D-9121', nome: 'Retorno Totalizador — Títulos de Dívida com Oferta Pública', grupo: 'retorno' },
    { codigo: 'D-9199', nome: 'Retorno Totalizador — Fechamento Mensal', grupo: 'retorno' },
]);

/** Os eventos que UMA competência exige de quem está obrigado. */
export function eventosDaCompetencia(competencia) {
    const tabela = EVENTOS_DERE.filter((e) => e.grupo === 'tabela');
    const mensais = EVENTOS_DERE.filter((e) => e.grupo === 'mensal'
        && compararCompetencias(competencia, e.mensalDesde) >= 0);
    return { tabela, mensais };
}

/** Vencimento da DeRE numa competência (pelo catálogo — dono único do prazo). */
export function prazoDere(competencia) {
    if (compararCompetencias(competencia, VIGENCIA_DERE) < 0) return null;
    return calcularVencimento(competencia, OBRIGACAO_DERE);
}

function fmtData(d) {
    if (!(d instanceof Date)) return null;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * A SITUAÇÃO de uma empresa numa competência — a linha que a tela mostra.
 *
 * `regimeCatalogo` é o regime fiscal já resolvido ('SIMPLES' | 'LUCRO_*' |
 * 'IMUNE' | 'ISENTA' | 'INDEFINIDO'). Competência anterior à vigência devolve
 * `ainda-nao-vigente` mesmo para quem está obrigado — cobrar 09/2026 seria
 * cobrar o que não existia.
 */
export function situacaoDere(empresa, competencia, { regimeCatalogo } = {}) {
    const veredicto = decidirDereNoCadastro(empresa, { regimeCatalogo });
    const vigente = compararCompetencias(competencia, VIGENCIA_DERE) >= 0;
    const prazo = vigente ? prazoDere(competencia) : null;
    const eventos = vigente ? eventosDaCompetencia(competencia) : { tabela: [], mensais: [] };

    let situacao = veredicto.decisao;
    if (veredicto.decisao === 'obrigada' && !vigente) situacao = 'ainda-nao-vigente';

    return {
        competencia,
        competenciaIso: competenciaIsoDe(competencia),
        situacao,
        ...veredicto,
        vigente,
        vigenciaDesde: VIGENCIA_DERE,
        prazo,
        prazoTexto: fmtData(prazo),
        eventos,
        // O que este app NÃO faz vai DITO na própria resposta — some da tela é
        // o que faz alguém achar que a declaração saiu.
        entregaPeloApp: false,
        ressalvaEntrega: 'O CFI ainda NÃO gera nem transmite os eventos da DeRE: os leiautes não foram lidos e o '
            + 'insumo (PGCC, balancete) é contábil. A entrega é por fora (portal/webservice da DeRE) e se '
            + 'registra em Vencimentos como as demais obrigações entregues fora do app.',
    };
}

/**
 * A FILA DA CARTEIRA — para o pedido à equipe ser "confirme estes N", não
 * "preencham 400". Mesmo desenho da triagem do terceiro setor (18/08).
 *
 * `empresas` vêm do cadastro central (`normalizarEmpresaCadastro`), que já
 * carrega `regimeTributario`, `cnae` e `regimeEspecificoIbsCbs`.
 */
export function triarCarteiraDere(empresas = [], competencia) {
    const obrigadas = [];
    const candidatas = [];
    const regimeNaoConfirmado = [];
    const naoSeAplica = [];
    let dispensadasSimples = 0;
    let semSinal = 0;

    for (const e of empresas || []) {
        const s = situacaoDere(e, competencia, { regimeCatalogo: e?.regimeTributario });
        const linha = {
            id: e?.id || null,
            cnpj: e?.cnpj || null,
            nome: e?.nome || '(sem nome)',
            regimeTributario: e?.regimeTributario || null,
            cnae: e?.cnae || null,
            regimeEspecifico: s.regimeEspecifico,
            regimeEspecificoRotulo: s.rotulo,
            situacao: s.situacao,
            motivo: s.motivo,
            acao: s.acao,
            sinalCnae: s.sinalCnae ? s.sinalCnae.rotulo : null,
            prazoTexto: s.prazoTexto,
        };
        switch (s.decisao) {
            case 'obrigada': obrigadas.push(linha); break;
            case 'candidata': candidatas.push(linha); break;
            case 'regime-nao-confirmado': regimeNaoConfirmado.push(linha); break;
            case 'nao-se-aplica': naoSeAplica.push(linha); break;
            case 'dispensada-simples': dispensadasSimples += 1; break;
            default: semSinal += 1;
        }
    }

    const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    obrigadas.sort(porNome);
    candidatas.sort(porNome);
    regimeNaoConfirmado.sort(porNome);
    naoSeAplica.sort(porNome);

    const vigente = compararCompetencias(competencia, VIGENCIA_DERE) >= 0;
    return {
        competencia,
        vigente,
        vigenciaDesde: VIGENCIA_DERE,
        prazoTexto: fmtData(prazoDere(competencia)),
        eventos: vigente ? eventosDaCompetencia(competencia) : { tabela: [], mensais: [] },
        cronograma: CRONOGRAMA_DERE,
        regimes: REGIMES_ESPECIFICOS_IBS_CBS,
        fontes: FONTES_DERE,
        obrigadas,
        candidatas,
        regimeNaoConfirmado,
        naoSeAplica,
        resumo: {
            total: (empresas || []).length,
            obrigadas: obrigadas.length,
            candidatas: candidatas.length,
            regimeNaoConfirmado: regimeNaoConfirmado.length,
            naoSeAplica: naoSeAplica.length,
            dispensadasSimples,
            // Contado, nunca escondido: "sem sinal" é o caso comum e NÃO é
            // prova de que ninguém está fora — a frase da tela diz isso.
            semSinal,
        },
        ressalvas: [
            'Sem regime no cadastro e sem sinal no CNAE não é prova de que a empresa está fora da DeRE — é o app '
                + 'dizendo que não tem como saber. Quem souber de uma, marque no cadastro.',
            'O alcance da DeRE só foi confirmado (por resumo da documentação oficial) para serviços financeiros, '
                + 'planos de saúde e loterias. Os demais regimes específicos ficam como "não confirmado" até alguém '
                + 'ler o Manual (MOD 1.0.1).',
            'O CFI não gera nem transmite os eventos da DeRE. A entrega é por fora; o que o app faz é dizer quem, '
                + 'quando e o quê — e pôr a obrigação no mês do cliente.',
        ],
    };
}
