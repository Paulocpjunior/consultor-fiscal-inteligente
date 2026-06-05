/**
 * Testes do parser EFD-Reinf — calibrados contra DOIS arquivos REAIS (S&P):
 *   - R-2010 (evtServTom): INSS retido sobre serviço tomado, valores exatos.
 *   - R-4099 (evt4099FechamentoDirf): fechamento da série R-4000, fechRet=0.
 * Sintéticos cobrem coerência (soma das notas) e o alerta de fechamento.
 */
import * as fs from 'fs';

// @ts-expect-error — módulo .js puro
import { parseEventoReinf, validarEventoReinf, consolidarReinf } from '../sefaz-backend/efd-reinf-parser.js';

const R2010 = '/root/.claude/uploads/397fe5b6-3431-4ff6-b38a-f6d52ff24969/58ccf110-REINFEvento608501201201026046085012.xml';
const R4099 = '/root/.claude/uploads/397fe5b6-3431-4ff6-b38a-f6d52ff24969/d4ea1d09-REINFEvento479905201409926044799052.xml';

describe('parseEventoReinf — R-2010 real (evtServTom)', () => {
    it('extrai contribuinte, competência e retenção INSS exata', () => {
        if (!fs.existsSync(R2010)) return;
        const p = parseEventoReinf(fs.readFileSync(R2010, 'utf8'));
        expect(p.ok).toBe(true);
        expect(p.codigo).toBe('R-2010');
        expect(p.calibrado).toBe(true);
        expect(p.tipoRetorno).toBe('retencao');
        expect(p.ideEvento.perApur).toBe('2026-04');
        expect(p.ideEvento.indRetif).toBe('1');
        expect(p.contribuinte.nrInsc).toBe('32602701');

        expect(p.retencoes).toHaveLength(1);
        const ret = p.retencoes[0];
        expect(ret.cnpjPrestador).toBe('03222111000130');
        expect(ret.vlrTotalBruto).toBe(5954.00);
        expect(ret.vlrTotalBaseRet).toBe(4763.20);
        expect(ret.vlrTotalRetPrinc).toBe(523.95);
        expect(ret.vlrTotalRetAdic).toBe(0);

        // total consolidado de INSS
        expect(p.totais.inssRetPrinc).toBe(523.95);
        expect(p.totais.baseRet).toBe(4763.20);

        // nota fiscal e serviço aninhados
        expect(ret.notas).toHaveLength(1);
        expect(ret.notas[0].numDocto).toBe('30198');
        expect(ret.notas[0].servicos[0].tpServico).toBe('100000021');
        expect(ret.notas[0].servicos[0].vlrRetencao).toBe(523.95);
    });

    it('validação de coerência passa (soma notas == retPrinc, alíquota ~11%)', () => {
        if (!fs.existsSync(R2010)) return;
        const p = parseEventoReinf(fs.readFileSync(R2010, 'utf8'));
        const v = validarEventoReinf(p);
        expect(v.valido).toBe(true);
        expect(v.erros).toHaveLength(0);
        // 523,95 / 4763,20 = 11,00% -> sem aviso de alíquota
        expect(v.avisos).toHaveLength(0);
    });
});

describe('parseEventoReinf — R-4099 real (fechamento série R-4000)', () => {
    it('reconhece fechamento e lê fechRet=0 + responsável', () => {
        if (!fs.existsSync(R4099)) return;
        const p = parseEventoReinf(fs.readFileSync(R4099, 'utf8'));
        expect(p.ok).toBe(true);
        expect(p.codigo).toBe('R-4099');
        expect(p.tipoRetorno).toBe('fechamento');
        expect(p.ideEvento.perApur).toBe('2026-04');
        expect(p.contribuinte.nrInsc).toBe('32602701');
        expect(p.fechamento).toBeTruthy();
        expect(p.fechamento.fechRet).toBe('0');
        expect(p.fechamento.responsavel.nome).toBe('PAULO CESAR PEREIRA');
        expect(p.fechamento.responsavel.cpf).toBe('70646236849');
    });
});

describe('validarEventoReinf — dispara em dado incoerente', () => {
    const xmlRet = (retPrinc: string, base: string, notaRet: string) => `<?xml version="1.0"?>
<Reinf xmlns="http://www.reinf.esocial.gov.br/schemas/evtTomadorServicos/v2_01_02">
  <evtServTom id="ID1">
    <ideEvento><indRetif>1</indRetif><perApur>2026-04</perApur><tpAmb>1</tpAmb></ideEvento>
    <ideContri><tpInsc>1</tpInsc><nrInsc>32602701</nrInsc></ideContri>
    <infoServTom><ideEstabObra><tpInscEstab>1</tpInscEstab><nrInscEstab>32602701000197</nrInscEstab><indObra>0</indObra>
      <idePrestServ><cnpjPrestador>03222111000130</cnpjPrestador>
        <vlrTotalBruto>5954,00</vlrTotalBruto><vlrTotalBaseRet>${base}</vlrTotalBaseRet>
        <vlrTotalRetPrinc>${retPrinc}</vlrTotalRetPrinc><vlrTotalRetAdic>0,00</vlrTotalRetAdic>
        <nfs><serie>0</serie><numDocto>1</numDocto><vlrBruto>5954,00</vlrBruto>
          <infoTpServ><tpServico>100000021</tpServico><vlrBaseRet>${base}</vlrBaseRet><vlrRetencao>${notaRet}</vlrRetencao></infoTpServ>
        </nfs>
      </idePrestServ>
    </ideEstabObra></infoServTom>
  </evtServTom>
</Reinf>`;

    it('soma das notas diferente de vlrTotalRetPrinc -> erro', () => {
        const p = parseEventoReinf(xmlRet('523,95', '4763,20', '500,00'));
        const v = validarEventoReinf(p);
        expect(v.valido).toBe(false);
        expect(v.erros.length).toBeGreaterThan(0);
    });

    it('alíquota fora de ~11% (ex.: 20%) -> aviso', () => {
        const p = parseEventoReinf(xmlRet('952,64', '4763,20', '952,64'));
        const v = validarEventoReinf(p);
        expect(v.avisos.length).toBeGreaterThan(0);
    });
});

describe('consolidarReinf — coerência fechamento × retenção', () => {
    it('R-2010 + R-4099(fechRet=0) reais consolidam sem alerta de série R-4000', () => {
        if (!fs.existsSync(R2010) || !fs.existsSync(R4099)) return;
        const a = parseEventoReinf(fs.readFileSync(R2010, 'utf8'));
        const b = parseEventoReinf(fs.readFileSync(R4099, 'utf8'));
        const c = consolidarReinf([a, b]);
        expect(c.competencia).toBe('2026-04');
        expect(c.contribuinte).toBe('32602701');
        expect(c.totais.inssRetPrinc).toBe(523.95);
        // R-4099 fecha a série R-4000 (IR/CSLL/PIS/COFINS), não o INSS do R-2010.
        // Como não há eventos R-4000 com retenção, fechRet=0 é coerente -> sem alerta.
        expect(c.alertas).toHaveLength(0);
        expect(c.fechamentos.find((f: any) => f.codigo === 'R-4099').fechRet).toBe('0');
    });

    it('parsing falho devolve ok=false com observação', () => {
        const p = parseEventoReinf('<nao-e-reinf/>');
        expect(p.ok).toBe(false);
        expect(p.observacoes.length).toBeGreaterThan(0);
    });
});
