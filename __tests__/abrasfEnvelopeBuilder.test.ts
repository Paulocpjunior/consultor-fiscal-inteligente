// @ts-nocheck
import {
    montarConsultarServicoTomado,
    montarConsultarServicoPrestado,
    envelopeSoap,
    soapActionHeader,
} from '../sefaz-backend/abrasf/envelope-builder.js';

describe('montarConsultarServicoTomado', () => {
    it('monta corpo valido com CNPJ + IM + periodo', () => {
        const xml = montarConsultarServicoTomado({
            cnpjTomador: '11.222.333/0001-81',
            inscricaoMunicipal: '123456',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
            pagina: 1,
        });
        expect(xml).toContain('<ConsultarNfseServicoTomadoEnvio');
        expect(xml).toContain('xmlns="http://www.abrasf.org.br/nfse.xsd"');
        expect(xml).toContain('<Cnpj>11222333000181</Cnpj>');
        expect(xml).toContain('<InscricaoMunicipal>123456</InscricaoMunicipal>');
        expect(xml).toContain('<DataInicial>2026-06-01</DataInicial>');
        expect(xml).toContain('<DataFinal>2026-06-30</DataFinal>');
        expect(xml).toContain('<Pagina>1</Pagina>');
    });

    it('omite IM se nao fornecida', () => {
        const xml = montarConsultarServicoTomado({
            cnpjTomador: '11222333000181',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
        });
        expect(xml).not.toContain('InscricaoMunicipal');
        expect(xml).toContain('<Pagina>1</Pagina>'); // default
    });

    it('aceita Date como dataInicial/dataFinal', () => {
        const xml = montarConsultarServicoTomado({
            cnpjTomador: '11222333000181',
            dataInicial: new Date('2026-06-01T00:00:00Z'),
            dataFinal: new Date('2026-06-30T00:00:00Z'),
        });
        expect(xml).toContain('<DataInicial>2026-06-01</DataInicial>');
        expect(xml).toContain('<DataFinal>2026-06-30</DataFinal>');
    });

    it('escapa caracteres XML em IM (se houver)', () => {
        const xml = montarConsultarServicoTomado({
            cnpjTomador: '11222333000181',
            inscricaoMunicipal: 'A&B<C',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
        });
        expect(xml).toContain('A&amp;B&lt;C');
    });

    it('lanca erro com CNPJ invalido', () => {
        expect(() => montarConsultarServicoTomado({
            cnpjTomador: '123',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
        })).toThrow('cnpjTomador deve ter 14 digitos');
    });

    it('lanca erro com data invalida', () => {
        expect(() => montarConsultarServicoTomado({
            cnpjTomador: '11222333000181',
            dataInicial: 'data-ruim',
            dataFinal: '2026-06-30',
        })).toThrow('data invalida');
    });
});

describe('montarConsultarServicoPrestado', () => {
    it('usa Prestador em vez de Consulente', () => {
        const xml = montarConsultarServicoPrestado({
            cnpjPrestador: '11222333000181',
            inscricaoMunicipal: '123456',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
        });
        expect(xml).toContain('<ConsultarNfseServicoPrestadoEnvio');
        expect(xml).toContain('<Prestador>');
        expect(xml).not.toContain('<Consulente>');
    });
});

describe('envelopeSoap', () => {
    const payload = '<ConsultarNfseServicoTomadoEnvio xmlns="x">...</ConsultarNfseServicoTomadoEnvio>';

    it('formato soap11-padrao envolve em soap:Envelope 1.1', () => {
        const env = envelopeSoap({ formato: 'soap11-padrao', payloadAbrasf: payload });
        expect(env).toContain('<?xml version="1.0"');
        expect(env).toContain('http://schemas.xmlsoap.org/soap/envelope/');
        expect(env).toContain('<soap:Body>');
        expect(env).toContain(payload);
    });

    it('formato soap12-padrao usa SOAP 1.2', () => {
        const env = envelopeSoap({ formato: 'soap12-padrao', payloadAbrasf: payload });
        expect(env).toContain('http://www.w3.org/2003/05/soap-envelope');
        expect(env).toContain('<soap12:Envelope');
    });

    it('formato soap11-cdata envolve payload em CDATA', () => {
        const env = envelopeSoap({
            formato: 'soap11-cdata',
            payloadAbrasf: payload,
            operacao: 'ConsultarNfseServicoTomado',
        });
        expect(env).toContain('<nfse:ConsultarNfseServicoTomadoRequest>');
        expect(env).toContain('<![CDATA[');
        expect(env).toContain(payload);
        expect(env).toContain(']]>');
    });

    it('formato desconhecido cai no soap11-padrao', () => {
        const env = envelopeSoap({ formato: 'inexistente', payloadAbrasf: payload });
        expect(env).toContain('<soap:Body>');
    });
});

describe('soapActionHeader', () => {
    it('mantem SOAPAction se ja termina com a operacao', () => {
        const h = soapActionHeader(
            { soapAction: 'http://abc/ConsultarNfseServicoTomado' },
            'ConsultarNfseServicoTomado'
        );
        expect(h).toBe('http://abc/ConsultarNfseServicoTomado');
    });

    it('substitui ultimo segmento se for operacao diferente', () => {
        const h = soapActionHeader(
            { soapAction: 'http://abc/GerarNfse' },
            'ConsultarNfseServicoTomado'
        );
        expect(h).toBe('http://abc/ConsultarNfseServicoTomado');
    });

    it('append operacao se SOAPAction termina com /', () => {
        const h = soapActionHeader(
            { soapAction: 'http://abc/' },
            'ConsultarNfseServicoTomado'
        );
        expect(h).toBe('http://abc/ConsultarNfseServicoTomado');
    });

    it('fallback se config nao tem SOAPAction', () => {
        const h = soapActionHeader({}, 'ConsultarNfseServicoTomado');
        expect(h).toBe('http://www.abrasf.org.br/nfse/ConsultarNfseServicoTomado');
    });
});
