/**
 * Testes da lógica pura do radar fiscal (caixa postal).
 * Captura regressão nas regras de classificação e score 0-100.
 */
import {
    classificarUrgencia, calcularRisco, diasEntre, parseDate,
    CRITICAS, ALTAS, MEDIAS,
} from '../services/caixaPostalRadarLogic';

describe('classificarUrgencia — taxonomia fiscal', () => {
    it('CRITICAS: intimação RFB, malha, exclusão Simples, auto infração, citação judicial', () => {
        expect(classificarUrgencia('intimacao')).toBe('critica');
        expect(classificarUrgencia('malha')).toBe('critica');
        expect(classificarUrgencia('exclusao')).toBe('critica');
        expect(classificarUrgencia('det_auto_infracao')).toBe('critica');
        expect(classificarUrgencia('dje_citacao')).toBe('critica');
    });

    it('ALTAS: DEC/DJE intimação, EMac SP, ISS prefeitura', () => {
        expect(classificarUrgencia('dec_intimacao')).toBe('alta');
        expect(classificarUrgencia('dje_intimacao')).toBe('alta');
        expect(classificarUrgencia('emac_notificacao')).toBe('alta');
        expect(classificarUrgencia('prefeitura_sp_iss')).toBe('alta');
    });

    it('MEDIAS: notificação DET (requer ciência)', () => {
        expect(classificarUrgencia('det_notificacao')).toBe('media');
    });

    it('BAIXAS: informativo, comunicado DEC, NFSe SP, comunicado SP', () => {
        expect(classificarUrgencia('informativo')).toBe('baixa');
        expect(classificarUrgencia('dec_comunicado')).toBe('baixa');
        expect(classificarUrgencia('prefeitura_sp_nfse')).toBe('baixa');
        expect(classificarUrgencia('prefeitura_sp_comunicado')).toBe('baixa');
    });

    it('categoria desconhecida → baixa (não inventa urgência)', () => {
        expect(classificarUrgencia('coisa_nova')).toBe('baixa');
        expect(classificarUrgencia('')).toBe('baixa');
    });

    it('sets exportados são mutuamente exclusivos', () => {
        for (const c of CRITICAS) expect(ALTAS.has(c) || MEDIAS.has(c)).toBe(false);
        for (const c of ALTAS) expect(CRITICAS.has(c) || MEDIAS.has(c)).toBe(false);
        for (const c of MEDIAS) expect(CRITICAS.has(c) || ALTAS.has(c)).toBe(false);
    });
});

describe('calcularRisco — score 0-100', () => {
    it('crítica recém-chegada, sem prazo: 60 (só base)', () => {
        expect(calcularRisco({ urgencia: 'critica', diasParado: 0, diasParaPrazo: null })).toBe(60);
    });

    it('crítica há 10 dias, sem prazo: 60 + 10 = 70', () => {
        expect(calcularRisco({ urgencia: 'critica', diasParado: 10, diasParaPrazo: null })).toBe(70);
    });

    it('idade cap em 30 dias — crítica há 100 dias: 60 + 30 = 90 (sem prazo)', () => {
        expect(calcularRisco({ urgencia: 'critica', diasParado: 100, diasParaPrazo: null })).toBe(90);
    });

    it('crítica com prazo VENCIDO → +50 (cap 100)', () => {
        // 60 base + 5 idade + 50 vencido = 115 → cap 100
        expect(calcularRisco({ urgencia: 'critica', diasParado: 5, diasParaPrazo: -3 })).toBe(100);
    });

    it('alta vence amanhã (≤1d) → +30', () => {
        // 40 base + 2 idade + 30 = 72
        expect(calcularRisco({ urgencia: 'alta', diasParado: 2, diasParaPrazo: 1 })).toBe(72);
    });

    it('alta vence em 5 dias → +15', () => {
        // 40 + 1 + 15 = 56
        expect(calcularRisco({ urgencia: 'alta', diasParado: 1, diasParaPrazo: 5 })).toBe(56);
    });

    it('alta vence em 6 dias → 0 bônus de prazo', () => {
        expect(calcularRisco({ urgencia: 'alta', diasParado: 1, diasParaPrazo: 6 })).toBe(41);
    });

    it('baixa, sem urgência → score mínimo 5', () => {
        expect(calcularRisco({ urgencia: 'baixa', diasParado: 0, diasParaPrazo: null })).toBe(5);
    });

    it('diasParado negativo (mensagem do futuro?) → tratado como 0', () => {
        expect(calcularRisco({ urgencia: 'critica', diasParado: -5, diasParaPrazo: null })).toBe(60);
    });

    it('ordering: crítica vencida > alta vencida > média vencida > baixa vencida', () => {
        const crit = calcularRisco({ urgencia: 'critica', diasParado: 0, diasParaPrazo: -1 });
        const alta = calcularRisco({ urgencia: 'alta', diasParado: 0, diasParaPrazo: -1 });
        const med = calcularRisco({ urgencia: 'media', diasParado: 0, diasParaPrazo: -1 });
        const baixa = calcularRisco({ urgencia: 'baixa', diasParado: 0, diasParaPrazo: -1 });
        expect(crit).toBeGreaterThan(alta);
        expect(alta).toBeGreaterThan(med);
        expect(med).toBeGreaterThan(baixa);
    });
});

describe('diasEntre — diferença em dias', () => {
    it('mesma data → 0', () => {
        const d = new Date('2026-06-06T12:00:00Z');
        expect(diasEntre(d, d)).toBe(0);
    });

    it('diasEntre(antes, depois) = positivo (dias passados)', () => {
        const antes = new Date('2026-06-01T12:00:00Z');
        const depois = new Date('2026-06-06T12:00:00Z');
        expect(diasEntre(antes, depois)).toBe(5);
    });

    it('diasEntre(depois, antes) = negativo', () => {
        const antes = new Date('2026-06-01T12:00:00Z');
        const depois = new Date('2026-06-06T12:00:00Z');
        expect(diasEntre(depois, antes)).toBe(-5);
    });
});

describe('parseDate — defensivo', () => {
    it('ISO válido → Date', () => {
        const d = parseDate('2026-06-06T12:00:00Z');
        expect(d).toBeInstanceOf(Date);
        expect(d!.getUTCFullYear()).toBe(2026);
    });

    it('null / undefined / string vazia → null', () => {
        expect(parseDate(null)).toBeNull();
        expect(parseDate(undefined)).toBeNull();
        expect(parseDate('')).toBeNull();
    });

    it('string inválida → null (não NaN Date)', () => {
        expect(parseDate('não-é-data')).toBeNull();
        expect(parseDate('2026-13-99')).toBeNull();
    });
});
