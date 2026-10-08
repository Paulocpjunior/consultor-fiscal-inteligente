/**
 * E-mail do Consultor DP ao cliente (rota /api/dp-integration/email/enviar):
 * a parte pura — pedido validado com diagnóstico e corpo com a marca do
 * Departamento Pessoal (mesma régua do CFI e do CCI).
 */
import { validarPedidoEmailDp, montarEmailPacoteDp, LIMITE_ANEXOS_BYTES, DEPARTAMENTO_DP } from '../sefaz-backend/dp-email-pacote.js';

const pdf = Buffer.from('%PDF-1.4 teste').toString('base64');
const base = { para: 'marta@cliente.com.br', mensagem: 'Olá, Marta!\nSegue a folha.', titulo: 'Folha mensal 09/2026', empresaNome: 'Exemplo', competencia: '2026-09', anexos: [{ nome: 'holerites.pdf', base64: pdf, mime: 'application/pdf' }] };

describe('validarPedidoEmailDp', () => {
    it('aceita o pedido e devolve os anexos no formato do Graph, com o tamanho', () => {
        const r = validarPedidoEmailDp(base);
        if (!r.ok) throw new Error(r.error);
        expect(r.para).toEqual(['marta@cliente.com.br']);
        expect(r.assunto).toBe('Folha mensal 09/2026 · Exemplo');
        expect(r.anexos).toEqual([{ name: 'holerites.pdf', contentType: 'application/pdf', contentBytes: pdf, bytes: Buffer.from(pdf, 'base64').length }]);
    });

    it('destinatário torto é recusado com o motivo, nunca descartado calado', () => {
        const r = validarPedidoEmailDp({ ...base, para: 'marta07/MD@gmail.com' });
        expect(r.ok).toBe(false);
        expect(r.ok === false && r.status).toBe(400);
        expect(validarPedidoEmailDp({ ...base, para: '' })).toMatchObject({ ok: false, error: expect.stringMatching(/e-mail do cliente/) });
    });

    it('mensagem vazia, anexo inválido e anexos acima de 3 MB são recusados com o caminho', () => {
        expect(validarPedidoEmailDp({ ...base, mensagem: '  ' })).toMatchObject({ ok: false, status: 400 });
        expect(validarPedidoEmailDp({ ...base, anexos: [{ nome: 'x.pdf', base64: 'não é base64!' }] })).toMatchObject({ ok: false, status: 400 });
        const grande = Buffer.alloc(LIMITE_ANEXOS_BYTES + 1).toString('base64');
        expect(validarPedidoEmailDp({ ...base, anexos: [{ nome: 'pacote.zip', base64: grande }] })).toMatchObject({ ok: false, status: 413, error: expect.stringMatching(/anexe pelo Outlook/) });
    });

    it('nome de anexo com caractere que o e-mail recusa é saneado; sem mime vira octet-stream', () => {
        const r = validarPedidoEmailDp({ ...base, anexos: [{ nome: 'PG081005/x.REM', base64: Buffer.from('341').toString('base64') }] });
        expect(r.ok && r.anexos[0]).toMatchObject({ name: 'PG081005_x.REM', contentType: 'application/octet-stream' });
    });
});

describe('montarEmailPacoteDp', () => {
    it('casca da marca com o Departamento Pessoal, selo da competência, texto escapado e a lista do que vai anexo', () => {
        const html = montarEmailPacoteDp({ titulo: 'Folha mensal 09/2026', empresaNome: 'Exemplo', competencia: '2026-09', mensagem: 'Olá <b>Marta</b>\nSegue.', anexos: [{ name: 'holerites.pdf' }] });
        expect(html).toContain(DEPARTAMENTO_DP);
        expect(html).toContain('Competência 09/2026');
        expect(html).toContain('Olá &lt;b&gt;Marta&lt;/b&gt;<br>Segue.');
        expect(html).toContain('Em anexo: holerites.pdf');
        expect(montarEmailPacoteDp({ titulo: 'T', mensagem: 'm' })).toContain('não tem anexos');
    });
});
