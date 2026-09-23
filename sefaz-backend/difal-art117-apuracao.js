// ============================================================================
// sefaz-backend/difal-art117-apuracao.js  (PURO — testável)
// ----------------------------------------------------------------------------
// DIFAL de aquisição DENTRO DA APURAÇÃO — o desenho do RICMS/SP art. 117.
//
// 🧭 Paulo, 14/09, fechando a HYPE CAFÉ (1385, Lucro Presumido): *"o
// diferencial de alíquota nas aquisições dela é dentro da apuração, precisamos
// criar um campo para fazermos um ajuste; no EFISCAL lançamos dentro da nota,
// depois fazemos esse ajuste para sair na apuração"*.
//
// 📖 O QUE A LEI MANDA (RICMS/SP art. 117): na entrada interestadual de
// mercadoria para USO/CONSUMO ou ATIVO, o contribuinte do RPA escritura no
// Registro de Apuração:
//   I  — como CRÉDITO ("Outros Créditos"), o imposto pago na ORIGEM — o ICMS
//        destacado na nota do fornecedor;
//   II — como DÉBITO ("Outros Débitos"), o imposto pela ALÍQUOTA INTERNA sobre
//        a base de cálculo.
// A diferença entre os dois é o DIFAL — e ele NÃO sai numa guia à parte: sai
// no saldo do E110, junto do ICMS próprio.
//
// 📐 A BASE É "POR DENTRO" (art. 37, §5º do RICMS/SP — base única, com o
// imposto interno incluído; art. 49 — o imposto integra a própria base):
//     base = (valor da operação − ICMS da origem) ÷ (1 − alíquota interna)
// Corroborado CENTAVO A CENTAVO pelo e-Fiscal na nota da HYPE (print de 14/09):
//     166,10 (MERCADO LIVRE, MG, 12%) → ICMS origem 19,93
//     base = (166,10 − 19,93) ÷ 0,82 = 178,26
//     débito = 178,26 × 18% = 32,09 (art. 117, II) · crédito = 19,93 (art. 117, I)
//     diferença = 12,15
// E o Registro de Apuração do e-Fiscal fecha: 1.204,16 + 32,09 − 19,93 = 1.216,32.
//
// ✂️ O QUE ESTE DONO DECIDE — e o que ele SE RECUSA a decidir:
//   · a nota candidata é a ENTRADA interestadual com item de uso/consumo ou
//     ativo (a MESMA família de CFOP do C197, `CFOPS_DIFAL_AQUISICAO`), lida
//     pelo CFOP **ESCRITURADO** (quem vende emite 6102 — para a Kalunga, para o
//     Mercado Livre, aquilo é venda de mercadoria; o destino "uso/consumo" é
//     decisão do cliente, no ✏️ CFOP por nota ou no cérebro). O resolvedor do
//     CFOP é ARGUMENTO: ler o CFOP cru do XML aqui repetiria o caso KALUNGA
//     (18/08) e deixaria a HYPE sem DIFAL.
//   · o app PROPÕE (base por dentro, alíquota interna padrão, ICMS destacado
//     dos itens) e a pessoa CONFIRMA ou INFORMA — é o "campo dentro da nota"
//     do e-Fiscal. O informado vence a proposta, carimbado com quem e quando.
//   · "DIFAL não devido nesta nota" é decisão LEGÍTIMA (o próprio e-Fiscal
//     avisa: *"Preencha os campos somente se nessa operação o Diferencial de
//     Alíquotas for devido"* — o caso do Comunicado CAT 26/2008, mercadoria com
//     antecipação do 426-A). Ela sai NOMEADA, nunca calada.
//   · os CÓDIGOS dos dois E111 (tabela 5.1.1 da UF) NÃO se inventam: entram
//     pelo cadastro, e o app confere pela ESTRUTURA que ele consegue provar —
//     UF da empresa, 3º caractere '0' (apuração própria), 4º caractere '0' no
//     débito e '2' no crédito. Código de estorno no lugar do crédito é recusa
//     nomeada, nunca linha no arquivo.
//   · SEM OS DOIS CÓDIGOS NÃO SAI NENHUM: só o débito recolheria 32,09 no lugar
//     de 12,15 (a maior, e o PVA aceita); só o crédito recolheria a menos. O
//     par é tudo ou nada, e a falta vai DITA com o total que ficou de fora.
//
// ⚠️ ICMS destacado ZERO no item (CST 40/41, ou XML sem o campo) NÃO vira
// crédito derivado: derivar seria inventar crédito. Fica zero e sai avisado —
// o débito pela interna continua devido.
// ============================================================================
import { CFOPS_DIFAL_AQUISICAO, aliqInterestadual } from './sped-difal-c197.js';
import { ufEmitente, cfopNaOticaDeEntrada, nomeEmitente, cnpjEmitente } from './participante-doc-helper.js';
import { docCancelado, direcaoEfetivaDoc } from './xml-metadata-helper.js';
import { validarCodigoAjuste } from './sped-ajustes-apuracao.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const brl = (n) => r2(n).toFixed(2).replace('.', ',');

