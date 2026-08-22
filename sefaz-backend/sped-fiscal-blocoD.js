// ============================================================================
// Bloco D do EFD ICMS/IPI — Servicos de Transporte (CTe, modelo 57).
//
// Registros gerados:
//   D001 — Abertura do Bloco D
//   D100 — Aquisicao de Servicos de Transporte (1 por CTe)
//   D190 — Registro Analitico (agregacao por CST/CFOP/aliquota)
//   D990 — Encerramento do Bloco D
//
// MDFe (modelo 58) NAO tem registro proprio no SPED Fiscal — eh documento
// auxiliar de transporte, nao fiscal. Apuracao do ICMS-frete eh via CTe.
//
// Layout: Guia Pratico EFD ICMS/IPI 3.2.2 - Bloco D.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
import { selecionarCtesBlocoD, codSitDoDocumento } from './sped-selecao-documentos.js';
// Réguas DONAS da leitura do documento — o CT-e capturado grava os campos
// achatados, e ler só a forma aninhada fazia o COD_PART cair num literal.
import {
    docCancelado, direcaoEfetivaDoc, valorDoDocumentoServico,
} from './xml-metadata-helper.js';
import { participanteDoDocumento, ehEmissaoPropriaDoc } from './participante-doc-helper.js';
import { normalizarParticipantesDoc } from './dipam-produtor-rural.js';
// A correlação de CFOP é a MESMA do C190 — o CT-e traz o código do
// transportador, e quem toma o frete escritura na ótica de entrada.
import { cfopDoLancamento } from './cfop-correlacao.js';

/** Valor do documento; 0 quando não há valor em forma nenhuma (o aviso é do chamador). */
const valorDoDoc = (nota) => {
    const v = valorDoDocumentoServico(nota);
    return Number.isFinite(v) ? v : 0;
};

const MODELOS_BLOCO_D = ['57'];  // Apenas CTe

/** CFOP do CT-e — cabeçalho (onde o CT-e o guarda) ou 1º item. Vazio = não sei. */
export function cfopDoCte(nota) {
    const cru = String(nota?.cfop || nota?.CFOP || (nota?.itens || [])[0]?.cfop || '').replace(/\D/g, '');
    return cru.length === 4 ? cru : '';
}

/** CST de ICMS do CT-e — mesma ideia; '' quando o documento não diz. */
export function cstDoCte(nota) {
    const cru = String(nota?.cstIcms || nota?.cst || (nota?.itens || [])[0]?.cst || '').replace(/\D/g, '');
    return cru ? cru : '';
}

/**
 * Mapeia status interno -> COD_SIT do registro D100 (mesmo do C100).
 */

/**
 * Filtra documentos que entram no Bloco D.
 * - Modelo 57 (CTe)
 * - Tipo 'CTe' (defensivo - se modelo bate, tipo ja deve estar ok)
 */
function filtrarNotasBlocoD(notas) {
    // O modelo sai da RÉGUA, não do campo cru: o importer principal não grava
    // `modelo`, e ler o campo deixava todo CT-e capturado fora do bloco (mesma
    // causa do caso PS VIDROS no bloco C, 19/08).
    return selecionarCtesBlocoD(notas);
}

/**
 * D100 — Nota Fiscal de Servico de Transporte (CTe)
 *
 * Campos principais:
 *  01 REG          'D100'
 *  02 IND_OPER     0=Aquisicao (entrada), 1=Prestacao (saida)
 *  03 IND_EMIT     0=Emissao propria, 1=Terceiros
 *  04 COD_PART     Codigo do participante (do 0150)
 *  05 COD_MOD      '57'
 *  06 COD_SIT      Status (00 regular, 02 cancelado, etc)
 *  07 SER          Serie (max 4)
 *  08 SUB          Subserie (max 3, vazio se nao houver)
 *  09 NUM_DOC      Numero do CTe
 *  10 CHV_CTE      Chave de acesso (44 digitos)
 *  11 DT_DOC       Data emissao (DDMMAAAA)
 *  12 DT_A_P       Data aquisicao/prestacao (DDMMAAAA)
 *  13 TP_CT_E      Tipo CTe (0=normal, 1=complemento, 2=anulacao, 3=substituto)
 *  14 CHV_CTE_REF  Chave CTe referenciado (vazio se TP_CT_E=0)
 *  15 VL_DOC       Valor total do documento
 *  16 VL_DESC      Valor desconto
 *  17 IND_FRT      0=CIF, 1=FOB, 2=Tercer., 9=Sem cobranca
 *  18 VL_SERV      Valor da prestacao do servico (vTPrest)
 *  19 VL_BC_ICMS   Base calculo ICMS
 *  20 VL_ICMS      Valor ICMS
 *  21 VL_NT        Valor nao-tributado
 *  22 COD_INF      Codigo informacao complementar (vazio)
 *  23 COD_CTA      Codigo conta contabil (vazio)
 */
