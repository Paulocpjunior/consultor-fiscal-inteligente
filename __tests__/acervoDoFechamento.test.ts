// ============================================================================
// 🔒 O ARQUIVO SAI DO ACERVO QUE O FIM DE MÊS CONGELOU
//
// A segunda leva do "DAR FIM DE MÊS" (26/08): o carimbo já guardava o instante
// do corte, e NINGUÉM o lia — os dois SPED continuavam gerando do acervo de
// HOJE. Sem isto, o arquivo de agosto regerado em dezembro sai DIFERENTE se uma
// nota de agosto chegou em novembro, que é exatamente o que o ato existe para
// impedir.
//
// 🚨 A ARMADILHA QUE DECIDE O DESENHO, e ela foi MEDIDA: o instante de chegada
// é gravado em DOIS nomes e DOIS tipos — `createdAt`/`importadoEm`, como
// Firestore Timestamp num trilho e como **string ISO** no
// `nfse-sp-importer.js:172`. Um `.where('createdAt','<=',corte)` deixaria de
// fora, em SILÊNCIO, todo documento gravado como string (o Firestore ordena por
// TIPO). Por isso a comparação é em MEMÓRIA, por um dono só.
// ============================================================================
// O módulo tem `.d.ts` — o tsc confere o que se importa dele.
import {
    chegouEmMs, recortarPeloFechamento, avisosDoRecorte, CAMPOS_PARA_CHEGADA,
} from '../sefaz-backend/acervo-do-fechamento.js';

const CORTE = '2026-09-05T13:00:00.000Z';
const antes = '2026-08-30T10:00:00.000Z';
const depois = '2026-09-08T09:00:00.000Z';

const fechado = (over: Record<string, unknown> = {}) => ({
    estado: 'fechada',
    corte: { instante: CORTE, ultNSU: 4210, maxNSU: 4210, documentos: { entradas: 131, saidas: 12, total: 143 } },
    ...over,
});

describe('🚨 as quatro formas do instante de chegada dão a MESMA resposta', () => {
    const alvo = new Date(antes).getTime();

    it.each([
        ['createdAt como string ISO (nfse-sp-importer)', { createdAt: antes }],
        ['importadoEm como string ISO', { importadoEm: antes }],
        ['createdAt como Timestamp do SDK', { createdAt: { toMillis: () => alvo } }],
        ['createdAt como Timestamp em JSON (seconds)', { createdAt: { seconds: alvo / 1000 } }],
        ['createdAt como Timestamp em JSON (_seconds)', { createdAt: { _seconds: alvo / 1000 } }],
        ['número cru (ms)', { createdAt: alvo }],
    ])('%s', (_n, doc) => {
        expect(chegouEmMs(doc)).toBe(alvo);
    });

    it('`createdAt` vence `importadoEm` — e os dois são lidos', () => {
        expect(CAMPOS_PARA_CHEGADA).toEqual(['createdAt', 'importadoEm']);
        expect(chegouEmMs({ createdAt: null, importadoEm: antes })).toBe(alvo);
    });

    // ⚠️ `dhEmi` fica de FORA: ele diz quando a nota foi EMITIDA, não quando ela
    // chegou aqui. É o caso do Ceará — emitida em 30/08, capturada em 02/09.
    it('`dhEmi` NÃO responde por chegada', () => {
        expect(chegouEmMs({ dhEmi: antes })).toBeNull();
    });

    it('sem instante legível devolve null, nunca 0', () => {
        expect(chegouEmMs({})).toBeNull();
        expect(chegouEmMs({ createdAt: 'ontem' })).toBeNull();
        expect(chegouEmMs(null)).toBeNull();
    });
});

describe('🚨 sem fim de mês, NADA muda', () => {
    const docs = [{ id: 'a', createdAt: antes }, { id: 'b', createdAt: depois }];

    it.each([
        ['competência aberta', null],
        ['competência REABERTA', { estado: 'reaberta', corte: { instante: CORTE } }],
    ])('%s devolve o acervo inteiro', (_n, f) => {
        const r = recortarPeloFechamento(docs, f as never);
        expect(r.docs).toHaveLength(2);
        expect(r.foraDoCorte).toEqual([]);
        expect(avisosDoRecorte(r)).toEqual([]);
    });

    // 'reaberta' é competência ABERTA: recortá-la esconderia justamente a nota
    // que motivou a reabertura.
    it('a reaberta não perde a nota que chegou depois', () => {
        const r = recortarPeloFechamento(docs, { estado: 'reaberta', corte: { instante: CORTE } } as never);
        expect(r.docs.map((d: any) => d.id)).toEqual(['a', 'b']);
    });
});

