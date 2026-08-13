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

        // Resumo por vencimento = total consolidado da RFB por data. O principal
        // é determinístico; o `total` vem do valorTotalConsolidado do SICALC
        // (mock devolve 0 aqui — em produção é o valor com juros/multa).
        expect(r.resumoPorVencimento.map((x: any) => ({
            vencimento: x.vencimento, quantidade: x.quantidade,
            totalPrincipal: x.totalPrincipal, codigos: x.codigos,
        }))).toEqual([
            { vencimento: '2026-07-24', quantidade: 2, totalPrincipal: 73, codigos: ['8109-02', '2172-01'] },
            { vencimento: '2026-07-31', quantidade: 2, totalPrincipal: 327.36, codigos: ['2089-01', '2372-01'] },
        ]);

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
        // SICALC limita observacao a 50 chars (EntradaIncorreta-SICALC 08/07/2026)
        expect(chamadas.filter((c) => c.idSistema === 'SICALC')
            .every((c) => String(c.dados.observacao || '').length <= 50)).toBe(true);
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

describe('gerarDarfsSeparados — quotas trimestrais (Lei 9.430 art. 5º)', () => {
    beforeEach(() => mockInvokeIntegraContador.mockReset());

    // Caso real 08/07/2026 (EDUARDO GUERRA HORTIFRUTI): IRPJ 1º tri/2026 de
    // R$ 307.249,21 (IR + adicional somados no MIT) — pagável em 3 quotas.
    function xmlIrpjGrande() {
        return '<?xml version="1.0"?><ProcDctf><ConteudoDeclaracao id="I"><DctfXml>'
            + '<A050><CreditoTributarioApurado><codReceita>208901</codReceita>'
            + '<ctDescricaoTributo>IRPJ - LUCRO PRESUMIDO</ctDescricaoTributo>'
            + '<ctValor>307249.21</ctValor><saldoaPagar>307249.21</saldoaPagar>'
            + '</CreditoTributarioApurado>'
            + '<CreditoTributarioApurado><codReceita>810902</codReceita>'
            + '<ctDescricaoTributo>PIS - FATURAMENTO</ctDescricaoTributo>'
            + '<ctValor>500.00</ctValor><saldoaPagar>500.00</saldoaPagar>'
            + '</CreditoTributarioApurado></A050>'
            + '</DctfXml></ConteudoDeclaracao></ProcDctf>';
    }

    it('3 quotas: divide em centavos (1ª absorve o resto), vencimentos nos últimos dias úteis, cota no payload', async () => {
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { XMLStringBase64: Buffer.from(xmlIrpjGrande(), 'utf8').toString('base64') },
        });
        mockInvokeIntegraContador.mockResolvedValue({
            dados: { consolidado: {}, darf: 'PDF', numeroDocumento: 'D' },
        });

        // competência 03/2026 (fim do 1º trimestre)
        const r = await gerarDarfsSeparados({
            empresaCnpj: '00005430000104', anoPA: 2026, mesPA: 3, quotasTrimestrais: 3,
        });

        const quotasIrpj = r.guias.filter((g: any) => g.codigo === '2089');
        expect(quotasIrpj).toHaveLength(3);
        // 307249.21 / 3 = 102416.4033... -> 102416.41 + 102416.40 + 102416.40
        expect(quotasIrpj.map((g: any) => g.valorPrincipal)).toEqual([102416.41, 102416.40, 102416.40]);
        expect(quotasIrpj.reduce((s: number, g: any) => s + g.valorPrincipal, 0)).toBeCloseTo(307249.21, 2);
        expect(quotasIrpj.map((g: any) => `${g.cota}/${g.totalCotas}`)).toEqual(['1/3', '2/3', '3/3']);

        // Vencimentos: abril 30 (qui), maio 31/05 é domingo -> 29/05, junho 30 (ter)
        expect(quotasIrpj.map((g: any) => g.vencimento)).toEqual(['2026-04-30', '2026-05-29', '2026-06-30']);

        // Payload SICALC leva a cota e o vencimento da quota
        const chamadas = mockInvokeIntegraContador.mock.calls.map((c) => c[0])
            .filter((c) => c.idSistema === 'SICALC' && c.dados.codigoReceita === '2089');
        expect(chamadas.map((c) => c.dados.cota)).toEqual(['1', '2', '3']);
        expect(chamadas[1].dados.vencimento).toBe('2026-05-29T00:00:00');
        expect(chamadas[1].dados.tipoPA).toBe('TR');
        expect(chamadas[1].dados.dataPA).toBe('01/2026');

        // PIS mensal NÃO ganha quota (sai 1 guia, sem cota)
        const pis = r.guias.filter((g: any) => g.codigo === '8109');
        expect(pis).toHaveLength(1);
        expect(pis[0].cota).toBeNull();
        const chamadaPis = mockInvokeIntegraContador.mock.calls.map((c) => c[0])
            .find((c) => c.dados?.codigoReceita === '8109');
        expect(chamadaPis.dados.cota).toBeUndefined();
    });

    it('valor que não comporta as quotas cai pra quota única com aviso (mínimo R$1.000/quota)', async () => {
        const xml = xmlIrpjGrande().replace(/307249\.21/g, '2500.00');
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { XMLStringBase64: Buffer.from(xml, 'utf8').toString('base64') },
        });
        mockInvokeIntegraContador.mockResolvedValue({
            dados: { consolidado: {}, darf: 'PDF', numeroDocumento: 'D' },
        });
        // 2500/3 = 833 < 1000 -> única com aviso; 2500/2 = 1250 ok seria 2
        const r = await gerarDarfsSeparados({
            empresaCnpj: '00005430000104', anoPA: 2026, mesPA: 3, quotasTrimestrais: 3,
        });
        const irpj = r.guias.filter((g: any) => g.codigo === '2089');
        expect(irpj).toHaveLength(1);
        expect(irpj[0].cota).toBeNull();
        // A grafia da tela é "cota" (Paulo, 13/08) — a lei escreve "quota", o
        // escritório escreve cota, e quem lê o aviso é o colaborador.
        expect(irpj[0].aviso).toMatch(/cota única/i);
    });

    it('quota única (default) mantém o comportamento anterior', async () => {
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { XMLStringBase64: Buffer.from(xmlIrpjGrande(), 'utf8').toString('base64') },
        });
        mockInvokeIntegraContador.mockResolvedValue({
            dados: { consolidado: {}, darf: 'PDF', numeroDocumento: 'D' },
        });
        const r = await gerarDarfsSeparados({ empresaCnpj: '00005430000104', anoPA: 2026, mesPA: 3 });
        const irpj = r.guias.filter((g: any) => g.codigo === '2089');
        expect(irpj).toHaveLength(1);
        expect(irpj[0].cota).toBeNull();
        expect(irpj[0].vencimento).toBe('2026-04-30');
    });
});