/** Alíquota interna padrão quando a empresa não informou outra (SP: 18%). */
export const ALIQ_INTERNA_PADRAO = 18;

/**
 * Base "por dentro" do DIFAL (RICMS/SP art. 37 §5º + art. 49):
 *   (valor da operação − ICMS da origem) ÷ (1 − alíquota interna/100).
 * Alíquota fora de (0, 100) devolve null — dividir por zero não é base.
 */
export function baseDifalPorDentro(valorOperacao, icmsOrigem, aliqInterna) {
    const aliq = num(aliqInterna);
    if (!(aliq > 0) || aliq >= 100) return null;
    const liquido = num(valorOperacao) - num(icmsOrigem);
    if (!(liquido > 0)) return 0;
    return r2(liquido / (1 - aliq / 100));
}

/**
 * Os dois lançamentos do art. 117 a partir da base:
 *   débito (II) = base × alíquota interna · crédito (I) = ICMS da origem.
 */
export function calcularArt117({ base, aliqInterna, icmsDestacado }) {
    const debito = r2(num(base) * num(aliqInterna) / 100);
    const credito = r2(num(icmsDestacado));
    return { debito, credito, diferenca: r2(debito - credito) };
}

/**
 * A PROPOSTA do app para UMA nota — ou null quando a nota não é candidata.
 *
 * @param {object} nota
 * @param {object} p
 * @param {string} p.ufEmpresa
 * @param {number} p.aliqInterna
 * @param {(nota:object, item:object)=>string} p.cfopDoItem  o CFOP ESCRITURADO
 *        do item (a régua do bloco C) — OBRIGATÓRIO: sem ele o dono lê o CFOP
 *        cru e a nota do Mercado Livre (6102) some do DIFAL.
 */
