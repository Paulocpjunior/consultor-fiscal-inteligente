/**
 * Trava o builder do preenchimento automático do MIT: códigos vêm SEMPRE da
 * apuração-modelo (mês anterior da própria empresa), valores vêm da apuração
 * do app. Sem código de referência para família com valor → FALHA clara,
 * nunca chuta código de receita.
 */
import { extrairModeloDebitosMit, montarDebitosMit } from '../sefaz-backend/mit-debitos-builder';

const MODELO_MAIO = {
    dadosApuracaoMit: [{
        PeriodoApuracao: { MesApuracao: 5, AnoApuracao: 2026 },
        DadosIniciais: { SemMovimento: false, QualificacaoPj: 1 },
        Debitos: {
            Irpj: { ListaDebitos: [{ IdDebito: 1, CodigoDebito: '236201', ValorDebito: 3000 }] },
            Csll: { ListaDebitos: [{ IdDebito: 2, CodigoDebito: '248401', ValorDebito: 1500 }] },
            PisPasep: { ListaDebitos: [{ IdDebito: 3, CodigoDebito: '810901', ValorDebito: 400 }] },
            Cofins: { ListaDebitos: [{ IdDebito: 4, CodigoDebito: '217201', ValorDebito: 1800 }] },
        },
    }],
};

describe('extrairModeloDebitosMit', () => {
    it('extrai código e grupo por família do shape oficial', () => {
        const m = extrairModeloDebitosMit(MODELO_MAIO);
        expect(m.totalDebitos).toBe(4);
        expect(m.codigoPorFamilia.IRPJ).toEqual({ codigo: '236201', grupo: 'Irpj' });
        expect(m.codigoPorFamilia.PIS).toEqual({ codigo: '810901', grupo: 'PisPasep' });
        expect(m.codigoPorFamilia.COFINS).toEqual({ codigo: '217201', grupo: 'Cofins' });
    });

    it('resolve família pelo código quando o grupo é desconhecido', () => {
        const m = extrairModeloDebitosMit({
            Debitos: { GrupoEstranho: { ListaDebitos: [{ CodigoDebito: '248402', ValorDebito: 10 }] } },
        });
        expect(m.codigoPorFamilia.CSLL).toEqual({ codigo: '248402', grupo: 'Csll' });
    });

    it('modelo vazio/sem débitos → sem códigos', () => {
        expect(extrairModeloDebitosMit(null).totalDebitos).toBe(0);
        expect(extrairModeloDebitosMit({ Debitos: {} }).totalDebitos).toBe(0);
        expect(extrairModeloDebitosMit({ Debitos: { Irpj: { ListaDebitos: [] } } }).totalDebitos).toBe(0);
    });
});

describe('montarDebitosMit', () => {
    const modelo = extrairModeloDebitosMit(MODELO_MAIO);

    it('monta débitos com códigos do modelo e valores do app', () => {
        const r = montarDebitosMit({ IRPJ: 3200.5, CSLL: 1600.25, PIS: 410.1, COFINS: 1890.33 }, modelo);
        expect(r.ok).toBe(true);
        expect(r.totalProposto).toBe(7101.18);
        expect(r.debitos!.Irpj.ListaDebitos).toEqual([
            { IdDebito: 1, CodigoDebito: '236201', ValorDebito: 3200.5 },
        ]);
        expect(r.debitos!.PisPasep.ListaDebitos[0].CodigoDebito).toBe('810901');
        expect(r.mapeamento).toHaveLength(4);
    });

    it('família com valor zero fica de fora (sem débito zerado)', () => {
        const r = montarDebitosMit({ IRPJ: 1000, CSLL: 0, PIS: 0, COFINS: 0 }, modelo);
        expect(r.ok).toBe(true);
        expect(r.mapeamento).toHaveLength(1);
        expect(r.debitos!.Csll).toBeUndefined();
    });

    it('família com valor e SEM código no modelo → falha clara, não chuta', () => {
        const modeloSoIrpj = extrairModeloDebitosMit({
            Debitos: { Irpj: { ListaDebitos: [{ CodigoDebito: '236201', ValorDebito: 1 }] } },
        });
        const r = montarDebitosMit({ IRPJ: 1000, COFINS: 500 }, modeloSoIrpj);
        expect(r.ok).toBe(false);
        expect(r.erros.join(' ')).toMatch(/COFINS/);
        expect(r.erros.join(' ')).toMatch(/e-CAC/);
        expect(r.debitos).toBeNull();
    });

    it('tudo zerado → falha orientando Sem Movimento', () => {
        const r = montarDebitosMit({ IRPJ: 0, CSLL: 0, PIS: 0, COFINS: 0 }, modelo);
        expect(r.ok).toBe(false);
        expect(r.erros.join(' ')).toMatch(/Sem Movimento/i);
    });

    it('valor negativo → falha', () => {
        const r = montarDebitosMit({ IRPJ: -10 }, modelo);
        expect(r.ok).toBe(false);
        expect(r.erros.join(' ')).toMatch(/negativo/);
    });

    it('arredonda para 2 casas', () => {
        const r = montarDebitosMit({ IRPJ: 100.005 }, modelo);
        expect(r.ok).toBe(true);
        expect(r.debitos!.Irpj.ListaDebitos[0].ValorDebito).toBe(100.01);
    });
});
