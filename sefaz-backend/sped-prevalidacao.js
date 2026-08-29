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
