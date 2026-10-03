/**
 * 🔐 O LEITOR DE .PFX DO CFI (`sefaz-backend/pkcs12.js`) — trava de 03/10.
 *
 * Substituiu o node-forge (advisory sem correção). Os PFX de teste de
 * `__tests__/fixtures/pfx` foram gerados com o OpenSSL nos formatos que o
 * mundo real usa:
 *   · legado-rc2-3des.pfx — o do Windows/ICP-Brasil antigo: certificado em
 *     RC2-40, chave em 3DES, MAC SHA-1 (o OpenSSL 3 sem provider legado NÃO lê);
 *   · 3des.pfx — tudo em 3DES;
 *   · aes256.pfx — o padrão do OpenSSL 3: PBES2/AES-256, MAC SHA-256;
 *   · sem-cnpj.pfx — CN sem CNPJ, sem cadeia;
 *   · acento-pbes2-bytes.pfx — senha "sênha!" num PBES2 que usa a senha
 *     byte-a-byte (exportador antigo); a senha certa tem de abrir.
 * Todos com a cadeia (AC de teste) junto, exceto o sem-cnpj. Senha: senha123.
 */
import * as crypto from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { abrirPfx, lerCertificado, campoDoNome, rc2DecifrarBlocoParaTeste } from '../sefaz-backend/pkcs12.js';

const DIR = join(__dirname, 'fixtures', 'pfx');
const pfx = (nome: string) => readFileSync(join(DIR, nome));
/** Impressão SHA-256 do certificado de teste, medida pelo OpenSSL ao gerar. */
const FP_FOLHA = '60790ac0a62a6301c8b792bffed26641498c6122ac75dff8a0f912039b864193';

/** A chave assina e o certificado confere — prova de que um é do outro. */
function chaveDoCertificado(pemKey: string, pemCert: string) {
    const sig = crypto.sign('sha256', Buffer.from('cfi'), pemKey);
    return crypto.verify('sha256', Buffer.from('cfi'), pemCert, sig);
}

describe('RC2 (RFC 2268) — os vetores oficiais', () => {
    // [chave, bits efetivos, claro, cifrado] — RFC 2268, seção 5.
    const VETORES: Array<[string, number, string, string]> = [
        ['0000000000000000', 63, '0000000000000000', 'ebb773f993278eff'],
        ['ffffffffffffffff', 64, 'ffffffffffffffff', '278b27e42e2f0d49'],
        ['3000000000000000', 64, '1000000000000001', '30649edf9be7d2c2'],
        ['88', 64, '0000000000000000', '61a8a244adacccf0'],
        ['88bca90e90875a', 64, '0000000000000000', '6ccf4308974c267f'],
        ['88bca90e90875a7f0f79c384627bafb2', 64, '0000000000000000', '1a807d272bbe5db1'],
        ['88bca90e90875a7f0f79c384627bafb2', 128, '0000000000000000', '2269552ab0f85ca6'],
    ];
    it.each(VETORES)('chave %s, %i bits', (chave, bits, claro, cifrado) => {
        expect(rc2DecifrarBlocoParaTeste(Buffer.from(chave, 'hex'), bits, Buffer.from(cifrado, 'hex')).toString('hex')).toBe(claro);
    });
});

