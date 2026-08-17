/**
 * Sonda de chamada de voz/vídeo (Calling API da Meta).
 *
 * O que precisa ficar travado aqui é UMA coisa acima de todas:
 * **indeterminado nunca vira "desligado"**. Se a rede piscar ou o token não
 * alcançar, e o app responder "a chamada está desligada", alguém vai ligar à
 * mão um recurso que talvez já estivesse ligado — ou concluir que a conta não
 * tem algo que ela tem. É a mesma régua da sonda do Gemini (falha devolve
 * null, nunca false) e do farol honesto: ausência de resposta não é resposta.
 */
import {
    interpretarSondaChamadas, concluirSonda, acharBlocoDeChamada,
    CANDIDATOS_SONDA, ANTES_DE_LIGAR,
} from '../sefaz-backend/whatsapp-chamadas';

describe('interpretarSondaChamadas', () => {
    it('a Meta dizendo ENABLED é LIGADO, e a resposta diz em qual campo', () => {
        const r = interpretarSondaChamadas(200, { calling: { status: 'ENABLED' } });
        expect(r.situacao).toBe('ligado');
        expect(r.campo).toBe('calling');
        expect(r.motivo).toContain('LIGADA');
    });

    it('DISABLED é desligado', () => {
        expect(interpretarSondaChamadas(200, { calling: { status: 'DISABLED' } }).situacao).toBe('desligado');
    });

    it('acha o bloco mesmo aninhado (a forma da resposta não é contrato nosso)', () => {
        const r = interpretarSondaChamadas(200, { data: [{ settings: { calling: { status: 'ENABLED' } } }] });
        expect(r.situacao).toBe('ligado');
        expect(r.campo).toContain('calling');
    });

    it('🚨 erro de rede é INDETERMINADO, nunca "desligado"', () => {
        expect(interpretarSondaChamadas(null, null).situacao).toBe('indeterminado');
        expect(interpretarSondaChamadas(500, { error: { message: 'oops' } }).situacao).toBe('indeterminado');
    });

    it('🚨 token sem permissão é SEM-PERMISSAO — e a resposta DIZ que isso não fala da chamada', () => {
        const r = interpretarSondaChamadas(403, { error: { message: 'permissão faltando' } });
        expect(r.situacao).toBe('sem-permissao');
        expect(r.acao).toMatch(/não diz nada sobre a chamada/i);
    });

    it('respondeu sem campo de chamada é NAO-DECLARADO (e leva o cru junto)', () => {
        const r = interpretarSondaChamadas(200, { id: '123', display_phone_number: '+55 11 3337-1554' });
        expect(r.situacao).toBe('nao-declarado');
        expect(r.bruto).toEqual({ id: '123', display_phone_number: '+55 11 3337-1554' });
    });

    it('bloco de chamada em formato desconhecido NÃO é chutado — vira nao-reconhecido com o cru', () => {
        const r = interpretarSondaChamadas(200, { calling: { modo: 'algo_novo_da_meta' } });
        expect(r.situacao).toBe('nao-reconhecido');
        expect(r.bruto).toBeTruthy();
        expect(r.acao).toMatch(/crua/i);
    });

    it('a busca do bloco não confunde palavra parecida (callback não é calling)', () => {
        expect(acharBlocoDeChamada({ callback_url: 'x', calling: { status: 'ENABLED' } }))
            .toEqual([{ caminho: 'calling', valor: { status: 'ENABLED' } }]);
    });
});

describe('concluirSonda', () => {
    it('resposta afirmativa manda, mesmo com outro caminho mudo', () => {
        const c = concluirSonda([
            { situacao: 'nao-declarado', motivo: 'x' },
            { situacao: 'ligado', motivo: 'A Meta diz que a chamada está LIGADA (calling).' },
        ]);
        expect(c.veredito).toBe('ligado');
    });

    it('🚨 nenhum caminho conclusivo NÃO vira desligado', () => {
        expect(concluirSonda([]).veredito).toBe('indeterminado');
        expect(concluirSonda([{ situacao: 'indeterminado', motivo: 'x' }]).veredito).toBe('indeterminado');
    });

    it('todos respondendo sem campo de chamada vira nao-declarado, com a ação de conferir na Meta', () => {
        const c = concluirSonda([
            { situacao: 'nao-declarado', motivo: 'a' },
            { situacao: 'nao-declarado', motivo: 'b' },
        ]);
        expect(c.veredito).toBe('nao-declarado');
        expect(c.acao).toMatch(/Gerenciador de WhatsApp/i);
    });

    it('formato desconhecido vence "não declarado" — é ele que tem informação nova', () => {
        const c = concluirSonda([
            { situacao: 'nao-declarado', motivo: 'a' },
            { situacao: 'nao-reconhecido', motivo: 'veio bloco estranho', acao: 'olhe o cru' },
        ]);
        expect(c.veredito).toBe('nao-reconhecido');
    });
});

describe('a decisão vai junto da sonda', () => {
    it('o app avisa o que acontece ANTES de ligar — inclusive o efeito no cliente', () => {
        const texto = JSON.stringify(ANTES_DE_LIGAR);
        expect(ANTES_DE_LIGAR.length).toBeGreaterThanOrEqual(3);
        // Ligar abre uma porta no WhatsApp do CLIENTE; e chamada sem quem
        // atenda é lida como "a SP não me atende", não como recurso desligado.
        expect(texto).toMatch(/cliente/i);
        expect(texto).toMatch(/atend/i);
    });

    it('os candidatos levam a HIPÓTESE escrita — sonda sem hipótese é chute com log', () => {
        expect(CANDIDATOS_SONDA.length).toBeGreaterThanOrEqual(2);
        CANDIDATOS_SONDA.forEach((c) => {
            expect(c.hipotese.length).toBeGreaterThan(20);
            expect(c.caminho('123456')).toContain('123456');
        });
    });
});

describe('🚨 a sonda NÃO liga nada', () => {
    it('o módulo não tem nenhuma escrita na Meta (POST/DELETE) nem no banco', () => {
        // Mesma prova do `/prazos-municipais/consultar`: o handler que CONSULTA
        // não pode escrever. Aqui o custo de escrever por engano é abrir a
        // chamada no WhatsApp de todos os clientes sem ninguém decidir.
        const fonte = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'sefaz-backend/whatsapp-chamadas.js'), 'utf8');
        expect(fonte).not.toMatch(/method:\s*['"](POST|DELETE|PUT|PATCH)['"]/);
        expect(fonte).not.toMatch(/\.set\(|\.update\(|\.doc\(/);
    });
});
