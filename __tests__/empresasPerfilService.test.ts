let mockCurrentUser: any;

jest.mock('firebase/auth', () => ({
    getAuth: () => ({ currentUser: mockCurrentUser }),
}));

import {
    listarEmpresasPerfilBackend,
    normalizarEmpresasPerfilResponse,
} from '../services/empresasPerfilService';

const fetchMock = jest.fn();
global.fetch = fetchMock as any;

const okJson = (body: any) => Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
});

beforeEach(() => {
    fetchMock.mockReset();
    mockCurrentUser = {
        getIdToken: jest.fn(async () => 'TOK'),
        uid: 'u1',
        email: 'admin@teste.com',
    };
});

describe('empresasPerfilService', () => {
    it('lista empresas pelo backend com Bearer token', async () => {
        fetchMock.mockReturnValue(okJson([
            {
                id: 's1',
                nome: 'Casa das Luminarias',
                cnpj: '60.218.146/0001-30',
                fonte: 'simples',
                regimeSugerido: 'SIMPLES',
            },
        ]));

        const result = await listarEmpresasPerfilBackend({ id: 'u1', name: 'Admin', email: 'admin@teste.com', role: 'admin' });

        expect(result).toEqual([
            expect.objectContaining({
                id: 's1',
                nome: 'Casa das Luminarias',
                cnpj: '60218146000130',
                fonte: 'simples',
                regimeSugerido: 'SIMPLES',
            }),
        ]);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/admin/empresas-perfil');
        expect(opts.headers.Authorization).toBe('Bearer TOK');
    });

    it('normaliza resposta e deduplica por CNPJ', () => {
        const result = normalizarEmpresasPerfilResponse([
            { id: 'l1', nome: 'B Empresa', cnpj: '11.222.333/0001-81', fonte: 'lucro', regimeSugerido: 'QUALQUER' },
            { id: 'l2', nome: 'Duplicada', cnpj: '11222333000181', fonte: 'lucro', regimeSugerido: 'LUCRO_REAL_SERVICOS' },
            { id: 's1', nome: 'A Empresa', cnpj: '44.555.666/0001-00', fonte: 'simples', regimeSugerido: 'SIMPLES' },
            { id: 'x', nome: 'Sem CNPJ', cnpj: '123', fonte: 'simples' },
        ]);

        expect(result).toHaveLength(2);
        expect(result.map(e => e.nome)).toEqual(['A Empresa', 'B Empresa']);
        expect(result[1].regimeSugerido).toBe('LUCRO_PRESUMIDO');
    });

    it('propaga mensagem amigavel do backend em erro', async () => {
        fetchMock.mockReturnValue(Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'X',
            json: async () => ({ error: 'Falha ao carregar empresas do perfil do cliente' }),
        }));

        await expect(listarEmpresasPerfilBackend({ id: 'u1', name: 'Admin', email: 'admin@teste.com', role: 'admin' }))
            .rejects.toThrow('Falha ao carregar empresas do perfil do cliente');
    });

    it('nao consulta backend sem usuario logado no app', async () => {
        const result = await listarEmpresasPerfilBackend(null);
        expect(result).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('lanca quando Firebase Auth ainda nao tem usuario atual', async () => {
        mockCurrentUser = null;
        await expect(listarEmpresasPerfilBackend({ id: 'u1', name: 'Admin', email: 'admin@teste.com', role: 'admin' }))
            .rejects.toThrow('Usuario nao autenticado');
    });
});
