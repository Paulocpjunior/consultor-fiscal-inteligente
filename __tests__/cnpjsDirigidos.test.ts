// ============================================================================
// 🎯 A RÉGUA DA CAPTURA DIRIGIDA — e a trava do LAÇO ÚNICO
//
// `/sync-targeted` era alcançável só pelo cron. O botão exigiu uma porta de
// ADMIN (`/sync-targeted-now`), porque o segredo do cron nunca vai ao
// navegador — e aí nasce o risco de sempre: DUAS portas com DOIS laços, que
// divergiriam no ritmo anti-656 sem ninguém ver. Por isso o laço é um só e
// esta varredura o prova.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    normalizarCnpjsDirigidos, minutosEstimadosDirigida,
    LIMITE_CNPJS_DIRIGIDOS, RESPIRO_ENTRE_EMPRESAS_MS,
// @ts-expect-error — módulo backend .js sem .d.ts
} from '../sefaz-backend/cnpjs-dirigidos.js';

const fonte = readFileSync(join(__dirname, '..', 'sefaz-backend', 'sync-routes.js'), 'utf8');

describe('🎯 normalização da lista dirigida', () => {
    it('aceita máscara, descarta o que não é CNPJ e não repete', () => {
        expect(normalizarCnpjsDirigidos([
            '31.947.349/0001-69', '44388152000189', '31947349000169', '123', '', null,
        ])).toEqual(['31947349000169', '44388152000189']);
    });

    it('entrada que não é lista devolve vazio — nunca explode a rodada', () => {
        expect(normalizarCnpjsDirigidos(undefined)).toEqual([]);
        expect(normalizarCnpjsDirigidos('31947349000169' as any)).toEqual([]);
    });

    // A primeira empresa não espera — o respiro é ENTRE elas.
    it('o tempo estimado sai do respiro, e uma empresa só não espera', () => {
        expect(minutosEstimadosDirigida(1)).toBe(0);
        expect(minutosEstimadosDirigida(2)).toBe(2);   // 90s
        expect(minutosEstimadosDirigida(30)).toBe(44); // 29 × 90s
    });

    it('o respiro é 90s — é ele que evita o 656, não é enfeite', () => {
        expect(RESPIRO_ENTRE_EMPRESAS_MS).toBe(90000);
        expect(LIMITE_CNPJS_DIRIGIDOS).toBe(30);
    });
});

describe('🚨 duas portas, UM laço', () => {
    it('o laço dirigido é escrito UMA vez e as duas rotas o chamam', () => {
        expect((fonte.match(/async function executarSyncDirigido/g) || []).length).toBe(1);
        // /sync-targeted (cron) e /sync-targeted-now (admin).
        expect((fonte.match(/executarSyncDirigido\(/g) || []).length).toBe(3); // 1 declaração + 2 chamadas
    });

    it('a porta nova é de ADMIN — o segredo do cron não vai ao navegador', () => {
        const trecho = fonte.slice(fonte.indexOf("router.post('/sync-targeted-now'"));
        expect(trecho.slice(0, 200)).toContain('requireAuth');
        expect(trecho.slice(0, 600)).toContain("role !== 'admin'");
        // requireCronAuth aqui significaria segredo no navegador.
        expect(trecho.slice(0, 200)).not.toContain('requireCronAuth');
    });

    it('e a porta do cron continua com o segredo do cron', () => {
        expect(fonte).toContain("router.post('/sync-targeted', requireCronAuth");
    });

    // Responder só no fim significaria estourar navegador e Cloud Run numa
    // rodada de 45 min — e a pessoa concluir que "não funcionou".
    it('a rodada do botão corre em BACKGROUND, com o heartbeat do cron', () => {
        const trecho = fonte.slice(fonte.indexOf("router.post('/sync-targeted-now'"));
        expect(trecho).toContain('withCronHeartbeat');
        expect(trecho).toContain('sefaz_cron_logs');
    });

    // Lista truncada em silêncio é o "0 de 388" outra vez.
    it('acima do teto RECUSA dizendo o número, em vez de cortar calado', () => {
        const trecho = fonte.slice(fonte.indexOf("router.post('/sync-targeted-now'"));
        expect(trecho).toContain('LIMITE_CNPJS_DIRIGIDOS');
        expect(trecho).toContain('Divida em rodadas');
    });

    // CNPJ que não é cliente sumindo do resultado faria "processadas: 3" ser
    // lido como se as 5 pedidas tivessem rodado.
    it('CNPJ não encontrado volta NOMEADO, não some da conta', () => {
        expect(fonte).toContain('naoEncontrados');
    });
});
