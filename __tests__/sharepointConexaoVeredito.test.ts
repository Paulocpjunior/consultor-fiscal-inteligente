// ============================================================================
// 🚨 "✓ CONECTADO" EM VERDE COM 57 ERROS DE TOKEN LOGO ABAIXO
//
// 28/08, print do Paulo no card **Conexão SharePoint**. A linha verde em cima,
// na posição do veredito; e a linha do auto-sync, embaixo, dizendo a verdade:
//
//   ⚠ 28/08/2026, 15:48:06 · 0 novos · 0 dup · **57 erros** · comp 2026-07 +
//   2026-08 — SAÍDA: Azure AD token error (400): {"error":"invalid_request",
//   "error_description":"AADSTS90002: Tenant 'dfa9a1d2-…' not found…"}
//
// A causa: o card lia `health.configured`, que responde *"as variáveis estão
// preenchidas?"* — não *"o token funciona?"*. Tenant que não existe é
// configurado E quebrado. É a PRIMEIRA regra permanente deste projeto
// invertida: validação por RESULTADO, nunca por status.
//
// ⚠️ E o custo não é estético: o auto-sync dos XMLs e a cópia da guia na pasta
// IMPOSTOS do rito passam pelo MESMO proxy. Com o token falhando, nada é
// gravado — e o fim de mês trava na etapa 5 sem que ninguém entenda por quê.
// ============================================================================
import { primeiroMotivoDoSync, vereditoConexaoSharePoint } from '../services/sharepointConexaoVeredito';

const AGORA = new Date('2026-08-28T18:00:00Z').getTime();
const HA_1H = { _seconds: Math.floor((AGORA - 3600_000) / 1000) };

/** O erro REAL do print, palavra por palavra. */
const ERRO_DO_PRINT = 'SAÍDA: Azure AD token error (400): {"error":"invalid_request",'
    + '"error_description":"AADSTS90002: Tenant \'dfa9a1d2-de5d-4652-8179-2e6b15b6bce8\' not found."}';

const SYNC_DO_PRINT = {
    timestamp: HA_1H,
    totalErros: 57,
    results: [
        { empresaNome: 'KAOLI HIRATA & FILHO LTDA', errosDetalhe: [ERRO_DO_PRINT] },
    ],
};

describe('🚨 o caso do print — configurado NÃO é conectado', () => {
    it('com o token falhando, o card NÃO fica verde', () => {
        const v = vereditoConexaoSharePoint({
            health: { configured: true }, lastSync: SYNC_DO_PRINT, agoraMs: AGORA,
        });
        expect(v.cor).toBe('erro');
        expect(v.titulo).toMatch(/NÃO consegue autenticar/);
    });

    // A mensagem do órgão vai INTEIRA — foi ela que respondeu o caso.
    it('mostra a mensagem real da Microsoft, não um genérico', () => {
        const v = vereditoConexaoSharePoint({
            health: { configured: true }, lastSync: SYNC_DO_PRINT, agoraMs: AGORA,
        });
        expect(v.detalhe).toMatch(/AADSTS90002/);
        expect(v.detalhe).toMatch(/dfa9a1d2/);
    });

    // 🚨 A CONSEQUÊNCIA VAI DITA: sem isso, quem lê acha que é problema só dos
    // XMLs e vai preencher grupo/pasta do cliente — que não resolve NADA.
    it('a ação DIZ que a guia do rito também não é arquivada', () => {
        const v = vereditoConexaoSharePoint({
            health: { configured: true }, lastSync: SYNC_DO_PRINT, agoraMs: AGORA,
        });
        expect(v.acao).toMatch(/pasta IMPOSTOS/);
        expect(v.acao).toMatch(/fim de mês/);
        expect(v.acao).toMatch(/preencher grupo\/pasta do cliente não resolve/);
    });

    it('aponta o serviço e as variáveis que se corrigem', () => {
        const v = vereditoConexaoSharePoint({
            health: { configured: true }, lastSync: SYNC_DO_PRINT, agoraMs: AGORA,
        });
        expect(v.acao).toMatch(/consultor-fiscal-proxy/);
        expect(v.acao).toMatch(/GRAPH_TENANT_ID/);
    });
});

