// ============================================================================
// Testes do núcleo do webhook do WhatsApp (F1 do módulo 💬 Comunicação).
// O payload de exemplo segue a forma REAL do campo "messages" da Cloud API.
// ============================================================================
import { createHmac } from 'crypto';
import {
    configWebhook, faltasDaConfigWebhook, responderVerificacao,
    assinaturaValida, extrairEventos, traduzirStatusEntrega,
    interpretarErroEntrega, janela24hAte, resumoParaConversa,
    caminhoStorageMidia,
} from '../sefaz-backend/whatsapp-webhook.js';

const CFG = { verifyToken: 'meu-token-de-verificacao', appSecret: 'segredo-do-app' };

describe('configWebhook / faltas', () => {
    it('lê as envs e lista o que falta com a ação', () => {
        const cfg = configWebhook({});
        const faltas = faltasDaConfigWebhook(cfg);
        expect(faltas).toHaveLength(2);
        expect(faltas[0]).toContain('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
        expect(faltas[1]).toContain('WHATSAPP_APP_SECRET');
        expect(faltasDaConfigWebhook(configWebhook({
            WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'x', WHATSAPP_APP_SECRET: 'y',
        }))).toHaveLength(0);
    });
});

describe('responderVerificacao (GET da Meta)', () => {
    it('devolve o challenge quando modo e token conferem', () => {
        const r = responderVerificacao({
            'hub.mode': 'subscribe', 'hub.verify_token': CFG.verifyToken, 'hub.challenge': '12345',
        }, CFG);
        expect(r).toEqual({ ok: true, challenge: '12345' });
    });
    it('recusa token errado, modo errado e config ausente', () => {
        expect(responderVerificacao({ 'hub.mode': 'subscribe', 'hub.verify_token': 'outro', 'hub.challenge': '1' }, CFG).ok).toBe(false);
        expect(responderVerificacao({ 'hub.mode': 'unsubscribe', 'hub.verify_token': CFG.verifyToken }, CFG).ok).toBe(false);
        expect(responderVerificacao({ 'hub.mode': 'subscribe', 'hub.verify_token': '' }, { verifyToken: '', appSecret: '' }).ok).toBe(false);
    });
});

describe('assinaturaValida (X-Hub-Signature-256)', () => {
    const corpo = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));
    const assinar = (secret: string) => 'sha256=' + createHmac('sha256', secret).update(corpo).digest('hex');

    it('aceita a assinatura correta e recusa as erradas', () => {
        expect(assinaturaValida(corpo, assinar(CFG.appSecret), CFG.appSecret)).toBe(true);
        expect(assinaturaValida(corpo, assinar('outro-segredo'), CFG.appSecret)).toBe(false);
        expect(assinaturaValida(corpo, 'sha256=deadbeef', CFG.appSecret)).toBe(false);
    });
    it('recusa header ausente/torto e secret ausente — rota pública não confia em ninguém', () => {
        expect(assinaturaValida(corpo, undefined, CFG.appSecret)).toBe(false);
        expect(assinaturaValida(corpo, 'md5=abc', CFG.appSecret)).toBe(false);
        expect(assinaturaValida(corpo, 'sha256=abcd', '')).toBe(false);
    });
    it('o HMAC é sobre o corpo CRU — corpo diferente muda a assinatura', () => {
        const outro = Buffer.from('{"object":"whatsapp_business_account","entry":[ ]}'); // um espaço a mais
        expect(assinaturaValida(outro, assinar(CFG.appSecret), CFG.appSecret)).toBe(false);
    });
});

// Payload na forma real da Cloud API (campo "messages"): uma mensagem de
// texto, um documento com caption, um tipo desconhecido e dois statuses —
// um "read" e um "failed" com o erro 131049 (filtro de marketing).
const PAYLOAD = {
    object: 'whatsapp_business_account',
    entry: [{
        id: '111222333',
        changes: [{
            field: 'messages',
            value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '5511955550000', phone_number_id: '999888777' },
                contacts: [{ profile: { name: 'Ricardo Sócio' }, wa_id: '5511964440000' }],
                messages: [
                    {
                        from: '5511964440000', id: 'wamid.ENTRADA1=', timestamp: '1755100800',
                        type: 'text', text: { body: 'Recebi a guia, obrigado!' },
                    },
                    {
                        from: '5511964440000', id: 'wamid.ENTRADA2=', timestamp: '1755100900',
                        type: 'document',
                        document: { id: 'media-123', mime_type: 'application/pdf', filename: 'comprovante.pdf', sha256: 'abc', caption: 'segue o comprovante' },
                    },
                    {
                        from: '5511964440000', id: 'wamid.ENTRADA3=', timestamp: '1755101000',
                        type: 'unsupported',
                    },
                ],
                statuses: [
                    { id: 'wamid.SAIDA1=', status: 'read', timestamp: '1755100850', recipient_id: '5511964440000' },
                    {
                        id: 'wamid.SAIDA2=', status: 'failed', timestamp: '1755100860', recipient_id: '5511977770000',
                        errors: [{ code: 131049, title: 'Message undeliverable', error_data: { details: 'unable to deliver message to maintain healthy ecosystem engagement' } }],
                    },
                ],
            },
        }],
    }],
};

