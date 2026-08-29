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
    // 🚨 D100 FALTAVA pelo MESMO motivo, e o defeito estava lá (21/08,
    // varredura dos leitores de documento): o bloco D lia
    // `nota.valor || nota.totalNota` e o importer grava **valorTotal** (o CT-e
    // traz <vTPrest>) — todo CT-e capturado saía com VL_DOC 0,00 e o crédito
    // de PIS/COFINS do frete ia a zero. Só o D190 estava vigiado.
    // 🐛 E ELA NASCEU MUDA — corrigido em 26/08. A posição estava em **12**, que
    // no leiaute do D100 é o `DT_A_P`: uma DATA, que nunca sai zerada, então a
    // vigilância nunca teve o que acusar. O `VL_DOC` é o campo **15** nas DUAS
    // famílias (Guia da EFD-Contribuições 1.35 e Guia 3.2.3 do EFD ICMS/IPI —
    // os 23 primeiros campos são idênticos). É a MESMA classe do 0500: trava
    // que existe, roda e olha o lugar errado dá sensação de cobertura.
    D100: { rotulo: 'conhecimentos de transporte (Contribuições)', campos: { 15: 'VL_DOC' } },
    D190: { rotulo: 'resumo de transporte', campos: { 5: 'VL_OPR' } },
    // F600 — retenção na fonte (Contribuições, 19/08 · caso HS PROJETOS).
    // Posições provadas contra arquivo aceito do E-Fiscal:
    // |F600|03|DT|VL_BC_RET|VL_RET|5952|1|CNPJ|VL_RET_PIS|VL_RET_COFINS|0|
    // VL_BC_RET e VL_RET zerados em 100% das linhas não têm caso legítimo —
    // retenção declarada sem base ou sem valor é leitura que não achou o campo.
    F600: { rotulo: 'retenção na fonte (Contribuições)', campos: { 4: 'VL_BC_RET', 5: 'VL_RET' } },
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
 * Toda linha de arquivo SPED é `|REG|campo|…|`. RÉGUA ÚNICA da FORMA — usada
 * pela auditoria (que roda nos dois arquivos) e pela R15 da prevalidação do
 * EFD ICMS/IPI, que reporta o mesmo fato com a linguagem de recusa do PVA.
 *
 * Devolve no máximo 5 suspeitas + 1 resumo: uma linha grudada costuma vir
 * acompanhada, e listar centenas afogaria o resto da auditoria.
 */
export function linhasMalformadas(linhas) {
    const fora = [];
    (linhas || []).forEach((linha, i) => {
        const limpa = String(linha).replace(/[\r\n]+$/, '');
        if (!limpa) return;
        if (/^\|[A-Z0-9]{4}\|.*\|$/.test(limpa)) return;
        fora.push({ linha: i + 1, texto: limpa });
    });
    if (!fora.length) return [];

    const suspeitas = fora.slice(0, 5).map((f) => ({
        registro: registroDe(`|${String(f.texto).replace(/^\|/, '')}`) || '?',
        tipo: 'linha-malformada',
        gravidade: 'bloqueia',
        detalhe: `Linha ${f.linha} fora do formato |REG|…| — registro(s) grudado(s) ou separador perdido. `
            + 'O PVA não importa o arquivo assim, e o 9900 não conta o que está grudado. Isto é defeito de '
            + `GERAÇÃO do app (módulo formando linha fora do buildLine): "${String(f.texto).slice(0, 60)}…"`,
    }));
    if (fora.length > 5) {
        suspeitas.push({
            registro: '?', tipo: 'linha-malformada', gravidade: 'bloqueia',
            detalhe: `…e mais ${fora.length - 5} linha(s) malformada(s) no mesmo arquivo.`,
        });
    }
    return suspeitas;
}

