/**
 * E510 — CONFERIDO CONTRA ARQUIVO ACEITO NO PVA (SPED jun/2026 do e-Fiscal).
 *
 * A regra da casa é "arquivo aceito > leiaute deduzido": a definição do
 * VL_CONT_IPI (que nem o PVA confere) saiu de um arquivo real, cruzando o E510
 * com o C190. Provou-se que VL_CONT_IPI = Σ vProd (NÃO inclui o IPI). Estes
 * testes travam essa definição e a ordem dos campos, e reproduzem duas linhas
 * reais do arquivo (CFOP 5101 e 6101) a partir de itens sintéticos.
 */
// @ts-expect-error — módulo .js do backend (sem tipos)
import { montarLinhasE510 } from '../sefaz-backend/sped-bloco-ipi-e510.js';

// Sem convertCfop injetado, o CFOP passa cru — bom para o teste unitário.
const nota = (direcao: string, itens: any[]) => ({ direcao, _dados: {}, itens });
// buildLine termina cada linha com |\r\n; comparo a estrutura, sem o fim de linha.
const limpo = (linhas: string[]) => linhas.map((l) => l.replace(/\r?\n$/, ''));

describe('E510 — consolidação por CFOP + CST_IPI', () => {
    it('VL_CONT_IPI = Σ vProd (NÃO inclui IPI); campos na ordem provada', () => {
        // CFOP 5101 / CST 50: reproduz a relação real (VL_CONT ≠ VL_CONT+IPI).
        const { linhas } = montarLinhasE510([
            nota('saida', [
                { cfop: '5101', cstIpi: '50', vProd: 300000, vBcIpi: 280000, vIPI: 9000 },
                { cfop: '5101', cstIpi: '50', vProd: 17806.19, vBcIpi: 6092.21, vIPI: 298.08 },
            ]),
        ]);
        expect(linhas).toHaveLength(1);
        // |E510|CFOP|CST_IPI|VL_CONT|VL_BC|VL_IPI|
        expect(limpo(linhas)[0]).toBe('|E510|5101|50|317806,19|286092,21|9298,08|');
    });

    it('agrupa por par CFOP+CST_IPI e ordena por CFOP', () => {
        const { linhas } = montarLinhasE510([
            nota('saida', [
                { cfop: '6101', cstIpi: '50', vProd: 113398.01, vBcIpi: 72502.64, vIPI: 2356.36 },
                { cfop: '5122', cstIpi: '50', vProd: 2783.29, vBcIpi: 2695.68, vIPI: 87.61 },
            ]),
        ]);
        expect(limpo(linhas)).toEqual([
            '|E510|5122|50|2783,29|2695,68|87,61|',
            '|E510|6101|50|113398,01|72502,64|2356,36|',
        ]);
    });

    it('item NÃO-tributado (IPINT) entra com VL_BC e VL_IPI zerados', () => {
        const { linhas } = montarLinhasE510([
            nota('saida', [{ cfop: '5124', cstIpi: '55', vProd: 37651.32, vBcIpi: 0, vIPI: 0 }]),
        ]);
        expect(limpo(linhas)).toEqual(['|E510|5124|55|37651,32|0,00|0,00|']);
    });

    it('amarração: Σ VL_IPI dos E510 de saída = VL_DEB do E520 (11.742,05 no arquivo real)', () => {
        const { grupos } = montarLinhasE510([
            nota('saida', [
                { cfop: '5101', cstIpi: '50', vProd: 317806.19, vBcIpi: 286092.21, vIPI: 9298.08 },
                { cfop: '5122', cstIpi: '50', vProd: 2783.29, vBcIpi: 2695.68, vIPI: 87.61 },
                { cfop: '6101', cstIpi: '50', vProd: 113398.01, vBcIpi: 72502.64, vIPI: 2356.36 },
            ]),
        ]);
        const somaIpiSaida = grupos.reduce((s: number, g: any) => s + g.vlIpi, 0);
        expect(Number(somaIpiSaida.toFixed(2))).toBe(11742.05);
    });

    it('IPI destacado sem CST capturado NÃO entra e ACENDE aviso (regra: CST não se chuta)', () => {
        const { linhas, avisos } = montarLinhasE510([
            nota('saida', [{ cfop: '5101', vIPI: 100 /* sem cstIpi */ }]),
        ]);
        expect(linhas).toHaveLength(0);
        expect(avisos.join(' ')).toMatch(/SEM CST do IPI|backfill/i);
    });
});