describe('extrairEventos', () => {
    it('separa mensagens do cliente e statuses dos nossos envios', () => {
        const r = extrairEventos(PAYLOAD);
        expect(r.valido).toBe(true);
        expect(r.mensagens).toHaveLength(3);
        expect(r.statuses).toHaveLength(2);

        const [texto, doc, desconhecido] = r.mensagens;
        expect(texto).toMatchObject({
            metaMessageId: 'wamid.ENTRADA1=', de: '5511964440000',
            nomePerfil: 'Ricardo Sócio', tipo: 'text', texto: 'Recebi a guia, obrigado!',
            midia: null, phoneNumberId: '999888777',
        });
        expect(texto.timestamp).toBe(new Date(1755100800 * 1000).toISOString());

        expect(doc.tipo).toBe('document');
        expect(doc.texto).toBe('segue o comprovante');
        expect(doc.midia).toEqual({ metaMediaId: 'media-123', mime: 'application/pdf', nomeArquivo: 'comprovante.pdf', sha256: 'abc' });

        // Tipo desconhecido NÃO some — entra nomeado, com texto nulo.
        expect(desconhecido.tipo).toBe('unsupported');
        expect(desconhecido.texto).toBeNull();
    });

    it('status failed carrega o erro estruturado', () => {
        const r = extrairEventos(PAYLOAD);
        const falha = r.statuses[1];
        expect(falha).toMatchObject({ metaMessageId: 'wamid.SAIDA2=', status: 'failed', destinatario: '5511977770000' });
        expect(falha.erro?.codigo).toBe(131049);
        expect(falha.erro?.detalhe).toContain('healthy ecosystem');
    });

    it('recusa payload que não é da WABA e ignora mensagem sem id (sem idempotência não entra)', () => {
        expect(extrairEventos({ object: 'page' }).valido).toBe(false);
        const semId = extrairEventos({
            object: 'whatsapp_business_account',
            entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: '55119', type: 'text', text: { body: 'x' } }] } }] }],
        });
        expect(semId.mensagens).toHaveLength(0);
    });
});

describe('tradução de status e erro de entrega', () => {
    it('traduz os conhecidos e nomeia os desconhecidos', () => {
        expect(traduzirStatusEntrega('delivered')).toBe('entregue');
        expect(traduzirStatusEntrega('read')).toBe('lido');
        expect(traduzirStatusEntrega('failed')).toBe('falhou');
        expect(traduzirStatusEntrega('algo_novo')).toBe('algo_novo');
    });
    it('131049 sai com a AÇÃO (utility + cliente inicia) — é o motivo da F1 existir', () => {
        const acao = interpretarErroEntrega(131049);
        expect(acao).toContain('UTILITY');
        expect(acao).toContain('24h');
        expect(interpretarErroEntrega(131047)).toContain('template');
        expect(interpretarErroEntrega(131026)).toContain('cadastro');
        expect(interpretarErroEntrega(999, 'detalhe da meta')).toContain('detalhe da meta');
    });
});

describe('janela de 24h e resumo da conversa', () => {
    it('a janela fecha 24h depois da mensagem do cliente', () => {
        expect(janela24hAte('2026-08-13T14:00:00.000Z')).toBe('2026-08-14T14:00:00.000Z');
        expect(janela24hAte('torto')).toBeNull();
    });
    it('caminho da mídia no Storage: wamid saneado + nome original (dois "comprovante.pdf" não colidem)', () => {
        const r = extrairEventos(PAYLOAD);
        const doc = r.mensagens[1]; // wamid.ENTRADA2= com comprovante.pdf
        expect(caminhoStorageMidia(doc)).toBe('whatsapp/5511964440000/wamid_ENTRADA2__comprovante.pdf');
        // Áudio não manda nome de arquivo — a extensão sai do mime.
        expect(caminhoStorageMidia({
            metaMessageId: 'wamid.A=', de: '5511', tipo: 'audio', texto: null,
            midia: { metaMediaId: 'm1', mime: 'audio/ogg; codecs=opus', nomeArquivo: null, sha256: null },
        } as any)).toBe('whatsapp/5511/wamid_A_.ogg');
    });

    it('resumo usa o texto; sem texto, nomeia a mídia', () => {
        const r = extrairEventos(PAYLOAD);
        expect(resumoParaConversa(r.mensagens[0])).toBe('Recebi a guia, obrigado!');
        expect(resumoParaConversa({ tipo: 'audio', texto: null, midia: {} } as any)).toBe('🎙️ áudio');
        expect(resumoParaConversa({ tipo: 'document', texto: null, midia: { nomeArquivo: 'x.pdf' } } as any)).toBe('📎 x.pdf');
    });
});
