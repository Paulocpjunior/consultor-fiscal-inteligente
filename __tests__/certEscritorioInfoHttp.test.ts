// ============================================================================
// 🚨 401/403/5xx no cert do escritório NÃO é "certificado inválido".
//
// `getCertEscritorioInfo` devolvia `res.json()` sem olhar `res.ok`: o corpo de
// um 403 (`{error:'…'}`) chegava na tela com `valido: undefined`, e o painel
// dizia "cert fora da validade" — a primeira parada errada. A falha agora sai
// NOMEADA, com o motivo do backend.
// ============================================================================
jest.mock('firebase/auth', () => ({
    getAuth: () => ({ currentUser: { getIdToken: async () => 'token-de-teste' } }),
}));

import { getCertEscritorioInfo } from '../services/consultaNFeChaveService';

const resposta = (ok: boolean, status: number, corpo: unknown) => ({
    ok, status, json: async () => corpo,
});

describe('getCertEscritorioInfo honra o HTTP', () => {
    afterEach(() => { (global as any).fetch = undefined; });

    it('403 vira "não autorizado", com o motivo do backend — nunca "inválido"', async () => {
        (global as any).fetch = jest.fn(async () => resposta(false, 403, { error: 'acesso restrito a admin' }));
        await expect(getCertEscritorioInfo()).rejects.toThrow(/Não autorizado.*acesso restrito a admin/);
    });

    it('5xx vira falha da consulta, com o status quando o corpo não explica', async () => {
        (global as any).fetch = jest.fn(async () => resposta(false, 502, {}));
        await expect(getCertEscritorioInfo()).rejects.toThrow(/Falha ao consultar.*HTTP 502/);
    });

    it('2xx devolve o corpo como está', async () => {
        const corpo = { ok: true, valido: true, cnpjNoCert: '44388152000189' };
        (global as any).fetch = jest.fn(async () => resposta(true, 200, corpo));
        await expect(getCertEscritorioInfo()).resolves.toEqual(corpo);
    });
});