export function propostaDifalDaNota(nota, { ufEmpresa, aliqInterna, cfopDoItem }) {
    if (typeof cfopDoItem !== 'function') {
        throw new Error('propostaDifalDaNota: `cfopDoItem` (o CFOP escriturado do item) é obrigatório.');
    }
    if (!nota || direcaoEfetivaDoc(nota) !== 'entrada' || docCancelado(nota)) return null;
    const ufOrigem = ufEmitente(nota);
    const ufDestino = String(ufEmpresa || '').toUpperCase();
    if (!ufOrigem || !ufDestino || ufOrigem === ufDestino) return null;

    let valorOperacao = 0;
    let icmsDestacado = 0;
    let itens = 0;
    let aliqInterDerivada = false;
    const cfops = new Set();
    for (const item of (nota.itens || [])) {
        const cfop = cfopNaOticaDeEntrada(cfopDoItem(nota, item) || item?.cfop);
        if (!CFOPS_DIFAL_AQUISICAO.has(cfop)) continue;
        const vItem = num(item?.vBC) || num(item?.vProd);
        if (vItem <= 0) continue;
        itens += 1;
        cfops.add(cfop);
        valorOperacao = r2(valorOperacao + vItem);
        icmsDestacado = r2(icmsDestacado + num(item?.vICMS));
        aliqInterDerivada = aliqInterDerivada || aliqInterestadual(item, ufOrigem).derivada;
    }
    if (itens === 0) return null;

    const aliq = num(aliqInterna) > 0 ? num(aliqInterna) : ALIQ_INTERNA_PADRAO;
    const base = baseDifalPorDentro(valorOperacao, icmsDestacado, aliq);
    return {
        chave: String(nota.chave || nota.id || ''),
        numero: String(nota.numero || ''),
        emitente: nomeEmitente(nota),
        cnpjEmitente: cnpjEmitente(nota),
        ufOrigem,
        cfops: [...cfops].sort(),
        itens,
        valorOperacao,
        icmsDestacado,
        icmsDestacadoZero: icmsDestacado <= 0,
        aliqInterDerivada,
        aliqInterna: aliq,
        base: base ?? 0,
        ...calcularArt117({ base: base ?? 0, aliqInterna: aliq, icmsDestacado }),
        origem: 'proposta',
    };
}

/**
 * Aplica o que a PESSOA informou por cima da proposta. Campo em branco mantém
 * a proposta; `naoDevido` tira a nota do ajuste (nomeada, nunca calada).
 */
export function aplicarInformado(proposta, informado) {
    if (!proposta) return null;
    if (!informado || typeof informado !== 'object') return proposta;
    const carimbo = {
        informadoPor: informado.por || informado.informadoPor || null,
        informadoEm: informado.em || informado.informadoEm || null,
        motivo: String(informado.motivo || '').trim() || null,
    };
    if (informado.naoDevido === true) {
        return { ...proposta, ...carimbo, origem: 'nao-devido', debito: 0, credito: 0, diferenca: 0 };
    }
    const temValor = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
    const aliqInterna = temValor(informado.aliqInterna) && num(informado.aliqInterna) > 0
        ? num(informado.aliqInterna) : proposta.aliqInterna;
    const icmsDestacado = temValor(informado.icmsDestacado) ? r2(num(informado.icmsDestacado)) : proposta.icmsDestacado;
    // Base informada vence; senão ela é RECALCULADA por dentro com a alíquota e
    // o destacado que valem agora (mudar a alíquota muda a base).
    const base = temValor(informado.base)
        ? r2(num(informado.base))
        : (baseDifalPorDentro(proposta.valorOperacao, icmsDestacado, aliqInterna) ?? 0);
    const mudou = aliqInterna !== proposta.aliqInterna || icmsDestacado !== proposta.icmsDestacado
        || base !== proposta.base;
    return {
        ...proposta,
        ...carimbo,
        aliqInterna, icmsDestacado, base,
        icmsDestacadoZero: icmsDestacado <= 0,
        ...calcularArt117({ base, aliqInterna, icmsDestacado }),
        origem: mudou ? 'informada' : 'proposta',
    };
}

/**
 * Confere os DOIS códigos da tabela 5.1.1 pela estrutura: UF da empresa,
 * apuração própria e o TIPO certo (4º caractere '0' débito · '2' crédito).
 */
