/**
 * Apuração do ICMS-ST no Bloco E (E200/E210/E220/E250).
 *
 * Era o bloqueio que sobrou depois do E111: empresa que retém ST na saída não
 * fechava a EFD pelo CFI. A ST é apurada POR UF de destino — cada estado vira
 * uma guia própria.
 */
import {
    agruparStPorUf, apurarStDaUf, montarLinhasStBlocoE,
} from '../sefaz-backend/sped-bloco-e-st.js';

const saidaComSt = (uf: string, vST: number, extra: Record<string, unknown> = {}) => ({
    direcao: 'saida',
    destinatario: { uf },
    totais: { vST },
    ...extra,
});

describe('agruparStPorUf', () => {
    it('soma o ST retido por UF de destino e conta os documentos', () => {
        const r = agruparStPorUf([
            saidaComSt('MG', 100),
            saidaComSt('MG', 50),
            saidaComSt('RJ', 30),
        ], 'SP');

        expect(r).toEqual([
            { uf: 'MG', retencao: 150, documentos: 2 },
            { uf: 'RJ', retencao: 30, documentos: 1 },
        ]);
    });

    it('entrada, saída sem ST e nota cancelada ficam fora', () => {
        const r = agruparStPorUf([
            { direcao: 'entrada', destinatario: { uf: 'MG' }, totais: { vST: 900 } },
            saidaComSt('MG', 0),
            saidaComSt('MG', 100, { situacao: 'cancelada' }),
            saidaComSt('MG', 40),
        ], 'SP');
        expect(r).toEqual([{ uf: 'MG', retencao: 40, documentos: 1 }]);
    });

    it('soma pelos itens quando a nota não traz o total de ST', () => {
        const r = agruparStPorUf([
            { direcao: 'saida', destinatario: { uf: 'PR' }, itens: [{ vICMSST: 12.5 }, { vICMSST: 7.5 }] },
        ], 'SP');
        expect(r[0]).toMatchObject({ uf: 'PR', retencao: 20 });
    });
});

describe('apurarStDaUf', () => {
    it('retenção pura vira imposto a recolher', () => {
        const r = apurarStDaUf({ uf: 'MG', retencao: 1000 });
        expect(r.icmsRecolher).toBe(1000);
        expect(r.saldoCredorTransportar).toBe(0);
    });

    it('crédito maior que o débito transporta saldo credor (não vira imposto negativo)', () => {
        const r = apurarStDaUf({ uf: 'MG', retencao: 100, saldoCredorAnterior: 400 });
        expect(r.icmsRecolher).toBe(0);
        expect(r.saldoCredorTransportar).toBe(300);
    });

    it('ajustes: débito e estorno de crédito somam; crédito e estorno de débito abatem', () => {
        const r = apurarStDaUf({
            uf: 'SP', retencao: 1000,
            ajustes: { outrosDebitos: 100, estornosCredito: 50, outrosCreditos: 200, estornosDebito: 30 },
        });
        expect(r.ajDebitos).toBe(150);
        expect(r.ajCreditos).toBe(230);
        expect(r.icmsRecolher).toBe(920); // 1000 + 150 − 230
    });

    it('dedução só abate saldo devedor e débito especial fica fora da conta', () => {
        const r = apurarStDaUf({ uf: 'SP', retencao: 500, ajustes: { deducoes: 200, debitosEspeciais: 90 } });
        expect(r.icmsRecolher).toBe(300);
        expect(r.debitosEspeciais).toBe(90);
    });
});

describe('montarLinhasStBlocoE', () => {
    const base = {
        notas: [saidaComSt('SP', 1000), saidaComSt('MG', 500)],
        ufEmpresa: 'SP',
        dtIni: '01072026', dtFin: '31072026',
    };

    it('gera um E200 + E210 por UF, em ordem', () => {
        const r = montarLinhasStBlocoE(base);
        const e200 = r.linhas.filter((l: string) => l.startsWith('E200'));
        expect(e200).toEqual(['E200|MG|01072026|31072026|', 'E200|SP|01072026|31072026|']);
        expect(r.linhas.filter((l: string) => l.startsWith('E210'))).toHaveLength(2);
    });

    it('E210 leva a retenção no campo próprio e o imposto a recolher', () => {
        const r = montarLinhasStBlocoE(base);
        const e210Sp = r.linhas.find((l: string) => l.startsWith('E210') && l.includes('1000,00'));
        expect(e210Sp).toBe('E210|1|0,00|0,00|0,00|0,00|0,00|1000,00|0,00|0,00|0,00|0,00|1000,00|0,00|0,00|');
    });

    it('ajuste com código de ST vira linha E220 na UF da empresa', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            ajustes: [{ codigo: 'SP120799', descricao: 'Crédito ST', valor: 300 }],
        });
        const e220 = r.linhas.filter((l: string) => l.startsWith('E220'));
        expect(e220).toEqual(['E220|SP120799|Crédito ST|300,00|']);
        // e o crédito abateu o imposto da UF da empresa (1000 − 300)
        expect(r.apuracoes.find((a) => a.uf === 'SP')?.icmsRecolher).toBe(700);
    });

    it('ajuste de ICMS PRÓPRIO não entra no E220 (é do E111) e não vira erro', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            ajustes: [{ codigo: 'SP020799', descricao: 'Crédito outorgado', valor: 300 }],
        });
        expect(r.linhas.filter((l: string) => l.startsWith('E220'))).toEqual([]);
        expect(r.avisos.filter((a: string) => a.includes('IGNORADO'))).toEqual([]);
    });

    it('sem vencimento/código de receita da GNRE, o E250 NÃO é inventado — vira aviso', () => {
        const r = montarLinhasStBlocoE(base);
        expect(r.linhas.filter((l: string) => l.startsWith('E250'))).toEqual([]);
        expect(r.avisos.join(' ')).toContain('E250 não foi gerado');
        expect(r.avisos.join(' ')).toContain('código de receita');
    });

    it('com a obrigação cadastrada, gera o E250 da UF', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            obrigacoesPorUf: { SP: { dtVcto: '10082026', codRec: '046-2' } },
        });
        expect(r.linhas).toContain('E250|000|1000,00|10082026|046-2|||||');
    });

    it('empresa sem ST em saída não recebe bloco nenhum', () => {
        const r = montarLinhasStBlocoE({ ...base, notas: [{ direcao: 'saida', totais: { vST: 0 } }] });
        expect(r.linhas).toEqual([]);
        expect(r.apuracoes).toEqual([]);
    });
});
