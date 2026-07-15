/**
 * Anti-656 na manifestação (caso J.N. VINATEX, 07/2026).
 *
 * O re-download da procNFe pós-Ciência (consChNFe) bate no MESMO webservice
 * NFeDistribuicaoDFe da captura. Em lote (cron manifesta até 100 resumos, e o
 * sync enfileira dezenas por página), a rajada de consChNFe gerava cStat=656
 * "Consumo Indevido" e DERRUBAVA a paginação DistDFe — a captura parava no
 * meio e "faltavam notas" todos os dias (80 de 187 no caso VINATEX 06/2026).
 *
 * Regra travada aqui:
 *  - manifestarUma({ skipRedownload: true }) NÃO chama consultaNFePorChave;
 *  - manifestarUma sem a flag mantém o re-download imediato (fluxo manual);
 *  - manifestarPendentes (lote) usa skipRedownload=true por padrão.
 */

const consultaNFePorChaveMock = jest.fn();
const manifestarNFeMock = jest.fn();
const addLogMock = jest.fn();
const updateDocMock = jest.fn();

const DOC_RESUMO = {
    id: 'CH1',
    chave: '35260603442526000110550010001581987000000001',
    empresaId: 'EMP1',
    empresaCnpj: '32602701000197',
    direcao: 'entrada',
    tipoDoc: 'resNFe',
    schema: 'resNFe_v1.01.xsd',
    temItens: false,
    status: 'autorizado',
    eventos: [],
    dhEmi: new Date().toISOString(),
};

jest.mock('firebase-admin', () => {
    const docRef = {
        get: async () => ({ exists: true, data: () => DOC_RESUMO }),
        update: async (patch: any) => { updateDocMock(patch); return {}; },
    };
    const collection = (name: string) => ({
        where() { return this; },
        limit() { return this; },
        get: async () => ({ docs: [] }),
        doc: () => docRef,
        add: async (data: any) => { addLogMock(name, data); return { id: 'log1' }; },
    });
    return {
        __esModule: true,
        default: {
            apps: [{}],
            initializeApp: jest.fn(),
            credential: { applicationDefault: jest.fn() },
            firestore: Object.assign(() => ({ collection }), {
                FieldValue: { serverTimestamp: () => 'ts' },
            }),
        },
    };
});

jest.mock('../sefaz-backend/manifesto-client.js', () => ({
    TIPOS_MANIFESTACAO: ['ciencia', 'confirmacao', 'desconhecimento', 'operacao_nao_realizada'],
    manifestarNFe: (...args: any[]) => manifestarNFeMock(...args),
}));

jest.mock('../sefaz-backend/sefaz-client.js', () => ({
    consultaNFePorChave: (...args: any[]) => consultaNFePorChaveMock(...args),
}));

jest.mock('../sefaz-backend/cert-storage.js', () => ({
    loadCertEmpresa: async () => ({
        pfxBuffer: Buffer.from('pfx'), password: 'x',
        cnpj: '32602701000197', notAfter: '2030-01-01T00:00:00Z',
    }),
    loadCertEmpresaPorCnpjBase: async () => null,
}));

jest.mock('../sefaz-backend/secret-loader.js', () => ({
    loadCertificate: async () => ({ pfxBuffer: Buffer.from('pfx'), password: 'x' }),
    extrairPem: () => ({ pemKey: 'KEY', pemCert: 'CERT' }),
}));

jest.mock('../sefaz-backend/empresa-flags.js', () => ({
    CNPJ_ESCRITORIO: '44388152000189',
    carregarFlagsEmpresa: async () => ({ uf: 'SP', procuracaoEcacAtiva: true }),
}));

jest.mock('../sefaz-backend/firestore-paginate.js', () => ({
    fetchAllDocs: async () => [{ id: DOC_RESUMO.id, data: () => DOC_RESUMO }],
}));

// @ts-expect-error — modulo .js puro
import { manifestarUma, manifestarPendentes } from '../sefaz-backend/manifesto-orchestrator.js';

const eventoAceito = () => ({
    idAttr: 'ID210210',
    retorno: {
        cStatLote: '128',
        xMotivoLote: 'Lote processado',
        eventos: [{ tpEvento: '210210', cStat: '135', xMotivo: 'Evento registrado', nProt: 'P1', dhRegEvento: '2026-07-15T09:00:00-03:00' }],
    },
});

describe('manifestação — skipRedownload (anti cStat 656)', () => {
    beforeEach(() => {
        consultaNFePorChaveMock.mockReset();
        manifestarNFeMock.mockReset().mockResolvedValue(eventoAceito());
        addLogMock.mockReset();
        updateDocMock.mockReset();
    });

    it('manifestarUma com skipRedownload=true NÃO chama consChNFe (NFeDistribuicaoDFe)', async () => {
        await manifestarUma({
            chNFe: DOC_RESUMO.chave,
            cnpjDestinatario: '32602701000197',
            tipo: 'ciencia',
            empresaId: 'EMP1',
            uf: 'SP',
            skipRedownload: true,
        });
        expect(manifestarNFeMock).toHaveBeenCalledTimes(1);
        expect(consultaNFePorChaveMock).not.toHaveBeenCalled();
        // Auditoria registra que a baixa foi adiada.
        const log = addLogMock.mock.calls.find(([col]) => col === 'manifestacoes_log');
        expect(log?.[1]?.baixaCompleta).toMatchObject({ adiada: true });
    });

    it('manifestarUma SEM a flag mantém o re-download imediato (fluxo manual)', async () => {
        consultaNFePorChaveMock.mockResolvedValue({ ok: true, cStat: '138', xmls: [] });
        await manifestarUma({
            chNFe: DOC_RESUMO.chave,
            cnpjDestinatario: '32602701000197',
            tipo: 'ciencia',
            empresaId: 'EMP1',
            uf: 'SP',
        });
        expect(consultaNFePorChaveMock).toHaveBeenCalledTimes(1);
    }, 15000);

    it('manifestarPendentes (lote) usa skipRedownload por padrão — zero consChNFe', async () => {
        const r = await manifestarPendentes({ limit: 10, tipo: 'ciencia' });
        expect(r.total).toBe(1);
        expect(r.sucessos).toBe(1);
        expect(consultaNFePorChaveMock).not.toHaveBeenCalled();
    }, 15000);
});
