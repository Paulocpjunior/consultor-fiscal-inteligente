// ============================================================================
// 🚨 A FILA DO ♻️ NÃO ANDAVA — "continua com os erros mesmo relendo"
//
// 18/09, à noite, Paulo, J.N. VINATEX · 08/2026, com o Relatório de Erros do
// PVA: **159 recusas** no campo 10 do 0150 (ENDERECO). De manhã eram 732; o
// ♻️ recuperou 573 e PAROU — e clicar de novo não mudava nada.
//
// ═══ A CAUSA É A FORMA DO BACKFILL, nos QUATRO ♻️ do acervo ═════════════════
//
//     const snap = await q.limit(1000).get();
//     for (const doc of snap.docs) {
//         if (jaRelido(doc)) { jaTinham++; continue; }   // filtro EM MEMÓRIA
//         ...
//     }
//
// O `limit()` corta a fila ANTES do filtro do carimbo: a query devolve SEMPRE
// os mesmos 1000 primeiros documentos (ordem do id), a rodada 1 os carimba, e
// a rodada 2 recebe os MESMOS 1000 — todos "já relidos" —, examina ZERO e
// para. Os 2501 restantes (3501 no recorte) **nunca são alcançados**, com a
// tela dizendo "rode de novo até a fila zerar" sobre uma fila que não tinha
// como andar. É a fila da reconferência (20/08, MV LIDER) outra vez.
//
// A prova aqui é sobre o DONO (`varrerComOrcamento`), com um Firestore FALSO
// que se comporta como o real: `limit` + `startAfter` por documento, e
// `count()` como agregação. O caso é o da VINATEX — 3501 documentos, 1000 já
// relidos — e a régua é: cada rodada tem de chegar onde a anterior parou.
// ============================================================================
// @ts-expect-error — módulo .js do backend (sem tipos)
import { varrerComOrcamento, restaramDaVarredura } from '../sefaz-backend/firestore-paginate.js';
import { readFileSync } from 'fs';
import { join } from 'path';

type Doc = { id: string; data: () => Record<string, unknown>; ref: { update: (p: object) => Promise<void> } };

/** Firestore de mentira: uma coleção em memória com a semântica do cursor. */
function firestoreFalso(total: number, jaRelidos: Set<number>, { countFalha = false } = {}) {
    const docs: Doc[] = [];
    for (let i = 1; i <= total; i++) {
        const dados: Record<string, unknown> = { numero: i, storagePath: `x/${i}.xml` };
        if (jaRelidos.has(i)) dados.participantesRelidos = 3;
        docs.push({
            id: String(i).padStart(5, '0'),
            data: () => dados,
            ref: { update: async (p) => { Object.assign(dados, p); } },
        });
    }
    let leituras = 0;
    const query = (limite: number | null, depois: Doc | null) => ({
        limit: (n: number) => query(n, depois),
        startAfter: (d: Doc) => query(limite, d),
        get: async () => {
            leituras++;
            let lista = docs;
            if (depois) lista = lista.filter((d) => d.id > depois.id);
            if (limite !== null) lista = lista.slice(0, limite);
            return { docs: lista, size: lista.length, empty: lista.length === 0 };
        },
        count: () => ({
            get: async () => {
                if (countFalha) throw new Error('count indisponível');
                return { data: () => ({ count: docs.length }) };
            },
        }),
    });
    return { q: query(null, null), docs, leituras: () => leituras };
}

/** O corpo de um backfill do acervo, como os quatro de `xml-importer.js`. */
async function rodada(q: any, orcamento: number) {
    let examinadas = 0, jaTinham = 0;
    const varredura = await varrerComOrcamento(q, {
        orcamento,
        aoDoc: async (doc: Doc) => {
            const d = doc.data();
            if (Number(d.participantesRelidos || 0) >= 3) { jaTinham++; return false; }
            examinadas++;
            await doc.ref.update({ participantesRelidos: 3 });
            return true;
        },
    });
    const restaram = await restaramDaVarredura(q, varredura);
    return { examinadas, jaTinham, restaram, ...varredura };
}

