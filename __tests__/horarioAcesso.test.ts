/**
 * Trava de horário de funcionamento (Paulo, 10/08): seg–sex 07–20 padrão,
 * admin sempre passa, exceções por colaborador, bloqueio armado por env.
 *
 * O que os testes trancam:
 * 1. A régua no FUSO de São Paulo (o servidor roda em UTC) — 20h30 BRT bloqueia
 *    mesmo sendo 23h30 UTC.
 * 2. Admin passa SEMPRE (válvula de escape) e a chave desarmada libera todos.
 * 3. Config torta cai no PADRÃO — nunca abre nem tranca tudo por acidente.
 * 4. Bloqueado DIZ quando libera (farol honesto).
 */
// @ts-nocheck
import {
    decidirAcessoHorario, momentoEmSaoPaulo, normalizarConfig, travaArmada,
} from '../sefaz-backend/horario-acesso.js';

// Helper: uma Date que, em São Paulo (UTC-3), cai no dia/hora desejados.
// Ex.: quero segunda 09:00 BRT → 12:00 UTC na mesma data (2026-08-10 é segunda).
const spDate = (isoUtc: string) => new Date(isoUtc);

describe('momentoEmSaoPaulo (fuso, não o do servidor)', () => {
    test('12:00 UTC de uma segunda = 09:00 BRT, segunda', () => {
        const r = momentoEmSaoPaulo(spDate('2026-08-10T12:00:00Z')); // seg
        expect(r.diaSemana).toBe(1);
        expect(r.minutos).toBe(9 * 60);
    });
    test('23:30 UTC de segunda já é 20:30 BRT (mesma segunda, fora do horário)', () => {
        const r = momentoEmSaoPaulo(spDate('2026-08-10T23:30:00Z'));
        expect(r.diaSemana).toBe(1);
        expect(r.minutos).toBe(20 * 60 + 30);
    });
    test('02:00 UTC de sábado ainda é 23:00 BRT de SEXTA', () => {
        const r = momentoEmSaoPaulo(spDate('2026-08-15T02:00:00Z')); // sáb UTC
        expect(r.diaSemana).toBe(5); // sexta em SP
    });
});

const colaborador = { role: 'colaborador', email: 'x@y.com' };
const armado = { ativo: true };

describe('decidirAcessoHorario — padrão seg–sex 07–20', () => {
    test('segunda 09:00 BRT: liberado', () => {
        const r = decidirAcessoHorario(colaborador, { ...armado, agora: spDate('2026-08-10T12:00:00Z') });
        expect(r.permitido).toBe(true);
        expect(r.motivo).toBe('dentro-do-horario');
    });
    test('segunda 20:30 BRT: bloqueado, e diz que o expediente encerrou', () => {
        const r = decidirAcessoHorario(colaborador, { ...armado, agora: spDate('2026-08-10T23:30:00Z') });
        expect(r.permitido).toBe(false);
        expect(r.motivo).toBe('fora-do-horario');
        expect(r.mensagem).toMatch(/encerrou/);
        expect(r.mensagem).toMatch(/segunda a sexta, das 07:00 às 20:00/);
    });
    test('segunda 06:30 BRT: bloqueado — ainda não abriu', () => {
        const r = decidirAcessoHorario(colaborador, { ...armado, agora: spDate('2026-08-10T09:30:00Z') });
        expect(r.permitido).toBe(false);
        expect(r.mensagem).toMatch(/ainda não abriu/);
    });
    test('sábado no meio do dia: bloqueado — fora dos dias', () => {
        const r = decidirAcessoHorario(colaborador, { ...armado, agora: spDate('2026-08-15T15:00:00Z') });
        expect(r.permitido).toBe(false);
        expect(r.mensagem).toMatch(/fora dos dias|Sábado/i);
    });
});

describe('admin e chave-mestra', () => {
    test('admin passa mesmo às 23h de domingo', () => {
        const r = decidirAcessoHorario({ role: 'admin' }, { ...armado, agora: spDate('2026-08-17T02:00:00Z') });
        expect(r.permitido).toBe(true);
        expect(r.motivo).toBe('admin');
    });
    test('chave desarmada: colaborador passa fora do horário (montado, não armado)', () => {
        const r = decidirAcessoHorario(colaborador, { ativo: false, agora: spDate('2026-08-10T23:30:00Z') });
        expect(r.permitido).toBe(true);
        expect(r.motivo).toBe('trava-desarmada');
    });
    test('travaArmada lê a env', () => {
        expect(travaArmada({})).toBe(false);
        expect(travaArmada({ HORARIO_ACESSO_ATIVO: 'bloqueio' })).toBe(true);
        expect(travaArmada({ HORARIO_ACESSO_ATIVO: 'sim' })).toBe(false);
    });
});

describe('exceções por colaborador', () => {
    test('exceção 24h libera sábado de madrugada', () => {
        const user = { role: 'colaborador', horarioAcesso: { vale24h: true } };
        const r = decidirAcessoHorario(user, { ...armado, agora: spDate('2026-08-15T05:00:00Z') });
        expect(r.permitido).toBe(true);
    });
    test('exceção com sábado incluído e faixa maior', () => {
        const user = { role: 'colaborador', horarioAcesso: { dias: [1, 2, 3, 4, 5, 6], inicio: '06:00', fim: '22:00' } };
        const r = decidirAcessoHorario(user, { ...armado, agora: spDate('2026-08-15T15:00:00Z') }); // sáb 12h BRT
        expect(r.permitido).toBe(true);
    });
    test('config TORTA (fim antes do início) cai no padrão, não abre nem tranca tudo', () => {
        const cfg = normalizarConfig({ inicio: '20:00', fim: '07:00' });
        expect(cfg.inicio).toBe(7 * 60);
        expect(cfg.fim).toBe(20 * 60);
    });
    test('config vazia = padrão', () => {
        expect(normalizarConfig(null).inicio).toBe(7 * 60);
        expect(normalizarConfig({}).dias).toEqual([1, 2, 3, 4, 5]);
    });
});
