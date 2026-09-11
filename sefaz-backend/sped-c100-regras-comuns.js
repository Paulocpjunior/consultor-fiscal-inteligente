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

import { validarCpf } from './documento-dv.js';

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

// ── O PERÍODO DO 0000 TEM DE SER UM MÊS INTEIRO ────────────────────────────
//
// FONTE — a MESMA validação nos dois Guias, com os campos em posições
// diferentes (por isso ela é PARÂMETRO, nunca dedução do vizinho):
//   · EFD-Contribuições 1.35, 0000 campos 06 e 07: *"deve ser o primeiro dia
//     do mesmo mês de referência da escrituração"* e *"o último dia do mês a
//     que se refere a escrituração"*;
//   · EFD ICMS/IPI 3.2.3, 0000 campos 04 e 05: *"Verifica se a data informada
//     neste campo pertence ao mesmo mês/ano da data informada no campo DT_INI.
//     O valor informado deve ser o último dia do mesmo mês da data inicial"*.
//
// 🚨 É O CAMPO MAIS CARO DO ARQUIVO INTEIRO: ele diz A QUE MÊS tudo aquilo se
// refere. A varredura de competência de 22/08 fechou o lado da PORTA, onde o
// efeito era arquivo VAZIO; aqui seria arquivo CHEIO entregue no mês errado —
// pior, porque ninguém confere data de período a olho. E o PVA confere o
// DT_DOC de cada documento contra este campo.
//
// ⚠️ As duas exceções do Guia (início e encerramento de atividades) NÃO abrem
// buraco na regra: quem gera aqui monta o período a partir da COMPETÊNCIA, que
// é sempre um mês fechado. Empresa que abriu no meio do mês entrega pelo PVA.
/**
 * @param {string[]} linhas
 * @param {number}   posDtFinNo0000  5 no EFD ICMS/IPI · 7 no EFD-Contribuições
 *                                   (o DT_INI é sempre a posição anterior)
 */
export function conferirPeriodoDoArquivo(linhas, posDtFinNo0000) {
    const lista = (linhas || []).map(String);
    const linha0000 = lista.find((l) => registroDe(l) === '0000');
    if (!linha0000) return [];
    const f = campos(linha0000);
    const dia = (txt) => {
        const s = String(txt ?? '').trim();
        return /^\d{8}$/.test(s)
            ? { d: Number(s.slice(0, 2)), m: Number(s.slice(2, 4)), a: Number(s.slice(4)), txt: s }
            : null;
    };
    const ini = dia(f[posDtFinNo0000 - 1]);
    const fim = dia(f[posDtFinNo0000]);
    const erros = [];
    const acusar = (campo, valor, esperado, mensagem) => erros.push({
        regra: 'periodo-nao-e-mes-inteiro', registro: '0000', campo, valor, esperado,
        linha: String(linha0000).trim().slice(0, 70),
        mensagem,
        acao: 'Defeito de GERAÇÃO (a competência que entrou na porta) — reporte com o print em vez de '
            + 'editar o arquivo. Período errado é o arquivo inteiro entregue no mês que não é o dele.',
        fonte: 'Guia Prático — 0000: o DT_INI "deve ser o primeiro dia do mesmo mês de referência da '
            + 'escrituração" e o DT_FIN "o último dia do mês a que se refere a escrituração".',
    });
    // Data ilegível NÃO vira "mês errado": é outra falha, e dizer a errada
    // manda procurar problema no lugar errado.
    if (!ini || !fim) {
        acusar(`${posDtFinNo0000 - 1} e ${posDtFinNo0000} (DT_INI/DT_FIN)`,
            `${String(f[posDtFinNo0000 - 1] ?? '')} · ${String(f[posDtFinNo0000] ?? '')}`, 'DDMMAAAA',
            'O período do arquivo não está no formato DDMMAAAA. Sem período legível o PVA não importa, e '
            + 'não dá para saber a que mês o arquivo se refere.');
        return erros;
    }
    if (ini.m !== fim.m || ini.a !== fim.a) {
        acusar(`${posDtFinNo0000 - 1} e ${posDtFinNo0000} (DT_INI/DT_FIN)`, `${ini.txt} · ${fim.txt}`,
            'o mesmo mês nos dois',
            `O arquivo declara DT_INI ${ini.txt} e DT_FIN ${fim.txt} — meses diferentes. A escrituração é `
            + 'de UM mês, e o período atravessando a virada significa competência errada: o movimento sairia '
            + 'declarado no mês que não é o dele.');
        return erros;
    }
    const primeiro = `01${String(ini.m).padStart(2, '0')}${ini.a}`;
    const ultimoDia = new Date(Date.UTC(ini.a, ini.m, 0)).getUTCDate();
    const ultimo = `${String(ultimoDia).padStart(2, '0')}${String(fim.m).padStart(2, '0')}${fim.a}`;
    if (ini.txt !== primeiro) {
        acusar(`${posDtFinNo0000 - 1} (DT_INI)`, ini.txt, primeiro,
            `O DT_INI é ${ini.txt} e o Guia exige o PRIMEIRO dia do mês (${primeiro}). Começar no meio do `
            + 'mês declara à Receita um período que não é o da escrituração.');
    }
    if (fim.txt !== ultimo) {
        acusar(`${posDtFinNo0000} (DT_FIN)`, fim.txt, ultimo,
            `O DT_FIN é ${fim.txt} e o último dia deste mês é ${ultimo}. Fechando ANTES, o movimento dos `
            + 'dias que sobram fica fora da escrituração; DEPOIS, o arquivo declara um dia que o mês não '
            + 'tem. Nos dois casos o PVA recusa — é contra este campo que ele confere o DT_DOC.');
    }
    return erros;
}