describe('gerarDarfsSeparados — IPI mensal (caso Experte 06/2026)', () => {
    beforeEach(() => mockInvokeIntegraContador.mockReset());

    // Regressão: IPI 5123-01 transmitido no MIT aparecia na declaração mas
    // SUMIA das guias separadas (RECEITAS_GUIA_SEPARADA não tinha IPI). IPI
    // mensal vence dia 25 do mês seguinte (Lei 11.933/2009) — mesmo grupo do
    // PIS/COFINS (25/07/2026 é sábado → antecipa 24/07).
    function xmlComIpi() {
        const ct = (cod: string, desc: string, valor: string) =>
            `<CreditoTributarioApurado><codReceita>${cod}</codReceita>`
            + `<ctDescricaoTributo>${desc}</ctDescricaoTributo>`
            + `<ctValor>${valor}</ctValor><saldoaPagar>${valor}</saldoaPagar></CreditoTributarioApurado>`;
        return '<?xml version="1.0"?><ProcDctf><ConteudoDeclaracao id="I"><DctfXml><A050>'
            + ct('810902', 'PIS - FATURAMENTO', '2698.21')
            + ct('217201', 'COFINS - FATURAMENTO/PJ EM GERAL', '12453.27')
            + ct('512301', 'IPI - DEMAIS PRODUTOS', '7352.90')
            + '</A050></DctfXml></ConteudoDeclaracao></ProcDctf>';
    }

    it('emite guia avulsa do IPI no grupo do dia 25 (antecipado), junto de PIS/COFINS', async () => {
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { XMLStringBase64: Buffer.from(xmlComIpi(), 'utf8').toString('base64') },
        });
        mockInvokeIntegraContador.mockResolvedValue({
            dados: { consolidado: {}, darf: 'PDF', numeroDocumento: 'D' },
        });

        const r = await gerarDarfsSeparados({ empresaCnpj: '67267435000178', anoPA: 2026, mesPA: 6 });

        expect(r.guias.map((g: any) => g.codigo).sort()).toEqual(['2172', '5123', '8109']);
        expect(r.naoEmitidos).toHaveLength(0);
        expect(Object.keys(r.grupos)).toEqual(['2026-07-24']);
        expect(r.grupos['2026-07-24'].map((g: any) => g.codigo).sort()).toEqual(['2172', '5123', '8109']);

        const ipi = mockInvokeIntegraContador.mock.calls.map((c) => c[0])
            .find((c) => c.dados?.codigoReceita === '5123');
        expect(ipi?.dados).toMatchObject({
            codigoReceitaExtensao: '01', tipoPA: 'ME', dataPA: '06/2026',
            vencimento: '2026-07-24T00:00:00', valorImposto: '7352.90',
        });
    });

    it('IPI-cigarros (5110) e IPI-importação (0676) seguem fora da guia avulsa', async () => {
        const ct = (cod: string, valor: string) =>
            `<CreditoTributarioApurado><codReceita>${cod}</codReceita>`
            + `<ctValor>${valor}</ctValor><saldoaPagar>${valor}</saldoaPagar></CreditoTributarioApurado>`;
        const xml = '<?xml version="1.0"?><ProcDctf><ConteudoDeclaracao id="I"><DctfXml><A050>'
            + ct('511001', '100.00') + ct('067601', '200.00')
            + '</A050></DctfXml></ConteudoDeclaracao></ProcDctf>';
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { XMLStringBase64: Buffer.from(xml, 'utf8').toString('base64') },
        });
        const r = await gerarDarfsSeparados({ empresaCnpj: '67267435000178', anoPA: 2026, mesPA: 6 });
        expect(r.guias).toHaveLength(0);
        expect(r.naoEmitidos.map((n: any) => n.codigo).sort()).toEqual(['0676', '5110']);
    });
});

