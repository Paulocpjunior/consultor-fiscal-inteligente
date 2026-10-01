/**
 * 📗 SPED FISCAL (EFD ICMS/IPI) SÓ PARA QUEM ENTREGA — trava de 01/10.
 *
 * Paulo: *"quando existe a obrigação = LP/LR com I.E para comércio cadastrada
 * em Dados Fiscais (com particularidade as empresas de Brasília, que entregam
 * SPED) · quando não existe = quando não houver I.E cadastrada"* — A CASTELLANO
 * (cód. 25, IE 103.460.625.111) entrega; CLINICA MANTOAN (cód. 40, ISENTO), não.
 */
import { decidirEfdIcmsIpi } from '../sefaz-backend/obrigacao-efd-icms.js';
import { mesDoCliente } from '../sefaz-backend/catalogo-obrigacoes.js';
// @ts-expect-error — módulo .js puro
import { entregaEfdIcms } from '../sefaz-backend/migracao-prontidao.js';
// @ts-expect-error — módulo .js puro
import { empresaDaRotina } from '../sefaz-backend/rotina-empresa-insumo.js';

const lucro = (over: any = {}) => ({ colecao: 'lucro_empresas', regimePadrao: 'presumido', uf: 'SP', codMunIBGE: '3550308', ...over });
const temSped = (mes: any) => mes.obrigacoes.some((o: any) => o.obrigacao === 'SPED');

describe('a régua: IE cadastrada ou DF', () => {
    it('A CASTELLANO (IE com dígitos) entrega; MANTOAN (ISENTO) e sem IE, não — dito', () => {
        expect(decidirEfdIcmsIpi({ dadosFiscais: { uf: 'SP', inscricaoEstadual: '103.460.625.111' } })).toMatchObject({ obrigada: true, via: 'ie' });
        expect(decidirEfdIcmsIpi({ dadosFiscais: { uf: 'SP', inscricaoEstadual: 'ISENTO' } })).toMatchObject({ obrigada: false, via: 'isento' });
        expect(decidirEfdIcmsIpi({ dadosFiscais: { uf: 'SP', inscricaoEstadual: 'isenta' } })).toMatchObject({ obrigada: false, via: 'isento' });
        expect(decidirEfdIcmsIpi({ dadosFiscais: { uf: 'SP', inscricaoEstadual: '' } })).toMatchObject({ obrigada: false, via: 'sem-ie' });
    });

    it('Brasília entrega com ou sem IE de comércio', () => {
        expect(decidirEfdIcmsIpi({ dadosFiscais: { uf: 'DF', inscricaoEstadual: 'ISENTO' } })).toMatchObject({ obrigada: true, via: 'df' });
        expect(decidirEfdIcmsIpi({ uf: 'df', inscricaoEstadual: '' })).toMatchObject({ obrigada: true, via: 'df' });
    });
});

describe('o mês do cliente (tarefa e Rotina) segue a régua', () => {
    it('com IE o SPED está no mês; com ISENTO sai, e o motivo vem junto', () => {
        expect(temSped(mesDoCliente(lucro({ inscricaoEstadual: '103460625111' }), '08/2026'))).toBe(true);
        const mantoan = mesDoCliente(lucro({ inscricaoEstadual: 'ISENTO' }), '08/2026');
        expect(temSped(mantoan)).toBe(false);
        expect(mantoan.efdIcms).toMatchObject({ obrigada: false, via: 'isento' });
        // As demais obrigações do Lucro continuam.
        expect(mantoan.obrigacoes.some((o: any) => o.obrigacao === 'EFD_CONTRIB')).toBe(true);
    });

    it('DF sem IE mantém o SPED', () => {
        expect(temSped(mesDoCliente(lucro({ uf: 'DF', codMunIBGE: '5300108', inscricaoEstadual: '' }), '08/2026'))).toBe(true);
    });

    it('chamador que NÃO informa a IE mantém o comportamento antigo (nada some calado)', () => {
        const mes = mesDoCliente(lucro(), '08/2026');
        expect(temSped(mes)).toBe(true);
        expect(mes.efdIcms).toBeNull();
    });

    it('a Rotina leva a IE do cadastro para o catálogo', () => {
        const e = empresaDaRotina('x', 'lucro_empresas', { cnpj: '11222333000181', dadosFiscais: { uf: 'SP', inscricaoEstadual: 'ISENTO' } });
        expect(e.inscricaoEstadual).toBe('ISENTO');
    });
});

describe('a migração pergunta ao MESMO dono', () => {
    it('clínica do DF marcada "não contribuinte de ICMS" entrega SPED; ISENTO de SP não', () => {
        expect(entregaEfdIcms({ regime: 'lucro', dadosFiscais: { uf: 'DF', contribuinteIcms: 'nao', inscricaoEstadual: '' } })).toBe(true);
        expect(entregaEfdIcms({ regime: 'lucro', dadosFiscais: { uf: 'SP', inscricaoEstadual: 'ISENTO' } })).toBe(false);
        expect(entregaEfdIcms({ regime: 'simples', dadosFiscais: { uf: 'SP', inscricaoEstadual: '123456789' } })).toBe(false);
    });
});
