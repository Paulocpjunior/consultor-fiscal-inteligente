// @ts-nocheck
import { parseRespostaConsulta } from '../sefaz-backend/abrasf/parser-nfse.js';

const NS = 'http://www.abrasf.org.br/nfse.xsd';

function respostaComUmaNfse(over: Record<string, string> = {}) {
    const o: Record<string, string> = {
        numero: '123', codigoVerificacao: 'ABC1234567',
        dataEmissao: '2026-06-15T10:00:00',
        valorServicos: '1000.00', aliquota: '5.00', valorIss: '50.00',
        issRetido: '2',
        prestadorCnpj: '11222333000181',
        prestadorIm: '999',
        prestadorNome: 'Prestador Demo Ltda',
        tomadorCnpj: '99888777000165',
        tomadorIm: '111',
        tomadorNome: 'Tomador Demo SA',
        itemListaServico: '1.07',
        codigoTributacaoMunicipio: '12345',
        discriminacao: 'Servico de consultoria',
        codigoMunicipio: '3505708',
        ...over,
    };
    return `<?xml version="1.0"?>
        <ConsultarNfseResposta xmlns="${NS}">
          <ListaNfse>
            <CompNfse>
              <Nfse>
                <InfNfse Id="nfse_${o.numero}">
                  <Numero>${o.numero}</Numero>
                  <CodigoVerificacao>${o.codigoVerificacao}</CodigoVerificacao>
                  <DataEmissao>${o.dataEmissao}</DataEmissao>
                  <NaturezaOperacao>1</NaturezaOperacao>
                  <OptanteSimplesNacional>2</OptanteSimplesNacional>
                  <Servico>
                    <Valores>
                      <ValorServicos>${o.valorServicos}</ValorServicos>
                      <Aliquota>${o.aliquota}</Aliquota>
                      <ValorIss>${o.valorIss}</ValorIss>
                      <BaseCalculo>${o.valorServicos}</BaseCalculo>
                    </Valores>
                    <IssRetido>${o.issRetido}</IssRetido>
                    <ItemListaServico>${o.itemListaServico}</ItemListaServico>
                    <CodigoTributacaoMunicipio>${o.codigoTributacaoMunicipio}</CodigoTributacaoMunicipio>
                    <Discriminacao>${o.discriminacao}</Discriminacao>
                    <CodigoMunicipio>${o.codigoMunicipio}</CodigoMunicipio>
                  </Servico>
                  <PrestadorServico>
                    <IdentificacaoPrestador>
                      <Cnpj>${o.prestadorCnpj}</Cnpj>
                      <InscricaoMunicipal>${o.prestadorIm}</InscricaoMunicipal>
                    </IdentificacaoPrestador>
                    <RazaoSocial>${o.prestadorNome}</RazaoSocial>
                  </PrestadorServico>
                  <TomadorServico>
                    <IdentificacaoTomador>
                      <CpfCnpj>
                        <Cnpj>${o.tomadorCnpj}</Cnpj>
                      </CpfCnpj>
                      <InscricaoMunicipal>${o.tomadorIm}</InscricaoMunicipal>
                    </IdentificacaoTomador>
                    <RazaoSocial>${o.tomadorNome}</RazaoSocial>
                  </TomadorServico>
                </InfNfse>
              </Nfse>
            </CompNfse>
          </ListaNfse>
        </ConsultarNfseResposta>`;
}

