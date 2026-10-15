/**
 * 🚦 EVENTO DA REINF COM VALOR QUE O CFI AINDA NÃO LÊ (15/10).
 *
 * Paulo, contribuinte 00621930 · 09/2026: lote com R-9015 (CSRF 124,98) e
 * R-5001. A DCTFWeb trazia INSS retido 116201 de 457,60 (prestador
 * 49162220000100); a Reinf do CFI dizia INSS 0,00 e o R-5001 aparecia com ✓
 * verde. O INSS ESTÁ no R-5001 (recibo do R-2010) — o CFI só não lê os valores
 * dele (sem arquivo real para calibrar, o leiaute não se chuta). A trava do
 * DARF segurava a emissão dizendo só "não batem em INSS".
 *
 * Fatos cobrados: o evento reconhecido pelo nome e com valor não lido é
 * NOMEADO (com a família); a trava diz a causa e o caminho (subir o R-2010);
 * família que outro evento do lote já traz lida não é alarme; e a trava
 * continua travando (a divergência é real até o INSS ser lido).
 */
import { decidirEmissaoRetidos, eventosComValorNaoLido } from '../services/efdReinfConference';

const ev = (codigo: string, calibrado: boolean) => ({ ok: true, codigo, calibrado });

const resultadoDoPrint: any = {
    competencia: '2026-09',
    totalDctfweb: 582.58,
    divergencias: [
        { familia: 'INSS', valorReinf: 0, valorDctfweb: 457.6, status: 'dctfweb_sem_reinf' },
        { familia: 'IRRF', valorReinf: 0, valorDctfweb: 0, status: 'ok' },
        { familia: 'CSRF', valorReinf: 124.98, valorDctfweb: 124.98, status: 'ok' },
    ],
};

describe('o lote do print: R-9015 + R-5001', () => {
    const lote = [ev('R-9015', true), ev('R-5001', false)];

    it('o R-5001 sai nomeado como INSS não lido (antes: ✓ verde)', () => {
        expect(eventosComValorNaoLido(lote)).toEqual([{ codigo: 'R-5001', familias: ['INSS'] }]);
    });

    it('a trava continua, e diz a causa e o caminho', () => {
        const d = decidirEmissaoRetidos({
            resultado: resultadoDoPrint, dctfwebLido: true, eventosNaoLidos: [],
            eventosSemValor: eventosComValorNaoLido(lote),
        });
        expect(d.pode).toBe(false);
        expect(d.motivo).toMatch(/não batem em INSS/);
        expect(d.motivo).toMatch(/INSS: o lote só traz R-5001, cujos valores o CFI ainda não lê/);
        expect(d.motivo).toMatch(/R-2010/);
    });
});

describe('família já lida por outro evento do lote não é alarme', () => {
    it('R-2010 lido + R-5001: o INSS está coberto', () => {
        expect(eventosComValorNaoLido([ev('R-2010', true), ev('R-5001', false)])).toEqual([]);
    });
    it('R-9015 lido + R-4020: IRRF/CSRF cobertos', () => {
        expect(eventosComValorNaoLido([ev('R-9015', true), ev('R-4020', false)])).toEqual([]);
    });
    it('R-2099 (fechamento, sem valor) nunca é alarme', () => {
        expect(eventosComValorNaoLido([ev('R-2099', false)])).toEqual([]);
    });
});

describe('divergência sem evento não lido segue com a mensagem de sempre', () => {
    it('sem causa conhecida, não inventa uma', () => {
        const d = decidirEmissaoRetidos({
            resultado: resultadoDoPrint, dctfwebLido: true, eventosNaoLidos: [],
            eventosSemValor: eventosComValorNaoLido([ev('R-9015', true)]),
        });
        expect(d.motivo).toBe('Reinf e DCTFWeb não batem em INSS — confira e corrija antes de emitir o DARF.');
    });
});
