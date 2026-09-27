jest.mock('../services/firebaseConfig', () => ({ auth: { currentUser: { uid: 'u1' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
    doc: (_db: unknown, col: string, id: string) => ({ col, id }),
    collection: (_db: unknown, col: string) => ({ col }),
    where: (field: string, op: string, value: string) => ({ field, op, value }),
    limit: (value: number) => ({ limit: value }), documentId: () => '__name__',
    query: (col: unknown, ...filters: unknown[]) => ({ col, filters }),
    getDoc: jest.fn(), getDocs: jest.fn(),
}));
import { getDoc, getDocs } from 'firebase/firestore';
import { restricoesDeCarteira } from '../services/carteiraAcessos';

beforeEach(() => {
    jest.clearAllMocks();
    (getDoc as jest.Mock).mockImplementation(async ref => ({ data: () => ref.col === 'users' ? { role: 'colaborador' } : { empresaIds: ['a', 'b'] } }));
    (getDocs as jest.Mock).mockResolvedValue({ docs: [{ id: 'propria' }], size: 1 });
});
test('empresa filtra por ID autorizado ou criador antes de ler', async () => {
    expect(await restricoesDeCarteira('simples_empresas')).toEqual([
        [{ field: '__name__', op: '==', value: 'a' }],
        [{ field: '__name__', op: '==', value: 'b' }],
        [{ field: 'createdBy', op: '==', value: 'u1' }],
    ]);
});
test('documentos usam as empresas da carteira e as de autoria do usuario', async () => {
    expect(await restricoesDeCarteira('documentos_fiscais')).toEqual(['a', 'b', 'propria'].map(value => [{ field: 'empresaId', op: '==', value }]));
});
test('administrador mantem consulta global', async () => {
    (getDoc as jest.Mock).mockResolvedValue({ data: () => ({ role: 'admin' }) });
    expect(await restricoesDeCarteira('lucro_empresas')).toEqual([[]]);
});
test('sem vinculo e sem autoria nao consulta documentos de outras empresas', async () => {
    (getDoc as jest.Mock).mockResolvedValue({ data: () => ({}) });
    (getDocs as jest.Mock).mockResolvedValue({ docs: [], size: 0 });
    expect(await restricoesDeCarteira('documentos_fiscais')).toEqual([]);
});
test('falha de leitura nao vira permissao irrestrita', async () => {
    (getDoc as jest.Mock).mockRejectedValue(new Error('indisponivel'));
    await expect(restricoesDeCarteira('documentos_fiscais')).rejects.toThrow('indisponivel');
});
