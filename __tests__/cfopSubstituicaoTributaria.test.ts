import { correlacionarCfop, resolverNaturezaAtividade } from '../sefaz-backend/cfop-correlacao.js';

/**
 * Caso real (Paulo, 05/08): "correlacionei CFOP, porém o CFOP 1405 não existe,
 * deveria puxar 1403 ST, já verifiquei a nota e está correta com o CFOP 5405".
 *
 * Na ENTRADA a família ST só tem 401 (industrialização), 403 (comercialização),
 * 406 (ativo), 407 (uso/consumo), 408/409 (transferência) e 410/411
 * (devolução). Não existe 402, 404 nem 405: esses sufixos descrevem a POSIÇÃO
 * DO VENDEDOR na substituição — substituto entre substitutos, substituído —,
 * que não tem equivalente do lado de quem compra.
 */
const entrada = (cfop: string, natureza?: string) =>
    correlacionarCfop(cfop, 'entrada', { naturezaAtividade: natureza ?? null });

describe('venda com ST não pode virar CFOP inexistente na entrada', () => {
    it('5405 do comércio vira 1403 (não 1405)', () => {
        expect(entrada('5405', 'comercio')).toBe('1403');
    });

    it('5405 da indústria vira 1401 (compra para industrialização com ST)', () => {
        expect(entrada('5405', 'industria')).toBe('1401');
    });

    it('5405 de prestadora vira 1407 (uso e consumo com ST)', () => {
        expect(entrada('5405', 'servicos')).toBe('1407');
    });

    it('sem natureza declarada usa 403 — NUNCA o 405 mecânico', () => {
        expect(entrada('5405')).toBe('1403');
        expect(entrada('5405', 'misto')).toBe('1403');
    });

    it('vale para toda a família de venda com ST (401/402/403/404/405)', () => {
        for (const c of ['5401', '5402', '5403', '5404', '5405']) {
            expect(entrada(c, 'comercio')).toBe('1403');
        }
    });

    it('interestadual e importação seguem a mesma régua', () => {
        expect(entrada('6405', 'comercio')).toBe('2403');
        expect(entrada('7405', 'comercio')).toBe('3403');
    });
});

describe('o que NÃO mudou (sufixo com par na entrada)', () => {
    it('transferência com ST preserva o sufixo — 1408/1409 existem', () => {
        expect(entrada('5408', 'comercio')).toBe('1408');
        expect(entrada('5409', 'comercio')).toBe('1409');
    });

    it('devolução com ST preserva o sufixo — 1410/1411 existem', () => {
        expect(entrada('5410', 'comercio')).toBe('1410');
        expect(entrada('5411', 'comercio')).toBe('1411');
    });

    it('compra normal continua decidida pela natureza', () => {
        expect(entrada('5102', 'industria')).toBe('1101');
        expect(entrada('5101', 'comercio')).toBe('1102');
    });

    it('override manual vence tudo, inclusive a regra de ST', () => {
        expect(correlacionarCfop('5405', 'entrada', {
            naturezaAtividade: 'comercio',
            cfopOverrides: { '5405': '1556' },
        })).toBe('1556');
    });

    it('saída não se converte — o CFOP é o da própria empresa', () => {
        expect(correlacionarCfop('5405', 'saida', { naturezaAtividade: 'comercio' })).toBe('5405');
    });
});

describe('parametrização pelo CADASTRO da empresa', () => {
    // Paulo, 05/08: "você se parametrizar de acordo com o cadastro da empresa,
    // a empresa em questão é optante do simples nacional". Empresa do Simples
    // costuma ter os campos de SPED em branco — e o Exportar SAGE lia SÓ
    // `naturezaAtividade`, ficando sem parâmetro nenhum.
    it('natureza declarada no cadastro vence e diz que veio de lá', () => {
        expect(resolverNaturezaAtividade({ naturezaAtividade: 'industria' }))
            .toEqual({ natureza: 'industria', origem: 'cadastro' });
    });

    it('sem natureza, deriva do indicador de atividade', () => {
        expect(resolverNaturezaAtividade({ indAtividade: 'industrial' }))
            .toEqual({ natureza: 'industria', origem: 'indicador' });
        expect(resolverNaturezaAtividade({ indAtividade: 'outras' }))
            .toEqual({ natureza: 'comercio', origem: 'indicador' });
    });

    it('cadastro vazio usa o padrão E ADMITE que é padrão', () => {
        // O valor é o mesmo de sempre (revenda); o que muda é não fingir que
        // veio do cadastro — quem confere precisa saber a diferença.
        expect(resolverNaturezaAtividade({})).toEqual({ natureza: 'comercio', origem: 'padrao' });
        expect(resolverNaturezaAtividade(null)).toEqual({ natureza: 'comercio', origem: 'padrao' });
    });

    it('a natureza do cadastro manda no CFOP de ST', () => {
        const df = { naturezaAtividade: 'industria' };
        const { natureza } = resolverNaturezaAtividade(df);
        expect(correlacionarCfop('5405', 'entrada', { naturezaAtividade: natureza })).toBe('1401');
    });
});
