/**
 * FASE 4 DO TÚNEL: o CFI assina e transmite o EFD-Reinf — a chave não viaja.
 *
 * O assinador e o lote são PORTES de código que já transmitiu de verdade
 * (plano-contas-iob, R-1000/R-4010 homologados). O que os testes trancam:
 *
 * 1. A assinatura VALIDA de verdade (certificado real gerado com forge,
 *    assina e verifica) — inclusive para eventos que o código antigo não
 *    conhecia (evtRetPJ do R-4020): a generalização é o motivo do gateway.
 * 2. As lições MS0017 não regridem: minifica antes, wrapper não repete id.
 * 3. Produção exige confirmação explícita — entrega não se desfaz.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { assinarEventoReinf, verificarAssinaturaReinf, extrairEvento, montarLote, normalizarXmlEvento, extrairProtocolo, extrairCdResposta, resolverAmbiente, extrairPemDoPfx, NS_LOTE } from '../sefaz-backend/reinf-gateway';
// @ts-expect-error — node-forge sem @types instalado
import * as forge from 'node-forge';

// ─── um A1 de mentira, mas criptograficamente REAL ──────────────────────────
function gerarCert() {
    const chaves = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = chaves.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2026-01-01');
    cert.validity.notAfter = new Date('2027-01-01');
    const attrs = [{ name: 'commonName', value: 'SP ASSESSORIA CONTABIL LTDA:44388152000189' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(chaves.privateKey, forge.md.sha256.create());
    return {
        pemKey: forge.pki.privateKeyToPem(chaves.privateKey),
        pemCert: forge.pki.certificateToPem(cert),
        forgeCert: cert,
        forgeKey: chaves.privateKey,
    };
}
const CERT = gerarCert();

const ID = 'ID1443881520001892026080810300000001';
const evtRetPJ = (id = ID) => `<?xml version="1.0" encoding="UTF-8"?>
<Reinf xmlns="http://www.reinf.esocial.gov.br/schemas/evt4020PagtoBeneficiarioPJ/v2_01_02">
  <evtRetPJ id="${id}">
    <ideEvento><perApur>2026-07</perApur><tpAmb>2</tpAmb><procEmi>1</procEmi><verProc>cfi-gateway</verProc></ideEvento>
    <ideContri><tpInsc>1</tpInsc><nrInsc>44388152</nrInsc></ideContri>
  </evtRetPJ>
</Reinf>`;

describe('a generalização que é o motivo do gateway', () => {
    it('acha o elemento pelo id, sem lista de nomes — evtRetPJ incluso', () => {
        expect(extrairEvento(evtRetPJ())).toEqual({ elemento: 'evtRetPJ', id: ID });
    });

    it('evento sem id de 34 dígitos é recusado com a explicação', () => {
        expect(() => extrairEvento('<Reinf><evtRetPJ id="X1"/></Reinf>')).toThrow(/ID\+34 dígitos/);
    });
});

describe('assinar de verdade, e provar', () => {
    it('assina o evtRetPJ e a assinatura VERIFICA', () => {
        const assinado = assinarEventoReinf(evtRetPJ(), CERT);
        expect(assinado).toContain('<Signature');
        expect(assinado).toContain(`URI="#${ID}"`);
        expect(verificarAssinaturaReinf(assinado, CERT).ok).toBe(true);
    });

    it('a lição do MS0017: o assinado sai MINIFICADO', () => {
        const assinado = assinarEventoReinf(evtRetPJ(), CERT);
        expect(assinado).not.toMatch(/>\s+</);
    });

    it('evento adulterado depois de assinado NÃO verifica', () => {
        const assinado = assinarEventoReinf(evtRetPJ(), CERT);
        const adulterado = assinado.replace('2026-07', '2026-08');
        expect(verificarAssinaturaReinf(adulterado, CERT).ok).toBe(false);
    });

    it('evento que JÁ veio assinado é recusado — o gateway assina, não re-assina', () => {
        const assinado = assinarEventoReinf(evtRetPJ(), CERT);
        expect(() => assinarEventoReinf(assinado, CERT)).toThrow(/já veio assinado/);
    });
});

describe('o lote e as lições que não regridem', () => {
    const assinado = () => assinarEventoReinf(evtRetPJ(), CERT);

    it('monta com ideContribuinte e o namespace do lote assíncrono', () => {
        const lote = montarLote([assinado()], { tpInsc: 1, nrInsc: '44388152' });
        expect(lote).toContain(NS_LOTE);
        expect(lote).toContain('<nrInsc>44388152</nrInsc>');
    });

    it('o wrapper <evento Id> NÃO repete o id assinado — Reference ambígua cai com MS0017', () => {
        const lote = montarLote([assinado()], { tpInsc: 1, nrInsc: '44388152' });
        const wrapper = lote.match(/<evento Id="([^"]+)"/)![1];
        expect(wrapper).not.toBe(ID);
        expect(lote).toContain(`id="${ID}"`);
    });

    it('id duplicado no lote é RECUSA, não conserto — reescrever alteraria o assinado', () => {
        const a = assinado();
        expect(() => montarLote([a, a], { tpInsc: 1, nrInsc: '44388152' })).toThrow(/duplicado/);
    });

    it('contribuinte torto é recusado antes de qualquer rede', () => {
        expect(() => montarLote([assinado()], { tpInsc: 3, nrInsc: '44388152' })).toThrow(/tpInsc/);
        expect(() => montarLote([assinado()], { tpInsc: 1, nrInsc: '123' })).toThrow(/nrInsc/);
        expect(() => montarLote([], { tpInsc: 1, nrInsc: '44388152' })).toThrow(/vazia/);
    });
});

describe('a trava de ambiente: produção não entra por acidente', () => {
    it('sem nada, o padrão é produção restrita', () => {
        expect(resolverAmbiente({})).toEqual({ ok: true, tpAmb: 2 });
    });

    it('produção SEM confirmação é recusada dizendo o que falta', () => {
        const r = resolverAmbiente({ tpAmb: 1 });
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/confirmoProducao/);
        expect(r.erro).toMatch(/não se desfaz/);
    });

    it('produção COM confirmação explícita passa', () => {
        expect(resolverAmbiente({ tpAmb: 1, confirmoProducao: true })).toEqual({ ok: true, tpAmb: 1 });
    });

    it('ambiente inventado é recusado', () => {
        expect(resolverAmbiente({ tpAmb: 3 }).ok).toBe(false);
    });
});

describe('parsers da resposta da Receita', () => {
    it('protocolo sai com ou sem prefixo de namespace', () => {
        expect(extrairProtocolo('<ns:protocoloEnvio>2.2026.123</ns:protocoloEnvio>')).toBe('2.2026.123');
        expect(extrairProtocolo('<protocolo>9.9</protocolo>')).toBe('9.9');
        expect(extrairProtocolo('<retorno/>')).toBeNull();
    });

    it('cdResposta vira número, ausência vira null', () => {
        expect(extrairCdResposta('<cdResposta>7</cdResposta>')).toBe(7);
        expect(extrairCdResposta('')).toBeNull();
    });
});

describe('o pfx do cofre vira PEM — o caminho real do certificado', () => {
    it('extrai chave e certificado de um PKCS#12 de verdade', () => {
        const p12 = forge.pkcs12.toPkcs12Asn1(CERT.forgeKey, [CERT.forgeCert], 'senha123', { algorithm: '3des' });
        const pfxBuffer = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
        const { pemKey, pemCert } = extrairPemDoPfx(pfxBuffer, 'senha123');
        expect(pemKey).toContain('PRIVATE KEY');
        expect(pemCert).toContain('CERTIFICATE');
        // e o PEM extraído ASSINA — o ciclo inteiro do cofre ao XMLDSig.
        const assinado = assinarEventoReinf(evtRetPJ(), { pemKey, pemCert });
        expect(verificarAssinaturaReinf(assinado, { pemCert }).ok).toBe(true);
    });

    it('senha errada não passa em silêncio', () => {
        const p12 = forge.pkcs12.toPkcs12Asn1(CERT.forgeKey, [CERT.forgeCert], 'senha123', { algorithm: '3des' });
        const pfxBuffer = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
        expect(() => extrairPemDoPfx(pfxBuffer, 'errada')).toThrow();
    });
});

describe('minificação', () => {
    it('tira comentário e espaço entre tags, preserva conteúdo', () => {
        expect(normalizarXmlEvento('<a>\n  <!-- x -->\n  <b>1 2</b>\n</a>')).toBe('<a><b>1 2</b></a>');
    });
});
