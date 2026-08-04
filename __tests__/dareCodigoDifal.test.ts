/**
 * Código de serviço do DARE-SP para o DIFAL do Simples.
 *
 * Caso 04/08: a apuração mostrava o valor consolidado e a colaboradora
 * perguntou "como gerar? não tem a opção de gerar a guia de ICMS". O código
 * 04602 (DIFAL – Simples Nacional) JÁ existia no backend e era validado —
 * quem não o oferecia era a TELA, que tinha uma lista fixa com 2 opções.
 *
 * Lista duplicada diverge. Estes testes travam o backend como fonte única.
 */
import {
    CODIGOS_DARE_ICMS, derivacoesDisponiveis, montarDare,
} from '../sefaz-backend/dare-sp.js';

describe('catálogo de códigos do DARE-SP', () => {
    it('o DIFAL do Simples existe e está ligado ao regime certo', () => {
        const difal = CODIGOS_DARE_ICMS['04602'];
        expect(difal).toBeDefined();
        expect(difal.derivacao).toBe('difal');
        expect(difal.regimes).toContain('simples');
        expect(difal.descricao).toMatch(/Diferencial de al[ií]quota/i);
    });

    it('derivacoesDisponiveis("simples") devolve o DIFAL — é o que a tela deve listar', () => {
        const codigos = derivacoesDisponiveis('simples').map((c: any) => c.codigoServico);
        expect(codigos).toContain('04602');
    });

    it('o RPA não oferece o código do Simples (e vice-versa)', () => {
        const rpa = derivacoesDisponiveis('rpa').map((c: any) => c.codigoServico);
        expect(rpa).toContain('04601');
        expect(rpa).not.toContain('04602');
    });
});

describe('montarDare com o código do DIFAL', () => {
    const base = {
        cnpj: '65739771000140',
        razaoSocial: 'GS ODONTOLOGIA LTDA',
        referencia: '2026-06',
        valor: 66.03,
        vencimento: '2026-07-31',
    };

    it('monta a guia do DIFAL com a receita correta', () => {
        const p = montarDare({ ...base, codigoServico: '04602' });
        expect(p.codigoServico).toBe('04602');
        expect(p.codigoReceita).toBe('046-2');
        expect(p.derivacao).toBe('difal');
        expect(p.valor).toBe(66.03);
        expect(p.referencia).toBe('06/2026');
    });

    it('código desconhecido é RECUSADO com a lista de válidos — não se inventa', () => {
        expect(() => montarDare({ ...base, codigoServico: '99999' }))
            .toThrow(/desconhecido/i);
    });
});
