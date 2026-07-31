/**
 * Resumo da Carteira (31/07): total por colaborador, com/sem pendências de
 * cadastro, e o balde "sem responsável". Farol honesto: bloqueio nunca some
 * no agregado; empresa compartilhada conta pra cada colaborador.
 */
import { resumirCarteira, resumoCarteiraCsv } from '../services/carteiraResumo';

// Cadastro COMPLETO (fora o responsável, que vem dos vínculos): nenhuma
// pendência de campo → o farol da empresa depende só do resto.
const completa = (id: string, nome: string) => ({
    id, nome,
    cnpj: '11111111000111', regime: 'simples',
    uf: 'SP', codMunIBGE: '3550308', inscricaoEstadual: 'ISENTO', ccmSp: '12345678',
    email: 'x@y.com', cnae: '6201-5/01', anexo: 'III', dataAbertura: '2020-01-01',
});

const vinculo = (empresaId: string, uid: string, nome: string, papel = 'principal') => ({
    empresaId, colaboradorUid: uid, colaboradorNome: nome, papel,
});

describe('resumirCarteira', () => {
    const empresas = [
        completa('e1', 'Alfa'),                                   // Ana (ok)
        { ...completa('e2', 'Beta'), uf: '' },                    // Ana (bloqueio: sem UF)
        { ...completa('e3', 'Gama'), email: '' },                 // Bruno (atenção: sem e-mail)
        completa('e4', 'Delta'),                                  // SEM responsável (ok de campos)
        { ...completa('e5', 'Épsilon'), anexo: '' },              // SEM responsável (bloqueio: sem anexo)
        completa('e6', 'Zeta'),                                   // Ana principal + Bruno backup
    ];
    const vinculos = [
        vinculo('e1', 'ana', 'Ana'),
        vinculo('e2', 'ana', 'Ana'),
        vinculo('e3', 'bruno', 'Bruno'),
        vinculo('e6', 'ana', 'Ana'),
        vinculo('e6', 'bruno', 'Bruno', 'backup'),
    ];
    const r = resumirCarteira(empresas as any, vinculos);

    it('total geral bate com as empresas', () => {
        expect(r.totalEmpresas).toBe(6);
        expect(r.geral.total).toBe(6);
        // e2 (sem UF) e e5 (sem anexo) bloqueiam; e4 tem campos ok mas SEM
        // responsável — que também é pendência que trava (bloqueado).
        expect(r.geral.comBloqueio).toBe(3);
        expect(r.geral.soAtencao).toBe(1);  // e3 sem e-mail
        expect(r.geral.ok).toBe(2);         // e1, e6
    });

    it('sem responsável: total próprio, com o farol de cada uma', () => {
        expect(r.semResponsavel.total).toBe(2);         // e4, e5
        // As DUAS bloqueadas: e5 sem anexo, e ambas sem responsável (trava).
        expect(r.semResponsavel.comBloqueio).toBe(2);
    });

    it('linha por colaborador com quebra de farol', () => {
        const ana = r.porColaborador.find((l) => l.colaboradorUid === 'ana')!;
        expect(ana.total).toBe(3);          // e1, e2, e6
        expect(ana.comBloqueio).toBe(1);    // e2 sem UF
        expect(ana.ok).toBe(2);
        expect(ana.comoPrincipal).toBe(3);

        const bruno = r.porColaborador.find((l) => l.colaboradorUid === 'bruno')!;
        expect(bruno.total).toBe(2);        // e3 + e6 (backup também conta)
        expect(bruno.soAtencao).toBe(1);
        expect(bruno.comoPrincipal).toBe(1); // só e3
    });

    it('ordena por carga (mais empresas primeiro)', () => {
        expect(r.porColaborador[0].colaboradorUid).toBe('ana');
    });

    it('farol por empresa fica disponível pra tela', () => {
        expect(r.farolPorEmpresa.get('e2')?.farol).toBe('bloqueado');
        expect(r.farolPorEmpresa.get('e3')?.farol).toBe('atencao');
        expect(r.farolPorEmpresa.get('e1')?.farol).toBe('ok');
    });

    it('CSV traz colaboradores + SEM RESPONSÁVEL + TOTAL GERAL', () => {
        const csv = resumoCarteiraCsv(r);
        expect(csv).toContain('Ana;3;3;1;0;2');
        expect(csv).toContain('SEM RESPONSÁVEL;2;0;2;0;0');
        expect(csv).toContain('TOTAL GERAL;6;;3;1;2');
    });

    it('sem vínculo nenhum: tudo cai em sem responsável', () => {
        const r2 = resumirCarteira([completa('x', 'X')] as any, []);
        expect(r2.semResponsavel.total).toBe(1);
        expect(r2.porColaborador).toHaveLength(0);
    });
});
