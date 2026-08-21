// ============================================================================
// 🚨 O BLOCO D DO EFD-CONTRIBUIÇÕES SAÍA COM VL_DOC 0,00 EM TODO CT-e
// CAPTURADO — e não tinha um único teste.
//
// Varredura noturna dos leitores de DOCUMENTO (21/08). O `buildBlocoD_Contrib`
// carregava as TRÊS leituras cruas de uma vez:
//
//   · `parseFloat(nota.valor || nota.totalNota || 0)` — o importer grava
//     **valorTotal** (o CT-e traz `<vTPrest>`; ver xml-importer, "sem o
//     fallback, CT-e capturado aparecia com valor R$ 0,00"). Nenhuma das duas
//     formas lidas existe no documento capturado ⇒ VL_DOC 0,00, PIS/COFINS
//     zerados, e o crédito do FRETE perdido no não-cumulativo. É o MESMO
//     defeito que zerou o M200 da MANTOAN em 17/08 — corrigido no bloco A e
//     deixado vivo aqui;
//   · `nota.direcao` cru — a régua é `direcaoEfetivaDoc`;
//   · participante só na forma ANINHADA — a captura grava achatado.
//
// Nada disso aparecia como erro: aparecia como ZERO, que é indistinguível de
// "o frete não teve valor".
// ============================================================================
import { buildBlocoD_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';
import { auditarSaidaSped } from '../sefaz-backend/sped-auditoria-saida.js';

/** Chave real de CT-e (modelo 57 nas posições 21-22). */
const CHAVE_CTE = '35260731947349000169570010000000031705547508';

const dados = (notas: any[]) => ({
    empresa: { cnpj: '31947349000169', nome: 'PWR' },
    competencia: '2026-07', regimeApuracao: '1', notas, warnings: [] as string[],
});

/** Como o importer principal grava um CT-e tomado: valorTotal + achatados. */
const cteCapturado = (over: any = {}) => ({
    chave: CHAVE_CTE, tipoDoc: 'CTe', direcao: 'entrada', status: 'autorizado',
    numero: '4321', dhEmi: '2026-07-10T10:00:00-03:00',
    valorTotal: 1500,
    cnpjEmit: '47252373000113', xNomeEmit: 'TRANSPORTADORA LTDA',
    ...over,
});

const d100De = (linhas: string[]) => linhas.find((l) => l.startsWith('|D100|'))?.split('|');

describe('🚨 bloco D — o CT-e como ele chega da captura', () => {
    it('o valor REAL (valorTotal) chega ao registro — antes era 0,00 em toda linha', () => {
        const linha = buildBlocoD_Contrib(dados([cteCapturado()])).find((l: string) => l.startsWith('|D100|'));
        expect(linha).toBeDefined();
        // ⚠️ O TESTE PERGUNTA PELO VALOR, NÃO PELA POSIÇÃO — de propósito. O
        // leiaute do D100 do EFD-Contribuições NÃO está provado contra arquivo
        // aceito (ele volta em `naoConferidos` na contagem de campos), e o
        // gerador monta 20 campos onde o Guia Prático lista 23. Travar aqui a
        // posição que o gerador usa hoje seria carimbar de PROVADO um leiaute
        // deduzido — o oposto da régua da casa. O que ESTE PR conserta é a
        // LEITURA (o valor existe e não era lido); a posição fica NOMEADA como
        // pendência, para ser fechada com um EFD-Contribuições aceito que
        // tenha bloco D.
        expect(linha).toContain('1500,00');
        // E o crédito do frete deixa de ser zero: 1,65% e 7,6% do não-cumulativo.
        expect(linha).toContain('24,75');
        expect(linha).toContain('114,00');
    });

    it('PIS/COFINS do frete deixam de sair zerados', () => {
        const linha = buildBlocoD_Contrib(dados([cteCapturado()])).find((l: string) => l.startsWith('|D100|'));
        expect(linha).not.toMatch(/\|0,00\|0,00\|/);
    });

    it('o participante vem dos campos ACHATADOS da captura', () => {
        const campos = d100De(buildBlocoD_Contrib(dados([cteCapturado()])) as never)!;
        expect(campos[4]).toBe('47252373000113');   // COD_PART do emitente
    });

    it('CT-e sem valor em forma NENHUMA sai da base, NOMEADO — nunca como zero', () => {
        const d = dados([cteCapturado({ valorTotal: undefined, numero: '999' })]);
        const linhas = buildBlocoD_Contrib(d as never);
        expect(linhas.find((l: string) => l.startsWith('|D100|'))).toBeUndefined();
        expect(d.warnings.join(' ')).toMatch(/999/);
        expect(d.warnings.join(' ')).toMatch(/vTPrest/);
    });

    it('cancelado por EVENTO continua fora (status ainda "autorizado")', () => {
        const cancelado = cteCapturado({ eventos: [{ tpEvento: '110111', cStat: '135' }] });
        expect(buildBlocoD_Contrib(dados([cancelado])).find((l: string) => l.startsWith('|D100|'))).toBeUndefined();
    });

    it('sem CT-e no período o bloco sai SEM DADOS, como antes', () => {
        const linhas = buildBlocoD_Contrib(dados([]));
        expect(linhas.find((l: string) => l.startsWith('|D001|'))).toBe('|D001|1|\r\n');
    });
});

describe('🚨 e a auditoria passa a VIGIAR o D100 (regra de 06/08)', () => {
    it('D100 com VL_DOC zerado em 100% das linhas é acusado', () => {
        const arquivo = [
            '|D100|0|1|47252373000113|57|00|1|4321|' + CHAVE_CTE + '|10072026|10072026|0,00|',
            '|D100|0|1|47252373000113|57|00|1|4322|' + CHAVE_CTE + '|11072026|11072026|0,00|',
        ];
        const s = auditarSaidaSped(arquivo).suspeitas.filter((x: any) => x.registro === 'D100');
        expect(s.length).toBeGreaterThan(0);
        expect(s[0].detalhe).toMatch(/VL_DOC/);
    });
});
