// ============================================================================
// sefaz-backend/sped-contrib-blocos.js
// Blocos A, C, D, F, M, 1, 9 do EFD Contribuicoes (PIS/COFINS).
//
// MVP: estrutura completa com dados reais pra blocos C (NF-e) e M (apuracao).
// Blocos A (servicos), D (transporte), F (outros) geram estrutura minima.
//
// Layout: Guia Pratico EFD Contribuicoes 1.35.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
// A régua das DUAS FORMAS do documento mora num lugar só (11/08).
import { normalizarParticipantesDoc } from './dipam-produtor-rural.js';
// 🚨 Cancelamento chega por EVENTO e o campo `status` fica 'autorizado'. Lendo
// o campo cru, a nota cancelada era DECLARADA À RECEITA nos blocos C/D/F —
// o pior desfecho da família de defeitos do MV LIDER 639 (11/08).
import { docCancelado } from './xml-metadata-helper.js';

// ─── Aliquotas PIS/COFINS por regime ────────────────────────────────────
const ALIQUOTAS = {
    // Regime cumulativo (Lucro Presumido)
    '2': { pis: 0.0065, cofins: 0.03 },
    // Regime nao-cumulativo (Lucro Real)
    '1': { pis: 0.0165, cofins: 0.076 },
    // Ambos: usa nao-cumulativo como padrao
    '3': { pis: 0.0165, cofins: 0.076 },
};

/**
 * Retorna aliquotas PIS/COFINS com base no regime de apuracao.
 */
function getAliquotas(regimeApuracao) {
    return ALIQUOTAS[regimeApuracao] || ALIQUOTAS['2'];
}

/**
 * Determina CST PIS/COFINS de um item com base no regime e direcao.
 *
 * CSTs comuns:
 *   01 = Operacao tributavel (aliquota basica)
 *   50 = Operacao com direito a credito (nao-cumulativo)
 *   70 = Operacao de aquisicao sem direito a credito
 */
function getCstPis(item, regimeApuracao, direcao) {
    if (item.cstPis || item.CSTPis || item.CSTPIS) {
        return String(item.cstPis || item.CSTPis || item.CSTPIS).padStart(2, '0');
    }
    if (direcao === 'saida') return '01';
    if (regimeApuracao === '1' || regimeApuracao === '3') return '50';
    return '70';
}

