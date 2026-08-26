// ============================================================================
// 🚨 SÓ UMA DAS SEIS SOMAS C100 × C190 ESTAVA CONFERIDA
//
// O Guia Prático 3.2.3 repete a MESMA validação em seis campos do C100 —
// *"a soma dos valores do campo <X> dos registros analíticos (C190) deve ser
// igual ao valor informado neste campo"* —, e a prevalidação só perguntava
// pelo VL_DOC × VL_OPR (R14, que nasceu do caso PWR de 20/08).
//
// 🚨 A CONDIÇÃO QUE PRODUZ O DEFEITO CONTINUA NO GERADOR: o **C100 lê os
// TOTAIS DO DOCUMENTO** (`totais.vBC`, `totais.vICMS`, …) e o **C190 agrega os
// ITENS** — duas fontes diferentes, montadas em passos diferentes. É a mesma
// dupla que produziu o VL_OPR sem o IPI e custou um dia inteiro da PWR.
//
// E o comentário do próprio gerador já AFIRMAVA `// VL_BC_ICMS — bate com
// ΣC190` sem que nada conferisse: regra escrita não é regra travada.
//
// ⚠️ O campo 22 é o que alimenta a APURAÇÃO — é a soma dos VL_ICMS dos C190
// que vira débito e crédito no E110 (a R7 confere justamente isso). Um C100
// que discorda dos próprios filhos põe o livro e a apuração em números
// diferentes para a MESMA nota.
// ============================================================================
// A prevalidação tem `.d.ts` — o tsc confere o que se importa dela.
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';
// ⚠️ Já o gerador do bloco C não tem tipos, e AQUI o silenciador é legítimo:
// a trava do `.d.ts` barra só o que cala um aviso que nem existiria.
// @ts-ignore — módulo JS do backend, sem `.d.ts`
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';

const soATotais = (linhas: string[]) =>
    (prevalidarSpedFiscal(linhas).erros as any[]).filter(e => e.regra === 'c100-x-c190-totais');

const nota = (over: Record<string, unknown> = {}) => ({
    chaveAcesso: '35260726767102000120550010000000071000000078',
    numero: '7', serie: '1', modelo: '55', direcao: 'saida', status: 'autorizado',
    dataEmissao: '2026-07-24', cnpjEmit: '31947349000169',
    cnpjDest: '26767102000120', xNomeDest: 'CLIENTE', ...over,
});

/** Roda o gerador REAL — fixture escrita à mão não prova o que ele produz. */
const gerar = (n: Record<string, unknown>): string[] => {
    const dados: any = {
        empresa: { cnpj: '31947349000169', dadosFiscais: { uf: 'SP' } },
        competencia: '2026-07', competenciaInicio: '2026-07', competenciaFim: '2026-07',
        notas: [n], warnings: [],
    };
    return (buildBlocoC(dados) as string[]).map(l => l.trim());
};