function buildD100(notaCrua, dados) {
    // 🚨 CINCO LEITURAS CRUAS NUM REGISTRO SÓ (21/08, varredura dos leitores de
    // documento). Este bloco lia `nota.emitente?.cnpj` — e a régua monta
    // `.cnpjCpf` enquanto a captura grava `cnpjEmit`: NENHUMA das duas era
    // lida, então `indEmit` saía sempre '1' e o COD_PART caía no literal
    // 'PARTSEM' — um participante INVENTADO, que o 0150 nunca teria.
    const nota = normalizarParticipantesDoc(notaCrua);
    const t = nota.totais || {};
    // COD_SIT pela régua ÚNICA — a mesma do C100 (a tabela é a mesma). Este
    // bloco tinha a SEGUNDA cópia, e ela devolvia '08' (regime especial) para
    // status desconhecido: afirmação sobre a natureza do documento, feita por
    // default. Cobre o cancelamento por evento.
    const codSit = codSitDoDocumento(nota, dados.empresa?.dadosFiscais?.uf);

    const indOper = direcaoEfetivaDoc(nota) === 'saida' ? '1' : '0';

    // Emissão própria pela MESMA régua do bloco C (cobre a nota própria de
    // entrada, que é emissão própria mesmo entrando).
    const indEmit = ehEmissaoPropriaDoc(nota, dados.empresa?.cnpj) ? '0' : '1';

    // Código do participante: o "outro lado" pela régua ÚNICA — a mesma que o
    // C100 e o coletor do 0150 usam, senão o D100 aponta para quem o 0150 não
    // cadastrou. Sem participante legível o campo sai VAZIO, nunca inventado.
    const participante = participanteDoDocumento(nota, dados.empresa?.cnpj);
    const codPart = String(participante?.cnpjCpf || participante?.cnpj || '').replace(/\D/g, '');

    // Tipo CTe: campo tpCTe do XML; default 0 (normal)
    const tpCte = String(nota.tpCTe || '0').slice(0, 1);

    return fmt.buildLine([
        'D100',
        indOper,
        indEmit,
        codPart,
        '57',
        codSit,
        fmt.sanitizeString(nota.serie || '1', 4),
        '',  // SUB
        fmt.sanitizeString(String(nota.numero || ''), 9),
        fmt.sanitizeString(nota.chave || nota.chaveAcesso || '', 44),
        fmt.formatDate(nota.dataEmissao || nota.dhEmi),
        fmt.formatDate(nota.dataEntrada || nota.dataEmissao || nota.dhEmi),
        tpCte,
        fmt.sanitizeString(nota.chaveCTeRef || '', 44),
        // VL_DOC pela régua do VALOR: o CT-e capturado grava `valorTotal` na
        // raiz (o XML traz <vTPrest>), e `t.vNF || t.valor` não existe nele —
        // era o mesmo VL_DOC 0,00 do bloco D do EFD-Contribuições.
        fmt.formatValue(valorDoDoc(nota), 2),
        fmt.formatValue(t.vDesc || 0, 2),
        '9',  // IND_FRT default sem cobranca (CTe nao tem o conceito de frete sobre frete)
        fmt.formatValue(t.vTPrest || t.vServ || valorDoDoc(nota), 2),
        fmt.formatValue(t.vBC || 0, 2),
        fmt.formatValue(t.vICMS || 0, 2),
        fmt.formatValue(t.vNT || 0, 2),
        '',  // COD_INF
        '',  // COD_CTA
    ]);
}