/**
 * O 0100 (contabilista) tem NOME, CPF e CRC — e o CPF passa no DV.
 *
 * 📖 FONTE — Guia Prático da EFD-Contribuições 1.35, registro 0100: os campos
 * **02 NOME**, **03 CPF** e **04 CRC** são **Obrig. `S`**, e o campo 03 traz a
 * validação literal *"será conferido o dígito verificador (DV) do CPF
 * informado"*.
 *
 * 🚨 **POR QUE ELA NASCEU (29/08)**: os dois geradores tinham DEFAULT
 * INVENTADO — `'CONTADOR SP CONTABIL'` e `'1SP123456/O-7'`. Sem a env, o
 * arquivo declarava um contabilista que não existe com um CRC que não é de
 * ninguém, e o **PVA aceita**, porque a forma está certa. É a família do
 * `1405`, do `PARTSEM` e do `5352`: erro que só aparece na fiscalização.
 * Apagado o default, o campo passa a sair VAZIO — e vazio o PVA acusa, que é
 * o lado certo do erro.
 *
 * ⚠️ **EMAIL e COD_MUN ficam de FORA, de propósito.** No EFD-Contribuições
 * eles são **Obrig. `N`** (o Guia é explícito), e no EFD ICMS/IPI o PVA os
 * recusou como obrigatórios (PWR 19/08) — lá quem cobra é a R13, que é da
 * família certa. Cobrá-los aqui acusaria arquivo CORRETO do
 * EFD-Contribuições, que é o jeito conhecido de a equipe desligar a trava.
 *
 * ⚠️ E o **DV é FATO sobre o número**: um CPF que não fecha está errado em
 * qualquer família, então essa metade roda nas duas.
 */
export function conferirContador0100(linhas) {
    const erros = [];
    for (const l of (linhas || [])) {
        if (registroDe(l) !== '0100') continue;
        const f = campos(l);
        const faltando = [];
        if (!String(f[2] || '').trim()) faltando.push('2 - NOME');
        if (!String(f[3] || '').trim()) faltando.push('3 - CPF');
        if (!String(f[4] || '').trim()) faltando.push('4 - CRC');
        if (faltando.length) {
            erros.push({
                regra: '0100-contabilista', registro: '0100', campo: faltando.join(', '),
                valor: '', esperado: 'preenchido', linha: l,
                mensagem: `O registro do contabilista está sem ${faltando.join(' e ')}.`,
                acao: 'São campos OBRIGATÓRIOS do 0100. O app não os inventa: preencha as variáveis '
                    + 'CONTADOR_NOME / CONTADOR_CPF / CONTADOR_CRC no Cloud Run.',
                fonte: 'Guia Prático da EFD-Contribuições 1.35, registro 0100: campos 02 (NOME), 03 (CPF) '
                    + 'e 04 (CRC) são Obrigatórios (S).',
            });
            continue;
        }
        const cpf = String(f[3]);
        if (!validarCpf(cpf)) {
            erros.push({
                regra: '0100-contabilista', registro: '0100', campo: '3 - CPF', linha: l,
                valor: cpf, esperado: 'CPF com DV válido',
                mensagem: `O CPF do contabilista (${cpf}) não passa no dígito verificador.`,
                acao: 'Confira a variável CONTADOR_CPF no Cloud Run — o PVA confere o DV.',
                fonte: 'Guia Prático da EFD-Contribuições 1.35, 0100 campo 03, Validação: "será conferido '
                    + 'o dígito verificador (DV) do CPF informado".',
            });
        }
    }
    return erros;
}