describe('🚨 as cinco somas que faltavam nascem VERDES sobre o gerador real', () => {
    // A NF 7 da PWR — a nota que expôs o VL_OPR em 20/08, com o desconto no
    // total do documento e o ICMS destacado.
    it('a NF 7 real da PWR passa limpa', () => {
        expect(soATotais(gerar(nota({
            valorTotal: 18179, totais: { vProd: 18741.24, vDesc: 562.24, vNF: 18179, vBC: 18179, vICMS: 3272.22 },
            itens: [{
                nItem: 1, cProd: '7803', xProd: 'MERCADORIA', NCM: '73269090', CFOP: '5101',
                uCom: 'UN', qCom: 1, vProd: 18741.24, vDesc: 562.24,
                CST: '000', vBC: 18179, pICMS: 18, vICMS: 3272.22,
            }],
        })))).toEqual([]);
    });

    // Dois grupos de CST/CFOP, com ST num deles e IPI no outro: é aqui que o
    // C190 arredonda POR GRUPO e o C100 traz o total do documento.
    it('nota com dois grupos, ST e IPI passa limpa', () => {
        expect(soATotais(gerar(nota({
            valorTotal: 1000,
            totais: { vProd: 1000, vNF: 1000, vBC: 1000, vICMS: 180, vIPI: 50, vBCST: 200, vST: 36 },
            itens: [
                { nItem: 1, cProd: 'A', xProd: 'A', CFOP: '5101', uCom: 'UN', qCom: 1, vProd: 600, CST: '000', vBC: 600, pICMS: 18, vICMS: 108, vIPI: 50 },
                { nItem: 2, cProd: 'B', xProd: 'B', CFOP: '5405', uCom: 'UN', qCom: 1, vProd: 400, CST: '060', vBC: 400, pICMS: 18, vICMS: 72, vBCST: 200, vICMSST: 36 },
            ],
        })))).toEqual([]);
    });

    // ⚠️ Cancelada sai com os campos VAZIOS (Exceção 1 do Guia) e SEM C190 —
    // comparar ali acusaria uma nota correta.
    it('nota CANCELADA não é acusada', () => {
        expect(soATotais(gerar(nota({
            status: 'cancelado', valorTotal: 1000,
            totais: { vProd: 1000, vNF: 1000, vBC: 1000, vICMS: 180 },
            itens: [{ nItem: 1, cProd: 'A', xProd: 'A', CFOP: '5101', uCom: 'UN', qCom: 1, vProd: 1000, CST: '000', vBC: 1000, pICMS: 18, vICMS: 180 }],
        })))).toEqual([]);
    });

    // ⚠️ Na NFC-e os campos de ST, IPI, PIS e COFINS são PROIBIDOS no C100 —
    // eles saem vazios, e os C190 dela também não os têm.
    it('NFC-e não é acusada pelos campos que ela não pode informar', () => {
        expect(soATotais(gerar(nota({
            modelo: '65', chaveAcesso: '35260726767102000120650010000000071000000078',
            valorTotal: 50, totais: { vProd: 50, vNF: 50, vBC: 50, vICMS: 9 },
            itens: [{ nItem: 1, cProd: 'A', xProd: 'A', CFOP: '5102', uCom: 'UN', qCom: 1, vProd: 50, CST: '000', vBC: 50, pICMS: 18, vICMS: 9 }],
        })))).toEqual([]);
    });
});

describe('🚨 e acusa o item que ficou de fora do C190', () => {
    const C100 = '|C100|1|0||55|00|001|7||||1000,00|0|0,00||1000,00|9|0,00|0,00|0,00'
        + '|1000,00|180,00|0,00|0,00|50,00|0,00|0,00|||';

    it('base e ICMS do C100 maiores que a soma dos filhos', () => {
        const r = soATotais([C100, '|C190|000|5101|18,00|600,00|600,00|108,00|0,00|0,00|0,00|50,00||']);
        expect(r.map(e => e.campo)).toEqual(['21 - VL_BC_ICMS', '22 - VL_ICMS']);
        expect(r[0].mensagem).toMatch(/somam 600\.00/);
        expect(r[1].acao).toMatch(/vira débito\/crédito no E110/);
    });

    it('o IPI do C100 que os C190 não confirmam', () => {
        const r = soATotais([C100, '|C190|000|5101|18,00|1000,00|1000,00|180,00|0,00|0,00|0,00|0,00||']);
        expect(r.map(e => e.campo)).toEqual(['25 - VL_IPI']);
        expect(r[0].acao).toMatch(/alimenta o E520/);
    });

    it('o ICMS-ST idem', () => {
        const r = soATotais([
            '|C100|1|0||55|00|001|7||||1000,00|0|0,00||1000,00|9|0,00|0,00|0,00'
            + '|1000,00|180,00|200,00|36,00|0,00|0,00|0,00|||',
            '|C190|000|5101|18,00|1000,00|1000,00|180,00|0,00|0,00|0,00|0,00||',
        ]);
        expect(r.map(e => e.campo)).toEqual(['23 - VL_BC_ICMS_ST', '24 - VL_ICMS_ST']);
    });

    // ⚠️ Um centavo é arredondamento por grupo de CST+CFOP+alíquota, não erro.
    it('um centavo não vira alarme', () => {
        expect(soATotais([C100, '|C190|000|5101|18,00|1000,00|1000,01|180,01|0,00|0,00|0,00|50,00||']))
            .toEqual([]);
    });

    // Nota sem nenhum C190 é a R6, que já diz a causa certa (resumo/sem itens).
    // Dois alarmes para UM defeito é o caminho para a equipe ignorar os dois.
    it('nota sem C190 nenhum não é acusada por esta regra', () => {
        expect(soATotais([C100])).toEqual([]);
    });
});
