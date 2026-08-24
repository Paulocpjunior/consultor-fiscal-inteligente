/**
 * sped-contrib-campos — a CONTAGEM DE CAMPOS por registro, conferida antes de o
 * arquivo sair.
 *
 * ═══ POR QUE ESTE MÓDULO EXISTE ═════════════════════════════════════════════
 *
 * Duas recusas do PVA em dois dias, no MESMO cliente (MANTOAN 07/2026), foram a
 * MESMA CLASSE de defeito — *"O número de campos informado no registro difere do
 * número de campos especificado no leiaute"*:
 *
 *   • 17/08 — **1010**: esperado 7, veio 9 (era o 1010 do EFD ICMS/IPI);
 *   • 18/08 — **M210 e M610**: esperado 16, veio 8.
 *
 * E o M210 mostra por que a classe é perigosa: **faltando campos do meio, a
 * ALÍQUOTA cai na casa da BASE DE CÁLCULO**. O arquivo passou a declarar base de
 * R$ 0,65 com contribuição de R$ 285,28 — os valores estavam certos, a FORMA é
 * que estava errada. Nenhum teste de unidade pega isso: cada função fazia
 * exatamente o que o próprio teste mandava (a família do IPI em E200 e do Bloco
 * H zerado).
 *
 * A auditoria de saída (`sped-auditoria-saida.js`) também não pega: ela vigia
 * COLUNA ZERADA e TOTAL QUE NÃO BATE — perguntas sobre o conteúdo. Esta é uma
 * pergunta sobre a ESTRUTURA, e faltava.
 *
 * ═══ A REGRA QUE MANDA AQUI: SÓ SE CONFERE O QUE ESTÁ PROVADO ═══════════════
 *
 * Uma tabela de contagens escrita de memória seria uma SEGUNDA CÓPIA do mesmo
 * palpite que produziu o defeito — e pior, um alarme falso num registro certo
 * ensinaria a equipe a ignorar o alarme. Por isso cada entrada carrega a FONTE,
 * e registro sem fonte **não é conferido** (nem é acusado): ele volta NOMEADO em
 * `naoConferidos`, para quem lê saber que o silêncio ali não é aprovação.
 *
 * Fonte mais forte que existe: o **próprio PVA dizendo o número esperado**. É
 * ele quem valida, então não é dedução — é a régua falando. Arquivo ACEITO pelo
 * PVA vale igual (a lição "arquivo aceito > leiaute deduzido", pela quinta vez).
 *
 * 📌 **REGISTRO NOVO ENTRA AQUI COM A FONTE JUNTO, NO MESMO PR** — mesma regra
 * dos `TOTAIS_VIGIADOS`/`DETALHES_VIGIADOS` da auditoria de saída.
 */

import {
    conferirCodModContraChave, conferirDtDocNoPeriodo, POS_DT_FIN_CONTRIBUICOES,
} from './sped-c100-regras-comuns.js';

/**
 * Contagem de campos INCLUINDO o REG, que é como o PVA conta ("Valor Esperado
 * 16" para uma linha que começa em M210).
 */
