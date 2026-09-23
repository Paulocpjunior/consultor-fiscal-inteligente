/**
 * Testes da observabilidade dos crons (cron-health).
 * Classificação pura: ok / atrasado / travado / falha / sem-dados.
 */
// @ts-expect-error — módulo .js puro
import { tsToMillis, normalizarEntradaLog, classificarSaudeCron, coletarSaudeCrons, CRON_LOG_COLLECTIONS, decidirAlertaCron, decidirCuraOrfao } from '../sefaz-backend/cron-health.js';

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

    it("caso real 23/07: log concluído com 0 ok · 500 falhas → FALHA (era 'OK' verde-mentiroso)", () => {
        const e = { ...base, tsMs: AGORA - 0.2 * H, status: 'sucesso', resumo: { sucessos: 0, falhas: 500 } };
        expect(classificarSaudeCron(e, AGORA).saude).toBe('falha');
    });

    it('all-failed só dispara com falhas>0 — run vazio (0/0) continua ok', () => {
        const e = { ...base, tsMs: AGORA - 1 * H, status: 'sucesso', resumo: { sucessos: 0, falhas: 0 } };
        expect(classificarSaudeCron(e, AGORA).saude).toBe('ok');
    });

    it('com sucessos>0 e falhas>0 continua ok (parcial não é all-failed)', () => {
        const e = { ...base, tsMs: AGORA - 1 * H, status: 'sucesso', resumo: { sucessos: 60, falhas: 21 } };
        expect(classificarSaudeCron(e, AGORA).saude).toBe('ok');
    });
});

