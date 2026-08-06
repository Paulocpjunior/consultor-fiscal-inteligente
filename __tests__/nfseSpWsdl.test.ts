// @ts-expect-error — módulo .js puro (sem tipos)
import { extrairContratoWsdl, conferirContrato, parametrosDoEnvelope, elementoDaMensagem } from '../sefaz-backend/nfse-sp-wsdl';

/**
 * O erro 1102 diz "Mensagem XML de Pedido do serviço sem conteúdo": o parâmetro
 * chegou VAZIO ao método. Num serviço ASMX a causa clássica é nome de parâmetro
 * que não bate — o .NET não acha o elemento, deixa a string nula e responde
 * "sem conteúdo".
 *
 * Isso não se descobre adivinhando: layout de fisco não se inventa (mesma regra
 * do código de receita da GNRE e do IVA-ST). A fonte é o ?WSDL publicado pela
 * própria Prefeitura.
 */
const WSDL = `<?xml version="1.0"?>
<wsdl:definitions xmlns:s="http://www.w3.org/2001/XMLSchema" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">
 <wsdl:types><s:schema targetNamespace="http://www.prefeitura.sp.gov.br/nfe">
  <s:element name="ConsultaNFeEmitidas">
    <s:complexType><s:sequence>
      <s:element minOccurs="1" maxOccurs="1" name="VersaoSchema" type="s:int"/>
      <s:element minOccurs="0" maxOccurs="1" name="MensagemXML" type="s:string"/>
    </s:sequence></s:complexType>
  </s:element>
 </s:schema></wsdl:types>
 <wsdl:binding name="lotenfeSoap">
  <wsdl:operation name="ConsultaNFeEmitidas">
   <soap:operation soapAction="http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFeEmitidas" style="document"/>
  </wsdl:operation>
 </wsdl:binding>
</wsdl:definitions>`;

const ENVELOPE = (p1 = 'VersaoSchema', p2 = 'MensagemXML') => `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<ConsultaNFeEmitidas xmlns="http://www.prefeitura.sp.gov.br/nfe">
<${p1}>1</${p1}><${p2}><![CDATA[<Pedido/>]]></${p2}>
</ConsultaNFeEmitidas></soap:Body></soap:Envelope>`;

describe('contrato publicado pela Prefeitura (?WSDL)', () => {
    it('extrai os parâmetros na ordem e a SOAPAction', () => {
        const c = extrairContratoWsdl(WSDL, 'ConsultaNFeEmitidas');
        expect(c.encontrada).toBe(true);
        expect(c.parametros.map((p: any) => p.nome)).toEqual(['VersaoSchema', 'MensagemXML']);
        expect(c.parametros[0].tipo).toBe('s:int');
        expect(c.soapAction).toBe('http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFeEmitidas');
    });

    it('operação inexistente diz que NÃO está no WSDL', () => {
        const c = extrairContratoWsdl(WSDL, 'ConsultaNFeInventada');
        expect(c.encontrada).toBe(false);
        expect(c.motivo).toMatch(/não declara a operação/);
    });

    it('WSDL vazio não inventa contrato', () => {
        expect(extrairContratoWsdl('', 'X').encontrada).toBe(false);
    });
});

describe('parametrosDoEnvelope', () => {
    it('lê os nomes que realmente saem do CFI', () => {
        expect(parametrosDoEnvelope(ENVELOPE(), 'ConsultaNFeEmitidas')).toEqual(['VersaoSchema', 'MensagemXML']);
    });
});

