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

import {
    conferirCodModContraChave, conferirDtDocNoPeriodo, conferirPeriodoDoArquivo, POS_DT_FIN_ICMS_IPI,
    conferirContador0100,
} from './sped-c100-regras-comuns.js';

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
    // A régua mora em `sped-c100-regras-comuns.js`: o cabeçalho do C100 é o
    // MESMO nas duas famílias, e esta recusa valia no EFD-Contribuições sem
    // rodar lá (a "meia trava" do COD_MUN, 22/08).
    for (const e of conferirCodModContraChave(lista)) add(erros, e);

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

    // ── R21. AS OUTRAS CINCO SOMAS C100 × C190 ──────────────────────────────
    //
    // FONTE — Guia Prático 3.2.3, C100, uma Validação por campo, todas com a
    // mesma frase: *"a soma dos valores do campo <X> dos registros analíticos
    // (C190) deve ser igual ao valor informado neste campo"* — campos 21
    // (VL_BC_ICMS), 22 (VL_ICMS), 23 (VL_BC_ICMS_ST), 24 (VL_ICMS_ST) e 25
    // (VL_IPI).
    //
    // 🚨 SÓ O VL_DOC ESTAVA CONFERIDO (R14), e as outras CINCO são a MESMA
    // classe — no MESMO par de registros que já custou um dia inteiro da PWR
    // (20/08, o VL_OPR sem o IPI). E a condição que produz o defeito continua
    // ali: **o C100 lê os TOTAIS DO DOCUMENTO e o C190 agrega os ITENS**, duas
    // fontes diferentes montadas em passos diferentes do gerador. O comentário
    // do próprio código já afirmava "VL_BC_ICMS — bate com ΣC190" e nada
    // conferia: regra escrita não é regra travada.
    //
    // ⚠️ E O CAMPO 22 É O QUE ALIMENTA A APURAÇÃO: é a soma dos VL_ICMS dos
    // C190 que vira débito e crédito no E110 (a R7 confere justamente isso).
    // Um C100 que discorda dos próprios filhos põe o livro e a apuração em
    // números diferentes para a MESMA nota.
    //
    // ⚠️ Um centavo de tolerância: o C190 arredonda por grupo de
    // CST+CFOP+alíquota, então nota com muitos grupos fecha com centavo.
    (() => {
        const SOMAS = [
            [21, 6, 'VL_BC_ICMS', 'base do ICMS'],
            [22, 7, 'VL_ICMS', 'ICMS destacado — é ele que vira débito/crédito no E110'],
            [23, 8, 'VL_BC_ICMS_ST', 'base do ICMS-ST'],
            [24, 9, 'VL_ICMS_ST', 'ICMS-ST retido'],
            [25, 11, 'VL_IPI', 'IPI destacado — é ele que alimenta o E520'],
        ];
        let atual = null;
        let somas = null;
        let filhos = 0;
        const fecha = () => {
            // Sem filhos a causa é outra e a R6 já a diz — dois alarmes para um
            // defeito é o caminho para a equipe ignorar os dois.
            if (!atual || !filhos) return;
            const f = campos(atual);
            for (const [posC100, posC190, nome, oQueE] of SOMAS) {
                const declarado = num(f[posC100]);
                const somado = somas[posC190];
                if (Math.abs(centavos(declarado) - centavos(somado)) <= 1) continue;
                add(erros, {
                    regra: 'c100-x-c190-totais', registro: 'C100', campo: `${posC100} - ${nome}`,
                    valor: declarado.toFixed(2), esperado: somado.toFixed(2), linha: atual,
                    mensagem: `A nota nº ${f[8] || '?'} declara ${nome} ${declarado.toFixed(2)} e os C190 dela `
                        + `somam ${somado.toFixed(2)} (diferença de ${Math.abs(declarado - somado).toFixed(2)}).`,
                    acao: `O C100 lê os TOTAIS do documento e o C190 agrega os ITENS — quando os dois discordam, `
                        + `ou um item ficou fora do C190, ou o total do XML não é a soma dos itens. É o ${oQueE}.`,
                    fonte: 'Guia Prático EFD ICMS/IPI 3.2.3, C100 campos 21 a 25: "a soma dos valores do campo '
                        + 'dos registros analíticos (C190) deve ser igual ao valor informado neste campo".',
                });
            }
        };
        for (const l of lista) {
            const reg = registroDe(l);
            if (reg === 'C100') {
                fecha();
                const f = campos(l);
                // Cancelada sai com os campos VAZIOS (Exceção 1) e sem filhos.
                atual = ['02', '03'].includes(f[6] || '') ? null : l;
                somas = { 6: 0, 7: 0, 8: 0, 9: 0, 11: 0 };
                filhos = 0;
            } else if (reg === 'C190' && atual) {
                const c = campos(l);
                for (const pos of [6, 7, 8, 9, 11]) somas[pos] += num(c[pos]);
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

    // ── R17. A APURAÇÃO DO E110 TEM DE FECHAR CONSIGO MESMA ─────────────────
    //
    // FONTE — Guia Prático 3.2.3, E110, campo 11 (VL_SLD_APURADO), literal:
    //   *"o valor informado deve ser preenchido com base na expressão: soma do
    //   total de débitos (VL_TOT_DEBITOS) com total de ajustes (VL_AJ_DEBITOS +
    //   VL_TOT_AJ_DEBITOS) com total de estorno de crédito (VL_ESTORNOS_CRED)
    //   menos a soma do total de créditos (VL_TOT_CREDITOS) com total de ajuste
    //   de créditos (VL_AJ_CREDITOS + VL_TOT_AJ_CREDITOS) com total de estorno
    //   de débito (VL_ESTORNOS_DEB) com saldo credor do período anterior
    //   (VL_SLD_CREDOR_ANT). Se o valor da expressão for maior ou igual a '0',
    //   então este valor deve ser informado neste campo e o campo 14
    //   (VL_SLD_CREDOR_TRANSPORTAR) deve ser igual a '0'."*
    // E o campo 13: *"deve corresponder à diferença entre o campo
    // VL_SLD_APURADO e o campo VL_TOT_DED"*.
    //
    // 🚨 É AQUI QUE MORA O NÚMERO QUE VIRA GUIA — e este registro já mordeu:
    // em 02/08 o campo 11 (saldo DEVEDOR) recebia o saldo CREDOR em valor
    // absoluto, ou seja o arquivo declarava imposto a pagar num mês em que a
    // empresa era credora. Os totais ali estavam certos um a um; o que não
    // fechava era a EXPRESSÃO, e nada perguntava por ela.
    //
    // ⚠️ Um centavo de tolerância: os campos saem de `aplicarAjustesApuracao`,
    // que arredonda a cada passo. Alarme sobre arredondamento é o que ensina a
    // equipe a ignorar a prevalidação; erro de sinal ou campo trocado de casa
    // erra por ORDEM DE GRANDEZA.
    for (const l of doReg('E110')) {
        const c = campos(l);
        const v = (i) => num(c[i]);
        const expressao = (v(2) + v(3) + v(4) + v(5)) - (v(6) + v(7) + v(8) + v(9) + v(10));
        const devedor = expressao >= 0;
        const perto = (a, b) => Math.abs(centavos(a) - centavos(b)) <= 1;
        const conta = (campo, esperado, recebido, porque) => {
            if (perto(esperado, recebido)) return;
            add(erros, {
                regra: 'e110-apuracao-nao-fecha', registro: 'E110', campo, linha: l,
                valor: recebido.toFixed(2), esperado: esperado.toFixed(2),
                mensagem: `A apuração do E110 não fecha consigo mesma: ${porque} dá `
                    + `${esperado.toFixed(2)} e o campo declara ${recebido.toFixed(2)}.`,
                acao: 'Isto é defeito de GERAÇÃO (a expressão da apuração), não de lançamento — reporte com '
                    + 'o print em vez de editar o arquivo. Um campo fora do lugar aqui vira guia de ICMS '
                    + 'com o valor errado.',
                fonte: 'Guia Prático 3.2.3, E110, campos 11 e 13 — a expressão da apuração, escrita por '
                    + 'extenso no próprio Guia. Este registro já saiu com o saldo CREDOR no campo do saldo '
                    + 'DEVEDOR (02/08).',
            });
        };
        conta('11 - VL_SLD_APURADO', devedor ? expressao : 0, v(11),
            'débitos + ajustes + estornos de crédito − créditos − ajustes − estornos de débito − saldo credor anterior');
        conta('13 - VL_ICMS_RECOLHER', Math.max(0, v(11) - v(12)), v(13),
            'VL_SLD_APURADO − VL_TOT_DED');
        conta('14 - VL_SLD_CREDOR_TRANSPORTAR', Math.max(0, -(expressao - v(12))), v(14),
            'o valor ABSOLUTO da expressão quando ela é negativa (com as deduções)');
    }

    // ── R18. O que o E110 manda recolher tem de ser o que o E116 cobra ──────
    //
    // FONTE — Guia Prático 3.2.3, E110 campo 13, na mesma Validação:
    //   *"O valor da soma deste campo com o campo DEB_ESP deve ser igual à soma
    //   dos valores do campo VL_OR do registro E116."*
    //
    // 🚨 O E116 é a OBRIGAÇÃO A RECOLHER — é dele que sai a guia. Os dois lados
    // são montados pelo gerador em passos diferentes, então divergirem é
    // exatamente o defeito que ninguém confere a olho: o livro apura um valor e
    // a obrigação cobra outro.
    const e116s = doReg('E116');
    const e110s = doReg('E110');
    if (e116s.length && e110s.length) {
        const somaOr = e116s.reduce((s, l) => s + num(campos(l)[3]), 0);
        const devidoNoE110 = e110s.reduce((s, l) => s + num(campos(l)[13]) + num(campos(l)[15]), 0);
        if (Math.abs(centavos(somaOr) - centavos(devidoNoE110)) > 1) {
            add(erros, {
                regra: 'e110-x-e116', registro: 'E116', campo: '3 - VL_OR', linha: e116s[0],
                valor: somaOr.toFixed(2), esperado: devidoNoE110.toFixed(2),
                mensagem: `O E110 apura ${devidoNoE110.toFixed(2)} a recolher (VL_ICMS_RECOLHER + DEB_ESP) e `
                    + `os E116 somam ${somaOr.toFixed(2)}. O livro e a obrigação declaram valores diferentes `
                    + 'para o MESMO imposto.',
                acao: 'Defeito de GERAÇÃO — reporte com o print. É deste número que sai a guia do ICMS.',
                fonte: 'Guia Prático 3.2.3, E110 campo 13: "O valor da soma deste campo com o campo DEB_ESP '
                    + 'deve ser igual à soma dos valores do campo VL_OR do registro E116".',
            });
        }
    }

    // ── R19. O saldo do IPI no E520 tem de seguir a própria conta ───────────
    //
    // FONTE — Guia Prático 3.2.3, E520, campos 07 e 08:
    //   *"se a soma dos campos VL_DEB_IPI e VL_OD_IPI menos a soma dos campos
    //   VL_SD_ANT_IPI, VL_CRED_IPI e VL_OC_IPI for menor que '0' (zero), então
    //   o campo VL_SC_IPI [deve receber o valor absoluto]"* — e o contrário
    //   para o VL_SD_IPI.
    //
    // 🚨 ESTE REGISTRO JÁ FOI LIDO NA POSIÇÃO ERRADA (19/08): o parser do
    // espelho mapeava o VL_OD_IPI como se fosse o saldo credor, e a tela
    // mostrava "IPI a Recolher" onde estava o crédito. Passou despercebido por
    // meses porque pouquíssimos clientes têm IPI e o número plausível era zero.
    // A linha REAL da PWR fecha: 2.547,39 + 2.200,45 = 4.747,84 no campo 7.
    for (const l of doReg('E520')) {
        const c = campos(l);
        const v = (i) => num(c[i]);
        const saldo = (v(3) + v(5)) - (v(2) + v(4) + v(6));
        const esperadoSc = saldo < 0 ? -saldo : 0;
        const esperadoSd = saldo >= 0 ? saldo : 0;
        for (const [campo, esperado, recebido] of [
            ['7 - VL_SC_IPI', esperadoSc, v(7)],
            ['8 - VL_SD_IPI', esperadoSd, v(8)],
        ]) {
            if (Math.abs(centavos(esperado) - centavos(recebido)) <= 1) continue;
            add(erros, {
                regra: 'e520-saldo-ipi', registro: 'E520', campo, linha: l,
                valor: recebido.toFixed(2), esperado: esperado.toFixed(2),
                mensagem: `O saldo de IPI do E520 não fecha: débitos + outros débitos − saldo anterior − `
                    + `créditos − outros créditos dá ${saldo.toFixed(2)}, então o campo deveria ser `
                    + `${esperado.toFixed(2)} e ele declara ${recebido.toFixed(2)}.`,
                acao: 'Defeito de GERAÇÃO — reporte com o print. Saldo de IPI no campo errado transporta o '
                    + 'crédito para o lado errado e o erro só reaparece na competência seguinte.',
                fonte: 'Guia Prático 3.2.3, E520, campos 07 e 08. A linha real da PWR 07/2026 fecha: '
                    + '|E520|2547,39|0,00|2200,45|0,00|0,00|4747,84|0,00|.',
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

    // ── R30. 0100 — NOME, CPF e CRC, e o DV do CPF ──────────────────────────
    // Irmã da R13 (que cobra EMAIL/COD_MUN, obrigatórios SÓ nesta família). Ela
    // mora no módulo COMUM porque estes três campos e a validação do DV valem
    // nos dois arquivos — e porque o default INVENTADO que a motivou existia
    // nos DOIS geradores.
    for (const e of conferirContador0100(lista)) add(erros, e);

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
    // Mesma casa da R1 — e a posição do DT_FIN é PARÂMETRO porque o 0000 tem
    // leiaute diferente nos dois arquivos (campo 5 aqui, 6 no Contribuições).
    for (const e of conferirDtDocNoPeriodo(lista, POS_DT_FIN_ICMS_IPI)) add(erros, e);

    // ── R20. O período do 0000 tem de ser um MÊS INTEIRO ────────────────────
    // Mesma casa das R1/R16, e pelo MESMO motivo: a validação está nos dois
    // Guias e a regra nasceu hoje no EFD-Contribuições. Deixá-la numa família
    // só é a "meia trava" do COD_MUN do 0150 — aqui os campos são o 04 e o 05.
    for (const e of conferirPeriodoDoArquivo(lista, POS_DT_FIN_ICMS_IPI)) add(erros, e);

    // ════════════════════════════════════════════════════════════════════════
    // R21–R25 — OS REGISTROS QUE NUNCA VIRAM O PVA (29/08)
    //
    // A auditoria do de-para mostrou QUATRO pendências antigas com a mesma
    // forma: código escrito, corrigido, e **nunca validado** — inventário
    // (bloco H), ST (E210/E220/E250) e IPI (E510). Cruzando os registros que
    // os geradores EMITEM com os que esta prevalidação COBRE, esses seis
    // (H005, H010, E210, E220, E250, E510) tinham **zero** regra.
    //
    // 📌 A doutrina do "PVA de bolso" era *recusa aprendida entra no mesmo PR*.
    // Aqui ela vai um passo antes: o Guia 3.2.3 está no repo desde 20/08, e a
    // VALIDAÇÃO OFICIAL entra ANTES de a recusa acontecer — que é a única
    // forma de não gastar a volta de PVA para descobrir o que já estava
    // escrito. Cada regra abaixo cita a validação do Guia, como as outras.
    // ════════════════════════════════════════════════════════════════════════

    // ── R21. O total do inventário tem de ser a soma dos itens ──────────────
    //
    // FONTE — Guia 3.2.3, H005 campo 03 (VL_INV), Validação: *"deve ser igual
    // à soma do campo VL_ITEM do registro H010"*.
    //
    // 🚨 É a MESMA classe do VL_DOC × Σ VL_OPR do C100/C190 (20/08, PWR), que
    // o PVA **não recusa** — ele só imprime um total menor. Aqui o campo é o
    // valor do ESTOQUE, e o Guia é explícito uma linha acima: *"Atribuir valor
    // Zero ao inventário significa escriturar sem estoque"*.
    const h005s = doReg('H005');
    const h010s = doReg('H010');
    if (h005s.length && h010s.length) {
        const somaItens = h010s.reduce((acc, l) => acc + num(campos(l)[6]), 0);
        const totalDeclarado = h005s.reduce((acc, l) => acc + num(campos(l)[3]), 0);
        if (Math.abs(centavos(somaItens) - centavos(totalDeclarado)) > 1) {
            add(erros, {
                regra: 'h005-x-h010', registro: 'H005', campo: '3 - VL_INV', linha: h005s[0],
                valor: totalDeclarado.toFixed(2), esperado: somaItens.toFixed(2),
                mensagem: `O H005 declara estoque de ${totalDeclarado.toFixed(2)} e os ${h010s.length} `
                    + `item(ns) do H010 somam ${somaItens.toFixed(2)}.`,
                acao: 'Defeito de GERAÇÃO — reporte com o print. O H005 é o total do inventário que a '
                    + 'fiscalização lê.',
                fonte: 'Guia Prático 3.2.3, H005 campo 03: "deve ser igual à soma do campo VL_ITEM do '
                    + 'registro H010".',
            });
        }
    }

    // ── R22. Item do inventário que o 0200 não cadastra ─────────────────────
    //
    // FONTE — Guia 3.2.3, H010 campo 02 (COD_ITEM), Validação: *"o valor
    // informado no campo deve existir no campo COD_ITEM do registro 0200"*; e
    // campo 03 (UNID): *"o valor deve ser informado no registro 0200, campo
    // UNID_INV"*.
    //
    // É a família do participante do 0150 e do item do 0200 órfãos — registro
    // que referencia um cadastro que o arquivo não traz.
    if (h010s.length) {
        const itens0200 = new Set(doReg('0200').map((l) => campos(l)[2]).filter(Boolean));
        const semCadastro = h010s
            .map((l) => campos(l)[2])
            .filter((cod) => cod && itens0200.size && !itens0200.has(cod));
        if (semCadastro.length) {
            const unicos = [...new Set(semCadastro)];
            add(erros, {
                regra: 'h010-item-orfao', registro: 'H010', campo: '2 - COD_ITEM',
                valor: unicos.slice(0, 5).join(', '), esperado: 'COD_ITEM cadastrado no 0200',
                linha: h010s[0],
                mensagem: `${unicos.length} item(ns) do inventário não estão declarados no 0200 `
                    + `(${unicos.slice(0, 5).join(', ')}${unicos.length > 5 ? '…' : ''}).`,
                acao: 'Defeito de GERAÇÃO — reporte com o print. O PVA recusa item de inventário que a '
                    + 'Tabela de Identificação não conhece.',
                fonte: 'Guia Prático 3.2.3, H010 campo 02: "o valor informado no campo deve existir no '
                    + 'campo COD_ITEM do registro 0200".',
            });
        }
    }

    // ── R23. Bem de terceiro sem o participante ─────────────────────────────
    //
    // FONTE — Guia 3.2.3, H010 campo 07 (IND_PROP), Validação: *"se preenchido
    // com valor '1' (posse de terceiros) ou '2' (propriedade de terceiros), o
    // campo COD_PART será [obrigatório]"*; e campo 08: *"o valor fornecido
    // deve constar no campo COD_PART do registro 0150"*.
    //
    // ⚠️ Declarar posse de terceiro SEM dizer de quem é o bem é a mesma
    // omissão do COD_PART vazio no C100 — e aqui ela muda de quem é o estoque.
    if (h010s.length) {
        const parts0150 = new Set(doReg('0150').map((l) => campos(l)[2]).filter(Boolean));
        const semParticipante = h010s.filter((l) => {
            const c = campos(l);
            return ['1', '2'].includes(String(c[7] || '').trim())
                && (!c[8] || !String(c[8]).trim() || (parts0150.size && !parts0150.has(c[8])));
        });
        if (semParticipante.length) {
            add(erros, {
                regra: 'h010-terceiro-sem-part', registro: 'H010', campo: '8 - COD_PART',
                valor: '', esperado: 'COD_PART cadastrado no 0150', linha: semParticipante[0],
                mensagem: `${semParticipante.length} item(ns) declaram posse/propriedade de TERCEIRO `
                    + '(IND_PROP 1 ou 2) sem participante válido no 0150.',
                acao: 'Preencha o participante do bem no cadastro do inventário (📦 Inventário, card SPED) — '
                    + 'o arquivo está dizendo que o estoque é de outro sem dizer de quem.',
                fonte: 'Guia Prático 3.2.3, H010 campos 07 e 08.',
            });
        }
    }

    // ── R24. A guia do ST tem de cobrar o que o E210 apurou ─────────────────
    //
    // FONTE — Guia 3.2.3, E250 campo 03 (VL_OR), Validação: *"o valor da soma
    // deste campo deve corresponder à soma dos campos VL_ICMS_RECOL_ST e
    // DEB_ESP_ST do registro E210"*.
    //
    // 🚨 É a GÊMEA da R18 (E110 × E116), do lado do ST — e vale ainda mais
    // aqui: a apuração de ST é POR UF e **cada UF é uma GNRE**. Livro apurando
    // um valor e obrigação cobrando outro é o defeito que ninguém confere a
    // olho, agora multiplicado pelo número de estados.
    const e250s = doReg('E250');
    const e210s = doReg('E210');
    if (e250s.length && e210s.length) {
        const somaOrSt = e250s.reduce((acc, l) => acc + num(campos(l)[3]), 0);
        const devidoNoE210 = e210s.reduce((acc, l) => acc + num(campos(l)[13]) + num(campos(l)[15]), 0);
        if (Math.abs(centavos(somaOrSt) - centavos(devidoNoE210)) > 1) {
            add(erros, {
                regra: 'e210-x-e250', registro: 'E250', campo: '3 - VL_OR', linha: e250s[0],
                valor: somaOrSt.toFixed(2), esperado: devidoNoE210.toFixed(2),
                mensagem: `O E210 apura ${devidoNoE210.toFixed(2)} de ST a recolher (VL_ICMS_RECOL_ST + `
                    + `DEB_ESP_ST) e os E250 somam ${somaOrSt.toFixed(2)}.`,
                acao: 'Defeito de GERAÇÃO — reporte com o print. É deste número que sai a GNRE de cada UF.',
                fonte: 'Guia Prático 3.2.3, E250 campo 03: "o valor da soma deste campo deve corresponder à '
                    + 'soma dos campos VL_ICMS_RECOL_ST e DEB_ESP_ST do registro E210".',
            });
        }
    }

    // ── R25. O E510 tem de fechar com o E520 ────────────────────────────────
    //
    // FONTE — Guia 3.2.3, E510, Validação: *"O total de créditos e dos débitos
    // informados neste registro deverá ser igual ao total dos créditos e
    // débitos dos registros C190 e do registro E520"*.
    //
    // 🚨 É a conferência que faltava no E510 — o registro que este projeto
    // acertou por leitura de arquivo aceito (11/08) e **nunca provou**. O
    // e510 é por CFOP+CST, e a direção do CFOP separa crédito de débito: 1/2/3
    // é ENTRADA (crédito), 5/6/7 é SAÍDA (débito).
    //
    // ⚠️ O par C190 já é conferido pela regra do IPI que existe desde 26/08;
    // aqui o lado que faltava é o E520, que é de onde sai o saldo.
    // ⚠️ `e520s` já foi lido lá em cima (a regra do crédito de IPI, 26/08) —
    // reusa em vez de sombrear.
    const e510s = doReg('E510');
    if (e510s.length && e520s.length) {
        let credE510 = 0;
        let debE510 = 0;
        for (const l of e510s) {
            const c = campos(l);
            const cfop = String(c[2] || '').trim();
            const vlIpi = num(c[6]);
            if (/^[123]/.test(cfop)) credE510 += vlIpi;
            else if (/^[567]/.test(cfop)) debE510 += vlIpi;
        }
        // E520: 02 VL_SD_ANT_IPI · 03 VL_DEB_IPI · 04 VL_CRED_IPI
        const debE520 = e520s.reduce((acc, l) => acc + num(campos(l)[3]), 0);
        const credE520 = e520s.reduce((acc, l) => acc + num(campos(l)[4]), 0);
        for (const [nome, doE510, doE520] of [
            ['débito', debE510, debE520],
            ['crédito', credE510, credE520],
        ]) {
            if (Math.abs(centavos(doE510) - centavos(doE520)) > 1) {
                add(erros, {
                    regra: 'e510-x-e520', registro: 'E510', campo: '6 - VL_IPI', linha: e510s[0],
                    valor: doE510.toFixed(2), esperado: doE520.toFixed(2),
                    mensagem: `O E510 soma ${doE510.toFixed(2)} de ${nome} de IPI e o E520 declara `
                        + `${doE520.toFixed(2)}. A consolidação por CFOP/CST não fecha com a apuração.`,
                    acao: 'Defeito de GERAÇÃO — reporte com o print. É do E520 que sai o saldo de IPI do mês.',
                    fonte: 'Guia Prático 3.2.3, E510: "O total de créditos e dos débitos informados neste '
                        + 'registro deverá ser igual ao total dos créditos e débitos dos registros C190 e do '
                        + 'registro E520".',
                });
            }
        }
    }

    // ── R26. MES_REF do E250 vazio ou fora da competência ───────────────────
    //
    // FONTE — Guia 3.2.3, E250 campo 10 (MES_REF): *"Informe o mês de
    // referência no formato 'mmaaaa'"*, Obrig. **O** (incluído no leiaute a
    // partir de jan/2011); Validação: *"não pode ser superior à competência do
    // campo DT_INI do registro 0000"*.
    //
    // 🚨 O gerador emitia este campo VAZIO — achado desta mesma auditoria. É a
    // classe do M210 da DGB (28/08): campo obrigatório em branco, recusa
    // `Campo de preenchimento obrigatório`.
    if (e250s.length) {
        const dtIni = campos(doReg('0000')[0] || '')[4] || '';
        const compArquivo = String(dtIni).replace(/\D/g, '').slice(2, 8);
        for (const l of e250s) {
            const mesRef = String(campos(l)[10] || '').trim();
            if (!mesRef) {
                add(erros, {
                    regra: 'e250-mes-ref', registro: 'E250', campo: '10 - MES_REF', linha: l,
                    valor: '', esperado: compArquivo || 'mmaaaa',
                    mensagem: 'MES_REF vazio — é campo OBRIGATÓRIO no E250 desde jan/2011.',
                    acao: 'Defeito de GERAÇÃO — reporte com o print.',
                    fonte: 'Guia Prático 3.2.3, E250 campo 10: "Informe o mês de referência no formato '
                        + '\'mmaaaa\'" (Obrig. O).',
                });
            } else if (compArquivo && mesRef.length === 6) {
                // Compara AAAAMM para não depender da ordem do texto.
                const chave = (m) => `${m.slice(2)}${m.slice(0, 2)}`;
                if (chave(mesRef) > chave(compArquivo)) {
                    add(erros, {
                        regra: 'e250-mes-ref', registro: 'E250', campo: '10 - MES_REF', linha: l,
                        valor: mesRef, esperado: `≤ ${compArquivo}`,
                        mensagem: `MES_REF ${mesRef} é posterior à competência do arquivo (${compArquivo}).`,
                        acao: 'Defeito de GERAÇÃO — reporte com o print.',
                        fonte: 'Guia Prático 3.2.3, E250 campo 10: "não pode ser superior à competência do '
                            + 'campo DT_INI do registro 0000".',
                    });
                }
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // R27–R29 — BLOCO K, nascendo COM as regras (29/08)
    //
    // 📌 O bloco K é o primeiro deste projeto a estrear com a prevalidação no
    // MESMO PR do gerador. As quatro pendências que a auditoria achou (H005,
    // H010, E210/E220/E250, E510) existiam justamente por o contrário: código
    // escrito primeiro, regra depois — e "depois" custou uma volta de PVA por
    // cliente. Estas regras **nascem VERDES** sobre o que o gerador produz.
    // ════════════════════════════════════════════════════════════════════════
    const k200s = doReg('K200');
    const k100s = doReg('K100');

    // ── R27. A data do estoque é a DT_FIN do K100 ───────────────────────────
    //
    // FONTE — Guia 3.2.3, K200 campo 02 (DT_EST), Validação: *"a data do
    // estoque deve ser igual à data final do período de apuração – campo
    // DT_FIN do Registro K100"*.
    if (k200s.length && k100s.length) {
        // ⚠️ `campos()[1]` é o REG — o campo 02 do leiaute é o índice 2.
        const dtFinK100 = String(campos(k100s[0])[3] || '').trim();
        const fora = k200s.filter((l) => String(campos(l)[2] || '').trim() !== dtFinK100);
        if (dtFinK100 && fora.length) {
            add(erros, {
                regra: 'k200-dt-est', registro: 'K200', campo: '2 - DT_EST', linha: fora[0],
                valor: String(campos(fora[0])[2] || ''), esperado: dtFinK100,
                mensagem: `${fora.length} linha(s) de estoque com data diferente da DT_FIN do K100 (${dtFinK100}).`,
                acao: 'Defeito de GERAÇÃO — reporte com o print.',
                fonte: 'Guia Prático 3.2.3, K200 campo 02: "a data do estoque deve ser igual à data final '
                    + 'do período de apuração – campo DT_FIN do Registro K100".',
            });
        }
    }

    // ── R28. Item do bloco K que o 0200 não cadastra ────────────────────────
    //
    // FONTE — Guia 3.2.3, K200 campo 03 (COD_ITEM), Validação: *"o valor
    // informado no campo deve existir no campo COD_ITEM do registro 0200"*.
    // Mesma família do H010 órfão (R22) e do participante do 0150.
    const kComItem = [...k200s, ...doReg('K230'), ...doReg('K235')];
    if (kComItem.length) {
        const itens0200K = new Set(doReg('0200').map((l) => campos(l)[2]).filter(Boolean));
        // No K200 e no K235 o COD_ITEM é o campo 03; no K230 é o 05.
        const codDaLinha = (l) => (registroDe(l) === 'K230' ? campos(l)[5] : campos(l)[3]);
        const orfaos = [...new Set(
            kComItem.map(codDaLinha).filter((c) => c && itens0200K.size && !itens0200K.has(c)),
        )];
        if (orfaos.length) {
            add(erros, {
                regra: 'k-item-orfao', registro: 'K200', campo: '3 - COD_ITEM', linha: kComItem[0],
                valor: orfaos.slice(0, 5).join(', '), esperado: 'COD_ITEM cadastrado no 0200',
                mensagem: `${orfaos.length} item(ns) do bloco K não estão declarados no 0200 `
                    + `(${orfaos.slice(0, 5).join(', ')}${orfaos.length > 5 ? '…' : ''}).`,
                acao: 'Defeito de GERAÇÃO — reporte com o print. O PVA recusa item que a Tabela de '
                    + 'Identificação não conhece.',
                fonte: 'Guia Prático 3.2.3, K200 campo 03: "o valor informado no campo deve existir no '
                    + 'campo COD_ITEM do registro 0200".',
            });
        }
    }

    // ── R29. Estoque de/em poder de TERCEIRO sem participante ───────────────
    //
    // FONTE — Guia 3.2.3, K200 campo 06 (COD_PART), Validação: *"o
    // preenchimento do campo é obrigatório se o campo IND_EST for igual a 1 ou
    // 2"* — e o participante tem de existir no 0150.
    if (k200s.length) {
        const parts0150 = new Set(doReg('0150').map((l) => campos(l)[2]).filter(Boolean));
        for (const l of k200s) {
            const c = campos(l);
            const indEst = String(c[5] || '').trim();
            const codPart = String(c[6] || '').trim();
            if (!['1', '2'].includes(indEst)) continue;
            if (!codPart) {
                add(erros, {
                    regra: 'k200-cod-part', registro: 'K200', campo: '6 - COD_PART', linha: l,
                    valor: '', esperado: 'participante do 0150',
                    mensagem: `Estoque com IND_EST ${indEst} (poder de terceiro) sem COD_PART.`,
                    acao: 'Defeito de GERAÇÃO — reporte com o print.',
                    fonte: 'Guia Prático 3.2.3, K200 campo 06: "o preenchimento do campo é obrigatório se '
                        + 'o campo IND_EST for igual a 1 ou 2".',
                });
            } else if (parts0150.size && !parts0150.has(codPart)) {
                add(erros, {
                    regra: 'k200-cod-part', registro: 'K200', campo: '6 - COD_PART', linha: l,
                    valor: codPart, esperado: 'participante declarado no 0150',
                    mensagem: `O participante ${codPart} do estoque de terceiro não está no 0150.`,
                    acao: 'Defeito de GERAÇÃO — reporte com o print.',
                    fonte: 'Guia Prático 3.2.3, K200 campo 06 — o participante deve existir no registro 0150.',
                });
            }
        }
    }


    // ── R31. O 1010 tem de concordar com o que o arquivo traz (IND_VA × 1400) ─
    //
    // 📖 FONTE — Guia 3.2.3, 1010 campo 06 (IND_VA): *"Reg 1400 - Sendo o
    // registro obrigatório em sua Unidade de Federação, existem informações a
    // serem prestadas neste registro: S – Sim; N - Não"*. Ou seja o indicador
    // e a existência do 1400 são o MESMO fato dito duas vezes, e o comentário
    // do próprio gerador registra que **o PVA rejeita as duas combinações
    // erradas** — 'S' sem 1400 e 'N' com 1400.
    //
    // 🚨 O 1400 é a DIPAM por município (compra de produtor rural paulista), e
    // ele é gerado por dados que vêm de OUTRO trilho (a aba 🌾). Um mês em que
    // a DIPAM some — ou aparece — sem o indicador acompanhar é justamente onde
    // este par se desencontra.
    //
    // ⚠️ **ESTA REGRA NÃO PODE IR PARA O MÓDULO COMUM.** O `1010` do
    // EFD-**Contribuições** é OUTRO registro — *Processo Referenciado (ação
    // judicial)* —, e foi exatamente confundi-los que fez o gerador declarar
    // um processo judicial com os campos preenchidos com 'N' (MANTOAN, 17/08).
    // Mesmo número, arquivo diferente, leiaute diferente.
    //
    // ⚠️ E só o IND_VA é conferido: os outros indicadores do 1010 apontam
    // registros que este app **não gera**, então 'N' é sempre a resposta certa
    // e cobrar coerência ali seria alarme sobre arquivo correto.
    const l1010 = doReg('1010');
    if (l1010.length) {
        const indVa = String(campos(l1010[0])[6] || '').trim().toUpperCase();
        const qtd1400 = doReg('1400').length;
        if (indVa === 'S' && qtd1400 === 0) {
            add(erros, {
                regra: '1010-x-1400', registro: '1010', campo: '6 - IND_VA', linha: l1010[0],
                valor: 'S', esperado: 'N',
                mensagem: 'O 1010 diz que há informações de Valor Adicionado (IND_VA = S) e o arquivo não '
                    + 'traz nenhum registro 1400.',
                acao: 'Defeito de GERAÇÃO — reporte com o print. O PVA recusa as duas combinações erradas.',
                fonte: 'Guia Prático 3.2.3, 1010 campo 06: "Reg 1400 - … existem informações a serem '
                    + 'prestadas neste registro: S – Sim; N - Não".',
            });
        } else if (indVa === 'N' && qtd1400 > 0) {
            add(erros, {
                regra: '1010-x-1400', registro: '1010', campo: '6 - IND_VA', linha: l1010[0],
                valor: 'N', esperado: 'S',
                mensagem: `O arquivo traz ${qtd1400} registro(s) 1400 (DIPAM por município) e o 1010 diz que `
                    + 'NÃO há informações de Valor Adicionado (IND_VA = N).',
                acao: 'Defeito de GERAÇÃO — reporte com o print. O PVA recusa as duas combinações erradas.',
                fonte: 'Guia Prático 3.2.3, 1010 campo 06: "Reg 1400 - … existem informações a serem '
                    + 'prestadas neste registro: S – Sim; N - Não".',
            });
        }
    }


    // ── R32. O período do E100 tem de caber no período do arquivo ───────────
    //
    // 📖 FONTE — Guia 3.2.3, E100 campo 02 (DT_INI), Validação: *"o valor
    // informado no campo deve ser menor ou igual ao valor no campo DT_FIN do
    // registro 0000 e maior ou igual ao valor no campo DT_INI do registro
    // 0000. A data informada no campo deve ser menor ou igual à data informada
    // no campo DT_FIN do registro E100"*. E a Validação do Registro: *"Não
    // podem ser informados dois ou mais registros com a mesma combinação de
    // valores dos campos 02 (DT_INI), 03 (DT_FIN)"*.
    //
    // 🚨 É a classe mais cara do arquivo — a do PERÍODO: o E100 é o PAI do
    // E110, e uma apuração declarada com data fora do arquivo põe o imposto no
    // mês errado. Não é recusa que se lê num campo: ninguém confere data de
    // apuração a olho (a lição do período do 0000, 26/08).
    const e100s = doReg('E100');
    if (e100s.length) {
        const l0000 = doReg('0000')[0] || '';
        const dtIniArq = soDigitos(campos(l0000)[4]);
        const dtFimArq = soDigitos(campos(l0000)[5]);
        // A data vem DDMMAAAA; para comparar, vira AAAAMMDD.
        const ord = (d) => (d.length === 8 ? `${d.slice(4)}${d.slice(2, 4)}${d.slice(0, 2)}` : '');
        const vistos = new Set();
        for (const l of e100s) {
            const ini = soDigitos(campos(l)[2]);
            const fim = soDigitos(campos(l)[3]);
            const chave = `${ini}-${fim}`;
            if (vistos.has(chave)) {
                add(erros, {
                    regra: 'e100-periodo', registro: 'E100', campo: '2 - DT_INI, 3 - DT_FIN', linha: l,
                    valor: chave, esperado: 'períodos distintos',
                    mensagem: `Há dois registros E100 com o mesmo período (${ini} a ${fim}).`,
                    acao: 'Defeito de GERAÇÃO — reporte com o print.',
                    fonte: 'Guia Prático 3.2.3, E100, Validação do Registro: "Não podem ser informados dois '
                        + 'ou mais registros com a mesma combinação de valores dos campos 02 (DT_INI), 03 (DT_FIN)".',
                });
            }
            vistos.add(chave);
            if (ord(ini) && ord(fim) && ord(ini) > ord(fim)) {
                add(erros, {
                    regra: 'e100-periodo', registro: 'E100', campo: '2 - DT_INI', linha: l,
                    valor: ini, esperado: `≤ ${fim}`,
                    mensagem: `O E100 abre a apuração em ${ini} e a encerra antes, em ${fim}.`,
                    acao: 'Defeito de GERAÇÃO — reporte com o print.',
                    fonte: 'Guia Prático 3.2.3, E100 campo 02: "A data informada no campo deve ser menor ou '
                        + 'igual à data informada no campo DT_FIN do registro E100".',
                });
            }
            if (!dtIniArq || !dtFimArq) continue;
            const fora = (ord(ini) && (ord(ini) < ord(dtIniArq) || ord(ini) > ord(dtFimArq)))
                || (ord(fim) && (ord(fim) < ord(dtIniArq) || ord(fim) > ord(dtFimArq)));
            if (fora) {
                add(erros, {
                    regra: 'e100-periodo', registro: 'E100', campo: '2 - DT_INI, 3 - DT_FIN', linha: l,
                    valor: `${ini} a ${fim}`, esperado: `dentro de ${dtIniArq} a ${dtFimArq}`,
                    mensagem: `A apuração do ICMS (E100) vai de ${ini} a ${fim}, fora do período do arquivo `
                        + `(${dtIniArq} a ${dtFimArq}).`,
                    acao: 'Defeito de GERAÇÃO — reporte com o print. É o E100 que diz A QUE MÊS a apuração '
                        + 'se refere: fora do período, o imposto é declarado no mês errado.',
                    fonte: 'Guia Prático 3.2.3, E100 campo 02: "deve ser menor ou igual ao valor no campo '
                        + 'DT_FIN do registro 0000 e maior ou igual ao valor no campo DT_INI do registro 0000".',
                });
            }
        }
    }

    // ── R33. O D100 tem de bater com os D190 filhos ─────────────────────────
    //
    // 📖 FONTE — Guia 3.2.3, D190 campos 06 e 07, Validação: *"o valor
    // informado deve ser igual ao valor do campo VL_BC_ICMS do registro D100,
    // pai deste registro D190"* e o mesmo para o `VL_ICMS`.
    //
    // 🚨 É EXATAMENTE a classe que custou um dia da PWR (20/08) no par
    // C100 × C190, e que em 26/08 rendeu cinco regras novas: o registro PAI lê
    // os totais do documento e o FILHO agrega os itens — duas fontes, dois
    // passos do gerador. E aqui o PVA **não recusa**: ele só imprime um total
    // menor, que é o erro que só aparece na fiscalização.
    //
    // ⚠️ A comparação é com a SOMA dos filhos: o Guia escreve "o valor
    // informado" porque um D100 costuma ter um D190, mas o registro agrega por
    // CST/CFOP/alíquota e pode ter vários — a leitura por soma vale nos dois
    // casos, e é a mesma que o C190 usa com todas as letras.
    //
    // 🚨 E O PAREAMENTO É PELA SEQUÊNCIA, NUNCA PELO PRIMEIRO D100 — a 1ª
    // versão desta regra comparava `d100s[0]` contra a soma de TODOS os D190
    // do arquivo. Isso funciona no arquivo de UM conhecimento e mente em todos
    // os outros: empresa com dez CT-e teria a base do primeiro comparada com a
    // soma dos dez, acusando um arquivo CERTO. Aqui vale o mesmo desenho do
    // C100 × C190 (R21): o filho pertence ao PAI que o antecede.
    (() => {
        // ⚠️ A POSIÇÃO É PARÂMETRO, NUNCA DEDUÇÃO DO VIZINHO — e eu escrevi a
        // do C100 aqui na primeira versão. O D100 tem **23** campos (não os 29
        // do C100) e o par fica em **19 (VL_BC_ICMS)** e **20 (VL_ICMS)**,
        // lidos do que o gerador REAL emite. É a mesma razão pela qual o A100 e
        // o D100 ficam de fora das regras comuns do C100 (26/08).
        const SOMAS = [
            [19, 6, 'VL_BC_ICMS', 'base do ICMS do frete'],
            [20, 7, 'VL_ICMS', 'ICMS do frete — é ele que vira crédito no E110'],
        ];
        let atual = null;
        let somas = null;
        let filhos = 0;
        const fecha = () => {
            if (!atual || !filhos) return;
            const f = campos(atual);
            for (const [posD100, posD190, nome, oQueE] of SOMAS) {
                const declarado = num(f[posD100]);
                const somado = somas[posD190];
                if (Math.abs(centavos(declarado) - centavos(somado)) <= 1) continue;
                add(erros, {
                    regra: 'd100-x-d190', registro: 'D100', campo: `${posD100} - ${nome}`, linha: atual,
                    valor: declarado.toFixed(2), esperado: somado.toFixed(2),
                    mensagem: `O CT-e nº ${f[9] || '?'} declara ${nome} ${declarado.toFixed(2)} e os `
                        + `${filhos} D190 dele somam ${somado.toFixed(2)}.`,
                    acao: `O PVA não recusa isto: ele só imprime um total menor, e é o D190 que a apuração `
                        + `soma. É o ${oQueE}. Defeito de GERAÇÃO — reporte com o print.`,
                    fonte: `Guia Prático 3.2.3, D190: "o valor informado deve ser igual ao valor do campo `
                        + `${nome} do registro D100, pai deste registro D190".`,
                });
            }
        };
        for (const l of lista) {
            const reg = registroDe(l);
            if (reg === 'D100') {
                fecha();
                // Cancelado sai com os campos de valor VAZIOS e sem filhos —
                // comparar ali acusaria documento correto.
                atual = ['02', '03'].includes(campos(l)[6] || '') ? null : l;
                somas = { 6: 0, 7: 0 };
                filhos = 0;
            } else if (reg === 'D190' && atual) {
                const c = campos(l);
                for (const pos of [6, 7]) somas[pos] += num(c[pos]);
                filhos += 1;
            } else if (reg === 'D990' || reg === 'E001') {
                fecha();
                atual = null;
            }
        }
        fecha();
    })();

    // ── R34. O G110 (CIAP) fecha consigo mesmo ──────────────────────────────
    //
    // 📖 FONTE — Guia 3.2.3, G110, que escreve as três contas POR EXTENSO:
    // campo 05 (SOM_PARC), *"O valor preenchido corresponde ao somatório de
    // todos os valores informados no campo 10 (VL_PARC_PASS) dos registros
    // G125"*; campo 06 (VL_TRIB_EXP), *"o valor informado deve ser menor ou
    // igual ao valor informado no campo VL_TOTAL deste registro"*; campo 08
    // (IND_PER_SAI), *"o resultado da divisão do campo VL_TRIB_EXP pelo campo
    // VL_TOTAL"*; e campo 09 (ICMS_APROP), *"correspondente à multiplicação do
    // campo 05 pelo campo 08"*.
    //
    // 🚨 É a MESMA classe do E110 e do M200 — o registro que se desmente por
    // dentro —, e aqui o número que sai dele **vira ajuste de apuração**: um
    // G110 que não fecha credita ICMS a mais ou a menos, e o PVA aceita.
    //
    // ⚠️ E o índice tem OITO casas: comparar o crédito com tolerância de um
    // centavo é o certo (é o arredondamento do próprio campo), mas comparar o
    // ÍNDICE em centavos apagaria justamente as casas que ele carrega.
    const g110s = doReg('G110');
    if (g110s.length) {
        const g = campos(g110s[0]);
        const somParc = num(g[5]);
        const vlTribExp = num(g[6]);
        const vlTotal = num(g[7]);
        const indice = num(g[8]);
        const icmsAprop = num(g[9]);
        const somaG125 = doReg('G125').reduce((a, l) => a + num(campos(l)[10]), 0);
        const acusa = (campo, valor, esperado, mensagem, fonte) => add(erros, {
            regra: 'g110-nao-fecha', registro: 'G110', campo, linha: g110s[0], valor, esperado, mensagem,
            acao: 'Defeito de GERAÇÃO — reporte com o print. O número do G110 vira ajuste na apuração do '
                + 'ICMS: um registro que não fecha credita a mais ou a menos, e o PVA aceita.',
            fonte,
        });
        if (Math.abs(centavos(somParc) - centavos(somaG125)) > 1) {
            acusa('5 - SOM_PARC', somParc.toFixed(2), somaG125.toFixed(2),
                `O G110 declara Σ das parcelas ${somParc.toFixed(2)} e os G125 somam ${somaG125.toFixed(2)}.`,
                'Guia Prático 3.2.3, G110 campo 05: "O valor preenchido corresponde ao somatório de todos '
                + 'os valores informados no campo 10 (VL_PARC_PASS) dos registros G125".');
        }
        if (centavos(vlTribExp) > centavos(vlTotal)) {
            acusa('6 - VL_TRIB_EXP', vlTribExp.toFixed(2), `≤ ${vlTotal.toFixed(2)}`,
                `As saídas tributadas/exportação (${vlTribExp.toFixed(2)}) superam o TOTAL das saídas `
                + `(${vlTotal.toFixed(2)}).`,
                'Guia Prático 3.2.3, G110 campo 06: "o valor informado deve ser menor ou igual ao valor '
                + 'informado no campo VL_TOTAL deste registro".');
        }
        // ⚠️ Total ZERO não é erro do índice — é mês sem saída, e dividir ali
        // seria o app inventando a conta. Acusar produziria alarme sobre
        // arquivo correto.
        if (vlTotal > 0) {
            const esperado = vlTribExp / vlTotal;
            if (Math.abs(indice - esperado) > 0.00000002) {
                acusa('8 - IND_PER_SAI', indice.toFixed(8), esperado.toFixed(8),
                    `O índice declarado (${indice.toFixed(8)}) não é ${vlTribExp.toFixed(2)} ÷ `
                    + `${vlTotal.toFixed(2)} = ${esperado.toFixed(8)}.`,
                    'Guia Prático 3.2.3, G110 campo 08: "o resultado da divisão do campo VL_TRIB_EXP pelo '
                    + 'campo VL_TOTAL".');
            }
        }
        const aprop = somParc * indice;
        if (Math.abs(centavos(icmsAprop) - centavos(aprop)) > 1) {
            acusa('9 - ICMS_APROP', icmsAprop.toFixed(2), aprop.toFixed(2),
                `O crédito apropriado (${icmsAprop.toFixed(2)}) não é ${somParc.toFixed(2)} × `
                + `${indice.toFixed(8)} = ${aprop.toFixed(2)}.`,
                'Guia Prático 3.2.3, G110 campo 09: "correspondente à multiplicação do campo 05 pelo '
                + 'campo 08".');
        }
    }

    // ── R37/R38. Os ajustes do E110 batem com os E111 e com os C197 ─────────
    //
    // 📖 FONTE — Guia 3.2.3, E110, quatro validações que dizem POR EXTENSO de
    // onde cada campo vem, separando pelo **4º caractere** do `COD_AJ_APUR`
    // (com o 3º = '0', que é o ajuste da APURAÇÃO, não do documento):
    //   · campo 04 `VL_TOT_AJ_DEBITOS`  ← 4º = '0'
    //   · campo 05 `VL_ESTORNOS_CRED`   ← 4º = '1'
    //   · campo 08 `VL_TOT_AJ_CREDITOS` ← 4º = '2'
    //   · campo 09 `VL_ESTORNOS_DEB`    ← 4º = '3'
    // E os campos 03/07 (`VL_AJ_DEBITOS`/`VL_AJ_CREDITOS`) vêm dos **C197**,
    // pelo 3º caractere do `COD_AJ` — 3/4/5 débito, 0/1/2 crédito.
    //
    // 🚨 É a MESMA classe do E110 campo 11 (02/08): cada total, isolado, está
    // certo; o que não fecha é a EXPRESSÃO — e é a apuração que vira a GUIA.
    // A R17 confere o E110 consigo mesmo; estas conferem contra os FILHOS, que
    // é onde o gerador monta o número num passo diferente.
    const e110 = doReg('E110')[0];
    if (e110) {
        const e = campos(e110);
        const e111s = doReg('E111');
        const somaPorTipo = (quarto) => e111s.reduce((a, l) => {
            const cod = String(campos(l)[2] || '').trim();
            // 3º caractere '0' = ajuste da APURAÇÃO (o do documento é 1..5 e
            // vive no C197). Código curto não classifica — e classificar por
            // dedução seria somar no campo errado.
            if (cod.length < 4 || cod[2] !== '0' || cod[3] !== quarto) return a;
            return a + num(campos(l)[4]);
        }, 0);
        for (const [pos, quarto, nome, oQueE] of [
            [4, '0', 'VL_TOT_AJ_DEBITOS', 'ajuste a débito'],
            [5, '1', 'VL_ESTORNOS_CRED', 'estorno de crédito'],
            [8, '2', 'VL_TOT_AJ_CREDITOS', 'ajuste a crédito'],
            [9, '3', 'VL_ESTORNOS_DEB', 'estorno de débito'],
        ]) {
            const declarado = num(e[pos]);
            const somado = somaPorTipo(quarto);
            if (Math.abs(centavos(declarado) - centavos(somado)) <= 1) continue;
            add(erros, {
                regra: 'e110-x-e111', registro: 'E110', campo: `${pos} - ${nome}`, linha: e110,
                valor: declarado.toFixed(2), esperado: somado.toFixed(2),
                mensagem: `O E110 declara ${nome} ${declarado.toFixed(2)} e os E111 de ${oQueE} `
                    + `(COD_AJ_APUR com 4º caractere '${quarto}') somam ${somado.toFixed(2)}.`,
                acao: 'Defeito de GERAÇÃO — reporte com o print. É o E110 que vira a GUIA: um total que '
                    + 'não bate com os próprios ajustes recolhe a mais ou a menos.',
                fonte: `Guia Prático 3.2.3, E110 campo ${String(pos).padStart(2, '0')}: "o valor informado `
                    + `deve corresponder ao somatório do campo VL_AJ_APUR dos registros E111, se o terceiro `
                    + `caractere for igual a '0' e o quarto caractere do campo COD_AJ_APUR do registro E111 `
                    + `for igual a '${quarto}'".`,
            });
        }

        // ── R38. Os campos 03/07 vêm dos C197 ───────────────────────────────
        //
        // 🚨 E AQUI HÁ UMA PREMISSA DO APP QUE O GUIA CONTRARIA, e ela vai
        // DITA em vez de "corrigida": o gerador do DIFAL escreve, no próprio
        // aviso, *"o DÉBITO na apuração não vem do C197 — lance o ajuste
        // correspondente na aba Ajustes E111"*, e cravou os campos 03/07 em
        // ZERO. O Guia diz que eles são a Σ dos C197. Se a equipe cadastrar um
        // COD_AJ de débito (3º caractere 3/4/5) E lançar o E111 do mesmo
        // valor, o arquivo declara o DIFAL **duas vezes**; se lançar só o
        // E111, o campo 03 sai zerado com um C197 de débito no arquivo.
        //
        // ⚠️ O app NÃO escolhe qual das duas: o COD_AJ é ESTADUAL e é ele que
        // decide. A regra nomeia a divergência e diz as DUAS saídas.
        const c197s = doReg('C197');
        if (c197s.length) {
            const somaC197 = (terceiros) => c197s.reduce((a, l) => {
                const cod = String(campos(l)[2] || '').trim();
                if (cod.length < 4 || !terceiros.includes(cod[2])) return a;
                // 4º caractere restrito pelo Guia: '0' ou '3'..'8'.
                if (!['0', '3', '4', '5', '6', '7', '8'].includes(cod[3])) return a;
                return a + num(campos(l)[7]);
            }, 0);
            for (const [pos, terceiros, nome, lado] of [
                [3, ['3', '4', '5'], 'VL_AJ_DEBITOS', 'débito'],
                [7, ['0', '1', '2'], 'VL_AJ_CREDITOS', 'crédito'],
            ]) {
                const declarado = num(e[pos]);
                const somado = somaC197(terceiros);
                if (Math.abs(centavos(declarado) - centavos(somado)) <= 1) continue;
                add(erros, {
                    regra: 'e110-x-c197', registro: 'E110', campo: `${pos} - ${nome}`, linha: e110,
                    valor: declarado.toFixed(2), esperado: somado.toFixed(2),
                    mensagem: `O E110 declara ${nome} ${declarado.toFixed(2)} e os C197 de ${lado} somam `
                        + `${somado.toFixed(2)}.`,
                    acao: `O app crava este campo em ZERO porque trata o C197 como ORIGEM DOCUMENTAL e faz `
                        + `o ${lado} entrar pelo E111 — e o Guia manda somar os C197 aqui. Confira o COD_AJ `
                        + `cadastrado (tabela 5.3 do seu estado): se ele é de ${lado}, ou o ajuste do E111 `
                        + `sobra (o valor seria declarado DUAS vezes), ou este campo tem de trazer a soma. `
                        + `Não deduza — o código é estadual e é ele que decide.`,
                    fonte: `Guia Prático 3.2.3, E110 campo ${String(pos).padStart(2, '0')}: "o valor `
                        + `informado deve corresponder ao somatório do campo VL_ICMS dos registros C197, `
                        + `C597, C857, C897, D197 e D737 se o terceiro caractere do campo COD_AJ (…) for `
                        + `igual a '${terceiros.join("', '")}'".`,
                });
            }
        }
    }

    // ── R39. Os ajustes do E210 (ST) batem com os E220 filhos ───────────────
    //
    // 📖 FONTE — Guia 3.2.3, E210, que nomeia os quatro campos sem margem:
    //  · 06 `VL_OUT_CRED_ST`    — *"Ajustes 'Outros créditos ST' e 'Estorno de
    //    débitos ST'"*, Σ dos **E220** com 3º = '1' e 4º = '2' ou '3';
    //  · 07 `VL_AJ_CREDITOS_ST` — *"provenientes de ajustes do DOCUMENTO
    //    FISCAL"*, ou seja dos **C197**;
    //  · 09 `VL_OUT_DEB_ST`     — *"Outros débitos ST e Estorno de créditos
    //    ST"*, Σ dos **E220** com 3º = '1' e 4º = '0' ou '1';
    //  · 10 `VL_AJ_DEBITOS_ST`  — do **C197**, como o 07.
    //
    // 🚨 Até 29/08 o gerador punha os ajustes do E220 nos campos 07 e 10 — os
    // do DOCUMENTO —, deixando 06 e 09 zerados com os E220 logo abaixo. O
    // SALDO fechava; o campo é que mentia. É o E110 campo 11 (02/08) e o IPI
    // em E200/E210 (04/08) de novo.
    //
    // ⚠️ O PAREAMENTO É PELA SEQUÊNCIA: a apuração de ST é **POR UF** e o
    // arquivo tem um E200/E210 por estado. Somar todos os E220 contra o
    // primeiro E210 acusaria arquivo CERTO — é a lição do D100 × D190, no
    // mesmo dia.
    (() => {
        // ⚠️ O campo 06 é um PISO, não um total: o Guia soma ao E220 o
        // `VL_ICMS_ST` de C190 de entrada. Comparar por igualdade acusaria
        // arquivo correto em quem tem devolução de ST — a mesma decisão do
        // `VL_REC_BRT` (25/08).
        let atual = null;
        let somas = null;
        const fecha = () => {
            if (!atual || !somas) return;
            const e = campos(atual);
            const deb = num(e[9]);
            if (Math.abs(centavos(deb) - centavos(somas.debito)) > 1) {
                add(erros, {
                    regra: 'e210-x-e220', registro: 'E210', campo: '9 - VL_OUT_DEB_ST', linha: atual,
                    valor: deb.toFixed(2), esperado: somas.debito.toFixed(2),
                    mensagem: `O E210 declara "outros débitos ST" ${deb.toFixed(2)} e os E220 de débito/`
                        + `estorno de crédito somam ${somas.debito.toFixed(2)}.`,
                    acao: 'Defeito de GERAÇÃO — reporte com o print. Os campos 07 e 10 são do C197 (ajuste '
                        + 'do DOCUMENTO); os do E220 são o 06 e o 09. Cada UF aqui é uma GNRE.',
                    fonte: 'Guia Prático 3.2.3, E210 campo 09: "o valor informado deve corresponder ao '
                        + 'somatório do campo VL_AJ_APUR do registro E220, quando o terceiro caractere for '
                        + "igual a '1' e o quarto for igual a '0' ou '1'\".",
                });
            }
            const cred = num(e[6]);
            if (centavos(cred) < centavos(somas.credito) - 1) {
                add(erros, {
                    regra: 'e210-x-e220', registro: 'E210', campo: '6 - VL_OUT_CRED_ST', linha: atual,
                    valor: cred.toFixed(2), esperado: `≥ ${somas.credito.toFixed(2)}`,
                    mensagem: `O E210 declara "outros créditos ST" ${cred.toFixed(2)}, menos que os E220 de `
                        + `crédito/estorno de débito, que somam ${somas.credito.toFixed(2)}.`,
                    acao: 'Defeito de GERAÇÃO — reporte com o print. Este campo é um PISO: o Guia soma ao '
                        + 'E220 o ICMS-ST dos C190 de entrada, então ele pode ser MAIOR — nunca menor.',
                    fonte: 'Guia Prático 3.2.3, E210 campo 06: "o valor informado deve corresponder ao '
                        + 'somatório do campo VL_AJ_APUR dos registros E220 quando o terceiro caractere for '
                        + "igual a '1' e o quarto caractere do campo COD_AJ_APUR for igual a '2' ou '3' "
                        + 'mais a soma do campo VL_ICMS_ST do registro C190".',
                });
            }
        };
        for (const l of lista) {
            const reg = registroDe(l);
            if (reg === 'E210') {
                fecha();
                atual = l;
                somas = { debito: 0, credito: 0 };
            } else if (reg === 'E220' && atual) {
                const cod = String(campos(l)[2] || '').trim();
                if (cod.length < 4 || cod[2] !== '1') continue;
                const v = num(campos(l)[4]);
                if (['0', '1'].includes(cod[3])) somas.debito += v;
                else if (['2', '3'].includes(cod[3])) somas.credito += v;
            } else if (reg === 'E200' || reg === 'E500' || reg === 'E990') {
                fecha();
                atual = null;
            }
        }
        fecha();
    })();

    // ── R40. O COD_OBS do C195 e o 0460 se referenciam nos DOIS sentidos ────
    //
    // 📖 FONTE — Guia 3.2.3, C195 campo 02: *"o código informado deve constar
    // do registro 0460"*; e 0460 campo 02: *"o valor informado neste campo deve
    // existir em pelo menos um registro dos demais blocos"*.
    //
    // 🚨 É a família do item órfão do 0200 (PWR, 19/08), do participante órfão
    // do 0150 e do bem do G125 sem 0300 (achado horas antes) — **e esta corta
    // nos DOIS sentidos**: o cadastro sem referência também é recusado.
    (() => {
        const c195s = doReg('C195');
        const r0460 = doReg('0460');
        const cadastrados = new Set(r0460.map((l) => String(campos(l)[2] || '').trim()));
        const usados = new Set(c195s.map((l) => String(campos(l)[2] || '').trim()).filter(Boolean));
        const orfaos = [...usados].filter((c) => !cadastrados.has(c));
        if (orfaos.length) {
            add(erros, {
                regra: 'c195-obs-orfa', registro: 'C195', campo: '2 - COD_OBS', linha: c195s[0],
                valor: orfaos.join(', '), esperado: 'um 0460 por código',
                mensagem: `O C195 aponta a observação ${orfaos.join(', ')} e o arquivo não traz o 0460 dela.`,
                acao: 'Defeito de GERAÇÃO — reporte com o print. O 0460 é a Tabela de Observações; sem ele '
                    + 'o C195 referencia um cadastro que o arquivo não declara.',
                fonte: 'Guia Prático 3.2.3, C195 campo 02: "o código informado deve constar do registro 0460".',
            });
        }
        // ⚠️ E a volta: cadastro que ninguém referencia também é recusa.
        const semUso = [...cadastrados].filter((c) => c && !usados.has(c));
        if (semUso.length) {
            add(erros, {
                regra: 'c195-obs-orfa', registro: '0460', campo: '2 - COD_OBS', linha: r0460[0],
                valor: semUso.join(', '), esperado: 'ao menos um registro que o use',
                mensagem: `O 0460 declara a observação ${semUso.join(', ')} e nenhum registro do arquivo a `
                    + 'referencia.',
                acao: 'Defeito de GERAÇÃO — reporte com o print. Esta validação corta nos DOIS sentidos: '
                    + 'o cadastro sem uso é recusado igual ao uso sem cadastro.',
                fonte: 'Guia Prático 3.2.3, 0460 campo 02: "o valor informado neste campo deve existir em '
                    + 'pelo menos um registro dos demais blocos".',
            });
        }
    })();

    // ── R36. Bem do G125 tem de estar cadastrado no 0300 ────────────────────
    //
    // 📖 FONTE — Guia 3.2.3, G125 campo 02: *"o código informado neste campo
    // deve constar de um registro 0300"*; e o próprio 0300 abre dizendo que
    // existe *"para identificar e caracterizar TODOS os bens ou componentes
    // arrolados no registro G125 do Bloco G"*.
    //
    // 🚨 É a família do item ÓRFÃO do 0200 (PWR, 19/08) e do participante
    // órfão do 0150 — o registro referencia um cadastro que o arquivo não
    // declara. Até 29/08 o app emitia o G125 e **nenhum 0300**: TODO bem do
    // CIAP saía órfão.
    const g125s = doReg('G125');
    if (g125s.length) {
        const cadastrados = new Set(doReg('0300').map((l) => String(campos(l)[2] || '').trim()));
        const orfaos = [...new Set(g125s
            .map((l) => String(campos(l)[2] || '').trim())
            .filter((c) => c && !cadastrados.has(c)))];
        if (orfaos.length) {
            add(erros, {
                regra: 'g125-bem-orfao', registro: 'G125', campo: '2 - COD_IND_BEM',
                linha: g125s[0], valor: orfaos.slice(0, 5).join(', '), esperado: 'um 0300 por bem',
                mensagem: `${orfaos.length} bem(ns) do CIAP são referenciados no G125 e não têm registro 0300 `
                    + `(${orfaos.slice(0, 5).join(', ')}${orfaos.length > 5 ? '…' : ''}).`,
                acao: 'Defeito de GERAÇÃO — reporte com o print. O 0300 é o CADASTRO do bem; sem ele o G125 '
                    + 'aponta para quem o arquivo não declara, e o PVA recusa.',
                fonte: 'Guia Prático 3.2.3, G125 campo 02: "o código informado neste campo deve constar de '
                    + 'um registro 0300".',
            });
        }
    }

    // ── R35. Bloco K com dados exige o K010 ─────────────────────────────────
    //
    // 📖 FONTE — Guia 3.2.3, K010: *"registro obrigatório se o campo 02
    // (IND_MOV) do registro K001 estiver informado com '0 - Bloco com dados
    // informados'"*.
    //
    // 🚨 O K010 é quem declara o LEIAUTE escolhido (Ajuste SINIEF 02/09: 0
    // simplificado · 1 completo · 2 restrito aos saldos), e é ele que diz ao
    // PVA quais registros cobrar. Sem ele o bloco promete conteúdo e não diz de
    // que tipo — é a família da recusa *"o registro não deve ser informado para
    // esse perfil"* da AFFITTARE.
    //
    // ⚠️ E o gerador de hoje NÃO produz esta recusa: sem o leiaute cadastrado o
    // bloco sai `K001|1` (SEM DADOS) e GRITA. A regra nasce VERDE — ela existe
    // para o dia em que alguém montar o K001|0 por outro caminho.
    const k001 = doReg('K001')[0];
    if (k001 && soDigitos(campos(k001)[2]) === '0' && !doReg('K010').length) {
        add(erros, {
            regra: 'k010-ausente', registro: 'K001', campo: '2 - IND_MOV', linha: k001,
            valor: '0', esperado: 'um registro K010',
            mensagem: 'O bloco K promete conteúdo (IND_MOV = 0) e não traz o K010.',
            acao: 'O K010 declara o LEIAUTE do bloco (0 simplificado · 1 completo · 2 restrito aos saldos) '
                + '— é OPÇÃO do contribuinte, não se deduz. Escolha em Empresas → Dados Fiscais.',
            fonte: 'Guia Prático 3.2.3, K010: "registro obrigatório se o campo 02 (IND_MOV) do registro '
                + 'K001 estiver informado com \'0 - Bloco com dados informados\'".',
        });
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
