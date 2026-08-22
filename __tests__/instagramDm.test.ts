// ============================================================================
// 📷 DMs do Instagram no inbox (22/08) — fase 2 da sonda: RECEBER e RESPONDER.
// O núcleo é puro (instagram-dm.js); as varreduras de fonte provam a FIAÇÃO —
// webhook, /responder, 📡 e o idConversaDoParam nas rotas de conversa (o
// replace(/\D/g,'') cru transformaria ig_178… em telefone e abriria a
// conversa errada).
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    ehConversaInstagram, idConversaInstagram, idConversaDoParam,
    extrairEventosInstagram, resumoDaMensagemIg, enviarTextoInstagram,
} from '../sefaz-backend/instagram-dm.js';

describe('id de conversa do Instagram', () => {
    it('reconhece ig_{IGSID} e nada além', () => {
        expect(ehConversaInstagram('ig_17841400000000000')).toBe(true);
        expect(ehConversaInstagram('5511964440000')).toBe(false);
        expect(ehConversaInstagram('ig_')).toBe(false);
        expect(ehConversaInstagram('ig_abc')).toBe(false);
        expect(ehConversaInstagram(null)).toBe(false);
    });

    it('idConversaDoParam: id do Instagram passa INTEIRO; telefone vira dígitos', () => {
        expect(idConversaDoParam('ig_17841400000000000')).toBe('ig_17841400000000000');
        expect(idConversaDoParam('+55 11 96444-0000')).toBe('5511964440000');
        // O caso que motivou a régua: o replace cru transformaria o id do IG
        // em "17841400000000000" — outra conversa, sem ninguém perceber.
        expect(idConversaDoParam('ig_17841400000000000')).not.toBe('17841400000000000');
    });

    it('idConversaInstagram monta o id a partir do IGSID', () => {
        expect(idConversaInstagram('17841400000000000')).toBe('ig_17841400000000000');
        expect(idConversaInstagram('')).toBe(null);
    });
});

describe('extrairEventosInstagram — a forma do webhook object=instagram', () => {
    const payloadEntrada = {
        object: 'instagram',
        entry: [{
            id: '17841400000000000',
            time: 1755870000000,
            messaging: [{
                sender: { id: '17845550001111111' },
                recipient: { id: '17841400000000000' },
                timestamp: 1755870000000,
                message: { mid: 'mid.abc123', text: 'Olá, quero falar com o RH' },
            }],
        }],
    };

    it('DM de cliente vira ENTRADA com conversaId ig_{IGSID}', () => {
        const r = extrairEventosInstagram(payloadEntrada);
        expect(r.valido).toBe(true);
        expect(r.mensagens).toHaveLength(1);
        const m = r.mensagens[0];
        expect(m.metaMessageId).toBe('mid.abc123');
        expect(m.direcao).toBe('entrada');
        expect(m.conversaId).toBe('ig_17845550001111111');
        expect(m.texto).toBe('Olá, quero falar com o RH');
        expect(m.timestamp).toBe(new Date(1755870000000).toISOString());
    });

    it('is_echo (a Página respondeu) vira SAÍDA e a conversa é a do CLIENTE (recipient)', () => {
        const eco = {
            object: 'instagram',
            entry: [{
                messaging: [{
                    sender: { id: '17841400000000000' },       // a Página
                    recipient: { id: '17845550001111111' },     // o cliente
                    timestamp: 1755870001000,
                    message: { mid: 'mid.eco1', text: 'Já te respondo!', is_echo: true },
                }],
            }],
        };
        const m = extrairEventosInstagram(eco).mensagens[0];
        expect(m.direcao).toBe('saida');
        expect(m.conversaId).toBe('ig_17845550001111111');
    });

    it('anexo vem como {tipo, url} e o resumo diz o que é', () => {
        const comAnexo = {
            object: 'instagram',
            entry: [{
                messaging: [{
                    sender: { id: '17845550001111111' },
                    timestamp: 1755870002000,
                    message: {
                        mid: 'mid.img1',
                        attachments: [{ type: 'image', payload: { url: 'https://cdn.meta.example/foto.jpg' } }],
                    },
                }],
            }],
        };
        const m = extrairEventosInstagram(comAnexo).mensagens[0];
        expect(m.anexos).toEqual([{ tipo: 'image', url: 'https://cdn.meta.example/foto.jpg' }]);
        expect(resumoDaMensagemIg(m)).toBe('🖼️ imagem');
    });

    it('payload que não é instagram é recusado NOMEADO (nunca lido como vazio)', () => {
        const r = extrairEventosInstagram({ object: 'whatsapp_business_account', entry: [] });
        expect(r.valido).toBe(false);
        expect(r.motivo).toContain('whatsapp_business_account');
    });

    it('mensagem sem mid é pulada — sem mid não há idempotência', () => {
        const semMid = {
            object: 'instagram',
            entry: [{ messaging: [{ sender: { id: '17845550001111111' }, message: { text: 'oi' } }] }],
        };
        expect(extrairEventosInstagram(semMid).mensagens).toHaveLength(0);
    });
});

