/**
 * Testes do builder XML DPS (NFS-e Padrao Nacional).
 *
 * O builder e o ponto mais sensivel da implementacao — geramos o XML que vai
 * ASSINADO pro SEFIN. ID DPS errado / campos obrigatorios faltando = 4xx.
 * Esses testes travam a estrutura conhecida (Manual v1.2 + convencao SPED).
 *
 * Limites honestos:
 *  - NAO valido contra o XSD real (PDF do manual retorna 403 sem cert).
 *  - Quando o PRIMEIRO disparo real em prod restrita retornar erro de
 *    schema, ajustamos campos aqui e adicionamos teste novo travando o
 *    fix. Isso e normal em integracao nova.
 */

// @ts-expect-error — modulo .js puro
import { buildDpsXml, gerarIdDps } from '../sefaz-backend/nfse-nacional-dps-builder.js';

const baseReq = {
    empresaId: 'emp123',
    prestador: { cnpj: '44388152000189', im: '12345', nome: 'S&P ASSESSORIA CONTABIL S/S' },
    tomador: { cnpj: '11222333000144', nome: 'EMPRESA TOMADORA LTDA' },
    servico: {
        codigoNbs: '101010100',
        descricao: 'Servicos de contabilidade',
        valor: 1000.00,
        aliquotaIss: 5,
        issRetido: false,
        municipioPrestacao: '3550308',
        cIndOp: '050201',
        cClassTrib: '00000000',
    },
    dataEmissao: '2026-06-04T15:00:00-03:00',
    sequencial: 42,
    serie: 1,
};

describe('gerarIdDps — formato 42 caracteres', () => {
    it('compoe IBGE(7) + tpInsc(1) + CNPJ(14) + serie(5) + numero(15) = 42 chars', () => {
        const id = gerarIdDps({
            ibgeMunicipio: '3550308',
            tipoInscricao: 'CNPJ',
            inscricao: '44388152000189',
            serie: 1,
            numero: 42,
        });
        expect(id).toHaveLength(42);
        expect(id).toBe('3550308' + '2' + '44388152000189' + '00001' + '000000000000042');
    });

    it('zero-pad correto: CNPJ a 14, serie a 5, numero a 15', () => {
        const id = gerarIdDps({
            ibgeMunicipio: '3550308',
            tipoInscricao: 'CNPJ',
            inscricao: '12345678000199',
            serie: 99,
            numero: 1,
        });
        expect(id).toBe('3550308' + '2' + '12345678000199' + '00099' + '000000000000001');
    });

    it('tipoInscricao CPF -> tpInsc=1 (vs CNPJ=2)', () => {
        const idCpf = gerarIdDps({
            ibgeMunicipio: '3550308',
            tipoInscricao: 'CPF',
            inscricao: '12345678901',  // sera padded a 14
            serie: 1,
            numero: 1,
        });
        expect(idCpf.slice(7, 8)).toBe('1');
    });

    it('lança em IBGE invalido', () => {
        expect(() => gerarIdDps({ ibgeMunicipio: '', tipoInscricao: 'CNPJ', inscricao: '44388152000189', serie: 1, numero: 1 }))
            .toThrow(/ibgeMunicipio/);
    });
});

