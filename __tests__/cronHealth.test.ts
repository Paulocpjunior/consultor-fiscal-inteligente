/**
 * Testes da observabilidade dos crons (cron-health).
 * Classificação pura: ok / atrasado / travado / falha / sem-dados.
 */
// @ts-expect-error — módulo .js puro
import { tsToMillis, normalizarEntradaLog, classificarSaudeCron, coletarSaudeCrons, CRON_LOG_COLLECTIONS, decidirAlertaCron } from '../sefaz-backend/cron-health.js';

const H = 3_600_000;
const AGORA = 1_700_000_000_000;

describe('tsToMillis — formatos variados de timestamp', () => {
    it('epoch ms, ISO string, Firestore Timestamp e {seconds}', () => {
        expect(tsToMillis(AGORA)).toBe(AGORA);
        expect(tsToMillis('2023-11-14T22:13:20.000Z')).toBe(Date.parse('2023-11-14T22:13:20.000Z'));
        expect(tsToMillis({ toMillis: () => AGORA })).toBe(AGORA);
        expect(tsToMillis({ seconds: 1700 })).toBe(1_700_000);
        expect(tsToMillis({ _seconds: 1700 })).toBe(1_700_000);
        expect(tsToMillis(null)).toBeNull();
        expect(tsToMillis('lixo')).toBeNull();
    });
});

describe('classificarSaudeCron', () => {
    const base = { collection: 'x_cron_logs', label: 'X', maxIdleHoras: 48 };

    it('rodou há pouco e sucesso → ok', () => {
        const e = { ...base, tsMs: AGORA - 2 * H, status: 'sucesso' };
        expect(classificarSaudeCron(e, AGORA).saude).toBe('ok');
    });

    it('sem timestamp (nunca logou) → sem-dados', () => {
        expect(classificarSaudeCron({ ...base, tsMs: null }, AGORA).saude).toBe('sem-dados');
    });

    it('último run acima do maxIdle → atrasado', () => {
        const e = { ...base, tsMs: AGORA - 60 * H, status: 'sucesso' };
        const r = classificarSaudeCron(e, AGORA);
        expect(r.saude).toBe('atrasado');
        expect(r.idadeHoras).toBe(60);
    });

    it("status 'iniciado' órfão (> 2h) → travado", () => {
        const e = { ...base, tsMs: AGORA - 5 * H, status: 'iniciado' };
        expect(classificarSaudeCron(e, AGORA).saude).toBe('travado');
    });

    it("status 'iniciado' recente (< 2h) → ok (rodando agora)", () => {
        const e = { ...base, tsMs: AGORA - 0.5 * H, status: 'iniciado' };
        expect(classificarSaudeCron(e, AGORA).saude).toBe('ok');
    });

    it("status 'falha' → falha, independente da idade", () => {
        const e = { ...base, tsMs: AGORA - 1 * H, status: 'falha' };
        expect(classificarSaudeCron(e, AGORA).saude).toBe('falha');
    });
});

describe('normalizarEntradaLog — campos variáveis', () => {
    it('usa tsField do registro e soma resumo; durationMs alternativo', () => {
        const reg = { collection: 'manifestacoes_cron_logs', label: 'Manif.', tsField: 'iniciadoEm', maxIdleHoras: 48 };
        const data = { iniciadoEm: AGORA, durationMs: 1234, sucessos: 10, falhas: 2, ignorado: 'x' };
        const n = normalizarEntradaLog(reg, data);
        expect(n.tsMs).toBe(AGORA);
        expect(n.duracaoMs).toBe(1234);
        expect(n.resumo).toEqual({ sucessos: 10, falhas: 2 });
        expect(n.status).toBe('sucesso'); // sem campo status → assume sucesso
    });

    it('doc nulo (coleção vazia) → tsMs null', () => {
        const reg = { collection: 'x', label: 'X', tsField: 'executadoEm', maxIdleHoras: 48 };
        expect(normalizarEntradaLog(reg, null).tsMs).toBeNull();
    });
});