function getCstCofins(item, regimeApuracao, direcao) {
    if (item.cstCofins || item.CSTCofins || item.CSTCOFINS) {
        return String(item.cstCofins || item.CSTCofins || item.CSTCOFINS).padStart(2, '0');
    }
    if (direcao === 'saida') return '01';
    if (regimeApuracao === '1' || regimeApuracao === '3') return '50';
    return '70';
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO A — Servicos (NFSe)
// ═══════════════════════════════════════════════════════════════════════

/**
 * O VALOR do documento de serviço, nas formas em que ele chega.
 *
 * A NFS-e do portal de SP grava `valorTotal`/`valorServicos` e o espelho
 * `totais.vNF`; a do XML/abrasf grava `valor`; o lançamento manual grava
 * `valorTotal`. Ler um nome só zerava o arquivo inteiro sem avisar.
 *
 * ⚠️ Devolve NaN quando NENHUMA forma tem número — e NaN é de propósito: quem
 * chama precisa distinguir "documento de R$ 0,00" (existe, é raro e é legítimo)
 * de "não achei o valor". Zero silencioso aqui foi o defeito de 17/08.
 */
export function valorDoDocumentoServico(nota) {
    const n = nota || {};
    const candidatos = [
        n.valor, n.valorTotal, n.totalNota, n.valorServicos,
        n.totais?.vNF, n.totais?.vServ, n.valores?.valorServicos,
    ];
    for (const c of candidatos) {
        if (c === null || c === undefined || c === '') continue;
        const v = typeof c === 'number' ? c : parseFloat(String(c).replace(',', '.'));
        if (Number.isFinite(v)) return v;
    }
    return NaN;
}

function filtrarNotasBlocoA(notas) {
    return (notas || []).filter(n => {
        // Cancelada não se declara: os blocos C/D/F já a pulavam e o A não —
        // então NFS-e cancelada saía com PIS/COFINS calculados em cima dela.
        // ⚠️ PULA, não emite COD_SIT '02': o leiaute do documento cancelado
        // neste bloco não está provado contra arquivo aceito, e inventar código
        // de situação é o oposto da régua da casa. Omitir não declara nada a
        // menos — a nota cancelada não tem valor a declarar.
        if (docCancelado(n)) return false;
        if (n.tipo === 'NFSe' || n.tipo === 'NFSE') return true;
        if (String(n.modelo) === 'NFSE') return true;
        return false;
    });
}

export function buildBlocoA(dados) {
    const linhas = [];
    const notasA = filtrarNotasBlocoA(dados.notas);
    const regimeApuracao = dados.regimeApuracao || '2';
    const aliq = getAliquotas(regimeApuracao);

    if (notasA.length === 0) {
        linhas.push(fmt.buildLine(['A001', '1']));
        linhas.push(fmt.buildLine(['A990', '2']));
        return linhas;
    }

    linhas.push(fmt.buildLine(['A001', '0']));
    linhas.push(fmt.buildLine(['A010', fmt.sanitizeCnpjCpf(dados.empresa.cnpj)]));

    for (const notaCrua of notasA) {
        // 🚨 O DOCUMENTO CHEGA EM DUAS FORMAS — e ler só a ANINHADA zerou tudo.
        //
        // 17/08 (CLINICA MEDICA MANTOAN 07/2026): o arquivo saiu com **37 A100 e
        // TODOS com COD_PART vazio e VL_DOC 0,00**. Os documentos estavam lá; o
        // que faltava era a leitura. A NFS-e do portal de SP entra ACHATADA
        // (`cnpjDest`, `valorTotal`), e este bloco lia só `nota.destinatario` e
        // `nota.valor` — nomes que aquele trilho não usa.
        //
        // É a MESMA armadilha de 11/08 (caso EDUARDO GUERRA × DAMIÃO), e a régua
        // já existe: `normalizarParticipantesDoc` monta o aninhado a partir dos
        // campos chatos. Reimplementar aqui seria a segunda cópia de sempre.
        const nota = normalizarParticipantesDoc(notaCrua);
        const direcao = nota.direcao;
        const indOper = direcao === 'saida' ? '1' : '0';
        const indEmit = direcao === 'saida' ? '0' : '1';

        const participanteRaw = direcao === 'saida' ? nota.destinatario : nota.emitente;
        const codPart = participanteRaw
            ? String(participanteRaw.cnpjCpf || participanteRaw.cnpj || participanteRaw.CNPJ || '').replace(/\D/g, '')
            : '';

        const vlDoc = valorDoDocumentoServico(nota);
        const vlPis = vlDoc * aliq.pis;
        const vlCofins = vlDoc * aliq.cofins;

        linhas.push(fmt.buildLine([
            'A100',
            indOper, indEmit, codPart,
            '', '',  // COD_SIT, SER
            '', fmt.sanitizeString(nota.numero || '', 60),
            '',  // CHV_NFSE
            fmt.formatDate(nota.dataEmissao || nota.dhEmi),
            fmt.formatDate(nota.dataEmissao || nota.dhEmi),
            fmt.formatValue(vlDoc), '',
            '',  // VL_DESC
            fmt.formatValue(vlDoc), fmt.formatValue(vlPis),
            fmt.formatValue(vlDoc), fmt.formatValue(vlCofins),
            '', '', '',
        ]));

        for (const item of (nota.itens || [])) {
            const vlItem = parseFloat(item.vProd || item.valor || 0);
            const cstPis = getCstPis(item, regimeApuracao, direcao);
            const cstCofins = getCstCofins(item, regimeApuracao, direcao);

            linhas.push(fmt.buildLine([
                'A170',
                item.nItem || '1',
                fmt.sanitizeString(item.cProd || item.codigo || '', 60),
                fmt.sanitizeString(item.xProd || item.descricao || '', 255),
                fmt.formatValue(vlItem), '',
                '0', cstPis,
                fmt.formatValue(vlItem),
                fmt.formatValue(aliq.pis * 100, 4),
                fmt.formatValue(vlItem * aliq.pis),
                cstCofins,
                fmt.formatValue(vlItem),
                fmt.formatValue(aliq.cofins * 100, 4),
                fmt.formatValue(vlItem * aliq.cofins),
                '', '',
            ]));
        }
    }

    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['A990', totalBloco]));
    return linhas;
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO C — Mercadorias (NF-e modelo 55/65)
// ═══════════════════════════════════════════════════════════════════════

const MODELOS_BLOCO_C = ['55', '65'];

function filtrarNotasBlocoC(notas) {
    return (notas || []).filter(n => MODELOS_BLOCO_C.includes(String(n.modelo)));
}

