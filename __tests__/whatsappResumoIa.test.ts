// ============================================================================
// 📝 RESUMO DA CONVERSA POR IA (29/09) — item 3 da comparação com o Clerk
// Chat. A IA lê e resume para quem assume; não responde ao cliente, não
// aplica etiqueta. O que se prova: a fatia que vai ao modelo (sem nota
// interna), o prompt, a leitura tolerante do JSON e a fiação (rota, tela,
// "desatualizado" quando chega mensagem depois).
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    selecionarMensagensParaResumo, montarPromptResumo, interpretarResumo, estadoDoResumo,
    MAX_MENSAGENS_RESUMO, MAX_CHARS_RESUMO,
} from '../sefaz-backend/whatsapp-resumo-ia.js';

const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');

describe('selecionarMensagensParaResumo — só o que o cliente viu, em ordem, cortado', () => {
    it('nota interna e transferência ficam de fora; mídia vira rótulo; ordem cronológica; teto', () => {
        const msgs = [
            { direcao: 'saida', tipo: 'text', texto: 'Segue a guia', timestamp: '2026-09-29T12:05:00.000Z' },
            { direcao: 'interna', tipo: 'nota', texto: 'cliente chato', timestamp: '2026-09-29T12:03:00.000Z' },
            { direcao: 'entrada', tipo: 'text', texto: 'Preciso do DAS', timestamp: '2026-09-29T12:00:00.000Z' },
            { direcao: 'entrada', tipo: 'image', texto: '', timestamp: '2026-09-29T12:01:00.000Z' },
            { direcao: 'entrada', tipo: 'text', texto: 'sem data', timestamp: null },
        ];
        const r = selecionarMensagensParaResumo(msgs);
        expect(r).toEqual([
            { quem: 'cliente', quando: '2026-09-29 12:00', texto: 'Preciso do DAS' },
            { quem: 'cliente', quando: '2026-09-29 12:01', texto: '[imagem]' },
            { quem: 'SP', quando: '2026-09-29 12:05', texto: 'Segue a guia' },
        ]);
        const muitas = Array.from({ length: MAX_MENSAGENS_RESUMO + 10 }, (_, i) => ({ direcao: 'entrada', tipo: 'text', texto: `m${i}`, timestamp: `2026-09-${String(1 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00.000Z` }));
        const cortadas = selecionarMensagensParaResumo(muitas);
        expect(cortadas).toHaveLength(MAX_MENSAGENS_RESUMO);
        expect(cortadas[cortadas.length - 1]!.texto).toBe(`m${MAX_MENSAGENS_RESUMO + 9}`);   // as ÚLTIMAS, não as primeiras
    });
});

describe('montarPromptResumo — pede JSON, proíbe inventar e orientar', () => {
    it('leva cliente/empresa e as mensagens rotuladas; pede resumo/pendencias/assuntos/tom', () => {
        const p = montarPromptResumo({ mensagens: [{ quem: 'cliente', quando: '2026-09-29 12:00', texto: 'Preciso do DAS' }], nomeCliente: 'Ana', empresaNome: 'HYPE' });
        expect(p).toMatch(/Cliente: Ana · Empresa: HYPE/);
        expect(p).toMatch(/\[2026-09-29 12:00\] cliente: Preciso do DAS/);
        for (const k of ['"resumo"', '"pendencias"', '"assuntos"', '"tom"']) expect(p).toContain(k);
        expect(p).toMatch(/Não invente fato/);
        expect(p).toMatch(/Não dê orientação fiscal/);
    });
});

