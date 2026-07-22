/**
 * Conferência por chaves (CFI × SIEG) — caso EDUARDO GUERRA 07/2026:
 * SIEG 65 × CFI 45 e ninguém sabia QUAIS 20 faltavam.
 */
import { extrairChaves, modeloDaChaveAcesso, classificarChaves } from '../sefaz-backend/conferencia-chaves';

const CH1 = '35260700005430000104550010000070831000070831'; // 44 díg, mod 55
const CH2 = '35260767267435000178550010000012341000000009';
const CH65 = '35260700005430000104650010000070831000070831'; // mod 65

describe('extrairChaves', () => {
    it('extrai de texto livre da SIEG (separadores variados) e dedupa', () => {
        const texto = `nota 1: ${CH1}\nlinha;${CH2};qualquer coisa\n${CH1} repetida`;
        expect(extrairChaves(texto)).toEqual([CH1, CH2]);
    });
    it('não fatia números maiores que 44 dígitos', () => {
        expect(extrairChaves(CH1 + CH2)).toEqual([]); // 88 díg colados = lixo
    });
    it('vazio para texto sem chave', () => {
        expect(extrairChaves('relatório SIEG 07/2026')).toEqual([]);
        expect(extrairChaves(null)).toEqual([]);
    });
});

describe('classificarChaves', () => {
    it('separa completa / resumo / ausente e soma o resumo', () => {
        const presentes = new Map<string, any>([
            [CH1, { schema: 'procNFe_v4.00.xsd', direcao: 'entrada', empresaCnpj: '00005430000104' }],
            [CH2, { schema: 'resNFe_v1.01.xsd', tipoDoc: 'NFe', direcao: 'entrada' }],
        ]);
        const r = classificarChaves([CH1, CH2, CH65], presentes);
        expect(r.itens.map(i => i.status)).toEqual(['presente-completa', 'presente-resumo', 'ausente']);
        expect(r.resumo).toEqual({ total: 3, presentesCompletas: 1, presentesResumo: 1, ausentes: 1 });
        expect(modeloDaChaveAcesso(CH65)).toBe('65');
    });
});
