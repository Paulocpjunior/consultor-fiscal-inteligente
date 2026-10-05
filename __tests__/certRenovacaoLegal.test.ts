/**
 * Renovação do certificado pelo Departamento Legal, gravando no cofre do CFI
 * (Paulo, 04/10). O que estes testes trancam:
 * 1. Certificado de OUTRO CNPJ não entra (assinaria pelo cliente errado).
 * 2. Vencido não é renovação; o A1 do escritório não passa por aqui.
 * 3. Só a equipe do Legal (departamento 'legalizacao') ou admin sobe.
 * 4. A validade lida do arquivo vai ao Legal em campo próprio, e vale a mais tarde.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { podeRenovarPeloLegal, motivoRecusaRenovacao, registrosDaRenovacao, vencimentoEfetivo } from '../sefaz-backend/cert-renovacao-legal';
// @ts-expect-error — módulo .js puro (sem tipos)
import { acompanhamentoLegalPorCnpj } from '../sefaz-backend/cadastro-central-certificados';

const AGORA = new Date('2026-10-04T12:00:00Z');
const meta = (over: any = {}) => ({ cnpj: '51227692000146', notAfter: '2027-10-01T23:59:59.000Z', ...over });

describe('quem sobe certificado renovado', () => {
    it('admin e equipe do Legal; colaborador de outro departamento não', () => {
        expect(podeRenovarPeloLegal({ role: 'admin', departamentos: [] })).toBe(true);
        expect(podeRenovarPeloLegal({ role: 'colaborador', departamentos: ['legalizacao'] })).toBe(true);
        expect(podeRenovarPeloLegal({ role: 'colaborador', departamentos: ['fiscal', 'dp-folha'] })).toBe(false);
        expect(podeRenovarPeloLegal(null)).toBe(false);
    });
});

describe('o certificado é mesmo a renovação deste CNPJ?', () => {
    it('do CNPJ pedido e válido: entra', () => {
        expect(motivoRecusaRenovacao({ cnpjAlvo: '51.227.692/0001-46', meta: meta(), agora: AGORA })).toBeNull();
    });
    it('de outro CNPJ: recusa e diz de quem é', () => {
        expect(motivoRecusaRenovacao({ cnpjAlvo: '51227692000146', meta: meta({ cnpj: '11222333000181' }), agora: AGORA })).toMatch(/é do CNPJ 11222333000181, não do 51227692000146/);
    });
    it('vencido, sem CNPJ legível, sem validade e o do escritório: recusa', () => {
        expect(motivoRecusaRenovacao({ cnpjAlvo: '51227692000146', meta: meta({ notAfter: '2026-09-30T00:00:00Z' }), agora: AGORA })).toMatch(/já venceu em 2026-09-30/);
        expect(motivoRecusaRenovacao({ cnpjAlvo: '51227692000146', meta: meta({ cnpj: null }), agora: AGORA })).toMatch(/ler o CNPJ/);
        expect(motivoRecusaRenovacao({ cnpjAlvo: '51227692000146', meta: meta({ notAfter: 'x' }), agora: AGORA })).toMatch(/ler a validade/);
        expect(motivoRecusaRenovacao({ cnpjAlvo: '44388152000189', meta: meta({ cnpj: '44388152000189' }), agora: AGORA })).toMatch(/certificado do escritório/);
        expect(motivoRecusaRenovacao({ cnpjAlvo: '123', meta: meta(), agora: AGORA })).toMatch(/14 dígitos/);
    });
});

describe('o que vai ao acompanhamento do Legal', () => {
    const itens = [
        { id: 'jf_1', categoria: 'certificado', cnpj: '51227692000146', dataVencimento: '2026-10-10', empresaNome: 'CLINIPAR', tipoDetalhe: 'E-CNPJ A1' },
        { id: 'jf_2', categoria: 'certidao', cnpj: '51227692000146', dataVencimento: '2026-11-01' },
        { id: 'jf_3', categoria: 'certificado', cnpj: '51227692000146', dataVencimento: '2025-10-10', removidoDoJotform: true },
    ];
    it('marca a validade lida do arquivo nas linhas de certificado e registra a renovação', () => {
        const r = registrosDaRenovacao({ cnpj: '51227692000146', notAfter: '2027-10-01T23:59:59.000Z', anterior: '2026-10-10T23:59:59Z', itens, autor: 'legal@x' });
        expect(r.atualizacoes).toEqual([{ id: 'jf_1', dados: { dataVencimentoCofre: '2027-10-01', cofreAtualizadoPor: 'legal@x' } }]);
        expect(r.renovacao).toEqual({ id: 'jf_1_2027-10-01', dados: expect.objectContaining({ itemId: 'jf_1', cnpj: '51227692000146', dataAntiga: '2026-10-10', dataNova: '2027-10-01', origem: 'upload-cofre', autor: 'legal@x', empresaNome: 'CLINIPAR' }) });
    });
    it('sem linha no Jotform ainda registra a renovação (id pelo CNPJ)', () => {
        const r = registrosDaRenovacao({ cnpj: '51227692000146', notAfter: '2027-10-01T00:00:00Z', itens: [], autor: 'legal@x' });
        expect(r.atualizacoes).toEqual([]);
        expect(r.renovacao.id).toBe('cofre_51227692000146_2027-10-01');
    });
    it('vale a data mais tarde entre a digitada e a do arquivo — também no túnel', () => {
        expect(vencimentoEfetivo({ dataVencimento: '2026-10-10', dataVencimentoCofre: '2027-10-01' })).toBe('2027-10-01');
        expect(vencimentoEfetivo({ dataVencimento: '2028-01-01', dataVencimentoCofre: '2027-10-01' })).toBe('2028-01-01');
        expect(vencimentoEfetivo({ dataVencimento: '2026-10-10' })).toBe('2026-10-10');
        const m = acompanhamentoLegalPorCnpj({ vencimentos: [{ categoria: 'certificado', cnpj: '51227692000146', dataVencimento: '2026-10-10', dataVencimentoCofre: '2027-10-01' }] });
        expect(m.get('51227692000146').vencimentoInformado).toBe('2027-10-01');
    });
});