export const CAMPOS_POR_REGISTRO = {
    // 🚨 O 0500 do EFD-Contribuições NÃO é o do EFD ICMS/IPI — este termina no
    // NOME_CTA_REF; o do outro arquivo tem um COD_CCUS a mais. O gerador saiu
    // com 9 e Paulo pegou a olho (24/08: *"uma está com 4 barrinhas e a outra
    // com 3"*). É a MESMA classe do 1010 de 17/08: mesmo número de registro,
    // leiaute de outro arquivo. Esta trava existia desde 18/08 e ficava MUDA
    // porque o 0500 não estava nela.
    // ⚠️ A contagem inclui o PRÓPRIO REG, porque é assim que o PVA conta (ele
    // disse "Esperado 16" para o M210, que tem 15 campos depois do REG).
    '0500': {
        campos: 9,
        fonte: 'EFD-Contribuições ACEITO do CF BANK 38406148000101 · 06/2026 (e-Fiscal, assinado): '
            + '|0500|01012026|04|A|5|30106030012|RENDIMENTOS FINANCEIROS||| — DT_ALT · COD_NAT_CC · '
            + 'IND_CTA · NIVEL · COD_CTA · NOME_CTA · COD_CTA_REF · NOME_CTA_REF.',
    },
    F100: {
        campos: 19,
        fonte: 'EFD-Contribuições ACEITO do CF BANK 38406148000101 · 06/2026 (e-Fiscal, assinado) e da '
            + 'PEC PRONTA ENTREGA 55070577000161 · 05/2026 — '
            + '|F100|1|||30062026|21647,53|02|…|4|865,9|||30106030012|||.',
    },
    F550: {
        campos: 16,
        fonte: 'EFD-Contribuições ACEITO da AFFITTARE 17213641000127 · 05/2026 (e-Fiscal, assinado): '
            + '|F550|21811,34|01|0|21811,34|0,65|141,76|01|0|21811,34|3|654,33||||| — 11 valores + os '
            + 'quatro últimos campos (COD_MOD, CFOP, COD_CTA, INFO_COMPL) vazios.',
    },
    M210: {
        campos: 16,
        fonte: 'Recibo do PVA — MANTOAN 13344638000191 07/2026, 18/08/2026: '
            + '"Número de Campos · Valor Esperado 16 · Conteúdo do Campo 8".',
    },
    M610: {
        campos: 16,
        fonte: 'Recibo do PVA — MANTOAN 13344638000191 07/2026, 18/08/2026: '
            + '"Número de Campos · Valor Esperado 16 · Conteúdo do Campo 8".',
    },
    A100: {
        campos: 21,
        fonte: 'Recibo do PVA — MANTOAN 07/2026, 18/08/2026: ele nomeou "5 - COD_SIT" e '
            + '"13 - IND_PGTO" sobre a linha do A100, o que fixa as posições, e NÃO acusou '
            + 'contagem de campos nessa linha (21 como ela saiu).',
    },
    C100: {
        campos: 29,
        fonte: 'Recibo do PVA — PWR INDUSTRIA METALURGICA 31947349000169 07/2026, 20/08/2026: '
            + '"Número de Campos · Valor Esperado 29 · Conteúdo do Campo 24" (9 ocorrências). '
            + 'Corroborado pelo EFD-Contribuições ACEITO da mesma empresa (03/2026, e-Fiscal).',
    },
    C170: {
        campos: 37,
        fonte: 'Recibo do PVA — PWR 31947349000169 07/2026, 20/08/2026: "Número de Campos · '
            + 'Valor Esperado 37 · Conteúdo do Campo 23" (23 ocorrências). Corroborado pelo '
            + 'EFD-Contribuições ACEITO da mesma empresa (03/2026), que traz os 37.',
    },
    M205: {
        campos: 4,
        fonte: 'EFD-Contribuições ACEITO da PWR 31947349000169 · 03/2026 (e-Fiscal, assinado): '
            + '|M205|12|810902|104,36| — REG · NUM_CAMPO · COD_REC · VL_DEBITO.',
    },
    M605: {
        campos: 4,
        fonte: 'EFD-Contribuições ACEITO da PWR 31947349000169 · 03/2026: |M605|12|217201|481,66|.',
    },
    1010: {
        campos: 7,
        fonte: 'Recibo do PVA — MANTOAN 13344638000191 07/2026, 17/08/2026: '
            + '"Número de Campos · Valor Esperado 7 · Conteúdo do Campo 9". '
            + 'É o 1010 de Processo Referenciado (ação judicial), NÃO o do EFD ICMS/IPI.',
    },
};

/**
 * Posições nomeadas pelo PVA. Servem para a mensagem DIZER o que foi parar no
 * lugar errado, em vez de só apontar a contagem — foi o "VL_BC_CONT recebendo
 * 0,6500" que explicou o M210 em um segundo.
 */
export const CAMPO_NOMEADO = {
    M210: { 4: 'VL_BC_CONT' },
    M610: { 4: 'VL_BC_CONT' },
    // O PVA da PWR nomeou estas posições sobre o C170 truncado — é por elas que
    // se enxerga o deslocamento: com a seção de ICMS/IPI pulada, a BASE do PIS
    // caiu na casa do CFOP e a ALÍQUOTA na do VL_ICMS_ST.
    C170: { 10: 'CST_ICMS', 11: 'CFOP', 18: 'VL_ICMS_ST', 21: 'COD_ENQ' },
};

/** Divide a linha do SPED em campos, do jeito que o PVA conta. */
export function camposDaLinha(linha) {
    // ⚠️ A linha vem do `buildLine` COM o CRLF colado. Sem tirá-lo, o `\r\n` vira
    // um 17º campo e a conferência acusaria TODO registro certo — alarme falso
    // que aparece justamente quando está tudo bem é o que ensina a ignorar o
    // alarme. Pego pelo próprio teste, contra a linha real do gerador.
    const s = String(linha == null ? '' : linha).replace(/\r?\n$/, '');
    if (!s.startsWith('|')) return [];
    // A linha é |A|B|C| — o split devolve '' na ponta de cada lado.
    const partes = s.split('|');
    partes.shift();
    if (partes.length && partes[partes.length - 1] === '') partes.pop();
    return partes;
}

