/**
 * Códigos de serviço NFTS recusados pela PMSP (erro 310).
 *
 * Caso real 05/08/2026 (WALDESA, importação do Paulo): o 02658 — item 1.01,
 * "Análise e desenvolvimento de sistemas" — voltou com erro 310 "inválido ou
 * não permitido", exatamente como 02682/02798/02917 em 07/2026. Todos são
 * códigos de informática do grupo 1.x: é o rastro da reformulação de
 * 01/01/2026.
 *
 * O que estes testes protegem: o app SUGERE o irmão do mesmo item, mas NUNCA
 * troca sozinho — os irmãos nem sempre têm a mesma alíquota (02917 é 3%,
 * 02919 é 2,90%), e trocar em silêncio mudaria o imposto do cliente.
 */
import {
    validarNotaNfts, substitutosDoItem, descreverSubstitutos, selecionarCodigoSp,
} from '../services/nftsSpService';
import { CODIGOS_REJEITADOS_PMSP } from '../services/nftsCatalogoSp';
import type { NftsNota } from '../services/nftsSpService';

const nota = (over: Partial<NftsNota> = {}): NftsNota => ({
    arquivo: 'x.pdf', pagina: 1, numero: '72899', serie: '1', data: '25072026',
    cnpj: '62173620009306', nome: 'SERASA S.A.', valorCentavos: 1022397,
    codigo: '02658', subitem: '0101', aliquota: '0500', retido: '2',
    regime: '0', cidade: 'SAO CARLOS', uf: 'SP', cep: '13571385',
    origemExtracao: 'pdf',
    ...over,
} as NftsNota);

describe('02658 — a recusa de 05/08 entra na lista', () => {
    it('está bloqueado como os três de julho', () => {
        expect(CODIGOS_REJEITADOS_PMSP.has('02658')).toBe(true);
        for (const c of ['02682', '02798', '02917']) {
            expect(CODIGOS_REJEITADOS_PMSP.has(c)).toBe(true);
        }
    });

    it('a nota com 02658 vira ERRO (não passa batido no arquivo)', () => {
        const { erros } = validarNotaNfts(nota());
        expect(erros.join(' ')).toMatch(/02658 REJEITADO/);
    });

    it('o erro TRAZ o substituto do mesmo item e manda conferir a alíquota', () => {
        const { erros } = validarNotaNfts(nota());
        const msg = erros.join(' ');
        expect(msg).toMatch(/02660/);                       // o irmão do item 1.01
        expect(msg).toMatch(/CONFIRA a aliquota/);
    });

    it('nunca é escolhido automaticamente na seleção', () => {
        const r = selecionarCodigoSp('analise e desenvolvimento de sistemas', '1.01', '', 'PJ');
        expect(r?.codigo).not.toBe('02658');
    });
});

describe('substitutosDoItem — sugestão, nunca troca', () => {
    it('devolve os irmãos vigentes do mesmo item e natureza', () => {
        const subs = substitutosDoItem('02658');
        expect(subs.map(s => s.codigo)).toContain('02660');
        expect(subs.map(s => s.codigo)).not.toContain('02658');   // ele mesmo fora
    });

    it('mostra a ALÍQUOTA de cada um — é o risco de trocar às cegas', () => {
        expect(descreverSubstitutos([{ codigo: '02660', aliquota: '0500' }])).toBe('02660 (5,00%)');
        expect(descreverSubstitutos([{ codigo: '02919', aliquota: '0290' }])).toBe('02919 (2,90%)');
    });

    it('código desconhecido não inventa substituto', () => {
        expect(substitutosDoItem('99999')).toEqual([]);
    });
});

describe('recusa aprendida DEPOIS do deploy (lista do banco)', () => {
    it('bloqueia um código que a lista fixa ainda não conhece', () => {
        const { erros } = validarNotaNfts(nota({ codigo: '02660' }), new Set(['02660']));
        expect(erros.join(' ')).toMatch(/02660 REJEITADO/);
    });

    it('sem a lista extra, o mesmo código passa — não bloqueia por engano', () => {
        const { erros } = validarNotaNfts(nota({ codigo: '02660' }));
        expect(erros.join(' ')).not.toMatch(/REJEITADO/);
    });

    it('o código recusado no banco também sai da lista de substitutos', () => {
        expect(substitutosDoItem('02658', ['02660']).map(s => s.codigo)).not.toContain('02660');
    });
});
