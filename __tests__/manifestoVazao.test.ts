/**
 * Vazão da manifestação (caso 22/07: 3.889 resumos presos): round-robin por
 * raiz CNPJ pro lote não martelar uma raiz só (anti-656 + anti-fome).
 */
// @ts-expect-error — módulo .js (importa firebase-admin, mockado abaixo)
import { intercalarPorRaiz } from '../sefaz-backend/manifesto-orchestrator';

jest.mock('firebase-admin', () => ({
    __esModule: true,
    default: { apps: [{}], firestore: () => ({}) },
}));
jest.mock('../sefaz-backend/manifesto-client.js', () => ({}));
jest.mock('../sefaz-backend/sefaz-client.js', () => ({ consultaNFePorChave: jest.fn() }));
jest.mock('../sefaz-backend/cert-storage.js', () => ({}));
jest.mock('../sefaz-backend/secret-loader.js', () => ({ loadCertificate: jest.fn() }));
jest.mock('../sefaz-backend/empresa-flags.js', () => ({ carregarFlagsEmpresa: jest.fn(), CNPJ_ESCRITORIO: '44388152000189' }));
jest.mock('../sefaz-backend/firestore-paginate.js', () => ({ fetchAllDocs: jest.fn() }));

const doc = (cnpj: string, chave: string) => ({ empresaCnpj: cnpj, chave });

describe('intercalarPorRaiz', () => {
    it('caso APATEL: 1 raiz com 5 docs + 2 raízes com 1 → intercala, ninguém morre de fome', () => {
        const docs = [
            doc('51593093000146', 'a1'), doc('51593093000146', 'a2'), doc('51593093000146', 'a3'),
            doc('51593093000146', 'a4'), doc('51593093000146', 'a5'),
            doc('96616974000173', 'b1'),
            doc('01961491000108', 'c1'),
        ];
        const out = intercalarPorRaiz(docs);
        // Nas 3 primeiras posições, as 3 raízes aparecem (round-robin).
        const raizes3 = new Set(out.slice(0, 3).map((d: any) => d.empresaCnpj.slice(0, 8)));
        expect(raizes3.size).toBe(3);
        // Nada se perde e a ordem intra-raiz é preservada.
        expect(out).toHaveLength(7);
        expect(out.filter((d: any) => d.empresaCnpj === '51593093000146').map((d: any) => d.chave))
            .toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    });

    it('matriz e filial (mesma raiz) contam como UMA fila', () => {
        const docs = [doc('11111111000111', 'm1'), doc('11111111000222', 'f1'), doc('22222222000122', 'x1')];
        const out = intercalarPorRaiz(docs);
        const raizes2 = new Set(out.slice(0, 2).map((d: any) => d.empresaCnpj.slice(0, 8)));
        expect(raizes2.size).toBe(2); // 1111... e 2222..., não 3 filas
        expect(out).toHaveLength(3);
    });

    it('lista vazia e doc sem CNPJ não quebram', () => {
        expect(intercalarPorRaiz([])).toEqual([]);
        const out = intercalarPorRaiz([{ chave: 'z' } as any, doc('22222222000122', 'x1')]);
        expect(out).toHaveLength(2);
    });
});
