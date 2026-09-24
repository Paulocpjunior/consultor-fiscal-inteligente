// ============================================================================
// 🔔 AVISOS — "NÃO ESTAMOS RECEBENDO NOTIFICAÇÃO" (Paulo, 24/09)
//
// *"como ativar de forma mais extravagante possível e habilitar de todas as
// formas… olhei em configurações e não achei o campo"*.
//
// Eram QUATRO camadas com donos diferentes (som e pop-up no navegador, celular
// no FCM, sino no Teams) e nenhuma tela as mostrava JUNTAS. Pior: a régua de
// audiência (`vetoDoAviso`) já sabia POR QUE cada pessoa ficava de fora — e o
// fan-out jogava isso no console. Silêncio sem motivo é o que faz a equipe
// concluir "o app não avisa".
//
// A entrega: uma aba 🔔 (a PRIMEIRA da ⚙️), com o estado de cada camada para
// a pessoa logada, um "Testar TUDO", as preferências, a SIMULAÇÃO ("se
// chegasse agora, você receberia? senão, por quê") lida das MESMAS funções do
// fan-out real, e a AUDITORIA do último aviso real (quem recebeu e quem não).
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { montarAuditoriaAviso } from '../sefaz-backend/whatsapp-push.js';

const raiz = process.cwd();
const tela = readFileSync(join(raiz, 'components/SpConnect/index.tsx'), 'utf8');
const rotas = readFileSync(join(raiz, 'sefaz-backend/whatsapp-routes.js'), 'utf8');
const envio = readFileSync(join(raiz, 'sefaz-backend/whatsapp-push-envio.js'), 'utf8');

describe('✅ montarAuditoriaAviso — exercitada', () => {
    it('guarda quem recebeu e quem ficou de fora COM O MOTIVO, por canal', () => {
        const a = montarAuditoriaAviso({
            titulo: '💬 Padaria',
            push: { alvos: [{ uid: 'u1', email: 'ana@sp.com' }], fora: [{ uid: 'u2', email: 'bia@sp.com', motivo: 'sem celular registrado' }], enviados: 1 },
            teams: { alvos: [{ uid: 'u1', email: 'ana@sp.com' }, { uid: 'u2', email: 'bia@sp.com' }], fora: [], enviados: 1, erros: [{ email: 'bia@sp.com', etapa: 'app-nao-instalado', erro: 'x' }] },
            agora: new Date('2026-09-24T12:00:00Z'),
        });
        expect(a.em).toBe('2026-09-24T12:00:00.000Z');
        expect(a.push.alvos).toEqual(['ana@sp.com']);
        expect(a.push.fora).toEqual([{ email: 'bia@sp.com', motivo: 'sem celular registrado' }]);
        expect(a.teams.enviados).toBe(1);
        expect(a.teams.erros[0].etapa).toBe('app-nao-instalado');
    });

    it('🚨 sem o texto da mensagem — só o título curto', () => {
        const a = montarAuditoriaAviso({ titulo: 'x'.repeat(500), push: {}, teams: {} });
        expect(a.titulo.length).toBe(120);
        expect(JSON.stringify(a)).not.toMatch(/corpo|texto/);
    });

    it('não estoura com nada informado, e limita as listas', () => {
        const fora = Array.from({ length: 200 }, (_, i) => ({ uid: `u${i}`, motivo: 'm' }));
        const a = montarAuditoriaAviso({ titulo: '', push: { fora }, teams: { erros: Array.from({ length: 50 }, () => ({ email: 'e', etapa: null, erro: 'x' })) } });
        expect(a.push.fora).toHaveLength(60);
        expect(a.teams.erros).toHaveLength(20);
        expect(a.push.enviados).toBe(0);
    });
});

