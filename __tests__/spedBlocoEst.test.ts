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

    it('cancelada por EVENTO (status ainda "autorizado") também fica fora — régua docCancelado', () => {
        const r = agruparStPorUf([
            saidaComSt('MG', 100, {
                status: 'autorizado',
                eventos: [{ tpEvento: '110111', cStat: '135' }],
            }),
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
        expect(r.saldoDevedorApurado).toBe(500); // campo 11 do E210: antes das deduções
        expect(r.debitosEspeciais).toBe(90);
    });

    it('dedução que não cabe no devedor NÃO vira crédito — sai nomeada como excedente', () => {
        const r = apurarStDaUf({ uf: 'SP', retencao: 100, saldoCredorAnterior: 400, ajustes: { deducoes: 50 } });
        expect(r.icmsRecolher).toBe(0);
        expect(r.saldoCredorTransportar).toBe(300); // 400 − 100, sem os 50 inflando
        expect(r.deducoes).toBe(0);
        expect(r.deducoesExcedentes).toBe(50);
    });
});

describe('montarLinhasStBlocoE', () => {
    const base = {
        notas: [saidaComSt('SP', 1000), saidaComSt('MG', 500)],
        ufEmpresa: 'SP',
        dtIni: '01072026', dtFin: '31072026',
    };

    // ⚠️ TESTE TROCADO 21/08 (caso REALITY 0899 · 07/2026): a versão anterior
    // travava STRINGS sem o `|` inicial e sem `\r\n` — exatamente o formato
    // quebrado que fez todos os E200/E210 saírem GRUDADOS numa linha só do
    // arquivo real. Agora as linhas são ARRAYS de campos e quem forma a linha
    // é o fmt.buildLine de quem monta o arquivo (padrão do E111).
    it('gera um E200 + E210 por UF, em ordem, como ARRAYS de campos', () => {
        const r = montarLinhasStBlocoE(base);
        const e200 = r.linhas.filter((c: string[]) => c[0] === 'E200');
        expect(e200).toEqual([
            ['E200', 'MG', '01072026', '31072026'],
            ['E200', 'SP', '01072026', '31072026'],
        ]);
        expect(r.linhas.filter((c: string[]) => c[0] === 'E210')).toHaveLength(2);
    });

    it('E210: retenção no campo 8, saldo devedor APURADO no campo 11 (antes das deduções) e recolher no 13', () => {
        const r = montarLinhasStBlocoE(base);
        const e210Sp = r.linhas.find((c: string[]) => c[0] === 'E210' && c.includes('1000,00'));
        // Corroborado pelo E210 aceito do e-Fiscal da REALITY: retenção 380,79 ⇒
        // campo 11 = 380,79 ⇒ recolher 380,79 (a conta 11 − 12 = 13 fecha).
        expect(e210Sp).toEqual([
            'E210', '1', '0,00', '0,00', '0,00', '0,00', '0,00', '1000,00',
            '0,00', '0,00', '1000,00', '0,00', '1000,00', '0,00', '0,00',
        ]);
    });

    it('ajuste com código de ST vira linha E220 na UF da empresa', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            ajustes: [{ codigo: 'SP120799', descricao: 'Crédito ST', valor: 300 }],
        });
        const e220 = r.linhas.filter((c: string[]) => c[0] === 'E220');
        expect(e220).toEqual([['E220', 'SP120799', 'Crédito ST', '300,00']]);
        // e o crédito abateu o imposto da UF da empresa (1000 − 300)
        expect(r.apuracoes.find((a) => a.uf === 'SP')?.icmsRecolher).toBe(700);
    });

    it('ajuste de ICMS PRÓPRIO não entra no E220 (é do E111) e não vira erro', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            ajustes: [{ codigo: 'SP020799', descricao: 'Crédito outorgado', valor: 300 }],
        });
        expect(r.linhas.filter((c: string[]) => c[0] === 'E220')).toEqual([]);
        expect(r.avisos.filter((a: string) => a.includes('IGNORADO'))).toEqual([]);
    });

    it('sem vencimento/código de receita da GNRE, o E250 NÃO é inventado — vira aviso', () => {
        const r = montarLinhasStBlocoE(base);
        expect(r.linhas.filter((c: string[]) => c[0] === 'E250')).toEqual([]);
        expect(r.avisos.join(' ')).toContain('E250 não foi gerado');
        expect(r.avisos.join(' ')).toContain('código de receita');
    });

    it('com a obrigação cadastrada, gera o E250 da UF', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            obrigacoesPorUf: { SP: { dtVcto: '10082026', codRec: '046-2' } },
        });
        expect(r.linhas).toContainEqual(
            ['E250', '000', '1000,00', '10082026', '046-2', '', '', '', '', ''],
        );
    });

    it('empresa sem ST em saída não recebe bloco nenhum', () => {
        const r = montarLinhasStBlocoE({ ...base, notas: [{ direcao: 'saida', totais: { vST: 0 } }] });
        expect(r.linhas).toEqual([]);
        expect(r.apuracoes).toEqual([]);
    });
});

// ═══ A REGRESSÃO DO CASO REAL: o bloco E inteiro sai com TODA linha formada ═══
//
// O arquivo da REALITY 0899 · 07/2026 saiu com 9 registros (E200/E210 de 4 UFs
// + E500) grudados numa ÚNICA linha — sem `|` inicial e sem `\r\n`, invisíveis
// para o PVA, para o 9900 e para a própria prevalidação. Este teste monta o
// bloco E de verdade (buildBlocoE) e exige que cada linha seja BEM FORMADA.
describe('buildBlocoE — formato das linhas com ST no arquivo', () => {
    it('toda linha do bloco começa com | e termina com |\\r\\n — nenhuma grudada', async () => {
        // @ts-expect-error — módulo .js do backend (sem tipos)
        const { buildBlocoE } = await import('../sefaz-backend/sped-fiscal-blocoE.js');
        const nota = (uf: string, vST: number) => ({
            direcao: 'saida', modelo: '55', status: 'autorizado',
            destinatario: { uf }, totais: { vST, vICMS: 10 },
            itens: [{ vICMS: 10, vICMSST: vST }],
        });
        const dados: Record<string, unknown> = {
            empresa: { _regime: 'lucro', dadosFiscais: { uf: 'SP', contribuinteIpi: 'nao' } },
            competenciaInicio: '2026-07', competenciaFim: '2026-07',
            ajustesApuracao: [], notas: [nota('MG', 2.03), nota('PR', 308.14), nota('SP', 380.79)],
            warnings: [],
        };
        const linhas = buildBlocoE(dados);
        for (const l of linhas) {
            expect(l).toMatch(/^\|[A-Z0-9]+\|.*\|\r\n$/s);
        }
        const regs = linhas.map((l: string) => l.split('|')[1]);
        expect(regs.filter((r: string) => r === 'E200')).toHaveLength(3);
        expect(regs.filter((r: string) => r === 'E210')).toHaveLength(3);
    });
});
