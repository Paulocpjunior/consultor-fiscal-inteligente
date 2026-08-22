// ============================================================================
// Testes do núcleo do webhook do WhatsApp (F1 do módulo 💬 Comunicação).
// O payload de exemplo segue a forma REAL do campo "messages" da Cloud API.
// ============================================================================
import { createHmac } from 'crypto';
import {
    configWebhook, faltasDaConfigWebhook, responderVerificacao,
    assinaturaValida, extrairEventos, traduzirStatusEntrega,
    interpretarErroEntrega, saiuPorOutraPlataforma, mensagemDoStatus, janela24hAte, resumoParaConversa,
    caminhoStorageMidia,
} from '../sefaz-backend/whatsapp-webhook.js';

const CFG = { verifyToken: 'meu-token-de-verificacao', appSecret: 'segredo-do-app', instagramAppSecret: '' };

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
        expect(responderVerificacao({ 'hub.mode': 'subscribe', 'hub.verify_token': '' }, { verifyToken: '', appSecret: '', instagramAppSecret: '' }).ok).toBe(false);
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
        // GIF/figurinha também não manda nome de arquivo — 'image/gif' tinha
        // ficado de fora do mapa e caía em '.bin' (Paulo, 21/08: erro ao ver
        // imagem/gif). A extensão é só cosmética (quem serve o Content-Type
        // é o mime gravado), mas o arquivo tem que dizer o que é.
        expect(caminhoStorageMidia({
            metaMessageId: 'wamid.G=', de: '5511', tipo: 'image', texto: null,
            midia: { metaMediaId: 'm2', mime: 'image/gif', nomeArquivo: null, sha256: null },
        } as any)).toBe('whatsapp/5511/wamid_G_.gif');
    });

    it('resumo usa o texto; sem texto, nomeia a mídia', () => {
        const r = extrairEventos(PAYLOAD);
        expect(resumoParaConversa(r.mensagens[0])).toBe('Recebi a guia, obrigado!');
        expect(resumoParaConversa({ tipo: 'audio', texto: null, midia: {} } as any)).toBe('🎙️ áudio');
        expect(resumoParaConversa({ tipo: 'document', texto: null, midia: { nomeArquivo: 'x.pdf' } } as any)).toBe('📎 x.pdf');
    });
});

// ============================================================================
// 🚨 MATA-BURRO: "TENTE REENVIAR" NÃO SERVE QUANDO JÁ FALHOU TRÊS VEZES.
//
// Caso real (17/08, painel do Paulo): três falhas 131053 seguidas, para o
// mesmo número, com o mesmo arquivo. A frase dizia "tente reenviar o anexo" —
// e reenviar era exatamente o que não ia funcionar: este erro chega DEPOIS de
// a Meta aceitar o envio, ou seja, o upload deu certo e o processamento da
// MÍDIA é que falhou. Repetir o mesmo arquivo repete a falha.
//
// É a família do "Já importado" sem estado (14/08): a única saída que sobra
// para quem lê uma frase dessas é repetir o clique.
// ============================================================================
describe('🚨 131053 — a frase diz O QUE foi enviado e o que fazer com o ARQUIVO', () => {
    it('sem a mídia, ainda assim NÃO manda repetir o mesmo arquivo', () => {
        const f = interpretarErroEntrega(131053);
        expect(f).toMatch(/tende a falhar de novo/i);
        expect(f).toMatch(/converta|reduza/i);
    });

    it('com a mídia, DESCREVE o arquivo — sem isso quem lê não tem por onde começar', () => {
        const f = interpretarErroEntrega(131053, '', {
            enviadoPor: 'ju@sp.com.br',
            midia: { nomeArquivo: 'contrato.pdf', mime: 'application/pdf', tipo: 'document', tamanhoBytes: 5 * 1024 * 1024 },
        });
        expect(f).toContain('contrato.pdf');
        expect(f).toContain('application/pdf');
        expect(f).toContain('5,0 MB');
    });

    it('a ação é POR TIPO — áudio não se resolve como PDF', () => {
        const audio = interpretarErroEntrega(131053, '', { midia: { nomeArquivo: 'a.ogg', tipo: 'audio' } });
        expect(audio).toMatch(/mp3|opus/i);
        const doc = interpretarErroEntrega(131053, '', { midia: { nomeArquivo: 'x.pdf', tipo: 'document' } });
        expect(doc).toMatch(/PDF/);
        const img = interpretarErroEntrega(131053, '', { midia: { nomeArquivo: 'x.png', tipo: 'image' } });
        expect(img).toMatch(/JPG|PNG/);
    });

    it('diz que a cópia continua no histórico — senão parece que o arquivo se perdeu', () => {
        const f = interpretarErroEntrega(131053, '', { midia: { nomeArquivo: 'x.pdf', tipo: 'document' } });
        expect(f).toMatch(/hist[óo]rico/i);
    });

    it('os outros códigos não mudaram (a régua do 131049 é a que mais importa)', () => {
        expect(interpretarErroEntrega(131049)).toMatch(/filtro de marketing/i);
        expect(interpretarErroEntrega(131047)).toMatch(/24h/);
        expect(interpretarErroEntrega(131026)).toMatch(/não tem WhatsApp/i);
    });
});