describe('🚨 a fila ANDA — o caso da VINATEX (3501 documentos, 1000 já relidos)', () => {
    it('a rodada seguinte chega onde a anterior parou, em vez de reler os mesmos 1000', async () => {
        const relidos = new Set<number>();
        for (let i = 1; i <= 1000; i++) relidos.add(i);
        const { q } = firestoreFalso(3501, relidos);

        // Rodada 1: pula os 1000 de graça e gasta o orçamento nos 1001..2000.
        const r1 = await rodada(q, 1000);
        expect(r1.jaTinham).toBe(1000);
        expect(r1.examinadas).toBe(1000);
        expect(r1.vistos).toBe(2000);
        expect(r1.restaram).toBe(1501);

        // Rodada 2: os 2000 já relidos são pulados; examina 2001..3000.
        const r2 = await rodada(q, 1000);
        expect(r2.jaTinham).toBe(2000);
        expect(r2.examinadas).toBe(1000);
        expect(r2.restaram).toBe(501);

        // Rodada 3: drena o resto e a fila ESGOTA — zero é resposta.
        const r3 = await rodada(q, 1000);
        expect(r3.examinadas).toBe(501);
        expect(r3.esgotou).toBe(true);
        expect(r3.restaram).toBe(0);

        // Rodada 4: nada a fazer, e a fila continua dizendo zero.
        const r4 = await rodada(q, 1000);
        expect(r4.examinadas).toBe(0);
        expect(r4.jaTinham).toBe(3501);
        expect(r4.restaram).toBe(0);
    });

    it('a forma ANTIGA (limit + filtro em memória) nunca sai dos primeiros 1000 — é o defeito', async () => {
        // Reproduz o backfill de antes, para o teste dizer o que ele acusava.
        const relidos = new Set<number>();
        for (let i = 1; i <= 1000; i++) relidos.add(i);
        const { q } = firestoreFalso(3501, relidos);
        const antiga = async () => {
            const snap = await q.limit(1000).get();
            let examinadas = 0;
            for (const doc of snap.docs) {
                if (Number(doc.data().participantesRelidos || 0) >= 3) continue;
                examinadas++;
            }
            return examinadas;
        };
        expect(await antiga()).toBe(0);   // "0 examinadas" com 2501 esperando
        expect(await antiga()).toBe(0);   // e de novo, para sempre
    });

    it('o pulo é DE GRAÇA: o orçamento só é gasto no trabalho caro', async () => {
        const relidos = new Set<number>();
        for (let i = 1; i <= 3000; i++) relidos.add(i);
        const { q } = firestoreFalso(3010, relidos);
        const r = await rodada(q, 5);
        expect(r.jaTinham).toBe(3000);
        expect(r.examinadas).toBe(5);       // orçamento respeitado…
        expect(r.consumidos).toBe(5);
        expect(r.vistos).toBe(3005);        // …depois de atravessar 3000 pulados
        expect(r.restaram).toBe(5);
    });

    it('o orçamento se confere ANTES de olhar o documento — o não visto não conta em vistos', async () => {
        const { q } = firestoreFalso(7, new Set());
        const r = await rodada(q, 3);
        expect(r.vistos).toBe(3);
        expect(r.esgotou).toBe(false);
        expect(r.restaram).toBe(4);
    });

    it('fila esgotada responde 0 SEM chamar count(); contagem caída responde -1, nunca 0', async () => {
        const semCount = { count: () => { throw new Error('não era para chamar'); } };
        await expect(restaramDaVarredura(semCount, { vistos: 10, esgotou: true })).resolves.toBe(0);

        const { q } = firestoreFalso(50, new Set(), { countFalha: true });
        const r = await rodada(q, 10);
        expect(r.restaram).toBe(-1);
    });

    it('pagina por cursor: várias leituras pequenas, nunca uma só com a fila inteira', async () => {
        const { q, leituras } = firestoreFalso(1200, new Set());
        await varrerComOrcamento(q, { orcamento: 1200, batchSize: 500, aoDoc: async () => true });
        expect(leituras()).toBe(3);   // 500 + 500 + 200 (a última menor que a página = fim)
    });
});

// ─── A ligação: os QUATRO ♻️ do acervo passam pelo dono ──────────────────────
//
// Corrigir só o dos participantes fecharia a INSTÂNCIA (o print de hoje) e
// deixaria a classe viva nos outros três — que têm a MESMA forma e a mesma
// consequência: competência maior que o lote fica com o resto "a reler" para
// sempre, sem nenhuma rodada chegar nele.
describe('🚦 os quatro ♻️ do acervo paginam pelo dono, nenhum corta a fila num limit()', () => {
    const importer = readFileSync(join(__dirname, '..', 'sefaz-backend', 'xml-importer.js'), 'utf8');
    const corpo = (nome: string) => {
        const ini = importer.indexOf(`export async function ${nome}`);
        expect(ini).toBeGreaterThan(0);
        const fim = importer.indexOf('\nexport ', ini + 1);
        return importer.slice(ini, fim > 0 ? fim : undefined);
    };
    const backfills = ['preencherEnderecoParticipantes', 'relerItensFiscais', 'relerNotasVazias', 'relerCabecalhoCtes'];

    it.each(backfills)('%s pagina por cursor com orçamento (varrerComOrcamento)', (nome) => {
        const b = corpo(nome);
        expect(b).toMatch(/varrerComOrcamento\(q, \{/);
        expect(b).toMatch(/restaramDaVarredura\(q, varredura\)/);
    });

    it.each(backfills)('%s NÃO faz `q.limit(...).get()` — o corte que deixava a fila parada', (nome) => {
        // Só o CÓDIGO: a prosa que explica a correção cita a forma antiga.
        const semComentario = corpo(nome).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
        expect(semComentario).not.toMatch(/\.limit\([^)]*\)\.get\(\)/);
        expect(semComentario).not.toMatch(/for \(const docSnap of snap\.docs\)/);
    });

    it('o já-relido é pulado DE GRAÇA (return false) — senão o orçamento acaba antes de chegar no que falta', () => {
        expect(corpo('preencherEnderecoParticipantes'))
            .toMatch(/participantesRelidos \|\| 0\) >= VERSAO_RELEITURA_PARTICIPANTES\) \{ jaTinham\+\+; return false; \}/);
        expect(corpo('relerItensFiscais'))
            .toMatch(/itensRelidos \|\| 0\) >= VERSAO_RELEITURA_ITENS\) \{ jaRelidas\+\+; return false; \}/);
        expect(corpo('relerCabecalhoCtes')).toMatch(/causa === 'ja-relido'\) \{ res\.jaRelidos\+\+; return false; \}/);
    });

    it('o que sobrou vai DITO nos três que não encadeiam sozinhos (restaram na resposta)', () => {
        expect(corpo('relerItensFiscais')).toMatch(/naoPareadasDetalhe, restaram \}/);
        expect(corpo('relerNotasVazias')).toMatch(/res\.restaram = await restaramDaVarredura/);
        expect(corpo('relerCabecalhoCtes')).toMatch(/res\.restaram = await restaramDaVarredura/);
        const tela = readFileSync(join(__dirname, '..', 'components', 'Relatorios', 'index.tsx'), 'utf8');
        expect((tela.match(/fraseDoRestaram\(r\.restaram\)/g) || []).length).toBe(3);
    });
});
