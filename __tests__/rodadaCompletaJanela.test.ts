// ============================================================================
// 🚦 A JANELA DA RODADA COMPLETA DE CAPTURA (25/09, "erro insistente hoje")
//
// 06:00 agendada interrompida pelo deploy → 06:32 retomada refaz a carteira
// → 109 falhas. 13:49 retomada → 14:19 outra rodada completa → 147 de 147
// falhas em 4,6 s por empresa: a trava de 1 h por CNPJ, não a SEFAZ.
// As asserções cobram o FATO (recusa, classe, contagem), nunca a redação.
// ============================================================================
import {
    janelaDaRodadaCompleta, ehRodadaCompleta, fonteRetomavel, classificarResultado,
    codigoDoResultado, resumoDaRodada, causaDominante, JANELA_RODADA_COMPLETA_MS,
} from '../sefaz-backend/rodada-completa-janela.js';

const T0 = Date.parse('2026-09-25T16:49:18Z'); // 13:49:18 BRT — a retomada do dia
const min = (n: number) => n * 60_000;

describe('trava 1 — rodada completa dentro da janela é recusada', () => {
    it('42 s depois do início da rodada anterior: recusa, com quanto falta', () => {
        const logs = [{ fonte: 'retomada:sefaz-xml-capture', iniciadoEm: new Date(T0).toISOString(), status: 'sucesso', totalEmpresas: 147 }];
        const r = janelaDaRodadaCompleta({ logs, agoraMs: T0 + min(30) });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.faltaMin).toBe(30);
        expect(r.ultimaInicioMs).toBe(T0);
    });

    it('1 h depois do início: libera', () => {
        const logs = [{ fonte: 'sefaz-xml-capture', iniciadoEm: new Date(T0).toISOString(), status: 'sucesso' }];
        expect(janelaDaRodadaCompleta({ logs, agoraMs: T0 + JANELA_RODADA_COMPLETA_MS }).ok).toBe(true);
    });

    // A janela é medida do INÍCIO: uma rodada de 44 min que acabou de terminar
    // ainda deixa cada CNPJ dentro do lock — o que aconteceu às 14:19.
    it('rodada interrompida ou em andamento também conta — o lock por CNPJ já foi tomado', () => {
        const logs = [{ fonte: 'admin-manual', iniciadoEm: new Date(T0).toISOString(), status: 'interrompido' }];
        expect(janelaDaRodadaCompleta({ logs, agoraMs: T0 + min(5) }).ok).toBe(false);
    });

    it('drenagem (10 alvos), dirigida e auto-preencher NÃO são rodada completa', () => {
        const logs = [
            { fonte: 'sefaz-drenagem-cron', iniciadoEm: new Date(T0).toISOString() },
            { fonte: 'admin-dirigida', iniciadoEm: new Date(T0).toISOString() },
            { tipo: 'auto-preencher-uf', fonte: 'ana@x', executadoEm: new Date(T0).toISOString() },
        ];
        expect(logs.map(ehRodadaCompleta)).toEqual([false, false, false]);
        expect(janelaDaRodadaCompleta({ logs, agoraMs: T0 + min(1) }).ok).toBe(true);
    });

    it('a rodada mais RECENTE decide, em qualquer ordem da lista', () => {
        const logs = [
            { fonte: 'sefaz-cron-noturno', iniciadoEm: new Date(T0 - min(600)).toISOString() },
            { fonte: 'admin-manual', iniciadoEm: new Date(T0).toISOString() },
        ];
        expect(janelaDaRodadaCompleta({ logs, agoraMs: T0 + min(10) }).ok).toBe(false);
        expect(janelaDaRodadaCompleta({ logs: [...logs].reverse(), agoraMs: T0 + min(10) }).ok).toBe(false);
    });

    it('lê Timestamp do Firestore e log antigo sem fonte (pela contagem)', () => {
        const logs = [{ totalEmpresas: 147, executadoEm: { toMillis: () => T0 } }];
        expect(janelaDaRodadaCompleta({ logs, agoraMs: T0 + min(10) }).ok).toBe(false);
        expect(janelaDaRodadaCompleta({ logs: [], agoraMs: T0 }).ok).toBe(true);
        expect(janelaDaRodadaCompleta({ logs: undefined, agoraMs: T0 }).ok).toBe(true);
    });
});

describe('trava 2 — retomada só do agendado; empresa já alcançada é janela, não falha', () => {
    it('fonte manual não é retomável; agendada e retomada são', () => {
        expect(fonteRetomavel('admin-manual')).toBe(false);
        expect(fonteRetomavel('admin-dirigida')).toBe(false);
        expect(fonteRetomavel('sefaz-xml-capture')).toBe(true);
        expect(fonteRetomavel('sefaz-cron-noturno')).toBe(true);
        expect(fonteRetomavel('retomada:sefaz-xml-capture')).toBe(true);
        expect(fonteRetomavel(undefined)).toBe(true); // log antigo sem fonte = agendado
    });

    it('lock vivo (consultada há menos de 1 h) é pulada-janela; o resto é falha ou sucesso', () => {
        expect(classificarResultado({ ok: true, novosXmls: 3 })).toBe('sucesso');
        expect(classificarResultado({ ok: false, locked: true, motivo: 'Já sincronizado às 13:50' })).toBe('pulada-janela');
        expect(classificarResultado({ ok: false, rateLimited: true })).toBe('falha');
        expect(classificarResultado({ ok: false, semCert: true })).toBe('falha');
        expect(classificarResultado(null)).toBe('falha');
    });

    it('o código curto nomeia a causa', () => {
        expect(codigoDoResultado({ rateLimited: true })).toBe('cStat=656');
        expect(codigoDoResultado({ certInvalido: true })).toBe('cStat=593');
        expect(codigoDoResultado({ semCert: true })).toBe('SEM_CERT');
        expect(codigoDoResultado({ locked: true })).toBe('JANELA');
        expect(codigoDoResultado({})).toBeNull();
    });
});

describe('trava 3 — o resumo diz a causa dominante e separa pulada de falha', () => {
    it('falhas com a causa mais frequente', () => {
        const errosResumo = [
            { codigo: 'SEM_CERT', motivo: 'Empresa aguardando certificado A1' },
            { codigo: 'SEM_CERT', motivo: 'Empresa aguardando certificado A1' },
            { codigo: null, motivo: 'UF não cadastrada' },
        ];
        expect(causaDominante(errosResumo)).toMatch(/^2× SEM_CERT/);
        const t = resumoDaRodada({ totalEmpresas: 147, sucessos: 119, falhas: 28, totalNovosXmls: 344, errosResumo });
        expect(t).toMatch(/344/);
        expect(t).toMatch(/28 falha/);
        expect(t).toMatch(/SEM_CERT/);
        expect(t).not.toMatch(/pulada/);
    });

    it('puladas pela janela saem contadas e ditas como não-falha', () => {
        const t = resumoDaRodada({ totalEmpresas: 147, sucessos: 0, falhas: 0, puladasJanela: 147, totalNovosXmls: 0 });
        expect(t).toMatch(/147 pulada/);
        expect(t).not.toMatch(/falha\(s\)/);
        expect(causaDominante([])).toBe('');
        expect(causaDominante(null)).toBe('');
    });
});
