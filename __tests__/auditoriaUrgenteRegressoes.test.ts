/** @jest-environment node */
import { mesclarAnaliseComRemota } from '../services/nfpAnaliseMerge';
import { montarPromptAnaliseIA } from '../services/nfpAnaliseIA';
const { requireAuth } = require('../sefaz-backend/require-admin.js');
const { podeTransmitirDctfweb } = require('../sefaz-backend/dctfweb-transmissao-regras.js');
const { emitirDasRegular } = require('../sefaz-backend/das-orchestrator.js');
const { requireEmpresaEmissao } = require('../sefaz-backend/emissao-empresa-auth.js');

jest.mock('../services/firebaseConfig', () => ({ auth: null }));
const mockDocs = new Map<string, any>();
const mockTransmit = jest.fn();
const mockGenerate = jest.fn();
const mockRef = (key: string): any => ({
    key,
    get: async () => ({ exists: mockDocs.has(key), data: () => mockDocs.get(key) }),
    set: async (value: any) => { mockDocs.set(key, { ...mockDocs.get(key), ...value }); },
});
const mockDb = {
    collection: (name: string) => ({ doc: (id: string) => mockRef(name + '/' + id) }),
    runTransaction: async (fn: any) => fn({
        get: (ref: any) => ref.get(),
        set: (ref: any, value: any) => { mockDocs.set(ref.key, { ...mockDocs.get(ref.key), ...value }); },
    }),
};
jest.mock('firebase-admin', () => ({
    __esModule: true,
    default: {
        apps: [{}], firestore: () => mockDb,
        auth: () => ({ verifyIdToken: async () => ({ uid: 'audit', email: 'test@example.invalid' }) }),
    },
}));
jest.mock('../sefaz-backend/das-provider.js', () => ({
    getDasProvider: () => ({ transmitirPgdasD: mockTransmit, gerarDas: mockGenerate }),
    getDasMode: () => 'mock',
}));

const input = { empresaId: 'audit', empresaCnpj: '00000000000000', competencia: '2026-08', valor: 100 };
const docKey = 'das_emitidos/00000000000000_2026-08_regular';
const operationKey = 'das_emissao_operacoes/00000000000000_2026-08_regular';
const resposta = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

beforeEach(() => {
    mockDocs.clear();
    jest.clearAllMocks();
    process.env.HORARIO_ACESSO_ATIVO = '';
    process.env.EMISSAO_BLOQUEADA = 'false';
    process.env.EMISSAO_BLOQUEADA_DAS = 'false';
    mockTransmit.mockResolvedValue({ recibo: 'receipt', transmitidoEm: '2026-09-21' });
    mockGenerate.mockResolvedValue({ numeroDocumento: 'guide', valor: 100 });
});

test('fiscal department survives authentication', async () => {
    mockDocs.set('users/audit', { role: 'colaborador', departamentos: ['fiscal'] });
    const req: any = { headers: { authorization: 'Bearer mock' } };
    const next = jest.fn();
    await requireAuth(req, resposta(), next);
    expect(next).toHaveBeenCalled();
    expect(podeTransmitirDctfweb(req.user).pode).toBe(true);
});

test('saving a debt preserves a remote certificate change', () => {
    const base: any = { certidoes: [{ id: 'c1', dataValidade: '2026-07-01' }], debitos: [] };
    const remote: any = { ...base, certidoes: [{ id: 'c1', dataValidade: '2026-12-31' }] };
    const local: any = { ...base, debitos: [{ id: 'd1', valorOriginal: 100 }] };
    expect(mesclarAnaliseComRemota(local, remote, base).certidoes[0].dataValidade).toBe('2026-12-31');
});

test('conflicting changes are rejected rather than silently lost', () => {
    const base: any = { debitos: [{ id: 'd1', valorOriginal: 100 }] };
    const local: any = { debitos: [{ id: 'd1', valorOriginal: 200 }] };
    const remote: any = { debitos: [{ id: 'd1', valorOriginal: 300 }] };
    expect(() => mesclarAnaliseComRemota(local, remote, base)).toThrow('Outro colaborador');
});

test('remote deletion is not resurrected by an unchanged local item', () => {
    const base: any = { debitos: [{ id: 'd1', valorOriginal: 100 }] };
    expect(mesclarAnaliseComRemota(base, { debitos: [] } as any, base).debitos).toEqual([]);
});

test('notes are included without asserting that the status was verified', () => {
    const prompt = montarPromptAnaliseIA({
        certidoes: [{ id: 'c', status: 'nao_consultada', motivoImpedimento: 'CERT_NOTE' }],
        obrigacoes: [{ id: 'o', status: 'nao_verificada', observacao: 'BLOCK_K_NOTE' }],
    } as any);
    expect(prompt).toContain('CERT_NOTE');
    expect(prompt).toContain('BLOCK_K_NOTE');
    expect(prompt).toContain('nao_verificada');
});

test('repeated DAS returns the existing guide and preserves settlement', async () => {
    await emitirDasRegular(input);
    mockDocs.set(docKey, { ...mockDocs.get(docKey), statusPagamento: 'pago', dataPagamento: '2026-09-21' });
    const result = await emitirDasRegular(input);
    expect(mockTransmit).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(result.statusPagamento).toBe('pago');
    expect(result.dataPagamento).toBe('2026-09-21');
});

test('failed guide generation preserves receipt and resumes without retransmission', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('timeout'));
    await expect(emitirDasRegular(input)).rejects.toThrow('timeout');
    expect(mockDocs.get(operationKey)).toMatchObject({ pgdasRecibo: 'receipt', emissaoEtapa: 'guia_pendente' });
    expect(mockDocs.has(docKey)).toBe(false);
    await emitirDasRegular(input);
    expect(mockTransmit).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
});

test('uncertain external response blocks an automatic retry', async () => {
    mockTransmit.mockRejectedValueOnce(new Error('timeout'));
    await expect(emitirDasRegular(input)).rejects.toThrow('timeout');
    await expect(emitirDasRegular(input)).rejects.toMatchObject({ httpStatus: 409 });
    expect(mockTransmit).toHaveBeenCalledTimes(1);
});

test('in-progress operation and legacy receipt never silently retransmit', async () => {
    mockDocs.set(operationKey, { emissaoEtapa: 'transmitindo' });
    await expect(emitirDasRegular(input)).rejects.toMatchObject({ httpStatus: 409 });
    mockDocs.delete(operationKey);
    mockDocs.set(docKey, { pgdasRecibo: 'legacy' });
    await expect(emitirDasRegular(input)).rejects.toMatchObject({ httpStatus: 409 });
    expect(mockTransmit).not.toHaveBeenCalled();
});

test('emission rejects a CNPJ different from the stored company, even for admin', async () => {
    mockDocs.set('simples_empresas/audit', { cnpj: '11111111111111' });
    const res = resposta();
    const next = jest.fn();
    await requireEmpresaEmissao({ body: { ...input }, user: { role: 'admin' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
});

test('emission permits a valid stored identity for admin', async () => {
    mockDocs.set('simples_empresas/audit', { cnpj: input.empresaCnpj });
    const next = jest.fn();
    await requireEmpresaEmissao({ body: { ...input }, user: { role: 'admin' } }, resposta(), next);
    expect(next).toHaveBeenCalled();
});
