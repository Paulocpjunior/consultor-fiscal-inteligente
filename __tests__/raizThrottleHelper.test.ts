/**
 * Trava a regra anti-656: no máx. 1 CNPJ por raiz por ciclo do cron, com
 * rotação diária. Caso real: J.N. VINATEX (raiz 32602701, 3 filiais) —
 * 0003 sincronizava (137) e matriz + 0002 tomavam 656 logo em seguida;
 * a 0002 ficou com ultNSU=0 sem nunca capturar.
 */
import { cnpjRaiz, umaPorRaizPorCiclo } from '../sefaz-backend/raiz-throttle-helper.js';

const DIA0 = 0; // epoch → dia 0
const DIA1 = 86400000;
const DIA2 = 2 * 86400000;

const vinatex = [
    { cnpj: '32602701000197', nome: 'VINATEX matriz' },
    { cnpj: '32602701000278', nome: 'VINATEX 0002' },
    { cnpj: '32602701000359', nome: 'VINATEX 0003' },
];

describe('cnpjRaiz', () => {
    it('extrai 8 primeiros dígitos de CNPJ formatado ou não', () => {
        expect(cnpjRaiz('32.602.701/0001-97')).toBe('32602701');
        expect(cnpjRaiz('32602701000197')).toBe('32602701');
    });
    it('retorna vazio pra input inválido', () => {
        expect(cnpjRaiz('123')).toBe('');
        expect(cnpjRaiz(null)).toBe('');
        expect(cnpjRaiz(undefined)).toBe('');
    });
});

describe('umaPorRaizPorCiclo', () => {
    it('seleciona exatamente 1 por raiz quando há filiais', () => {
        const { selecionadas, puladas } = umaPorRaizPorCiclo(vinatex, DIA0);
        expect(selecionadas).toHaveLength(1);
        expect(puladas).toHaveLength(2);
    });

    it('rotaciona diariamente — em 3 dias, cada filial sincroniza 1x', () => {
        const vistos = new Set<string>();
        for (const dia of [DIA0, DIA1, DIA2]) {
            const { selecionadas } = umaPorRaizPorCiclo(vinatex, dia);
            vistos.add(selecionadas[0].cnpj);
        }
        expect(vistos.size).toBe(3);
    });

    it('não mexe em empresas de raízes distintas (caso comum: 1 CNPJ por raiz)', () => {
        const solo = [
            { cnpj: '44388152000189' },
            { cnpj: '65833410000169' },
        ];
        const { selecionadas, puladas } = umaPorRaizPorCiclo(solo, DIA0);
        expect(selecionadas).toHaveLength(2);
        expect(puladas).toHaveLength(0);
    });

    it('mistura: raiz com 3 filiais + 2 solos → 3 selecionadas, 2 puladas', () => {
        const { selecionadas, puladas } = umaPorRaizPorCiclo(
            [...vinatex, { cnpj: '44388152000189' }, { cnpj: '65833410000169' }],
            DIA0,
        );
        expect(selecionadas).toHaveLength(3);
        expect(puladas).toHaveLength(2);
        expect(puladas.every(e => e.cnpj.startsWith('32602701'))).toBe(true);
    });

    it('é determinística pro mesmo dia', () => {
        const a = umaPorRaizPorCiclo(vinatex, DIA1).selecionadas[0].cnpj;
        const b = umaPorRaizPorCiclo(vinatex, DIA1).selecionadas[0].cnpj;
        expect(a).toBe(b);
    });

    it('lista vazia / undefined não explode', () => {
        expect(umaPorRaizPorCiclo([], DIA0).selecionadas).toHaveLength(0);
        expect(umaPorRaizPorCiclo(undefined as any, DIA0).selecionadas).toHaveLength(0);
    });

    it('CNPJ inválido vira grupo solo (não agrupa com ninguém)', () => {
        const { selecionadas } = umaPorRaizPorCiclo(
            [{ cnpj: '123' }, { cnpj: '456' }],
            DIA0,
        );
        expect(selecionadas).toHaveLength(2);
    });
});
