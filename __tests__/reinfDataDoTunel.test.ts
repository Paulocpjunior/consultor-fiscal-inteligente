// ============================================================================
// 🚨 A DATA ATRAVESSAVA O TÚNEL CRUA — e o R-4020 recusava do outro lado
//
// 02/09, print do Paulo no Consultor Contábil:
//   "Nenhum beneficiário pôde ser convertido em evento"
//   "ELEVADORES ATLAS SCHINDLER LTDA. — R-4020 inválido:
//    - pagamentos[0].dtFG deve ser AAAA-MM-DD"
//
// 📌 O `dhEmi` chega em TRÊS formas neste app — `2026-08-14T08:35:36-03:00`
// (XML ABRASF), `11/05/2026 14:31:31` (portal de SP) e Timestamp do Firestore
// — e o túnel mandava `texto(...)`, ou seja o que estivesse lá.
//
// ⚠️ E o comentário no topo do próprio módulo já dizia que **ler as duas formas
// do documento é o serviço que este túnel presta**, porque quem conhece a forma
// do documento é o CFI. A data ficou de fora dessa promessa.
//
// 🔒 O erro tem lados de custo diferente: data ilegível vira **null** (o evento
// é recusado, que é ruidoso mas seguro); data CHUTADA vira evento **aceito**
// declarando o fato gerador em outra competência — e a Receita não devolve.
// ============================================================================
import { normalizarNotaTomada } from '../sefaz-backend/reinf-retencoes-pj.js';
import { normalizarServicoTomado } from '../sefaz-backend/reinf-servicos-tomados.js';
import { normalizarAquisicao } from '../sefaz-backend/reinf-aquisicao-rural.js';

describe('R-4020 — dtFG sai em AAAA-MM-DD, venha o documento como vier', () => {
    it('XML ABRASF com hora e fuso', () => {
        const n = normalizarNotaTomada({ dhEmi: '2026-08-14T08:35:36.658-03:00' });
        expect(n.dataFatoGerador).toBe('2026-08-14');
    });

    // 🚨 A forma do portal de SP — e o dia NÃO pode virar mês: o `new Date` do
    // JS lê `11/05/2026` como 5 de NOVEMBRO (a régua de 22/08).
    it('portal de SP, na forma brasileira, sem trocar dia por mês', () => {
        const n = normalizarNotaTomada({ dhEmi: '11/05/2026 14:31:31' });
        expect(n.dataFatoGerador).toBe('2026-05-11');
    });

    it('Timestamp do Firestore', () => {
        const n = normalizarNotaTomada({ dhEmi: { toDate: () => new Date(Date.UTC(2026, 7, 14)) } });
        expect(n.dataFatoGerador).toBe('2026-08-14');
    });

    // ⚠️ `dataFatoGerador` explícito continua vencendo o `dhEmi`.
    it('o campo explícito vence, e também sai normalizado', () => {
        const n = normalizarNotaTomada({ dataFatoGerador: '05/09/2026', dhEmi: '2026-08-14' });
        expect(n.dataFatoGerador).toBe('2026-09-05');
    });

    // 🚨 Ilegível é NULL, nunca a data de hoje: fato gerador chutado é evento
    // ACEITO declarando outra competência — o pior desfecho, porque não volta.
    it('ilegível vira null, não a data de hoje', () => {
        expect(normalizarNotaTomada({ dhEmi: 'nao é data' }).dataFatoGerador).toBeNull();
        expect(normalizarNotaTomada({}).dataFatoGerador).toBeNull();
    });
});

describe('R-2010 — a mesma correção, no mesmo dia', () => {
    it('dtEmissao sai em AAAA-MM-DD nas três formas', () => {
        expect(normalizarServicoTomado({ dhEmi: '2026-08-14T08:35:36-03:00' }).dtEmissao).toBe('2026-08-14');
        expect(normalizarServicoTomado({ dhEmi: '11/05/2026 14:31:31' }).dtEmissao).toBe('2026-05-11');
        expect(normalizarServicoTomado({ dhEmi: 'lixo' }).dtEmissao).toBeNull();
    });
});

// 🔎 O TERCEIRO TÚNEL DO REINF — achado pela VARREDURA, não pela minha memória.
// Eu ia corrigir os dois que o print nomeou; quem achou o R-2055 (e a NFTS) foi
// `dataDoTunelPassaPeloDono.test.ts`. É a lição de 13/08 outra vez: trava por
// LISTA cobre o que eu lembrei, e o que eu lembrava era metade.
describe('R-2055 — a aquisição de produção rural, o terceiro do mesmo dia', () => {
    it('a data do fato gerador sai em AAAA-MM-DD nas três formas', () => {
        expect(normalizarAquisicao({ dhEmi: '2026-08-14T08:35:36-03:00' }).data).toBe('2026-08-14');
        expect(normalizarAquisicao({ dhEmi: '11/05/2026 14:31:31' }).data).toBe('2026-05-11');
        expect(normalizarAquisicao({ dhEmi: { toDate: () => new Date(Date.UTC(2026, 7, 14)) } }).data)
            .toBe('2026-08-14');
    });

    // ⚠️ Ilegível é null e a aquisição é RECUSADA do outro lado — ruidoso e
    // seguro. Chutar a data de hoje declararia o FUNRURAL noutra competência.
    it('ilegível vira null, não a data de hoje', () => {
        expect(normalizarAquisicao({ dhEmi: 'nao é data' }).data).toBeNull();
        expect(normalizarAquisicao({}).data).toBeNull();
    });
});