export function validarCodigosArt117({ codigoDebito, codigoCredito, ufEmpresa }) {
    const um = (codigo, tipoEsperado, papel) => {
        const cod = String(codigo || '').trim().toUpperCase();
        if (!cod) return { codigo: '', ok: false, erro: `Falta o código do ${papel} (tabela 5.1.1 da UF).` };
        const v = validarCodigoAjuste(cod, ufEmpresa);
        if (!v.ok) return { codigo: cod, ok: false, erro: v.erro };
        if (v.apuracao !== 'proprio') {
            return { codigo: cod, ok: false, erro: `Código ${cod} não é da apuração PRÓPRIA (3º caractere '${cod[2]}') — o art. 117 lança no E111.` };
        }
        if (v.tipo !== tipoEsperado) {
            return {
                codigo: cod, ok: false,
                erro: `Código ${cod} é de tipo '${cod[3]}' e o ${papel} exige 4º caractere '${tipoEsperado}' `
                    + `(${tipoEsperado === 0 ? 'Outros débitos' : 'Outros créditos'}). Código de outro tipo iria ao campo errado do E110.`,
            };
        }
        return { codigo: cod, ok: true, erro: null };
    };
    return {
        debito: um(codigoDebito, 0, 'DÉBITO pela alíquota interna (art. 117, II)'),
        credito: um(codigoCredito, 2, 'CRÉDITO do imposto da origem (art. 117, I)'),
    };
}

const descricaoE111 = (papel, ufEmpresa, n) => {
    const artigo = String(ufEmpresa || '').toUpperCase() === 'SP'
        ? (papel === 'debito' ? ' - RICMS/SP art. 117, II' : ' - RICMS/SP art. 117, I')
        : '';
    return papel === 'debito'
        ? `DIFAL aquisicao uso/consumo/ativo - imposto pela aliquota interna${artigo} (${n} nota(s))`
        : `DIFAL aquisicao uso/consumo/ativo - imposto destacado na origem${artigo} (${n} nota(s))`;
};

/**
 * O CONSOLIDADO da competência: por nota (proposta × informado), totais e o
 * par de E111 que entra no E110 — ou os avisos que dizem por que não entrou.
 *
 * @param {object} p
 * @param {object[]} p.notas
 * @param {string}  p.ufEmpresa
 * @param {number}  [p.aliqInternaPadrao]
 * @param {(nota:object,item:object)=>string} p.cfopDoItem
 * @param {Record<string, object>} [p.informadoPorChave]
 * @param {string} [p.codigoDebito]
 * @param {string} [p.codigoCredito]
 * @param {string} [p.codigoC197]  o COD_AJ da tabela 5.3 cadastrado para o C197 (se houver)
 */