/**
 * Confere as linhas produzidas contra as contagens PROVADAS.
 *
 * Devolve `{ erros, naoConferidos, ok }`. **Nunca lança**: a geração não pode
 * morrer por causa da conferência — mas o erro sai NOMEADO, com o registro, a
 * contagem e (quando se sabe) o campo que ficou no lugar errado.
 */
export function conferirContagemDeCampos(linhas) {
    const erros = [];
    const vistos = new Set();
    const naoConferidosSet = new Set();

    (Array.isArray(linhas) ? linhas : []).forEach((linha, i) => {
        const campos = camposDaLinha(linha);
        if (!campos.length) return;
        const reg = String(campos[0] || '').trim();
        if (!reg) return;
        vistos.add(reg);

        const esperado = CAMPOS_POR_REGISTRO[reg];
        if (!esperado) { naoConferidosSet.add(reg); return; }
        if (campos.length === esperado.campos) return;

        // A causa junto do número: qual campo o PVA vai acusar como inválido.
        const nomeado = (CAMPO_NOMEADO[reg] || {})[4];
        const conteudo4 = campos[3];
        const pista = (nomeado && campos.length < esperado.campos && conteudo4)
            ? ` O campo ${nomeado} está recebendo "${conteudo4}" — com campos faltando no meio, o valor seguinte ocupa a casa errada.`
            : '';

        erros.push({
            registro: reg,
            linha: i + 1,
            esperado: esperado.campos,
            recebido: campos.length,
            fonte: esperado.fonte,
            mensagem: `${reg}: o leiaute tem ${esperado.campos} campos e a linha saiu com `
                + `${campos.length}. O PVA recusa o arquivo inteiro.${pista}`,
        });
    });

    return {
        erros,
        // Registro emitido que ninguém provou ainda — silêncio aqui NÃO é
        // aprovação, e dizer isso é o que impede a tabela de envelhecer calada.
        naoConferidos: [...naoConferidosSet].sort(),
        ok: erros.length === 0,
    };
}

/** Avisos prontos para entrar na lista que a geração já devolve. */
export function avisosDeContagemDeCampos(linhas) {
    return conferirContagemDeCampos(linhas).erros.map(e => `🚨 ${e.mensagem}`);
}

// ═══ O PERFIL DO ARQUIVO — recusa REAL do PVA, 21/08 ════════════════════════
//
// AFFITTARE 1139 · 07/2026 (Paulo: *"está puxando a NFS de serviços tomados…
// tem que ter a opção apenas para o que gera receita"*). Com a receita
// escriturada de forma CONSOLIDADA (F550 ⇒ 0110 com IND_REG_CUM = 2), o
// documento no arquivo volta recusado, literalmente:
//
//   "O registro não deve ser informado para esse perfil e/ou tipo de operação.
//    Consulte o guia prático da EFD-Contribuições e verifique a obrigatoriedade
//    dos registros na Seção 4 - Obrigatoriedade dos Registros"
//
// Corroborado pelo EFD-Contribuições ACEITO da própria empresa (05/2026): F550
// preenchido e os blocos A/C/D **vazios**.
//
// ⚠️ Confere o ARQUIVO, não a intenção do gerador — a entrada são as LINHAS, o
// mesmo texto que o PVA lê. Auditar o objeto em memória foi o que deixou o
// C100 sair com modelo 55 e chave 65 por meses sem nenhum teste acusar.

/** Registros de DOCUMENTO que o perfil consolidado não admite. */
const REGISTROS_DE_DOCUMENTO = ['A010', 'A100', 'A170', 'C010', 'C100', 'C170', 'D010', 'D100'];

/** O IND_REG_CUM declarado no 0110 (campo 5), ou '' quando não há 0110. */
export function indRegCumDoArquivoGerado(linhas) {
    for (const linha of (Array.isArray(linhas) ? linhas : [])) {
        const campos = camposDaLinha(linha);
        if (String(campos[0] || '').trim() === '0110') return String(campos[4] || '').trim();
    }
    return '';
}

/**
 * O arquivo se contradiz? (consolidado declarando documento)
 *
 * Devolve `{ erros }` — nunca lança, e fica em silêncio quando o arquivo é
 * DETALHADO (IND_REG_CUM 9): ali o PVA ACEITOU os documentos (MANTOAN,
 * 18/08), e mexer em arquivo aceito sem recusa que mande é inventar leiaute.
 */
