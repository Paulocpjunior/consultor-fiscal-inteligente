/**
 * Backlog de entrada — termômetro do "substituir a SIEG": completas × resumos
 * pendentes de ciência × travadas, por empresa.
 */
import {
    docEhResumo, docTemManifestacao, classificarDocEntrada, analisarBacklogEntrada,
} from '../sefaz-backend/backlog-entrada';

const AGORA = new Date('2026-07-22T12:00:00Z').getTime();
const DIA = 24 * 3600 * 1000;

describe('classificarDocEntrada', () => {
    it('procNFe → completa', () => {
        expect(classificarDocEntrada({ schema: 'procNFe_v4.00.xsd', tipoDoc: 'NFe' }, AGORA)).toBe('completa');
    });
    it('resNFe sem manifestação → resumo_pendente', () => {
        expect(classificarDocEntrada({
            schema: 'resNFe_v1.01.xsd', tipoDoc: 'NFe',
            dhEmi: new Date(AGORA - 5 * DIA).toISOString(),
        }, AGORA)).toBe('resumo_pendente');
    });
    it('resNFe com ciência → resumo_manifestado', () => {
        expect(classificarDocEntrada({
            schema: 'resNFe_v1.01.xsd',
            eventos: [{ tipo: 'manifestacao_ciencia' }],
        }, AGORA)).toBe('resumo_manifestado');
    });
    it('resNFe sem manifestação e >180 dias → resumo_fora_prazo', () => {
        expect(classificarDocEntrada({
            schema: 'resNFe_v1.01.xsd',
            dhEmi: new Date(AGORA - 200 * DIA).toISOString(),
        }, AGORA)).toBe('resumo_fora_prazo');
    });
    it('tipoDoc resNFe sem schema também é resumo', () => {
        expect(docEhResumo({ tipoDoc: 'resNFe' })).toBe(true);
        expect(docEhResumo({ schema: 'procNFe_v4.00.xsd' })).toBe(false);
    });
    it('qualquer manifestação conta (confirmação também)', () => {
        expect(docTemManifestacao({ eventos: [{ tipo: 'manifestacao_confirmacao' }] })).toBe(true);
        expect(docTemManifestacao({ eventos: [{ tipo: 'cancelamento' }] })).toBe(false);
        expect(docTemManifestacao({})).toBe(false);
    });
});

describe('analisarBacklogEntrada', () => {
    const empresas = [
        { empresaId: 'a', cnpj: '11111111000111', nome: 'Alfa', regime: 'lucro' },
        { empresaId: 'b', cnpj: '22222222000122', nome: 'Beta', regime: 'simples' },
        { empresaId: 'c', cnpj: '33333333000133', nome: 'Gama', regime: 'lucro' },
    ];
    const docs = [
        // Alfa: 2 completas + 1 resumo pendente → pendente-ciencia
        { empresaCnpj: '11111111000111', schema: 'procNFe_v4.00.xsd' },
        { empresaCnpj: '11111111000111', schema: 'procNFe_v4.00.xsd' },
        { empresaCnpj: '11111111000111', schema: 'resNFe_v1.01.xsd', dhEmi: new Date(AGORA - 3 * DIA).toISOString() },
        // Beta: 1 resumo manifestado → aguardando-completa
        { empresaCnpj: '22222222000122', schema: 'resNFe_v1.01.xsd', eventos: [{ tipo: 'manifestacao_ciencia' }] },
        // doc órfão (empresa fora do cadastro)
        { empresaCnpj: '99999999000199', schema: 'procNFe_v4.00.xsd' },
    ];
    const states = {
        '22222222000122': { ultimaSyncMs: AGORA - DIA, cStatUltimaSync: '137', pendenciaNSU: 0, nsuTravado: null },
        '33333333000133': { ultimaSyncMs: AGORA - DIA, cStatUltimaSync: '656', pendenciaNSU: 12, nsuTravado: '900' },
    };

    const r = analisarBacklogEntrada({ empresas, docs, states, agoraMs: AGORA });

    it('classifica por pior condição e ordena pior primeiro', () => {
        const porCnpj = Object.fromEntries(r.linhas.map((l: any) => [l.cnpj, l]));
        expect(porCnpj['11111111000111'].status).toBe('pendente-ciencia');
        expect(porCnpj['22222222000122'].status).toBe('aguardando-completa');
        // Gama: sem docs mas TRAVADA (nsuTravado + pendência) — trava vence
        expect(porCnpj['33333333000133'].status).toBe('travada');
        expect(r.linhas[0].cnpj).toBe('33333333000133');
    });

    it('conta docs e % completa', () => {
        const alfa = r.linhas.find((l: any) => l.cnpj === '11111111000111')!;
        expect(alfa.totalEntradas).toBe(3);
        expect(alfa.completas).toBe(2);
        expect(alfa.resumosPendentes).toBe(1);
        expect(alfa.pctCompleta).toBeCloseTo(66.7, 1);
    });

    it('propaga estado NSU e conta órfãos', () => {
        const gama = r.linhas.find((l: any) => l.cnpj === '33333333000133')!;
        expect(gama.pendenciaNSU).toBe(12);
        expect(gama.nsuTravado).toBe('900');
        expect(gama.cStatUltimaSync).toBe('656');
        expect(r.resumo.docsSemEmpresa).toBe(1);
    });

    it('resumo agregado bate', () => {
        expect(r.resumo).toMatchObject({
            totalEmpresas: 3,
            travadas: 1,
            pendentesCiencia: 1,
            aguardandoCompleta: 1,
            totalDocs: 4,
            totalCompletas: 2,
            totalResumosPendentes: 1,
            totalResumosManifestados: 1,
        });
    });
});