describe('auto-cura de run órfão (caso NFS-e SP 27/07: "travado há 9h" sem nada travado)', () => {
    const base = { collection: 'nfsesp_portal_cron_logs', label: 'NFS-e SP', maxIdleHoras: 48 };

    it('doc "iniciado" há 9h vira patch de interrompido com motivo acionável', () => {
        const r = decidirCuraOrfao({ status: 'iniciado', iniciadoEm: AGORA - 9 * H }, AGORA);
        expect(r.curar).toBe(true);
        expect(r.patch.status).toBe('interrompido');
        expect(r.patch.motivoInterrupcao).toMatch(/9h/);
        expect(r.patch.motivoInterrupcao).toMatch(/rode a captura de novo|aguarde/i);
    });

    it('run recente (< 2h) NÃO é curado — pode estar rodando agora', () => {
        expect(decidirCuraOrfao({ status: 'iniciado', iniciadoEm: AGORA - 1 * H }, AGORA).curar).toBe(false);
    });

    it('run concluído ou sem hora de início não é tocado', () => {
        expect(decidirCuraOrfao({ status: 'sucesso', iniciadoEm: AGORA - 9 * H }, AGORA).curar).toBe(false);
        expect(decidirCuraOrfao({ status: 'iniciado' }, AGORA).curar).toBe(false);
    });

    it("'interrompido' dentro da janela = âmbar; passou do maxIdle sem nova rodada = falha", () => {
        expect(classificarSaudeCron({ ...base, tsMs: AGORA - 9 * H, status: 'interrompido' }, AGORA).saude).toBe('interrompido');
        expect(classificarSaudeCron({ ...base, tsMs: AGORA - 60 * H, status: 'interrompido' }, AGORA).saude).toBe('falha');
    });

    it('motivo da interrupção aparece no card (motivoTop)', () => {
        const reg = { ...base, tsField: 'executadoEm' };
        const n = normalizarEntradaLog(reg, { executadoEm: AGORA, status: 'interrompido', motivoInterrupcao: 'Execução interrompida após 9h sem concluir (reinício do servidor).' });
        expect(n.motivoTop).toMatch(/interrompida/i);
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
    // `updates` (quando passado) recolhe as curas gravadas via doc.ref.update.
    const makeDb = (porColecao: Record<string, any>, updates?: Record<string, any>) => ({
        collection: (name: string) => ({
            orderBy: () => ({
                limit: () => ({
                    get: async () => {
                        const data = porColecao[name];
                        if (!data) return { empty: true, docs: [] };
                        const doc: any = { data: () => data };
                        // Sem `updates` o stub NÃO tem ref — simula o caso em que
                        // a cura não consegue gravar (deve continuar 'travado').
                        if (updates) doc.ref = { update: async (p: any) => { updates[name] = p; } };
                        return { empty: false, docs: [doc] };
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

    it('cura o órfão em disco: "iniciado" há 9h vira interrompido (âmbar), não travado eterno', async () => {
        const updates: Record<string, any> = {};
        const db = makeDb({
            nfsesp_portal_cron_logs: { executadoEm: AGORA - 9 * H, iniciadoEm: AGORA - 9 * H, status: 'iniciado' },
        }, updates);
        const r = await coletarSaudeCrons(db, AGORA);
        expect(updates.nfsesp_portal_cron_logs.status).toBe('interrompido');
        expect(r.curados).toBe(1);
        const linha = r.linhas.find((l: any) => l.collection === 'nfsesp_portal_cron_logs');
        expect(linha.saude).toBe('interrompido');
        expect(linha.motivoTop).toMatch(/interrompida/i);
        expect(r.problemas).toBe(0); // âmbar não é vermelho — e não alerta
    });

    it('curar:false só lê (não grava) e mantém o diagnóstico travado', async () => {
        const updates: Record<string, any> = {};
        const db = makeDb({
            nfsesp_portal_cron_logs: { executadoEm: AGORA - 9 * H, iniciadoEm: AGORA - 9 * H, status: 'iniciado' },
        }, updates);
        const r = await coletarSaudeCrons(db, AGORA, { curar: false });
        expect(updates).toEqual({});
        expect(r.linhas.find((l: any) => l.collection === 'nfsesp_portal_cron_logs').saude).toBe('travado');
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

// ============================================================================
// 🚨 "AGORA NÃO SEI SE FOI DELA" — o painel não dizia DE QUEM foi a falha.
//
// 30/08, colaborador via Paulo: rodou a captura com A3 da empresa 93 (SILVIO
// FREIRE), viu no card **"1 falha(s)"** com o motivo do cStat 656, e perguntou
// — com razão — se a falha era daquela empresa. **O painel não tinha como
// responder.**
//
// 🔴 E O DADO ESTAVA NO LOG O TEMPO TODO. O cron grava `errosResumo[].nome` e
// `.cnpj` desde o #28, justamente porque *"painel só dizia '17 falhas' sem
// nenhuma pista de QUAIS empresas"* — e `extrairMotivoTop` lia só o `motivo`,
// jogando o nome fora. O mesmo com a `fonte`, que o heartbeat grava desde
// sempre e o painel descartava.
//
// É a classe "o dado existe e ninguém lê", a terceira da semana (o
// `naoConferidos` num header que a tela não lê; a flag `coberturaIncompleta`).
// ============================================================================
describe('🚨 o card diz DE QUEM foi a falha e QUEM disparou a rodada', () => {
    const reg = {
        collection: 'sefaz_cron_logs', label: 'Captura NF-e (DistDFe)',
        tsField: 'executadoEm', maxIdleHoras: 48,
    };
    const log = (over: Record<string, unknown> = {}) => ({
        executadoEm: new Date().toISOString(), sucessos: 0, falhas: 1, ...over,
    });

    it('nomeia a empresa da falha — o caso SILVIO FREIRE', () => {
        const n = normalizarEntradaLog(reg, log({
            fonte: 'sefaz-cron-noturno',
            errosResumo: [{
                cnpj: '12345678000199', nome: 'SILVIO FREIRE',
                motivo: 'SEFAZ retornou cStat 656 (Consumo Indevido)', codigo: 'cStat=656',
            }],
        }));
        expect(n.motivoTop).toContain('SILVIO FREIRE');
        expect(n.motivoTop).toContain('656');
    });

    it('e diz a FONTE — é ela que separa "foi o cron" de "fui eu"', () => {
        expect(normalizarEntradaLog(reg, log({ fonte: 'sefaz-cron-noturno' })).fonte)
            .toBe('sefaz-cron-noturno');
        expect(normalizarEntradaLog(reg, log({ fonte: 'admin-dirigida' })).fonte)
            .toBe('admin-dirigida');
    });

    // ⚠️ COM MAIS DE UMA FALHA ELE NÃO FINGE QUE É UMA SÓ: nomear só a
    // primeira faria a pessoa conferir uma empresa e concluir que o resto
    // está certo.
    it('com várias falhas, diz "e mais N"', () => {
        const n = normalizarEntradaLog(reg, log({
            falhas: 3,
            errosResumo: [
                { nome: 'EMPRESA A', motivo: 'cStat 656' },
                { nome: 'EMPRESA B', motivo: 'x' },
                { nome: 'EMPRESA C', motivo: 'y' },
            ],
        }));
        expect(n.motivoTop).toContain('EMPRESA A');
        expect(n.motivoTop).toContain('e mais 2');
    });

    // ⚠️ AUSÊNCIA NÃO VIRA RÓTULO INVENTADO — log antigo não tem os campos, e
    // afirmar "cron" ali mandaria procurar no lugar errado.
    it('log sem nome mantém a frase antiga, e sem fonte devolve null', () => {
        const n = normalizarEntradaLog(reg, log({ errosResumo: [{ cnpj: '999', motivo: 'erro qualquer' }] }));
        expect(n.motivoTop).toBe('erro qualquer');
        expect(n.fonte).toBeNull();
        expect(normalizarEntradaLog(reg, log()).fonte).toBeNull();
    });

    it('e nome em branco não vira prefixo vazio', () => {
        const n = normalizarEntradaLog(reg, log({ errosResumo: [{ nome: '   ', motivo: 'cStat 656' }] }));
        expect(n.motivoTop).toBe('cStat 656');
    });
});
