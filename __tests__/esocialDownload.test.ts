/**
 * Download de eventos do eSocial para o Consultor DP (Paulo, 04/10/2026:
 * "pode seguir com download dos eventos do esocial").
 *
 * O que os testes trancam:
 * 1. O pedido segue os XSDs oficiais (comunicação v1_5_0): namespace, grupo,
 *    raiz do CNPJ e filtros — e recusa entrada fora do formato antes de gastar
 *    uma consulta da cota diária do eSocial.
 * 2. A assinatura é a do pedido inteiro (URI="", <Signature> dentro de
 *    <eSocial>) e VERIFICA com um A1 de teste real.
 * 3. O envelope e a SOAPAction batem com o WSDL.
 * 4. A leitura das respostas devolve identificadores e os XMLs do evento e do
 *    recibo exatamente como vieram — e SOAP Fault vira erro legível.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { montarPedidoIdentificadores, montarPedidoDownload, assinarPedidoEsocial, verificarAssinaturaPedido, montarEnvelope, lerRetornoIdentificadores, lerRetornoDownload, raizCnpj, ENDPOINTS, MAX_POR_PEDIDO } from '../sefaz-backend/esocial-download.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { abrirPfx } from '../sefaz-backend/pkcs12.js';

const PFX = readFileSync(join(__dirname, 'fixtures', 'pfx', 'aes256.pfx'));
const CERT = (() => { const { pemKey, pemCert } = abrirPfx(PFX, 'senha123'); return { pemKey, pemCert }; })();
const CNPJ = '29463877000109';
const ID = 'ID1294638770000002026091612000000001';

describe('pedido de identificadores', () => {
    it('empregador: tpEvt + perApur, raiz do CNPJ, namespace e SOAPAction do WSDL', () => {
        const p = montarPedidoIdentificadores({ tipo: 'empregador', cnpj: CNPJ, tpEvt: 'S-1299', perApur: '2026-09' });
        expect(p.xml).toBe('<eSocial xmlns="http://www.esocial.gov.br/schema/consulta/identificadores-eventos/empregador/v1_0_0">'
            + '<consultaIdentificadoresEvts><ideEmpregador><tpInsc>1</tpInsc><nrInsc>29463877</nrInsc></ideEmpregador>'
            + '<consultaEvtsEmpregador><tpEvt>S-1299</tpEvt><perApur>2026-09</perApur></consultaEvtsEmpregador></consultaIdentificadoresEvts></eSocial>');
        expect(p.action).toBe('http://www.esocial.gov.br/servicos/empregador/consulta/identificadores-eventos/v1_0_0/ServicoConsultarIdentificadoresEventos/ConsultarIdentificadoresEventosEmpregador');
        expect(p.parametro).toBe('consultaEventosEmpregador');
    });

    it('trabalhador e tabela: período vira dateTime do dia inteiro', () => {
        const t = montarPedidoIdentificadores({ tipo: 'trabalhador', cnpj: CNPJ, cpfTrab: '529.982.247-25', dtIni: '2026-01-01', dtFim: '2026-09-30' });
        expect(t.xml).toContain('<consultaEvtsTrabalhador><cpfTrab>52998224725</cpfTrab><dtIni>2026-01-01T00:00:00</dtIni><dtFim>2026-09-30T23:59:59</dtFim></consultaEvtsTrabalhador>');
        expect(t.xml).toContain('identificadores-eventos/trabalhador/v1_0_0');
        const tab = montarPedidoIdentificadores({ tipo: 'tabela', cnpj: CNPJ, tpEvt: 'S-1010', dtIni: '2025-01-01' });
        expect(tab.xml).toContain('<consultaEvtsTabela><tpEvt>S-1010</tpEvt><dtIni>2025-01-01T00:00:00</dtIni></consultaEvtsTabela>');
    });

    it('recusa entrada fora do formato antes de gastar cota', () => {
        expect(() => montarPedidoIdentificadores({ tipo: 'empregador', cnpj: CNPJ, tpEvt: '1299', perApur: '2026-09' })).toThrow(/S-9999/);
        expect(() => montarPedidoIdentificadores({ tipo: 'empregador', cnpj: CNPJ, tpEvt: 'S-1299', perApur: '09/2026' })).toThrow(/perApur/);
        expect(() => montarPedidoIdentificadores({ tipo: 'trabalhador', cnpj: CNPJ, cpfTrab: '123', dtIni: '2026-01-01', dtFim: '2026-01-31' })).toThrow(/cpfTrab/);
        expect(() => montarPedidoIdentificadores({ tipo: 'trabalhador', cnpj: CNPJ, cpfTrab: '52998224725', dtIni: '2026-02-01', dtFim: '2026-01-31' })).toThrow(/anterior/);
        expect(() => montarPedidoIdentificadores({ tipo: 'outro', cnpj: CNPJ })).toThrow(/tipo/);
        expect(() => raizCnpj('123')).toThrow(/14 dígitos/);
    });
});

describe('pedido de download', () => {
    it('por Id e por recibo, até 50 por vez', () => {
        expect(montarPedidoDownload({ cnpj: CNPJ, ids: [ID] }).xml).toBe('<eSocial xmlns="http://www.esocial.gov.br/schema/download/solicitacao/id/v1_0_0"><download>'
            + '<ideEmpregador><tpInsc>1</tpInsc><nrInsc>29463877</nrInsc></ideEmpregador><solicDownloadEvtsPorId><id>' + ID + '</id></solicDownloadEvtsPorId></download></eSocial>');
        const r = montarPedidoDownload({ cnpj: CNPJ, nrRecs: ['1.2.0000000000123456789'] });
        expect(r.metodo).toBe('SolicitarDownloadEventosPorNrRecibo');
        expect(r.xml).toContain('<solicDownloadEventosPorNrRecibo><nrRec>1.2.0000000000123456789</nrRec></solicDownloadEventosPorNrRecibo>');
        expect(() => montarPedidoDownload({ cnpj: CNPJ, ids: Array(MAX_POR_PEDIDO + 1).fill(ID) })).toThrow(/50/);
        expect(() => montarPedidoDownload({ cnpj: CNPJ, ids: ['ID123'] })).toThrow(/34 dígitos/);
        expect(() => montarPedidoDownload({ cnpj: CNPJ })).toThrow(/ids ou nrRecs/);
    });
});

describe('assinatura e envelope', () => {
    it('assina o pedido inteiro com URI vazia e a assinatura VERIFICA', () => {
        const p = montarPedidoIdentificadores({ tipo: 'empregador', cnpj: CNPJ, tpEvt: 'S-5011', perApur: '2026-09' });
        const assinado = assinarPedidoEsocial(p.xml, CERT);
        expect(assinado).toMatch(/<Reference URI="">/);
        expect(assinado).toContain('rsa-sha256');
        expect(assinado).toMatch(/<\/consultaIdentificadoresEvts><Signature [^>]*>[\s\S]*<\/Signature><\/eSocial>$/);
        expect(verificarAssinaturaPedido(assinado, CERT).ok).toBe(true);
        expect(verificarAssinaturaPedido(assinado.replace('2026-09', '2026-08'), CERT).ok).toBe(false);
        const env = montarEnvelope(p, assinado);
        expect(env).toContain('<v1:ConsultarIdentificadoresEventosEmpregador><v1:consultaEventosEmpregador><eSocial');
        expect(env).toContain(`xmlns:v1="http://www.esocial.gov.br/servicos/empregador/consulta/identificadores-eventos/v1_0_0"`);
        expect(ENDPOINTS[1].download).toBe('https://webservices.download.esocial.gov.br/servicos/empregador/dwlcirurgico/WsSolicitarDownloadEventos.svc');
    });
});

const soap = (corpo: string) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${corpo}</s:Body></s:Envelope>`;

describe('leitura das respostas', () => {
    it('identificadores: status, total, último e lista', () => {
        const r = lerRetornoIdentificadores(soap(`<ConsultarIdentificadoresEventosTrabalhadorResponse xmlns="http://www.esocial.gov.br/servicos/empregador/consulta/identificadores-eventos/v1_0_0"><ConsultarIdentificadoresEventosTrabalhadorResult>`
            + `<eSocial xmlns="http://www.esocial.gov.br/schema/consulta/identificadores-eventos/retorno/v1_0_0"><retornoConsultaIdentificadoresEvts><status><cdResposta>200</cdResposta><descResposta>Solicitação processada com sucesso.</descResposta></status>`
            + `<retornoIdentificadoresEvts><qtdeTotEvtsConsulta>2</qtdeTotEvtsConsulta><dhUltimoEvtRetornado>2026-09-16T12:00:00</dhUltimoEvtRetornado><identificadoresEvts>`
            + `<identificadorEvt><id>${ID}</id><nrRec>1.2.000001</nrRec></identificadorEvt><identificadorEvt><id>ID1294638770000002026092012000000002</id><nrRec>1.2.000002</nrRec></identificadorEvt>`
            + `</identificadoresEvts></retornoIdentificadoresEvts></retornoConsultaIdentificadoresEvts></eSocial></ConsultarIdentificadoresEventosTrabalhadorResult></ConsultarIdentificadoresEventosTrabalhadorResponse>`));
        expect(r).toEqual({ cdResposta: 200, descResposta: 'Solicitação processada com sucesso.', qtdeTotal: 2, dhUltimoEvtRetornado: '2026-09-16T12:00:00', identificadores: [{ id: ID, nrRec: '1.2.000001' }, { id: 'ID1294638770000002026092012000000002', nrRec: '1.2.000002' }] });
    });

    it('download: XML do evento e do recibo como vieram, com Id e elemento', () => {
        const evt = `<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtAdmissao/v_S_01_03_00"><evtAdmissao Id="${ID}"><ideEvento><tpAmb>1</tpAmb></ideEvento></evtAdmissao><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>X</SignatureValue></Signature></eSocial>`;
        const rec = `<eSocial xmlns="http://www.esocial.gov.br/schema/evt/retornoEvento/v1_2_1"><retornoEvento Id="${ID}"><processamento><cdResposta>201</cdResposta></processamento><recibo><nrRecibo>1.2.000001</nrRecibo></recibo></retornoEvento></eSocial>`;
        const r = lerRetornoDownload(soap(`<SolicitarDownloadEventosPorIdResponse xmlns="http://www.esocial.gov.br/servicos/empregador/download/solicitacao/v1_0_0"><SolicitarDownloadEventosPorIdResult>`
            + `<eSocial xmlns="http://www.esocial.gov.br/schema/download/solicitacao/retorno/v1_0_0"><download><status><cdResposta>200</cdResposta><descResposta>OK</descResposta></status>`
            + `<retornoSolicDownloadEvts><arquivos><arquivo><status><cdResposta>200</cdResposta><descResposta>OK</descResposta></status><evt>${evt}</evt><rec>${rec}</rec></arquivo>`
            + `<arquivo><status><cdResposta>402</cdResposta><descResposta>Evento não encontrado.</descResposta></status></arquivo></arquivos></retornoSolicDownloadEvts></download></eSocial>`
            + `</SolicitarDownloadEventosPorIdResult></SolicitarDownloadEventosPorIdResponse>`));
        expect(r.cdResposta).toBe(200);
        expect(r.arquivos).toHaveLength(2);
        expect(r.arquivos[0]).toMatchObject({ cdResposta: 200, id: ID, elemento: 'evtAdmissao' });
        expect(r.arquivos[0].evt).toBe(evt);
        expect(r.arquivos[0].rec).toBe(rec);
        expect(r.arquivos[1]).toMatchObject({ cdResposta: 402, descResposta: 'Evento não encontrado.', evt: '', rec: '' });
    });

    it('SOAP Fault vira mensagem, sem lista', () => {
        const f = soap('<s:Fault><faultcode>s:Client</faultcode><faultstring>Certificado não autorizado para o empregador.</faultstring></s:Fault>');
        expect(lerRetornoIdentificadores(f)).toMatchObject({ cdResposta: null, descResposta: 'Certificado não autorizado para o empregador.', identificadores: [] });
        expect(lerRetornoDownload(f)).toMatchObject({ descResposta: 'Certificado não autorizado para o empregador.', arquivos: [] });
    });
});

// @ts-expect-error — módulo .js puro (sem tipos)
import { executarPedido } from '../sefaz-backend/esocial-download-client.js';

describe('execução do pedido (transporte simulado)', () => {
    it('assina, envelopa e manda para o endpoint e a SOAPAction certos', async () => {
        const chamadas: any[] = [];
        const transporte = async (x: any) => { chamadas.push(x); return { status: 200, body: '<ok/>' }; };
        const pedido = montarPedidoDownload({ cnpj: CNPJ, ids: [ID] });
        const r = await executarPedido({ pedido, cert: { ...CERT, pfxBuffer: PFX, password: 'senha123' }, tpAmb: 1, transporte });
        expect(r).toEqual({ status: 200, body: '<ok/>' });
        expect(chamadas[0].url).toBe('https://webservices.download.esocial.gov.br/servicos/empregador/dwlcirurgico/WsSolicitarDownloadEventos.svc');
        expect(chamadas[0].action).toBe('http://www.esocial.gov.br/servicos/empregador/download/solicitacao/v1_0_0/ServicoSolicitarDownloadEventos/SolicitarDownloadEventosPorId');
        expect(chamadas[0].envelope).toContain('<v1:SolicitarDownloadEventosPorId><v1:solicitacao><eSocial');
        expect(chamadas[0].envelope).toContain('<Reference URI="">');
        expect(chamadas[0].pfxBuffer).toBe(PFX);
        await expect(executarPedido({ pedido, cert: CERT, tpAmb: 3, transporte })).rejects.toThrow(/tpAmb/);
    });
});
