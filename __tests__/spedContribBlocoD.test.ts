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
//
// ⚠️ **A FIXTURE MUDOU EM 26/08, e o motivo é o certo**: descobriu-se que o
// bloco D só existe para a AQUISIÇÃO de frete com direito a crédito (Guia 1.35,
// D100) — ou seja, no regime NÃO-cumulativo e com os códigos de tabela oficial
// cadastrados. A fixture passou a trazer esse cadastro. **Trocar a fixture é o
// certo; afrouxar a régua para o teste passar seria desligar a trava** — a
// mesma decisão do C100 (20/08) e do 0150 (25/08).
// ============================================================================
import { buildBlocoD_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';
import { auditarSaidaSped } from '../sefaz-backend/sped-auditoria-saida.js';

/** Chave real de CT-e (modelo 57 nas posições 21-22). */
const CHAVE_CTE = '35260731947349000169570010000000031705547508';

/** Cadastro do frete contratado — sem ele o CT-e não entra (e é assim mesmo). */
const FRETE_CADASTRADO = {
    contribIndNatFrete: '2',      // compras geradoras de crédito
    contribIndFrtCte: '0',        // por conta do emitente
    contribNatBcCredFrete: '09',  // Tabela 4.3.7
};

const dados = (notas: any[]) => ({
    empresa: { cnpj: '31947349000169', nome: 'PWR', dadosFiscais: { ...FRETE_CADASTRADO } },
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
        // ✅ 26/08 — A POSIÇÃO AGORA PODE SER TRAVADA. Este comentário dizia que
        // o leiaute do D100 "não está provado" e que o gerador montava 20 campos
        // onde o Guia lista 23; com o Guia Prático 1.35 no repo, a tabela do
        // registro foi lida campo a campo e o `VL_DOC` é o **15**. Antes desta
        // correção o valor caía na casa do `TP_CT-e`, que tem UM dígito.
        expect(linha!.split('|')[15]).toBe('1500,00');
        // E o crédito do frete deixa de ser zero — mas ele mora no D101/D105,
        // não no D100: PIS/COFINS dentro do D100 iam parar em campos de ICMS.
        const pis = buildBlocoD_Contrib(dados([cteCapturado()])).find((l: string) => l.startsWith('|D101|'));
        const cofins = buildBlocoD_Contrib(dados([cteCapturado()])).find((l: string) => l.startsWith('|D105|'));
        expect(pis).toContain('24,75');
        expect(cofins).toContain('114,00');
    });

    it('PIS/COFINS do frete deixam de sair zerados', () => {
        const linhas = buildBlocoD_Contrib(dados([cteCapturado()]));
        expect(linhas.find((l: string) => l.startsWith('|D101|'))).not.toMatch(/\|0,00\|/);
        expect(linhas.find((l: string) => l.startsWith('|D105|'))).not.toMatch(/\|0,00\|/);
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
    // 🐛 ESTA VIGILÂNCIA NASCEU MUDA (corrigido 26/08): a posição do VL_DOC
    // estava em 12, que é o `DT_A_P` — uma DATA, que nunca sai zerada. O campo
    // é o **15**, e a fixture antiga tinha 12 campos justamente porque foi
    // escrita para casar com a posição errada. Trava que olha o lugar errado
    // dá sensação de cobertura, que é pior que trava nenhuma.
    it('D100 com VL_DOC zerado em 100% das linhas é acusado', () => {
        const d100 = (num: string, dt: string) => '|D100|0|1|47252373000113|57|00|000||'
            + `${num}|${CHAVE_CTE}|${dt}|${dt}|||0,00||0|0,00||||||`;
        const arquivo = [d100('4321', '10072026'), d100('4322', '11072026')];
        const s = auditarSaidaSped(arquivo).suspeitas.filter((x: any) => x.registro === 'D100');
        expect(s.length).toBeGreaterThan(0);
        expect(s[0].detalhe).toMatch(/VL_DOC/);
    });
});
