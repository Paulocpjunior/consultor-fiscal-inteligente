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
});
