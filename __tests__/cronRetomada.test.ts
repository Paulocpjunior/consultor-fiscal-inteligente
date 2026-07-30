/**
 * Retomada automática de crons interrompidos por deploy/reinício.
 *
 * Caso painel 30/07: varredura NFS-e SP interrompida há 4h esperando alguém
 * clicar "Forçar captura agora". A retomada agora é automática no boot da
 * instância nova — este teste trava o critério de seleção (função pura).
 */

// @ts-expect-error — modulo .js puro
import { selecionarInterrompidosParaRetomar, RETOMADA_MAX_IDADE_MS, CRONS_RETOMAVEIS } from '../sefaz-backend/cron-retomada.js';

const AGORA = Date.parse('2026-07-30T12:00:00Z');
const iso = (msAtras: number) => new Date(AGORA - msAtras).toISOString();

describe('cron-retomada — seleção de runs interrompidos', () => {
    it('seleciona interrompido recente sem marca de retomada', () => {
        const docs = [
            { id: 'a', status: 'interrompido', interrompidoEm: iso(30 * 60_000) },     // 30 min
            { id: 'b', status: 'interrompido', interrompidoEm: iso(4 * 3_600_000) },   // 4h (caso do painel)
        ];
        expect(selecionarInterrompidosParaRetomar(docs, AGORA).map((d: any) => d.id)).toEqual(['a', 'b']);
    });

    it('ignora interrompido velho demais (cron agendado já cobriu)', () => {
        const docs = [
            { id: 'velho', status: 'interrompido', interrompidoEm: iso(RETOMADA_MAX_IDADE_MS + 60_000) },
        ];
        expect(selecionarInterrompidosParaRetomar(docs, AGORA)).toEqual([]);
    });

    it('ignora quem já foi retomado, outros status e docs sem timestamp', () => {
        const docs = [
            { id: 'ja-retomado', status: 'interrompido', interrompidoEm: iso(60_000), retomadoEm: iso(30_000) },
            { id: 'sucesso', status: 'sucesso', interrompidoEm: iso(60_000) },
            { id: 'iniciado', status: 'iniciado' },
            { id: 'sem-ts', status: 'interrompido' },
            { id: 'ts-invalido', status: 'interrompido', interrompidoEm: 'nao-e-data' },
        ];
        expect(selecionarInterrompidosParaRetomar(docs, AGORA)).toEqual([]);
    });

    it('lista vazia/nula não explode', () => {
        expect(selecionarInterrompidosParaRetomar([], AGORA)).toEqual([]);
        expect(selecionarInterrompidosParaRetomar(null as any, AGORA)).toEqual([]);
    });

    it('mapa de crons retomáveis cobre as 3 coleções com heartbeat de interrupção', () => {
        expect(CRONS_RETOMAVEIS.map((c: any) => c.collection).sort()).toEqual([
            'manifestacoes_cron_logs',
            'nfsesp_portal_cron_logs',
            'sefaz_cron_logs',
        ]);
        // manifest-cron é dry-run por default no endpoint — a retomada PRECISA
        // mandar dryRun:false explícito, senão "retoma" sem manifestar nada.
        const manifest = CRONS_RETOMAVEIS.find((c: any) => c.collection === 'manifestacoes_cron_logs');
        expect(manifest.body).toEqual({ dryRun: false });
    });
});