/**
 * O BLOCO 9 FECHA COM O ARQUIVO — a aritmética que o PVA confere PRIMEIRO.
 *
 * 📖 FONTE — Guia Prático 3.2.3, literal:
 *  · **9900**, campo 03 (QTD_REG_BLC), Validação: *"verifica se o número de
 *    linhas no arquivo do tipo informado no campo REG_BLC do registro 9900 é
 *    igual ao valor informado neste campo"*; e o cabeçalho do registro: *"Todos
 *    os registros referenciados neste arquivo, **inclusive os posteriores a
 *    este registro**, devem ter uma linha totalizadora"*;
 *  · **9990**, campo 02: a quantidade de linhas do Bloco 9;
 *  · **9999**, campo 02, Validação: *"o número de linhas (registros)
 *    existentes no arquivo inteiro é igual ao valor informado no campo
 *    QTD_LIN"*, e *"deve considerar também o próprio registro 9999"*.
 *
 * 🚨 **POR QUE ELA MORA AQUI, e não na prevalidação de uma família só**: o
 * bloco 9 é o MESMO mecanismo nos dois arquivos — contagem de linhas, sem
 * leiaute nenhum de permeio. É a casa da `linhasMalformadas`, e pelo mesmo
 * motivo. Deixá-la numa família protegeria um arquivo e deixaria o outro
 * descoberto (a "meia trava" do COD_MUN do 0150, 22/08).
 *
 * 🚨 **E O RISCO É O MAIOR DE TODOS: o PVA não IMPORTA o arquivo.** Não é uma
 * recusa de campo que se conserta e reenvia — é o arquivo inteiro recusado na
 * porta. Em 24/08 (AFFITTARE) a lição ficou escrita: *"acrescentar UMA linha
 * ao bloco 1 mexe em QUATRO contadores"*, e naquele dia a conferência foi
 * feita à mão. Aqui ela passa a ser automática, em todo arquivo gerado.
 *
 * ⚠️ **A CONTAGEM INCLUI O PRÓPRIO BLOCO 9** — é o que o Guia manda, e é
 * exatamente onde um contador se perde: o 9900 conta as linhas 9900, o 9990 e
 * o 9999 que ainda vão ser escritas.
 */
export function conferirBloco9(linhas) {
    const lista = (linhas || []).map(String).filter((l) => String(l).trim());
    const noves = lista.filter((l) => registroDe(l) === '9999');
    // Arquivo sem bloco 9 não é "arquivo errado": é arquivo PARCIAL (um bloco
    // isolado num teste, por exemplo). Acusar ali seria alarme sobre recorte.
    if (!noves.length) return [];

    const suspeitas = [];
    const contagemReal = new Map();
    for (const l of lista) {
        const r = registroDe(l);
        if (!r) continue;
        contagemReal.set(r, (contagemReal.get(r) || 0) + 1);
    }

    // ── 9900: o que ele declara × o que o arquivo tem ───────────────────────
    const declarado = new Map();
    for (const l of lista) {
        if (registroDe(l) !== '9900') continue;
        const reg = String(campo(l, 2) || '').trim();
        const qtd = Number(String(campo(l, 3) || '').replace(/\D/g, ''));
        if (reg) declarado.set(reg, (declarado.get(reg) || 0) + (Number.isFinite(qtd) ? qtd : 0));
    }
    if (declarado.size) {
        const divergentes = [];
        for (const [reg, real] of contagemReal) {
            const dec = declarado.get(reg);
            if (dec === undefined) { divergentes.push(`${reg}: o 9900 não totaliza (o arquivo tem ${real})`); continue; }
            if (dec !== real) divergentes.push(`${reg}: 9900 diz ${dec}, o arquivo tem ${real}`);
        }
        for (const [reg, dec] of declarado) {
            if (!contagemReal.has(reg)) divergentes.push(`${reg}: o 9900 totaliza ${dec} e o arquivo não tem nenhum`);
        }
        if (divergentes.length) {
            suspeitas.push({
                registro: '9900', tipo: 'bloco9-nao-fecha', gravidade: 'bloqueia',
                detalhe: `O 9900 não bate com o arquivo em ${divergentes.length} tipo(s) de registro: `
                    + `${divergentes.slice(0, 6).join(' · ')}${divergentes.length > 6 ? ' · …' : ''}. `
                    + 'O PVA NÃO IMPORTA o arquivo assim — é defeito de GERAÇÃO, reporte com o print.',
            });
        }
    }

    // ── 9990: linhas do bloco 9 ─────────────────────────────────────────────
    const l9990 = lista.find((l) => registroDe(l) === '9990');
    if (l9990) {
        const doBloco9 = lista.filter((l) => /^9\d{3}$/.test(registroDe(l))).length;
        const dec = Number(String(campo(l9990, 2) || '').replace(/\D/g, ''));
        if (Number.isFinite(dec) && dec !== doBloco9) {
            suspeitas.push({
                registro: '9990', tipo: 'bloco9-nao-fecha', gravidade: 'bloqueia',
                detalhe: `O 9990 declara ${dec} linha(s) no bloco 9 e o arquivo tem ${doBloco9}. `
                    + 'O PVA NÃO IMPORTA o arquivo assim — é defeito de GERAÇÃO.',
            });
        }
    }

    // ── 9999: o arquivo INTEIRO, incluindo a própria linha ──────────────────
    const dec9999 = Number(String(campo(noves[0], 2) || '').replace(/\D/g, ''));
    if (Number.isFinite(dec9999) && dec9999 !== lista.length) {
        suspeitas.push({
            registro: '9999', tipo: 'bloco9-nao-fecha', gravidade: 'bloqueia',
            detalhe: `O 9999 declara ${dec9999} linha(s) e o arquivo tem ${lista.length}. `
                + 'O PVA NÃO IMPORTA o arquivo assim — é defeito de GERAÇÃO, reporte com o print.',
        });
    }
    return suspeitas;
}

