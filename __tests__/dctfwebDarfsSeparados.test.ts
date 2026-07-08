/**
 * Guias separadas por vencimento (gerarDarfsSeparados):
 * o GERARGUIA31 da DCTFWeb unifica todos os débitos numa guia com "pagar até"
 * = MENOR vencimento (caso real 08/07/2026: PIS/COFINS 24/07 + IRPJ/CSLL
 * trimestrais 31/07 juntos). Como a API não permite escolher débitos, sai
 * 1 DARF avulso (SICALC/CONSOLIDARGERARDARF51) por débito da declaração,
 * cada um no SEU vencimento.
 */
const mockInvokeIntegraContador = jest.fn();

jest.mock('../sefaz-backend/serpro-client.js', () => ({
    invokeIntegraContador: mockInvokeIntegraContador,
}));

// @ts-expect-error — modulo .js puro
import { gerarDarfsSeparados } from '../sefaz-backend/dctfweb-orchestrator.js';
// @ts-expect-error — modulo .js puro
import { extrairDebitosDctfweb } from '../sefaz-backend/dctfweb-retencao-normalizer.js';

// XML no shape real do CONSXMLDECLARACAO38 (ProcDctf > ConteudoDeclaracao >
// A050 > CreditoTributarioApurado), competência 06/2026 — espelha o caso
// RADIO E TV IBIRAPUERA: PIS 8109-02, COFINS 2172-01 (mensais, venc 24/07),
// IRPJ 2089-01, CSLL 2372-01 (2º trimestre, venc 31/07) + uma retenção INSS
// 1162-01 (previdenciária — NÃO sai em guia avulsa).
function xmlDeclaracao() {
    const ct = (cod: string, desc: string, valor: string) =>
        `<CreditoTributarioApurado><codReceita>${cod}</codReceita>`
        + `<ctDescricaoTributo>${desc}</ctDescricaoTributo>`
        + `<ctValor>${valor}</ctValor><saldoaPagar>${valor}</saldoaPagar></CreditoTributarioApurado>`;
    return '<?xml version="1.0" encoding="utf-8"?>'
        + '<ProcDctf xmlns="http://www.serpro.gov.br/dctf/v1"><ConteudoDeclaracao id="ID1">'
        + '<DctfXml versao="3.0"><A000-DadosIdentificadoresContribuinte>'
        + '<inscContrib>09010732000137</inscContrib><perApuracao>062026</perApuracao>'
        + '<A050-CreditosTributariosApurados>'
        + ct('810902', 'PIS - FATURAMENTO', '13.00')
        + ct('217201', 'COFINS - CONTRIB P/ FIN. SEG. SOCIAL', '60.00')
        + ct('208901', 'IRPJ - LUCRO PRESUMIDO', '148.80')
        + ct('237201', 'CSLL - DEMAIS', '178.56')
        + ct('116201', 'CP PATRONAL - RETENCAO LEI 9.711/98', '500.00')
        + '</A050-CreditosTributariosApurados></A000-DadosIdentificadoresContribuinte>'
        + '</DctfXml></ConteudoDeclaracao></ProcDctf>';
}

describe('extrairDebitosDctfweb', () => {
    it('extrai débitos com saldo a pagar, separando código e extensão', () => {
        const r = extrairDebitosDctfweb(xmlDeclaracao());
        expect(r.lido).toBe(true);
        expect(r.debitos).toHaveLength(5);
        expect(r.debitos[0]).toEqual({
            codReceita: '810902', codigo: '8109', extensao: '02',
            descricao: 'PIS - FATURAMENTO', valor: 13,
        });
    });

    it('honesto quando não lê', () => {
        expect(extrairDebitosDctfweb('').lido).toBe(false);
        expect(extrairDebitosDctfweb('nao é xml <<<').lido).toBe(false);
    });

    it('ignora linhas sem saldo a pagar', () => {
        const xml = xmlDeclaracao().replace(/<saldoaPagar>13\.00<\/saldoaPagar>/, '<saldoaPagar>0</saldoaPagar>');
        const r = extrairDebitosDctfweb(xml);
        expect(r.debitos.map((d: any) => d.codigo)).not.toContain('8109');
    });
});