describe('enviarTextoInstagram', () => {
    const deps = (respostas: Array<{ ok: boolean; status?: number; corpo: unknown }>) => {
        const chamadas: Array<{ url: string; init?: RequestInit }> = [];
        let i = 0;
        return {
            chamadas,
            semCache: true,
            cfg: { token: 'tok-teste' },
            fetchImpl: async (url: string, init?: RequestInit) => {
                chamadas.push({ url, init });
                const r = respostas[Math.min(i, respostas.length - 1)]; i += 1;
                return { ok: r.ok, status: r.status || (r.ok ? 200 : 400), json: async () => r.corpo } as Response;
            },
        };
    };
    const paginaOk = {
        ok: true,
        corpo: { data: [{ id: 'PAGE1', name: 'SP Assessoria Contábil', access_token: 'page-tok', instagram_business_account: { id: 'IG1', username: 'spassessoriacontabil' } }] },
    };

    it('manda pela PÁGINA (token de página) e aceita o id com prefixo ig_', async () => {
        const d = deps([paginaOk, { ok: true, corpo: { message_id: 'mid.saida1' } }]);
        const r = await enviarTextoInstagram({ para: 'ig_17845550001111111', texto: 'Bom dia!' }, d as never);
        expect(r).toEqual({ ok: true, messageId: 'mid.saida1' });
        const envio = d.chamadas[1];
        expect(envio.url).toContain('/PAGE1/messages');
        expect((envio.init?.headers as Record<string, string>).Authorization).toBe('Bearer page-tok');
        expect(JSON.parse(String(envio.init?.body))).toMatchObject({ recipient: { id: '17845550001111111' }, message: { text: 'Bom dia!' } });
    });

    it('janela fechada volta NOMEADA (janelaFechada), não como erro genérico', async () => {
        const d = deps([paginaOk, { ok: false, status: 400, corpo: { error: { message: 'This message is sent outside of allowed window.', code: 10 } } }]);
        const r = await enviarTextoInstagram({ para: 'ig_17845550001111111', texto: 'oi' }, d as never);
        expect(r.ok).toBe(false);
        expect(r.janelaFechada).toBe(true);
    });

    it('com INSTAGRAM_ACCESS_TOKEN (caso de uso "login do Instagram") o envio sai pelo graph.instagram.com', async () => {
        // O painel de 22/08 mostrou o app do Instagram próprio (API_Oficial-IG):
        // nesse modo o token é da CONTA e o host é outro — sem este caminho, a
        // resposta sairia pela API da Página com o token errado.
        const d = deps([{ ok: true, corpo: { message_id: 'mid.ig-login' } }]);
        const r = await enviarTextoInstagram(
            { para: 'ig_17845550001111111', texto: 'Bom dia!' },
            { ...d, igToken: 'IGAA-token-da-conta' } as never,
        );
        expect(r).toEqual({ ok: true, messageId: 'mid.ig-login' });
        const envio = d.chamadas[0];
        expect(envio.url).toContain('graph.instagram.com');
        expect(envio.url).toContain('/me/messages');
        expect((envio.init?.headers as Record<string, string>).Authorization).toBe('Bearer IGAA-token-da-conta');
    });
});

