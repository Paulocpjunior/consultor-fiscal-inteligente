/**
 * Testes do motor de cruzamento DCTFWeb × apuração do app.
 */
import {
    extrairTributosApp,
    cruzarTributos,
    type TributosPorFamilia,
} from '../services/dctfwebConference';

describe('extrairTributosApp — soma por família a partir do detalhamento', () => {
    it('mapeia por prefixo do nome do imposto', () => {
        const det: any[] = [
            { imposto: 'IRPJ (Trimestral)', valor: 1000 },
            { imposto: 'CSLL (Lucro Real Mensal)', valor: 360 },
            { imposto: 'PIS (Cumulativo)', valor: 65 },
            { imposto: 'COFINS (Cumulativo)', valor: 300 },
        ];
        expect(extrairTributosApp(det)).toEqual({ IRPJ: 1000, CSLL: 360, PIS: 65, COFINS: 300, IPI: 0 });
    });

    it('soma múltiplas linhas de PIS/COFINS (cumulativo + rec financeira + importação)', () => {
        const det: any[] = [
            { imposto: 'PIS (Lucro Real)', valor: 100 },
            { imposto: 'PIS (Rec. Financeira)', valor: 10 },
            { imposto: 'PIS (Importação)', valor: 5 },
            { imposto: 'COFINS (Lucro Real)', valor: 460 },
            { imposto: 'COFINS (Aplicações)', valor: 40 },
        ];
        const r = extrairTributosApp(det);
        expect(r.PIS).toBe(115);
        expect(r.COFINS).toBe(500);
    });

    it('ignora ISS/ICMS mas SOMA IPI (IPI é federal e entra no MIT)', () => {
        const det: any[] = [
            { imposto: 'ISS (5%)', valor: 250 },
            { imposto: 'ICMS Próprio', valor: 999 },
            { imposto: 'IPI', valor: 100 },
            { imposto: 'IRPJ (Trimestral)', valor: 1000 },
        ];
        const r = extrairTributosApp(det);
        expect(r).toEqual({ IRPJ: 1000, CSLL: 0, PIS: 0, COFINS: 0, IPI: 100 });
    });

    it('IRPJ/CSLL combinado vai pra IRPJ (convenção)', () => {
        const det: any[] = [{ imposto: 'IRPJ/CSLL (Lucro Real)', valor: 1360 }];
        expect(extrairTributosApp(det).IRPJ).toBe(1360);
    });

    it('lista vazia/null → tudo zero', () => {
        expect(extrairTributosApp([])).toEqual({ IRPJ: 0, CSLL: 0, PIS: 0, COFINS: 0, IPI: 0 });
        expect(extrairTributosApp(null)).toEqual({ IRPJ: 0, CSLL: 0, PIS: 0, COFINS: 0, IPI: 0 });
    });

    it('piso absoluto: diferença grande em R$ com % pequeno não fica "baixa"', () => {
        // IRPJ app 100000 vs dctfweb 96000 → 4% (seria "baixa") mas R$4k > R$500 → "media".
        const r = cruzarTributos(
            { IRPJ: 100000, CSLL: 0, PIS: 0, COFINS: 0, IPI: 0 },
            { IRPJ: 96000, CSLL: 0, PIS: 0, COFINS: 0, IPI: 0 },
            '2026-06',
        );
        const irpj = r.divergencias.find(d => d.tributo === 'IRPJ')!;
        expect(irpj.status).toBe('divergente');
        expect(irpj.severidade).toBe('media'); // R$4k: sai de "baixa" para "media"
        // Diferença > R$5k sobe para "alta" mesmo com % baixo.
        const r2 = cruzarTributos(
            { IRPJ: 100000, CSLL: 0, PIS: 0, COFINS: 0, IPI: 0 },
            { IRPJ: 93000, CSLL: 0, PIS: 0, COFINS: 0, IPI: 0 },
            '2026-06',
        );
        expect(r2.divergencias.find(d => d.tributo === 'IRPJ')!.severidade).toBe('alta');
    });

    it('usa valorBruto (débito) quando presente — não o valor líquido de retenção', () => {
        const det: any[] = [
            { imposto: 'IRPJ (Mensal)', valor: 8500, valorBruto: 10000, retencao: 1500 },
            { imposto: 'PIS (Lucro Real)', valor: 2800, valorBruto: 3300, retencao: 500 },
        ];
        const r = extrairTributosApp(det);
        expect(r.IRPJ).toBe(10000); // bruto, não 8500
        expect(r.PIS).toBe(3300);   // bruto, não 2800
    });
});