describe('gerarDarfsSeparados — escopo apenasCodigos (painel trimestrais)', () => {
    beforeEach(() => mockInvokeIntegraContador.mockReset());

    it('com apenasCodigos=[trimestrais], NÃO emite PIS/COFINS (não cobra escondido)', async () => {
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { XMLStringBase64: Buffer.from(xmlDeclaracao(), 'utf8').toString('base64') },
        });
        mockInvokeIntegraContador.mockResolvedValue({
            dados: { consolidado: {}, darf: 'PDF', numeroDocumento: 'D' },
        });

        const r = await gerarDarfsSeparados({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6,
            apenasCodigos: ['2089', '0220', '2372', '6012'],
        });

        // Só IRPJ/CSLL emitidos; PIS/COFINS nem tocados (sem cobrança oculta).
        expect(r.guias.map((g: any) => g.codigo).sort()).toEqual(['2089', '2372']);
        const emitidos = mockInvokeIntegraContador.mock.calls
            .map((c) => c[0]).filter((c) => c.idSistema === 'SICALC')
            .map((c) => c.dados.codigoReceita).sort();
        expect(emitidos).toEqual(['2089', '2372']); // 8109/2172 NÃO chamados
    });

    it('escopo sem match na declaração falha claro (nada é cobrado)', async () => {
        // XML só com PIS/COFINS; pede escopo trimestral → nenhum débito no escopo
        const soMensais = '<?xml version="1.0"?><ProcDctf><ConteudoDeclaracao id="I"><DctfXml><A050>'
            + '<CreditoTributarioApurado><codReceita>810902</codReceita><ctValor>13</ctValor><saldoaPagar>13</saldoaPagar></CreditoTributarioApurado>'
            + '</A050></DctfXml></ConteudoDeclaracao></ProcDctf>';
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { XMLStringBase64: Buffer.from(soMensais, 'utf8').toString('base64') },
        });
        await expect(gerarDarfsSeparados({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6, apenasCodigos: ['2089', '2372'],
        })).rejects.toThrow(/escopo/i);
    });
});
