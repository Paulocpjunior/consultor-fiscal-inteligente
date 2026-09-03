/**
 * A RÉGUA DE PRAZO, num lugar só.
 *
 * As fronteiras (atrasada / hoje / amanhã / ≤3d / ≤7d) já existiam em DOIS
 * lugares escritos à mão — `vencimentosLogic.ts` e o `forEach` do
 * `vencimentos-orchestrator.js`. O guia do mês seria a terceira cópia. Duas
 * cópias da mesma régua é divergência esperando acontecer: mexer numa e
 * esquecer a outra faz a tela dizer "vence em 3 dias" enquanto o resumo diário
 * conta como "7 dias", e as duas parecem certas sozinhas.
 */
import { classificarUrgencia, urgenciaDominante, diasAteVencimento, URGENCIA_FAROL } from '../sefaz-backend/urgencia-vencimento';
import { classificarUrgenciaVencimento } from '../services/vencimentosLogic';

describe('fronteiras', () => {
    it.each([
        [-10, 'atrasada'], [-1, 'atrasada'],
        [0, 'hoje'], [1, 'amanha'],
        [2, '3d'], [3, '3d'],
        [4, '7d'], [7, '7d'],
        [8, 'futura'], [40, 'futura'],
    ])('%i dia(s) → %s', (dias, esperado) => {
        expect(classificarUrgencia(dias)).toBe(esperado);
    });

    it('dia não numérico vira "futura" — sem data não se inventa urgência', () => {
        expect(classificarUrgencia(NaN)).toBe('futura');
        expect(classificarUrgencia(undefined as any)).toBe('futura');
    });
});

describe('a porta TypeScript devolve o MESMO resultado', () => {
    // Se estas duas divergirem, a tela e o resumo diário voltam a discordar.
    it.each([-1, 0, 1, 2, 3, 4, 7, 8, 99])('dias = %i', (dias) => {
        expect(classificarUrgenciaVencimento(dias)).toBe(classificarUrgencia(dias));
    });
});

describe('farol: só "futura" é verde', () => {
    it('atraso e hoje são vermelhos', () => {
        expect(URGENCIA_FAROL.atrasada).toBe('vermelho');
        expect(URGENCIA_FAROL.hoje).toBe('vermelho');
    });

    it('amanhã até 7 dias é âmbar', () => {
        expect(URGENCIA_FAROL.amanha).toBe('ambar');
        expect(URGENCIA_FAROL['3d']).toBe('ambar');
        expect(URGENCIA_FAROL['7d']).toBe('ambar');
    });

    it('futura é verde', () => {
        expect(URGENCIA_FAROL.futura).toBe('verde');
    });
});

describe('dominante — a mais apertada manda', () => {
    it('atrasada vence tudo', () => {
        expect(urgenciaDominante(['futura', '7d', 'atrasada', 'hoje'])).toBe('atrasada');
    });

    it('entre âmbares, a mais próxima', () => {
        expect(urgenciaDominante(['7d', '3d'])).toBe('3d');
    });

    it('lista vazia é null, NUNCA "futura"', () => {
        // "futura" seria afirmar que está tudo tranquilo sem ter olhado nada.
        expect(urgenciaDominante([])).toBeNull();
        expect(urgenciaDominante(undefined as any)).toBeNull();
    });

    it('valor desconhecido é ignorado, não vira dominante', () => {
        expect(urgenciaDominante(['invalida', '7d'])).toBe('7d');
        expect(urgenciaDominante(['invalida'])).toBeNull();
    });
});

describe('dias até o vencimento contam DIA, não hora', () => {
    // 07/08/2026 em São Paulo: meio-dia e 23h30, respectivamente.
    const meioDoDia = new Date('2026-08-07T15:00:00Z').getTime();
    const fimDoDia = new Date('2026-08-08T02:30:00Z').getTime();

    it('vencer hoje às 23h ainda é HOJE, não "0,04 dias"', () => {
        expect(diasAteVencimento(new Date('2026-08-08T01:00:00Z'), meioDoDia)).toBe(0);
    });

    it('a mesma tarefa não muda de faixa ao longo do dia', () => {
        const venc = new Date('2026-08-10T12:00:00Z');
        expect(diasAteVencimento(venc, meioDoDia)).toBe(diasAteVencimento(venc, fimDoDia));
    });

    it('ontem é -1', () => {
        expect(diasAteVencimento(new Date('2026-08-06T10:00:00Z'), meioDoDia)).toBe(-1);
    });

    it('aceita Timestamp do Firestore', () => {
        const ts = { toDate: () => new Date('2026-08-09T12:00:00Z') };
        expect(diasAteVencimento(ts, meioDoDia)).toBe(2);
    });

    it('data pura preserva o dia fiscal mesmo perto da meia-noite UTC', () => {
        // 00:30 UTC ainda é 21:30 do dia anterior em São Paulo.
        const noiteAnteriorEmSp = new Date('2026-08-07T00:30:00Z').getTime();
        expect(diasAteVencimento('2026-08-07', noiteAnteriorEmSp)).toBe(1);
    });

    it('instantes usam explicitamente o calendário de São Paulo', () => {
        const noiteAnteriorEmSp = new Date('2026-08-07T00:30:00Z').getTime();
        expect(diasAteVencimento(new Date('2026-08-07T01:00:00Z'), noiteAnteriorEmSp)).toBe(0);
    });

    it('sem data legível devolve null — ausente ≠ futura', () => {
        expect(diasAteVencimento(null, meioDoDia)).toBeNull();
        expect(diasAteVencimento('não é data', meioDoDia)).toBeNull();
        expect(diasAteVencimento({ toDate: () => { throw new Error('x'); } }, meioDoDia)).toBeNull();
    });
});
