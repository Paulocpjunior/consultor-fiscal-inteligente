/**
 * 🧾 R-9015 (evtRetCons) — o recibo de consolidação da série R-4000 (05/10).
 *
 * Paulo, 03/10, condomínio 54.061.189 · 09/2026: a conferência Reinf × DCTFWeb
 * mostrava "evtRetCons ⚠ não lido pelo CFI" e CSRF "DCTFWeb tem, sem evento
 * Reinf" — e o DARF dos retidos ficava TRAVADO (régua de 03/10: evento não
 * lido trava). Ele mandou o arquivo real; a forma abaixo é a DELE, campo a
 * campo, com o CNPJ trocado.
 *
 * Fatos cobrados: o R-9015 é lido (código, valores por código de receita na
 * família certa); a conferência fica OK com a DCTFWeb; o DARF destrava; e as
 * bordas não viram número: retorno com erro não soma, código fora das
 * famílias é dito, dois recibos não somam em dobro.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { parseEventoReinf, consolidarReinf } from '../sefaz-backend/efd-reinf-parser.js';
import {
    extrairRetencoesReinf, cruzarRetencoes, decidirEmissaoRetidos, eventosNaoLidosDoLote,
} from '../services/efdReinfConference';

/** A forma do arquivo real (sem a assinatura), com parâmetros para as bordas. */
function r9015(o: { cd?: string; dh?: string; recibo?: string; totais?: Array<[string, string]>; cnr?: Array<[string, string]> } = {}) {
    const totais = o.totais ?? [['595207', '208,09']];
    const cnr = o.cnr ?? totais;
    return '<?xml version="1.0" encoding="utf-8"?>'
        + '<Reinf xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
        + 'xmlns="http://www.reinf.esocial.gov.br/schemas/evtRetCons/v2_01_02">'
        + '<evtRetCons id="ID9015000000000000000000000119419330"><ideEvento><perApur>2026-09</perApur></ideEvento>'
        + '<ideContri><tpInsc>1</tpInsc><nrInsc>11222333</nrInsc></ideContri>'
        + `<ideRecRetorno><ideStatus><cdRetorno>${o.cd ?? '0'}</cdRetorno><descRetorno>${(o.cd ?? '0') === '0' ? 'SUCESSO' : 'ERRO'}</descRetorno></ideStatus></ideRecRetorno>`
        + `<infoRecEv><nrRecArqBase>${o.recibo ?? '5799223-09-4099-2609-5799223'}</nrRecArqBase>`
        + `<dhRecepcao>${o.dh ?? '2026-10-02T11:11:42.3818315-03:00'}</dhRecepcao><dhProcess>${o.dh ?? '2026-10-02T11:11:42.3818315-03:00'}</dhProcess>`
        + '<tpEv>4099</tpEv><idEv>ID1112223330000002026100211110804331</idEv><hash>x</hash><fechRet>0</fechRet></infoRecEv>'
        + '<infoCR_CNR><indExistInfo>1</indExistInfo><identEscritDCTF>170920397</identEscritDCTF>'
        + cnr.map(([cr, v]) => `<totApurMen><CRMen>${cr}</CRMen><vlrCRMenInf>${v}</vlrCRMenInf><vlrCRMenDCTF>${v}</vlrCRMenDCTF><natRend>15043</natRend></totApurMen>`).join('')
        + '</infoCR_CNR><infoTotalCR>'
        + totais.map(([cr, v]) => `<totApurMen><CRMen>${cr}</CRMen><vlrCRMenDCTF>${v}</vlrCRMenDCTF></totApurMen>`).join('')
        + '</infoTotalCR></evtRetCons></Reinf>';
}

describe('R-9015 — a forma do arquivo real', () => {
    it('é lido: código, calibrado, CSRF 595207 = R$ 208,09', () => {
        const p = parseEventoReinf(r9015());
        expect(p).toMatchObject({ ok: true, codigo: 'R-9015', calibrado: true, tipoRetorno: 'consolidacao' });
        expect(p.totais.csrf).toBe(208.09);
        expect(p.totais.irrf).toBe(0);
        expect(p.consolidacaoR9015?.porCodigo).toEqual([{ codigo: '595207', valor: 208.09, valorInformado: null, natRend: null }]);
        expect(p.observacoes).toEqual([]);
    });

    it('IRRF (1708) vai para o IRRF; o total vem do infoTotalCR', () => {
        const p = parseEventoReinf(r9015({ totais: [['170806', '1.234,56'], ['595207', '46,50']] }));
        expect(p.totais.irrf).toBe(1234.56);
        expect(p.totais.csrf).toBe(46.5);
    });

    it('não é mais "não lido" — o lote não trava por ele', () => {
        const p = parseEventoReinf(r9015());
        expect(eventosNaoLidosDoLote([{ ok: p.ok, codigo: p.codigo, schemaToken: p.schemaToken } as any])).toEqual([]);
    });
});

describe('R-9015 — da conferência ao DARF (o caso do condomínio)', () => {
    it('Reinf CSRF 208,09 × DCTFWeb CSRF 208,09: OK, e o DARF avulso 5952 destrava', () => {
        const p = parseEventoReinf(r9015());
        const cons = consolidarReinf([p]);
        const reinf = extrairRetencoesReinf(cons.totais);
        expect(reinf).toEqual({ INSS: 0, IRRF: 0, CSRF: 208.09 });
        const resultado = cruzarRetencoes(reinf, { INSS: 0, IRRF: 0, CSRF: 208.09 }, cons.competencia);
        expect(resultado.divergencias.find((d) => d.familia === 'CSRF')?.status).toBe('ok');
        const decisao = decidirEmissaoRetidos({ resultado, dctfwebLido: true, eventosNaoLidos: [] });
        expect(decisao.pode).toBe(true);
        expect(decisao.avulsos).toEqual([{ familia: 'CSRF', codigo: '5952', valor: 208.09 }]);
    });
});

describe('R-9015 — bordas que não viram número', () => {
    it('retorno com erro (cdRetorno ≠ 0): nada é somado, e é dito', () => {
        const p = parseEventoReinf(r9015({ cd: '2' }));
        expect(p.totais.csrf).toBe(0);
        expect(p.observacoes.join(' ')).toMatch(/não é consolidação aceita/);
        expect(consolidarReinf([p]).totais.csrf).toBe(0);
    });

    it('código de receita fora das famílias: não some, vai dito', () => {
        const p = parseEventoReinf(r9015({ totais: [['328006', '90,00']] }));
        expect(p.totais.irrf).toBe(0);
        expect(p.consolidacaoR9015?.foraDasFamilias.map((l: any) => l.codigo)).toEqual(['328006']);
        expect(p.observacoes.join(' ')).toMatch(/328006.*fora das famílias/);
    });

    it('sem infoTotalCR, vale a soma do infoCR_CNR', () => {
        const xml = r9015().replace(/<infoTotalCR>.*<\/infoTotalCR>/, '');
        expect(parseEventoReinf(xml).totais.csrf).toBe(208.09);
    });

    it('dois recibos da competência: vale o processado por último, sem somar em dobro', () => {
        const antigo = parseEventoReinf(r9015({ dh: '2026-10-02T10:00:00-03:00', recibo: 'A', totais: [['595207', '100,00']] }));
        const novo = parseEventoReinf(r9015({ dh: '2026-10-02T11:00:00-03:00', recibo: 'B' }));
        const cons = consolidarReinf([antigo, novo]);
        expect(cons.totais.csrf).toBe(208.09);
        expect(cons.alertas.join(' ')).toMatch(/2 recibos R-9015.*recibo B/);
    });
});
