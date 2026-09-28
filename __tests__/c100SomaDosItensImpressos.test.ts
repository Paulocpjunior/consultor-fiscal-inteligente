/**
 * 🚨 O C100 SOMA O QUE ESTÁ IMPRESSO NOS C170 — não os valores crus.
 *
 * ELS 08/2026, 3ª rodada do PVA (28/09): 9 recusas "VL_PIS deve ser maior ou
 * igual à soma dos itens" e 1 de COFINS, todas por UM ou DOIS centavos
 * (1205,65 × 1205,66; 71,03 × 71,05). O PVA soma os C170 como saem no
 * arquivo, com duas casas por item; somar os crus e arredondar no fim fica
 * abaixo sempre que os terceiros decimais se acumulam.
 *
 * Fato cobrado: VL_PIS/VL_COFINS do C100 ≥ Σ dos VL_PIS/VL_COFINS impressos
 * nos C170 (a validação do Guia). A fixture PROVA que alcança o ramo: nela a
 * soma dos impressos passa da soma crua arredondada.
 */
import { buildBlocoC_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';

const campos = (l: string) => l.trim().split('|');
const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const round2 = (v: number) => Number(v.toFixed(2));

// vProd de 100, 107 e 350 a 1,65%: 1,65 + 1,7655 + 5,775 = 9,1905 → crua 9,19;
// impressos 1,65 + 1,77 + 5,78 = 9,20. É o centavo da ELS.
const VALORES = [100, 107, 350];
const nfe = () => ({
    tipo: 'NFe', direcao: 'entrada', numero: '1809', modFrete: '9',
    chave: '29260849167213000100550010000018091896679148',
    dataEmissao: '2026-08-19', cnpjEmit: '49167213000100', cnpjDest: '65671243000105',
    itens: VALORES.map((v, k) => ({
        nItem: k + 1, codigo: `P${k}`, descricao: 'Banana', cfop: '1102', ncm: '99999999',
        unidade: 'KG', quantidade: 1, vUnCom: v, vProd: v, vDesc: 0, cstPis: '50', cstCofins: '50', vPIS: 0, vCOFINS: 0, vICMS: 0,
    })),
});

describe('C100 VL_PIS/VL_COFINS ≥ soma dos C170 como impressos', () => {
    const linhas: string[] = buildBlocoC_Contrib({
        empresa: { cnpj: '65671243000105' }, notas: [nfe()], regimeApuracao: '1', warnings: [],
    });
    const c100 = campos(linhas.find((l) => l.startsWith('|C100|')) as string);
    const c170 = linhas.filter((l) => l.startsWith('|C170|')).map(campos);

    it('a fixture alcança o ramo: a soma dos impressos passa da soma crua arredondada', () => {
        const crua = VALORES.reduce((s, v) => s + v * 0.0165, 0);
        const impressa = c170.reduce((s, c) => s + num(c[30]), 0);
        expect(c170).toHaveLength(3);
        expect(round2(impressa)).toBeGreaterThan(round2(crua));
    });

    it('PIS (campo 26) e COFINS (campo 27) do C100 não ficam abaixo da soma dos itens', () => {
        const somaPis = c170.reduce((s, c) => s + num(c[30]), 0);
        const somaCofins = c170.reduce((s, c) => s + num(c[36]), 0);
        expect(num(c100[26])).toBeGreaterThanOrEqual(round2(somaPis));
        expect(num(c100[27])).toBeGreaterThanOrEqual(round2(somaCofins));
        expect(num(c100[26])).toBeCloseTo(9.2, 2);
    });
});
