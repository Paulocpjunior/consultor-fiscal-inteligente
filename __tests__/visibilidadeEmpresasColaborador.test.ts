/**
 * Testes da regra "colaborador ve empresas da sua carteira".
 *
 * Bug reportado 06/2026: colaboradores se queixaram que nao viam as
 * empresas do Simples no consultor. Causa: `getEmpresas` filtrava no
 * Firestore por `createdBy == uid`, ignorando os vinculos de `carteiras`
 * -- entao se OUTRO colega criava a empresa e ela era atribuida ao
 * colaborador via carteira, ele nunca via.
 *
 * Estes testes documentam o filtro client-side esperado: o colaborador
 * ve empresa quando (a) ele mesmo criou (createdBy === uid) OU
 * (b) o id da empresa esta no Set de carteiraIds dele.
 *
 * Como `getEmpresas` real depende de Firestore, esses testes validam
 * apenas a logica do filtro (extraida pra forma isolada).
 */

import {
    montaCarteiraScope,
    podeVerDocumentoPorCarteira,
    podeVerEmpresaPorCarteira,
    vinculoPertenceAoUsuario,
    type CarteiraScope,
} from '../services/visibilidadeCarteira';

type Empresa = { id: string; cnpj?: string | null; createdBy?: string | null };

const UID_COLAB = 'colab-uid-123';
const UID_OUTRO = 'colega-uid-999';

describe('Visibilidade de empresas pra colaborador', () => {
    const empresas: Empresa[] = [
        { id: 'e1', createdBy: UID_COLAB },                // criou
        { id: 'e2', createdBy: UID_OUTRO },                // colega criou (so via carteira)
        { id: 'e3', createdBy: UID_OUTRO },                // colega criou e NAO esta na carteira
        { id: 'e4', createdBy: null },                     // sem dono (cadastro antigo, so via carteira)
        { id: 'e5', createdBy: 'orfa' },                   // criada por uid que nao eh nem o colab nem colega
    ];

    const filtrarParaColaborador = (carteiraIds: string[], cnpjs: string[] = [], uid = UID_COLAB) => {
        const scope: CarteiraScope = {
            uid,
            empresaIds: new Set(carteiraIds),
            empresaCnpjs: new Set(cnpjs),
        };
        return empresas.filter(e => podeVerEmpresaPorCarteira(e, scope));
    };

    it('ve empresa que ele mesmo criou', () => {
        const r = filtrarParaColaborador([]);
        expect(r.map(e => e.id)).toContain('e1');
    });

    it('ve empresa atribuida via carteira (mesmo que outro tenha criado)', () => {
        const r = filtrarParaColaborador(['e2']);
        expect(r.map(e => e.id)).toContain('e2');
    });

    it('NAO ve empresa que outro criou e NAO esta na sua carteira', () => {
        const r = filtrarParaColaborador(['e2']);
        expect(r.map(e => e.id)).not.toContain('e3');
        expect(r.map(e => e.id)).not.toContain('e5');
    });

    it('ve empresa orfa (sem createdBy) se estiver na carteira', () => {
        const r = filtrarParaColaborador(['e4']);
        expect(r.map(e => e.id)).toContain('e4');
    });

    it('combina ambos: criou + carteira -> sem duplicar', () => {
        const r = filtrarParaColaborador(['e1', 'e2', 'e4']);
        expect(r.map(e => e.id).sort()).toEqual(['e1', 'e2', 'e4']);
    });

    it('carteira vazia -> so ve as proprias', () => {
        const r = filtrarParaColaborador([]);
        expect(r.map(e => e.id)).toEqual(['e1']);
    });

    it('colaborador sem nada criado e sem carteira nao ve nada', () => {
        const r = filtrarParaColaborador([], [], 'uid-fantasma');
        expect(r).toEqual([]);
    });

    it('NAO acha empresa pelo id quando sua carteira aponta pra id inexistente', () => {
        // Vinculo de carteira referenciando uma empresa que foi apagada/movida
        // nao deve quebrar -- apenas nao retorna nada extra.
        const r = filtrarParaColaborador(['inexistente'], [], 'uid-fantasma');
        expect(r).toEqual([]);
    });

    it('aceita vinculo por CNPJ quando o empresaId mudou em merge/migração', () => {
        const scope: CarteiraScope = { uid: UID_COLAB, empresaIds: new Set(), empresaCnpjs: new Set(['02986671000107']) };
        expect(podeVerEmpresaPorCarteira({ id: 'novo-id', cnpj: '02.986.671/0001-07', createdBy: UID_OUTRO }, scope)).toBe(true);
    });

    it('documento fiscal segue carteira por empresaId, CNPJ ou importador', () => {
        const scope: CarteiraScope = { uid: UID_COLAB, empresaIds: new Set(['e2']), empresaCnpjs: new Set(['02986671000107']) };
        expect(podeVerDocumentoPorCarteira({ empresaId: 'e2', createdBy: UID_OUTRO }, scope)).toBe(true);
        expect(podeVerDocumentoPorCarteira({ empresaCnpj: '02.986.671/0001-07', createdBy: UID_OUTRO }, scope)).toBe(true);
        expect(podeVerDocumentoPorCarteira({ empresaId: 'e9', importadoPor: UID_COLAB }, scope)).toBe(true);
        expect(podeVerDocumentoPorCarteira({ empresaId: 'e9', createdBy: UID_OUTRO }, scope)).toBe(false);
    });

    it('carteira global vazia mantém visibilidade aberta legada', () => {
        expect(montaCarteiraScope(UID_COLAB, [], false)).toBeNull();
    });

    it('colaborador sem vinculo de carteira nao fica bloqueado com zero empresas', () => {
        expect(montaCarteiraScope(UID_COLAB, [], true)).toBeNull();
    });

    it('carteira configurada passa a restringir pelo vinculo do usuário', () => {
        const scope = montaCarteiraScope(UID_COLAB, [{ empresaId: 'e2', empresaCnpj: '02.986.671/0001-07' }], true);
        expect(scope).not.toBeNull();
        expect(scope?.empresaIds.has('e2')).toBe(true);
        expect(scope?.empresaCnpjs.has('02986671000107')).toBe(true);
    });

    it('aceita vinculo legado por nome ou email quando UID mudou', () => {
        const user = { id: 'uid-novo', name: 'Valéria Alves', email: 'valeria@spassessoriacontabil.com.br' };
        expect(vinculoPertenceAoUsuario({ colaboradorUid: 'uid-antigo', colaboradorNome: 'valeria alves' }, user)).toBe(true);
        expect(vinculoPertenceAoUsuario({ colaboradorUid: 'uid-antigo', colaboradorEmail: 'VALERIA@SPASSESSORIACONTABIL.COM.BR' }, user)).toBe(true);
        expect(vinculoPertenceAoUsuario({ colaboradorUid: 'uid-antigo', colaboradorNome: 'outro usuario' }, user)).toBe(false);
    });
});
