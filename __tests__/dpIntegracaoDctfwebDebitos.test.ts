/**
 * POST /api/dp-integration/dctfweb/debitos — o que a conferência pós-folha do
 * Consultor DP recebe para comparar a DCTFWeb com o S-5011 do eSocial.
 *
 * Paulo, 04/10/2026: "pode publicar a rota do cfi". O túnel já devolvia só a
 * SITUAÇÃO da DCTFWeb; os valores eram descartados. Esta rota reaproveita a
 * leitura das guias separadas (extrairDebitosDctfweb) e trava as regras:
 * identificação conferida pelo próprio XML, ausência de XML não vira "sem
 * débito", e `fonte` sempre vai junto (o DP recusa número de mock).
 */
// @ts-expect-error — módulo .js puro
import { montarRespostaDebitosDctfweb } from '../sefaz-backend/dp-dctfweb-debitos.js';

/** Mesmo shape do CONSXMLDECLARACAO real (e do mock do dctfweb-provider). */
const xml = (cnpj: string, perApuracao: string) => `<?xml version="1.0" encoding="utf-8"?>`
    + `<ProcDctf xmlns="http://www.serpro.gov.br/dctf/v1"><ConteudoDeclaracao>`
    + `<DctfXml versao="3.0"><A000-DadosIdentificadoresContribuinte>`
    + `<inscContrib>${cnpj}</inscContrib><perApuracao>${perApuracao}</perApuracao>`
    + `<categoriaDCTF>40</categoriaDCTF><A050-CreditosTributariosApurados>`
    + `<CreditoTributarioApurado><codReceita>108201</codReceita><ctDescricaoTributo>CP SEGURADOS - EMPREGADOS/AVULSOS</ctDescricaoTributo>`
    + `<ctValor>810.00</ctValor><saldoaPagar>810.00</saldoaPagar></CreditoTributarioApurado>`
    + `<CreditoTributarioApurado><codReceita>113801</codReceita><ctDescricaoTributo>CP PATRONAL - EMPREGADOS/AVULSOS</ctDescricaoTributo>`
    + `<ctValor>2100.00</ctValor><saldoaPagar>2050.00</saldoaPagar></CreditoTributarioApurado>`
    + `<CreditoTributarioApurado><codReceita>116201</codReceita><ctDescricaoTributo>CP PATRONAL - RETENCAO</ctDescricaoTributo>`
    + `<ctValor>100.00</ctValor><saldoaPagar>0</saldoaPagar></CreditoTributarioApurado>`
    + `</A050-CreditosTributariosApurados></A000-DadosIdentificadoresContribuinte>`
    + `</DctfXml></ConteudoDeclaracao></ProcDctf>`;

const pedido = { cnpj: '29463877000109', competencia: '2026-09' };

describe('dp-integration › dctfweb/debitos', () => {
    it('devolve os débitos com saldo a pagar, por código de receita, com a identificação lida do XML', () => {
        const r = montarRespostaDebitosDctfweb({ xml: xml('29463877000109', '092026'), fonte: 'serpro' }, pedido);
        expect(r.ok).toBe(true);
        expect(r.fonte).toBe('serpro');
        expect(r.identificacao).toMatchObject({ cnpj: '29463877000109', competencia: '2026-09' });
        expect(r.debitos.map((d: { codReceita: string; valor: number }) => [d.codReceita, d.valor])).toEqual([['108201', 810], ['113801', 2050]]);
    });

    it('declaração de outra empresa ou outra competência volta ok=false, sem número', () => {
        const outraEmpresa = montarRespostaDebitosDctfweb({ xml: xml('11222333000181', '092026'), fonte: 'serpro' }, pedido);
        expect(outraEmpresa).toMatchObject({ ok: false, debitos: [] });
        expect(outraEmpresa.erro).toMatch(/não confere/);
        const outroMes = montarRespostaDebitosDctfweb({ xml: xml('29463877000109', '082026'), fonte: 'serpro' }, pedido);
        expect(outroMes).toMatchObject({ ok: false, debitos: [] });
    });

    it('sem XML (DCTFWeb não transmitida) volta ok=false com o motivo, nunca "sem débito"', () => {
        const r = montarRespostaDebitosDctfweb({ xml: '', fonte: 'serpro' }, pedido);
        expect(r).toMatchObject({ ok: false, debitos: [] });
        expect(r.erro).toMatch(/não devolveu o XML/);
    });

    it('XML ilegível volta ok=false com o motivo do leitor', () => {
        const r = montarRespostaDebitosDctfweb({ xml: '<ProcDctf><nada/></ProcDctf>', fonte: 'serpro' }, pedido);
        expect(r.ok).toBe(false);
        expect(r.debitos).toEqual([]);
        expect(r.erro).toMatch(/não identifica a declaração/);
    });

    it('declaração identificada sem nenhum débito a pagar (sem movimento) é ok com lista vazia', () => {
        const semMovimento = xml('29463877000109', '092026').replace(/<CreditoTributarioApurado>[\s\S]*?<\/CreditoTributarioApurado>/g, '');
        const r = montarRespostaDebitosDctfweb({ xml: semMovimento, fonte: 'serpro' }, pedido);
        expect(r).toMatchObject({ ok: true, debitos: [] });
    });

    it('a fonte mock vai junto, para o DP recusar', () => {
        expect(montarRespostaDebitosDctfweb({ xml: xml('29463877000109', '092026'), fonte: 'mock' }, pedido).fonte).toBe('mock');
    });
});