export function conferirPerfilConsolidado(linhas) {
    const erros = [];
    if (indRegCumDoArquivoGerado(linhas) !== '2') return { erros };

    const porRegistro = new Map();
    (Array.isArray(linhas) ? linhas : []).forEach((linha, i) => {
        const reg = String(camposDaLinha(linha)[0] || '').trim();
        if (!REGISTROS_DE_DOCUMENTO.includes(reg)) return;
        if (!porRegistro.has(reg)) porRegistro.set(reg, { registro: reg, linha: i + 1, quantidade: 0 });
        porRegistro.get(reg).quantidade += 1;
    });

    for (const item of porRegistro.values()) {
        erros.push({
            ...item,
            fonte: 'PVA: "O registro não deve ser informado para esse perfil e/ou tipo de operação" '
                + '(AFFITTARE 1139 · 07/2026, 21/08).',
            mensagem: `${item.registro}: o arquivo é CONSOLIDADO (0110 com IND_REG_CUM 2, porque a receita `
                + `vem do F550) e mesmo assim declara ${item.quantidade} registro(s) de documento — o PVA `
                + 'recusa a importação com "O registro não deve ser informado para esse perfil". No regime '
                + 'cumulativo o serviço TOMADO não gera crédito: tirá-lo não muda a apuração.',
        });
    }
    return { erros };
}

