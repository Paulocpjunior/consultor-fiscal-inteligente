jest.mock('../services/firebaseConfig', () => ({
    db: {},
    auth: { currentUser: { uid: 'admin-uid' } },
    isFirebaseConfigured: true,
    isFirebaseStorageConfigured: false,
}));

jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    doc: jest.fn(),
    getDoc: jest.fn(),
    getDocs: jest.fn(),
    setDoc: jest.fn(),
    addDoc: jest.fn(),
    deleteDoc: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
}));

jest.mock('../services/firestorePaginate', () => ({
    fetchAllDocs: jest.fn(),
}));

jest.mock('../services/empresasPerfilService', () => ({
    listarEmpresasPerfilBackend: jest.fn(),
}));

import { getEmpresasParaPerfilCliente } from '../services/xmlFiscalService';
import { fetchAllDocs } from '../services/firestorePaginate';
import { listarEmpresasPerfilBackend } from '../services/empresasPerfilService';

const mockListarBackend = listarEmpresasPerfilBackend as jest.MockedFunction<typeof listarEmpresasPerfilBackend>;
const mockFetchAllDocs = fetchAllDocs as jest.MockedFunction<typeof fetchAllDocs>;

const adminUser = {
    id: 'admin',
    name: 'Admin',
    email: 'admin@teste.com',
    role: 'admin' as const,
};

const docSnap = (id: string, data: Record<string, unknown>) => ({
    id,
    data: () => data,
});

describe('getEmpresasParaPerfilCliente', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        warn.mockRestore();
    });

    it('usa o backend de perfil antes do fallback Firestore', async () => {
        mockListarBackend.mockResolvedValue([
            {
                id: 's1',
                nome: 'Empresa A3',
                cnpj: '11222333000181',
                fonte: 'simples',
                regimeSugerido: 'SIMPLES',
            },
        ]);

        const result = await getEmpresasParaPerfilCliente(adminUser);

        expect(result).toEqual([
            expect.objectContaining({
                id: 's1',
                nome: 'Empresa A3',
                cnpj: '11222333000181',
                fonte: 'simples',
                regimeSugerido: 'SIMPLES',
            }),
        ]);
        expect(mockFetchAllDocs).not.toHaveBeenCalled();
    });

    it('mantem fallback Firestore quando backend falha', async () => {
        mockListarBackend.mockRejectedValue(new Error('backend fora'));
        mockFetchAllDocs.mockImplementation(async (collectionName: string) => {
            if (collectionName === 'simples_empresas') {
                return [
                    docSnap('s1', {
                        nome: 'Simples Teste',
                        cnpj: '12345678000190',
                        dadosFiscais: { uf: 'SP', inscricaoEstadual: 'ISENTO' },
                    }),
                ] as any;
            }
            if (collectionName === 'lucro_empresas') {
                return [
                    docSnap('l1', {
                        nome: 'Lucro Teste',
                        cnpj: '98765432000110',
                        regimePadrao: 'Presumido',
                        dadosFiscais: { uf: 'RJ' },
                    }),
                ] as any;
            }
            return [] as any;
        });

        const result = await getEmpresasParaPerfilCliente(adminUser);

        expect(result.map((e) => e.nome)).toEqual(['Lucro Teste', 'Simples Teste']);
        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 's1', fonte: 'simples', regimeSugerido: 'SIMPLES' }),
            expect.objectContaining({ id: 'l1', fonte: 'lucro', regimeSugerido: 'LUCRO_PRESUMIDO' }),
        ]));
    });
});
