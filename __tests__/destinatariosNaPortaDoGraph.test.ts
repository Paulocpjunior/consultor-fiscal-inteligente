/**
 * 🚨 DESTINATÁRIOS NA PORTA DO GRAPH (09/10, APATEL).
 *
 * Erro real do colaborador no envio do DAS: Graph sendMail 400
 * ErrorInvalidRecipients — "Recipient 'magda@apatel.com.br
 * francisco@apatel.com.br' is not resolved". Os dois e-mails do cadastro,
 * separados por ESPAÇO, chegaram como UM destinatário: a rota do DAS mandava
 * o campo cru, e o `enviarEmail` só filtrava vazio.
 *
 * Fatos cobrados: o `enviarEmail` monta UM destinatário por endereço, venha o
 * campo como vier (espaço, vírgula, ponto e vírgula, lista); endereço torto
 * volta NOMEADO e nada sai. A porta é o `enviarEmail` — toda rota passa por
 * ela, então a trava cobra o payload, não a forma de cada rota.
 */
import { listaDeEnvio } from '../sefaz-backend/email-destinatarios-helper.js';

const APATEL = 'magda@apatel.com.br francisco@apatel.com.br';

describe('listaDeEnvio — a régua da porta', () => {
    it('o campo da APATEL vira DOIS endereços', () => {
        expect(listaDeEnvio(APATEL)).toEqual({
            lista: ['magda@apatel.com.br', 'francisco@apatel.com.br'],
            invalidos: [],
        });
    });

    it('lista com strings de vários endereços, sem repetir', () => {
        expect(listaDeEnvio(['a@x.com.br; b@x.com.br', 'B@x.com.br, c@x.com.br']).lista)
            .toEqual(['a@x.com.br', 'b@x.com.br', 'c@x.com.br']);
    });

    it('endereço torto volta nomeado', () => {
        const r = listaDeEnvio('ok@x.com.br marcio07/MD@gmail.com');
        expect(r.lista).toEqual(['ok@x.com.br']);
        expect(r.invalidos.map((i) => i.valor)).toEqual(['marcio07/MD@gmail.com']);
    });

    it('vazio e nulo não viram destinatário', () => {
        expect(listaDeEnvio(undefined).lista).toEqual([]);
        expect(listaDeEnvio(['', null as any]).lista).toEqual([]);
    });
});

describe('enviarEmail — o payload que vai ao Graph', () => {
    let enviarEmail: (p: any) => Promise<{ ok: boolean; error?: string }>;
    let fetchMock: jest.Mock;

    beforeAll(() => {
        process.env.GRAPH_CLIENT_ID = 'client-teste';
        process.env.GRAPH_TENANT_ID = 'tenant-teste';
        process.env.GRAPH_CLIENT_SECRET = 'secret-teste';
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        enviarEmail = require('../sefaz-backend/graph-provider.js').enviarEmail;
    });

    beforeEach(() => {
        fetchMock = jest.fn(async (url: string) => {
            if (String(url).includes('login.microsoftonline.com')) {
                return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
            }
            return { status: 202, text: async () => '' };
        });
        (global as any).fetch = fetchMock;
    });

    const chamadasAoSendMail = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/sendMail'));

    it('o caso APATEL: dois destinatários, não um', async () => {
        const r = await enviarEmail({ remetente: 'r@sp.com.br', para: APATEL, assunto: 'DAS', corpoHtml: '<p>x</p>' });
        expect(r.ok).toBe(true);
        const payload = JSON.parse(chamadasAoSendMail()[0][1].body);
        expect(payload.message.toRecipients).toEqual([
            { emailAddress: { address: 'magda@apatel.com.br' } },
            { emailAddress: { address: 'francisco@apatel.com.br' } },
        ]);
    });

    it('endereço torto: nada sai, e o erro nomeia o endereço', async () => {
        const r = await enviarEmail({ remetente: 'r@sp.com.br', para: 'ok@x.com.br a/b@x.com', assunto: 'DAS', corpoHtml: '<p>x</p>' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/"a\/b@x\.com"/);
        expect(chamadasAoSendMail()).toHaveLength(0);
    });
});