describe('abrirPfx — os formatos do mundo real', () => {
    it.each(['legado-rc2-3des.pfx', '3des.pfx', 'aes256.pfx'])('%s: chave, folha e cadeia', (nome) => {
        const r = abrirPfx(pfx(nome), 'senha123');
        expect(chaveDoCertificado(r.pemKey, r.pemCert)).toBe(true);
        expect(r.certificado.fingerprintSha256).toBe(FP_FOLHA);
        expect(campoDoNome(r.certificado.subject, 'CN')).toBe('EMPRESA TESTE CFI, LTDA:11222333000181');
        expect(r.certificado.subject.filter((a) => a.shortName === 'OU').map((a) => a.value))
            .toEqual(['Certificado de TESTE do CFI', 'RFB e-CNPJ A1']);
        expect(campoDoNome(r.certificado.issuer, 'O')).toBe('ICP-Brasil');
        // A AC veio junto e NÃO é a folha, mesmo estando no mesmo arquivo.
        expect(r.cadeia.map((c) => campoDoNome(c.subject, 'CN'))).toEqual(['AC TESTE CFI']);
        // Validade em GeneralizedTime (depois de 2049) lida certa.
        expect(r.certificado.notAfter.getUTCFullYear()).toBe(2126);
        expect(r.pemKey).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
    });

    it('o legado chega MESMO no RC2 (senão o caso que o OpenSSL 3 recusa não é exercitado)', () => {
        // OID pbeWithSHAAnd40BitRC2-CBC (1.2.840.113549.1.12.1.6) no arquivo.
        expect(pfx('legado-rc2-3des.pfx').includes(Buffer.from('060a2a864886f70d010c0106', 'hex'))).toBe(true);
        // E este processo não tem RC2 no OpenSSL — quem decifrou foi o leitor.
        expect(() => crypto.createDecipheriv('rc2-40-cbc', Buffer.alloc(5), Buffer.alloc(8))).toThrow();
    });

    it('a impressão bate com a que o crypto nativo calcula', () => {
        const r = abrirPfx(pfx('aes256.pfx'), 'senha123');
        const nativo = new crypto.X509Certificate(r.pemCert).fingerprint256.replace(/:/g, '').toLowerCase();
        expect(r.certificado.fingerprintSha256).toBe(nativo);
    });

    it('CN sem CNPJ e sem cadeia', () => {
        const r = abrirPfx(pfx('sem-cnpj.pfx'), 'senha123');
        expect(campoDoNome(r.certificado.subject, 'CN')).toBe('SO_NOME_SEM_CNPJ');
        expect(r.cadeia).toEqual([]);
        expect(chaveDoCertificado(r.pemKey, r.pemCert)).toBe(true);
    });

    it('senha com acento abre, inclusive no PBES2 de exportador antigo', () => {
        const r = abrirPfx(pfx('acento-pbes2-bytes.pfx'), 'sênha!');
        expect(chaveDoCertificado(r.pemKey, r.pemCert)).toBe(true);
    });

    it('BER de comprimento indefinido (exportadores que não emitem DER puro)', () => {
        const der = pfx('3des.pfx');
        // Cabeçalho 30 82 LL LL → 30 80 … 00 00. O MAC cobre só o conteúdo.
        expect(der[0]).toBe(0x30);
        expect(der[1]).toBe(0x82);
        const ber = Buffer.concat([Buffer.from([0x30, 0x80]), der.subarray(4), Buffer.from([0, 0])]);
        expect(abrirPfx(ber, 'senha123').certificado.fingerprintSha256).toBe(FP_FOLHA);
    });
});

describe('abrirPfx — erro dito pelo nome', () => {
    it.each(['legado-rc2-3des.pfx', '3des.pfx', 'aes256.pfx'])('%s com senha errada: SENHA_INCORRETA', (nome) => {
        let erro: any;
        try { abrirPfx(pfx(nome), 'errada'); } catch (e) { erro = e; }
        expect(erro?.codigo).toBe('SENHA_INCORRETA');
        // A frase que as rotas (cert-manager, cert-empresa) classificam como senha.
        expect(String(erro?.message)).toMatch(/PKCS#12 MAC could not be verified|Invalid password/);
    });

    it('arquivo que não é PFX: PFX_INVALIDO, não "senha incorreta"', () => {
        let erro: any;
        try { abrirPfx(Buffer.from('isto não é um certificado'), 'senha123'); } catch (e) { erro = e; }
        expect(erro?.codigo).toBe('PFX_INVALIDO');
    });

    it('PFX cortado no meio: PFX_INVALIDO', () => {
        const der = pfx('aes256.pfx');
        let erro: any;
        try { abrirPfx(der.subarray(0, der.length - 40), 'senha123'); } catch (e) { erro = e; }
        expect(erro?.codigo).toBe('PFX_INVALIDO');
    });
});

describe('lerCertificado — PEM e DER dão o mesmo', () => {
    it('lê o PEM que abrirPfx devolve', () => {
        const r = abrirPfx(pfx('3des.pfx'), 'senha123');
        const c = lerCertificado(r.pemCert);
        expect(c.fingerprintSha256).toBe(FP_FOLHA);
        expect(c.notBefore.getTime()).toBeLessThan(c.notAfter.getTime());
        expect(lerCertificado(c.der).subject).toEqual(c.subject);
    });
});
