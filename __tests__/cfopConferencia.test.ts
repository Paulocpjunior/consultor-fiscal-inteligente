/**
 * Correlação de CFOP na compra — evidência para o contador decidir.
 *
 * Paulo, 29/07: cliente que é indústria E comércio compra tanto com final 101
 * (industrialização) quanto 102 (revenda); prestadora de serviços compra para
 * uso/consumo e ativo. O app não pode "chutar" qual é — precisa mostrar o que
 * decidiu, por quê, e marcar o que depende de gente.
 */
import { conferirCorrelacaoCfop } from '../services/cfopConferencia';
import type { DocumentoFiscal } from '../types';

const doc = (cfops: string[], direcao: 'entrada' | 'saida' = 'entrada') => ({
    id: 'd', direcao, chave: '3'.repeat(44), numero: '1', serie: '1',
    itens: cfops.map((cfop, i) => ({ cProd: `P${i}`, cfop, vProd: 100 })),
}) as unknown as DocumentoFiscal;

const linha = (r: ReturnType<typeof conferirCorrelacaoCfop>, origem: string) =>
    r.linhas.find((l) => l.origem === origem)!;

describe('empresa MISTA — o app não escolhe entre industrialização e revenda', () => {
    const ctx = { naturezaAtividade: 'misto' };

    it('preserva o sufixo do emitente nos dois casos (101 e 102)', () => {
        const r = conferirCorrelacaoCfop([doc(['5101', '5102'])], ctx);
        expect(linha(r, '5101').destino).toBe('1101');
        expect(linha(r, '5102').destino).toBe('1102');
    });

    it('marca para CONFERIR, explicando que os dois são possíveis', () => {
        const l = linha(conferirCorrelacaoCfop([doc(['6102'])], ctx), '6102');
        expect(l.conferir).toBe(true);
        expect(l.explicacao).toMatch(/indústria E comércio/i);
        expect(l.explicacao).toMatch(/101.*industrialização|revenda/i);
    });
});

describe('natureza declarada — aí o app decide sozinho', () => {
    it('comércio: compra vira revenda (102)', () => {
        const l = linha(conferirCorrelacaoCfop([doc(['5101'])], { naturezaAtividade: 'comercio' }), '5101');
        expect(l.destino).toBe('1102');
        expect(l.motivo).toBe('natureza');
        expect(l.conferir).toBe(false);
    });

    it('indústria: compra vira industrialização (101)', () => {
        expect(linha(conferirCorrelacaoCfop([doc(['5102'])], { naturezaAtividade: 'industria' }), '5102').destino)
            .toBe('1101');
    });

    it('serviços: compra de produto vira uso/consumo (556)', () => {
        const l = linha(conferirCorrelacaoCfop([doc(['5102'])], { naturezaAtividade: 'servicos' }), '5102');
        expect(l.destino).toBe('1556');
        expect(l.explicacao).toMatch(/uso\/consumo/i);
    });
});

describe('compras que não dependem da natureza', () => {
    it('ativo e uso/consumo preservam o sufixo — sem pedir conferência', () => {
        const r = conferirCorrelacaoCfop([doc(['5551', '5556'])], { naturezaAtividade: 'servicos' });
        expect(linha(r, '5551').destino).toBe('1551');
        expect(linha(r, '5556').destino).toBe('1556');
        expect(linha(r, '5551').conferir).toBe(false);
        expect(linha(r, '5551').explicacao).toMatch(/Ativo, uso\/consumo/);
    });

    it('devolução espelha; VENDA COM ST não (o sufixo não tem par na entrada)', () => {
        // Corrigido em 05/08 (caso 5405 → 1405, CFOP inexistente): os sufixos
        // 401/402/403/404/405 descrevem a posição do VENDEDOR na substituição.
        // Para quem compra vale o destino da mercadoria — comércio → 403.
        const r = conferirCorrelacaoCfop([doc(['5910', '6401'])], { naturezaAtividade: 'comercio' });
        expect(linha(r, '5910').destino).toBe('1910');
        expect(linha(r, '6401').destino).toBe('2403');
        expect(linha(r, '6401').motivo).toBe('natureza-st');
        expect(linha(r, '6401').explicacao).toMatch(/não existe o sufixo 401/);
    });

    it('venda com ST sem natureza declarada pede conferência humana', () => {
        const r = conferirCorrelacaoCfop([doc(['5405'])]);
        expect(linha(r, '5405').destino).toBe('1403');
        expect(linha(r, '5405').conferir).toBe(true);
        expect(linha(r, '5405').explicacao).toMatch(/confirme se a mercadoria é para revenda/);
    });
});

describe('override manual vence tudo', () => {
    it('usa o CFOP gravado na tela Correlação CFOP', () => {
        const l = linha(conferirCorrelacaoCfop([doc(['5102'])], {
            naturezaAtividade: 'comercio', cfopOverrides: { '5102': '1556' },
        }), '5102');
        expect(l.destino).toBe('1556');
        expect(l.motivo).toBe('override');
        expect(l.conferir).toBe(false);
    });
});

describe('cadastro sem natureza — decisão por omissão, e isso aparece', () => {
    it('marca para conferir e manda preencher a natureza', () => {
        const l = linha(conferirCorrelacaoCfop([doc(['5102'])], {}), '5102');
        expect(l.conferir).toBe(true);
        expect(l.explicacao).toMatch(/não declarada/i);
        expect(l.destino).toBe('1102');
    });
});

describe('agregação e resumo', () => {
    it('agrupa por origem→destino somando quantidade e valor', () => {
        const r = conferirCorrelacaoCfop([doc(['5102', '5102', '5551'])], { naturezaAtividade: 'comercio' });
        expect(linha(r, '5102').qtd).toBe(2);
        expect(linha(r, '5102').valor).toBe(200);
        expect(r.linhas).toHaveLength(2);
    });

    it('os que pedem conferência vêm primeiro', () => {
        const r = conferirCorrelacaoCfop([doc(['5551', '5102'])], { naturezaAtividade: 'misto' });
        expect(r.linhas[0]!.conferir).toBe(true);
        expect(r.aConferir).toBe(1);
        expect(r.resumo).toMatch(/1 pedem conferência|1 pede/);
    });

    it('saída não entra (o CFOP é da própria empresa)', () => {
        const r = conferirCorrelacaoCfop([doc(['5102'], 'saida')], { naturezaAtividade: 'comercio' });
        expect(r.linhas).toHaveLength(0);
        expect(r.resumo).toMatch(/Nenhum CFOP de entrada/);
    });
});