describe('🚨 com o mês fechado, o que chegou depois fica FORA — e é DITO', () => {
    const docs = [
        { id: 'antes-1', createdAt: antes },
        { id: 'antes-2', importadoEm: antes },
        { id: 'depois-1', createdAt: depois },
    ];

    it('recorta pelo instante do corte', () => {
        const r = recortarPeloFechamento(docs, fechado() as never);
        expect(r.docs.map((d: any) => d.id)).toEqual(['antes-1', 'antes-2']);
        expect(r.foraDoCorte.map((d: any) => d.id)).toEqual(['depois-1']);
    });

    // O documento que chegou EXATAMENTE no instante do corte entra: o corte é o
    // retrato daquele momento, e o carimbo o contou.
    it('o documento do próprio instante ENTRA', () => {
        const r = recortarPeloFechamento([{ id: 'x', createdAt: CORTE }], fechado() as never);
        expect(r.docs).toHaveLength(1);
        expect(r.foraDoCorte).toEqual([]);
    });

    // 🚨 A CAUSA JUNTO DO NÚMERO: sem isto quem confere vê um documento a menos
    // que na Central de XMLs e conclui que a captura falhou.
    it('o aviso diz quantos, quando foi o corte e como incluí-los', () => {
        const avisos = avisosDoRecorte(recortarPeloFechamento(docs, fechado() as never));
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toMatch(/1 documento\(s\) ficaram FORA/);
        expect(avisos[0]).toMatch(/143 documento\(s\) no carimbo/);
        expect(avisos[0]).toMatch(/reabrir a competência/);
    });

    // Alarme sobre arquivo normal é o que ensina a equipe a ignorar os avisos.
    it('nasce MUDO quando nada ficou de fora', () => {
        const r = recortarPeloFechamento([{ id: 'a', createdAt: antes }], fechado() as never);
        expect(avisosDoRecorte(r)).toEqual([]);
    });
});

describe('🚨 ausência não é prova — e aqui isso decide o lado do erro', () => {
    const docs = [
        { id: 'legivel', createdAt: antes },
        { id: 'sem-carimbo' },
    ];

    // Tirá-lo produziria LIVRO A MENOR, que é o erro caro. Mantê-lo produz, no
    // máximo, um documento a mais que o carimbo contou — e isso é dito.
    it('documento sem instante legível FICA no arquivo', () => {
        const r = recortarPeloFechamento(docs, fechado() as never);
        expect(r.docs.map((d: any) => d.id)).toEqual(['legivel', 'sem-carimbo']);
        expect(r.semCarimboDeChegada.map((d: any) => d.id)).toEqual(['sem-carimbo']);
    });

    it('e sai NOMEADO, com o total do carimbo para conferir', () => {
        const avisos = avisosDoRecorte(recortarPeloFechamento(docs, fechado() as never));
        expect(avisos.join(' ')).toMatch(/não têm registro de QUANDO/);
        expect(avisos.join(' ')).toMatch(/MANTIDOS/);
        expect(avisos.join(' ')).toMatch(/143/);
    });

    // Carimbo sem instante legível não recorta NADA — recortar por um corte que
    // não se sabe qual é seria pior que não recortar.
    it('carimbo sem instante legível não recorta', () => {
        const r = recortarPeloFechamento(docs, fechado({ corte: { instante: 'ontem' } }) as never);
        expect(r.docs).toHaveLength(2);
        expect(r.foraDoCorte).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 QUEM GERA ARQUIVO FISCAL PASSA PELO DONO — varredura, nunca lista
//
// Corrigir os dois orquestradores de hoje fecha a INSTÂNCIA; esta varredura
// fecha a CLASSE. Gerador novo que ler `documentos_fiscais` sem perguntar ao
// carimbo geraria do acervo de HOJE — e ninguém veria, porque o arquivo sai
// normal: ele só fica DIFERENTE do que o Contábil importou.
//
// É a mesma disciplina do `cfopPorNota.test.ts` (os leitores do CFOP escriturado)
// e do `projecaoNaoCegaARegua` — trava por comportamento, não por arquivo
// enumerado, senão ela envelhece no primeiro gerador novo e envelhece em
// SILÊNCIO.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 os geradores de arquivo fiscal leem o acervo do fechamento', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const RAIZ = join(__dirname, '..');

    const ORQUESTRADORES = [
        'sefaz-backend/sped-fiscal-orchestrator.js',
        'sefaz-backend/sped-contrib-orchestrator.js',
    ];

    it.each(ORQUESTRADORES)('%s recorta pelo carimbo', (rel) => {
        const src = readFileSync(join(RAIZ, rel), 'utf8');
        expect(src).toMatch(/lerFechamentoDaCompetencia\(/);
        expect(src).toMatch(/recortarPeloFechamento\(/);
        // A causa junto do número: sem o aviso, quem confere vê um documento a
        // menos que na Central de XMLs e conclui que a captura falhou.
        expect(src).toMatch(/avisosDoRecorte\(/);
    });

    // 🔒 O ID É RÉGUA ÚNICA. A competência circula em quatro formas neste app,
    // e `${id}_07/2026` é um documento DIFERENTE de `${id}_2026-07`. Montá-lo à
    // mão em dois lugares daria dois carimbos para o mesmo mês, em silêncio.
    it('ninguém monta o id do carimbo à mão', () => {
        const DONO = 'sefaz-backend/fechamento-store.js';
        const suspeitos = [
            ...ORQUESTRADORES,
            'sefaz-backend/fim-de-mes-routes.js',
            'services/lucroPresumidoService.ts',
        ];
        for (const rel of suspeitos) {
            if (rel === DONO) continue;
            const src = readFileSync(join(RAIZ, rel), 'utf8');
            // `fechamentos_competencia` citada com o id montado na mesma linha.
            const cru = src.match(/fechamentos_competencia['"`],?\s*`\$\{[^`]*\}_\$\{/);
            expect({ rel, cru: cru?.[0] || null }).toEqual({ rel, cru: null });
        }
    });
});