/**
 * D190 — Registro Analitico de Operacoes (Bloco D)
 *
 * Agrega CTes por (CST_ICMS, CFOP, ALIQ_ICMS) com totais.
 * Pelo menos 1 D190 por D100 (mesmo que zerado).
 *
 * Campos:
 *  01 REG          'D190'
 *  02 CST_ICMS     CST do ICMS (3 digitos)
 *  03 CFOP         CFOP (4 digitos)
 *  04 ALIQ_ICMS    Aliquota ICMS
 *  05 VL_OPR       Valor da operacao
 *  06 VL_BC_ICMS   Base de calculo
 *  07 VL_ICMS      Valor ICMS
 *  08 VL_RED_BC    Valor reducao BC (vazio)
 *  09 COD_OBS      Codigo observacao (vazio)
 */
function buildD190PorNota(nota) {
    const t = nota.totais || {};
    // 🚨 SEM CFOP/CST INVENTADO (21/08): o CFOP saía CRAVADO em '5352'
    // ("prestação a estabelecimento industrial") em 100% dos conhecimentos,
    // porque a captura só lia o CFOP de dentro de <prod> — e o CT-e o traz no
    // CABEÇALHO. Cravar aqui é afirmar a NATUREZA da operação de transporte,
    // que é justamente o que a fiscalização lê. Quem não tem CFOP legível não
    // entra no bloco (ver `cfopDoCte`): aqui ele já chegou conferido.
    const cstIcms = String(cstDoCte(nota) || '090').padStart(3, '0').slice(-3);
    // ⚠️ E o CFOP passa pela MESMA régua do C190: o CT-e traz o CFOP do
    // TRANSPORTADOR (5352/6352 — a prestação, do lado dele), e quem TOMA o
    // frete escritura na ótica de entrada (1352/2352). Preservar o do emitente
    // escrituraria a operação DELE — é a lição da correlação de CFOP.
    const cfop = String(
        cfopDoLancamento(nota, cfopDoCte(nota), direcaoEfetivaDoc(nota), {}) || cfopDoCte(nota),
    ).padStart(4, '0').slice(-4);
    const aliq = parseFloat(nota.aliqIcms || 0) || 0;

    return fmt.buildLine([
        'D190',
        cstIcms,
        cfop,
        fmt.formatValue(aliq, 2),
        // VL_OPR pela MESMA régua do VL_DOC do D100 — se os dois lerem formas
        // diferentes, o resumo contradiz o documento que ele resume.
        fmt.formatValue(valorDoDoc(nota), 2),
        fmt.formatValue(t.vBC || 0, 2),
        fmt.formatValue(t.vICMS || 0, 2),
        '',  // VL_RED_BC
        '',  // COD_OBS
    ]);
}

/**
 * Monta o Bloco D completo a partir de dados.notas filtradas por modelo 57.
 */
export function buildBlocoD(dados) {
    const linhas = [];
    const notas = filtrarNotasBlocoD(dados.notas);

    // D001 — Abertura
    const indMovimento = notas.length > 0 ? '0' : '1';
    linhas.push(fmt.buildLine(['D001', indMovimento]));

    // D100 + D190 por CTe
    /** CT-e sem CFOP legível: sai NOMEADO em vez de entrar com natureza inventada. */
    const semCfop = [];
    for (const nota of notas) {
        try {
            if (!cfopDoCte(nota)) {
                semCfop.push(String(nota.numero || nota.chave || '(sem número)'));
                continue;
            }
            linhas.push(buildD100(nota, dados));
            // D190 pra cada CTe — agrupamento detalhado pode vir em fase futura
            linhas.push(buildD190PorNota(nota));
        } catch (e) {
            console.error(`[blocoD] erro ao gerar registros do CTe ${nota.chave || nota.numero}:`, e.message);
        }
    }
    if (semCfop.length && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            `Bloco D: ${semCfop.length} CT-e ficaram FORA porque o CFOP não foi capturado — `
            + `nº ${semCfop.slice(0, 10).join(', ')}${semCfop.length > 10 ? ` e mais ${semCfop.length - 10}` : ''}. `
            + 'O CFOP do CT-e mora no CABEÇALHO do XML e a captura antiga não o lia; cravar um valor aqui '
            + 'declararia a NATUREZA da operação de transporte no escuro. Rode o ♻️ (reler XMLs guardados) '
            + 'para recuperá-lo, ou reimporte o XML do conhecimento.',
        );
    }

    // D990 — Encerramento
    // Total INCLUI o proprio D990
    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['D990', totalBloco]));

    return linhas;
}