export function consolidarDifalArt117({
    notas, ufEmpresa, aliqInternaPadrao = ALIQ_INTERNA_PADRAO, cfopDoItem,
    informadoPorChave = {}, codigoDebito = '', codigoCredito = '', codigoC197 = '',
}) {
    const avisos = [];
    const porNota = [];
    for (const nota of (notas || [])) {
        const proposta = propostaDifalDaNota(nota, { ufEmpresa, aliqInterna: aliqInternaPadrao, cfopDoItem });
        if (!proposta) continue;
        porNota.push(aplicarInformado(proposta, informadoPorChave[proposta.chave]));
    }

    const noAjuste = porNota.filter((n) => n.origem !== 'nao-devido');
    const naoDevidas = porNota.filter((n) => n.origem === 'nao-devido');
    const soma = (campo) => r2(noAjuste.reduce((a, n) => a + num(n[campo]), 0));
    const totais = {
        notas: noAjuste.length,
        naoDevidas: naoDevidas.length,
        valorOperacao: soma('valorOperacao'),
        icmsDestacado: soma('icmsDestacado'),
        base: soma('base'),
        debito: soma('debito'),
        credito: soma('credito'),
        diferenca: soma('diferenca'),
    };
    const codigos = validarCodigosArt117({ codigoDebito, codigoCredito, ufEmpresa });
    const ajustes = [];

    if (porNota.length === 0) {
        return { porNota, totais, codigos, ajustes, avisos };
    }

    if (naoDevidas.length) {
        avisos.push(
            `${naoDevidas.length} nota(s) marcada(s) como "DIFAL não devido" ficaram FORA do ajuste: `
            + naoDevidas.map((n) => `nº ${n.numero || n.chave.slice(-9)}${n.motivo ? ` (${n.motivo})` : ''}`).join(', ') + '.',
        );
    }
    if (noAjuste.some((n) => n.icmsDestacadoZero)) {
        const zeradas = noAjuste.filter((n) => n.icmsDestacadoZero).map((n) => `nº ${n.numero || n.chave.slice(-9)}`);
        avisos.push(
            `${zeradas.length} nota(s) sem ICMS destacado no item (${zeradas.join(', ')}): o crédito do art. 117, I `
            + 'saiu ZERO e o débito pela interna continua devido. Se a nota destacou ICMS e o item não trouxe, informe o valor na aba.',
        );
    }
    if (noAjuste.some((n) => n.aliqInterDerivada)) {
        avisos.push('Em pelo menos uma nota a alíquota interestadual não estava destacada e foi derivada da UF de origem — confira.');
    }

    if (noAjuste.length === 0) {
        return { porNota, totais, codigos, ajustes, avisos };
    }

    const prontos = codigos.debito.ok && codigos.credito.ok;
    if (!prontos) {
        avisos.push(
            `${noAjuste.length} nota(s) de entrada interestadual de uso/consumo/ativo geram DIFAL na apuração `
            + `(débito R$ ${brl(totais.debito)} pela alíquota interna − crédito R$ ${brl(totais.credito)} da origem = `
            + `R$ ${brl(totais.diferenca)}), mas NADA entrou no E110: `
            + [codigos.debito.erro, codigos.credito.erro].filter(Boolean).join(' ')
            + ' Cadastre os DOIS códigos em SPED Fiscal → Ajustes E111 → "DIFAL de aquisição na apuração". '
            + 'Só o débito recolheria a MAIOR; só o crédito, a MENOR — por isso o par é tudo ou nada.',
        );
        return { porNota, totais, codigos, ajustes, avisos };
    }

    if (totais.debito > 0) {
        ajustes.push({ codigo: codigos.debito.codigo, descricao: descricaoE111('debito', ufEmpresa, noAjuste.length), valor: totais.debito, origem: 'difal-art117' });
    }
    if (totais.credito > 0) {
        ajustes.push({ codigo: codigos.credito.codigo, descricao: descricaoE111('credito', ufEmpresa, noAjuste.length), valor: totais.credito, origem: 'difal-art117' });
    }
    avisos.push(
        `DIFAL de aquisição na apuração (art. 117): ${noAjuste.length} nota(s) · débito R$ ${brl(totais.debito)} `
        + `(${codigos.debito.codigo}) e crédito R$ ${brl(totais.credito)} (${codigos.credito.codigo}) entraram no E110 pelo E111 — `
        + `diferença R$ ${brl(totais.diferenca)}. ${porNota.some((n) => n.origem === 'informada') ? 'Há nota com valor INFORMADO à mão (carimbado na aba). ' : ''}`
        + 'Confira a base por nota em SPED Fiscal → Ajustes E111 → DIFAL de aquisição na apuração.',
    );

    // 🚨 O C197 com 4º caractere '0' (ou 3-8) entra no E110 pelos campos 03/07
    // por regra do Guia (R38). Com o par E111 também no arquivo, o mesmo DIFAL
    // seria declarado DUAS vezes — o app não escolhe, mas DIZ.
    const c197 = String(codigoC197 || '').trim().toUpperCase();
    if (c197.length >= 4 && ['0', '3', '4', '5', '6', '7', '8'].includes(c197[3])) {
        avisos.push(
            `ATENÇÃO: o código do C197 cadastrado (${c197}) tem 4º caractere '${c197[3]}', que o Guia soma nos campos 03/07 do E110 — `
            + 'com o par E111 do art. 117 o DIFAL sairia DUAS vezes. Se o C197 for só informativo, o 4º caractere é \'2\'; '
            + 'senão, escolha UM dos dois caminhos.',
        );
    }

    return { porNota, totais, codigos, ajustes, avisos };
}
