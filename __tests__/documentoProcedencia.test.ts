// ============================================================================
// Procedência do documento — o crash ao abrir a NFS-e do portal.
//
// Caso real (07/08, ELS COMERCIO DE BANANAS, nota 55758/1): clicar na nota
// derrubava a tela com "Cannot read properties of undefined (reading 'slice')".
// O erro era `d.xmlHash.slice(0, 16)`, mas a causa é mais funda: a tela
// assumia que TODO documento veio de um arquivo XML. A NFS-e do portal entra
// por CSV/TXT — não tem XML, não tem hash, não tem chave de 44 dígitos.
//
// Por isso a correção não é um `?.`: campo vazio sem explicação faz o
// colaborador procurar um problema que não existe.
// ============================================================================
import { procedenciaDoDocumento, hashCurto, dataLegivel } from '../services/documentoProcedencia';

describe('o que NÃO estoura mais', () => {
    test('hash ausente vira null, não exceção', () => {
        expect(hashCurto(undefined)).toBeNull();
        expect(hashCurto(null)).toBeNull();
        expect(hashCurto('')).toBeNull();
    });

    test('hash presente é encurtado', () => {
        expect(hashCurto('abcdef0123456789xyz')).toBe('abcdef0123456789…');
    });

    test('data ausente vira null em vez de "Invalid Date"', () => {
        expect(dataLegivel(undefined)).toBeNull();
        expect(dataLegivel('')).toBeNull();
        expect(dataLegivel('não é data')).toBeNull();
        expect(dataLegivel('2026-07-06T10:00:00Z')).toContain('2026');
    });
});

describe('a NFS-e do portal: ausência é natureza, não falha', () => {
    const nfsePortal = { tipoDoc: 'NFSe', origem: 'portal', numero: '55758/1' };

    test('não tem XML nem chave, e a tela DIZ por quê', () => {
        const p = procedenciaDoDocumento(nfsePortal);
        expect(p.temXml).toBe(false);
        expect(p.temChave).toBe(false);
        expect(p.explicacao).toMatch(/natureza do documento, não falha de captura/);
    });

    test('a explicação nomeia o trilho — CSV\\/TXT', () => {
        expect(procedenciaDoDocumento(nfsePortal).explicacao).toMatch(/CSV\/TXT/);
    });
});

describe('quando a ausência É suspeita', () => {
    test('NF-e sem XML guardado vira alerta, não silêncio', () => {
        const p = procedenciaDoDocumento({ tipoDoc: 'NFe', origem: 'sefaz', chave: '3'.repeat(44) });
        expect(p.temXml).toBe(false);
        expect(p.explicacao).toMatch(/anormal/);
        expect(p.explicacao).toMatch(/Erros & Logs/);
    });

    test('a distinção é o ponto: mesma ausência, leituras opostas', () => {
        const nfse = procedenciaDoDocumento({ tipoDoc: 'NFSe', origem: 'portal' });
        const nfe = procedenciaDoDocumento({ tipoDoc: 'NFe', origem: 'sefaz' });
        expect(nfse.explicacao).not.toMatch(/anormal/);
        expect(nfe.explicacao).toMatch(/anormal/);
    });
});

describe('documento completo não ganha explicação inventada', () => {
    test('com XML e chave, nada a explicar', () => {
        const p = procedenciaDoDocumento({
            tipoDoc: 'NFe', chave: '3'.repeat(44), xmlHash: 'abc123', storageUrl: 'https://x/y.xml',
        });
        expect(p.temXml).toBe(true);
        expect(p.temChave).toBe(true);
        expect(p.explicacao).toBeNull();
    });

    test('XML guardado no Storage conta, mesmo sem hash', () => {
        const p = procedenciaDoDocumento({ tipoDoc: 'NFe', chave: '3'.repeat(44), storagePath: 'xmls/a.xml' });
        expect(p.temXml).toBe(true);
    });

    test('chave com máscara ainda é chave', () => {
        const p = procedenciaDoDocumento({
            tipoDoc: 'NFe', xmlHash: 'h', chave: '3526 0600 0054 3000 0104 5500 1000 4252 3111 7845 6640',
        });
        expect(p.temChave).toBe(true);
    });

    test('chave curta NÃO passa por chave', () => {
        expect(procedenciaDoDocumento({ tipoDoc: 'NFe', xmlHash: 'h', chave: '12345' }).temChave).toBe(false);
    });
});
