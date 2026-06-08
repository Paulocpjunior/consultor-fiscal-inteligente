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

type Empresa = { id: string; createdBy?: string | null };

/** Reproduz fielmente o filtro aplicado no Simples/Lucro/Xml services. */
function filtrarParaColaborador(empresas: Empresa[], uid: string, carteiraIds: Set<string>): Empresa[] {
    return empresas.filter(e => e.createdBy === uid || carteiraIds.has(e.id));
}

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

    it('ve empresa que ele mesmo criou', () => {
        const r = filtrarParaColaborador(empresas, UID_COLAB, new Set());
        expect(r.map(e => e.id)).toContain('e1');
    });

    it('ve empresa atribuida via carteira (mesmo que outro tenha criado)', () => {
        const r = filtrarParaColaborador(empresas, UID_COLAB, new Set(['e2']));
        expect(r.map(e => e.id)).toContain('e2');
    });

    it('NAO ve empresa que outro criou e NAO esta na sua carteira', () => {
        const r = filtrarParaColaborador(empresas, UID_COLAB, new Set(['e2']));
        expect(r.map(e => e.id)).not.toContain('e3');
        expect(r.map(e => e.id)).not.toContain('e5');
    });

    it('ve empresa orfa (sem createdBy) se estiver na carteira', () => {
        const r = filtrarParaColaborador(empresas, UID_COLAB, new Set(['e4']));
        expect(r.map(e => e.id)).toContain('e4');
    });

    it('combina ambos: criou + carteira -> sem duplicar', () => {
        const r = filtrarParaColaborador(empresas, UID_COLAB, new Set(['e1', 'e2', 'e4']));
        expect(r.map(e => e.id).sort()).toEqual(['e1', 'e2', 'e4']);
    });

    it('carteira vazia -> so ve as proprias', () => {
        const r = filtrarParaColaborador(empresas, UID_COLAB, new Set());
        expect(r.map(e => e.id)).toEqual(['e1']);
    });

    it('colaborador sem nada criado e sem carteira nao ve nada', () => {
        const r = filtrarParaColaborador(empresas, 'uid-fantasma', new Set());
        expect(r).toEqual([]);
    });

    it('NAO acha empresa pelo id quando sua carteira aponta pra id inexistente', () => {
        // Vinculo de carteira referenciando uma empresa que foi apagada/movida
        // nao deve quebrar -- apenas nao retorna nada extra.
        const r = filtrarParaColaborador(empresas, 'uid-fantasma', new Set(['inexistente']));
        expect(r).toEqual([]);
    });
});