describe('conferir o que enviamos contra o contrato', () => {
    const contrato = extrairContratoWsdl(WSDL, 'ConsultaNFeEmitidas');
    const action = 'http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFeEmitidas';

    it('tudo batendo: aponta que a causa do 1102 é o CONTEÚDO, não o envelope', () => {
        const r = conferirContrato({
            contrato,
            enviados: parametrosDoEnvelope(ENVELOPE(), 'ConsultaNFeEmitidas'),
            soapActionEnviada: action,
        });
        expect(r.ok).toBe(true);
        expect(r.motivo).toMatch(/a causa do 1102 é o CONTEÚDO/);
    });

    it('CAIXA diferente é o caso traiçoeiro — o serviço lê o campo VAZIO', () => {
        const r = conferirContrato({
            contrato,
            enviados: parametrosDoEnvelope(ENVELOPE('VersaoSchema', 'MensagemXml'), 'ConsultaNFeEmitidas'),
            soapActionEnviada: action,
        });
        expect(r.ok).toBe(false);
        expect(r.divergenciaDeCaixa).toEqual([{ enviado: 'MensagemXml', esperado: 'MensagemXML' }]);
        expect(r.motivo).toMatch(/exatamente o erro 1102/);
        // Não pode aparecer nas duas listas: seria o mesmo problema contado 2×.
        expect(r.faltando).toEqual([]);
        expect(r.sobrando).toEqual([]);
    });

    it('parâmetro que o WSDL exige e não mandamos aparece nomeado', () => {
        const r = conferirContrato({ contrato, enviados: ['MensagemXML'], soapActionEnviada: action });
        expect(r.faltando).toEqual(['VersaoSchema']);
    });

    it('SOAPAction divergente é apontada', () => {
        const r = conferirContrato({
            contrato,
            enviados: ['VersaoSchema', 'MensagemXML'],
            soapActionEnviada: 'http://www.prefeitura.sp.gov.br/nfe/ConsultaNFeEmitidas',
        });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/SOAPAction enviada/);
    });

    it('sem contrato lido, NÃO conclui nada (não é "está tudo certo")', () => {
        const r = conferirContrato({
            contrato: { encontrada: false, parametros: [], motivo: 'WSDL não veio (HTTP 500).' },
            enviados: ['VersaoSchema'],
            soapActionEnviada: action,
        });
        expect(r.ok).toBe(false);
        expect(r.conclusivo).toBe(false);
        expect(r.motivo).toMatch(/WSDL não veio/);
    });
});

/**
 * Teste do Paulo em 06/08: o WSDL baixou, mas o leitor disse "sem a sequência
 * de parâmetros no formato esperado" — e o trecho cru mostrou que a 1ª menção
 * ao nome já era a <wsdl:operation>. Ou seja, os TIPOS não estão no WSDL: a
 * seção <types> importa o schema de outro documento (padrão ASMX ?xsd=1), e o
 * elemento a procurar vem pela cadeia message → part → element.
 */
describe('WSDL sem tipos embutidos (caso real da Prefeitura)', () => {
    const SO_OPERACOES = `<wsdl:definitions>
      <wsdl:types><s:schema><s:import namespace="x" schemaLocation="https://nfews.prefeitura.sp.gov.br/lotenfe.asmx?xsd=1"/></s:schema></wsdl:types>
      <wsdl:message name="ConsultaNFeEmitidasSoapIn"><wsdl:part name="parameters" element="tns:ConsultaNFeEmitidas"/></wsdl:message>
      <wsdl:portType><wsdl:operation name="ConsultaNFeEmitidas">
        <wsdl:input message="tns:ConsultaNFeEmitidasSoapIn" />
      </wsdl:operation></wsdl:portType>
    </wsdl:definitions>`;

    it('sem o schema importado, NÃO conclui — e diz qual elemento procurou', () => {
        const c = extrairContratoWsdl(SO_OPERACOES, 'ConsultaNFeEmitidas');
        expect(c.encontrada).toBe(false);
        expect(c.elementoProcurado).toBe('ConsultaNFeEmitidas');
        const r = conferirContrato({ contrato: c, enviados: ['VersaoSchema'], soapActionEnviada: null });
        expect(r.conclusivo).toBe(false);
    });

    it('com o schema importado anexado, lê os parâmetros', () => {
        const XSD = `<s:schema><s:element name="ConsultaNFeEmitidas"><s:complexType><s:sequence>
          <s:element name="VersaoSchema" type="s:int"/><s:element name="MensagemXML" type="s:string"/>
        </s:sequence></s:complexType></s:element></s:schema>`;
        const c = extrairContratoWsdl(`${SO_OPERACOES}\n${XSD}`, 'ConsultaNFeEmitidas');
        expect(c.encontrada).toBe(true);
        expect(c.parametros.map((p: any) => p.nome)).toEqual(['VersaoSchema', 'MensagemXML']);
    });

    it('a cadeia message → part → element manda quando o nome do tipo difere', () => {
        const w = `<wsdl:message name="ConsultaNFeEmitidasSoapIn"><wsdl:part element="tns:PedidoEmitidas"/></wsdl:message>
          <s:element name="PedidoEmitidas"><s:complexType><s:sequence>
            <s:element name="VersaoSchema" type="s:int"/></s:sequence></s:complexType></s:element>`;
        expect(elementoDaMensagem(w, 'ConsultaNFeEmitidas')).toBe('PedidoEmitidas');
        expect(extrairContratoWsdl(w, 'ConsultaNFeEmitidas').encontrada).toBe(true);
    });
});
