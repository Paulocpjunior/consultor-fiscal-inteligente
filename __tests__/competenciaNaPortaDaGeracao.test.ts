// ============================================================================
// 🚨 A COMPETÊNCIA ENTRAVA NA GERAÇÃO SEM CONFERÊNCIA DE FORMA — e o arquivo
// saía VAZIO dizendo que a empresa não teve movimento
//
// As portas do **EFD-Contribuições** e do **EFD ICMS/IPI** só perguntavam se a
// competência EXISTIA (`if (!competencia) …`). Chegando `07/2026` ou `202607`,
// o `where('competencia','==',…)` de `documentos_fiscais` — que grava sempre
// `AAAA-MM` — devolvia **ZERO documentos**; o orquestrador empilhava o aviso
// *"não tem documentos fiscais no período; arquivo será gerado com estrutura
// mínima"* e **o arquivo saía mesmo assim**.
//
// 🔴 É a ausência PLAUSÍVEL no lugar mais caro: empresa sem movimento é caso
// legítimo, então aquele aviso não parece defeito — ele parece a verdade. É a
// mesma família do caso HYPE (17/08), em que a consulta por igualdade de
// competência achou ZERO envios anteriores e liberou a MESMA cobrança.
//
// ⚠️ **A régua NORMALIZA em vez de recusar as outras formas** — `07/2026` e
// `202607` dizem a mesma competência, e é para isso que o dono existe. O que
// RECUSA é o ILEGÍVEL: competência chutada é arquivo entregue no mês errado.
//
// 📌 E entrou nas DUAS famílias no MESMO PR. Meia trava protege o cliente que
// já quebrou e deixa o próximo descoberto — a lição de 21/08, aqui do lado da
// PORTA em vez do registro.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo backend .js sem .d.ts
import { competenciaParaGerarArquivo } from '../sefaz-backend/competencia.js';

const RAIZ = join(__dirname, '..');

describe('🚨 a competência da geração passa pelo dono', () => {
    it('as formas conhecidas viram AAAA-MM — não são recusadas à toa', () => {
        for (const forma of ['2026-07', '07/2026', '202607', '2026-07-15']) {
            expect({ forma, r: competenciaParaGerarArquivo(forma) })
                .toEqual({ forma, r: { ok: true, competencia: '2026-07' } });
        }
    });

    it('o ILEGÍVEL recusa, e a frase diz a consequência', () => {
        for (const lixo of ['', null, undefined, 'julho', '2026-13', '13/2026']) {
            const r = competenciaParaGerarArquivo(lixo);
            expect({ lixo, ok: r.ok }).toEqual({ lixo, ok: false });
            expect(r.erro).toMatch(/AAAA-MM/);
            // A frase tem de dizer POR QUE isso importa — "inválido" sozinho
            // manda a pessoa procurar defeito de digitação num problema que
            // terminaria em arquivo entregue vazio.
            expect(r.erro).toMatch(/VAZIO/);
        }
    });
});

describe('🚨 as DUAS portas de geração conferem a forma', () => {
    const fonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

    it('o EFD-Contribuições confere no preview E no gerar', () => {
        const src = fonte('sefaz-backend/sped-contrib-routes.js');
        expect((src.match(/competenciaParaGerarArquivo\(/g) || []).length).toBeGreaterThanOrEqual(2);
        // E não sobrou a guarda antiga, que só perguntava se existia.
        expect(src).not.toMatch(/if \(!competencia\) return res\.status\(400\)/);
    });

    it('o EFD ICMS/IPI também — e nos TRÊS campos de período', () => {
        const src = fonte('sefaz-backend/sped-fiscal-routes.js');
        expect(src).toContain('periodoDaRequisicao');
        for (const campo of ['competencia', 'competenciaInicio', 'competenciaFim']) {
            expect(src).toContain(`'${campo}'`);
        }
        expect((src.match(/periodoDaRequisicao\(/g) || []).length).toBeGreaterThanOrEqual(3);
    });

    // ⚠️ O nome do arquivo saía da forma CRUA da requisição: um `07/2026`
    // viraria nome de arquivo com barra.
    it('o nome do arquivo sai do período JÁ normalizado', () => {
        const src = fonte('sefaz-backend/sped-fiscal-routes.js');
        expect(src).toContain('periodo.competencia.replace');
        expect(src).not.toMatch(/const periodo = competencia\s*$/m);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 E NO DAS A COMPETÊNCIA CRUA DECIDE DUAS COISAS QUE NÃO VOLTAM ATRÁS
//
//   · o **período que vai ao PGDAS-D** — o provider faz
//     `Number(competencia.replace(/\D/g,'').slice(0,6))`, e com `07/2026` isso
//     vira **72026**, período que não existe;
//   · a **IDENTIDADE do DAS emitido** — o `docId` é
//     `${cnpj}_${competencia}_regular` com não-alfanuméricos virando `_`.
//     `2026-07` e `07/2026` dão ids DIFERENTES para o MESMO mês, então a
//     idempotência que impede a segunda emissão não vê a primeira: **duas
//     guias do mesmo DAS**.
//
// ⚠️ Entrega ao PGDAS-D não se desfaz, e guia dobrada é o defeito que a casa
// mais paga — por isso aqui a régua RECUSA a ilegível em vez de seguir.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 o DAS normaliza a competência antes de emitir', () => {
    const src = readFileSync(join(RAIZ, 'sefaz-backend/das-orchestrator.js'), 'utf8');

    it('o regular e o avulso passam pela régua', () => {
        expect((src.match(/competenciaNormalizadaOuErro\(/g) || []).length).toBeGreaterThanOrEqual(3);
    });

    it('e nenhum dos dois desestrutura a competência crua da requisição', () => {
        expect(src).not.toMatch(/const \{[^}]*\bcompetencia\b[^}]*\} = req;/);
    });

    // A frase precisa dizer as DUAS consequências — "competência inválida"
    // sozinho manda procurar erro de digitação num problema que termina em
    // declaração no período errado e guia emitida duas vezes.
    it('a recusa diz o que estava em jogo', () => {
        expect(src).toMatch(/PGDAS-D/);
        expect(src).toMatch(/duas vezes/);
    });

    it('o docId continua saindo da competência já normalizada', () => {
        expect(src).toContain('_regular`.replace(');
    });
});
