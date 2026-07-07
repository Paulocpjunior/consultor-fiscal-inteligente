/**
 * Trava o guard de encerramento MIT no frontend. Caso real
 * (55070577000161 · 06/2026): apuração criada no e-CAC em edição volta com
 * Debitos VAZIO; o guard antigo liberava o clique e o SERPRO devolvia 400
 * [EntradaIncorreta-MIT-MSG_0003]. Agora o botão bloqueia com orientação.
 */
import {
    contarDebitosMit,
    analisarApuracaoMitParaEncerramento,
} from '../components/DCTFWeb/mitApuracaoPayload';

describe('contarDebitosMit', () => {
    it('conta débitos no shape oficial (grupos com ListaDebitos)', () => {
        expect(contarDebitosMit({
            Irpj: { ListaDebitos: [{ CodigoDebito: '236201', ValorDebito: 100 }] },
            Csll: { ListaDebitos: [{ CodigoDebito: '248401', ValorDebito: 50 }, { CodigoDebito: '248402', ValorDebito: 5 }] },
        })).toBe(3);
    });

    it('Debitos vazio/ausente conta zero', () => {
        expect(contarDebitosMit(undefined)).toBe(0);
        expect(contarDebitosMit(null)).toBe(0);
        expect(contarDebitosMit({})).toBe(0);
        expect(contarDebitosMit({ Irpj: { ListaDebitos: [] } })).toBe(0);
        expect(contarDebitosMit([])).toBe(0);
    });

    it('aceita array direto (shape defensivo)', () => {
        expect(contarDebitosMit([{ CodigoDebito: '1' }, { CodigoDebito: '2' }])).toBe(2);
    });
});

describe('analisarApuracaoMitParaEncerramento', () => {
    const base = {
        PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
        DadosIniciais: { SemMovimento: false, QualificacaoPj: 1 },
    };

    it('bloqueia apuração com movimento e sem débitos, com motivo acionável', () => {
        const r = analisarApuracaoMitParaEncerramento({ ...base, Debitos: {} });
        expect(r.completa).toBe(false);
        expect(r.motivo).toMatch(/SEM débitos/i);
        expect(r.motivo).toMatch(/e-CAC/);
    });

    it('libera com ao menos um débito lançado', () => {
        const r = analisarApuracaoMitParaEncerramento({
            ...base,
            Debitos: { Irpj: { ListaDebitos: [{ CodigoDebito: '236201', ValorDebito: 100 }] } },
        });
        expect(r.completa).toBe(true);
        expect(r.totalDebitos).toBe(1);
    });

    it('libera Sem Movimento mesmo sem débitos', () => {
        const r = analisarApuracaoMitParaEncerramento({
            PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
            DadosIniciais: { SemMovimento: true },
        });
        expect(r.completa).toBe(true);
    });

    it('sem DadosIniciais bloqueia com motivo próprio', () => {
        const r = analisarApuracaoMitParaEncerramento({
            PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
        });
        expect(r.completa).toBe(false);
        expect(r.motivo).toMatch(/DadosIniciais/);
    });

    it('sem payload não inventa motivo (chamador usa a mensagem de "não encontrada")', () => {
        const r = analisarApuracaoMitParaEncerramento(null);
        expect(r.completa).toBe(false);
        expect(r.motivo).toBeNull();
    });

    it('acha o payload aninhado em dadosApuracaoMit[] (shape do CONSAPURACAO316)', () => {
        const r = analisarApuracaoMitParaEncerramento({
            dadosApuracaoMit: [{ ...base, Debitos: {} }],
        });
        expect(r.completa).toBe(false);
        expect(r.motivo).toMatch(/SEM débitos/i);
    });
});
