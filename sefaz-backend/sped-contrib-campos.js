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

/**
 * Contagem de campos INCLUINDO o REG, que é como o PVA conta ("Valor Esperado
 * 16" para uma linha que começa em M210).
 */
export const CAMPOS_POR_REGISTRO = {
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
