/** @jest-environment node */
const mockDocs = new Map<string, any>();
const mockDownload = jest.fn(async () => [Buffer.from('<NFe/>')]);
const mockSave = jest.fn(async () => undefined);
jest.mock('multer', () => ({ __esModule: true, default: jest.requireActual('multer') }));
jest.mock('firebase-admin', () => ({ __esModule: true, default: {
    apps: [{}], firestore: () => ({ collection: (col: string) => ({ doc: (id: string) => ({ get: async () => ({ exists: mockDocs.has(`${col}/${id}`), data: () => mockDocs.get(`${col}/${id}`) }) }) }) }),
} }));
jest.mock('@google-cloud/storage', () => ({ Storage: jest.fn(() => ({ bucket: () => ({ file: () => ({ download: mockDownload, save: mockSave }) }) })) }));
jest.mock('../sefaz-backend/require-admin.js', () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
jest.mock('../sefaz-backend/carteira-auth.js', () => ({
    podeAcessarCnpj: jest.fn(),
    podeAcessarEmpresaId: async (user: any, id: string) => user.uid === 'membro' && id === 'a' ? { ok: true } : { ok: false, status: 403, error: 'fora da carteira' },
}));
const router = require('../sefaz-backend/xml-download-routes.js').default;
const handler = router.stack.find((layer: any) => layer.route?.path === '/arquivo-original/:id').route.stack.at(-1).handle;
const uploadHandler = router.stack.find((layer: any) => layer.route?.path === '/arquivo-original-upload').route.stack.at(-1).handle;
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn(), send: jest.fn() });
beforeEach(() => {
    jest.clearAllMocks(); mockDocs.clear();
    mockDocs.set('documentos_fiscais/n', { empresaId: 'a', storagePath: 'xmls/a/n.xml' });
});
test('nega antes de baixar o arquivo de outra carteira', async () => {
    const res = response();
    await handler({ params: { id: 'n' }, user: { uid: 'fora' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockDownload).not.toHaveBeenCalled();
});
test('baixa arquivo autorizado sem cache publico', async () => {
    const res = response();
    await handler({ params: { id: 'n' }, user: { uid: 'membro' } }, res);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
});
test('metadado forjado nao permite apontar para arquivo de outra empresa', async () => {
    mockDocs.set('documentos_fiscais/n', { empresaId: 'a', storagePath: 'xmls/b/segredo.xml' });
    const res = response();
    await handler({ params: { id: 'n' }, user: { uid: 'membro' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockDownload).not.toHaveBeenCalled();
});
test('upload autorizado nao cria token publico', async () => {
    const res = response();
    await uploadHandler({ user: { uid: 'membro' }, body: { empresaId: 'a', storagePath: 'xmls/a/n.xml' }, file: { mimetype: 'application/xml', buffer: Buffer.from('<NFe/>'), size: 6 } }, res);
    expect(mockSave).toHaveBeenCalledWith(Buffer.from('<NFe/>'), { resumable: false, metadata: { contentType: 'application/xml', metadata: {} } });
});
test('upload nao pode escolher caminho de outra empresa', async () => {
    const res = response();
    await uploadHandler({ user: { uid: 'membro' }, body: { empresaId: 'a', storagePath: 'xmls/b/n.xml' }, file: { mimetype: 'application/xml', buffer: Buffer.from('<NFe/>'), size: 6 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSave).not.toHaveBeenCalled();
});