/**
 * CADA BLOCO FECHA CONSIGO MESMO — o contador que o `conferirBloco9` não vê.
 *
 * 📖 FONTE — Guia Prático 3.2.3: todo registro **X990** traz, no campo 02
 * (QTD_LIN_X), *"a quantidade total de linhas do Bloco X"*, e a contagem
 * **inclui o próprio X990**.
 *
 * 🚨 **O `conferirBloco9` (29/08) fecha o ARQUIVO e NÃO fecha os blocos.** Ele
 * confere o 9900 (quantas linhas de cada TIPO), o 9990 (o bloco 9) e o 9999 (o
 * arquivo inteiro) — e nenhum dos três olha o **0990**, o **C990**, o **G990**,
 * o **K990**… Um 9900 correto convive com um G990 errado: o 9900 conta que
 * existe 1 linha de G990, não o que ela DECLARA.
 *
 * 🚨 **É a MESMA recusa mais cara de todas: o PVA não IMPORTA o arquivo.** E a
 * casa já pagou por ela à mão — em 24/08 (AFFITTARE) ficou escrito que
 * *"acrescentar UMA linha ao bloco 1 mexe em QUATRO contadores"*, e a
 * conferência daquele dia foi feita a olho, registro a registro.
 *
 * ⚠️ **ELA PROTEGE O BLOCO ISOLADO, e é por isso que ela vale a pena mesmo
 * depois do bloco 9**: o contador de bloco é auto-contido, então ela acusa num
 * recorte que nem tem 9999 — que é exatamente onde os defeitos de 29/08
 * moravam (o bloco G, que UM cliente gera; o C197, que ninguém cadastrou). A
 * lição daquele dia foi *"trava que roda sobre o ARQUIVO só protege o bloco que
 * alguém GEROU"*; esta roda sobre o BLOCO.
 *
 * ⚠️ **O 9990 fica de FORA, de propósito**: ele já tem dono no
 * `conferirBloco9`, e dois alarmes para o mesmo defeito é o caminho conhecido
 * para a equipe ignorar os dois.
 *
 * ⚠️ **E ela é por VARREDURA, nunca por lista** (`^[0-9A-Z]990$`): lista de
 * blocos envelhece no primeiro bloco novo — e envelhece em SILÊNCIO, que é o
 * jeito mais caro. O bloco K entrou em 29/08 e teria ficado de fora de uma.
 */
export function conferirContadoresDeBloco(linhas) {
    const lista = (linhas || []).map(String).filter((l) => String(l).trim());
    const suspeitas = [];

    for (const l of lista) {
        const reg = registroDe(l);
        // O 9990 tem dono (conferirBloco9). Duplicar alarme desliga os dois.
        if (!reg || reg === '9990' || !/^[0-9A-Z]990$/.test(reg)) continue;

        const bloco = reg[0];
        // Linhas do bloco = as que começam pela letra/dígito dele, inclusive o
        // próprio X990 — é o que o Guia manda contar.
        const doBloco = lista.filter((x) => {
            const r = registroDe(x);
            return r && r[0] === bloco && /^[0-9A-Z]\d{3}$/.test(r);
        }).length;

        const dec = Number(String(campo(l, 2) || '').replace(/\D/g, ''));
        if (!Number.isFinite(dec)) {
            suspeitas.push({
                registro: reg, tipo: 'contador-de-bloco-nao-fecha', gravidade: 'bloqueia',
                detalhe: `${reg}: a quantidade de linhas do bloco ${bloco} está ilegível. `
                    + 'O PVA NÃO IMPORTA o arquivo assim — é defeito de GERAÇÃO.',
            });
            continue;
        }
        if (dec !== doBloco) {
            suspeitas.push({
                registro: reg, tipo: 'contador-de-bloco-nao-fecha', gravidade: 'bloqueia',
                detalhe: `${reg} declara ${dec} linha(s) no bloco ${bloco} e o arquivo tem ${doBloco}. `
                    + 'A contagem inclui o próprio ' + reg + '. '
                    + 'O PVA NÃO IMPORTA o arquivo assim — é defeito de GERAÇÃO, reporte com o print.',
            });
        }
    }
    return suspeitas;
}

/**
 * @param {string[]} linhas  arquivo gerado, linha a linha
 * @returns {{suspeitas: Array<{registro:string, tipo:string, gravidade:'bloqueia'|'atencao', detalhe:string}>}}
 */
