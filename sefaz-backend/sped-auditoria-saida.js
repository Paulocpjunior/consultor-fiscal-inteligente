// ============================================================================
// sefaz-backend/sped-auditoria-saida.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Confere o ARQUIVO QUE ACABOU DE SAIR, antes de alguém transmitir.
//
// POR QUE EXISTE (Paulo, 06/08: *"esses erros não podem acontecer"*): três
// defeitos da mesma FAMÍLIA passaram pelos testes unitários e só apareceram na
// leitura humana do código —
//
//   04/08  IPI escriturado em E200/E210, que são registros do ICMS-ST
//   02/08  E110 campo 11 recebendo saldo CREDOR num campo de saldo DEVEDOR
//   06/08  Bloco H com o inventário INTEIRO zerado (qtd default 0)
//
// Nenhum teste de unidade pega isso, porque cada função fazia exatamente o que
// mandava seu próprio teste. O que faltava era olhar o RESULTADO: um arquivo em
// que uma coluna de valor está zerada em 100% das linhas de um bloco que se
// declarou "com dados" é sempre suspeito — ou o dado não existe (e não devia
// ser declarado), ou está indo pro campo errado.
//
// A REGRA QUE ISSO IMPLEMENTA: zero pode ser RESPOSTA ("não houve ajuste") ou
// AUSÊNCIA ("não contamos"). O arquivo não distingue os dois — mas "todos os
// detalhes zerados" é a assinatura da ausência, e ela vira aviso ANTES do PVA.
//
// Esta auditoria NÃO substitui o PVA e não conhece o leiaute campo a campo. Ela
// pega a CLASSE do erro, não a instância.
// ============================================================================

/**
 * Registros de DETALHE que a auditoria vigia, com as posições (1-based dentro
 * da linha, contando o REG como 1) dos campos de valor/quantidade.
 *
 * Só entram registros cujo detalhe SEMPRE carrega valor quando existe de
 * verdade — é o que torna "tudo zerado" conclusivo.
 */
export const DETALHES_VIGIADOS = {
    H010: { rotulo: 'itens do inventário', campos: { 4: 'QTD', 5: 'VL_UNIT', 6: 'VL_ITEM' } },
    C170: { rotulo: 'itens de documento', campos: { 5: 'QTD', 7: 'VL_ITEM' } },
    C190: { rotulo: 'resumo por CST/CFOP/alíquota', campos: { 5: 'VL_OPR' } },
    // SPED Contribuições. Só o VALOR DO ITEM entra: base de PIS/COFINS zerada
    // é legítima em CST sem crédito, e vigiar isso encheria a tela de alarme
    // falso — que é o caminho pra ninguém mais ler alarme nenhum.
    A170: { rotulo: 'itens de serviço (Contribuições)', campos: { 5: 'VL_ITEM' } },
    // 🚨 A100 FALTAVA — e foi por isso que um arquivo com 37 documentos de
    // serviço, TODOS com VL_DOC 0,00, passou pela auditoria (17/08, CLINICA
    // MEDICA MANTOAN 07/2026). Só o A170 estava vigiado, e aquele arquivo não
    // tinha nenhum A170: a trava não teve o que olhar.
    //
    // VL_DOC é o valor do documento — zerado em 100% das linhas não é caso
    // legítimo nenhum, é leitura que não achou o campo.
    A100: { rotulo: 'documentos de serviço (Contribuições)', campos: { 12: 'VL_DOC' } },
    D190: { rotulo: 'resumo de transporte', campos: { 5: 'VL_OPR' } },
    G110: { rotulo: 'CIAP — apuração', campos: { 4: 'VL_ICMS_APROP' } },
};

/** Totalizadores cujo valor deve bater com a soma dos detalhes. */
export const TOTAIS_VIGIADOS = {
    H005: { campoTotal: 3, rotuloTotal: 'VL_INV', detalhe: 'H010', campoDetalhe: 6, rotuloDetalhe: 'VL_ITEM' },
};

const partes = (linha) => String(linha || '').split('|');

/** Campo posicional (1-based, REG = 1). */
export function campo(linha, pos) {
    const p = partes(linha);
    // A linha do SPED começa e termina com '|' → p[0] é vazio e o REG é p[1].
    return p[pos] ?? '';
}

