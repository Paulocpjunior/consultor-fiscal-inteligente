import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fonte = (arquivo: string) => readFileSync(join(__dirname, '..', arquivo), 'utf8');

describe('logs de integrações fiscais não persistem payloads sensíveis', () => {
    it('NFS-e SP registra metadados, não XML, SOAP, CNPJ ou CCM', () => {
        const codigo = fonte('sefaz-backend/nfse-sp-client.js');
        expect(codigo).not.toMatch(/console\.(?:log|error|warn)\([^\n]*(?:xmlInterno[^\n]*:\s*\$\{xmlInterno\}|xmlAssinado\.slice|SOAP-COMPLETO[^\n]*::|cnpjRemetente=|CCM=)/i);
        expect(codigo).not.toMatch(/console\.(?:log|error|warn)\([^\n]*body[^\n]*slice/i);
    });

    it('DistDFe não imprime envelope nem corpo fiscal', () => {
        const codigo = fonte('sefaz-backend/sefaz-client.js');
        expect(codigo).not.toMatch(/console\.(?:log|error|warn)\(envelope/i);
        expect(codigo).not.toMatch(/response\.body\.slice/);
    });

    it('login headless remove query string antes de registrar URLs', () => {
        const codigo = fonte('sefaz-backend/nfse-sp-headless-login.js');
        expect(codigo).toMatch(/function urlSemSegredos/);
        expect(codigo).not.toMatch(/console\.(?:log|error|warn)\([^\n]*\$\{url(?:Pos|Final)\}/);
    });

    // ═══ O LADO POSITIVO ═══════════════════════════════════════════════════
    // As asserções acima só dizem o que NÃO pode aparecer — e um arquivo que
    // deixasse de logar URL nenhuma passaria verde sem o sanitizador existir.
    // Aqui se prova que o sanitizador EXISTE e é CHAMADO em cada caminho que
    // registra URL/corpo.
    it('headless: toda URL que vai ao log passa por urlSemSegredos', () => {
        const codigo = fonte('sefaz-backend/nfse-sp-headless-login.js');
        const linhasComUrl = codigo
            .split('\n')
            .filter((l) => /console\.(?:log|error|warn)\(/.test(l))
            .filter((l) => /\$\{[^}]*url[^}]*\}|\.url\(\)/i.test(l));
        // Se ninguém logasse URL, a trava não teria o que provar.
        expect(linhasComUrl.length).toBeGreaterThanOrEqual(3);
        for (const linha of linhasComUrl) {
            expect(linha).toMatch(/urlSemSegredos\(/);
        }
        // E o sanitizador tira a query string de verdade (é ali que mora o token).
        const corpo = codigo.match(/function urlSemSegredos[\s\S]*?\n\}/)?.[0] || '';
        expect(corpo).toMatch(/u\.origin/);
        expect(corpo).toMatch(/u\.pathname/);
        expect(corpo).not.toMatch(/u\.(search|href)/); // query string e URL inteira NÃO saem
    });

    it('NFS-e SP e DistDFe: corpo/envelope só entram no log como TAMANHO', () => {
        const nfse = fonte('sefaz-backend/nfse-sp-client.js');
        const sefaz = fonte('sefaz-backend/sefaz-client.js');
        // O caminho de erro HTTP existe e diz explicitamente que omitiu o corpo.
        expect(nfse).toMatch(/corpo omitido; bytes=/);
        expect(sefaz).toMatch(/envelope omitido; bytes=/);
        // Toda linha de log que cita body/soap/envelope só imprime comprimento.
        for (const [nome, codigo] of [['nfse-sp-client', nfse], ['sefaz-client', sefaz]] as const) {
            const linhas = codigo
                .split('\n')
                .filter((l) => /console\.(?:log|error|warn)\(/.test(l))
                // Só a linha que INTERPOLA a variável (`${body…}`, `, body…`, `+ (soap`)
                // — aviso em texto puro ("vai QUEBRAR o CDATA do envelope") não carrega dado.
                .filter((l) => /\$\{[^}]*\b(body|soap|envelope)\w*|[,+]\s*\(?\b(body|soap|envelope)\w*/i.test(l));
            expect({ nome, linhas: linhas.length > 0 }).toEqual({ nome, linhas: true });
            for (const linha of linhas) {
                expect({ nome, linha, soTamanho: /\.length|bytes=|omitido/.test(linha) }).toEqual({ nome, linha, soTamanho: true });
            }
        }
    });
});