describe('coletarSaudeCrons — agrega e ordena por severidade', () => {
    // Stub de Firestore: devolve um doc canned por coleção.
    const makeDb = (porColecao: Record<string, any>) => ({
        collection: (name: string) => ({
            orderBy: () => ({
                limit: () => ({
                    get: async () => {
                        const data = porColecao[name];
                        return data
                            ? { empty: false, docs: [{ data: () => data }] }
                            : { empty: true, docs: [] };
                    },
                }),
            }),
        }),
    });

    it('ordena falha/travado antes de ok, e conta problemas', async () => {
        const db = makeDb({
            sefaz_cron_logs: { executadoEm: AGORA - 1 * H, status: 'falha' },
            das_cron_logs: { executadoEm: AGORA - 1 * H },            // ok
            manifestacoes_cron_logs: { iniciadoEm: AGORA - 5 * H, status: 'iniciado' }, // travado
        });
        const r = await coletarSaudeCrons(db, AGORA);
        expect(r.totalCrons).toBe(CRON_LOG_COLLECTIONS.length);
        expect(r.problemas).toBe(2); // falha + travado
        // Primeira linha é a de pior severidade (falha).
        expect(r.linhas[0].saude).toBe('falha');
        // Coleções sem doc viram 'sem-dados'.
        expect(r.linhas.some((l: any) => l.saude === 'sem-dados')).toBe(true);
    });

    it('erro de leitura numa coleção não derruba o resto', async () => {
        const db = {
            collection: (name: string) => ({
                orderBy: () => ({
                    limit: () => ({
                        get: async () => {
                            if (name === 'das_cron_logs') throw new Error('index building');
                            return { empty: false, docs: [{ data: () => ({ executadoEm: AGORA }) }] };
                        },
                    }),
                }),
            }),
        };
        const r = await coletarSaudeCrons(db, AGORA);
        expect(r.linhas.some((l: any) => l.saude === 'erro-leitura')).toBe(true);
        expect(r.linhas.some((l: any) => l.saude === 'ok')).toBe(true);
    });
});

describe('decidirAlertaCron — anti-spam por assinatura', () => {
    const saudeCom = (...cols: string[]) => ({
        linhas: cols.map(c => ({ collection: c, label: c, saude: 'falha' })),
    });

    it('sem problema → não alerta', () => {
        const r = decidirAlertaCron({ linhas: [{ collection: 'x', saude: 'ok' }] }, null, '2026-07-19');
        expect(r.alertar).toBe(false);
        expect(r.problemas).toHaveLength(0);
    });

    it("'atrasado' (amarelo) NÃO alerta — só falha/travado", () => {
        const r = decidirAlertaCron({ linhas: [{ collection: 'x', saude: 'atrasado' }] }, null, '2026-07-19');
        expect(r.alertar).toBe(false);
    });

    it('problema novo (sem estado anterior) → alerta', () => {
        const r = decidirAlertaCron(saudeCom('das_cron_logs'), null, '2026-07-19');
        expect(r.alertar).toBe(true);
        expect(r.assinatura).toBe('das_cron_logs');
    });

    it('mesma assinatura no MESMO dia → não re-alerta (anti-spam)', () => {
        const r = decidirAlertaCron(saudeCom('das_cron_logs'), { assinatura: 'das_cron_logs', data: '2026-07-19' }, '2026-07-19');
        expect(r.alertar).toBe(false);
    });

    it('mesma assinatura em dia DIFERENTE → re-alerta (persistente, 1x/dia)', () => {
        const r = decidirAlertaCron(saudeCom('das_cron_logs'), { assinatura: 'das_cron_logs', data: '2026-07-18' }, '2026-07-19');
        expect(r.alertar).toBe(true);
    });

    it('assinatura MUDOU (novo cron entrou em falha) no mesmo dia → alerta na hora', () => {
        const r = decidirAlertaCron(
            saudeCom('das_cron_logs', 'dctfweb_cron_logs'),
            { assinatura: 'das_cron_logs', data: '2026-07-19' },
            '2026-07-19',
        );
        expect(r.alertar).toBe(true);
        expect(r.assinatura).toBe('das_cron_logs,dctfweb_cron_logs'); // ordenada
    });

    it('travado também conta como problema', () => {
        const r = decidirAlertaCron({ linhas: [{ collection: 'y', saude: 'travado' }] }, null, '2026-07-19');
        expect(r.alertar).toBe(true);
        expect(r.problemas).toHaveLength(1);
    });
});
