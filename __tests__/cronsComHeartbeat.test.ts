// 💓 Auditoria 26/09: 13 dos 22 crons rodavam sem heartbeat nem log — rodada
// morta no meio ficava muda. Esta trava fecha a classe por VARREDURA: cada
// rota de cron listada abaixo passa pelo `withCronHeartbeat`, e a coleção
// que ela grava está no vigia (CRON_LOG_COLLECTIONS). Cobra o FATO (a chamada
// existe no handler; a coleção está registrada), não a redação.
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error módulo .js puro sem tipos
import { CRON_LOG_COLLECTIONS } from '../sefaz-backend/cron-health.js';

const RAIZ = join(__dirname, '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

const CRONS = [
    { arquivo: 'sefaz-backend/sefaz-sp-nfce-cron.js', rota: '/sae-nfce-cron', colecao: 'sae_nfce_cron_logs' },
    { arquivo: 'sefaz-backend/distdfe-autxml-routes.js', rota: '/autxml-harvest-cron', colecao: 'autxml_harvest_cron_logs' },
    { arquivo: 'sefaz-backend/xml-email-ingestor-routes.js', rota: '/xml-email-arquivo-sp-cron', colecao: 'cofre_arquivo_cron_logs' },
    { arquivo: 'sefaz-backend/captura-resumo-cron.js', rota: '/captura-resumo-cron', colecao: 'captura_resumo_cron_logs' },
    { arquivo: 'server.js', rota: '/api/admin/sharepoint/cron-alertas', colecao: 'sharepoint_alertas_cron_logs' },
];

// O trecho do handler: do `post('<rota>'` até o próximo `router.post(`/`app.post(`/fim.
function handlerDe(src: string, rota: string): string {
    const i = src.indexOf(`post('${rota}'`);
    if (i < 0) return '';
    const resto = src.slice(i + 1);
    const fim = resto.search(/\n(router|app)\.(post|get)\(/);
    return fim < 0 ? resto : resto.slice(0, fim);
}

describe('💓 os crons da auditoria passam pelo heartbeat', () => {
    for (const c of CRONS) {
        it(`${c.rota} usa withCronHeartbeat com ${c.colecao}`, () => {
            const h = handlerDe(ler(c.arquivo), c.rota);
            expect(h).not.toBe('');
            expect(h).toMatch(/withCronHeartbeat\(/);
            expect(h).toContain(`'${c.colecao}'`);
        });
        it(`${c.colecao} está no vigia de saúde`, () => {
            expect(CRON_LOG_COLLECTIONS.map((x: any) => x.collection)).toContain(c.colecao);
        });
    }

    it('o deploy mantém a CPU alocada depois da resposta (trabalho em setImmediate)', () => {
        expect(ler('.github/workflows/deploy-app.yml')).toMatch(/--no-cpu-throttling/);
    });

    // Paulo (26/09): "deixar de forma que fique sempre disponível a toda e
    // qualquer solicitação" — uma instância quente, sem partida a frio.
    it('o deploy mantém uma instância sempre de pé (sem partida a frio)', () => {
        expect(ler('.github/workflows/deploy-app.yml')).toMatch(/--min-instances=1/);
    });
});