/** Avisos prontos para a lista que a geração já devolve. */
export function avisosDePerfilConsolidado(linhas) {
    return conferirPerfilConsolidado(linhas).erros.map(e => `🚨 ${e.mensagem}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 AS RECUSAS DO PVA QUE FORAM APRENDIDAS E NUNCA VIRARAM REGRA
//
// A régua da casa é *"recusa aprendida entra na prevalidação no MESMO PR"* — o
// EFD ICMS/IPI tem 15 regras assim. Do lado do EFD-Contribuições havia só duas,
// e três recusas REAIS de 2026 tinham sido corrigidas **só no gerador**:
// consertar o gerador fecha a INSTÂNCIA, a regra fecha a CLASSE. Sem elas, a
// próxima empresa gasta uma volta de PVA descobrindo o mesmo.
//
// Todas leem as **LINHAS** do arquivo gerado — o mesmo texto que o validador
// lê. Auditar o objeto em memória foi o que deixou o C100 sair com modelo 55 e
// chave 65 por meses sem nenhum teste acusar.
// ═══════════════════════════════════════════════════════════════════════════

/** O documento é de ENTRADA? (A100/C100 campo 2, IND_OPER: '0' = entrada) */
function ehDocumentoDeEntrada(campos) {
    return String(campos[1] || '').trim() === '0';
}

/**
 * COD_ITEM vazio em A170/C170.
 *
 * FONTE: PVA da CLINICA MEDICA MANTOAN 07/2026 (18/08) — **36 recusas** de
 * "Campo obrigatório · COD_ITEM" nos A170 sintéticos da NFS-e sem
 * discriminação. E as 2 recusas de M205/M605 ("registro filho obrigatório")
 * eram CONSEQUÊNCIA desta: um A170 sem item identificável quebra o
 * encadeamento que o PVA cobra do detalhamento por código de receita.
 */
export function conferirCodItemDosItens(linhas) {
    const erros = [];
    (Array.isArray(linhas) ? linhas : []).forEach((linha, i) => {
        const campos = camposDaLinha(linha);
        const reg = String(campos[0] || '').trim();
        if (reg !== 'A170' && reg !== 'C170') return;
        if (String(campos[2] || '').trim()) return;
        erros.push({
            registro: reg, linha: i + 1,
            fonte: 'PVA: "Campo obrigatório · COD_ITEM" (MANTOAN 0040 · 07/2026, 18/08 — 36 recusas).',
            mensagem: `${reg} na linha ${i + 1} está sem COD_ITEM. O PVA recusa a importação, e as recusas `
                + 'de M205/M605 ("registro filho obrigatório") vêm junto — um item sem código quebra o '
                + 'encadeamento do detalhamento por código de receita. Documento de serviço sem itens usa o '
                + 'código sintético SERV-GENERICO, que também precisa constar do 0200.',
        });
    });
    return { erros };
}

/**
 * IND_ORIG_CRED vazio em A170 de documento de ENTRADA.
 *
 * FONTE: PVA da MANTOAN (18/08) — *"Campo obrigatório PARA NOTAS FISCAIS DE
 * ENTRADA"*. Quem manda é a DIREÇÃO do documento, **não o CST**: a versão
 * anterior só preenchia quando o CST tinha crédito (50-56), e o PVA desmentiu
 * em três itens com CST 70 (sem crédito). Saída continua SEM o campo — ele
 * descreve a origem da AQUISIÇÃO, que só existe do lado de quem compra.
 */
export function conferirIndOrigCredDasEntradas(linhas) {
    const erros = [];
    let entradaAberta = false;
    (Array.isArray(linhas) ? linhas : []).forEach((linha, i) => {
        const campos = camposDaLinha(linha);
        const reg = String(campos[0] || '').trim();
        if (reg === 'A100') { entradaAberta = ehDocumentoDeEntrada(campos); return; }
        // Qualquer outro registro de documento fecha o contexto — A170 só é
        // filho de A100, e ler "a última entrada vista" atravessaria blocos.
        if (['C100', 'D100', 'F100', 'A990', 'C990'].includes(reg)) { entradaAberta = false; return; }
        if (reg !== 'A170' || !entradaAberta) return;
        if (String(campos[7] || '').trim()) return;
        erros.push({
            registro: reg, linha: i + 1,
            fonte: 'PVA: "Campo obrigatório para notas fiscais de entrada · IND_ORIG_CRED" '
                + '(MANTOAN 0040 · 07/2026, 18/08).',
            mensagem: `A170 na linha ${i + 1} pertence a um documento de ENTRADA e está sem IND_ORIG_CRED. `
                + 'Quem manda aqui é a DIREÇÃO do documento, não o CST: toda entrada leva o campo (0 = '
                + 'mercado interno), tenha ou não crédito.',
        });
    });
    return { erros };
}

/**
 * A retenção declarada no M200/M600 tem de bater com a soma dos F600.
 *
 * FONTE: PVA da HS PROJETOS 0304 · 07/2026 (19/08) — *"VL_RET_CUM maior que o
 * somatório dos F600"*. ⚠️ E o sintoma apontava o lugar ERRADO: os erros
 * saíam no M200, que estava certo — o vazio era o F600 (a coleta lia só a
 * forma aninhada da retenção). Por isso a regra diz os DOIS números.
 *
 * Campos, na ordem que o gerador escreve (e o arquivo aceito de 05/2026
 * confirma): M200/M600 [5] = VL_RET_NC e [9] = VL_RET_CUM — só um dos dois é
 * diferente de zero, por construção; F600 [8] = VL_RET_PIS e [9] = VL_RET_COFINS.
 */
// Número como o ARQUIVO o escreve (pt-BR: milhar com ponto, decimal com
// vírgula). Ele mora no escopo do módulo porque mais de uma regra o lê — duas
// cópias da mesma leitura no mesmo arquivo é como as divergências nascem.
const num = (v) => {
    const x = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(x) ? x : 0;
};

export function conferirRetencaoDoBlocoM(linhas) {
    const erros = [];
    let f600Pis = 0, f600Cofins = 0, temF600 = false;
    const retDeclarada = {};
    (Array.isArray(linhas) ? linhas : []).forEach((linha) => {
        const c = camposDaLinha(linha);
        const reg = String(c[0] || '').trim();
        if (reg === 'F600') { temF600 = true; f600Pis += num(c[8]); f600Cofins += num(c[9]); }
        if (reg === 'M200' || reg === 'M600') retDeclarada[reg] = num(c[5]) + num(c[9]);
    });

    const par = [['M200', 'PIS', f600Pis], ['M600', 'COFINS', f600Cofins]];
    for (const [reg, tributo, somaF600] of par) {
        const declarada = retDeclarada[reg];
        if (declarada === undefined) continue;
        if (Math.abs(declarada - somaF600) < 0.01) continue;
        erros.push({
            registro: reg,
            fonte: 'PVA: "VL_RET_CUM maior que o somatório dos F600" (HS PROJETOS 0304 · 07/2026, 19/08).',
            mensagem: `${reg}: a retenção de ${tributo} declarada é R$ ${declarada.toFixed(2)} e a soma dos `
                + `F600 é R$ ${somaF600.toFixed(2)}${temF600 ? '' : ' (o bloco F saiu SEM nenhum F600)'}. `
                + 'O PVA recusa quando o M não fecha com o F — e o defeito costuma estar no F600, não no M: '
                + 'foi a coleta da retenção que deixou de ler a forma ACHATADA do documento em 19/08.',
        });
    }
    return { erros };
}

/** As três, prontas para a lista de avisos que a geração devolve. */
/**
 * CST de PIS/COFINS fora da Tabela 4.3.3/4.3.4.
 *
 * 🚨 ESTA TABELA ESTAVA ESCRITA E NUNCA FOI LIGADA. Ela morava em
 * `sped-fiscal-regras-tributarias.js` — o módulo do EFD **ICMS/IPI**, que não
 * escreve CST de PIS/COFINS nenhum — sem um único leitor. É a família do
 * `coberturaIncompleta`, que passou quatro dias produzindo uma flag que
 * ninguém lia, e do E510 "pronto" que ninguém gerava: **trava escrita não é
 * trava ligada**.
 *
 * E a classe é real neste arquivo: em 20/08 a PWR saiu com **CST `01` numa
 * ENTRADA** — código que nem existe na tabela das aquisições. Aquele caminho
 * foi corrigido no gerador; o que faltava era a rede.
 *
 * ⚠️ **O QUE ELA CONFERE, e o que NÃO confere.** Ela pergunta se o código
 * EXISTE na tabela — pega vazio, CSOSN (`101`, `500`) e lixo de captura. Ela
 * **não** julga se o código é o certo para a DIREÇÃO da operação: a Tabela
 * 4.3.7 (aquisições) não está neste repo, e reconstruí-la de memória seria
 * inventar tabela oficial, que é o oposto da régua da casa.
 *
 * ⚠️ E ela lê **só o C170**, cujas posições estão PROVADAS (37 campos, recibo
 * do PVA da PWR + arquivo aceito): CST_PIS é o **25** e CST_COFINS o **31**. O
 * **A170 fica de fora, nomeado** — a contagem dele não está em
 * `CAMPOS_POR_REGISTRO`, e conferir posição deduzida produziria alarme falso.
 */
const CST_PISCOFINS_VALIDOS = new Set([
    '01', '02', '03', '04', '05', '06', '07', '08', '09',
    '49', '50', '51', '52', '53', '54', '55', '56',
    '60', '61', '62', '63', '64', '65', '66', '67',
    '70', '71', '72', '73', '74', '75', '98', '99',
]);

/** Posições PROVADAS no C170 de 37 campos (recibo do PVA · PWR 07/2026). */
const C170_CST_PIS = 25;
const C170_CST_COFINS = 31;

export function conferirCstPisCofins(linhas) {
    const erros = [];
    (linhas || []).forEach((linha, i) => {
        const f = String(linha).split('|');
        if (f[1] !== 'C170') return;   // forEach: `return` é o continue
        const conferir = (pos, nome) => {
            const cst = String(f[pos] || '').trim();
            if (CST_PISCOFINS_VALIDOS.has(cst)) return;
            erros.push({
                regra: 'cst-piscofins-fora-da-tabela', registro: 'C170', campo: `${pos} - ${nome}`,
                valor: cst,
                fonte: 'Tabela 4.3.3/4.3.4 do EFD-Contribuições. Posições provadas pelo recibo do PVA '
                    + '(PWR 31947349000169 · 07/2026, 20/08) e pelo arquivo aceito de 03/2026.',
                mensagem: `C170 na linha ${i + 1}: ${nome} = "${cst || '(vazio)'}", que não existe na `
                    + 'Tabela 4.3.3/4.3.4. O PVA recusa a importação. Confira o CST do item na Central de '
                    + 'Documentos — CSOSN (101, 500…) e código de ICMS não valem para PIS/COFINS.',
            });
        };
        conferir(C170_CST_PIS, 'CST_PIS');
        conferir(C170_CST_COFINS, 'CST_COFINS');
    });
    return { erros, ok: erros.length === 0 };
}

// ── R: F550/F560 com receita ⇒ o 1900 é OBRIGATÓRIO ────────────────────────
// FONTE: recusa do PVA na AFFITTARE 17.213.641/0001-27 · 07/2026 (24/08),
// literal: *"Se o somatório do campo Valor Total da Receita Auferida do
// registro F550 e F560 for maior que zero o registro 1900 deve ser
// preenchido."* O bloco 1 saía SEMPRE `|1001|1|` (sem dados) — ele ficou vazio
// quando o 1010 de ação judicial foi removido (17/08) e nunca ganhou conteúdo.
//
// ⚠️ Lê as LINHAS do arquivo gerado, nunca o objeto em memória: foi auditar a
// intenção que deixou o C100 sair com modelo 55 e chave 65 por meses.
export function conferirConsolidacao1900(linhas) {
    const L = Array.isArray(linhas) ? linhas : [];
    let receita = 0;
    let tem1900 = false;
    L.forEach((linha) => {
        const c = camposDaLinha(linha);
        const reg = String(c[0] || '').trim();
        if (reg === 'F550' || reg === 'F560') receita += num(c[1]);
        if (reg === '1900') tem1900 = true;
    });
    if (!(receita > 0) || tem1900) return { erros: [] };
    return {
        erros: [{
            registro: '1900',
            fonte: 'PVA · AFFITTARE 07/2026 (24/08)',
            mensagem: 'O arquivo declara receita no F550/F560 e NÃO tem o registro 1900. '
                + 'O PVA recusa: "Se o somatorio do campo Valor Total da Receita Auferida do registro '
                + 'F550 e F560 for maior que zero o registro 1900 deve ser preenchido." '
                + 'Preencha o modelo e a situacao do documento em Empresas -> Dados Fiscais -> '
                + '"EFD-Contribuicoes: consolidacao da receita (1900)" e gere de novo.',
        }],
    };
}

// ── R: NFC-e (COD_MOD 65) não leva C170 ────────────────────────────────────
//
// FONTE: PVA da HYPE CAFE SERVICOS DE ALIMENTACAO 66641236000115 · 07/2026
// (24/08) — **572 recusas**, que são 286 C170 com DUAS mensagens cada:
//
//   "O registro não deve ser informado para o modelo de documento do
//    'Registro Pai'."
//   "O registro não deve ser informado para esse perfil e/ou tipo de operação.
//    Consulte o guia prático da EFD-Contribuições e verifique a
//    obrigatoriedade dos registros na Seção 4 - Obrigatoriedade dos Registros."
//
// Os 5 C170 das três notas modelo 55 do MESMO arquivo passaram — quem decide é
// o COD_MOD do C100 pai, e por isso a regra lê o pai, nunca a linha isolada.
/**
 * C170 pendurado em C100 de NFC-e.
 *
 * ⚠️ Ela lê o PAI porque a recusa é sobre o pai: um C170 sozinho não tem como
 * ser julgado, e acusar por conta própria produziria alarme em arquivo certo.
 */
export function conferirC170DeNfce(linhas) {
    const erros = [];
    let modPai = '';
    let numPai = '';
    (Array.isArray(linhas) ? linhas : []).forEach((linha, i) => {
        const campos = camposDaLinha(linha);
        const reg = String(campos[0] || '').trim();
        if (reg === 'C100') {
            modPai = String(campos[4] || '').trim();
            numPai = String(campos[7] || '').trim();
            return;
        }
        // Registro de outro bloco fecha o pai — C170 só existe sob C100.
        if (reg && reg !== 'C170') { modPai = ''; numPai = ''; return; }
        if (reg !== 'C170' || modPai !== '65') return;
        erros.push({
            registro: 'C170', linha: i + 1,
            fonte: 'PVA: "O registro não deve ser informado para o modelo de documento do \'Registro Pai\'" '
                + '(HYPE CAFE 1385 · 07/2026, 24/08 — 572 recusas em 286 C170 de NFC-e).',
            mensagem: `A NFC-e nº ${numPai || '?'} levou C170 na linha ${i + 1}, e o leiaute do `
                + 'EFD-Contribuições não admite detalhe de item em cupom — o PVA recusa a importação com '
                + '"O registro não deve ser informado para o modelo de documento do \'Registro Pai\'". '
                + 'A receita da NFC-e é declarada no C100 e no bloco M; e os itens que só existem em cupom '
                + 'têm de sair do 0200 junto, senão viram item órfão.',
        });
    });
    return { erros };
}

// ── R: item do 0200 / unidade do 0190 que ninguém referencia ───────────────
//
// FONTE: PVA — *"Não informar item, se não referenciado em pelo menos um dos
// demais blocos"* (PWR 1364 · 19/08, no EFD ICMS/IPI). O registro é o MESMO
// nas duas famílias e a obrigatoriedade também; o que MUDA é quem referencia —
// aqui são **C170 e A170** (no ICMS/IPI só o C170). Portar a regra sem trocar
// esse conjunto acusaria todo item de NFS-e num arquivo correto.
//
// 📌 ELA NASCE JUNTO DA CORREÇÃO DO C170 DA NFC-e, e é por isso que existe:
// tirar o C170 do cupom sem tirar o item do 0200 trocaria 572 recusas por
// outras tantas de item órfão. Trava que só nasce depois da recusa chegar é
// trava que chega tarde.
/**
 * Item do 0200 e unidade do 0190 sem quem os referencie.
 */
export function conferirCadastrosOrfaosContrib(linhas) {
    const erros = [];
    const lista = Array.isArray(linhas) ? linhas : [];
    const porReg = (reg) => lista
        .map((l, i) => ({ campos: camposDaLinha(l), linha: i + 1 }))
        .filter(x => String(x.campos[0] || '').trim() === reg);

    const itensDeclarados = porReg('0200');
    const referenciados = new Set(
        lista.map(camposDaLinha)
            .filter(c => ['C170', 'A170'].includes(String(c[0] || '').trim()))
            .map(c => String(c[2] || '').trim())
            .filter(Boolean),
    );
    for (const { campos, linha } of itensDeclarados) {
        const cod = String(campos[1] || '').trim();
        if (!cod || referenciados.has(cod)) continue;
        erros.push({
            registro: '0200', linha,
            fonte: 'PVA: "Não informar item, se não referenciado em pelo menos um dos demais blocos" '
                + '(PWR 1364, 19/08).',
            mensagem: `O item ${cod} está declarado no 0200 (linha ${linha}) e nenhum C170/A170 o `
                + 'referencia — o PVA recusa item órfão. Item que só existia em NFC-e cai aqui: '
                + 'o cupom não leva C170 neste arquivo, então o item dele também não entra no 0200.',
        });
    }

    // A unidade é usada pelo 0200 (UNID_INV) e pelo C170/A170 (UNID).
    const unidadesUsadas = new Set([
        ...itensDeclarados.map(x => String(x.campos[5] || '').trim()),
        ...lista.map(camposDaLinha)
            .filter(c => ['C170', 'A170'].includes(String(c[0] || '').trim()))
            .map(c => String(c[5] || '').trim()),
    ].filter(Boolean));
    for (const { campos, linha } of porReg('0190')) {
        const u = String(campos[1] || '').trim();
        if (!u || unidadesUsadas.has(u)) continue;
        erros.push({
            registro: '0190', linha,
            fonte: 'PVA: "Não informar unidade, se não referenciada em pelo menos um dos demais blocos ou '
                + 'no Registro 0200 ou 0220".',
            mensagem: `A unidade ${u} está declarada no 0190 (linha ${linha}) e nenhum 0200/C170/A170 a usa.`,
        });
    }
    return { erros };
}

export function avisosDaPrevalidacaoContrib(linhas) {
    const todos = [
        ...conferirC170DeNfce(linhas).erros,
        ...conferirCadastrosOrfaosContrib(linhas).erros,
        ...conferirCodItemDosItens(linhas).erros,
        ...conferirIndOrigCredDasEntradas(linhas).erros,
        ...conferirRetencaoDoBlocoM(linhas).erros,
        ...conferirCstPisCofins(linhas).erros,
        // 🚨 AS DUAS QUE VALIAM AQUI E NÃO RODAVAM (22/08). O cabeçalho do
        // C100 é o MESMO nas duas famílias, então a recusa "o modelo da chave
        // não confere" (PS VIDROS, 35×) e o limite de DT_DOC do Guia valem
        // palavra por palavra neste arquivo — e a regra existia só no EFD
        // ICMS/IPI. É a "meia trava" do COD_MUN do 0150, um bloco adiante.
        //
        // ⚠️ A posição do DT_FIN é PARÂMETRO: o 0000 do EFD-Contribuições traz
        // IND_SIT_ESP e NUM_REC_ANTERIOR antes das datas, então o campo é o 6
        // (no ICMS/IPI é o 5). Carimbar a posição do vizinho faria a regra ler
        // o nome da empresa como se fosse data.
        ...conferirCodModContraChave(linhas),
        ...conferirDtDocNoPeriodo(linhas, POS_DT_FIN_CONTRIBUICOES),
        ...conferirConsolidacao1900(linhas).erros,
    ];
    // Um item sem código costuma acontecer aos montes (36 na MANTOAN): a lista
    // mostra os primeiros e DIZ quantos são — muro de aviso ninguém lê.
    const porRegra = new Map();
    for (const e of todos) {
        const chave = e.fonte;
        if (!porRegra.has(chave)) porRegra.set(chave, []);
        porRegra.get(chave).push(e);
    }
    const avisos = [];
    for (const lista of porRegra.values()) {
        avisos.push(`🚨 ${lista[0].mensagem}`);
        if (lista.length > 1) {
            avisos.push(`   └ e mais ${lista.length - 1} ocorrência(s) do mesmo caso neste arquivo.`);
        }
    }
    return avisos;
}
