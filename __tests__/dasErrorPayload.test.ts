// @ts-nocheck — módulo .js do backend (sem tipos)
import { errorPayload } from '../sefaz-backend/das-error-payload.js';


/**
 * MENSAGEM ESCRITA PRO USUÁRIO PASSA INTEIRA (12/08).
 *
 * Paulo tentou declarar sem movimento e recebeu "Não foi possível declarar:
 * Erro interno (ref d65adb41)". A recusa traduzida tem 485 caracteres — o
 * sanitizador corta acima de 300 e apagou a orientação inteira, inclusive o
 * "entregue no e-CAC pra não correr a MAED".
 *
 * Sanitizador que engole a AÇÃO é pior que erro nenhum: some a única coisa que
 * a pessoa poderia fazer.
 */
describe('mensagemUsuario — o carimbo de "isto foi redigido para ser lido"', () => {
    const longa = 'x'.repeat(500);

    it('mensagem longa SEM o carimbo continua sendo sanitizada', () => {
        const err: any = new Error(longa);
        expect(errorPayload(err).error).toMatch(/Erro interno \(ref/);
    });

    it('mensagem longa COM o carimbo passa inteira', () => {
        const err: any = new Error(longa);
        err.mensagemUsuario = longa;
        expect(errorPayload(err).error).toBe(longa);
    });

    it('a recusa da declaração sem movimento chega com a AÇÃO preservada', () => {
        const texto = 'O SN-Entregar recusou a declaração sem movimento: ele exige atividade com valor '
            + 'maior que zero, e mês sem faturamento não tem nenhuma. A forma correta da declaração '
            + 'sem movimento ainda não está confirmada neste app — nada foi transmitido. '
            + 'Entregue ESTA competência no e-CAC (PGDAS-D → Declarar → sem movimento) para não '
            + 'correr a MAED de R$ 50,00.';
        expect(texto.length).toBeGreaterThan(300);   // é longa mesmo
        const err: any = new Error(texto);
        err.code = 'MSG_ISN_023';
        err.mensagemUsuario = texto;
        const p = errorPayload(err);
        expect(p.error).toMatch(/e-CAC/);
        expect(p.error).toMatch(/MAED/);
        expect(p.code).toBe('MSG_ISN_023');
    });
});
