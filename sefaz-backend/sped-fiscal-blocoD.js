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

const MODELOS_BLOCO_D = ['57'];  // Apenas CTe

/**
 * Mapeia status interno -> COD_SIT do registro D100 (mesmo do C100).
 */
function statusParaCodSit(status) {
    const map = {
        'autorizado': '00',
        'cancelado': '02',
        'denegado': '04',
        'inutilizado': '05',
        'extemporaneo': '01',
    };
    return map[status] || '08';  // 08 = situacao especial OEC
}

/**
 * Filtra documentos que entram no Bloco D.
 * - Modelo 57 (CTe)
 * - Tipo 'CTe' (defensivo - se modelo bate, tipo ja deve estar ok)
 */
function filtrarNotasBlocoD(notas) {
    return (notas || []).filter(n => {
        if (!MODELOS_BLOCO_D.includes(String(n.modelo))) return false;
        if (n.tipo !== 'CTe') return false;
        return true;
    });
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
function buildD100(nota, dados) {
    const t = nota.totais || {};
    const codSit = statusParaCodSit(nota.status);

    const indOper = nota.direcao === 'saida' ? '1' : '0';

    // Identifica emitente vs proprio
    const cnpjEmpresa = (dados.empresa?.cnpj || '').replace(/\D/g, '');
    const cnpjEmitente = (nota.emitente?.cnpj || nota.cnpjEmitente || '').replace(/\D/g, '');
    const indEmit = (cnpjEmpresa && cnpjEmitente && cnpjEmpresa === cnpjEmitente) ? '0' : '1';

    // Codigo participante: prefere o CNPJ do "outro lado" da operacao
    const cnpjOutro = indEmit === '0'
        ? (nota.destinatario?.cnpj || nota.cnpjDestinatario || '')
        : (nota.emitente?.cnpj || nota.cnpjEmitente || '');
    const codPart = (cnpjOutro || '').replace(/\D/g, '') || 'PARTSEM';

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
        fmt.formatValue(t.vNF || t.valor || 0, 2),
        fmt.formatValue(t.vDesc || 0, 2),
        '9',  // IND_FRT default sem cobranca (CTe nao tem o conceito de frete sobre frete)
        fmt.formatValue(t.vTPrest || t.vServ || t.vNF || 0, 2),
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
    const cstIcms = String(nota.cstIcms || '000').padStart(3, '0').slice(-3);
    const cfop = String(nota.cfop || nota.CFOP || '5352').padStart(4, '0').slice(-4);
    const aliq = parseFloat(nota.aliqIcms || 0) || 0;

    return fmt.buildLine([
        'D190',
        cstIcms,
        cfop,
        fmt.formatValue(aliq, 2),
        fmt.formatValue(t.vNF || t.valor || 0, 2),
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
    for (const nota of notas) {
        try {
            linhas.push(buildD100(nota, dados));
            // D190 pra cada CTe — agrupamento detalhado pode vir em fase futura
            linhas.push(buildD190PorNota(nota));
        } catch (e) {
            console.error(`[blocoD] erro ao gerar registros do CTe ${nota.chave || nota.numero}:`, e.message);
        }
    }

    // D990 — Encerramento
    // Total INCLUI o proprio D990
    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['D990', totalBloco]));

    return linhas;
}
