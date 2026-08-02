/**
 * Casca de e-mail com identidade SP (rito #293) — portada da Legalização.
 * Os dois repos não compartilham código: mudança de layout precisa ser feita
 * NAS DUAS cascas.
 */
import {
    montarLayoutEmail, montarEmailGuia, escaparHtml, textoParaHtml, MARCA, CORES_FAROL,
} from '../sefaz-backend/email-layout.js';

describe('montarLayoutEmail', () => {
    it('sai com logo cid, nome da SP, departamento e faixa da marca', () => {
        const html = montarLayoutEmail({ titulo: 'Teste', conteudoHtml: '<p>oi</p>' });
        expect(html).toContain(`cid:${MARCA.logoCid}`);
        expect(html).toContain('SP Assessoria Contábil');
        expect(html).toContain('Departamento Fiscal');
        expect(html).toContain(CORES_FAROL.marca.de);
    });

    it('CTA só entra com URL http(s) — javascript: é descartado', () => {
        const html = montarLayoutEmail({
            titulo: 'T', conteudoHtml: '',
            ctas: [{ href: 'javascript:alert(1)', texto: 'não' }, { href: 'https://ok.com', texto: 'sim' }],
        });
        expect(html).not.toContain('javascript:');
        expect(html).toContain('https://ok.com');
    });

    it('escapa conteúdo de terceiro no título/selo', () => {
        const html = montarLayoutEmail({ titulo: 'T', conteudoHtml: '', selo: '<img onerror=x>' });
        expect(html).not.toContain('<img onerror');
        expect(html).toContain('&lt;img onerror');
    });
});

describe('montarEmailGuia (rito #293)', () => {
    it('monta selo com competência e vencimento e escapa a mensagem', () => {
        const html = montarEmailGuia({
            tipo: 'DAS Simples Nacional', empresaNome: 'CLIENTE <X> LTDA',
            competencia: '2026-07', vencimento: '20/08/2026',
            mensagem: 'Olá,\nsegue a guia. <b>não-html</b>', temPdf: true,
        });
        expect(html).toContain('Competência 07/2026 · vence 20/08/2026');
        expect(html).toContain('CLIENTE &lt;X&gt; LTDA');
        expect(html).toContain('Olá,<br>segue a guia. &lt;b&gt;não-html&lt;/b&gt;');
        expect(html).toContain('📎 A guia está em anexo');
    });

    it('farol honesto: sem PDF o e-mail AVISA que a guia não foi anexada', () => {
        const html = montarEmailGuia({ tipo: 'DAS', empresaNome: 'X', mensagem: 'm', temPdf: false });
        expect(html).toContain('NÃO pôde ser anexada');
        expect(html).not.toContain('📎 A guia está em anexo');
    });

    it('competência já em MM/AAAA não é invertida de novo', () => {
        const html = montarEmailGuia({ tipo: 'DAS', empresaNome: 'X', mensagem: 'm', competencia: '07/2026', temPdf: true });
        expect(html).toContain('Competência 07/2026');
    });
});

describe('helpers', () => {
    it('textoParaHtml escapa e converte quebras', () => {
        expect(textoParaHtml('a<b\nc')).toBe('a&lt;b<br>c');
    });
    it('escaparHtml cobre aspas', () => {
        expect(escaparHtml(`"x" & 'y'`)).toBe('&quot;x&quot; &amp; &#39;y&#39;');
    });
});