describe('parseRespostaConsulta — resposta com NFSes', () => {
    it('extrai 1 NFSe com todos os campos principais', () => {
        const r = parseRespostaConsulta(respostaComUmaNfse());
        expect(r.ok).toBe(true);
        expect(r.mensagens).toEqual([]);
        expect(r.nfses).toHaveLength(1);

        const n = r.nfses[0];
        expect(n.numero).toBe('123');
        expect(n.codigoVerificacao).toBe('ABC1234567');
        expect(n.dataEmissao).toBe('2026-06-15T10:00:00');
        expect(n.servico.valorServicos).toBe(1000);
        expect(n.servico.aliquota).toBe(5);
        expect(n.servico.valorIss).toBe(50);
        expect(n.servico.issRetido).toBe(false);
        expect(n.servico.discriminacao).toBe('Servico de consultoria');
        expect(n.servico.itemListaServico).toBe('1.07');
        expect(n.prestador.cnpj).toBe('11222333000181');
        expect(n.prestador.nome).toBe('Prestador Demo Ltda');
        expect(n.tomador.cnpj).toBe('99888777000165');
        expect(n.tomador.nome).toBe('Tomador Demo SA');
    });

    it('extrai issRetido=true quando IssRetido=1', () => {
        const r = parseRespostaConsulta(respostaComUmaNfse({ issRetido: '1' }));
        expect(r.nfses[0].servico.issRetido).toBe(true);
    });

    it('extrai multiplas NFSes em ListaNfse', () => {
        const xml = `<?xml version="1.0"?>
            <ConsultarNfseResposta xmlns="${NS}">
              <ListaNfse>
                <CompNfse><Nfse><InfNfse>
                  <Numero>1</Numero>
                  <PrestadorServico><IdentificacaoPrestador><Cnpj>11111111000111</Cnpj></IdentificacaoPrestador></PrestadorServico>
                </InfNfse></Nfse></CompNfse>
                <CompNfse><Nfse><InfNfse>
                  <Numero>2</Numero>
                  <PrestadorServico><IdentificacaoPrestador><Cnpj>22222222000222</Cnpj></IdentificacaoPrestador></PrestadorServico>
                </InfNfse></Nfse></CompNfse>
                <CompNfse><Nfse><InfNfse>
                  <Numero>3</Numero>
                  <PrestadorServico><IdentificacaoPrestador><Cnpj>33333333000333</Cnpj></IdentificacaoPrestador></PrestadorServico>
                </InfNfse></Nfse></CompNfse>
              </ListaNfse>
            </ConsultarNfseResposta>`;
        const r = parseRespostaConsulta(xml);
        expect(r.nfses).toHaveLength(3);
        expect(r.nfses.map((n: any) => n.numero)).toEqual(['1', '2', '3']);
    });

    it('aceita valores monetarios com virgula (PT-BR)', () => {
        const xml = respostaComUmaNfse({ valorServicos: '1000,50', aliquota: '2,5' });
        const r = parseRespostaConsulta(xml);
        expect(r.nfses[0].servico.valorServicos).toBe(1000.5);
        expect(r.nfses[0].servico.aliquota).toBe(2.5);
    });

    it('pula InfNfse sem Numero (registro corrompido)', () => {
        const xml = `<?xml version="1.0"?>
            <ConsultarNfseResposta xmlns="${NS}">
              <ListaNfse>
                <CompNfse><Nfse><InfNfse>
                  <CodigoVerificacao>SEM_NUMERO</CodigoVerificacao>
                </InfNfse></Nfse></CompNfse>
              </ListaNfse>
            </ConsultarNfseResposta>`;
        const r = parseRespostaConsulta(xml);
        expect(r.ok).toBe(true);
        expect(r.nfses).toHaveLength(0);
    });
});

describe('parseRespostaConsulta — erros e mensagens', () => {
    it('captura MensagemRetorno com codigo e mensagem', () => {
        const xml = `<?xml version="1.0"?>
            <ConsultarNfseResposta xmlns="${NS}">
              <ListaMensagemRetorno>
                <MensagemRetorno>
                  <Codigo>E001</Codigo>
                  <Mensagem>CNPJ nao habilitado</Mensagem>
                  <Correcao>Verifique cadastro municipal</Correcao>
                </MensagemRetorno>
              </ListaMensagemRetorno>
            </ConsultarNfseResposta>`;
        const r = parseRespostaConsulta(xml);
        expect(r.ok).toBe(false);
        expect(r.mensagens).toHaveLength(1);
        expect(r.mensagens[0].codigo).toBe('E001');
        expect(r.mensagens[0].correcao).toBe('Verifique cadastro municipal');
    });

    it('detecta SOAP Fault e devolve erro', () => {
        const xml = `<?xml version="1.0"?>
            <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
              <soap:Body>
                <soap:Fault>
                  <faultcode>soap:Server</faultcode>
                  <faultstring>Certificado expirado</faultstring>
                </soap:Fault>
              </soap:Body>
            </soap:Envelope>`;
        const r = parseRespostaConsulta(xml);
        expect(r.ok).toBe(false);
        expect(r.mensagens[0].codigo).toBe('SOAP_FAULT');
        expect(r.mensagens[0].mensagem).toContain('Certificado');
    });

    it('rejeita XML com DOCTYPE (XXE)', () => {
        const xml = `<?xml version="1.0"?>
            <!DOCTYPE foo [<!ENTITY x "bar">]>
            <ConsultarNfseResposta />`;
        const r = parseRespostaConsulta(xml);
        expect(r.ok).toBe(false);
        expect(r.mensagens[0].codigo).toBe('XML_INSEGURO');
    });

    it('XML vazio: ok=true, lista vazia (resposta sem dados eh sucesso)', () => {
        const xml = `<?xml version="1.0"?><ConsultarNfseResposta xmlns="${NS}"><ListaNfse/></ConsultarNfseResposta>`;
        const r = parseRespostaConsulta(xml);
        expect(r.ok).toBe(true);
        expect(r.nfses).toHaveLength(0);
        expect(r.mensagens).toHaveLength(0);
    });
});