// ============================================================================
// 🚨 A AÇÃO TEM QUE SER DE QUEM PODE AGIR
//
// Print do Paulo (17/08, conversa da Agatha, já no build 570): a falha 131053
// apareceu num balão que a própria tela rotulava como *"mensagem enviada por
// outra plataforma"* — e logo abaixo a frase mandava o NOSSO colaborador
// converter o PDF. Ele nunca enviou aquele arquivo, e este app nem o tem: a
// Meta manda o STATUS de toda mensagem do número para todos os apps
// assinados, mas não manda o conteúdo das que saíram por outro.
//
// Ação impossível ocupa o lugar da útil — é a mesma família do "tente
// reenviar" que este mesmo código corrigiu de manhã.
// ============================================================================
describe('🚨 falha de mensagem que saiu pela OUTRA plataforma', () => {
    // Exatamente o que o webhook grava quando só o status chega: sem
    // enviadoPor, sem texto, sem mídia.
    const daOutra = { direcao: 'saida', texto: null, midia: null };

    it('reconhece pelo REGISTRO PRÓPRIO: sem enviadoPor, sem texto, sem mídia', () => {
        expect(saiuPorOutraPlataforma(daOutra)).toBe(true);
        expect(saiuPorOutraPlataforma({ ...daOutra, enviadoPor: 'ju@sp.com.br' })).toBe(false);
        expect(saiuPorOutraPlataforma({ ...daOutra, texto: 'oi' })).toBe(false);
        expect(saiuPorOutraPlataforma({ ...daOutra, midia: { tipo: 'document' } })).toBe(false);
        expect(saiuPorOutraPlataforma({ direcao: 'entrada' })).toBe(false);
    });

    it('NA DÚVIDA não afirma que é de outro — o erro nessa direção é o caro', () => {
        // Sem o documento (status chegando antes da nossa gravação), dizer
        // "saiu por outra plataforma" faria o colaborador ignorar uma falha
        // que é DELE. O contrário só custa uma frase inútil.
        expect(saiuPorOutraPlataforma(null)).toBe(false);
        expect(saiuPorOutraPlataforma(undefined)).toBe(false);
    });

    it('131053 de mensagem alheia: diz de QUEM é a ação e NÃO manda converter arquivo nenhum', () => {
        const f = interpretarErroEntrega(131053, '', daOutra);
        expect(f).toMatch(/NÃO saiu pelo SP Connect|outra plataforma/i);
        expect(f).toMatch(/quem reenvia é quem mandou/i);
        expect(f).toMatch(/cliente NÃO recebeu/i);
        // e não finge conhecer um arquivo que nunca passou por aqui
        expect(f).not.toMatch(/PDF → imagem/);
    });

    it('a mesma falha SENDO nossa continua descrevendo o arquivo', () => {
        const f = interpretarErroEntrega(131053, '', {
            direcao: 'saida', enviadoPor: 'ju@sp.com.br',
            midia: { nomeArquivo: 'guia.pdf', tipo: 'document' },
        });
        expect(f).toContain('guia.pdf');
        expect(f).not.toMatch(/outra plataforma/i);
    });

    it('os outros códigos ganham a RESSALVA de dono, sem perder a explicação', () => {
        const filtro = interpretarErroEntrega(131049, '', daOutra);
        expect(filtro).toMatch(/filtro de marketing/i);      // a causa continua dita
        expect(filtro).toMatch(/OUTRA plataforma/);          // e agora diz de quem é
        expect(interpretarErroEntrega(131047, '', daOutra)).toMatch(/OUTRA plataforma/);
        expect(interpretarErroEntrega(0, '', daOutra)).toMatch(/OUTRA plataforma/);
        // Nossa mensagem não carrega ressalva nenhuma.
        expect(interpretarErroEntrega(131049)).not.toMatch(/OUTRA plataforma/);
    });
});