/**
 * C100 de TERCEIRO sem COD_PART, ou com COD_PART que o 0150 não declara.
 *
 * 🚨 FONTE — Guia Prático 3.2.3, registro C100: *"Campo 04 (COD_PART) -
 * Validação: o valor informado deve existir no campo COD_PART do registro
 * 0150. Quando se tratar de NFC-e (modelo 65), o campo não deve ser
 * preenchido"*; e a chave do registro *"para documentos com campo IND_EMIT
 * igual a '1-Terceiros': campo IND_OPER, campo IND_EMIT, campo COD_PART, …"*.
 * O Guia 1.35 do EFD-Contribuições referencia o 0150 pelo mesmo campo.
 *
 * O CASO (11/09, Paulo, testando o SPED de uma distribuidora): *"deu erros de
 * cod de participante nas entradas … 493 só de código de participante"*. A
 * causa está medida no dono (`participanteDoDocumento`): a entrada capturada
 * pela SEFAZ chega ACHATADA e o C100 saía `|C100|0|1||55|…|` — um erro por
 * nota de entrada, 493 notas. Esta regra é a REDE: se o caminho voltar a
 * perder o lado, o arquivo acusa aqui em vez de no PVA.
 *
 * ⚠️ NFC-e (COD_MOD 65) fica de FORA: nela o campo não PODE ser preenchido
 * (Exceção 9), e quem cobra isso é a R2 da prevalidação. Emissão própria
 * (IND_EMIT 0) também não é acusada pelo vazio — o COD_PART ali é facultativo
 * na chave do registro; só o "COD_PART preenchido e fora do 0150" vale para
 * ela.
 */
/** COD_SIT em que o C100 sai sem COD_PART (Exceção 1: 02, 03, 04 e 05). */
export const C100_SEM_PARTICIPANTE = new Set(['02', '03', '04', '05']);

/**
 * C100 cancelado/denegado só com os campos que a Exceção 1 permite.
 *
 * 📖 FONTE — PVA (ELS · 08/2026, 11/09, 19×): *"Para documento fiscal
 * cancelado (código da situação = 02 ou 03) ou NF-e denegada (04), somente
 * informar os campos código da situação, indicador de operação, código do
 * modelo e a chave"*; Guia 3.2.3, C100, Exceção 1: *"preencher somente os
 * campos REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC e CHV_NF-e …
 * Demais campos deverão ser apresentados com conteúdo VAZIO"*.
 *
 * @param {string[]} linhas
 * @param {{permitidas?: number[]}} [opts] posições (REG = 1) que PODEM vir
 *   preenchidas — o padrão é o do EFD ICMS/IPI. Inutilizada (05) leva tudo
 *   menos a chave e fica FORA desta conferência.
 */