const mk = (o: Partial<TributosPorFamilia>): TributosPorFamilia =>
    ({ IRPJ: 0, CSLL: 0, PIS: 0, COFINS: 0, IPI: 0, ...o });

describe('cruzarTributos — status e severidade', () => {
    it('valores idênticos → tudo ok', () => {
        const app = mk({ IRPJ: 1000, CSLL: 360, PIS: 65, COFINS: 300 });
        const r = cruzarTributos(app, { ...app }, '2026-03');
        expect(r.temDivergencia).toBe(false);
        expect(r.resumo.ok).toBe(5);
        expect(r.divergencias.every(d => d.status === 'ok')).toBe(true);
    });

    it('diferença dentro da tolerância (centavos) → ok', () => {
        const app = mk({ IRPJ: 1000.00 });
        const dctf = mk({ IRPJ: 1000.01 });
        const r = cruzarTributos(app, dctf, '2026-03');
        expect(r.divergencias.find(d => d.tributo === 'IRPJ')!.status).toBe('ok');
    });

    it('app apurou mas DCTFWeb não declarou → sem-dctfweb, severidade alta', () => {
        const r = cruzarTributos(mk({ IRPJ: 1000 }), mk({}), '2026-03');
        const irpj = r.divergencias.find(d => d.tributo === 'IRPJ')!;
        expect(irpj.status).toBe('sem-dctfweb');
        expect(irpj.severidade).toBe('alta');
        expect(r.temDivergencia).toBe(true);
    });

    it('DCTFWeb declarou mas app não apurou → sem-apuracao-app, severidade media', () => {
        const r = cruzarTributos(mk({}), mk({ CSLL: 360 }), '2026-03');
        const csll = r.divergencias.find(d => d.tributo === 'CSLL')!;
        expect(csll.status).toBe('sem-apuracao-app');
        expect(csll.severidade).toBe('media');
    });

    it('divergência > 10% → alta', () => {
        const r = cruzarTributos(mk({ COFINS: 300 }), mk({ COFINS: 200 }), '2026-03');
        const c = r.divergencias.find(d => d.tributo === 'COFINS')!;
        expect(c.status).toBe('divergente');
        expect(c.severidade).toBe('alta');  // (300-200)/300 = 33%
    });

    it('divergência entre 5% e 10% → media', () => {
        const r = cruzarTributos(mk({ IRPJ: 1000 }), mk({ IRPJ: 930 }), '2026-03');
        const i = r.divergencias.find(d => d.tributo === 'IRPJ')!;
        expect(i.severidade).toBe('media'); // 7%
    });

    it('divergência <= 5% → baixa', () => {
        const r = cruzarTributos(mk({ IRPJ: 1000 }), mk({ IRPJ: 970 }), '2026-03');
        const i = r.divergencias.find(d => d.tributo === 'IRPJ')!;
        expect(i.severidade).toBe('baixa'); // 3%
    });

    it('totais e sinal da diferença', () => {
        const r = cruzarTributos(mk({ IRPJ: 1000, PIS: 65 }), mk({ IRPJ: 900, PIS: 65 }), '2026-03');
        expect(r.totalApp).toBe(1065);
        expect(r.totalDctfweb).toBe(965);
        const irpj = r.divergencias.find(d => d.tributo === 'IRPJ')!;
        expect(irpj.diferenca).toBe(100);  // app - dctfweb
    });
});