export function buildBlocoC_Contrib(dados) {
    const linhas = [];
    const notasC = filtrarNotasBlocoC(dados.notas);
    const regimeApuracao = dados.regimeApuracao || '2';
    const aliq = getAliquotas(regimeApuracao);

    if (notasC.length === 0) {
        linhas.push(fmt.buildLine(['C001', '1']));
        linhas.push(fmt.buildLine(['C990', '2']));
        return linhas;
    }

    linhas.push(fmt.buildLine(['C001', '0']));
    linhas.push(fmt.buildLine([
        'C010',
        fmt.sanitizeCnpjCpf(dados.empresa.cnpj),
        regimeApuracao === '1' ? '1' : '2',
    ]));

    for (const nota of notasC) {
        if (docCancelado(nota) || nota.status === 'denegado') continue;

        const direcao = nota.direcao;
        const indOper = direcao === 'saida' ? '1' : '0';
        const indEmit = direcao === 'saida' ? '0' : '1';

        const participanteRaw = direcao === 'saida'
            ? (nota.destinatario || nota.tomador)
            : (nota.emitente || nota.prestador);
        const codPart = participanteRaw
            ? String(participanteRaw.cnpjCpf || participanteRaw.cnpj || participanteRaw.CNPJ || '').replace(/\D/g, '')
            : '';

        let vProd = 0, vDesc = 0, vPis = 0, vCofins = 0;
        for (const item of (nota.itens || [])) {
            vProd += parseFloat(item.vProd || item.valor || 0);
            vDesc += parseFloat(item.vDesc || 0);
            vPis += parseFloat(item.vPIS || 0);
            vCofins += parseFloat(item.vCOFINS || 0);
        }
        if (vPis === 0) vPis = vProd * aliq.pis;
        if (vCofins === 0) vCofins = vProd * aliq.cofins;

        const chave = nota.chaveAcesso || nota.chave || '';

        linhas.push(fmt.buildLine([
            'C100',
            indOper, indEmit, codPart,
            String(nota.modelo || '55'), '00',
            fmt.sanitizeString(nota.serie || '1', 3),
            fmt.sanitizeString(nota.numero || '', 9),
            fmt.sanitizeString(chave, 44),
            fmt.formatDate(nota.dataEmissao || nota.dhEmi),
            fmt.formatDate(nota.dataEntradaSaida || nota.dhEmi),
            fmt.formatValue(vProd), '',
            fmt.formatValue(vDesc),
            '', '', '', '', '', '',
            fmt.formatValue(vProd), fmt.formatValue(vPis),
            fmt.formatValue(vProd), fmt.formatValue(vCofins),
        ]));

        for (const item of (nota.itens || [])) {
            const vlItem = parseFloat(item.vProd || item.valor || 0);
            const cstPis = getCstPis(item, regimeApuracao, direcao);
            const cstCofins = getCstCofins(item, regimeApuracao, direcao);
            const itemAliqPis = parseFloat(item.aliqPIS || item.pAliquotaPis || 0) || (aliq.pis * 100);
            const itemAliqCofins = parseFloat(item.aliqCOFINS || item.pAliquotaCofins || 0) || (aliq.cofins * 100);
            const itemVlPis = parseFloat(item.vPIS || 0) || (vlItem * aliq.pis);
            const itemVlCofins = parseFloat(item.vCOFINS || 0) || (vlItem * aliq.cofins);

            linhas.push(fmt.buildLine([
                'C170',
                item.nItem || '1',
                fmt.sanitizeString(item.cProd || item.codigo || '', 60),
                fmt.sanitizeString(item.xProd || item.descricao || '', 255),
                fmt.formatValue(item.qCom || item.quantidade || 1, 5),
                fmt.sanitizeString((item.uCom || item.unidade || 'UN').toUpperCase(), 6),
                fmt.formatValue(vlItem),
                fmt.formatValue(item.vDesc || 0),
                '0', cstPis,
                fmt.formatValue(vlItem),
                fmt.formatValue(itemAliqPis, 4),
                '', '',
                fmt.formatValue(itemVlPis),
                cstCofins,
                fmt.formatValue(vlItem),
                fmt.formatValue(itemAliqCofins, 4),
                '', '',
                fmt.formatValue(itemVlCofins),
                fmt.sanitizeString(item.CFOP || item.cfop || '', 4),
                '',
            ]));
        }
    }

    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['C990', totalBloco]));
    return linhas;
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO D — Transporte (CTe modelo 57)
// ═══════════════════════════════════════════════════════════════════════

