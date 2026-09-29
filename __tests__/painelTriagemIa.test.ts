// ============================================================================
// 📊 O PAINEL DA IA DE TRIAGEM (28/09) — "a IA está pegando?" com número
//
// Paulo (27/09): "a IA está ativa?". A resposta era "ligada, mas não sei se
// está trabalhando": cada decisão só ia para o console.log. Agora cada decisão
// vira um registro — inclusive as que NÃO classificaram — e a aba 🤖 soma.
//
// O que se prova: o registro (forma, texto cortado, situação sempre válida),
// a soma (janela por `agora` injetado, contadores, taxa null sem chamada,
// filas, motivos de indisponibilidade, últimas em ordem) e a fiação (a rota
// grava em TODOS os desfechos, inclusive sem cliente Gemini e no catch).
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import {
    registroDeTriagem, resumirTriagemIa, SITUACOES_TRIAGEM, COLECAO_TRIAGEM_IA_LOG,
} from '../sefaz-backend/whatsapp-triagem-ia.js';

const ler = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const AGORA = new Date('2026-09-28T15:00:00Z');
const ha = (horas: number) => new Date(AGORA.getTime() - horas * 3600_000).toISOString();

describe('registroDeTriagem — o que se grava por decisão', () => {
    it('classificada: fila, confiança, motivo; o texto do cliente entra CORTADO em 80', () => {
        const r = registroDeTriagem({
            numero: '5511999990000', texto: '  preciso   da segunda via do DAS de agosto ' + 'x'.repeat(200),
            destino: { situacao: 'classificada', fila: 'fiscal', rotulo: 'Fiscal', confianca: 0.91, motivo: 'segunda via de guia' },
            modelo: 'gemini-flash', agora: AGORA,
        });
        expect(r).toMatchObject({ em: AGORA.toISOString(), numero: '5511999990000', situacao: 'classificada', fila: 'fiscal', rotulo: 'Fiscal', confianca: 0.91, motivo: 'segunda via de guia', modelo: 'gemini-flash' });
        expect(r.textoResumo.length).toBe(80);
        expect(r.textoResumo.startsWith('preciso da segunda via')).toBe(true);
        // Firestore recusa undefined: todo campo tem valor.
        expect(Object.values(r).every((v) => v !== undefined)).toBe(true);
    });

    it('sem-certeza guarda a fila que a IA SUGERIA; situação desconhecida vira nao-entendi; ia-indisponivel leva o detalhe', () => {
        expect(registroDeTriagem({ numero: '1', texto: 'x', destino: { situacao: 'sem-certeza', sugeria: 'contabil', confianca: 0.4 }, agora: AGORA }))
            .toMatchObject({ situacao: 'sem-certeza', fila: 'contabil', confianca: 0.4 });
        expect(registroDeTriagem({ numero: '1', texto: 'x', destino: { situacao: 'algo-novo' }, agora: AGORA }).situacao).toBe('nao-entendi');
        expect(registroDeTriagem({ numero: '1', texto: 'x', destino: { situacao: 'ia-indisponivel', detalhe: 'tempo esgotado' }, agora: AGORA }))
            .toMatchObject({ situacao: 'ia-indisponivel', detalhe: 'tempo esgotado', fila: null });
        expect(registroDeTriagem({ numero: null, texto: null, destino: null, agora: AGORA })).toMatchObject({ numero: '', textoResumo: '', situacao: 'nao-entendi' });
    });
});

