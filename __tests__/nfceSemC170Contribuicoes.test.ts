// ============================================================================
// 🚨 A NFC-e NÃO LEVA C170 NO EFD-CONTRIBUIÇÕES
//
// Paulo, 24/08: *"1385 - HYPE CAFE - EFD CONTRIBUIÇÕES, deu esses erros de
// estrutura, são os NFC-E"*.
//
// O Relatório de Erros de Importação do PVA traz **572 erros**, que são 286
// C170 com DUAS mensagens cada:
//
//   "O registro não deve ser informado para o modelo de documento do
//    'Registro Pai'."
//   "O registro não deve ser informado para esse perfil e/ou tipo de operação.
//    Consulte o guia prático da EFD-Contribuições e verifique a
//    obrigatoriedade dos registros na Seção 4 - Obrigatoriedade dos Registros."
//
// O arquivo tem 182 C100 — **179 modelo 65 e 3 modelo 55** — e 291 C170. Os
// 286 recusados são exatamente os filhos das NFC-e; os 5 das notas 55 passaram.
//
// ⚠️ E ISSO NÃO TIRA UM CENTAVO DA APURAÇÃO: os 179 C100 de NFC-e somam
// VL_DOC 19.722,70, que é exatamente o `VL_REC_BRT` do M210 do mesmo arquivo.
// A receita é declarada no C100 e no bloco M, nunca no C170.
// ============================================================================
import {
    ehNfce, levaC170NoContribuicoes, COD_MOD_NFCE,
} from '../sefaz-backend/sped-selecao-documentos.js';
import {
    conferirC170DeNfce, conferirCadastrosOrfaosContrib, avisosDaPrevalidacaoContrib,
// @ts-ignore — módulo JS do backend, sem tipos
} from '../sefaz-backend/sped-contrib-campos.js';
// @ts-ignore
import { buildBlocoC_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';

const semQuebra = (l: string) => String(l).replace(/\r?\n$/, '');

/** Linhas REAIS do arquivo que o PVA recusou (HYPE CAFE 66641236000115 · 07/2026). */
const C100_NFCE = '|C100|1|0|10882812000161|65|00|005|1|35260766641236000115650050000000019836680099'
    + '|06072026|06072026|279,60|0|0,00||279,60|9|0,00|0,00|0,00|279,60|11,20|0,00|0,00|0,00|1,80|8,40|||';
const C170_DA_NFCE = '|C170|1|10|Bufe Avulso|1,00000|UN|69,90|0,00|0|090|5101||69,90|4,00|2,80|0,00|0,00'
    + '|0,00|0|||0,00|0,00|0,00|01|67,10|0,6500|||0,44|01|67,10|3,0000|||2,01||';
const C100_NFE = '|C100|0|1|37626446000136|55|00|002|1572866|35260737626446000136550020015728661082963404'
    + '|29072026|29072026|95,00|0|0,00||95,00|9|0,00|0,00|0,00|95,00|17,10|0,00|0,00|0,00|1,29|5,92|||';
const C170_DA_NFE = '|C170|1|UD-10-640|Frasco pote de Vidro 640ml com tampa|1,00000|KIT|95,00|0,00|0|000'
    + '|1102||95,00|18,00|17,10|0,00|0,00|0,00|0|||0,00|0,00|0,00|70|0,00|0,0000|||0,00|70|0,00|0,0000|||0,00||';

describe('🚨 o dono responde quem leva C170', () => {
    it('a NFC-e é reconhecida pela CHAVE, não pelo campo cru', () => {
        // O importer principal não grava `modelo`; o modelo mora nas posições
        // 21-22 da chave. Ler o campo cru foi o que tirou 100 das 131 notas da
        // PS VIDROS do arquivo (19/08).
        const soChave = { chave: '35260766641236000115650050000000019836680099' };
        expect(ehNfce(soChave)).toBe(true);
        expect(levaC170NoContribuicoes(soChave)).toBe(false);
        expect(COD_MOD_NFCE).toBe('65');
    });

    it('a NF-e modelo 55 continua levando C170 — a Exceção 2 do ICMS/IPI não vale aqui', () => {
        const nfe = { chave: '35260737626446000136550020015728661082963404' };
        expect(ehNfce(nfe)).toBe(false);
        expect(levaC170NoContribuicoes(nfe)).toBe(true);
    });
});

describe('🚨 o gerador para de pendurar C170 em cupom', () => {
    const nota = (chave: string, cod: string) => ({
        chave, direcao: 'saida', status: 'autorizado',
        numero: '1', serie: '5', dhEmi: '2026-07-06T12:00:00-03:00',
        cnpjEmit: '66641236000115', xNomeEmit: 'HYPE CAFE',
        cnpjDest: '10882812000161', xNomeDest: 'CLIENTE',
        totais: { vNF: 279.6 },
        itens: [{
            nItem: 1, cProd: cod, xProd: 'Bufe Avulso', qCom: 1, uCom: 'UN',
            vProd: 69.9, cfop: '5101', NCM: '21069090',
        }],
    });
    const dados = (notas: unknown[]) => ({
        empresa: { cnpj: '66641236000115', nome: 'HYPE CAFE', uf: 'SP' },
        competencia: '2026-07', competenciaFim: '2026-07',
        regimeApuracao: '2', notas, warnings: [] as string[],
    });

    it('C100 da NFC-e SAI, C170 dela NÃO', () => {
        const l = buildBlocoC_Contrib(dados([
            nota('35260766641236000115650050000000019836680099', '10'),
        ])).map(semQuebra);
        expect(l.filter((x: string) => x.startsWith('|C100|'))).toHaveLength(1);
        expect(l.filter((x: string) => x.startsWith('|C170|'))).toHaveLength(0);
    });

    it('e a nota 55 do MESMO arquivo continua com o dela', () => {
        const l = buildBlocoC_Contrib(dados([
            nota('35260766641236000115650050000000019836680099', '10'),
            nota('35260737626446000136550020015728661082963404', 'UD-10-640'),
        ])).map(semQuebra);
        expect(l.filter((x: string) => x.startsWith('|C100|'))).toHaveLength(2);
        const c170 = l.filter((x: string) => x.startsWith('|C170|'));
        expect(c170).toHaveLength(1);
        expect(c170[0]).toContain('|UD-10-640|');
    });
});

describe('🚨 a recusa virou regra da prevalidação — no MESMO PR', () => {
    it('acusa o C170 da NFC-e com a recusa LITERAL do PVA', () => {
        const r = conferirC170DeNfce([C100_NFCE, C170_DA_NFCE]);
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0].registro).toBe('C170');
        expect(r.erros[0].fonte).toContain('Registro Pai');
        expect(r.erros[0].fonte).toContain('HYPE CAFE');
        expect(r.erros[0].mensagem).toContain('NFC-e');
    });

    // ⚠️ Quem decide é o PAI. Um C170 sozinho não tem como ser julgado, e
    // acusá-lo por conta própria produziria alarme em arquivo certo — que é o
    // jeito conhecido de ensinar a equipe a desligar a prevalidação.
    it('fica MUDA no C170 de nota 55', () => {
        expect(conferirC170DeNfce([C100_NFE, C170_DA_NFE]).erros).toHaveLength(0);
    });

    it('julga cada C100 pelo modelo DELE, no arquivo misturado', () => {
        const r = conferirC170DeNfce([C100_NFE, C170_DA_NFE, C100_NFCE, C170_DA_NFCE, C170_DA_NFCE]);
        expect(r.erros).toHaveLength(2);
        expect(r.erros.every((e: any) => e.registro === 'C170')).toBe(true);
    });

    it('registro de outro bloco fecha o pai — C170 órfão não herda o modelo', () => {
        expect(conferirC170DeNfce([C100_NFCE, '|C990|3|', C170_DA_NFCE]).erros).toHaveLength(0);
    });

    it('e ela entrou no agregador que a rota chama', () => {
        const avisos = avisosDaPrevalidacaoContrib([C100_NFCE, C170_DA_NFCE]);
        expect(avisos.join(' ')).toContain('Registro Pai');
    });
});