export function buildBlocoD_Contrib(dados) {
    const linhas = [];
    const notasD = (dados.notas || []).filter(n =>
        String(n.modelo) === '57' && n.tipo === 'CTe'
    );

    if (notasD.length === 0) {
        linhas.push(fmt.buildLine(['D001', '1']));
        linhas.push(fmt.buildLine(['D990', '2']));
        return linhas;
    }

    const regimeApuracao = dados.regimeApuracao || '2';
    const aliq = getAliquotas(regimeApuracao);

    linhas.push(fmt.buildLine(['D001', '0']));
    linhas.push(fmt.buildLine(['D010', fmt.sanitizeCnpjCpf(dados.empresa.cnpj)]));

    for (const nota of notasD) {
        if (docCancelado(nota)) continue;
        const direcao = nota.direcao;
        const indOper = direcao === 'saida' ? '1' : '0';
        const indEmit = direcao === 'saida' ? '0' : '1';

        const participanteRaw = direcao === 'saida'
            ? (nota.destinatario || nota.tomador)
            : (nota.emitente || nota.prestador);
        const codPart = participanteRaw
            ? String(participanteRaw.cnpjCpf || participanteRaw.cnpj || '').replace(/\D/g, '')
            : '';

        const vlDoc = parseFloat(nota.valor || nota.totalNota || 0);
        const vlPis = vlDoc * aliq.pis;
        const vlCofins = vlDoc * aliq.cofins;

        linhas.push(fmt.buildLine([
            'D100',
            indOper, indEmit, codPart,
            '57', '00',
            fmt.sanitizeString(nota.serie || '1', 3),
            '',
            fmt.sanitizeString(nota.numero || '', 9),
            fmt.sanitizeString(nota.chaveAcesso || nota.chave || '', 44),
            fmt.formatDate(nota.dataEmissao || nota.dhEmi),
            fmt.formatDate(nota.dataEmissao || nota.dhEmi),
            fmt.formatValue(vlDoc),
            '', '', '',
            fmt.formatValue(vlDoc), fmt.formatValue(vlPis),
            fmt.formatValue(vlDoc), fmt.formatValue(vlCofins),
        ]));
    }

    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['D990', totalBloco]));
    return linhas;
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO F — Demais Documentos e Operacoes
// ═══════════════════════════════════════════════════════════════════════