describe('resumirTriagemIa — a soma, com o relógio injetado', () => {
    const regs = [
        { em: ha(1), situacao: 'classificada', fila: 'fiscal', confianca: 0.9 },
        { em: ha(2), situacao: 'classificada', fila: 'fiscal', confianca: 0.8 },
        { em: ha(3), situacao: 'classificada', fila: 'contabil', confianca: 0.95 },
        { em: ha(5), situacao: 'sem-certeza', fila: 'dp-folha', confianca: 0.5 },
        { em: ha(6), situacao: 'nao-entendi' },
        { em: ha(7), situacao: 'ia-indisponivel', detalhe: 'tempo esgotado' },
        { em: ha(8), situacao: 'ia-indisponivel', detalhe: 'tempo esgotado' },
        { em: ha(9), situacao: 'fila-inexistente', detalhe: 'juridico2' },
        { em: ha(24 * 8), situacao: 'classificada', fila: 'rh' },       // fora da janela de 7 dias
        { em: 'lixo', situacao: 'classificada' },                         // sem data legível: fora
    ];

    it('conta por situação só na janela, calcula a taxa, ordena filas e motivos, e as últimas vêm da mais nova', () => {
        const r = resumirTriagemIa(regs, { agora: AGORA, dias: 7, ultimas: 3 });
        expect(r.total).toBe(8);
        expect(r.contadores).toEqual({ classificada: 3, 'sem-certeza': 1, 'nao-entendi': 1, 'fila-inexistente': 1, 'ia-indisponivel': 2 });
        expect(r.taxaClassificada).toBe(38);
        expect(r.filas).toEqual([{ fila: 'fiscal', quantidade: 2 }, { fila: 'contabil', quantidade: 1 }]);
        expect(r.motivosIndisponivel).toEqual([{ motivo: 'tempo esgotado', quantidade: 2 }]);
        expect(r.ultimaEm).toBe(ha(1));
        expect(r.ultimas.map((u) => u.em)).toEqual([ha(1), ha(2), ha(3)]);
        expect(r.desde).toBe(ha(24 * 7));
    });

    it('sem registro nenhum: total 0, taxa NULL (não 0%), contadores zerados — zero nunca é "tudo certo"', () => {
        const r = resumirTriagemIa([], { agora: AGORA });
        expect(r.total).toBe(0);
        expect(r.taxaClassificada).toBeNull();
        expect(r.ultimaEm).toBeNull();
        expect(Object.keys(r.contadores).sort()).toEqual([...SITUACOES_TRIAGEM].sort());
        expect(resumirTriagemIa(null as any, { agora: AGORA }).total).toBe(0);
    });

    it('a janela obedece `dias` — 30 dias pega o registro de 8 dias atrás', () => {
        expect(resumirTriagemIa(regs, { agora: AGORA, dias: 30 }).contadores.classificada).toBe(4);
    });
});

describe('fiação: a rota grava em TODO desfecho, o painel lê, a tela mostra', () => {
    const webhook = ler('sefaz-backend/whatsapp-webhook-routes.js');
    const rotas = ler('sefaz-backend/whatsapp-routes.js');
    const tela = ler('components/SpConnect/index.tsx');
    const catalogo = ler('sefaz-backend/catalogo-banco.js');

    it('triarComIa registra a decisão, a falta do cliente Gemini e o catch — e recebe db + número', () => {
        const fn = webhook.slice(webhook.indexOf('async function triarComIa'), webhook.indexOf('const TEMPO_MAX_TRIAGEM_MS'));
        expect(fn).toMatch(/await registrarTriagem\(db, \{ numero, texto, destino, modelo/);
        expect(fn).toMatch(/situacao: 'ia-indisponivel', detalhe: 'sem cliente Gemini/);
        expect(fn).toMatch(/situacao: 'ia-indisponivel', detalhe: e\.message/);
        expect(webhook).toMatch(/triarComIa\(\{ app: deps\.app, config, texto: msg\.texto, db, numero: msg\.de \}\)/);
        // O registro NUNCA lança (best-effort): falha dele não cala o bot.
        expect(webhook).toMatch(/registro não gravado/);
        expect(webhook).toMatch(new RegExp(`collection\\(COLECAO_TRIAGEM_IA_LOG\\)\\.add\\(registroDeTriagem`));
    });

    it('a rota do painel é de admin, lê a janela e soma pelo núcleo; a coleção tem dono no catálogo', () => {
        const rota = rotas.slice(rotas.indexOf("router.get('/triagem-ia/painel'"), rotas.indexOf("router.post('/atendimento-config'"));
        expect(rota).toMatch(/requireAdmin/);
        expect(rota).toMatch(/resumirTriagemIa\(registros, \{ agora, dias \}\)/);
        expect(rota).toMatch(/truncado: snap\.size >= 500/);
        expect(catalogo).toContain(`colecao: '${COLECAO_TRIAGEM_IA_LOG}'`);
    });

    it('a aba 🤖 mostra os cinco contadores, diz o que ZERO significa e lista as últimas', () => {
        for (const s of SITUACOES_TRIAGEM) expect(tela).toContain(`['${s}', `);
        expect(tela).toMatch(/Não\s+significa que ela acertou tudo/);
        expect(tela).toMatch(/painelIa\.ultimas\.map/);
        expect(tela).toMatch(/painelTriagemIa\(dias\)/);
    });
});
