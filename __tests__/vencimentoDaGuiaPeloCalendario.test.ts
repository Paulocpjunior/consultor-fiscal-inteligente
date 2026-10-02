import { readFileSync } from 'fs';
import { join } from 'path';
import { vencimentoMunicipalDaGuia } from '../sefaz-backend/vencimento-da-guia.js';
import { montarEmailGuia } from '../sefaz-backend/email-layout.js';

/**
 * 02/10 — Paulo, com o e-mail da RÁDIO E TV IBIRAPUERA ("Vencimento:
 * 10/10/2026") e o calendário de Configurações: "eu achava que o vencimento
 * no template mudava conforme o calendário". A aba ISS SP carimbava "dia 10"
 * fixo; 10/10/2026 é SÁBADO e a política da casa é antecipar (09/10).
 *
 * Fatos cobrados: a data sai do calendário do MUNICÍPIO, com o ajuste de dia
 * não útil; sem calendário não há data; o e-mail mostra DD/MM/AAAA.
 */
const SP = { codMunIBGE: '3550308', municipioNome: 'SÃO PAULO', obrigacao: 'ISS', diaVencimento: 10, mesesApos: 1, ajusteDiaNaoUtil: 'antecipa', baseLegal: 'Decreto Municipal nº 53.151/2012', ativo: true };
const BSB = { codMunIBGE: '5300108', municipioNome: 'Brasília', obrigacao: 'ISS', diaVencimento: 20, mesesApos: 1, ajusteDiaNaoUtil: 'antecipa', baseLegal: 'Decreto Distrital nº 38.685/2017', ativo: true };

describe('vencimento da guia pelo calendário do município', () => {
    it('SP 09/2026: dia 10/10 é sábado — antecipa para sexta 09/10', () => {
        const r = vencimentoMunicipalDaGuia({ cadastros: [SP, BSB], codMunIBGE: '3550308', competencia: '2026-09' });
        expect(r).toMatchObject({ achou: true, data: '2026-10-09', dataBr: '09/10/2026' });
    });

    it('Brasília usa o calendário DELA (dia 20), não o de SP', () => {
        const r = vencimentoMunicipalDaGuia({ cadastros: [SP, BSB], codMunIBGE: '5300108', competencia: '2026-09' });
        expect(r).toMatchObject({ achou: true, data: '2026-10-20' });
    });

    it('município sem calendário: não há data, e o motivo diz onde cadastrar', () => {
        const r = vencimentoMunicipalDaGuia({ cadastros: [SP], codMunIBGE: '4106902', competencia: '2026-09' });
        expect(r.achou).toBe(false);
        if (!r.achou) expect(r.motivo).toMatch(/Configurações/);
    });

    it('empresa sem município no cadastro: não há data', () => {
        expect(vencimentoMunicipalDaGuia({ cadastros: [SP], codMunIBGE: '', competencia: '2026-09' }).achou).toBe(false);
    });
});

describe('o e-mail da guia mostra a data no formato do cliente', () => {
    it('selo com DD/MM/AAAA, nunca AAAA-MM-DD', () => {
        const html: string = montarEmailGuia({
            tipo: 'ISS', empresaNome: 'RADIO E TV IBIRAPUERA LTDA', competencia: '2026-09',
            mensagem: 'Segue a guia.', temPdf: true, vencimento: '2026-10-09', geradoEm: '02/10/2026',
        });
        expect(html).toMatch(/09\/10\/2026/);
        expect(html).not.toMatch(/2026-10-09/);
    });
});

describe('a aba ISS SP não carimba mais o dia fixo', () => {
    it('o painel não lê o "dia 10" fixo da apuração para vencimento', () => {
        const src = readFileSync(join(__dirname, '..', 'components', 'xml', 'IssSpPanel.tsx'), 'utf8');
        expect(src).not.toMatch(/apuracao\.vencimento/);
        expect(src).toMatch(/vencimentoDaGuia\(/);
    });
});
