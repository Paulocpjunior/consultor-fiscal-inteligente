import {
    calcularVencimento,
    obrigacoesDoRegime,
    obrigacoesAplicaveis,
    competenciaFechaTrimestre,
    competenciaFechaAno,
    OBRIGACOES_POR_REGIME,
} from '../services/calendarioFiscal';

describe('calendarioFiscal', () => {
    describe('calcularVencimento — mensais', () => {
        it('DAS competência 04/2026 vence 20/05/2026 (quarta — útil)', () => {
            const regra = OBRIGACOES_POR_REGIME.SIMPLES.find(r => r.obrigacao === 'DAS')!;
            const v = calcularVencimento('04/2026', regra);
            expect(v.getDate()).toBe(20);
            expect(v.getMonth()).toBe(4);  // maio
            expect(v.getFullYear()).toBe(2026);
        });

        it('FGTS competência 05/2026 dia 20/06 (sábado) → prorroga 22/06', () => {
            const regra = OBRIGACOES_POR_REGIME.SIMPLES.find(r => r.obrigacao === 'FGTS')!;
            const v = calcularVencimento('05/2026', regra);
            expect(v.getDate()).toBe(22);
            expect(v.getMonth()).toBe(5);  // junho
        });

        it('PIS/COFINS competência 04/2026 vence 25/05/2026 (segunda)', () => {
            const regra = OBRIGACOES_POR_REGIME.LUCRO_PRESUMIDO.find(r => r.obrigacao === 'PIS_COFINS')!;
            const v = calcularVencimento('04/2026', regra);
            expect(v.getDate()).toBe(25);
            expect(v.getMonth()).toBe(4);
        });

        it('INSS_CPP competência 04/2026 vence 20/05/2026', () => {
            const regra = OBRIGACOES_POR_REGIME.LUCRO_PRESUMIDO.find(r => r.obrigacao === 'INSS_CPP')!;
            const v = calcularVencimento('04/2026', regra);
            expect(v.getDate()).toBe(20);
            expect(v.getMonth()).toBe(4);
        });

        it('EFD-Contribuições competência 04/2026 vence 14/06 (domingo) → prorroga 15/06', () => {
            const regra = OBRIGACOES_POR_REGIME.LUCRO_PRESUMIDO.find(r => r.obrigacao === 'EFD_CONTRIB')!;
            const v = calcularVencimento('04/2026', regra);
            // 14/06/2026 cai em domingo, segunda 15
            expect(v.getDate()).toBe(15);
            expect(v.getMonth()).toBe(5);  // junho
        });

        it('SPED Fiscal competência 04/2026 vence 25/06/2026 (quinta)', () => {
            const regra = OBRIGACOES_POR_REGIME.LUCRO_PRESUMIDO.find(r => r.obrigacao === 'SPED')!;
            const v = calcularVencimento('04/2026', regra);
            expect(v.getDate()).toBe(25);
            expect(v.getMonth()).toBe(5);  // junho (2 meses após)
        });
    });

    describe('calcularVencimento — último dia útil do mês', () => {
        it('IRPJ trim competência 03/2026 → último útil de abril/26 = 30/04 (quinta)', () => {
            const regra = OBRIGACOES_POR_REGIME.LUCRO_PRESUMIDO.find(r => r.obrigacao === 'IRPJ_TRIM')!;
            const v = calcularVencimento('03/2026', regra);
            expect(v.getDate()).toBe(30);
            expect(v.getMonth()).toBe(3);  // abril
        });

        it('CSLL trim competência 06/2026 → último útil de julho/26 = 31/07 (sexta)', () => {
            const regra = OBRIGACOES_POR_REGIME.LUCRO_PRESUMIDO.find(r => r.obrigacao === 'CSLL_TRIM')!;
            const v = calcularVencimento('06/2026', regra);
            expect(v.getDate()).toBe(31);
            expect(v.getMonth()).toBe(6);  // julho
        });

        it('IRPJ trim competência 12/2026 → último útil de janeiro/27', () => {
            const regra = OBRIGACOES_POR_REGIME.LUCRO_PRESUMIDO.find(r => r.obrigacao === 'IRPJ_TRIM')!;
            const v = calcularVencimento('12/2026', regra);
            // 31/01/2027 é domingo, 30/01 é sábado, 29/01 é sexta = último útil
            expect(v.getDate()).toBe(29);
            expect(v.getMonth()).toBe(0);   // janeiro
            expect(v.getFullYear()).toBe(2027);
        });

        it('ECF competência 12/2026 → último útil de julho/27 = 30/07 (sexta)', () => {
            const regra = OBRIGACOES_POR_REGIME.LUCRO_PRESUMIDO.find(r => r.obrigacao === 'ECF')!;
            const v = calcularVencimento('12/2026', regra);
            expect(v.getMonth()).toBe(6);   // julho
            expect(v.getFullYear()).toBe(2027);
            // 31/07/2027 é sábado, 30/07 sexta
            expect(v.getDate()).toBe(30);
        });

        it('DEFIS competência 12/2026 → último útil de março/27', () => {
            const regra = OBRIGACOES_POR_REGIME.SIMPLES.find(r => r.obrigacao === 'DEFIS')!;
            const v = calcularVencimento('12/2026', regra);
            expect(v.getMonth()).toBe(2);   // março
            expect(v.getFullYear()).toBe(2027);
            // 31/03/2027 é quarta — útil
            expect(v.getDate()).toBe(31);
        });
    });

    describe('competenciaFechaTrimestre / competenciaFechaAno', () => {
        it('fecha trimestre em mar/jun/set/dez', () => {
            expect(competenciaFechaTrimestre('03/2026')).toBe(true);
            expect(competenciaFechaTrimestre('06/2026')).toBe(true);
            expect(competenciaFechaTrimestre('09/2026')).toBe(true);
            expect(competenciaFechaTrimestre('12/2026')).toBe(true);
            expect(competenciaFechaTrimestre('01/2026')).toBe(false);
            expect(competenciaFechaTrimestre('05/2026')).toBe(false);
        });
        it('fecha ano em dezembro', () => {
            expect(competenciaFechaAno('12/2026')).toBe(true);
            expect(competenciaFechaAno('11/2026')).toBe(false);
            expect(competenciaFechaAno('03/2026')).toBe(false);
        });
    });

    describe('obrigacoesAplicaveis', () => {
        it('mês qualquer dispara só mensais', () => {
            const ap = obrigacoesAplicaveis('LUCRO_PRESUMIDO', '04/2026');
            const codigos = ap.map(o => o.obrigacao);
            expect(codigos).toContain('DCTFWEB');
            expect(codigos).toContain('PIS_COFINS');
            expect(codigos).not.toContain('IRPJ_TRIM');
            expect(codigos).not.toContain('ECF');
        });
        it('mês de fechamento de trimestre dispara IRPJ/CSLL', () => {
            const ap = obrigacoesAplicaveis('LUCRO_PRESUMIDO', '06/2026');
            const codigos = ap.map(o => o.obrigacao);
            expect(codigos).toContain('IRPJ_TRIM');
            expect(codigos).toContain('CSLL_TRIM');
            expect(codigos).not.toContain('ECF');
        });
        it('dezembro dispara anuais (ECF, ECD)', () => {
            const ap = obrigacoesAplicaveis('LUCRO_PRESUMIDO', '12/2026');
            const codigos = ap.map(o => o.obrigacao);
            expect(codigos).toContain('IRPJ_TRIM');
            expect(codigos).toContain('ECF');
            expect(codigos).toContain('ECD');
        });
        it('Simples dezembro dispara DEFIS', () => {
            const ap = obrigacoesAplicaveis('SIMPLES', '12/2026');
            const codigos = ap.map(o => o.obrigacao);
            expect(codigos).toContain('DEFIS');
        });
        it('regime inválido devolve vazio', () => {
            expect(obrigacoesAplicaveis(null, '04/2026')).toEqual([]);
        });
    });

    describe('obrigacoesDoRegime (compat)', () => {
        it('retorna TODAS sem filtro de competência', () => {
            const todas = obrigacoesDoRegime('LUCRO_PRESUMIDO');
            expect(todas.length).toBe(OBRIGACOES_POR_REGIME.LUCRO_PRESUMIDO.length);
        });
    });
});
