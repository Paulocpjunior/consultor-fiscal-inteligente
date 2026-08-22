// ============================================================================
// sefaz-backend/sped-prevalidacao.js  (PURO — testável)
// ----------------------------------------------------------------------------
// O "PVA DE BOLSO" — as recusas do PVA conferidas AQUI, sobre o arquivo, antes
// de alguém abrir o validador.
//
// ═══ POR QUE EXISTE (Paulo, 20/08) ══════════════════════════════════════════
//
// *"Um dos maiores gargalos que vem consumindo tempo e retrabalho é o
// EFD-ICMS/IPI… evitando o vai e vem o dia todo"*.
//
// O vai-e-vem não vem só de não conhecer o leiaute: vem de os erros aparecerem
// **um round-trip por vez**. O colaborador gera, abre o PVA, colhe 187 erros,
// manda print, o app conserta um grupo, e recomeça. Cada volta custa um dia.
//
// Este módulo inverte isso: as regras que o PVA JÁ NOS ENSINOU ficam gravadas
// aqui e rodam sobre o ARQUIVO GERADO, na hora, com a mesma mensagem que ele
// daria — e a AÇÃO do lado. Uma volta em vez de N.
//
// ═══ AS DUAS REGRAS DE OURO DESTE MÓDULO ════════════════════════════════════
//
// 1. **CADA REGRA CARREGA A FONTE.** Nada aqui é deduzido de memória: toda
//    entrada traz a recusa LITERAL do PVA, com o cliente e a data em que ela
//    apareceu. Regra sem fonte é chute com cara de validação — e validação
//    errada é pior que validação nenhuma, porque manda consertar o que está
//    certo. Quando o Guia Prático 3.2.2 entrar (o PDF é colado pelo Paulo — a
//    rede deste ambiente não alcança o gov.br), as regras novas entram AQUI,
//    com a citação do manual como fonte.
//
// 2. **CONFERE O ARQUIVO, NÃO A INTENÇÃO.** A entrada são as LINHAS geradas —
//    o mesmo texto que o PVA lê. Auditar o objeto em memória seria auditar o
//    que o app ACHA que gerou; foi por isso que o C100 saiu com modelo 55 e
//    chave 65 durante meses sem nenhum teste acusar.
//
// Irmão de `sped-auditoria-saida.js`, que vigia a CLASSE do erro (coluna
// zerada, total que não bate). Aqui é a REGRA do leiaute, registro a registro.
// ============================================================================

import { cfopExiste } from './cfop-catalogo.js';
// A FORMA da linha (|REG|…|) tem dono na auditoria de saída — ela roda nos DOIS
// arquivos (ICMS/IPI e Contribuições), e o defeito que ela pega é do mecanismo.
import { linhasMalformadas } from './sped-auditoria-saida.js';

const campos = (linha) => String(linha || '').split('|');
const registroDe = (linha) => campos(linha)[1] || '';
const num = (v) => {
    const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.');
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
};
const centavos = (n) => Math.round(n * 100);
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** Modelo declarado DENTRO da chave de acesso (posições 21-22). */
const modeloDaChave = (chave) => {
    const c = soDigitos(chave);
    return c.length === 44 ? c.slice(20, 22) : '';
};

/**
 * Campos que a NFC-e (COD_MOD 65) NÃO pode informar no C100, com a posição do
 * leiaute (contando REG como 1, igual o PVA numera).
 */
const C100_PROIBIDOS_NFCE = [
    [4, 'COD_PART'],
    [23, 'VL_BC_ICMS_ST'],
    [24, 'VL_ICMS_ST'],
    [25, 'VL_IPI'],
    [26, 'VL_PIS'],
    [27, 'VL_COFINS'],
    [28, 'VL_PIS_ST'],
    [29, 'VL_COFINS_ST'],
];

/**
 * Pré-validação do arquivo do EFD ICMS/IPI.
 *
 * @param {string[]} linhas  as linhas do arquivo gerado
 * @param {object} [ctx]     { contribuinteIpi: 'sim'|'nao'|'' }
 * @returns {{erros: object[], avisos: object[], resumo: string}}
 */
