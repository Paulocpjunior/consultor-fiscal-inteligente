/**
 * E-mail do Consultor DP ao cliente (rota /api/dp-integration/email/enviar):
 * a parte pura — pedido validado com diagnóstico e corpo com a marca do
 * Departamento Pessoal (mesma régua do CFI e do CCI).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validarPedidoEmailDp, montarEmailPacoteDp, LIMITE_ANEXOS_BASE64, LIMITE_ANEXOS_BYTES, DEPARTAMENTO_DP } from '../sefaz-backend/dp-email-pacote.js';

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

    it('mensagem vazia, anexo inválido e anexos acima do teto são recusados com o caminho', () => {
        expect(validarPedidoEmailDp({ ...base, mensagem: '  ' })).toMatchObject({ ok: false, status: 400 });
        expect(validarPedidoEmailDp({ ...base, anexos: [{ nome: 'x.pdf', base64: 'não é base64!' }] })).toMatchObject({ ok: false, status: 400 });
        const grande = Buffer.alloc(LIMITE_ANEXOS_BYTES + 1).toString('base64');
        expect(validarPedidoEmailDp({ ...base, anexos: [{ nome: 'pacote.zip', base64: grande }] })).toMatchObject({ ok: false, status: 413, error: expect.stringMatching(/anexe pelo Outlook/) });
        expect(validarPedidoEmailDp({ ...base, anexos: [{ nome: 'pacote.zip', base64: Buffer.alloc(LIMITE_ANEXOS_BYTES).toString('base64') }] })).toMatchObject({ ok: true });
    });

    it('o teto cabe no pedido de 4 MB do sendMail junto com o logo inline e o corpo (Codex, CFI #1391)', () => {
        // O que conta para o Graph é o JSON do pedido: anexos em base64 + logo + corpo. O .ics nasce
        // depois, no enviarEmail, que confere o pedido FINAL (graphProviderEnviarEmail.test.ts).
        const logo = readFileSync(join(__dirname, '..', 'sefaz-backend', 'assets', 'sp-logo-email-2x.png')).toString('base64').length;
        const corpo = montarEmailPacoteDp({ titulo: 'x'.repeat(150), empresaNome: 'x'.repeat(150), competencia: '2026-09', mensagem: 'x'.repeat(10000), anexos: Array.from({ length: 10 }, () => ({ name: 'x'.repeat(120) })) }).length;
        expect(Buffer.alloc(LIMITE_ANEXOS_BYTES).toString('base64').length).toBeLessThanOrEqual(LIMITE_ANEXOS_BASE64);
        expect(LIMITE_ANEXOS_BASE64 + logo + corpo + 32 * 1024).toBeLessThan(4 * 1024 * 1024);
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
