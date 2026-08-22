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