export function buildBlocoF(_dados) {
    return [
        fmt.buildLine(['F001', '1']),
        fmt.buildLine(['F990', '2']),
    ];
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO M — Apuracao PIS/COFINS
// ═══════════════════════════════════════════════════════════════════════

export function buildBlocoM(dados) {
    const linhas = [];
    const regimeApuracao = dados.regimeApuracao || '2';
    const aliq = getAliquotas(regimeApuracao);

    linhas.push(fmt.buildLine(['M001', '0']));

    let totalPisSaida = 0, totalCofinsSaida = 0, totalBcSaida = 0;
    let totalPisEntrada = 0, totalCofinsEntrada = 0, totalBcEntrada = 0;
    /** Documento sem valor legível em nenhuma das formas — sai do total e é DITO. */
    const semValor = [];

    for (const nota of (dados.notas || [])) {
        if (docCancelado(nota) || nota.status === 'denegado') continue;

        // 🚨 A ARMADILHA DAS DUAS FORMAS, TERCEIRA VEZ NO MESMO ARQUIVO.
        //
        // A NFS-e do portal de SP não tem `itens` e grava o valor em
        // `valorTotal` — nome que este trecho não lia. Resultado: `vlDoc` = 0
        // para TODA nota de serviço e **M200/M600 saindo 0,00** num arquivo com
        // 37 documentos e PIS/COFINS destacados no A100 (MANTOAN 07/2026).
        // Ou seja, o arquivo declarava à Receita que não havia contribuição a
        // pagar. A régua já existe num lugar só.
        let vlDoc = 0;
        for (const item of (nota.itens || [])) {
            vlDoc += parseFloat(item.vProd || item.valor || 0);
        }
        if (vlDoc === 0) {
            const doDocumento = valorDoDocumentoServico(nota);
            if (Number.isFinite(doDocumento)) {
                vlDoc = doDocumento;
            } else {
                // Ausência NÃO vira zero — foi o zero silencioso que produziu o
                // M200 zerado. A nota sai NOMEADA e fora da conta.
                semValor.push(String(nota.numero || nota.chave || '(sem número)'));
                continue;
            }
        }

        if (nota.direcao === 'saida') {
            totalBcSaida += vlDoc;
            let pis = 0, cofins = 0;
            for (const item of (nota.itens || [])) {
                pis += parseFloat(item.vPIS || 0);
                cofins += parseFloat(item.vCOFINS || 0);
            }
            if (pis === 0) pis = vlDoc * aliq.pis;
            if (cofins === 0) cofins = vlDoc * aliq.cofins;
            totalPisSaida += pis;
            totalCofinsSaida += cofins;
        } else {
            totalBcEntrada += vlDoc;
            let pis = 0, cofins = 0;
            for (const item of (nota.itens || [])) {
                pis += parseFloat(item.vPIS || 0);
                cofins += parseFloat(item.vCOFINS || 0);
            }
            if (pis === 0) pis = vlDoc * aliq.pis;
            if (cofins === 0) cofins = vlDoc * aliq.cofins;
            totalPisEntrada += pis;
            totalCofinsEntrada += cofins;
        }
    }

    // Documento que não teve valor lido não some calado: ele estaria FORA do
    // M200/M600, e um total a menor num arquivo entregue à Receita não tem como
    // ser percebido depois.
    if (semValor.length && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            `Apuração PIS/COFINS (bloco M): ${semValor.length} documento(s) ficaram FORA da base porque o valor `
            + `não foi lido em nenhuma das formas — nº ${semValor.slice(0, 10).join(', ')}`
            + `${semValor.length > 10 ? ` e mais ${semValor.length - 10}` : ''}. `
            + 'O M200/M600 está a MENOR: confira esses documentos antes de transmitir.',
        );
    }

    const isNaoCumulativo = regimeApuracao === '1' || regimeApuracao === '3';

    // M100 — Credito PIS (nao-cumulativo)
    if (isNaoCumulativo && totalPisEntrada > 0) {
        linhas.push(fmt.buildLine([
            'M100', '01', '0',
            fmt.formatValue(totalBcEntrada),
            fmt.formatValue(aliq.pis * 100, 4),
            '', '',
            fmt.formatValue(totalPisEntrada),
            fmt.formatValue(totalPisEntrada),
            fmt.formatValue(0),
            fmt.formatValue(totalPisEntrada),
            fmt.formatValue(0),
            '',
            fmt.formatValue(totalPisEntrada),
            '',
        ]));
    }

    // M200 — Contribuicao PIS do periodo
    const vlContribPis = totalPisSaida;
    const vlCredDescontPis = isNaoCumulativo ? Math.min(totalPisEntrada, vlContribPis) : 0;
    const vlContribARecolherPis = Math.max(vlContribPis - vlCredDescontPis, 0);

    linhas.push(fmt.buildLine([
        'M200',
        fmt.formatValue(totalBcSaida),
        fmt.formatValue(0),
        fmt.formatValue(vlContribARecolherPis),
        fmt.formatValue(vlContribPis),
        fmt.formatValue(0),
        fmt.formatValue(0),
        fmt.formatValue(vlContribARecolherPis),
        fmt.formatValue(0),
        fmt.formatValue(0),
        fmt.formatValue(0),
        fmt.formatValue(vlContribARecolherPis),
        fmt.formatValue(vlContribARecolherPis),
    ]));

    // M210 — Detalhamento PIS por CST
    if (totalPisSaida > 0) {
        linhas.push(fmt.buildLine([
            'M210', '01',
            fmt.formatValue(totalBcSaida),
            fmt.formatValue(aliq.pis * 100, 4),
            '', '',
            fmt.formatValue(totalPisSaida),
            '',
        ]));
    }

    // M500 — Credito COFINS (nao-cumulativo)
    if (isNaoCumulativo && totalCofinsEntrada > 0) {
        linhas.push(fmt.buildLine([
            'M500', '01', '0',
            fmt.formatValue(totalBcEntrada),
            fmt.formatValue(aliq.cofins * 100, 4),
            '', '',
            fmt.formatValue(totalCofinsEntrada),
            fmt.formatValue(totalCofinsEntrada),
            fmt.formatValue(0),
            fmt.formatValue(totalCofinsEntrada),
            fmt.formatValue(0),
            '',
            fmt.formatValue(totalCofinsEntrada),
            '',
        ]));
    }

    // M600 — Contribuicao COFINS do periodo
    const vlContribCofins = totalCofinsSaida;
    const vlCredDescontCofins = isNaoCumulativo ? Math.min(totalCofinsEntrada, vlContribCofins) : 0;
    const vlContribARecolherCofins = Math.max(vlContribCofins - vlCredDescontCofins, 0);

    linhas.push(fmt.buildLine([
        'M600',
        fmt.formatValue(totalBcSaida),
        fmt.formatValue(0),
        fmt.formatValue(vlContribARecolherCofins),
        fmt.formatValue(vlContribCofins),
        fmt.formatValue(0),
        fmt.formatValue(0),
        fmt.formatValue(vlContribARecolherCofins),
        fmt.formatValue(0),
        fmt.formatValue(0),
        fmt.formatValue(0),
        fmt.formatValue(vlContribARecolherCofins),
        fmt.formatValue(vlContribARecolherCofins),
    ]));

    // M610 — Detalhamento COFINS por CST
    if (totalCofinsSaida > 0) {
        linhas.push(fmt.buildLine([
            'M610', '01',
            fmt.formatValue(totalBcSaida),
            fmt.formatValue(aliq.cofins * 100, 4),
            '', '',
            fmt.formatValue(totalCofinsSaida),
            '',
        ]));
    }

    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['M990', totalBloco]));
    return linhas;
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO 1 — Complemento da Escrituracao
// ═══════════════════════════════════════════════════════════════════════