export function auditarSaidaSped(linhas) {
    const lista = (linhas || []).map(String);
    const suspeitas = [];

    // ── 0. FORMA DA LINHA — antes de qualquer conta sobre o conteúdo ────────
    //
    // 🚨 Caso REALITY 0899 · 07/2026 (21/08): o gerador de ST devolvia linhas
    // sem o `|` inicial e sem `\r\n`, e NOVE registros (E200/E210 de 4 UFs + o
    // E500) saíram GRUDADOS numa única linha. Nada acusou — nem o 9900, nem a
    // prevalidação, nem esta auditoria: todos leem LINHA A LINHA, e a linha
    // grudada é invisível para quem pergunta pelo registro.
    //
    // A verificação mora AQUI porque é a auditoria que roda em TODO arquivo
    // gerado — EFD ICMS/IPI **e** EFD-Contribuições. Deixá-la só na
    // prevalidação do ICMS/IPI (R15) protegeria um arquivo e não o outro,
    // enquanto o defeito é do MECANISMO (módulo formando linha fora do
    // buildLine), não do leiaute.
    for (const suspeita of linhasMalformadas(lista)) suspeitas.push(suspeita);

    // ── 0b. O BLOCO 9 FECHA COM O ARQUIVO ───────────────────────────────────
    // Mesma casa e mesmo motivo da forma da linha: é MECANISMO (contagem), não
    // leiaute, e vale igual nas duas famílias. E é o erro mais caro de todos —
    // o PVA não IMPORTA o arquivo, então não há recusa de campo para consertar.
    for (const suspeita of conferirBloco9(lista)) suspeitas.push(suspeita);

    // ── 0c. CADA BLOCO FECHA CONSIGO MESMO ──────────────────────────────────
    // O bloco 9 fecha o ARQUIVO; o X990 fecha o BLOCO, e um não substitui o
    // outro — um 9900 correto convive com um G990 errado. Esta alcança o
    // recorte que nem tem 9999, que é onde mora o bloco de um cliente só.
    for (const suspeita of conferirContadoresDeBloco(lista)) suspeitas.push(suspeita);

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

    // ── 4. Valor NEGATIVO em campo de valor ─────────────────────────────────
    //
    // 🚨 O leiaute do SPED não carrega SINAL: quando um saldo pode ir para os
    // dois lados, ele tem DOIS campos (devedor e credor), e quando um ajuste
    // soma ou abate, quem diz isso é o CÓDIGO da tabela 5.1.1 — nunca o sinal
    // do número. Um "-1.234,56" no arquivo é sempre uma destas duas coisas:
    //
    //   · uma subtração que passou do zero e ninguém segurou (foi o caso do
    //     E210 em 21/08 — dedução maior que o saldo devedor, que agora sai
    //     NOMEADA em vez de virar crédito a transportar);
    //   · um valor escrito no campo do lado errado (o E110 campo 11, 02/08,
    //     que recebia o saldo CREDOR num campo de saldo DEVEDOR).
    //
    // Nos dois o número é plausível e o erro é invisível a olho. A verificação
    // mora AQUI porque a auditoria roda em TODO arquivo gerado, nas duas
    // famílias — e ela não lista registro por registro de propósito: lista
    // envelhece no primeiro registro novo, e envelhece em silêncio.
    const negativas = [];
    for (const l of lista) {
        const p = partes(l);
        for (let i = 2; i < p.length - 1; i++) {
            // Estreito: só o que É um número SPED negativo. Código de ajuste,
            // data e texto não casam.
            if (/^-\d{1,15}(\.\d{3})*(,\d{1,6})?$/.test(String(p[i]).trim())) {
                negativas.push({ reg: registroDe(l), pos: i, valor: p[i] });
            }
        }
    }
    for (const n of negativas.slice(0, 5)) {
        suspeitas.push({
            registro: n.reg,
            tipo: 'valor-negativo',
            gravidade: 'bloqueia',
            detalhe: `${n.reg}: o campo ${n.pos} saiu NEGATIVO (${n.valor}). O leiaute do SPED não usa sinal — `
                + 'saldo que muda de lado tem campo próprio (devedor × credor) e ajuste que abate é dito pelo '
                + 'CÓDIGO, não pelo sinal. Isto é subtração que passou do zero, ou valor escrito no campo do '
                + 'lado errado.',
        });
    }
    if (negativas.length > 5) {
        suspeitas.push({
            registro: '?', tipo: 'valor-negativo', gravidade: 'bloqueia',
            detalhe: `…e mais ${negativas.length - 5} campo(s) negativo(s) no mesmo arquivo.`,
        });
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
