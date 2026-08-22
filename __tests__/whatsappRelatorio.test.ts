// ============================================================================
// 📈 Relatório de atendimento (item 3 de 21/08 — o último 🔴 do de-para).
// A conta é PURA; a régua que manda: bot NÃO é resposta humana, e conversa
// sem resposta sai CONTADA, nunca dissolvida na média.
// ============================================================================
// @ts-nocheck
import { montarRelatorioAtendimento } from '../sefaz-backend/whatsapp-relatorio.js';

const iso = (min) => new Date(Date.parse('2026-08-21T12:00:00Z') + min * 60000).toISOString();
const ent = (num, min) => ({ conversaId: num, direcao: 'entrada', timestamp: iso(min) });
const hum = (num, min, quem = 'ana@sp.com.br') => ({ conversaId: num, direcao: 'saida', timestamp: iso(min), enviadoPor: quem });
const bot = (num, min) => ({ conversaId: num, direcao: 'saida', timestamp: iso(min), enviadoPor: 'bot' });

describe('montarRelatorioAtendimento', () => {
    it('1ª resposta é a HUMANA — o menu do bot no meio não fecha a espera', () => {
        const r = montarRelatorioAtendimento({
            mensagens: [ent('551', 0), bot('551', 1), hum('551', 10)],
            filaPorConversa: new Map([['551', 'fiscal']]),
        });
        expect(r.porFila[0].fila).toBe('fiscal');
        expect(r.porFila[0].tempoMedio1aRespostaMin).toBe(10);
        expect(r.porFila[0].enviadasBot).toBe(1);
        expect(r.enviadasHumanas).toBe(1);
    });

    it('🚨 enviadoPor "bot" é truthy e NÃO pode contar como humano', () => {
        const r = montarRelatorioAtendimento({
            mensagens: [ent('551', 0), bot('551', 1)],
            filaPorConversa: new Map(),
        });
        expect(r.enviadasHumanas).toBe(0);
        expect(r.semRespostaHumana).toBe(1);   // o bot respondeu; gente, não
    });

    it('conversa sem resposta humana sai CONTADA — e não zera nem dissolve a média das outras', () => {
        const r = montarRelatorioAtendimento({
            mensagens: [ent('551', 0), hum('551', 20), ent('552', 0)],
            filaPorConversa: new Map([['551', 'fiscal'], ['552', 'fiscal']]),
        });
        const f = r.porFila[0];
        expect(f.respondidas).toBe(1);
        expect(f.semRespostaHumana).toBe(1);
        expect(f.tempoMedio1aRespostaMin).toBe(20);   // média SÓ das respondidas
    });

    it('nota interna fica fora de tudo; conversa sem fila cai em recepcao; atendentes contados', () => {
        const r = montarRelatorioAtendimento({
            mensagens: [
                ent('553', 0), { conversaId: '553', direcao: 'interna', timestamp: iso(1), enviadoPor: 'ana@sp.com.br' },
                hum('553', 5, 'ana@sp.com.br'), hum('553', 6, 'ana@sp.com.br'),
            ],
            filaPorConversa: new Map(),
        });
        expect(r.porFila[0].fila).toBe('recepcao');
        expect(r.porAtendente).toEqual([{ atendente: 'ana@sp.com.br', enviadas: 2, conversas: 1 }]);
    });

    it('segunda pergunta do cliente REABRE a espera — respondida uma vez não é respondida pra sempre', () => {
        const r = montarRelatorioAtendimento({
            mensagens: [ent('554', 0), hum('554', 2), ent('554', 10)],
            filaPorConversa: new Map(),
        });
        // A conversa conta como respondida (teve 1ª resposta) — a espera nova
        // aberta no fim do período não a transforma em sem-resposta.
        expect(r.porFila[0].respondidas).toBe(1);
        expect(r.porFila[0].tempoMedio1aRespostaMin).toBe(2);
    });
});
