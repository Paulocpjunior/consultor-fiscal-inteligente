// ============================================================================
// 🚨 A MENSAGEM NOVA NÃO APARECIA NA CONVERSA ABERTA (Paulo, 24/08)
// ----------------------------------------------------------------------------
// "Ivan mandou uma msg para o Matheus — Legalização, porém ele está na conversa
// ABERTA do Ivan e não aparece a mensagem que ele escreveu! Só consegue ver em
// notificação quando sobe a msg."
//
// A causa não era o refresh: era `limit(500)` SEM `orderBy`. Sem ordenação o
// Firestore devolve na ordem do ID DO DOCUMENTO — e aqui o id é o wamid da
// Meta, que NÃO é cronológico. Em conversa longa (as importadas da Ultra Fox
// têm centenas), as 500 que voltavam eram uma fatia arbitrária, e a mensagem
// recém-chegada podia cair fora dela PARA SEMPRE. O aviso (push/Teams) vinha
// do webhook, por isso ele aparecia e a thread não — duas leituras do mesmo
// fato discordando, que é o defeito que esta casa mais paga.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';

const rotas = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');
// ⚠️ TRAVA TROCADA PELA INTENÇÃO (24/08, no mesmo dia): ela prendia o TEXTO
// `.limit(500)`, e o 500 virou a constante `PAGINA` quando a thread ganhou
// paginação. Teste que trava a FORMA reprova a correção seguinte — o que ele
// existe para garantir é que a consulta ORDENE ANTES DE CORTAR, não com qual
// número ela corta. (A régua da paginação tem trava própria em
// threadCarregarAntigas.test.ts.)
const trecho = rotas.slice(
    rotas.indexOf("router.get('/conversas/:numero/mensagens'"),
    rotas.indexOf('// ─── INICIAR CONVERSA'),
);

describe('thread da conversa devolve as MAIS RECENTES', () => {
    it('a consulta ordena por timestamp desc antes de cortar', () => {
        expect(trecho).toMatch(/orderBy\('timestamp', 'desc'\)\.limit\(/);
    });

    it('NÃO existe mais o corte cru sem ordenação como caminho principal', () => {
        // O `limit(500)` solto só pode aparecer no FALLBACK (dentro do catch).
        const antesDoCatch = trecho.slice(0, trecho.indexOf('catch'));
        expect(antesDoCatch).not.toMatch(/\.where\('conversaId', '==', numero\)\.limit\(500\)/);
    });

    it('índice ainda construindo NÃO derruba a thread — cai na fatia antiga', () => {
        expect(trecho).toMatch(/if \(!\/index\/i\.test/);
        expect(trecho).toMatch(/snap = await colecao\.limit\(PAGINA\)\.get\(\)/);
    });
});

describe('o índice composto entra no MESMO PR', () => {
    // Trava escrita pela regra da casa: consulta nova que exige índice sem o
    // índice declarado é erro que só aparece em produção.
    const indices = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firestore.indexes.json'), 'utf8'));
    it('conversaId ASC + timestamp DESC está declarado', () => {
        const achou = indices.indexes.some((i: any) => i.collectionGroup === 'whatsapp_mensagens'
            && i.fields?.[0]?.fieldPath === 'conversaId' && i.fields?.[0]?.order === 'ASCENDING'
            && i.fields?.[1]?.fieldPath === 'timestamp' && i.fields?.[1]?.order === 'DESCENDING');
        expect(achou).toBe(true);
    });
});