export function prevalidarSpedFiscal(linhas, ctx = {}) {
    const lista = (linhas || []).map(String).filter(Boolean);
    const erros = [];
    const avisos = [];
    const add = (destino, o) => destino.push(o);

    const doReg = (reg) => lista.filter((l) => registroDe(l) === reg);
    const c100s = doReg('C100');
    const c170s = doReg('C170');
    const c190s = doReg('C190');
    const d100s = doReg('D100');

    // ── R1. COD_MOD × modelo da CHAVE ───────────────────────────────────────
    // PVA (PS VIDROS 0896 · 07/2026, 19/08, 35 ocorrências):
    // "O modelo da chave do documento eletrônico não confere com o modelo do
    //  documento."
    for (const l of c100s) {
        const f = campos(l);
        const codMod = f[5] || '';
        const daChave = modeloDaChave(f[9]);
        if (daChave && codMod && daChave !== codMod) {
            add(erros, {
                regra: 'cod-mod-x-chave', registro: 'C100', campo: '5 - COD_MOD',
                valor: codMod, esperado: daChave, linha: l,
                mensagem: `A nota nº ${f[8] || '?'} está declarada como modelo ${codMod} e a chave de acesso diz ${daChave}.`,
                acao: 'O modelo tem que sair da chave. Se a nota é NFC-e (65), ela também não pode informar '
                    + 'COD_PART nem os campos de ST/IPI/PIS/COFINS no C100.',
                fonte: 'PVA: "O modelo da chave do documento eletrônico não confere com o modelo do documento" '
                    + '(PS VIDROS 0896 · 07/2026, 19/08).',
            });
        }
    }

    // ── R2. NFC-e não informa participante nem tributos no C100 ─────────────
    // PVA (mesmo arquivo, 86 ocorrências).
    for (const l of c100s) {
        const f = campos(l);
        if ((f[5] || '') !== '65') continue;
        const preenchidos = C100_PROIBIDOS_NFCE
            .filter(([pos]) => String(f[pos] ?? '').trim() !== '')
            .map(([pos, nome]) => `${pos} - ${nome}`);
        if (preenchidos.length) {
            add(erros, {
                regra: 'nfce-campos-proibidos', registro: 'C100', campo: preenchidos.join(', '),
                valor: '', esperado: 'em branco', linha: l,
                mensagem: `A NFC-e nº ${f[8] || '?'} informou campos que o leiaute proíbe para o modelo 65: ${preenchidos.join(', ')}.`,
                acao: 'Venda de balcão não tem participante a declarar, e os tributos vão no C190/C170.',
                fonte: 'PVA: "Para NF Eletrônica para consumidor final (COD_MOD = 65) não devem ser informados '
                    + 'os campos COD_PART, VL_BC_ICMS_ST, VL_ICMS_ST, VL_IPI, VL_PIS, VL_COFINS, VL_PIS_ST e '
                    + 'VL_COFINS_ST" (PS VIDROS 0896, 19/08).',
            });
        }
    }

    // ── R3. Participante do 0150 que ninguém referencia ─────────────────────
    // PVA (PWR 1364 · 07/2026, 19/08).
    const partsReferenciados = new Set([
        ...c100s.map((l) => soDigitos(campos(l)[4])),
        ...d100s.map((l) => soDigitos(campos(l)[4])),
    ].filter(Boolean));
    for (const l of doReg('0150')) {
        const f = campos(l);
        const cod = soDigitos(f[2]);
        if (cod && !partsReferenciados.has(cod)) {
            add(erros, {
                regra: '0150-orfao', registro: '0150', campo: '2 - COD_PART',
                valor: f[2], esperado: 'referenciado ou ausente', linha: l,
                mensagem: `O participante ${f[3] || f[2]} está no 0150 e nenhum documento do arquivo o referencia.`,
                acao: 'Ou a nota dele não foi escriturada (veja os avisos de resumo/sem itens), ou ele só aparece '
                    + 'em NFC-e — que não tem COD_PART. Nos dois casos ele não pode ficar no 0150.',
                fonte: 'PVA: "Não informar participante, se não referenciado em pelo menos um dos demais blocos" '
                    + '(PWR 1364, 19/08).',
            });
        }
    }

    // ── R4. Item do 0200 que ninguém referencia ─────────────────────────────
    const itensReferenciados = new Set(c170s.map((l) => String(campos(l)[3] || '').trim()).filter(Boolean));
    for (const l of doReg('0200')) {
        const f = campos(l);
        const cod = String(f[2] || '').trim();
        if (cod && !itensReferenciados.has(cod)) {
            add(erros, {
                regra: '0200-orfao', registro: '0200', campo: '2 - COD_ITEM',
                valor: cod, esperado: 'referenciado ou ausente', linha: l,
                mensagem: `O item ${cod} está no 0200 e nenhum C170 o referencia.`,
                acao: 'Item só entra no 0200 quando alguma nota de ENTRADA o escritura — itens de saída própria '
                    + 'não geram C170.',
                fonte: 'PVA: "Não informar item, se não referenciado em pelo menos um dos demais blocos" '
                    + '(PWR 1364, 19/08).',
            });
        }
    }

    // ── R5. Unidade do 0190 que ninguém usa ─────────────────────────────────
    const unidsUsadas = new Set([
        ...doReg('0200').map((l) => String(campos(l)[6] || '').trim()),
        ...c170s.map((l) => String(campos(l)[6] || '').trim()),
    ].filter(Boolean));
    for (const l of doReg('0190')) {
        const u = String(campos(l)[2] || '').trim();
        if (u && !unidsUsadas.has(u)) {
            add(erros, {
                regra: '0190-orfao', registro: '0190', campo: '2 - UNID',
                valor: u, esperado: 'referenciada ou ausente', linha: l,
                mensagem: `A unidade ${u} está no 0190 e nenhum 0200/C170 a usa.`,
                acao: 'Unidade só entra quando algum item a referencia.',
                fonte: 'PVA: "Informar código da unidade de medida (UNID) se referenciado em pelo menos um dos '
                    + 'blocos ou no Registro 0200 ou 0220".',
            });
        }
    }

    // ── R6. C100 não cancelado sem nenhum C190 ──────────────────────────────
    // O C190 é filho obrigatório de documento regular — e é ele que a apuração
    // soma. Nota cancelada (COD_SIT 02/03) sai só com o C100, por regra.
    (() => {
        let atual = null;
        let temFilho = false;
        const fecha = () => {
            if (atual && !temFilho) {
                const f = campos(atual);
                add(erros, {
                    regra: 'c100-sem-c190', registro: 'C100', campo: 'C190',
                    valor: f[8] || '?', esperado: 'ao menos um C190', linha: atual,
                    mensagem: `A nota nº ${f[8] || '?'} entrou no arquivo sem nenhum C190.`,
                    acao: 'Nota sem item capturado não pode ser escriturada: importe o XML completo ou rode o '
                        + '♻️ Reler XMLs guardados. Só nota CANCELADA sai com o C100 sozinho.',
                    fonte: 'PVA: "Registro filho obrigatório não foi informado" (PWR 1364, 19/08).',
                });
            }
        };
        for (const l of lista) {
            const reg = registroDe(l);
            if (reg === 'C100') {
                fecha();
                const cancelada = ['02', '03'].includes(campos(l)[6] || '');
                atual = cancelada ? null : l;
                temFilho = false;
            } else if (reg === 'C190' && atual) {
                temFilho = true;
            } else if (reg === 'C990' || reg === 'D001') {
                fecha();
                atual = null;
            }
        }
        fecha();
    })();

    // ── R14. VL_DOC do C100 = Σ VL_OPR dos C190 filhos ──────────────────────
    // Guia Prático 3.2.3, C100 Campo 12 (VL_DOC): *"o valor informado neste
    // campo deve corresponder ao valor total da nota fiscal. Quando houver CBS,
    // IBS ou IS incidentes na operação, o valor deste campo não corresponderá à
    // soma do campo VL_OPR dos registros C190 ('filhos' deste registro C100),
    // EXCETO PARA O EXERCÍCIO 2026"* — ou seja, em 2026 os dois têm que bater.
    //
    // Foi esta igualdade que denunciou o VL_OPR sem o IPI (PWR, 20/08): livro
    // 71.960,81 × PVA 69.760,36, diferença = o IPI. O PVA não RECUSA por isso —
    // ele só imprime um total menor, que é o jeito silencioso de o valor
    // contábil do livro sair a menor.
    //
    // ⚠️ Tolerância de 2 centavos: o VL_OPR é somado item a item e depois
    // arredondado por grupo de CST+CFOP+alíquota, então uma nota com muitos
    // grupos pode fechar com centavo de arredondamento. Diferença MAIOR que
    // isso é sempre componente faltando, nunca arredondamento.
    (() => {
        let atual = null;
        let soma = 0;
        let filhos = 0;
        const fecha = () => {
            // Nota sem nenhum C190 é a R6, que já diz a causa certa (resumo/sem
            // itens). Acusar aqui também daria DOIS alarmes para UM defeito.
            if (!atual || !filhos) return;
            const f = campos(atual);
            const declarado = num(f[12]);
            if (Math.abs(centavos(declarado) - centavos(soma)) > 2) {
                add(erros, {
                    regra: 'c100-x-c190-vl-opr', registro: 'C100', campo: '12 - VL_DOC',
                    valor: declarado.toFixed(2), esperado: soma.toFixed(2), linha: atual,
                    mensagem: `A nota nº ${f[8] || '?'} declara VL_DOC ${declarado.toFixed(2)} e os C190 dela somam `
                        + `${soma.toFixed(2)} de VL_OPR (diferença de ${Math.abs(declarado - soma).toFixed(2)}).`,
                    acao: 'O VL_OPR não é a soma dos vProd: ele inclui frete, seguro, outras despesas, ICMS-ST, '
                        + 'FCP-ST e o IPI destacado, menos o desconto incondicional. Diferença igual ao IPI da nota '
                        + 'é o defeito clássico deste campo.',
                    fonte: 'Guia Prático EFD ICMS/IPI 3.2.3, C100 Campo 12 (VL_DOC) e C190 Campo 05 (VL_OPR) '
                        + '— caso PWR 31947349000169 · 07/2026, 20/08.',
                });
            }
        };
        for (const l of lista) {
            const reg = registroDe(l);
            if (reg === 'C100') {
                fecha();
                const f = campos(l);
                // Cancelada não tem filhos e sai com VL_DOC vazio (Exceção 1) —
                // comparar ali acusaria "0,00 ≠ 0,00" sobre uma nota correta.
                const cancelada = ['02', '03'].includes(f[6] || '');
                atual = (cancelada || !String(f[12] ?? '').trim()) ? null : l;
                soma = 0;
                filhos = 0;
            } else if (reg === 'C190' && atual) {
                soma += num(campos(l)[5]);
                filhos += 1;
            } else if (reg === 'C990' || reg === 'D001') {
                fecha();
                atual = null;
            }
        }
        fecha();
    })();

    // ── R7. E110 campo 6 = Σ VL_ICMS dos C190 de ENTRADA ────────────────────
    // Regra LITERAL do PVA, com a exceção do 1605 e a inclusão do 5605.
    const c190Entrada = c190s.filter((l) => {
        const cfop = soDigitos(campos(l)[3]);
        return (/^[123]/.test(cfop) && cfop !== '1605') || cfop === '5605';
    });
    const somaCreditos = c190Entrada.reduce((s, l) => s + num(campos(l)[7]), 0);
    for (const l of doReg('E110')) {
        const declarado = num(campos(l)[6]);
        if (centavos(declarado) !== centavos(somaCreditos)) {
            add(erros, {
                regra: 'e110-creditos', registro: 'E110', campo: '6 - VL_TOT_CREDITOS',
                valor: declarado.toFixed(2), esperado: somaCreditos.toFixed(2), linha: l,
                mensagem: `O E110 declara ${declarado.toFixed(2)} de crédito e os C190 de entrada somam ${somaCreditos.toFixed(2)}.`,
                acao: 'Quase sempre é nota de entrada que ficou FORA do bloco C (só resumo na base, ou sem itens) '
                    + 'enquanto o valor dela entrou na apuração. Veja os avisos da geração.',
                fonte: 'PVA: "O valor deve ser igual à soma do campo VL_ICMS dos registros (C190, C590, D190, '
                    + 'D590, D730) para CFOP iniciado por 1 (exceto 1605), 2, 3 e CFOP 5605" (PWR 1364, 19/08).',
            });
        }
    }

    // ── R8. Σ VL_IPI dos C190 de entrada = Σ crédito de IPI dos E520 ────────
    const somaIpiEntrada = c190Entrada.reduce((s, l) => s + num(campos(l)[11]), 0);
    const e520s = doReg('E520');
    if (e520s.length) {
        const somaCredE520 = e520s.reduce((s, l) => s + num(campos(l)[4]), 0);
        if (centavos(somaIpiEntrada) !== centavos(somaCredE520)) {
            add(erros, {
                regra: 'e520-credito-ipi', registro: 'E520', campo: '4 - VL_CRED_IPI',
                valor: somaCredE520.toFixed(2), esperado: somaIpiEntrada.toFixed(2), linha: e520s[0],
                mensagem: `O E520 declara ${somaCredE520.toFixed(2)} de crédito de IPI e os C190 de entrada somam ${somaIpiEntrada.toFixed(2)}.`,
                acao: 'Mesma causa do E110: documento fora do bloco C com valor dentro da apuração.',
                fonte: 'PVA: "O somatório dos valores de IPI com CFOP iniciado por 1, 2 ou 3 dos registros C190 '
                    + 'deve ser igual ao somatório dos valores de crédito de IPI registrados nos registros E520" '
                    + '(PWR 1364, 19/08).',
            });
        }
    }

    // ── R9. Contribuinte de IPI: E500 exige o 0002 ──────────────────────────
    if (e520s.length && doReg('0002').length === 0) {
        add(erros, {
            regra: '0002-ausente', registro: '0002', campo: 'registro',
            valor: '', esperado: 'presente', linha: '',
            mensagem: 'O arquivo tem apuração de IPI (E500/E520) e não tem o registro 0002.',
            acao: 'O 0002 é obrigatório para contribuinte de IPI e o código é de TABELA OFICIAL — o app não o '
                + 'deduz. Preencha em Empresas → Dados Fiscais ("Classificação do estab. industrial").',
            fonte: 'PVA: "Registro filho obrigatório não foi informado · 0002" (PWR 1364, 19/08).',
        });
    }

    // ── R10. E500 em quem NÃO é contribuinte de IPI ─────────────────────────
    if (e520s.length && String(ctx.contribuinteIpi || '').toLowerCase().startsWith('na')) {
        add(erros, {
            regra: 'e500-nao-contribuinte', registro: 'E500', campo: 'bloco',
            valor: '', esperado: 'ausente', linha: e520s[0],
            mensagem: 'A empresa está cadastrada como NÃO contribuinte de IPI e o arquivo traz E500/E520.',
            acao: 'Em comércio o IPI da nota do fornecedor é CUSTO, não crédito.',
            fonte: 'PVA: "Se não for contribuinte do IPI, não deve apresentar os registros E500 e filhos" '
                + '(PS VIDROS 0896, 19/08).',
        });
    }

    // ── R11. ST lançada sem o bloco E200 ────────────────────────────────────
    const stNosC190 = c190s.reduce((s, l) => s + num(campos(l)[9]), 0);
    if (stNosC190 > 0 && doReg('E200').length === 0) {
        add(erros, {
            regra: 'st-sem-e200', registro: 'E200', campo: 'bloco',
            valor: stNosC190.toFixed(2), esperado: 'E200/E210 presentes', linha: '',
            mensagem: `Há ${stNosC190.toFixed(2)} de ICMS-ST nos C190 e o arquivo não tem E200.`,
            acao: 'O CFI só apura ST de quem RETÉM como substituto. Confira a UF de destino e o código de receita '
                + 'da GNRE na aba de ajustes antes de transmitir.',
            fonte: 'PVA: "O registro E200 e filhos são obrigatórios sempre que houver lançamento de valor do '
                + 'ICMS-ST, ajustes de ICMS-ST ou informações de contribuinte substituto para a unidade da '
                + 'federação" (PS VIDROS 0896, 19/08).',
        });
    }

    // ── R12. CFOP que não consta da tabela em vigor ─────────────────────────
    // O catálogo tem 619 códigos da redação em vigor (Ajuste SINIEF 03/24).
    const cfopsRuins = new Map();
    for (const l of c190s) {
        const cfop = soDigitos(campos(l)[3]);
        if (cfop.length === 4 && !cfopExiste(cfop)) {
            cfopsRuins.set(cfop, (cfopsRuins.get(cfop) || 0) + 1);
        }
    }
    for (const [cfop, qtd] of cfopsRuins) {
        add(erros, {
            regra: 'cfop-inexistente', registro: 'C190', campo: '3 - CFOP',
            valor: cfop, esperado: 'código da tabela em vigor', linha: '',
            mensagem: `O CFOP ${cfop} não consta da tabela em vigor e aparece em ${qtd} linha(s) do C190.`,
            acao: 'Informe o CFOP nota a nota na aba ✏️ CFOP por nota — o app NÃO escolhe o substituto, porque '
                + 'escolher por dedução é o que produziu o 1405 e o 1655.',
            fonte: 'PVA: "CFOP inválido. Utilizar código da Tabela Código Fiscal de Operação e Prestação - CFOP" '
                + '(PS VIDROS 0896, 19/08).',
        });
    }

    // ── R13. 0100 — EMAIL e COD_MUN são obrigatórios ────────────────────────
    for (const l of doReg('0100')) {
        const f = campos(l);
        const faltando = [];
        if (!String(f[13] || '').trim()) faltando.push('13 - EMAIL');
        if (!soDigitos(f[14])) faltando.push('14 - COD_MUN');
        if (faltando.length) {
            add(erros, {
                regra: '0100-campos', registro: '0100', campo: faltando.join(', '),
                valor: '', esperado: 'preenchido', linha: l,
                mensagem: `O registro do contabilista está sem ${faltando.join(' e ')}.`,
                acao: 'São campos obrigatórios do 0100 — o padrão do escritório está no orquestrador; se mudou o '
                    + 'contabilista, ajuste as envs CONTADOR_EMAIL / CONTADOR_COD_MUN.',
                fonte: 'PVA: "Campo obrigatório · 13 - EMAIL" e "14 - COD_MUN" (PWR 1364, 19/08).',
            });
        }
    }

    // ── R15. Linha malformada — tudo no arquivo é |REG|…|, sem exceção ──────
    // Caso REALITY 0899 · 07/2026 (21/08): o gerador de ST devolvia linhas sem
    // o `|` inicial e sem `\r\n`, e NOVE registros (E200/E210 de 4 UFs + o
    // E500) saíram GRUDADOS numa linha só — invisíveis para o PVA, para o 9900
    // e para ESTA prevalidação, que lê linha a linha. Linha que não casa com o
    // trilho não é registro nenhum: o PVA recusa a importação do arquivo.
    // A régua da FORMA tem dono (`linhasMalformadas`, na auditoria de saída) —
    // ela roda nos DOIS arquivos, ICMS/IPI e Contribuições, porque o defeito é
    // do mecanismo (módulo formando linha fora do buildLine), não do leiaute.
    // Aqui o mesmo fato é reportado com a linguagem de RECUSA que esta tela usa.
    for (const s of linhasMalformadas(lista)) {
        if (s.detalhe.startsWith('…e mais')) {
            avisos.push({ regra: 'linha-malformada', mensagem: s.detalhe });
            continue;
        }
        add(erros, {
            regra: 'linha-malformada', registro: s.registro, campo: '—',
            valor: '', esperado: '|REG|…|', linha: s.detalhe,
            mensagem: 'Linha fora do formato |REG|…| — registro(s) grudado(s) ou separador perdido; '
                + 'o PVA não importa o arquivo assim.',
            acao: 'Isto é defeito de GERAÇÃO do app (não do lançamento) — reporte com o print em vez de '
                + 'editar o arquivo à mão.',
            fonte: 'Arquivo gerado da REALITY 0899 · 07/2026 (21/08): E200/E210 de 4 UFs + E500 numa linha só.',
        });
    }

    // ── R16. DT_DOC do C100 depois do fim do período ────────────────────────
    // Guia Prático 3.2.3, C100, Campo 10 (DT_DOC): "Validação: o valor
    // informado no campo deve ser MENOR OU IGUAL ao valor do campo DT_FIN do
    // registro 0000."
    //
    // 🚨 POR QUE ESTA REGRA NASCEU (22/08): o formatador de data lia
    // `getUTCDate()` sobre o `dhEmi` da NF-e, que vem com o fuso do emitente.
    // Nota emitida às 22h30 de Brasília virava o DIA SEGUINTE em UTC — e na
    // virada do mês, a competência SEGUINTE. Corrigido no formatador; esta
    // regra é a rede, porque o erro é de DATA e ninguém confere data a olho.
    //
    // ⚠️ Só o limite SUPERIOR é checado, de propósito: o Guia não exige
    // DT_DOC ≥ DT_INI no C100 — documento EXTEMPORÂNEO (de mês anterior,
    // escriturado agora) é legítimo, e acusá-lo seria alarme falso.
    const linha0000 = doReg('0000')[0];
    // |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|… → DT_FIN é o índice 5.
    const dtFin = linha0000 ? String(campos(linha0000)[5] || '').replace(/\D/g, '') : '';
    if (dtFin.length === 8) {
        const comoNumero = (ddmmaaaa) => Number(
            `${ddmmaaaa.slice(4)}${ddmmaaaa.slice(2, 4)}${ddmmaaaa.slice(0, 2)}`,
        );
        const limite = comoNumero(dtFin);
        for (const l of c100s) {
            const f = campos(l);
            const dt = String(f[10] || '').replace(/\D/g, '');
            if (dt.length !== 8) continue;
            if (comoNumero(dt) <= limite) continue;
            add(erros, {
                regra: 'dt-doc-fora-do-periodo', registro: 'C100', campo: '10 (DT_DOC)',
                valor: dt, esperado: `≤ ${dtFin}`, linha: `NUM_DOC ${f[8] || '?'}`,
                mensagem: 'Data de emissão POSTERIOR ao fim do período da escrituração.',
                acao: 'Confira a data no XML. Se ela estiver certa lá, é defeito de GERAÇÃO do app '
                    + '(fuso horário) — reporte com o print em vez de editar o arquivo.',
                fonte: 'Guia Prático EFD ICMS/IPI 3.2.3, C100 Campo 10: "o valor informado no campo deve ser '
                    + 'menor ou igual ao valor do campo DT_FIN do registro 0000".',
            });
        }
    }

    const resumo = erros.length
        ? `${erros.length} recusa(s) do PVA previstas neste arquivo — conserte antes de validar.`
        : 'Nenhuma das recusas que o PVA já nos deu aparece neste arquivo.';

    return { erros, avisos, resumo };
}

/** Texto para os warnings da geração — uma linha por erro, com a ação. */
export function resumoPrevalidacao(r) {
    if (!r || !r.erros?.length) return [];
    return [
        `🚦 Pré-validação (o que o PVA vai recusar): ${r.erros.length} ponto(s).`,
        ...r.erros.slice(0, 12).map((e) => `• [${e.registro} · ${e.campo}] ${e.mensagem} ${e.acao}`),
        ...(r.erros.length > 12 ? [`• …e mais ${r.erros.length - 12}. A lista completa está no header X-SPED-Prevalidacao.`] : []),
    ];
}
