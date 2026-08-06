// @ts-expect-error — módulo .js puro (sem tipos)
import { planejarBlocoH, inventarioInformado, inventarioExigido, dataInventario } from '../sefaz-backend/sped-bloco-h';

/**
 * Achado de 06/08: o gerador montava H010 pra TODOS os itens do 0200 com
 * quantidade e valor unitário default ZERO — e não existe UM lugar no app que
 * grave esses campos. Em dezembro, o CFI produziria um inventário inteiro
 * zerado, estruturalmente válido, que o PVA aceita e a fiscalização lê como
 * "a empresa declarou que não tinha estoque em 31/12".
 *
 * Regra do Paulo (06/08): falta de informação ACENDE ALERTA, nunca vira zero.
 * Bloco VAZIO diz "não declarei"; bloco ZERADO diz "declarei que não tenho".
 */
const item = (over: any = {}) => ({ codItem: over.codItem || 'P1', unidade: 'UN', ...over });
const contado = (over: any = {}) => item({ qtdInventario: 10, vlUnitInventario: 2.5, ...over });

describe('contagem informada ≠ contagem zero', () => {
    it('item sem os campos NÃO conta como informado', () => {
        expect(inventarioInformado(item())).toBe(false);
    });

    it('quantidade ZERO informada É informação legítima (produto que zerou)', () => {
        expect(inventarioInformado(item({ qtdInventario: 0, vlUnitInventario: 3 }))).toBe(true);
    });

    it('só quantidade, sem valor unitário, não basta', () => {
        expect(inventarioInformado(item({ qtdInventario: 5 }))).toBe(false);
    });
});

describe('quando o inventário é exigido', () => {
    it('dezembro exige', () => {
        expect(inventarioExigido({ competenciaFim: '2026-12' })).toBe(true);
    });
    it('flag da empresa exige em qualquer mês', () => {
        expect(inventarioExigido({ competenciaFim: '2026-07', gerarInventario: true })).toBe(true);
    });
    it('mês comum não exige', () => {
        expect(inventarioExigido({ competenciaFim: '2026-07' })).toBe(false);
    });
    it('data do inventário é o último dia da competência', () => {
        expect(dataInventario('2026-12')).toBe('2026-12-31');
        expect(dataInventario('2026-02')).toBe('2026-02-28');
        expect(dataInventario('lixo')).toBe('');
    });
});

describe('inventário NÃO informado sai VAZIO, nunca zerado', () => {
    it('nenhum item contado: o bloco não sai e o aviso é explícito', () => {
        const p = planejarBlocoH({ itens: [item(), item({ codItem: 'P2' })], exigido: true });
        expect(p.gerar).toBe(false);
        expect(p.itens).toHaveLength(0);
        expect(p.avisos.join(' ')).toMatch(/INVENTÁRIO NÃO INFORMADO/);
        expect(p.avisos.join(' ')).toMatch(/declararia ao Fisco que a empresa não tinha estoque/);
    });

    it('contagem PARCIAL: sai só o contado e diz quantos ficaram de fora', () => {
        const p = planejarBlocoH({ itens: [contado(), item({ codItem: 'P2' }), item({ codItem: 'P3' })], exigido: true });
        expect(p.gerar).toBe(true);
        expect(p.itens).toHaveLength(1);
        expect(p.avisos.join(' ')).toMatch(/2 de 3 item\(ns\) sem contagem informada ficaram FORA/);
        expect(p.avisos.join(' ')).toMatch(/não foram zerados/);
    });

    it('competência que não exige não gera nem avisa', () => {
        const p = planejarBlocoH({ itens: [item()], exigido: false });
        expect(p.gerar).toBe(false);
        expect(p.avisos).toEqual([]);
    });

    it('empresa sem item cadastrado avisa em vez de sair calada', () => {
        const p = planejarBlocoH({ itens: [], exigido: true });
        expect(p.gerar).toBe(false);
        expect(p.avisos.join(' ')).toMatch(/não tem itens cadastrados \(0200\)/);
    });
});

describe('valor total e leiaute', () => {
    it('VL_INV é a soma dos VL_ITEM — o total que o gerador antigo descartava', () => {
        const p = planejarBlocoH({
            itens: [contado({ qtdInventario: 10, vlUnitInventario: 2.5 }), contado({ codItem: 'P2', qtdInventario: 3, vlUnitInventario: 1.1 })],
            exigido: true,
        });
        expect(p.itens[0].vlItem).toBe(25);
        expect(p.itens[1].vlItem).toBe(3.3);
        expect(p.valorTotal).toBe(28.3);
    });

    it('MOT_INV inválido derruba o bloco — código de leiaute não se inventa', () => {
        const p = planejarBlocoH({ itens: [contado()], exigido: true, motInv: '99' });
        expect(p.gerar).toBe(false);
        expect(p.avisos.join(' ')).toMatch(/não é um MOT_INV válido/);
    });

    it('MOT_INV padrão é 01 (final do período)', () => {
        expect(planejarBlocoH({ itens: [contado()], exigido: true }).motInv).toBe('01');
    });

    it('estoque de terceiro sem participante vira aviso', () => {
        const p = planejarBlocoH({ itens: [contado({ indPropInventario: '2' })], exigido: true });
        expect(p.avisos.join(' ')).toMatch(/exige o participante \(COD_PART\)/);
    });

    it('estoque próprio não carrega participante', () => {
        const p = planejarBlocoH({ itens: [contado({ indPropInventario: '0', codPartInventario: 'X' })], exigido: true });
        expect(p.itens[0].codPart).toBe('');
    });
});