describe('assinatura do webhook com DUAS chaves (app principal + app do Instagram)', () => {
    // O caso de uso "login do Instagram" assina com a chave do app do
    // Instagram — recusá-la deixaria a DM invisível ATÉ pro diagnóstico
    // (401 antes do evento cru). Qualquer chave configurada que bater vale.
    const { createHmac } = require('crypto');
    const corpo = Buffer.from('{"object":"instagram"}');
    const header = (chave: string) => `sha256=${createHmac('sha256', chave).update(corpo).digest('hex')}`;

    it('aceita a assinatura da SEGUNDA chave e recusa chave nenhuma', () => {
        const { assinaturaValida } = require('../sefaz-backend/whatsapp-webhook.js');
        expect(assinaturaValida(corpo, header('segredo-ig'), ['segredo-principal', 'segredo-ig'])).toBe(true);
        expect(assinaturaValida(corpo, header('segredo-principal'), ['segredo-principal', 'segredo-ig'])).toBe(true);
        expect(assinaturaValida(corpo, header('outra-coisa'), ['segredo-principal', 'segredo-ig'])).toBe(false);
        expect(assinaturaValida(corpo, header('segredo-ig'), [null, ''])).toBe(false);
        // Forma antiga (string única) continua valendo — leitor não muda.
        expect(assinaturaValida(corpo, header('so-uma'), 'so-uma')).toBe(true);
    });

    it('a rota do webhook passa AS DUAS chaves e a config conhece a env nova', () => {
        const webhookRotas = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-webhook-routes.js'), 'utf8');
        expect(webhookRotas).toContain('[cfg.appSecret, cfg.instagramAppSecret]');
        const nucleoWebhook = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-webhook.js'), 'utf8');
        expect(nucleoWebhook).toContain('INSTAGRAM_APP_SECRET');
    });

    it('o GET do webhook grava o último aperto de mão e a tela separa navegador × Meta × token errado', () => {
        // "Forbidden" tem três caras (22/08): navegador sem os parâmetros,
        // Meta com token errado, e — quando dá certo — nem aparece. O doc
        // gravado (sem o token, só o motivo) é o que deixa a ⚙️ → 📷 dizer
        // qual foi, sem ninguém abrir log de Cloud Run.
        const webhookRotas = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-webhook-routes.js'), 'utf8');
        expect(webhookRotas).toContain("doc('webhook_verificacao')");
        expect(webhookRotas).toContain('pareceNavegador');
        const rotasAdmin = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');
        expect(rotasAdmin).toContain("doc('webhook_verificacao')");
        const telaConnect = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');
        expect(telaConnect).toContain('Último aperto de mão');
        expect(telaConnect).toContain('NAVEGADOR');
    });
});

