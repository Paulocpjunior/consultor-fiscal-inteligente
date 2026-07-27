/**
 * Desligamento gracioso do heartbeat de cron (27/07).
 *
 * Cloud Run manda SIGTERM antes de matar a instância (deploy/scale-down). O
 * trabalho em setImmediate morre junto e o log ficava em 'iniciado' PRA SEMPRE
 * → painel "Saúde dos crons" mostrava "TRAVADO há 9h" com nada travado
 * (caso NFS-e SP portal). Agora os runs vivos são marcados como 'interrompido'
 * na hora, com motivo honesto.
 */
// @ts-expect-error — módulo .js puro
import { registrarRunEmAndamento, concluirRunEmAndamento, marcarRunsInterrompidos } from '../sefaz-backend/cron-heartbeat.js';

function fakeRef() {
    const gravado: any[] = [];
    return { gravado, update: async (p: any) => { gravado.push(p); } };
}

describe('marcarRunsInterrompidos — SIGTERM no meio da varredura', () => {
    it('marca os runs vivos como interrompido, com motivo acionável', async () => {
        const a = fakeRef();
        const b = fakeRef();
        registrarRunEmAndamento(a, { collection: 'nfsesp_portal_cron_logs' });
        registrarRunEmAndamento(b, { collection: 'sefaz_cron_logs' });

        const n = await marcarRunsInterrompidos('SIGTERM');

        expect(n).toBe(2);
        expect(a.gravado[0].status).toBe('interrompido');
        expect(a.gravado[0].motivoInterrupcao).toMatch(/SIGTERM/);
        expect(a.gravado[0].motivoInterrupcao).toMatch(/rode a captura de novo|aguarde/i);
        expect(b.gravado[0].status).toBe('interrompido');
    });

    it('run já concluído não é marcado (sai da lista de vivos)', async () => {
        const a = fakeRef();
        registrarRunEmAndamento(a, {});
        concluirRunEmAndamento(a);
        expect(await marcarRunsInterrompidos('SIGTERM')).toBe(0);
        expect(a.gravado).toHaveLength(0);
    });

    it('sem run vivo, não faz nada (deploy em instância ociosa)', async () => {
        expect(await marcarRunsInterrompidos('SIGTERM')).toBe(0);
    });

    it('ref inválida é ignorada (não derruba o desligamento)', async () => {
        registrarRunEmAndamento(null as any, {});
        registrarRunEmAndamento({} as any, {});
        expect(await marcarRunsInterrompidos('SIGTERM')).toBe(0);
    });

    it('falha ao gravar um run não impede os demais', async () => {
        const ruim = { update: async () => { throw new Error('permission-denied'); } };
        const bom = fakeRef();
        registrarRunEmAndamento(ruim, {});
        registrarRunEmAndamento(bom, {});
        expect(await marcarRunsInterrompidos('SIGTERM')).toBe(2);
        expect(bom.gravado[0].status).toBe('interrompido');
    });
});
