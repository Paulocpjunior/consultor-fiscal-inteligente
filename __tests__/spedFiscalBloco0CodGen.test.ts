/**
 * 0200 · COD_GEN — o gênero do item NÃO nasce '00' cravado.
 *
 * Caso REALITY 0899 · 07/2026 (21/08): os 309 itens do arquivo saíam com
 * COD_GEN '00' — que na tabela 4.2.1 significa SERVIÇO — todos com NCM de
 * mercadoria. O e-Fiscal ACEITO da mesma empresa deriva o gênero do capítulo
 * da NCM (48131000 → 48). Regra: com NCM, gênero = 2 primeiros dígitos; sem
 * NCM não se afirma gênero (campo VAZIO, nunca '00').
 */
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBloco0 } from '../sefaz-backend/sped-fiscal-bloco0.js';

const dadosBase = (itens: any[]) => ({
    empresa: {
        _regime: 'lucro', cnpj: '00935141000104', nome: 'REALITY',
        dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' },
    },
    contador: { nome: 'C', cpf: '11111111111', crc: '1SP000000' },
    competenciaInicio: '2026-07', competenciaFim: '2026-07',
    notas: [], participantes: [], unidades: [], itens,
    warnings: [] as string[],
});

const linha0200 = (linhas: string[], codItem: string) =>
    linhas.find((l) => l.startsWith(`|0200|${codItem}|`))!.split('|');

describe('0200 — COD_GEN sai do capítulo da NCM, nunca "00" cravado', () => {
    it('item com NCM ganha o gênero do capítulo (48131000 → 48)', () => {
        const linhas = buildBloco0(dadosBase([
            { codItem: 'CI-SMK-001', descricao: 'PAPEL', unidade: 'DP', ncm: '48131000' },
        ]) as never);
        expect(linha0200(linhas, 'CI-SMK-001')[10]).toBe('48');
    });

    it('item SEM NCM não afirma gênero — campo vazio, nunca "00" (= serviço)', () => {
        const linhas = buildBloco0(dadosBase([
            { codItem: 'X-1', descricao: 'ITEM SEM NCM', unidade: 'UN' },
        ]) as never);
        expect(linha0200(linhas, 'X-1')[10]).toBe('');
    });

    it('codGen já informado no item VENCE a derivação', () => {
        const linhas = buildBloco0(dadosBase([
            { codItem: 'S-1', descricao: 'SERVICO', unidade: 'UN', codGen: '00' },
        ]) as never);
        expect(linha0200(linhas, 'S-1')[10]).toBe('00');
    });
});