// ============================================================================
// 🚨 DOCUMENTO AUSENTE NÃO É DÚVIDA — É PROVA (caso P. Leal, 20/08)
//
// Print do Paulo: o balão já mostrava "mensagem enviada por outra
// plataforma" e, logo abaixo, o 131053 mandava o colaborador converter um
// arquivo que ele nunca enviou — o MESMO defeito do caso Agatha (17/08), que
// esta suíte já cobria. A diferença: aqui `saiuPorOutraPlataforma(null)`
// estava correto EM ISOLAMENTO (na dúvida, não afirma) — o defeito era a
// rota tratar "documento não existe" como a MESMA dúvida de "documento
// existe mas está incompleto". As duas são diferentes: nosso envio grava o
// documento ANTES de responder, então documento ausente prova que não é
// nosso.
// ============================================================================
describe('🚨 mensagemDoStatus — documento ausente é OUTRA plataforma, não dúvida', () => {
    it('doc existe: devolve os dados como estão (inclusive null, se vier vazio)', () => {
        expect(mensagemDoStatus(true, { direcao: 'saida', enviadoPor: 'ju@sp.com.br' }))
            .toEqual({ direcao: 'saida', enviadoPor: 'ju@sp.com.br' });
        expect(mensagemDoStatus(true, undefined)).toBeNull();
    });

    it('doc NÃO existe: sintetiza {direcao:"saida"} — nunca null', () => {
        expect(mensagemDoStatus(false, undefined)).toEqual({ direcao: 'saida' });
        // O 2º parâmetro é ignorado quando o doc não existe: se ele não
        // existe, `dadosDoDoc` também não pode vir de lugar nenhum de verdade.
        expect(mensagemDoStatus(false, { enviadoPor: 'nao deveria existir' })).toEqual({ direcao: 'saida' });
    });

    it('encadeado: vira "outra plataforma" pro resto da régua, sem afirmação incerta', () => {
        expect(saiuPorOutraPlataforma(mensagemDoStatus(false, undefined))).toBe(true);
    });

    it('🚨 O CASO REAL: 131053 sem documento nenhum NÃO manda converter arquivo', () => {
        const f = interpretarErroEntrega(131053, '', mensagemDoStatus(false, undefined));
        expect(f).toMatch(/NÃO saiu pelo SP Connect|outra plataforma/i);
        expect(f).not.toMatch(/PDF → imagem/);
    });

    it('doc EXISTE mas incompleto continua sendo dúvida de verdade (não regride)', () => {
        // Aqui a ambiguidade original da suíte de 17/08 segue valendo: o
        // documento existe, só não tem os campos — não é o caso do P. Leal.
        expect(mensagemDoStatus(true, null)).toBeNull();
        expect(saiuPorOutraPlataforma(mensagemDoStatus(true, null))).toBe(false);
    });
});
