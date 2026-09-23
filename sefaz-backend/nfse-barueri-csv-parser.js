// ============================================================================
// sefaz-backend/nfse-barueri-csv-parser.js  (PURO)
// ----------------------------------------------------------------------------
// O CSV de NFS-e EMITIDAS do portal da Prefeitura de **BARUERI**.
//
// 🚨 O CASO (10/09, Paulo, JG SOLUCOES EM TECNOLOGIA · Barueri): *"não consigo
// importar as notas direto do portal de Barueri, porque lá só tem opção TXT ou
// CSV, e o modelo de importação CSV que tem no consultor são para as NFS SP"*.
// Ele foi na porta certa e ela recusou — então as notas de lá só entravam pelo
// **Portal Nacional (ADN)**, que entrega a nota como ela estava quando foi
// transcrita: as canceladas DEPOIS disso subiam como ATIVAS e inflavam o
// faturamento (a NFS-e 76 de R$ 15.004,06 é o caso que abriu a conversa).
//
// ✅ E ESTE ARQUIVO RESOLVE O CANCELAMENTO NA FONTE: o CSV traz a coluna
// **`Nf Ativa`** ("Sim" / "Cancelada"). A nota entra já cancelada, sem ninguém
// precisar declarar nada à mão. A declaração (`cancelamentoDeclarado`, 10/09)
// continua sendo a porta para o que chega pelo ADN e não tem trilho municipal.
//
// ═══════════════════════════════════════════════════════════════════════════
// 📐 O QUE FOI MEDIDO NA AMOSTRA (07/2026, 24 notas, nºs 39 a 62)
//
//   · **ISO-8859-1 (Latin-1)**, não UTF-8 — lido como UTF-8, `SÃO PAULO` vira
//     `S?O PAULO` e a razão social do tomador chega corrompida no COD_PART do
//     0150 do SPED. Encoding não é detalhe de exibição: é o dado.
//   · separador `;`, todos os valores entre aspas, **34 colunas NOMEADAS**.
//   · valores em `426212,0400` (vírgula decimal, 4 casas, sem milhar).
//   · datas `dd/mm/aaaa`; alíquota `2,00`.
//   · **sem linha de total/trailer** (o TXT tem; o CSV não).
//   · a chave de acesso do padrão NACIONAL (50 dígitos) vem na última coluna —
//     e é ela que dá o **PRESTADOR**, que NÃO tem coluna própria neste arquivo.
//
// 🔑 A CHAVE É O QUE FAZ ESTE IMPORTADOR NÃO DUPLICAR NADA: o id do documento
// sai dela (dono: `nfse-identidade.js`), que é o MESMO id que a captura do ADN
// grava. Importar o CSV do município **cai por cima** da nota que veio pelo
// Portal Nacional em vez de criar uma segunda.
//
// 🚩 O TXT DO PORTAL **NÃO** É LIDO AQUI, e vai dito: ele é de largura fixa e a
// amostra tem DUAS notas, com campos cujo significado não está provado (um
// campo de 10 dígitos depois da data de cancelamento; o segundo total do
// trailer). Leiaute posicional deduzido é a família do `1405` e do `PARTSEM` —
// e o CSV cobre tudo que decide livro. Quem manda o TXT recebe a frase que
// aponta o CSV, nunca um "não sei ler".
// ============================================================================

import { dataDeclaradaDoDocumento } from './xml-metadata-helper.js';
import { lerChaveNfseNacional } from './chave-nfse-nacional.js';

