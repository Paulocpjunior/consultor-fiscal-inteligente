/**
 * Envio de guia por WhatsApp OFICIAL (Cloud API) — pedido do Paulo, 09/08:
 * mesmo controle do e-mail (rito #293), e mesma honestidade de canal.
 *
 * O que os testes trancam:
 * 1. Config ausente vira LISTA do que falta — o botão explica, nunca some.
 * 2. Número BR normaliza pras duas formas válidas (fixo 12 / celular 13) e
 *    número torto vira null — alerta, nunca chute.
 * 3. O payload de template tem a forma da Cloud API (header documento + body
 *    na ordem) e a recusa da Meta sai TRADUZIDA com a ação.
 * 4. whatsapp-api COMPROVA envio; whatsapp (wa.me) continua não comprovando.
 */
import {
    configWhatsapp, faltasDaConfig, normalizarNumeroBr,
    montarMensagemTemplate, interpretarRespostaWhatsapp, enviarGuiaWhatsapp,
} from '../sefaz-backend/whatsapp-cloud.js';
import { canalComprovaEnvio } from '../sefaz-backend/envio-imposto-painel.js';

describe('configuração honesta', () => {
    test('sem nada configurado, as três faltas são nomeadas com a ação', () => {
        const faltas = faltasDaConfig(configWhatsapp({}));
        expect(faltas).toHaveLength(3);
        expect(faltas.join(' ')).toMatch(/whatsapp-cloud-token/);
        expect(faltas.join(' ')).toMatch(/WHATSAPP_PHONE_NUMBER_ID/);
        expect(faltas.join(' ')).toMatch(/WHATSAPP_TEMPLATE_GUIA/);
    });
    test('config completa não acusa falta e o idioma default é pt_BR', () => {
        const cfg = configWhatsapp({
            WHATSAPP_CLOUD_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1167203206473367',
            WHATSAPP_TEMPLATE_GUIA: 'envio_guia_imposto',
        });
        expect(faltasDaConfig(cfg)).toHaveLength(0);
        expect(cfg.idioma).toBe('pt_BR');
    });
});

describe('normalizarNumeroBr', () => {
    test.each([
        ['+55 11 3337-1554', '551133371554'],
        ['(11) 99737-7599', '5511997377599'],
        ['5511997377599', '5511997377599'],
        ['011 99737 7599', '5511997377599'],
    ])('%s → %s', (entrada, esperado) => {
        expect(normalizarNumeroBr(entrada)).toBe(esperado);
    });
    test('número torto vira null — alerta, nunca chute', () => {
        expect(normalizarNumeroBr('1234')).toBeNull();
        expect(normalizarNumeroBr('')).toBeNull();
        expect(normalizarNumeroBr('55 05 99999-9999')).toBeNull(); // DDD 05 não existe
    });
});

describe('payload do template', () => {
    test('header documento + body na ordem das variáveis', () => {
        const p = montarMensagemTemplate({
            para: '5511997377599', template: 'envio_guia_imposto', idioma: 'pt_BR',
            variaveis: ['ACME LTDA', 'DAS', '2026-08', '20/08/2026'],
            documentoId: 'MEDIA123', nomeArquivo: 'das_acme_2026-08.pdf',
        });
        expect(p.messaging_product).toBe('whatsapp');
        expect(p.to).toBe('5511997377599');
        expect(p.template.name).toBe('envio_guia_imposto');
        expect(p.template.language.code).toBe('pt_BR');
        const [header, body] = p.template.components!;
        expect(header.parameters[0].document).toEqual({ id: 'MEDIA123', filename: 'das_acme_2026-08.pdf' });
        expect(body.parameters.map((x: any) => x.text)).toEqual(['ACME LTDA', 'DAS', '2026-08', '20/08/2026']);
    });
});

describe('resposta da Meta traduzida com ação', () => {
    test('aceite devolve o id da mensagem — o comprovante', () => {
        const r = interpretarRespostaWhatsapp(200, { messages: [{ id: 'wamid.X' }], contacts: [{ wa_id: '5511997377599' }] });
        expect(r).toEqual({ ok: true, messageId: 'wamid.X', contato: '5511997377599' });
    });
    test('template não aprovado (132001) manda conferir no Gerenciador', () => {
        const r = interpretarRespostaWhatsapp(400, { error: { code: 132001, message: 'Template name does not exist' } });
        expect(r.ok).toBe(false);
        expect(r.acao).toMatch(/APROVADO|Gerenciador/);
    });
    test('token vencido (401) manda gerar token novo e atualizar o secret', () => {
        const r = interpretarRespostaWhatsapp(401, { error: { code: 190, message: 'Invalid OAuth access token' } });
        expect(r.acao).toMatch(/token/i);
        expect(r.acao).toMatch(/whatsapp-cloud-token/);
    });
});

describe('enviarGuiaWhatsapp', () => {
    const env = {
        WHATSAPP_CLOUD_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '999',
        WHATSAPP_TEMPLATE_GUIA: 'envio_guia_imposto',
    };
    test('sem config: recusa explicando, sem tentar rede', async () => {
        const r = await enviarGuiaWhatsapp({ para: '11997377599', variaveis: [] }, {
            env: {}, fetchImpl: async () => { throw new Error('não deveria chamar'); },
        });
        expect(r.ok).toBe(false);
        expect(r.configuracaoIncompleta).toBe(true);
    });
    test('caminho feliz: envia template e devolve o id', async () => {
        const chamadas: any[] = [];
        const fetchImpl = (async (url: any, init: any) => {
            chamadas.push({ url, init });
            return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.OK' }] }) };
        }) as any;
        const r = await enviarGuiaWhatsapp({ para: '(11) 99737-7599', variaveis: ['A', 'DAS', '2026-08', 'x'] }, { env, fetchImpl });
        expect(r.ok).toBe(true);
        expect(r.messageId).toBe('wamid.OK');
        expect(r.numeroEnviado).toBe('5511997377599');
        expect(chamadas[0].url).toBe('https://graph.facebook.com/v20.0/999/messages');
        expect(chamadas[0].init.headers.Authorization).toBe('Bearer tok');
    });
    test('rede caindo é INDETERMINADO — reenviar duplica, e a frase avisa', async () => {
        const r = await enviarGuiaWhatsapp({ para: '11997377599', variaveis: [] }, {
            env, fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as any,
        });
        expect(r.ok).toBe(false);
        expect(r.indeterminado).toBe(true);
        expect(r.acao).toMatch(/duplica/);
    });
});

describe('régua de prova de envio', () => {
    test('whatsapp-api comprova; wa.me continua não comprovando', () => {
        expect(canalComprovaEnvio('whatsapp-api')).toBe(true);
        expect(canalComprovaEnvio('email-graph')).toBe(true);
        expect(canalComprovaEnvio('whatsapp')).toBe(false);
        expect(canalComprovaEnvio('email-app')).toBe(false);
    });
});
