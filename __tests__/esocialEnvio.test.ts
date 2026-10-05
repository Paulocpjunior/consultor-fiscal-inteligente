/**
 * Transmissão de eventos do eSocial pelo cofre do CFI, para o Consultor DP
 * (Paulo, 05/10/2026: "pode seguir com a transmissão do esocial pelo cofre").
 *
 * O que os testes trancam:
 * 1. Conferência do evento antes de assinar: raiz, tipo, Id, empregador e
 *    ambiente; lote de um grupo só, até 50, sem Id repetido.
 * 2. O evento sai assinado (URI="", dentro de <eSocial>) e a assinatura
 *    VERIFICA com um A1 de teste real; assinatura antiga é trocada.
 * 3. Lote, envelopes e SOAPActions batem com os XSDs/WSDLs da comunicação.
 * 4. Leitura do retorno do envio (protocolo) e do processamento (recibo ou
 *    ocorrências por evento; totalizadores só contados).
 * 5. Trava da carteira: o CFI lê a empresa no Firestore do DP com o token do
 *    usuário; 403/404 do DP vira acesso negado; CNPJ tem de conferir.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { analisarEvento, analisarLote, montarLoteEnvio, envelopeEnvio, envelopeConsulta, lerRetornoEnvio, lerRetornoProcessamento, situacaoDoLote, grupoDoTipo, validarProtocolo, semAssinatura, ENDPOINTS_ENVIO, ACTION_ENVIO, ACTION_CONSULTA } from '../sefaz-backend/esocial-envio.js';
// @ts-expect-error — módulo .js puro (sem tipos)
import { assinarPedidoEsocial, verificarAssinaturaPedido } from '../sefaz-backend/esocial-download.js';
// @ts-expect-error — módulo .js puro (sem tipos)
import { confirmarEmpresaDaCarteiraDp, AcessoNegado } from '../sefaz-backend/dp-acesso-empresa.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { abrirPfx } from '../sefaz-backend/pkcs12.js';

const PFX = readFileSync(join(__dirname, 'fixtures', 'pfx', 'aes256.pfx'));
const CERT = (() => { const { pemKey, pemCert } = abrirPfx(PFX, 'senha123'); return { pemKey, pemCert }; })();
const CNPJ = '29463877000109';
const ID = 'ID1294638770000002026100512000000001';

const s1299 = ({ id = ID, nrInsc = '29463877', tpAmb = '2' } = {}) => '<?xml version="1.0" encoding="UTF-8"?>'
    + '<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtFechaEvPer/v_S_01_03_00">'
    + `<evtFechaEvPer Id="${id}"><ideEvento><indApuracao>1</indApuracao><perApur>2026-09</perApur><tpAmb>${tpAmb}</tpAmb><procEmi>1</procEmi><verProc>ConsultorDP_1.0</verProc></ideEvento>`
    + `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>${nrInsc}</nrInsc></ideEmpregador>`
    + '<infoFech><evtRemun>S</evtRemun><evtPgtos>S</evtPgtos><evtComProd>N</evtComProd><evtContratAvNP>N</evtContratAvNP><evtInfoComplPer>N</evtInfoComplPer><transDCTFWeb>S</transDCTFWeb></infoFech>'
    + '</evtFechaEvPer></eSocial>';
const s2200 = (id: string) => '<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtAdmissao/v_S_01_03_00">'
    + `<evtAdmissao Id="${id}"><ideEvento><indRetif>1</indRetif><tpAmb>2</tpAmb><procEmi>1</procEmi><verProc>X</verProc></ideEvento>`
    + '<ideEmpregador><tpInsc>1</tpInsc><nrInsc>29463877</nrInsc></ideEmpregador></evtAdmissao></eSocial>';

describe('conferência do evento', () => {
    it('lê tipo, grupo, Id e período; tira a declaração', () => {
        const e = analisarEvento(s1299(), { cnpj: CNPJ, tpAmb: 2 });
        expect(e).toMatchObject({ id: ID, tipo: 'S-1299', grupo: 3, elemento: 'evtFechaEvPer', perApur: '2026-09' });
        expect(e.xml.startsWith('<eSocial')).toBe(true);
    });
    it('recusa empregador de outra empresa, ambiente trocado, Id fora do formato e totalizador', () => {
        expect(() => analisarEvento(s1299({ nrInsc: '11222333' }), { cnpj: CNPJ, tpAmb: 2 })).toThrow(/não é a empresa 29463877000109/);
        expect(() => analisarEvento(s1299(), { cnpj: CNPJ, tpAmb: 1 })).toThrow(/é de produção restrita, e o envio é de produção/);
        expect(() => analisarEvento(s1299({ id: 'IDS1299123' }), { cnpj: CNPJ, tpAmb: 2 })).toThrow(/fora do formato/);
        expect(() => analisarEvento('<eSocial xmlns="x"><evtBasesTrab Id="x"/></eSocial>', { cnpj: CNPJ, tpAmb: 2 })).toThrow(/não é um evento que se transmite/);
        expect(() => analisarEvento('<outro/>', { cnpj: CNPJ, tpAmb: 2 })).toThrow(/raiz do evento/);
        expect(() => analisarEvento('', { cnpj: CNPJ, tpAmb: 2 })).toThrow(/vazio/);
    });
    it('grupos: tabelas 1, não periódicos 2, periódicos 3', () => {
        expect([grupoDoTipo('S-1010'), grupoDoTipo('S-2200'), grupoDoTipo('S-3000'), grupoDoTipo('S-1200'), grupoDoTipo('S-1299'), grupoDoTipo('S-5011')]).toEqual([1, 2, 2, 3, 3, null]);
    });
    it('lote: um grupo só, até 50, sem Id repetido; o erro diz qual evento', () => {
        const id2 = 'ID1294638770000002026100512000000002';
        expect(() => analisarLote([s1299(), s2200(id2)], { cnpj: CNPJ, tpAmb: 2 })).toThrow(/um grupo só; vieram periódicos e não periódicos/);
        expect(() => analisarLote([s1299(), s1299()], { cnpj: CNPJ, tpAmb: 2 })).toThrow(/Id repetido/);
        expect(() => analisarLote(Array(51).fill(s1299()), { cnpj: CNPJ, tpAmb: 2 })).toThrow(/No máximo 50/);
        expect(() => analisarLote([s1299(), s1299({ tpAmb: '1' })], { cnpj: CNPJ, tpAmb: 2 })).toThrow(/^Evento 2:/);
        expect(analisarLote([s1299()], { cnpj: CNPJ, tpAmb: 2 }).grupo).toBe(3);
    });
});

describe('assinatura e lote', () => {
    it('assina o evento (URI="", dentro de <eSocial>) e a assinatura verifica; troca a assinatura antiga', () => {
        const e = analisarEvento(s1299(), { cnpj: CNPJ, tpAmb: 2 });
        const assinado = assinarPedidoEsocial(e.xml, CERT);
        expect(assinado).toMatch(/<Reference URI="">/);
        expect(assinado).toMatch(/<\/evtFechaEvPer><Signature/);
        expect(verificarAssinaturaPedido(assinado, CERT).ok).toBe(true);
        const deNovo = analisarEvento(assinado, { cnpj: CNPJ, tpAmb: 2 });
        expect(deNovo.xml).not.toMatch(/Signature/);
        expect(semAssinatura('<a><ds:Signature x="1"><ds:SignatureValue>z</ds:SignatureValue></ds:Signature></a>')).toBe('<a></a>');
    });
    it('lote (sem assinatura própria) com empregador pela raiz e transmissor de 14 dígitos; envelope e SOAPAction do WSDL', () => {
        const lote = montarLoteEnvio({ cnpj: CNPJ, cnpjTransmissor: '44.388.152/0001-89', grupo: 3, eventos: [{ id: ID, xml: '<?xml version="1.0"?><eSocial>E</eSocial>' }] });
        expect(lote).toBe('<eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_1"><envioLoteEventos grupo="3">'
            + '<ideEmpregador><tpInsc>1</tpInsc><nrInsc>29463877</nrInsc></ideEmpregador>'
            + '<ideTransmissor><tpInsc>1</tpInsc><nrInsc>44388152000189</nrInsc></ideTransmissor>'
            + `<eventos><evento Id="${ID}"><eSocial>E</eSocial></evento></eventos></envioLoteEventos></eSocial>`);
        expect(envelopeEnvio(lote)).toContain('<v1:EnviarLoteEventos><v1:loteEventos><eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_1">');
        expect(ACTION_ENVIO).toBe('http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0/ServicoEnviarLoteEventos/EnviarLoteEventos');
        expect(ACTION_CONSULTA).toBe('http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/consulta/retornoProcessamento/v1_1_0/ServicoConsultarLoteEventos/ConsultarLoteEventos');
        expect(ENDPOINTS_ENVIO[1].envio).toBe('https://webservices.envio.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc');
        expect(ENDPOINTS_ENVIO[2].consulta).toBe('https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc');
        expect(() => montarLoteEnvio({ cnpj: CNPJ, cnpjTransmissor: '123', grupo: 3, eventos: [] })).toThrow(/transmissor/);
    });
    it('consulta: protocolo validado no envelope', () => {
        expect(envelopeConsulta('1.2.202610.0000000000012345')).toContain('<consultaLoteEventos><protocoloEnvio>1.2.202610.0000000000012345</protocoloEnvio></consultaLoteEventos>');
        expect(() => validarProtocolo('<x>')).toThrow(/Protocolo/);
    });
});

describe('leitura dos retornos', () => {
    const env = (corpo: string) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><EnviarLoteEventosResponse xmlns="http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0"><EnviarLoteEventosResult>${corpo}</EnviarLoteEventosResult></EnviarLoteEventosResponse></s:Body></s:Envelope>`;
    it('envio recebido: 201 e protocolo', () => {
        const r = lerRetornoEnvio(env('<eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/retornoEnvio/v1_1_0"><retornoEnvioLoteEventos>'
            + '<ideEmpregador><tpInsc>1</tpInsc><nrInsc>29463877</nrInsc></ideEmpregador><ideTransmissor><tpInsc>1</tpInsc><nrInsc>44388152000189</nrInsc></ideTransmissor>'
            + '<status><cdResposta>201</cdResposta><descResposta>Lote Recebido com Sucesso.</descResposta></status>'
            + '<dadosRecepcaoLote><dhRecepcao>2026-10-05T12:00:00</dhRecepcao><versaoAplicativoRecepcao>1.0</versaoAplicativoRecepcao><protocoloEnvio>1.2.202610.0000000000012345</protocoloEnvio></dadosRecepcaoLote>'
            + '</retornoEnvioLoteEventos></eSocial>'));
        expect(r).toEqual({ cdResposta: 201, descResposta: 'Lote Recebido com Sucesso.', ocorrencias: [], protocolo: '1.2.202610.0000000000012345', dhRecepcao: '2026-10-05T12:00:00' });
    });
    it('envio recusado: ocorrências; SOAP Fault legível', () => {
        const r = lerRetornoEnvio(env('<eSocial><retornoEnvioLoteEventos><status><cdResposta>402</cdResposta><descResposta>Lote Incorreto - Erro preenchimento</descResposta>'
            + '<ocorrencias><ocorrencia><codigo>142</codigo><descricao>Certificado sem procuração</descricao><tipo>1</tipo></ocorrencia></ocorrencias></status></retornoEnvioLoteEventos></eSocial>'));
        expect(r).toMatchObject({ cdResposta: 402, protocolo: '', ocorrencias: [{ tipo: 1, codigo: '142', descricao: 'Certificado sem procuração', localizacao: '' }] });
        expect(lerRetornoEnvio('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>Acesso negado</faultstring></s:Fault></s:Body></s:Envelope>'))
            .toMatchObject({ cdResposta: null, descResposta: 'Acesso negado' });
        expect(() => lerRetornoEnvio('<html/>')).toThrow(/sem retornoEnvioLoteEventos/);
    });
    it('processamento: aceito com recibo, recusado com ocorrências, totalizador contado', () => {
        const xml = '<eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/retornoProcessamento/v1_3_0"><retornoProcessamentoLoteEventos>'
            + '<status><cdResposta>201</cdResposta><descResposta>Lote processado com sucesso.</descResposta></status>'
            + '<dadosRecepcaoLote><protocoloEnvio>1.2.202610.0000000000012345</protocoloEnvio></dadosRecepcaoLote>'
            + '<retornoEventos>'
            + `<evento Id="${ID}"><retornoEvento><eSocial xmlns="http://www.esocial.gov.br/schema/evt/retornoEvento/v1_2_1"><retornoEvento Id="R1">`
            + '<processamento><cdResposta>201</cdResposta><descResposta>Sucesso.</descResposta></processamento><recibo><nrRecibo>1.1.0000000012345678901</nrRecibo><hash>h</hash></recibo>'
            + '</retornoEvento></eSocial></retornoEvento><tot tipo="S-5011"><eSocial/></tot><tot tipo="S-5013"><eSocial/></tot></evento>'
            + '<evento Id="ID1294638770000002026100512000000002"><retornoEvento><eSocial><retornoEvento>'
            + '<processamento><cdResposta>401</cdResposta><descResposta>Evento recusado.</descResposta><ocorrencias><ocorrencia><tipo>1</tipo><codigo>1010</codigo><descricao>Período já fechado</descricao><localizacao>/eSocial/evtFechaEvPer</localizacao></ocorrencia></ocorrencias></processamento>'
            + '</retornoEvento></eSocial></retornoEvento></evento>'
            + '</retornoEventos></retornoProcessamentoLoteEventos></eSocial>';
        const r = lerRetornoProcessamento(xml);
        expect(r).toMatchObject({ cdResposta: 201, protocolo: '1.2.202610.0000000000012345', ocorrencias: [] });
        expect(r.eventos).toEqual([
            { id: ID, cdResposta: 201, descResposta: 'Sucesso.', ocorrencias: [], nrRecibo: '1.1.0000000012345678901', totalizadores: ['S-5011', 'S-5013'] },
            { id: 'ID1294638770000002026100512000000002', cdResposta: 401, descResposta: 'Evento recusado.', nrRecibo: '', totalizadores: [],
                ocorrencias: [{ tipo: 1, codigo: '1010', descricao: 'Período já fechado', localizacao: '/eSocial/evtFechaEvPer' }] },
        ]);
        const aguardando = lerRetornoProcessamento('<eSocial><retornoProcessamentoLoteEventos><status><cdResposta>101</cdResposta><descResposta>Aguardando</descResposta><tempoEstimadoConclusao>30</tempoEstimadoConclusao></status></retornoProcessamentoLoteEventos></eSocial>');
        expect(aguardando).toMatchObject({ cdResposta: 101, tempoEstimadoConclusao: 30, eventos: [] });
        expect([situacaoDoLote(101), situacaoDoLote(201), situacaoDoLote(202), situacaoDoLote(301)]).toEqual(['em-processamento', 'processado', 'processado', 'recusado']);
    });
});

describe('trava da carteira do DP', () => {
    const resp = (status: number, body: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    it('lê a empresa no Firestore do DP com o token do usuário e confere o CNPJ', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(resp(200, { fields: { cnpj: { stringValue: '29.463.877/0001-09' } } }));
        await expect(confirmarEmpresaDaCarteiraDp({ token: 'tok', empresaId: 'emp1', cnpj: CNPJ, fetchImpl })).resolves.toBe(true);
        expect(fetchImpl).toHaveBeenCalledWith('https://firestore.googleapis.com/v1/projects/consultor-dp-folha/databases/(default)/documents/empresas/emp1?mask.fieldPaths=cnpj', { headers: { Authorization: 'Bearer tok' } });
    });
    it('fora da carteira (403/404), CNPJ diferente ou empresaId inválido: acesso negado; outras falhas: erro', async () => {
        for (const st of [403, 404]) {
            await expect(confirmarEmpresaDaCarteiraDp({ token: 't', empresaId: 'e', cnpj: CNPJ, fetchImpl: jest.fn().mockResolvedValue(resp(st)) })).rejects.toBeInstanceOf(AcessoNegado);
        }
        await expect(confirmarEmpresaDaCarteiraDp({ token: 't', empresaId: 'e', cnpj: CNPJ, fetchImpl: jest.fn().mockResolvedValue(resp(200, { fields: { cnpj: { stringValue: '11222333000181' } } })) })).rejects.toThrow(/não é o da empresa/);
        await expect(confirmarEmpresaDaCarteiraDp({ token: 't', empresaId: '../x', cnpj: CNPJ, fetchImpl: jest.fn() })).rejects.toBeInstanceOf(AcessoNegado);
        const e500 = confirmarEmpresaDaCarteiraDp({ token: 't', empresaId: 'e', cnpj: CNPJ, fetchImpl: jest.fn().mockResolvedValue(resp(500)) });
        await expect(e500).rejects.toThrow(/HTTP 500/);
        await expect(confirmarEmpresaDaCarteiraDp({ token: 't', empresaId: 'e', cnpj: CNPJ, fetchImpl: jest.fn().mockResolvedValue(resp(500)) })).rejects.not.toBeInstanceOf(AcessoNegado);
    });
});