describe('buildDpsXml — estrutura e campos obrigatorios', () => {
    it('produz XML com declaracao + DPS + infDPS', () => {
        const { xml, idDps } = buildDpsXml(baseReq);
        expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
        expect(xml).toContain('<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">');
        expect(xml).toContain(`<infDPS Id="DPS${idDps}">`);
        expect(xml).toContain('</DPS>');
    });

    it('inclui CNPJ do prestador + nome', () => {
        const { xml } = buildDpsXml(baseReq);
        expect(xml).toContain('<CNPJ>44388152000189</CNPJ>');
        expect(xml).toContain('<xNome>S&amp;P ASSESSORIA CONTABIL S/S</xNome>');
    });

    it('escapa entidades XML em todos campos textuais (S&P, aspas)', () => {
        const req = {
            ...baseReq,
            prestador: { ...baseReq.prestador, nome: 'A & B "Cia"' },
            servico: { ...baseReq.servico, descricao: '<script>oi</script>' },
        };
        const { xml } = buildDpsXml(req);
        expect(xml).toContain('A &amp; B &quot;Cia&quot;');
        expect(xml).toContain('&lt;script&gt;oi&lt;/script&gt;');
        expect(xml).not.toContain('<script>oi');
    });

    it('valor e aliquota formatados com 2 casas decimais', () => {
        const { xml } = buildDpsXml({ ...baseReq, servico: { ...baseReq.servico, valor: 1234.5, aliquotaIss: 3 } });
        expect(xml).toContain('<vServ>1234.50</vServ>');
        expect(xml).toContain('<vBC>1234.50</vBC>');
        expect(xml).toContain('<pAliq>3.00</pAliq>');
        // ISS = 1234.50 * 3% = 37.035 -> 37.04 (toFixed arredonda half-up)
        expect(xml).toMatch(/<vISSQN>37\.0[34]<\/vISSQN>/);
    });

    it('tomador CNPJ vs CPF mutuamente exclusivos', () => {
        const reqCpf = { ...baseReq, tomador: { cpf: '12345678901', nome: 'PESSOA FISICA' } };
        const { xml: xmlCpf } = buildDpsXml(reqCpf);
        expect(xmlCpf).toContain('<CPF>12345678901</CPF>');
        // No bloco do tomador, NAO deve aparecer CNPJ
        const tomadorBlock = xmlCpf.match(/<toma>([\s\S]*?)<\/toma>/)?.[1] || '';
        expect(tomadorBlock).not.toMatch(/<CNPJ>/);
    });

    it('tomador sem CPF nem CNPJ -> <NIFNaoInformado/>', () => {
        const reqSem = { ...baseReq, tomador: { nome: 'CONSUMIDOR NAO IDENTIFICADO' } };
        const { xml } = buildDpsXml(reqSem);
        expect(xml).toContain('<NIFNaoInformado/>');
    });

    it('ISS retido -> tpRetISSQN=1, senao 2', () => {
        const { xml: xmlNaoRetido } = buildDpsXml(baseReq);
        expect(xmlNaoRetido).toContain('<tpRetISSQN>2</tpRetISSQN>');
        const { xml: xmlRetido } = buildDpsXml({ ...baseReq, servico: { ...baseReq.servico, issRetido: true } });
        expect(xmlRetido).toContain('<tpRetISSQN>1</tpRetISSQN>');
    });

    it('ambiente=producao -> tpAmb=1, default homologacao -> tpAmb=2', () => {
        const { xml: xmlHomol } = buildDpsXml({ ...baseReq, ambiente: 'homologacao' });
        expect(xmlHomol).toContain('<tpAmb>2</tpAmb>');
        const { xml: xmlProd } = buildDpsXml({ ...baseReq, ambiente: 'producao' });
        expect(xmlProd).toContain('<tpAmb>1</tpAmb>');
    });

    it('endereco do tomador eh opcional', () => {
        const { xml: xmlSemEnd } = buildDpsXml(baseReq);
        expect(xmlSemEnd).not.toContain('<end>');
        const reqComEnd = {
            ...baseReq,
            tomador: {
                ...baseReq.tomador,
                endereco: {
                    logradouro: 'RUA TESTE', numero: '123', bairro: 'CENTRO',
                    codigoMunicipioIbge: '3550308', uf: 'SP', cep: '01000-000',
                },
            },
        };
        const { xml: xmlComEnd } = buildDpsXml(reqComEnd);
        expect(xmlComEnd).toContain('<xLgr>RUA TESTE</xLgr>');
        expect(xmlComEnd).toContain('<CEP>01000000</CEP>');
        expect(xmlComEnd).toContain('<cPais>1058</cPais>');
    });

    it('lança em campos obrigatorios faltando', () => {
        expect(() => buildDpsXml({ ...baseReq, prestador: { cnpj: '' } as any })).toThrow(/prestador\.cnpj/);
        expect(() => buildDpsXml({ ...baseReq, tomador: { nome: '' } as any })).toThrow(/tomador\.nome/);
        expect(() => buildDpsXml({ ...baseReq, servico: { ...baseReq.servico, descricao: '' } })).toThrow(/descricao/);
        expect(() => buildDpsXml({ ...baseReq, servico: { ...baseReq.servico, valor: 0 } })).toThrow(/valor/);
    });

    it('ID DPS gerado bate com gerarIdDps independente', () => {
        const { idDps } = buildDpsXml(baseReq);
        const idEsperado = gerarIdDps({
            ibgeMunicipio: '3550308',
            tipoInscricao: 'CNPJ',
            inscricao: '44388152000189',
            serie: 1,
            numero: 42,
        });
        expect(idDps).toBe(idEsperado);
    });
});