describe('interpretarResumo — lê o JSON do modelo, com cerca ou sem, e recusa nomeado', () => {
    it('JSON limpo, JSON em ```json```, JSON com texto em volta', () => {
        const j = '{"resumo":"O cliente pediu o DAS de setembro. A SP enviou a guia.","pendencias":["confirmar pagamento"],"assuntos":["DAS"],"tom":"ok"}';
        for (const bruto of [j, '```json\n' + j + '\n```', 'Aqui está:\n' + j + '\nEspero ter ajudado']) {
            const r = interpretarResumo(bruto);
            expect(r.ok).toBe(true);
            if (r.ok) expect(r.resumo).toEqual({ texto: 'O cliente pediu o DAS de setembro. A SP enviou a guia.', pendencias: ['confirmar pagamento'], assuntos: ['DAS'], tom: 'ok' });
        }
    });

    it('tom só aceita ok/atencao; listas cortadas no teto; resumo cortado; vazio/ilegível recusam', () => {
        const r = interpretarResumo(JSON.stringify({ resumo: 'x'.repeat(MAX_CHARS_RESUMO + 50), pendencias: [1, 2, 3, 4, 5, 6, 7], assuntos: ['a', 'b', 'c', 'd', 'e'], tom: 'grave' }));
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.resumo.texto).toHaveLength(MAX_CHARS_RESUMO);
            expect(r.resumo.pendencias).toHaveLength(5);
            expect(r.resumo.assuntos).toHaveLength(4);
            expect(r.resumo.tom).toBe('ok');
        }
        expect(interpretarResumo('')).toEqual({ ok: false, motivo: 'resposta vazia' });
        expect(interpretarResumo('não consigo')).toEqual({ ok: false, motivo: 'sem JSON na resposta' });
        expect(interpretarResumo('{"resumo": }')).toEqual({ ok: false, motivo: 'JSON ilegível' });
        expect(interpretarResumo('{"pendencias": []}')).toEqual({ ok: false, motivo: 'resumo vazio' });
    });
});

describe('estadoDoResumo — mensagem depois do resumo torna ele "desatualizado"', () => {
    it('nenhum / atual / desatualizado', () => {
        expect(estadoDoResumo({})).toBe('nenhum');
        expect(estadoDoResumo({ resumoIa: { texto: 'x', ateMensagemEm: '2026-09-29T12:00:00Z' }, ultimaMensagem: { em: '2026-09-29T12:00:00Z' } })).toBe('atual');
        expect(estadoDoResumo({ resumoIa: { texto: 'x', ateMensagemEm: '2026-09-29T12:00:00Z' }, ultimaMensagem: { em: '2026-09-29T13:00:00Z' } })).toBe('desatualizado');
        expect(estadoDoResumo({ resumoIa: { texto: 'x', ateMensagemEm: null }, ultimaMensagem: { em: '2026-09-29T13:00:00Z' } })).toBe('desatualizado');
    });
});

describe('🚨 fiação — a IA resume, não atende', () => {
    const rotas = ler('sefaz-backend/whatsapp-routes.js');
    const tela = ler('components/SpConnect/index.tsx');

    it('a rota lê a conversa pela MESMA régua de visibilidade, usa o cliente Gemini do app com prazo, e grava em conversa.resumoIa', () => {
        const rota = rotas.slice(rotas.indexOf("router.post('/conversas/:numero/resumo'"), rotas.indexOf('export default router'));
        expect(rota).toMatch(/podeVerConversa\(db, req\.user, numero\)/);
        expect(rota).toMatch(/req\.app\?\.get\?\.\('ai'\)/);
        expect(rota).toMatch(/selecionarMensagensParaResumo\(/);
        expect(rota).toMatch(/TEMPO_MAX_RESUMO_MS/);
        expect(rota).toMatch(/set\(\{ resumoIa \}, \{ merge: true \}\)/);
        // Sem IA no servidor a resposta é nomeada, não um 500 genérico.
        expect(rota).toMatch(/GEMINI_API_KEY\?/);
        // E ela NÃO manda nada ao cliente.
        expect(rota).not.toMatch(/enviarTextoLivre/);
        // A lista de conversas carrega o resumo (é onde o painel lê).
        expect(rotas).toMatch(/resumoIa: x\.resumoIa \|\| null/);
    });

    it('a tela: bloco 📝 no painel, botão Resumir/Atualizar, aviso de desatualizado, tom de atenção', () => {
        expect(tela).toMatch(/onClick=\{acaoResumir\}/);
        expect(tela).toMatch(/Chegou mensagem depois deste resumo/);
        expect(tela).toMatch(/sel\.resumoIa\.tom === 'atencao'/);
        expect(tela).toMatch(/a IA só lê, não responde/);
    });
});