describe('🔔 a aba existe, é a PRIMEIRA, e as quatro camadas estão nela', () => {
    it('🔔 Avisos é a primeira aba da ⚙️ — o campo que o Paulo não achou', () => {
        expect(tela).toMatch(/\[\['avisos', '🔔 Avisos'\], \['bot'/);
    });

    it('o bloco do Teams MUDOU de aba, e continua sendo UM só (não duas cópias)', () => {
        expect((tela.match(/Testar no meu Teams/g) || []).length).toBe(1);
        expect(tela).toMatch(/quero aviso no sino do Teams/);
    });

    it('🧪 um botão testa TUDO — e as camadas do navegador disparam no GESTO do clique', () => {
        expect(tela).toMatch(/Testar TUDO agora/);
        // som e pop-up só saem no gesto: têm de estar DENTRO do handler
        const h = tela.slice(tela.indexOf('const testarTudo = async'), tela.indexOf('const linkNoNavegador'));
        expect(h).toMatch(/destravarSom\(\)/);
        expect(h).toMatch(/tocarAviso\(\)/);
        expect(h).toMatch(/new Notification\(/);
        expect(h).toMatch(/testarTodosAvisos\(\)/);
    });

    it('🚨 dentro do Teams a tela DIZ o que não dá — e aponta o navegador', () => {
        // Pop-up e celular são impossíveis no webview; sem isto a pessoa
        // clica num botão que nunca vai funcionar e conclui que o app é ruim.
        expect(tela).toMatch(/Você está dentro do Teams/);
        expect(tela).toMatch(/linkNoNavegador/);
    });

    it('e a preferência por pessoa tem as CINCO chaves, todas ligadas por padrão', () => {
        for (const k of ['som', 'popup', 'push', 'avisoTeams']) expect(tela).toMatch(new RegExp(`prefsAviso\\.${k} !== false`));
        // fora do expediente nasce DESLIGADO — regra registrada em notificacaoConnect
        expect(tela).toMatch(/prefsAviso\.pushForaDoExpediente === true/);
    });
});

describe('🚨 o servidor responde "por que eu não recebi?" com a MESMA régua do envio real', () => {
    it('a rota /push/prefs aceita avisoTeams (a régua lia o opt-out, a rota descartava a chave)', () => {
        expect(rotas).toMatch(/\['som', 'popup', 'push', 'pushForaDoExpediente', 'avisoTeams'\]/);
    });

    it('/avisos/status simula com destinatariosDoPush e destinatariosDoAvisoTeams — nunca uma segunda cópia', () => {
        const r = rotas.slice(rotas.indexOf("router.get('/avisos/status'"), rotas.indexOf("router.post('/avisos/testar-tudo'"));
        expect(r).toMatch(/simular\(destinatariosDoPush\)/);
        expect(r).toMatch(/simular\(destinatariosDoAvisoTeams\)/);
        expect(r).toMatch(/dentroDoHorario\(config\.horario, agora\)/);
    });

    it('o fan-out real GRAVA a auditoria e devolve quem ficou de fora', () => {
        expect(envio).toMatch(/doc\('ultimo_aviso'\)\.set\(montarAuditoriaAviso\(/);
        expect(envio).toMatch(/return \{ enviados, alvos: alvos\.length, fora: foraPush \}/);
        // e quando a chave geral do Teams está desligada, isso vira MOTIVO, não silêncio
        expect(envio).toMatch(/aviso no Teams DESLIGADO na ⚙️/);
    });

    it('🧪 /avisos/testar-tudo devolve cada canal com o próprio resultado — um não esconde o outro', () => {
        const r = rotas.slice(rotas.indexOf("router.post('/avisos/testar-tudo'"), rotas.indexOf("router.post('/push/token'"));
        expect(r).toMatch(/enviarAvisoTeams\(\{ email, titulo, corpo \}\)/);
        expect(r).toMatch(/enviarPushTeste\(\{ uid, titulo, corpo \}\)/);
        expect(r).toMatch(/return res\.json\(\{ ok: true, teams, push/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔑 24/09, PRIMEIRO "TESTAR TUDO" REAL: a simulação disse "o sino tocaria" e o
// envio caiu em AADSTS7000215 (segredo do app Notificacoes inválido no Secret
// Manager). A AUDIÊNCIA estava certa; a CREDENCIAL, não — e a tela deixava
// ler a primeira como garantia da segunda. Agora a credencial é medida por um
// token de verdade e tem linha própria, antes da audiência.
// ════════════════════════════════════════════════════════════════════════════
describe('🔑 a credencial do Graph é PROVADA, não deduzida da audiência', () => {
    it('/avisos/status emite um token de verdade (cacheado) e devolve o erro CRU quando falha', () => {
        const r = rotas.slice(rotas.indexOf("router.get('/avisos/status'"), rotas.indexOf("router.post('/avisos/testar-tudo'"));
        expect(r).toMatch(/await getGraphToken\(\)/);
        expect(r).toMatch(/credencialGraph = \{ ok: false, erro: String\(e\?\.message \|\| e\)/);
        expect(r).toMatch(/credencialGraph,/);
    });

    it('a tela mostra a credencial em linha PRÓPRIA, antes da audiência — e diz o raio do estrago', () => {
        expect(tela).toMatch(/Credencial do Graph \(app Notificacoes\)/);
        expect(tela.indexOf('Credencial do Graph (app Notificacoes)')).toBeLessThan(tela.indexOf('Audiência: se chegasse mensagem AGORA'));
        // e-mail de guia e alertas usam o MESMO token: a pessoa precisa saber
        expect(tela).toMatch(/nem e-mail de guia, nem alerta por e-mail/);
    });
});

