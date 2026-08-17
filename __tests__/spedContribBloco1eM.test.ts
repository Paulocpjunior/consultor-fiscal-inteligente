// ============================================================================
// 🚨 DOIS DEFEITOS NO MESMO ARQUIVO — e o segundo é pior que o recusado.
//
// Paulo, 17/08, com o recibo do PVA da CLINICA MEDICA MANTOAN 07/2026, depois
// que o bloco A passou a sair preenchido:
//
//   Linha 91 · registro 1010 · "O número de campos informado no registro difere
//   do número especificado no leiaute" — esperado 7, veio 9.
//   Campos recusados: IND_NAT_ACAO e DT_SENT_JUD, ambos recebendo 'N'.
//   Conteúdo: |1010|N|N|N|N|N|N|N|N|
//
// ═══ 1. O 1010 ERA DE OUTRO ARQUIVO ═════════════════════════════════════════
//
// 1010 existe nos DOIS SPEDs, com leiautes diferentes:
//
//   EFD ICMS/IPI       1010 = Obrigatoriedade de registros do Bloco 1
//                      (IND_EXP, IND_CCRF, IND_COMB… — a fileira de 'N')
//   EFD Contribuições  1010 = Processo Referenciado — AÇÃO JUDICIAL
//                      (NUM_PROC, ID_SEC_JUD, ID_VARA, IND_NAT_ACAO,
//                       DESC_DEC_JUD, DT_SENT_JUD) = 7 campos
//
// O gerador declarava um PROCESSO JUDICIAL com os campos preenchidos com 'N'.
// Mesma família do IPI que foi parar em E200/E210 (04/08), que são registros do
// ICMS-ST: número igual, arquivo diferente.
//
// ⚠️ E não se inventa o 1010 certo — ele só existe quando a empresa TEM ação
// judicial referenciada, e isso é dado que ninguém cadastrou. Bloco sem dados
// se declara SEM DADOS.
//
// ═══ 2. O QUE O PVA NÃO RECUSOU: M200/M600 ZERADOS ══════════════════════════
//
// O arquivo tinha 37 A100 com PIS e COFINS destacados e mesmo assim
// |M200|0,00|…| e |M600|0,00|…| — ou seja, declarava à Receita que **não havia
// contribuição a pagar**. Isso o PVA aceita: arquivo aceito não é arquivo certo.
//
// A causa é a ARMADILHA DAS DUAS FORMAS pela terceira vez no mesmo arquivo: a
// NFS-e do portal de SP não tem `itens` e grava o valor em `valorTotal`, e o
// bloco M lia `nota.valor || nota.totalNota`.
// ============================================================================
import { buildBloco1_Contrib, buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';

const campos = (linha: string) => linha.trim().split('|');

/** NFS-e como o portal de SP grava: ACHATADA e sem `itens`. */
const nfse = (numero: number, valor: number, direcao: 'saida' | 'entrada') => ({
    tipo: 'NFSe',
    direcao,
    numero: String(numero),
    dataEmissao: '2026-07-16',
    cnpjEmit: '13344638000191',
    cnpjDest: '01056860855',
    valorTotal: valor,
});

describe('🚨 o 1010 do EFD-Contribuições NÃO é o do EFD ICMS/IPI', () => {
    it('bloco 1 sem processo judicial sai SEM DADOS, e sem o 1010', () => {
        const linhas = buildBloco1_Contrib({}).map((l: string) => l.trim());
        expect(linhas).toEqual(['|1001|1|', '|1990|2|']);
    });

    it('a fileira de N do outro arquivo não existe mais em lugar nenhum do bloco', () => {
        const texto = buildBloco1_Contrib({}).join('');
        expect(texto).not.toMatch(/\|1010\|/);
        expect(texto).not.toMatch(/N\|N\|N\|/);
    });

    it('o IND_MOV vem do que foi PRODUZIDO — não de uma constante', () => {
        // Registro novo no bloco 1 tem que virar IND_MOV=0 sozinho. Se alguém
        // cravar '0' de volta, o arquivo volta a prometer conteúdo que não tem
        // (é o que a auditoria de saída acusa como bloco-vazio-declarado-cheio).
        const fonte = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'sefaz-backend/sped-contrib-blocos.js'), 'utf8');
        expect(fonte).toMatch(/'1001',\s*conteudo\.length \? '0' : '1'/);
        expect(fonte).toMatch(/'1990',\s*String\(conteudo\.length \+ 2\)/);
    });
});

describe('🚨 M200/M600 saíam ZERADOS com 37 documentos no arquivo', () => {
    // Os números são os do arquivo REAL da MANTOAN 07/2026: 33 notas de
    // prestação somando 43.890,00 (as 4 de aquisição não entram na base).
    const notas = [
        1450, 1650, 1650, 600, 4500, 2800, 1450, 1450, 1450, 800, 2500, 800,
        1450, 600, 800, 1450, 1650, 2500, 1650, 1450, 1650, 800, 1500, 500,
        1450, 800, 800, 500, 800, 800, 800, 420, 420,
    ].map((v, i) => nfse(7800 + i, v, 'saida'));
    const aquisicoes = [109.89, 42.88, 180, 0].map((v, i) => nfse(57000 + i, v, 'entrada'));

    it('a base é a soma das PRESTAÇÕES, e bate com o arquivo do Paulo', () => {
        const linhas: string[] = buildBlocoM({
            notas: [...notas, ...aquisicoes], regimeApuracao: '2', warnings: [],
        });
        const m200 = campos(linhas.find((l) => l.startsWith('|M200|'))!);
        const m600 = campos(linhas.find((l) => l.startsWith('|M600|'))!);
        // A linha começa com '|', então o REG é [1] e o primeiro valor é [2].
        expect(m200[2]).toBe('43890,00');     // base
        expect(m200[5]).toBe('285,28');       // contribuição PIS (0,65%)
        expect(m600[2]).toBe('43890,00');
        expect(m600[5]).toBe('1316,70');      // contribuição COFINS (3%)
    });

    it('e o valor a recolher deixa de ser 0,00 — era isso que ia à Receita', () => {
        const linhas: string[] = buildBlocoM({ notas, regimeApuracao: '2', warnings: [] });
        const m200 = campos(linhas.find((l) => l.startsWith('|M200|'))!);
        expect(m200[13]).not.toBe('0,00');
        expect(m200[13]).toBe('285,28');
    });

    it('🚨 documento SEM valor em forma nenhuma sai da base e é DITO — não vira zero', () => {
        const warnings: string[] = [];
        const linhas: string[] = buildBlocoM({
            notas: [nfse(1, 1000, 'saida'), { tipo: 'NFSe', direcao: 'saida', numero: '999' }],
            regimeApuracao: '2', warnings,
        });
        const m200 = campos(linhas.find((l) => l.startsWith('|M200|'))!);
        expect(m200[2]).toBe('1000,00');
        expect(warnings.join('\n')).toMatch(/nº 999/);
        expect(warnings.join('\n')).toMatch(/M200\/M600 está a MENOR/);
    });

    it('regime CUMULATIVO não desconta crédito de entrada — não existe', () => {
        const linhas: string[] = buildBlocoM({
            notas: [nfse(1, 1000, 'saida'), nfse(2, 900, 'entrada')],
            regimeApuracao: '2', warnings: [],
        });
        expect(linhas.some((l) => l.startsWith('|M100|'))).toBe(false);
        const m200 = campos(linhas.find((l) => l.startsWith('|M200|'))!);
        expect(m200[13]).toBe('6,50');   // 0,65% de 1000, sem abatimento
    });
});