describe('as outras assinaturas de credencial caem no mesmo balde', () => {
    // Elas pedem a MESMA ação (mexer no proxy) e nenhuma se resolve no
    // cadastro do cliente — por isso não se separam.
    for (const m of ['invalid_client', 'HTTP 401 Unauthorized', 'AADSTS7000215', 'token error']) {
        it(`"${m}" é falha de credencial`, () => {
            const v = vereditoConexaoSharePoint({
                health: { configured: true },
                lastSync: { timestamp: HA_1H, totalErros: 1, results: [{ erro: m }] },
                agoraMs: AGORA,
            });
            expect(v.cor).toBe('erro');
            expect(v.titulo).toMatch(/autenticar/);
        });
    }

    // ⚠️ Erro de PASTA não vira "falha de credencial": a ação é outra (conferir
    // o caminho), e mandar mexer no proxy por causa dele seria alarme com
    // primeira parada errada.
    it('erro de pasta continua sendo atenção, não credencial', () => {
        const v = vereditoConexaoSharePoint({
            health: { configured: true },
            lastSync: { timestamp: HA_1H, totalErros: 2, results: [{ empresaNome: 'X', erro: 'itemNotFound: pasta não existe' }] },
            agoraMs: AGORA,
        });
        expect(v.cor).toBe('atencao');
        expect(v.detalhe).toMatch(/pasta não existe/);
    });
});

describe('ausência não vira verde', () => {
    // "Configurado" prova que alguém preencheu as variáveis, não que a
    // gravação funciona — é a confusão que este módulo desfaz.
    it('sem rodada nenhuma é INDETERMINADO, nunca ok', () => {
        const v = vereditoConexaoSharePoint({ health: { configured: true }, lastSync: null, agoraMs: AGORA });
        expect(v.cor).toBe('indeterminado');
        expect(v.titulo).toMatch(/sem rodada/i);
    });

    it('health ainda carregando é indeterminado', () => {
        expect(vereditoConexaoSharePoint({ health: null, agoraMs: AGORA }).cor).toBe('indeterminado');
    });

    it('proxy sem credenciais continua vermelho', () => {
        const v = vereditoConexaoSharePoint({ health: { configured: false }, agoraMs: AGORA });
        expect(v.cor).toBe('erro');
        expect(v.titulo).toMatch(/indisponível/);
    });

    // Rodada limpa mas antiga: conectado e ninguém grava há dias — não é
    // estado normal, e verde ali faria o cron parado passar despercebido.
    it('rodada limpa e ANTIGA é atenção', () => {
        const v = vereditoConexaoSharePoint({
            health: { configured: true },
            lastSync: { timestamp: { _seconds: Math.floor((AGORA - 72 * 3600_000) / 1000) }, totalErros: 0 },
            agoraMs: AGORA,
        });
        expect(v.cor).toBe('atencao');
        expect(v.titulo).toMatch(/antiga/);
    });
});

describe('o verde continua existindo — alarme permanente ensina a ignorar alarme', () => {
    it('rodada recente e sem erro é ok', () => {
        const v = vereditoConexaoSharePoint({
            health: { configured: true },
            lastSync: { timestamp: HA_1H, totalErros: 0 },
            agoraMs: AGORA,
        });
        expect(v.cor).toBe('ok');
        expect(v.titulo).toBe('✓ Conectado');
        expect(v.acao).toBeNull();
    });
});

describe('primeiroMotivoDoSync', () => {
    it('o erroFatal vence o erro por empresa — ele é da rodada inteira', () => {
        expect(primeiroMotivoDoSync({
            erroFatal: 'Proxy inacessível',
            results: [{ empresaNome: 'X', erro: 'outro' }],
        })).toBe('Proxy inacessível');
    });

    it('nomeia a empresa junto do motivo', () => {
        expect(primeiroMotivoDoSync({ results: [{ empresaNome: 'KAOLI', erro: 'boom' }] }))
            .toBe('KAOLI: boom');
    });

    it('sem erro nenhum devolve null', () => {
        expect(primeiroMotivoDoSync({ results: [] })).toBeNull();
        expect(primeiroMotivoDoSync(null)).toBeNull();
    });
});
