/**
 * Testes do enviarEmail (sefaz-backend/graph-provider.js) com fetch mockado.
 * Foco: montagem do payload do Graph sendMail — destinatários, cópia (CC),
 * cópia oculta (BCC) e anexos. Nenhuma chamada de rede real.
 */

const okTokenResponse = () => ({
    ok: true,
    json: async () => ({ access_token: 'tok-teste', expires_in: 3600 }),
});

describe('graph-provider enviarEmail', () => {
    let enviarEmail: (p: any) => Promise<{ ok: boolean; error?: string }>;
    let fetchMock: jest.Mock;

    beforeAll(() => {
        process.env.GRAPH_CLIENT_ID = 'client-teste';
        process.env.GRAPH_TENANT_ID = 'tenant-teste';
        process.env.GRAPH_CLIENT_SECRET = 'secret-teste';
        // require pos-env: o modulo le as credenciais no load
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        enviarEmail = require('../sefaz-backend/graph-provider.js').enviarEmail;
    });

    beforeEach(() => {
        fetchMock = jest.fn(async (url: string) => {
            if (String(url).includes('login.microsoftonline.com')) return okTokenResponse();
            return { status: 202, text: async () => '' };
        });
        (global as any).fetch = fetchMock;
    });

    const payloadDaUltimaChamada = () => {
        const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        expect(String(call[0])).toContain('/sendMail');
        return JSON.parse(call[1].body);
    };

    it('envia com BCC: gestor em bccRecipients, fora de toRecipients', async () => {
        const r = await enviarEmail({
            remetente: 'junior@sp.com.br',
            para: 'cliente@empresa.com.br',
            bcc: ['alexandre@sp.com.br'],
            assunto: 'DAS 06/2026',
            corpoHtml: '<p>oi</p>',
        });
        expect(r.ok).toBe(true);

        const payload = payloadDaUltimaChamada();
        expect(payload.message.toRecipients).toEqual([
            { emailAddress: { address: 'cliente@empresa.com.br' } },
        ]);
        expect(payload.message.bccRecipients).toEqual([
            { emailAddress: { address: 'alexandre@sp.com.br' } },
        ]);
        expect(payload.message.ccRecipients).toBeUndefined();
        expect(payload.saveToSentItems).toBe(true);
    });

    it('sem cc/bcc: payload nao inclui ccRecipients nem bccRecipients', async () => {
        const r = await enviarEmail({
            remetente: 'junior@sp.com.br',
            para: 'cliente@empresa.com.br',
            assunto: 'x',
            corpoHtml: '<p>x</p>',
        });
        expect(r.ok).toBe(true);

        const payload = payloadDaUltimaChamada();
        expect(payload.message.ccRecipients).toBeUndefined();
        expect(payload.message.bccRecipients).toBeUndefined();
    });

    it('cc visivel continua suportado e aceita string simples', async () => {
        const r = await enviarEmail({
            remetente: 'junior@sp.com.br',
            para: 'cliente@empresa.com.br',
            cc: 'copia@sp.com.br',
            assunto: 'x',
            corpoHtml: '<p>x</p>',
        });
        expect(r.ok).toBe(true);

        const payload = payloadDaUltimaChamada();
        expect(payload.message.ccRecipients).toEqual([
            { emailAddress: { address: 'copia@sp.com.br' } },
        ]);
    });

    it('bcc com lista: multiplos enderecos e ignora vazios', async () => {
        const r = await enviarEmail({
            remetente: 'junior@sp.com.br',
            para: 'cliente@empresa.com.br',
            bcc: ['alexandre@sp.com.br', '', 'fiscal@sp.com.br'],
            assunto: 'x',
            corpoHtml: '<p>x</p>',
        });
        expect(r.ok).toBe(true);

        const payload = payloadDaUltimaChamada();
        expect(payload.message.bccRecipients).toEqual([
            { emailAddress: { address: 'alexandre@sp.com.br' } },
            { emailAddress: { address: 'fiscal@sp.com.br' } },
        ]);
    });

    it('anexa PDF junto com BCC', async () => {
        const r = await enviarEmail({
            remetente: 'junior@sp.com.br',
            para: 'cliente@empresa.com.br',
            bcc: ['alexandre@sp.com.br'],
            assunto: 'DAS',
            corpoHtml: '<p>segue</p>',
            anexos: [{ name: 'das.pdf', contentType: 'application/pdf', contentBytes: 'QUJD' }],
        });
        expect(r.ok).toBe(true);

        const payload = payloadDaUltimaChamada();
        expect(payload.message.attachments).toEqual([{
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: 'das.pdf',
            contentType: 'application/pdf',
            contentBytes: 'QUJD',
        }]);
        expect(payload.message.bccRecipients).toHaveLength(1);
    });

    it('sem destinatario: falha sem chamar o sendMail', async () => {
        const r = await enviarEmail({
            remetente: 'junior@sp.com.br',
            para: [],
            bcc: ['alexandre@sp.com.br'],
            assunto: 'x',
            corpoHtml: '<p>x</p>',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/destinat/i);
        const chamadasSendMail = fetchMock.mock.calls.filter(c => String(c[0]).includes('/sendMail'));
        expect(chamadasSendMail).toHaveLength(0);
    });

    it('propaga erro do Graph (status != 202)', async () => {
        fetchMock.mockImplementation(async (url: string) => {
            if (String(url).includes('login.microsoftonline.com')) return okTokenResponse();
            return { status: 403, text: async () => 'Forbidden' };
        });
        const r = await enviarEmail({
            remetente: 'junior@sp.com.br',
            para: 'cliente@empresa.com.br',
            assunto: 'x',
            corpoHtml: '<p>x</p>',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('403');
    });
});