// ─── FIAÇÃO (varredura de fonte) ────────────────────────────────────────────
describe('fiação das DMs do Instagram', () => {
    const webhook = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-webhook-routes.js'), 'utf8');
    const rotas = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');

    it('o webhook tem o ramo object === "instagram" e grava pelas funções do IG', () => {
        expect(webhook).toContain("req.body?.object === 'instagram'");
        expect(webhook).toContain('extrairEventosInstagram');
        expect(webhook).toContain('gravarMensagemInstagram');
    });

    it('o BOT NÃO roda nas DMs — o ramo do Instagram retorna antes do fluxo do WhatsApp', () => {
        // O ramo IG termina em `return res.status(200)` ANTES de extrairEventos
        // (WhatsApp): rodarBot/capturarAvaliacao ficam do lado de lá.
        const ramoIg = webhook.slice(webhook.indexOf("req.body?.object === 'instagram'"), webhook.indexOf('const ev = extrairEventos(req.body)'));
        expect(ramoIg).toContain('return res.status(200)');
        expect(ramoIg).not.toContain('rodarBot');
        expect(ramoIg).not.toContain('capturarAvaliacao');
    });

    it('as rotas de conversa resolvem o :numero pelo idConversaDoParam (não pelo replace cru)', () => {
        // Toda rota de conversa que normalizava com replace(/\D/g,'') passou
        // pela régua — sobrar uma é a conversa do IG abrindo errado.
        const rotasConversa = rotas.split('router.').filter((t) => t.startsWith("post('/conversas/:numero") || t.startsWith("get('/conversas/:numero"));
        expect(rotasConversa.length).toBeGreaterThanOrEqual(8);
        for (const t of rotasConversa) {
            const usaHelper = t.includes('acaoConversa(');
            const usaRegua = t.includes('idConversaDoParam(req.params.numero)');
            expect(usaHelper || usaRegua).toBe(true);
            expect(t).not.toContain("String(req.params.numero || '').replace(/\\D/g, '')");
        }
    });

    it('o /responder tem o ramo do Instagram (enviarTextoInstagram) e o /anexo recusa IG nomeado', () => {
        expect(rotas).toContain('enviarTextoInstagram({ para: numero, texto })');
        const anexo = rotas.slice(rotas.indexOf("post('/conversas/:numero/anexo'"), rotas.indexOf("get('/conversas/:numero/cliente'"));
        expect(anexo).toContain('ehConversaInstagram(numero)');
        expect(anexo).toContain('não é suportado');
    });

    it('o diagnóstico de entrega existe: /estado conta os eventos CRUS do IG e a tela separa os dois lados', () => {
        // Caso real de 22/08: "mandaram uma DM e não chegou". Zero evento cru
        // = a Meta não entrega (conserto do lado de lá); cru sem conversa =
        // processamento nosso. Sem o contador, as duas caras são o mesmo
        // silêncio — e falha de leitura NÃO pode virar "zero".
        const estado = rotas.slice(rotas.indexOf("get('/instagram/estado'"), rotas.indexOf('export default router'));
        expect(estado).toContain('whatsapp_webhook_eventos');
        expect(estado).toContain("payload?.object === 'instagram'");
        expect(estado).toContain('eventos = null');
        expect(tela).toContain('Permitir acesso às mensagens');
        expect(tela).toContain('a Meta não está entregando');
    });

    it('o 🔬 pergunta à META o que está assinado (fonte, não a memória do clique)', () => {
        // Degrau 2 do caso de 22/08: interruptor ligado + zero cru ⇒ conferir
        // a assinatura NA FONTE. A rota chama assinaturasDoApp e a tela mostra
        // o que a Meta respondeu, com os dois suspeitos restantes nomeados.
        expect(rotas).toContain('assinaturasDoApp()');
        const nucleo = readFileSync(join(__dirname, '..', 'sefaz-backend/instagram-dm.js'), 'utf8');
        expect(nucleo).toContain('/subscriptions?access_token=');
        expect(nucleo).toContain('subscribed_apps?fields=subscribed_fields');
        expect(tela).toContain('O que a Meta diz que está assinado');
        expect(tela).toContain('Solicitações de mensagem');
        // O painel de 22/08 revelou o caso de uso "login do Instagram": app do
        // Instagram próprio, chave própria, webhook na tela do caso de uso —
        // a dica da tela tem que apontar pra LÁ, com a env da chave.
        expect(tela).toContain('INSTAGRAM_APP_SECRET');
    });

    it('o 📡 existe: rota /instagram/ligar (admin) + estado persistido + botão na tela', () => {
        expect(rotas).toContain("router.post('/instagram/ligar', requireAdmin");
        expect(rotas).toContain("router.get('/instagram/estado', requireAdmin");
        expect(rotas).toContain("doc('instagram')");
        expect(tela).toContain('ligarInstagram');
        expect(tela).toContain('Ligar recebimento das DMs');
    });

    it('a tela distingue o canal: selo 📷, composer sem anexo/áudio no IG', () => {
        expect(tela).toContain("canal === 'instagram'");
        expect(tela).toContain('📷 Instagram');
        expect(tela).toContain('DM do Instagram');
    });

    it('a lista de conversas devolve o canal (campo novo na saída — lição da whitelist)', () => {
        expect(rotas).toContain("canal: x.canal || 'whatsapp'");
    });
});