export function conferirCanceladaSoCampos(linhas, opts = {}) {
    const permitidas = new Set(opts.permitidas || [1, 2, 3, 5, 6, 7, 8, 9]);
    const erros = [];
    for (const l of (linhas || []).map(String)) {
        if (registroDe(l) !== 'C100') continue;
        const f = campos(l);
        const codSit = String(f[6] || '').trim();
        if (!['02', '03', '04'].includes(codSit)) continue;
        const preenchidas = [];
        for (let pos = 1; pos < f.length - 1; pos += 1) {
            if (permitidas.has(pos)) continue;
            if (String(f[pos] ?? '').trim() !== '') preenchidas.push(pos === 4 ? '4 - COD_PART' : String(pos));
        }
        if (!preenchidas.length) continue;
        erros.push({
            regra: 'c100-cancelada-com-campos', registro: 'C100', campo: preenchidas.join(', '),
            valor: '', esperado: 'em branco', linha: l,
            mensagem: `A nota nº ${f[8] || '?'} está ${codSit === '04' ? 'DENEGADA' : 'CANCELADA'} (COD_SIT ${codSit}) `
                + `e saiu com campo(s) preenchido(s) que o leiaute manda deixar VAZIOS: ${preenchidas.join(', ')}.`,
            acao: 'Defeito de GERAÇÃO — reporte com o print. Cancelada leva só IND_OPER, IND_EMIT, COD_MOD, '
                + 'COD_SIT, SER, NUM_DOC e a chave; sem COD_PART e sem filhos.',
            fonte: 'PVA: "Para documento fiscal cancelado (código da situação = 02 ou 03) ou NF-e denegada (04), '
                + 'somente informar os campos código da situação, indicador de operação, código do modelo e a '
                + 'chave" (ELS · 08/2026, 11/09, 19×); Guia 3.2.3, C100, Exceção 1.',
        });
    }
    return erros;
}

export function conferirCodPartDoC100(linhas) {
    const erros = [];
    const lista = (linhas || []).map(String);
    const no0150 = new Set(
        lista.filter((l) => registroDe(l) === '0150').map((l) => String(campos(l)[2] || '').trim()).filter(Boolean),
    );
    for (const l of lista) {
        if (registroDe(l) !== 'C100') continue;
        const f = campos(l);
        const indEmit = String(f[3] || '').trim();
        const codPart = String(f[4] || '').trim();
        const codMod = String(f[5] || '').trim();
        const codSit = String(f[6] || '').trim();
        const num = f[8] || '?';
        if (codMod === '65') continue;
        // 🚨 CANCELADA/DENEGADA/INUTILIZADA NÃO LEVA COD_PART — Exceção 1 do
        // C100 nas DUAS famílias. Cobrá-lo aqui mandaria preencher o campo que
        // o PVA recusa preenchido (ELS · 08/2026, 11/09, 19 recusas).
        if (C100_SEM_PARTICIPANTE.has(codSit)) continue;
        if (!codPart) {
            if (indEmit !== '1') continue;
            erros.push({
                regra: 'c100-sem-cod-part', registro: 'C100', campo: '4 - COD_PART',
                valor: '', esperado: 'CNPJ/CPF do participante, cadastrado no 0150', linha: l,
                mensagem: `A nota nº ${num} (emitida por TERCEIRO) está sem COD_PART — o PVA recusa cada C100 assim.`,
                acao: 'O documento entrou sem o lado da contraparte legível (emitente da compra). Rode o ♻️ Reler '
                    + 'participante dos XMLs (XMLs → 🌾 DIPAM / Produtor rural) para recuperar da fonte; se o XML '
                    + 'não trouxer o CNPJ, é captura incompleta — reimporte o XML completo.',
                fonte: 'Guia Prático 3.2.3, C100 campo 04 (COD_PART) — chave do registro para IND_EMIT=1 inclui '
                    + 'COD_PART; Validação: "o valor informado deve existir no campo COD_PART do registro 0150" '
                    + '(caso 11/09, 493 recusas numa distribuidora).',
            });
            continue;
        }
        if (!no0150.has(codPart)) {
            erros.push({
                regra: 'c100-cod-part-fora-do-0150', registro: 'C100', campo: '4 - COD_PART',
                valor: codPart, esperado: 'um COD_PART declarado no 0150', linha: l,
                mensagem: `A nota nº ${num} referencia o participante ${codPart}, que o 0150 não declara.`,
                acao: 'O C100 e o 0150 têm que sair do MESMO dono (participanteDoDocumento). Se o participante tem '
                    + 'documento com tamanho inválido (nem CPF nem CNPJ), o 0150 o pula — confira o cadastro na nota.',
                fonte: 'Guia Prático 3.2.3, C100 campo 04: "o valor informado deve existir no campo COD_PART do '
                    + 'registro 0150".',
            });
        }
    }
    return erros;
}