describe('gerarDarfsSeparados', () => {
    beforeEach(() => mockInvokeIntegraContador.mockReset());

    it('emite 1 DARF SICALC por débito conhecido, agrupado por vencimento; previdenciário fica em naoEmitidos', async () => {
        // 1ª chamada: CONSXMLDECLARACAO38 devolve o XML da declaração.
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { XMLStringBase64: Buffer.from(xmlDeclaracao(), 'utf8').toString('base64') },
        });
        // Demais: SICALC devolve consolidado + PDF.
        mockInvokeIntegraContador.mockResolvedValue({
            dados: {
                consolidado: { valorPrincipalMoedaCorrente: 0, valorTotalConsolidado: 0, valorMultaMora: 0, valorJuros: 0 },
                darf: 'PDF_B64',
                numeroDocumento: 'DOC-1',
            },
            mensagens: [{ codigo: 'Sucesso', texto: 'DARF gerado' }],
        });

        const r = await gerarDarfsSeparados({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6,
        });

        // 4 guias (PIS, COFINS, IRPJ, CSLL); INSS 1162 fora, com motivo.
        expect(r.guias).toHaveLength(4);
        expect(r.naoEmitidos).toHaveLength(1);
        expect(r.naoEmitidos[0].codigo).toBe('1162');
        expect(r.naoEmitidos[0].motivo).toMatch(/unificado/i);

        // Grupos por vencimento: mensais 24/07 (25/07 é sábado), trimestrais 31/07.
        expect(Object.keys(r.grupos).sort()).toEqual(['2026-07-24', '2026-07-31']);
        expect(r.grupos['2026-07-24'].map((g: any) => g.codigo).sort()).toEqual(['2172', '8109']);
        expect(r.grupos['2026-07-31'].map((g: any) => g.codigo).sort()).toEqual(['2089', '2372']);
        expect(r.guias.every((g: any) => g.pdfBase64 === 'PDF_B64')).toBe(true);

        // Payloads SICALC corretos: PIS mensal ME 06/2026; IRPJ TR 02/2026.
        const chamadas = mockInvokeIntegraContador.mock.calls.map((c) => c[0]);
        const pis = chamadas.find((c) => c.dados?.codigoReceita === '8109');
        expect(pis).toMatchObject({
            idSistema: 'SICALC', idServico: 'CONSOLIDARGERARDARF51', acao: 'Emitir',
            dados: expect.objectContaining({
                codigoReceitaExtensao: '02', tipoPA: 'ME', dataPA: '06/2026',
                vencimento: '2026-07-24T00:00:00', valorImposto: '13.00',
            }),
        });
        const irpj = chamadas.find((c) => c.dados?.codigoReceita === '2089');
        expect(irpj?.dados).toMatchObject({
            codigoReceitaExtensao: '01', tipoPA: 'TR', dataPA: '02/2026',
            vencimento: '2026-07-31T00:00:00', valorImposto: '148.80',
        });
    });

    it('débito abaixo de R$10 não emite (regra RFB) e explica', async () => {
        const xml = xmlDeclaracao()
            .replace(/<ctValor>13\.00<\/ctValor><saldoaPagar>13\.00<\/saldoaPagar>/, '<ctValor>9.99</ctValor><saldoaPagar>9.99</saldoaPagar>');
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { XMLStringBase64: Buffer.from(xml, 'utf8').toString('base64') },
        });
        mockInvokeIntegraContador.mockResolvedValue({
            dados: { consolidado: {}, darf: 'PDF', numeroDocumento: 'X' },
        });
        const r = await gerarDarfsSeparados({ empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6 });
        expect(r.guias.map((g: any) => g.codigo)).not.toContain('8109');
        const pis = r.naoEmitidos.find((n: any) => n.codigo === '8109');
        expect(pis?.motivo).toMatch(/R\$ 10/);
    });

    it('falha claro quando a declaração não tem débitos', async () => {
        const xmlVazio = '<?xml version="1.0"?><ProcDctf><ConteudoDeclaracao id="I"><DctfXml/></ConteudoDeclaracao></ProcDctf>';
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { XMLStringBase64: Buffer.from(xmlVazio, 'utf8').toString('base64') },
        });
        await expect(gerarDarfsSeparados({ empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6 }))
            .rejects.toThrow(/sem débitos|não tem débitos/i);
    });
});