export function buildBloco1_Contrib(_dados) {
    // 🚨 O 1010 QUE ESTAVA AQUI ERA DE OUTRO ARQUIVO.
    //
    // Paulo, 17/08 (MANTOAN 07/2026), com o recibo do PVA: *"O número de campos
    // informado no registro difere do número de campos especificado no leiaute"*
    // — esperado 7, veio 9 — e mais duas recusas em `IND_NAT_ACAO` e
    // `DT_SENT_JUD` recebendo 'N'.
    //
    // A causa: **1010 existe nos DOIS arquivos, com leiautes diferentes.**
    //   EFD ICMS/IPI      1010 = Obrigatoriedade de registros do Bloco 1
    //                     (IND_EXP, IND_CCRF, IND_COMB… — a fileira de 'N')
    //   EFD Contribuições 1010 = Processo Referenciado — AÇÃO JUDICIAL
    //                     (NUM_PROC, ID_SEC_JUD, ID_VARA, IND_NAT_ACAO,
    //                      DESC_DEC_JUD, DT_SENT_JUD) = 7 campos
    //
    // Ou seja, o gerador declarava um PROCESSO JUDICIAL preenchendo os campos
    // com 'N'. Número igual, arquivo diferente — a mesma família do IPI que foi
    // parar em E200/E210 (04/08), que são registros do ICMS-ST.
    //
    // ⚠️ E NÃO SE INVENTA O 1010 CERTO: ele só existe quando a empresa TEM ação
    // judicial referenciada, e isso é dado que ninguém cadastrou. Bloco sem
    // dados se declara SEM DADOS.
    const conteudo = [];
    // IND_MOV: 0 = bloco COM dados · 1 = sem dados. Sai do que foi REALMENTE
    // produzido — registro novo aqui vira '0' sozinho, sem ninguém lembrar.
    return [
        fmt.buildLine(['1001', conteudo.length ? '0' : '1']),
        ...conteudo,
        fmt.buildLine(['1990', String(conteudo.length + 2)]),
    ];
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO 9 — Controle e Encerramento do Arquivo
// ═══════════════════════════════════════════════════════════════════════

export function buildBloco9_Contrib(linhasAnteriores) {
    const linhas = [];

    linhas.push(fmt.buildLine(['9001', '0']));

    const contagem = {};
    for (const linha of linhasAnteriores) {
        const parts = linha.split('|');
        if (parts.length >= 2 && parts[1]) {
            const tipo = parts[1];
            contagem[tipo] = (contagem[tipo] || 0) + 1;
        }
    }

    const tiposDistintos = Object.keys(contagem).sort();
    const num9900 = tiposDistintos.length + 4;
    contagem['9001'] = 1;
    contagem['9900'] = num9900;
    contagem['9990'] = 1;
    contagem['9999'] = 1;

    for (const tipo of Object.keys(contagem).sort()) {
        linhas.push(fmt.buildLine(['9900', tipo, contagem[tipo]]));
    }

    const linhasBloco9 = linhas.length + 2;
    linhas.push(fmt.buildLine(['9990', linhasBloco9]));

    const totalLinhas = linhasAnteriores.length + linhas.length + 1;
    linhas.push(fmt.buildLine(['9999', totalLinhas]));

    return linhas;
}
