/**
 * Reparo das notas SEM DONO (27/07).
 *
 * Caso real (GUARANI): 36 XMLs de entrada importados por ZIP ficaram com
 * empresaId nulo — a rota de lote chamava o importer sem o empresaId. Como a
 * aba XMLs filtra por empresaId, as notas existiam mas eram invisíveis. E
 * reimportar não resolvia: o fast-path de duplicidade saía antes de reatribuir.
 */
// @ts-expect-error — módulo .js puro
import { decidirDonoDoDoc, repararDocsSemDono } from '../sefaz-backend/docs-sem-dono.js';

const GUARANI = { empresaId: 'g1', cnpj: '58692419000131', nome: 'GUARANI COMERCIO DE DOCES' };
const porCnpj = new Map([[GUARANI.cnpj, GUARANI]]);
const porRaiz = new Map([[GUARANI.cnpj.slice(0, 8), GUARANI]]);

describe('decidirDonoDoDoc', () => {
    it('nota de ENTRADA: cliente no destinatário (caso do ZIP da GUARANI)', () => {
        const r = decidirDonoDoDoc({ cnpjEmit: '08853241000195', cnpjDest: GUARANI.cnpj }, porCnpj, porRaiz);
        expect(r).toEqual({ empresaId: 'g1', empresaCnpj: GUARANI.cnpj, direcao: 'entrada', viaRaiz: false });
    });

    it('nota de SAÍDA: cliente no emitente', () => {
        const r = decidirDonoDoDoc({ cnpjEmit: GUARANI.cnpj, cnpjDest: '08853241000195' }, porCnpj, porRaiz);
        expect(r.direcao).toBe('saida');
    });

    it('filial casa pela raiz do CNPJ', () => {
        const r = decidirDonoDoDoc({ cnpjEmit: '11111111000191', cnpjDest: '58692419000212' }, porCnpj, porRaiz);
        expect(r.empresaId).toBe('g1');
        expect(r.viaRaiz).toBe(true);
    });

    it('nota de terceiros NÃO ganha dono inventado', () => {
        expect(decidirDonoDoDoc({ cnpjEmit: '11111111000191', cnpjDest: '22222222000172' }, porCnpj, porRaiz)).toBeNull();
        expect(decidirDonoDoDoc({}, porCnpj, porRaiz)).toBeNull();
    });

    it('emitente tem prioridade quando as duas pontas são do cliente (transferência)', () => {
        const r = decidirDonoDoDoc({ cnpjEmit: GUARANI.cnpj, cnpjDest: '58692419000212' }, porCnpj, porRaiz);
        expect(r.direcao).toBe('saida');
    });
});

describe('repararDocsSemDono', () => {
    // Stub de Firestore: uma página de docs órfãos.
    const makeDb = (docs: any[]) => {
        const updates: Record<string, any> = {};
        const db = {
            updates,
            collection: () => ({
                where: () => ({
                    orderBy: () => ({
                        limit: () => ({
                            startAfter: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }),
                            get: async () => ({
                                empty: docs.length === 0,
                                size: docs.length,
                                docs: docs.map((d) => ({
                                    id: d.id,
                                    data: () => d,
                                    ref: { update: async (p: any) => { updates[d.id] = p; } },
                                })),
                            }),
                        }),
                    }),
                }),
            }),
        };
        return db;
    };

    const docs = [
        { id: 'ch1', cnpjEmit: '08853241000195', cnpjDest: GUARANI.cnpj },   // entrada da GUARANI
        { id: 'ch2', cnpjEmit: GUARANI.cnpj, cnpjDest: '08853241000195' },   // saída da GUARANI
        { id: 'ch3', cnpjEmit: '11111111000191', cnpjDest: '22222222000172' }, // de terceiros
        { id: 'ch4' },                                                        // sem CNPJ gravado
    ];

    it('ENSAIO (aplicar=false): conta o que seria reparado sem gravar nada', async () => {
        const db: any = makeDb(docs);
        const r = await repararDocsSemDono({ db, porCnpj, porRaiz, aplicar: false });
        expect(r.analisados).toBe(4);
        expect(r.reparados).toBe(2);
        expect(r.semDonoConhecido).toBe(1);
        expect(r.semCnpjNoDoc).toBe(1);
        expect(r.porEmpresa['GUARANI COMERCIO DE DOCES']).toBe(2);
        expect(db.updates).toEqual({});
    });

    it('aplicando: grava dono e direção só nos que têm dono conhecido', async () => {
        const db: any = makeDb(docs);
        const r = await repararDocsSemDono({ db, porCnpj, porRaiz, aplicar: true });
        expect(r.reparados).toBe(2);
        expect(db.updates.ch1).toMatchObject({ empresaId: 'g1', direcao: 'entrada', empresaCnpj: GUARANI.cnpj });
        expect(db.updates.ch2).toMatchObject({ empresaId: 'g1', direcao: 'saida' });
        expect(db.updates.ch3).toBeUndefined();
        expect(db.updates.ch4).toBeUndefined();
    });

    it('base sem órfãos termina limpo (sem cursor pendente)', async () => {
        const db: any = makeDb([]);
        const r = await repararDocsSemDono({ db, porCnpj, porRaiz, aplicar: true });
        expect(r.analisados).toBe(0);
        expect(r.acabou).toBe(true);
        expect(r.cursor).toBeNull();
    });
});
