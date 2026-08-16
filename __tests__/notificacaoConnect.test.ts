// ============================================================================
// Notificação de mensagem nova — a ÚLTIMA bloqueante do corte da Ultra Fox.
// Paulo (16/08): "quanto mais notificação melhor, evita desculpa que o
// colaborador não viu". Estes testes protegem o outro lado da moeda: aviso
// repetido ou fora de hora faz a equipe DESLIGAR tudo, e aí o app perde o
// aviso que importa.
// ============================================================================
import {
    avisosDeNovasMensagens, tituloComContador, estadoDaPermissao,
    textoDaPermissao, lerPreferencias, PREFERENCIAS_PADRAO,
} from '../services/notificacaoConnect';

const conversa = (p: Partial<any> = {}) => ({
    numero: '5511964440000', nome: 'Juliana', naoLidas: 1,
    ultimaMensagem: { resumo: 'bom dia', direcao: 'entrada', em: '2026-08-16T12:00:00Z' },
    ...p,
});

describe('o que MERECE aviso', () => {
    it('mensagem nova de ENTRADA apita, com nome e prévia', () => {
        const r = avisosDeNovasMensagens({ conversas: [conversa()], jaAvisados: {} });
        expect(r.avisos).toHaveLength(1);
        expect(r.avisos[0].titulo).toContain('Juliana');
        expect(r.avisos[0].corpo).toBe('bom dia');
    });

    it('a MINHA resposta não vira "mensagem nova"', () => {
        const r = avisosDeNovasMensagens({
            conversas: [conversa({ ultimaMensagem: { resumo: 'já verifico', direcao: 'saida', em: '2026-08-16T12:05:00Z' } })],
            jaAvisados: {},
        });
        expect(r.avisos).toHaveLength(0);
    });

    it('a MESMA mensagem não apita duas vezes — a lista é relida a cada 30s', () => {
        const primeira = avisosDeNovasMensagens({ conversas: [conversa()], jaAvisados: {} });
        expect(primeira.avisos).toHaveLength(1);
        const segunda = avisosDeNovasMensagens({ conversas: [conversa()], jaAvisados: primeira.novoEstado });
        expect(segunda.avisos).toHaveLength(0);
        // mensagem NOVA na mesma conversa volta a apitar
        const terceira = avisosDeNovasMensagens({
            conversas: [conversa({ ultimaMensagem: { resumo: 'e o DAS?', direcao: 'entrada', em: '2026-08-16T12:10:00Z' } })],
            jaAvisados: segunda.novoEstado,
        });
        expect(terceira.avisos).toHaveLength(1);
    });

    it('a PRIMEIRA carga aprende sem apitar — abrir o app e levar 20 pop-ups mata o recurso', () => {
        const r = avisosDeNovasMensagens({ conversas: [conversa(), conversa({ numero: '5511999990000' })], jaAvisados: {}, primeiraCarga: true });
        expect(r.avisos).toHaveLength(0);
        expect(Object.keys(r.novoEstado)).toHaveLength(2);   // aprendeu as duas
        // e a próxima rodada já não apita o que era velho
        expect(avisosDeNovasMensagens({ conversas: [conversa()], jaAvisados: r.novoEstado }).avisos).toHaveLength(0);
    });

    it('conversa ABERTA na tela não apita (a pessoa está lendo)', () => {
        const r = avisosDeNovasMensagens({ conversas: [conversa()], jaAvisados: {}, abertaNumero: '5511964440000' });
        expect(r.avisos).toHaveLength(0);
        // mas o estado é aprendido, senão apitaria ao trocar de conversa
        expect(r.novoEstado['5511964440000']).toBeTruthy();
    });

    it('conversa já LIDA em outro lugar não apita', () => {
        const r = avisosDeNovasMensagens({ conversas: [conversa({ naoLidas: 0 })], jaAvisados: {} });
        expect(r.avisos).toHaveLength(0);
    });
});

describe('título da aba', () => {
    it('leva o contador quando há não lidas — o pop-up some, o título fica', () => {
        expect(tituloComContador(3)).toBe('(3) SP Connect');
        expect(tituloComContador(0)).toBe('SP Connect');
    });
});

describe('permissão do navegador — recusa com CAMINHO', () => {
    it('lê os quatro estados sem pedir nada', () => {
        expect(estadoDaPermissao({ temApi: true, permission: 'granted' })).toBe('concedida');
        expect(estadoDaPermissao({ temApi: true, permission: 'denied' })).toBe('negada');
        expect(estadoDaPermissao({ temApi: true, permission: 'default' })).toBe('nao-pedida');
        expect(estadoDaPermissao({ temApi: false })).toBe('sem-suporte');
    });

    it('bloqueado diz ONDE reverter — senão a pessoa acha que o app não avisa', () => {
        const t = textoDaPermissao('negada');
        expect(t.texto).toContain('BLOQUEOU');
        expect(t.acao).toContain('cadeado');
    });

    it('sem suporte não mente: o SOM continua valendo', () => {
        expect(textoDaPermissao('sem-suporte').acao).toContain('som');
        expect(textoDaPermissao('concedida').acao).toBeNull();
    });
});

describe('preferências', () => {
    it('som, pop-up e push nascem LIGADOS (a decisão do Paulo)', () => {
        expect(PREFERENCIAS_PADRAO).toMatchObject({ som: true, popup: true, push: true });
    });

    it('push FORA do expediente nasce desligado — celular apitando de madrugada faz desligar TUDO', () => {
        expect(PREFERENCIAS_PADRAO.pushForaDoExpediente).toBe(false);
    });

    it('o que estiver gravado vence; o que faltar cai no padrão', () => {
        expect(lerPreferencias({ som: false })).toMatchObject({ som: false, popup: true, push: true });
        expect(lerPreferencias(null)).toEqual(PREFERENCIAS_PADRAO);
        expect(lerPreferencias('lixo')).toEqual(PREFERENCIAS_PADRAO);
    });
});
