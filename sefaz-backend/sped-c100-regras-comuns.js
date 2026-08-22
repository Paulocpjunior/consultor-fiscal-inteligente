// ============================================================================
// sefaz-backend/sped-c100-regras-comuns.js  (PURO — testável)
// ----------------------------------------------------------------------------
// AS REGRAS DO C100 QUE VALEM NAS DUAS FAMÍLIAS.
//
// ═══ POR QUE ELAS SAÍRAM DA PREVALIDAÇÃO DO ICMS/IPI ════════════════════════
//
// O cabeçalho do C100 é o MESMO nos dois arquivos — conferido campo a campo
// contra os dois geradores:
//
//     |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|
//      DT_DOC|DT_E_S|VL_DOC|…
//
// Só o que vem DEPOIS do VL_DOC diverge (o EFD-Contribuições segue com a seção
// de PIS/COFINS). Ou seja: duas recusas que a casa já pagou no EFD ICMS/IPI
// valem, palavra por palavra, no EFD-Contribuições — e lá elas não rodavam.
//
// É a mesma "meia trava" do COD_MUN do 0150 (22/08): a regra entrou numa
// família só, e a próxima empresa gasta a mesma volta de PVA com outro CNPJ.
//
// ⚠️ O QUE **NÃO** ESTÁ AQUI, e o motivo: o **0000** tem leiaute DIFERENTE nos
// dois. `DT_FIN` é o campo **5** no EFD ICMS/IPI e o **7** no
// EFD-Contribuições, que traz `IND_SIT_ESP` e `NUM_REC_ANTERIOR` antes das
// datas. Por isso a posição é PARÂMETRO, nunca dedução — e o erro aqui não é
// silencioso, é BARULHENTO NA DIREÇÃO ERRADA: lendo o campo 6 do
// EFD-Contribuições a regra pegaria o **DT_INI**, que também é uma data
// válida, e passaria a acusar TODA nota emitida depois do dia 1º.
// (Foi assim que o teste pegou um erro meu de contagem antes de subir.)
//
// ⚠️ E o **A100** e o **D100** ficam de fora, também de propósito: eles têm
// campos a mais no cabeçalho (`SUB` no D100), então as posições NÃO são as
// mesmas. Portá-los sem a prova do leiaute produziria alarme falso — que é o
// jeito mais rápido de a equipe desligar a prevalidação.
// ============================================================================

const campos = (linha) => String(linha || '').split('|');
const registroDe = (linha) => campos(linha)[1] || '';

/** O modelo mora nas posições 21-22 da chave de 44 dígitos. */
function modeloDaChave(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    return c.length === 44 ? c.slice(20, 22) : '';
}

/**
 * COD_MOD × modelo da CHAVE.
 *
 * PVA (PS VIDROS 0896 · 07/2026, 19/08, **35 ocorrências**): *"O modelo da
 * chave do documento eletrônico não confere com o modelo do documento."*
 */
export function conferirCodModContraChave(linhas) {
    const erros = [];
    for (const l of (linhas || []).map(String)) {
        if (registroDe(l) !== 'C100') continue;
        const f = campos(l);
        const codMod = f[5] || '';
        const daChave = modeloDaChave(f[9]);
        if (!daChave || !codMod || daChave === codMod) continue;
        erros.push({
            regra: 'cod-mod-x-chave', registro: 'C100', campo: '5 - COD_MOD',
            valor: codMod, esperado: daChave, linha: l,
            mensagem: `A nota nº ${f[8] || '?'} está declarada como modelo ${codMod} e a chave de acesso diz ${daChave}.`,
            acao: 'O modelo tem que sair da chave. Se a nota é NFC-e (65), ela também não pode informar '
                + 'COD_PART nem os campos de ST/IPI/PIS/COFINS no C100.',
            fonte: 'PVA: "O modelo da chave do documento eletrônico não confere com o modelo do documento" '
                + '(PS VIDROS 0896 · 07/2026, 19/08).',
        });
    }
    return erros;
}

/**
 * DT_DOC depois do fim do período.
 *
 * Guia Prático 3.2.3, C100 campo 10: *"o valor informado no campo deve ser
 * menor ou igual ao valor do campo DT_FIN do registro 0000"*.
 *
 * ⚠️ **Só o limite SUPERIOR**: o Guia não exige `DT_DOC ≥ DT_INI` no C100, e
 * documento **EXTEMPORÂNEO** (de mês anterior, escriturado agora) é legítimo —
 * acusá-lo seria alarme falso sobre escrituração correta.
 *
 * @param {string[]} linhas
 * @param {number} posDtFinNo0000  5 no EFD ICMS/IPI, 7 no EFD-Contribuições.
 */
export function conferirDtDocNoPeriodo(linhas, posDtFinNo0000) {
    const lista = (linhas || []).map(String);
    const linha0000 = lista.find((l) => registroDe(l) === '0000');
    const dtFin = linha0000 ? String(campos(linha0000)[posDtFinNo0000] || '').replace(/\D/g, '') : '';
    // Sem 0000 legível a regra fica MUDA — acusar no escuro é pior que calar.
    if (dtFin.length !== 8) return [];

    const comoNumero = (ddmmaaaa) => Number(`${ddmmaaaa.slice(4)}${ddmmaaaa.slice(2, 4)}${ddmmaaaa.slice(0, 2)}`);
    const limite = comoNumero(dtFin);
    const erros = [];
    for (const l of lista) {
        if (registroDe(l) !== 'C100') continue;
        const f = campos(l);
        const dt = String(f[10] || '').replace(/\D/g, '');
        if (dt.length !== 8) continue;
        if (comoNumero(dt) <= limite) continue;
        erros.push({
            regra: 'dt-doc-fora-do-periodo', registro: 'C100', campo: '10 (DT_DOC)',
            valor: dt, esperado: `≤ ${dtFin}`, linha: `NUM_DOC ${f[8] || '?'}`,
            mensagem: `A nota nº ${f[8] || '?'} está com data ${dt.slice(0, 2)}/${dt.slice(2, 4)}/${dt.slice(4)}, `
                + 'depois do fim do período da escrituração.',
            acao: 'Confira a data de emissão do documento. Nota emitida perto da virada do mês costuma cair '
                + 'aqui quando a data foi lida num fuso diferente do que a nota declara.',
            fonte: 'Guia Prático 3.2.3, C100 campo 10: "o valor informado no campo deve ser menor ou igual '
                + 'ao valor do campo DT_FIN do registro 0000".',
        });
    }
    return erros;
}

/** Onde mora o DT_FIN do 0000 em cada família — conferido nos dois geradores. */
export const POS_DT_FIN_ICMS_IPI = 5;
export const POS_DT_FIN_CONTRIBUICOES = 7;
