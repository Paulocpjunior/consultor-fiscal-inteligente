// ============================================================================
// Notificação de mensagem nova — a ÚLTIMA bloqueante do corte da Ultra Fox.
// Paulo (16/08): "quanto mais notificação melhor, evita desculpa que o
// colaborador não viu". Estes testes protegem o outro lado da moeda: aviso
// repetido ou fora de hora faz a equipe DESLIGAR tudo, e aí o app perde o
// aviso que importa.
// ============================================================================
import {
    avisosDeNovasMensagens, tituloComContador, estadoDaPermissao,
    textoDaPermissao, lerPreferencias, PREFERENCIAS_PADRAO, faltaNosAvisos,
} from '../services/notificacaoConnect';
import { readFileSync } from 'fs';
import { join } from 'path';

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

    it('dentro do Teams NÃO fala em cadeado — lá não existe barra de endereço (Paulo, 21/08)', () => {
        const negada = textoDaPermissao('negada', true);
        expect(negada.texto).toContain('Teams');
        expect(negada.acao).not.toContain('cadeado');
        expect(negada.acao).toMatch(/som/i);        // o que FUNCIONA lá fica dito
        expect(negada.acao).toMatch(/navegador/i);  // e o caminho do pop-up também
        const pendente = textoDaPermissao('nao-pedida', true);
        expect(pendente.acao).not.toContain('o navegador vai perguntar');
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

// ============================================================================
// 🚨 MATA-BURRO: A AÇÃO NÃO PODE SUMIR JUNTO COM O ALERTA.
//
// Defeito real, achado num print do Paulo em 17/08. A barra de avisos só
// olhava PERMISSÃO e SOM. Com os dois ligados ela sumia da tela — e o botão
// "📱 Avisar também no celular" morava DENTRO dela. Resultado: a terceira
// camada (o push, que é a que avisa com o app FECHADO) não tinha como ser
// ligada, e nada na tela dizia por quê.
//
// É a mesma família do "cadastro que apaga um alerta tem que ENTREGAR o que o
// alerta cobrava" (15/08): alerta que some sem a entrega parece progresso e é
// regressão. Aqui era pior — sumia o caminho, não só o aviso.
// ============================================================================

describe('🚨 faltaNosAvisos — as TRÊS camadas numa pergunta só', () => {
    const base = { permissao: 'concedida' as const, somOk: true, pushDisponivel: true, pushLigado: true };

    it('tudo ligado = barra some (nada de ruído fixo na tela)', () => {
        const r = faltaNosAvisos(base);
        expect(r.falta).toBe(false);
        expect(r.oferecerPush).toBe(false);
    });

    it('🚨 som e pop-up ligados, PUSH desligado ⇒ a barra APARECE e oferece o push', () => {
        // Era exatamente este caso que sumia da tela.
        const r = faltaNosAvisos({ ...base, pushLigado: false });
        expect(r.falta).toBe(true);
        expect(r.oferecerPush).toBe(true);
        expect(r.texto).toMatch(/CELULAR/i);
        expect(r.texto).toMatch(/app fechado/i);
    });

    it('🚨 e a frase NÃO diz "avisos ligados" quando falta o celular', () => {
        // "Avisos ligados" com o push desligado mente por omissão — a pessoa
        // fecha a aba confiando num aviso que não vai chegar.
        const r = faltaNosAvisos({ ...base, pushLigado: false });
        expect(r.texto).not.toMatch(/^🔔 Avisos ligados neste navegador\.$/);
    });

    it('permissão pendente manda sobre o resto — é ela que impede o pop-up', () => {
        const r = faltaNosAvisos({ ...base, permissao: 'nao-pedida', pushLigado: false });
        expect(r.falta).toBe(true);
        expect(r.oferecerPush).toBe(false);   // primeiro a permissão, senão são dois botões concorrendo
        expect(r.acao).toMatch(/Ligar avisos/i);
    });

    it('permissão NEGADA leva o caminho de reverter (o "não" fica guardado)', () => {
        const r = faltaNosAvisos({ ...base, permissao: 'negada' });
        expect(r.falta).toBe(true);
        expect(r.acao).toMatch(/cadeado/i);
    });

    it('permissão NEGADA dentro do Teams troca o conselho (não há cadeado lá)', () => {
        const r = faltaNosAvisos({ ...base, permissao: 'negada', emIframe: true });
        expect(r.falta).toBe(true);
        expect(r.acao).not.toMatch(/cadeado/i);
        expect(r.texto).toContain('Teams');
    });

    it('som pendente aparece — e o botão do push CONTINUA sendo oferecido', () => {
        // Camadas independentes: esconder uma atrás da outra foi o defeito.
        const r = faltaNosAvisos({ ...base, somOk: false, pushLigado: false });
        expect(r.texto).toMatch(/SOM/);
        expect(r.oferecerPush).toBe(true);
    });

    it('push INDISPONÍVEL (sem a chave VAPID) não vira pendência eterna na tela', () => {
        // Sem a chave publicada não há o que a pessoa possa fazer — cobrar
        // seria alarme sem ação, que é o que ensina a ignorar alarme.
        const r = faltaNosAvisos({ ...base, pushDisponivel: false, pushLigado: false });
        expect(r.falta).toBe(false);
        expect(r.oferecerPush).toBe(false);
    });
});

describe('🚨 a tela usa o núcleo, e o botão do push não volta pra dentro da condição antiga', () => {
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');

    it('a barra é decidida por faltaNosAvisos, não por uma condição escrita na tela', () => {
        expect(tela).toMatch(/faltaNosAvisos\(\{/);
        expect(tela).toMatch(/avisoDoTopo\.falta\s*&&/);
        // A condição antiga (só permissão + som) não pode reaparecer.
        expect(tela).not.toMatch(/\(permissaoAviso !== 'concedida' \|\| !somOk\) && \(/);
    });

    it('o botão do push é oferecido pelo núcleo (oferecerPush), não por condição local', () => {
        expect(tela).toMatch(/avisoDoTopo\.oferecerPush\s*&&/);
    });
});