// ============================================================================
// 🚨 A CONSEQUÊNCIA: MEIA CORREÇÃO TROCA UMA RECUSA POR OUTRA
//
// Provado sobre o arquivo REAL da HYPE: como ele está hoje, nenhum item do
// 0200 é órfão. Tirando SÓ o C170 das NFC-e, aparecem **quatro** — `10`, `11`,
// `20` e `101`, que só existem em cupom. É a recusa que a PWR já pagou em
// 19/08: *"Não informar item, se não referenciado em pelo menos um dos demais
// blocos"*. Por isso a coleta do 0200 lê o MESMO dono que decide o C170.
// ============================================================================
describe('🚨 o 0200 e o 0190 acompanham quem os referencia', () => {
    const C100_NFCE_2 = C100_NFCE;
    const linhasCorrigidas = [
        '|0190|UN|UNIDADE|',
        '|0190|KIT|KIT|',
        '|0200|10|Bufe Avulso|||UN|00|21069090|||||',        // só existia em cupom
        '|0200|UD-10-640|Frasco pote|||KIT|00|70109021|||||', // vive na nota 55
        C100_NFCE_2,                                          // sem C170: correto
        C100_NFE, C170_DA_NFE,
    ];

    it('acusa o item que ficou sem quem o referencie, e NOMEIA qual', () => {
        const r = conferirCadastrosOrfaosContrib(linhasCorrigidas).erros;
        const itens = r.filter((e: any) => e.registro === '0200');
        expect(itens).toHaveLength(1);
        expect(itens[0].mensagem).toContain('item 10');
        expect(itens[0].fonte).toContain('PWR');
    });

    it('a unidade que sobra sozinha também sai NOMEADA', () => {
        // Tirando o item que usava UN, a unidade fica sem ninguém.
        const semUn = linhasCorrigidas.filter(l => !l.startsWith('|0200|10|'));
        const un = conferirCadastrosOrfaosContrib(semUn).erros
            .filter((e: any) => e.registro === '0190');
        expect(un).toHaveLength(1);
        expect(un[0].mensagem).toContain('unidade UN');
    });

    // ⚠️ Quem referencia aqui são C170 **e A170** — no EFD ICMS/IPI é só o
    // C170. Portar a régua do vizinho sem trocar esse conjunto acusaria todo
    // item de NFS-e num arquivo correto, que é o alarme falso que faz a equipe
    // desligar a prevalidação.
    it('item referenciado pelo A170 NÃO é órfão', () => {
        const linhas = [
            '|0200|SERV-GENERICO|Prestação de serviços|||UN|09||||||',
            '|A170|1|SERV-GENERICO|Serviço|1000,00|0,00|01|1000,00|0,6500|6,50|01|1000,00|3,0000|30,00|||0|',
        ];
        expect(conferirCadastrosOrfaosContrib(linhas).erros).toHaveLength(0);
    });

    it('nasce VERDE — arquivo coerente não produz aviso nenhum', () => {
        expect(conferirCadastrosOrfaosContrib([
            '|0190|KIT|KIT|',
            '|0200|UD-10-640|Frasco pote|||KIT|00|70109021|||||',
            C100_NFE, C170_DA_NFE,
        ]).erros).toHaveLength(0);
    });
});

// 🚨 O gerador e a coleta do 0200 têm de ler o MESMO dono — duas perguntas
// ligadas com duas respostas é o defeito que esta casa mais paga. O
// orquestrador puxa firebase-admin e não carrega no jest, então a prova é por
// VARREDURA da fonte (a mesma técnica do E520/saldo anterior).
describe('🚨 os dois leitores do dono', () => {
    const fonte = (p: string) => require('fs').readFileSync(require('path').resolve(__dirname, p), 'utf8');

    it('a coleta de itens do orquestrador chama levaC170NoContribuicoes', () => {
        const orq = fonte('../sefaz-backend/sped-contrib-orchestrator.js');
        expect(orq).toContain('levaC170NoContribuicoes');
        expect(orq).toMatch(/if \(!levaC170NoContribuicoes\(nota\)\)/);
    });

    it('e a falta é DITA, com a receita ressalvada', () => {
        const orq = fonte('../sefaz-backend/sped-contrib-orchestrator.js');
        expect(orq).toMatch(/NFC-e \(modelo 65\) foram escrituradas SEM C170/);
        expect(orq).toMatch(/nada deixa de ser apurado/);
    });
});