/** '1.234,56' / '0,00' / '' → número. Vazio NÃO é zero: é ausência. */
export function valorSped(txt) {
    const s = String(txt ?? '').trim();
    if (s === '') return null;
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

const registroDe = (linha) => campo(linha, 1);

/**
 * @param {string[]} linhas  arquivo gerado, linha a linha
 * @returns {{suspeitas: Array<{registro:string, tipo:string, gravidade:'bloqueia'|'atencao', detalhe:string}>}}
 */
export function auditarSaidaSped(linhas) {
    const lista = (linhas || []).map(String);
    const suspeitas = [];

    // ── 1. Coluna de valor zerada em TODAS as linhas de um detalhe ──────────
    // Esta é a assinatura do bloco H: 400 itens, todos com QTD 0,00. Um item
    // zerado é plausível; TODOS zerados é dado que não existe.
    for (const [reg, cfg] of Object.entries(DETALHES_VIGIADOS)) {
        const doReg = lista.filter((l) => registroDe(l) === reg);
        if (doReg.length === 0) continue;
        for (const [pos, nome] of Object.entries(cfg.campos)) {
            const vals = doReg.map((l) => valorSped(campo(l, Number(pos))));
            const informados = vals.filter((v) => v !== null);
            if (informados.length === 0) {
                suspeitas.push({
                    registro: reg,
                    tipo: 'coluna-vazia',
                    gravidade: 'bloqueia',
                    detalhe: `${reg} (${cfg.rotulo}): o campo ${nome} está VAZIO nas ${doReg.length} linhas. `
                        + 'Campo obrigatório em branco — o arquivo não passa no PVA.',
                });
                continue;
            }
            if (informados.every((v) => v === 0)) {
                suspeitas.push({
                    registro: reg,
                    tipo: 'coluna-toda-zerada',
                    gravidade: 'bloqueia',
                    detalhe: `${reg} (${cfg.rotulo}): o campo ${nome} está ZERADO nas ${doReg.length} linhas. `
                        + 'Isso quase nunca é a realidade — ou o dado não foi informado (e não devia ser '
                        + 'declarado), ou está indo para o campo errado. Confira antes de transmitir.',
                });
            }
        }
    }

    // ── 2. Total declarado × soma dos detalhes ──────────────────────────────
    // Pega o erro de campo trocado: o total vai para a posição errada e sai
    // zero enquanto os detalhes somam alguma coisa (caso do H005).
    for (const [reg, cfg] of Object.entries(TOTAIS_VIGIADOS)) {
        const linhasTotal = lista.filter((l) => registroDe(l) === reg);
        if (linhasTotal.length === 0) continue;
        const soma = lista
            .filter((l) => registroDe(l) === cfg.detalhe)
            .reduce((t, l) => t + (valorSped(campo(l, cfg.campoDetalhe)) || 0), 0);
        for (const l of linhasTotal) {
            const declarado = valorSped(campo(l, cfg.campoTotal));
            if (declarado === null) {
                suspeitas.push({
                    registro: reg, tipo: 'total-ausente', gravidade: 'bloqueia',
                    detalhe: `${reg}: o campo ${cfg.rotuloTotal} está em branco, mas os ${cfg.detalhe} somam `
                        + `${soma.toFixed(2)}.`,
                });
                continue;
            }
            if (Math.abs(declarado - soma) > 0.01) {
                suspeitas.push({
                    registro: reg, tipo: 'total-nao-bate', gravidade: 'bloqueia',
                    detalhe: `${reg}: ${cfg.rotuloTotal} declara ${declarado.toFixed(2)}, mas a soma dos `
                        + `${cfg.detalhe} (${cfg.rotuloDetalhe}) é ${soma.toFixed(2)}. `
                        + 'Total no campo errado ou detalhe faltando.',
                });
            }
        }
    }

    // ── 3. Bloco que se diz "com dados" e não tem detalhe nenhum ────────────
    // IND_MOV=0 promete conteúdo; bloco só com abertura e encerramento é
    // promessa não cumprida — e o PVA reclama.
    for (const l of lista) {
        const reg = registroDe(l);
        if (!/^[A-Z1-9]001$/.test(reg)) continue;
        if (campo(l, 2) !== '0') continue;                       // 0 = com dados
        const bloco = reg[0];
        const temDetalhe = lista.some((x) => {
            const r = registroDe(x);
            return r[0] === bloco && !/^(001|990)$/.test(r.slice(1));
        });
        if (!temDetalhe) {
            suspeitas.push({
                registro: reg, tipo: 'bloco-vazio-declarado-cheio', gravidade: 'bloqueia',
                detalhe: `${reg} diz IND_MOV=0 (bloco COM dados), mas o bloco ${bloco} não tem nenhum registro `
                    + 'de conteúdo. Ou gera o conteúdo, ou declara IND_MOV=1.',
            });
        }
    }

    return { suspeitas, ok: suspeitas.length === 0 };
}

/** Frase pra tela — nunca diz "tudo certo" quando a auditoria não rodou. */
export function resumoAuditoria(r) {
    if (!r) return 'Auditoria do arquivo não rodou — não dá pra dizer que está tudo certo.';
    if (r.ok) return 'Auditoria estrutural do arquivo: nenhuma coluna de valor totalmente zerada e os totais batem com os detalhes.';
    const bloqueia = r.suspeitas.filter((s) => s.gravidade === 'bloqueia').length;
    return `Auditoria do arquivo apontou ${r.suspeitas.length} problema(s)${bloqueia ? ` (${bloqueia} que travam a entrega)` : ''}. `
        + 'Resolva antes de transmitir no PVA.';
}
