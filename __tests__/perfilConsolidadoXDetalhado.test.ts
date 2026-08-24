// ============================================================================
// 🚨 A PREMISSA "ALUGUEL ⇒ ARQUIVO CONSOLIDADO" ERA DA AFFITTARE
//
// Recusa do PVA na **PEC PRONTA ENTREGA 1350** (55.070.577/0001-61 · 07/2026,
// Paulo em 24/08), **6 erros, todos o mesmo**:
//
//   "O registro não deve ser informado para esse perfil e/ou tipo de operação.
//    Consulte o guia prático da EFD-Contribuições e verifique a obrigatoriedade
//    dos registros na Seção 4 - Obrigatoriedade"
//
// Recusados: 1× A010 + 5× A100. A PEC **tem serviços prestados E aluguel** — e
// o app escreveu `|0110|2||1|2|` (IND_REG_CUM 2 = CONSOLIDADO) só porque havia
// receita de locação. Arquivo consolidado é o que NÃO escritura documento.
//
// ✅ **O GABARITO É O EFD ASSINADO DA PRÓPRIA PEC (05/2026)**, que faz o certo:
//     |0110|2||1|9|                    ← DETALHADO
//     5× A100/A170                     ← os serviços FICAM
//     |F100|1|||01052026|188836,42|…|  ← o aluguel vai no F100, não no F550
//     |1001|1|                         ← bloco 1 SEM DADOS: sem F550, sem 1900
//
// 📌 F550 e F100 declaram a MESMA receita. A diferença não é de valor — é de
// PERFIL: F550 só existe no consolidado; F100 é o registro de "demais
// operações" do detalhado, e convive com o bloco A.
//
// ⚠️ E a prevalidação de 21/08 **DISPAROU** neste arquivo — ela previu as 6
// recusas antes do PVA. O defeito não era o aviso: era a DECISÃO, que escolhia
// consolidado sem perguntar se havia documento. Aviso não conserta arquivo.
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts
import { indRegCumDoArquivo, montarF100 } from '../sefaz-backend/receita-sem-documento-f550.js';
import { buildBlocoF, buildBloco1_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { avisosDePerfilConsolidado } from '../sefaz-backend/sped-contrib-campos.js';

const CNPJ_PEC = '55070577000161';
const semQuebra = (l: string) => String(l).replace(/\r?\n$/, '');

describe('🚨 o PERFIL do arquivo pergunta se há DOCUMENTO, não só se há aluguel', () => {
    const base = { regimeApuracao: '2', receitaConsolidada: 138900 };

    it('aluguel SEM documento é CONSOLIDADO (2) — o caso AFFITTARE', () => {
        expect(indRegCumDoArquivo({ ...base, documentosDeReceita: 0 })).toBe('2');
    });

    // 🚨 O caso que produziu as 6 recusas.
    it('aluguel COM documento é DETALHADO (9) — o caso PEC', () => {
        expect(indRegCumDoArquivo({ ...base, documentosDeReceita: 5 })).toBe('9');
    });

    it('sem aluguel nenhum continua DETALHADO, como sempre foi', () => {
        expect(indRegCumDoArquivo({ regimeApuracao: '2', receitaConsolidada: 0, documentosDeReceita: 5 }))
            .toBe('9');
    });

    // Fora do cumulativo o campo não é informado — não mexer nisso.
    it('no não-cumulativo o campo continua vazio', () => {
        expect(indRegCumDoArquivo({ regimeApuracao: '1', receitaConsolidada: 138900 })).toBe('');
    });
});

describe('🚨 o aluguel vai ao F550 ou ao F100 conforme o perfil', () => {
    const dados = (consolidada: boolean) => ({
        empresa: { cnpj: CNPJ_PEC },
        competencia: '2026-07', competenciaInicio: '2026-07',
        regimeApuracao: '2',
        receitaSemDocumento: 138900,
        escrituracaoConsolidada: consolidada,
        notas: [], warnings: [] as string[],
    });

    it('CONSOLIDADO emite F550 e nenhum F100', () => {
        const l = buildBlocoF(dados(true)).map(semQuebra);
        expect(l.some((x: string) => x.startsWith('|F550|'))).toBe(true);
        expect(l.some((x: string) => x.startsWith('|F100|'))).toBe(false);
    });

    it('DETALHADO emite F100 e nenhum F550', () => {
        const l = buildBlocoF(dados(false)).map(semQuebra);
        expect(l.some((x: string) => x.startsWith('|F100|'))).toBe(true);
        expect(l.some((x: string) => x.startsWith('|F550|'))).toBe(false);
    });

    // Um F010 só: dois para o mesmo CNPJ é duplicidade que o PVA recusa.
    it('o F010 abre uma vez só', () => {
        for (const c of [true, false]) {
            const l = buildBlocoF(dados(c)).map(semQuebra);
            expect(l.filter((x: string) => x.startsWith('|F010|'))).toHaveLength(1);
        }
    });

    // 📌 O leiaute vem do arquivo ASSINADO da PEC — não de tabela deduzida.
    it('o F100 tem a forma do arquivo assinado (18 campos, COD_PART/COD_ITEM vazios)', () => {
        const linha = buildBlocoF(dados(false)).map(semQuebra)
            .find((x: string) => x.startsWith('|F100|'))!;
        const c = linha.split('|');
        // ['', 'F100', IND_OPER, COD_PART, COD_ITEM, DT_OPER, VL_OPER, ...]
        expect(c[2]).toBe('1');            // IND_OPER — do assinado
        expect(c[3]).toBe('');             // COD_PART — aluguel não tem
        expect(c[4]).toBe('');             // COD_ITEM — idem
        expect(c[5]).toBe('01072026');     // DT_OPER — 1º dia da competência
        expect(c[6]).toBe('138900,00');    // VL_OPER
        expect(c[7]).toBe('01');           // CST_PIS
        expect(c[11]).toBe('01');          // CST_COFINS
    });

    it('F100 e F550 declaram a MESMA contribuição — a diferença é de perfil', () => {
        const f100 = montarF100({ receita: 138900, aliqPis: 0.0065, aliqCofins: 0.03 });
        expect(f100.pis).toBeCloseTo(902.85, 2);
        expect(f100.cofins).toBeCloseTo(4167.00, 2);
    });

    it('sem receita de locação nenhuma, nem F550 nem F100', () => {
        const d = { ...dados(false), receitaSemDocumento: 0 };
        const l = buildBlocoF(d).map(semQuebra);
        expect(l.some((x: string) => /^\|F(100|550)\|/.test(x))).toBe(false);
        expect(l[0]).toBe('|F001|1|');
    });
});

describe('🚨 o 1900 é consequência do F550 — não do aluguel', () => {
    const dados = (consolidada: boolean) => ({
        empresa: { cnpj: CNPJ_PEC },
        receitaSemDocumento: 138900,
        escrituracaoConsolidada: consolidada,
        contrib1900CodMod: '99', contrib1900CodSit: '00',
        warnings: [] as string[],
    });

    it('no CONSOLIDADO o 1900 sai', () => {
        const l = buildBloco1_Contrib(dados(true)).map(semQuebra);
        expect(l.some((x: string) => x.startsWith('|1900|'))).toBe(true);
    });

    // ⚠️ O assinado da PEC tem aluguel e traz |1001|1| — sem 1900. A recusa do
    // PVA fala de "F550 e F560"; no detalhado não há F550, então não há
    // obrigação. Emitir ali seria inventar obrigação que a recusa não criou.
    it('no DETALHADO o bloco 1 fica SEM DADOS, como o arquivo assinado', () => {
        const d = dados(false);
        const l = buildBloco1_Contrib(d).map(semQuebra);
        expect(l).toEqual(['|1001|1|', '|1990|2|']);
        expect(d.warnings).toHaveLength(0);
    });
});

// ============================================================================
// A prevalidação de 21/08 já previa estas recusas — e continua de pé.
// ============================================================================
describe('a prevalidação segue acusando o arquivo que a PEC recebeu', () => {
    // Trecho do arquivo REAL recusado (07/2026).
    const RECUSADO = [
        '|0110|2||1|2|',
        '|A001|0|',
        '|A010|55070577000161|',
        '|A100|1|0|03562049870|00|||55||21072026|21072026|4348,66|0||4348,66|28,27|4348,66|130,46||||',
        '|F550|138900,00|01|0,00|138900,00|0,65|902,85|01|0,00|138900,00|3,00|4167,00|||||',
    ];

    it('acusa A010 e A100 no arquivo consolidado — as 6 recusas do PVA', () => {
        const av = avisosDePerfilConsolidado(RECUSADO);
        expect(av.join(' ')).toMatch(/A010/);
        expect(av.join(' ')).toMatch(/A100/);
    });

    // ⚠️ E fica MUDA no arquivo que a correção produz: detalhado com documento
    // é justamente o certo. Alarme sobre escrituração correta é o que faz a
    // equipe desligar a prevalidação.
    it('fica MUDA quando o mesmo conteúdo sai DETALHADO', () => {
        const corrigido = RECUSADO
            .map(l => (l.startsWith('|0110|') ? '|0110|2||1|9|' : l))
            .map(l => (l.startsWith('|F550|')
                ? '|F100|1|||01072026|138900,00|01|138900,00|0,65|902,85|01|138900,00|3,00|4167,00||||||'
                : l));
        expect(avisosDePerfilConsolidado(corrigido)).toHaveLength(0);
    });
});
