// ============================================================================
// 🚨 O DARF CONHECIA UMA FORMA DE COMPETÊNCIA — e a ausência virava HOJE
//
// `parseCompetencia`, no construtor do payload do DARF, casava só `AAAA-MM`.
// As outras formas que o app usa DE VERDADE — `202607` (colagem de arquivo),
// `07/2026` (catálogo de obrigações e coleção de tarefas) e `AAAA-MM-DD` (a
// ficha financeira grava as duas) — caíam no `null`, e daí:
//
//   · `calcularVencimentoDarf` devolvia **`new Date()`** — a guia vencendo no
//     dia em que foi emitida, sobre débito de outro período;
//   · `periodoApuracaoSicalc`, duas linhas adiante, **lançava**.
//
// ⚠️ **É a ORDEM das duas chamadas que segurava o defeito.** Hoje a guia não
// sai com a data errada porque o segundo lança antes de alguém usar o
// vencimento — e não porque a data esteja certa. Trocar duas linhas de lugar
// tornaria isso um defeito vivo, e ele seria SILENCIOSO: ninguém confere data
// de vencimento a olho. É a família do `|| new Date()` do `.FML` (22/08).
//
// ✂️ O parse passou a usar o DONO das quatro formas, e a ausência devolve
// **null** — campo de data não recebe default. Quem monta a guia RECUSA com o
// motivo.
// ============================================================================
import {
    calcularVencimentoDarf, periodoApuracaoSicalc, montarPayloadDarfSerpro,
    // @ts-expect-error — módulo backend .js sem .d.ts
} from '../sefaz-backend/darf-payload-builder.js';

const hojeIso = () => new Date().toISOString().slice(0, 10);

describe('🚨 as quatro formas dizem a MESMA competência', () => {
    it('o vencimento sai igual venha a competência como vier', () => {
        const alvo = calcularVencimentoDarf('2026-07', 'IRPJ', 'mensal');
        for (const forma of ['202607', '07/2026', '2026-07-15']) {
            expect({ forma, v: calcularVencimentoDarf(forma, 'IRPJ', 'mensal') })
                .toEqual({ forma, v: alvo });
        }
    });

    it('e o período de apuração do SICALC também', () => {
        const alvo = periodoApuracaoSicalc('2026-07', 'PIS', 'mensal');
        for (const forma of ['202607', '07/2026', '2026-07-15']) {
            expect({ forma, pa: periodoApuracaoSicalc(forma, 'PIS', 'mensal') })
                .toEqual({ forma, pa: alvo });
        }
    });

    it('o trimestral continua caindo no trimestre certo', () => {
        expect(periodoApuracaoSicalc('07/2026', 'IRPJ', 'trimestral'))
            .toEqual({ tipoPA: 'TR', dataPA: '03/2026' });
    });
});

describe('🚨 competência ilegível NÃO vira a data de hoje', () => {
    it('o vencimento devolve null, nunca HOJE', () => {
        for (const lixo of ['', 'julho', '2026-13', null, undefined]) {
            const v = calcularVencimentoDarf(lixo as any, 'IRPJ', 'mensal');
            expect({ lixo, v }).toEqual({ lixo, v: null });
            expect(v).not.toBe(hojeIso());
        }
    });

    it('e a guia NÃO SAI — a recusa diz o que faltou', () => {
        expect(() => montarPayloadDarfSerpro({
            empresaCnpj: '31947349000169', competencia: 'julho', valor: 1000,
            regime: 'Presumido', tributo: 'IRPJ', periodicidade: 'trimestral',
        })).toThrow(/competencia inválida/i);
    });

    // A régua não pode quebrar o caminho normal.
    it('com competência legível a guia é montada', () => {
        const p = montarPayloadDarfSerpro({
            empresaCnpj: '31947349000169', competencia: '2026-06', valor: 1000,
            regime: 'Presumido', tributo: 'IRPJ', periodicidade: 'trimestral',
        });
        expect(p).toBeTruthy();
    });
});