/** Nome de coluna comparável: sem acento, sem pontuação, minúsculo. */
function chaveDaColuna(nome) {
    return String(nome ?? '')
        .replace(/^﻿/, '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// As colunas que este parser usa, pelo NOME que o portal escreve. Casar por
// POSIÇÃO seria o leiaute deduzido de novo: o portal acrescenta coluna (a
// reforma tributária já fez isso no CSV de SP) e tudo escorrega uma casa.
const COLUNAS = {
    identificador: 'identificador nf',
    dataEmissao: 'data nf',
    dataBase: 'data base nf',
    dataRps: 'data rps',
    serieRps: 'serie rps',
    numero: 'numero nf',
    numeroRps: 'numero rps',
    tomadorDoc: 'cnpj',
    tomadorNome: 'tomador',
    tomadorLogradouro: 'tomador endereco',
    tomadorNumero: 'tomador nro endereco',
    tomadorComplemento: 'tomador comp endereco',
    tomadorBairro: 'tomador bairro',
    tomadorCidade: 'tomador cidade',
    tomadorUf: 'tomador uf',
    tomadorPais: 'tomador pais',
    tomadorCep: 'tomador cep',
    codigoServico: 'codigo servico',
    aliquota: 'aliquota',
    issRetido: 'issqn retido',
    discriminacao: 'discriminacao servico',
    valorServico: 'valor servico',
    issPrevisto: 'valor previsto issqn',
    irrf: 'irrf',
    pis: 'pis',
    cofins: 'cofins',
    csll: 'cssl',
    totalNota: 'total nf',
    valorFatura: 'valor fatura',
    valorNaoIncluso: 'valor nao incluso na b c',
    ativa: 'nf ativa',
    substituidaPor: 'nf substituida por',
    autenticidade: 'codigo de autenticidade',
    chave: 'chave de acesso da nfs e',
};

// Sem estas o arquivo não é este documento — e o que falta sai NOMEADO.
const OBRIGATORIAS = ['numero', 'dataEmissao', 'valorServico', 'ativa', 'chave'];

function decodificar(input) {
    // ⚠️ Latin-1 SEMPRE: o portal de Barueri exporta em ISO-8859-1 (medido).
    return Buffer.isBuffer(input) ? input.toString('latin1') : String(input ?? '');
}

function partirLinha(linha) {
    const celulas = [];
    let atual = '';
    let entreAspas = false;
    for (let i = 0; i < linha.length; i++) {
        const ch = linha[i];
        if (ch === '"') {
            if (entreAspas && linha[i + 1] === '"') { atual += '"'; i++; } else { entreAspas = !entreAspas; }
        } else if (ch === ';' && !entreAspas) {
            celulas.push(atual); atual = '';
        } else {
            atual += ch;
        }
    }
    celulas.push(atual);
    return celulas;
}

/**
 * Valor em pt-BR → número. **Vazio devolve `null`, nunca 0.**
 *
 * Campo de valor não recebe default (regra de 06/08): zero é a AFIRMAÇÃO de
 * que não houve, e aqui ele existe de verdade (`0,0000` nas notas sem
 * retenção). Confundir os dois faria "não li o campo" passar por "não houve
 * retenção" — e do outro lado da fronteira isso parece conferido.
 */
export function valorPtBr(bruto) {
    const t = String(bruto ?? '').trim();
    if (!t) return null;
    const n = Number(t.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

/** `dd/mm/aaaa` → `aaaa-mm-dd` pelo DONO das datas de documento. */
function dataIso(bruto) {
    return dataDeclaradaDoDocumento(String(bruto ?? '').trim()) || null;
}

/**
 * O status da nota a partir da coluna `Nf Ativa`.
 *
 * ⚠️ CONSERVADORA DE PROPÓSITO, e os dois erros custam diferente: deixar
 * cancelada passar infla o faturamento (dá para achar); marcar nota VÁLIDA
 * como cancelada **apaga receita de livro fiscal**, que é pior. Só o rótulo
 * que DIZ cancelamento cancela; rótulo desconhecido não afirma nada.
 */
export function situacaoDaColunaAtiva(bruto) {
    const t = chaveDaColuna(bruto);
    if (!t) return { situacao: null, cancelada: false, rotulo: '' };
    if (t.startsWith('cancel')) return { situacao: 'cancelada', cancelada: true, rotulo: String(bruto).trim() };
    if (t === 'sim' || t === 's' || t === 'ativa' || t === 'ativo') {
        return { situacao: 'ativa', cancelada: false, rotulo: String(bruto).trim() };
    }
    return { situacao: null, cancelada: false, rotulo: String(bruto).trim() };
}

/**
 * ESTE ARQUIVO É O CSV DE BARUERI?
 *
 * Quem responde é o CABEÇALHO, nunca o nome do arquivo — o portal nomeia por
 * inscrição municipal (`4BY3957125JUL2026.csv`) e quem baixa renomeia. Duas
 * colunas bastam para não confundir com o CSV do portal de SP, que é
 * posicional (linha de nota começando com "2") e não tem cabeçalho nomeado.
 */
export function ehCsvNfseBarueri(input) {
    const primeira = decodificar(input).split(/\r?\n/)[0] || '';
    if (!primeira.includes(';')) return false;
    const cols = new Set(partirLinha(primeira).map(chaveDaColuna));
    return cols.has(COLUNAS.chave) && cols.has(COLUNAS.ativa) && cols.has(COLUNAS.numero);
}

/**
 * O TXT de lote do portal de Barueri (largura fixa) — reconhecido para a
 * recusa DIZER o que fazer, nunca lido.
 *
 * O cabeçalho medido é `1` + inscrição(7) + AAAAMMDD + AAAAMMDD + **`PMB`** +
 * versão(3) + zeros. `PMB` = Prefeitura Municipal de Barueri.
 */
export function ehTxtLoteBarueri(input) {
    const primeira = decodificar(input).split(/\r?\n/)[0] || '';
    return /^1[0-9A-Z]{7}\d{16}PMB/.test(primeira.trim());
}

/**
 * Lê o CSV inteiro. Aceita Buffer (do multer) ou string.
 *
 * Nada de "melhor esforço": coluna obrigatória que falta derruba a leitura com
 * o nome dela, e nota sem número ou sem chave sai NOMEADA em `recusadas` — em
 * vez de entrar torta e calada, que é como se perde nota no livro.
 */
export function parseCsvNfseBarueri(input) {
    const texto = decodificar(input);
    const linhas = texto.split(/\r?\n/);
    const cabecalho = partirLinha(linhas[0] || '').map(chaveDaColuna);

    const idx = {};
    for (const [campo, nome] of Object.entries(COLUNAS)) idx[campo] = cabecalho.indexOf(nome);

    const faltando = OBRIGATORIAS.filter((c) => idx[c] < 0).map((c) => COLUNAS[c]);
    if (faltando.length) {
        throw new Error(
            `Este CSV não tem a(s) coluna(s) ${faltando.join(', ')}, que a importação de Barueri precisa. `
            + `O arquivo tem ${cabecalho.filter(Boolean).length} coluna(s). O que fazer agora: no portal, `
            + 'exporte a consulta de NFS-e em CSV (o mesmo arquivo que você já baixa) e mande ao Paulo se '
            + 'o portal mudou as colunas — o leiaute se calibra com a amostra, nunca de memória.',
        );
    }

    const celula = (cells, campo) => (idx[campo] >= 0 ? String(cells[idx[campo]] ?? '').trim() : '');

    const notas = [];
    const recusadas = [];
    let linhasComConteudo = 0;

    for (let i = 1; i < linhas.length; i++) {
        const linha = linhas[i];
        if (!linha || !linha.trim()) continue;
        linhasComConteudo++;
        const cells = partirLinha(linha);

        const numero = celula(cells, 'numero');
        const chaveBruta = celula(cells, 'chave');
        const chave = chaveBruta.replace(/\D/g, '');
        const daChave = lerChaveNfseNacional(chave);

        if (!numero && !daChave) {
            recusadas.push({ linha: i + 1, motivo: 'sem número e sem chave de acesso legível — não há identidade possível' });
            continue;
        }

        const ativa = situacaoDaColunaAtiva(celula(cells, 'ativa'));
        const numeroFinal = numero || (daChave ? daChave.numero : '');

        notas.push({
            identificador: celula(cells, 'identificador'),
            numero: numeroFinal,
            // 🚨 A COMPETÊNCIA É A `Data Base NF`, NÃO a `Data NF`. Medido na
            // amostra: a nota 40 é `Data NF 03/07/2026` com **`Data Base NF`
            // 30/06/2026** — ela pertence a JUNHO. Quem recorta o mês é o
            // FATO, nunca o papel (a régua de 03/09).
            dataEmissao: dataIso(celula(cells, 'dataEmissao')),
            dataFatoGerador: dataIso(celula(cells, 'dataBase')),
            dataRps: dataIso(celula(cells, 'dataRps')),
            serieRps: celula(cells, 'serieRps'),
            numeroRps: celula(cells, 'numeroRps'),

            // O PRESTADOR não tem coluna neste arquivo — quem responde é a
            // CHAVE, que carrega a inscrição de quem emitiu.
            chaveAcesso: chave,
            prestadorCnpj: daChave ? daChave.inscricaoEmitente : '',
            codMunIBGE: daChave ? daChave.cMun : '',
            numeroDaChave: daChave ? daChave.numero : '',

            tomadorDoc: celula(cells, 'tomadorDoc').replace(/\D/g, ''),
            tomadorNome: celula(cells, 'tomadorNome'),
            tomadorEndereco: {
                logradouro: celula(cells, 'tomadorLogradouro'),
                numero: celula(cells, 'tomadorNumero'),
                complemento: celula(cells, 'tomadorComplemento'),
                bairro: celula(cells, 'tomadorBairro'),
                cidade: celula(cells, 'tomadorCidade'),
                uf: celula(cells, 'tomadorUf'),
                pais: celula(cells, 'tomadorPais'),
                cep: celula(cells, 'tomadorCep').replace(/\D/g, ''),
            },

            codigoServico: celula(cells, 'codigoServico'),
            aliquota: valorPtBr(celula(cells, 'aliquota')),
            issRetidoBruto: celula(cells, 'issRetido'),
            discriminacao: celula(cells, 'discriminacao'),

            valorServicos: valorPtBr(celula(cells, 'valorServico')),
            issDevido: valorPtBr(celula(cells, 'issPrevisto')),
            totalNota: valorPtBr(celula(cells, 'totalNota')),
            valorFatura: valorPtBr(celula(cells, 'valorFatura')),
            valorNaoIncluso: valorPtBr(celula(cells, 'valorNaoIncluso')),

            // Retenções federais: o portal já entrega DECOMPOSTO (medido na
            // amostra — 1,5% · 0,65% · 3% · 1% sobre a base). Não se soma nem
            // se rateia nada aqui; quem confere a assinatura de alíquota é
            // `conferirRetencaoFederal`, que já é o dono dessa pergunta.
            irRetido: valorPtBr(celula(cells, 'irrf')),
            pisRetido: valorPtBr(celula(cells, 'pis')),
            cofinsRetida: valorPtBr(celula(cells, 'cofins')),
            csllRetida: valorPtBr(celula(cells, 'csll')),

            situacao: ativa.situacao,
            cancelada: ativa.cancelada,
            situacaoBruta: ativa.rotulo,
            substituidaPor: celula(cells, 'substituidaPor'),
            codigoAutenticidade: celula(cells, 'autenticidade'),
        });
    }

    const avisos = [];
    const semSituacao = notas.filter((n) => n.situacao === null);
    if (semSituacao.length) {
        avisos.push(
            `${semSituacao.length} nota(s) vieram com a coluna "Nf Ativa" em um valor que o CFI não conhece `
            + `(${[...new Set(semSituacao.map((n) => n.situacaoBruta || '(vazio)'))].join(', ')}) — nota(s) `
            + `${semSituacao.slice(0, 10).map((n) => n.numero).join(', ')}. Elas entram SEM o CFI afirmar se `
            + 'estão canceladas: marcar nota válida como cancelada apaga receita do livro. Mande o arquivo ao '
            + 'Paulo para o rótulo novo entrar na régua.',
        );
    }
    const semChave = notas.filter((n) => !n.prestadorCnpj);
    if (semChave.length) {
        avisos.push(
            `${semChave.length} nota(s) sem chave de acesso legível — nota(s) `
            + `${semChave.slice(0, 10).map((n) => n.numero).join(', ')}. Sem a chave o CFI não sabe quem é o `
            + 'PRESTADOR por este arquivo (o CSV não tem coluna dele) e a nota não cai por cima da que veio '
            + 'pelo Portal Nacional — ela pode entrar duplicada. Confira essas notas na lista depois de importar.',
        );
    }
    const divergentes = notas.filter((n) => n.numeroDaChave && n.numero && n.numeroDaChave !== n.numero);
    if (divergentes.length) {
        avisos.push(
            `${divergentes.length} nota(s) com o número da coluna diferente do número dentro da CHAVE `
            + `(${divergentes.slice(0, 5).map((n) => `${n.numero}≠${n.numeroDaChave}`).join(', ')}). A chave não `
            + 'mente — confira antes de fechar a competência.',
        );
    }

    const comValor = notas.filter((n) => Number.isFinite(n.valorServicos));
    const soma = comValor.reduce((acc, n) => acc + n.valorServicos, 0);
    const datas = notas.map((n) => n.dataEmissao).filter(Boolean).sort();

    return {
        layout: 'barueri-csv',
        colunasLidas: cabecalho.filter(Boolean).length,
        linhasComConteudo,
        totalNotas: notas.length,
        canceladas: notas.filter((n) => n.cancelada).length,
        valorSomaCalculada: +soma.toFixed(2),
        // ⚠️ Sem valor legível NÃO entra na soma, e o fato vai contado — soma
        // que engole nota ilegível parece conferida e não é.
        semValor: notas.length - comValor.length,
        periodo: { inicio: datas[0] || null, fim: datas[datas.length - 1] || null },
        notas,
        recusadas,
        avisos,
    };
}
