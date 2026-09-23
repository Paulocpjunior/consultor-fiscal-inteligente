// ============================================================================
// 🚨 "✓ NFSe SP" AFIRMADO A PARTIR DE DOIS CAMPOS DE CADASTRO
//
// 29/08, Paulo, na LAV COMERCIO DE AUTOPECAS: *"foi detectado que não está
// capturando as NFS-e de serviços tomados pelo cliente e isso já deveria ter
// sido resolvido"* — com a linha de status dizendo, no mesmo print,
// `✓ NFSe SP · ✓ Captura OK`.
//
//     capturaNfseSpOk = !!emp.ccmSp && !!emp.nfseSpAutorizadoEm;
//
// Preencheu o CCM e marcou a data ⇒ a tela AFIRMA que a captura está OK. Nada
// olhava se o trilho alguma vez baixou um CSV desta empresa. É a primeira
// regra permanente deste projeto invertida — *validação por RESULTADO, não por
// status* — e a mesma família do `temA3Proprio` de 23/08.
// ============================================================================
// @ts-expect-error — módulo .js puro
import { coberturaNfseSpPortal, resumirCoberturaNfseSp } from '../sefaz-backend/captura-nfse-sp-cobertura.js';

const AGORA = Date.parse('2026-08-29T12:00:00-03:00');
const diasAtras = (n: number) => AGORA - n * 24 * 60 * 60 * 1000;

describe('o trilho da capital não se aplica', () => {
    // A régua não opina sobre o Padrão Nacional (ADN), que é o caminho das
    // outras cidades e continua decidido onde já era.
    it('devolve neutro, sem texto e sem ação', () => {
        const c = coberturaNfseSpPortal({ aplicavel: false, state: null, agoraMs: AGORA });
        expect(c.situacao).toBe('nao-se-aplica');
        expect(c.cor).toBe('neutro');
        expect(c.entregou).toBeNull();
        expect(c.acao).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 O CASO LAV: sem documento de estado, o trilho NUNCA visitou a empresa.
//
// O laço do portal é dirigido pelo DROPDOWN de prestadores e cruza com o nosso
// cadastro POR CCM: quem não casa não gera sequer uma linha em `detalhes`. Não
// é "falhou" — é como se ela não existisse.
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 nunca visitada — o silêncio que o verde escondia', () => {
    const c = () => coberturaNfseSpPortal({ aplicavel: true, state: null, agoraMs: AGORA });

    it('sai do verde', () => {
        expect(c().situacao).toBe('nfsesp-sem-entrega');
        expect(c().entregou).toBe(false);
    });

    // ⚠️ ÂMBAR, não vermelho: vermelho afirmaria que o trilho está quebrado.
    // O que o app mediu é que ele nunca entregou nada DESTA empresa.
    it('é âmbar, porque o app não mediu "quebrado"', () => {
        expect(c().cor).toBe('atencao');
    });

    // 🚨 As três causas vão NOMEADAS — a primeira parada é outra em cada uma,
    // e "confira a captura" seria mandar procurar.
    it('a ação nomeia CCM, autorização e cron — as três causas', () => {
        const acao = String(c().acao);
        expect(acao).toMatch(/CCM/);
        expect(acao).toMatch(/autoriza/i);
        expect(acao).toMatch(/cron/);
        // E diz POR QUE ninguém viu: ela é pulada sem gerar erro.
        expect(acao).toMatch(/pulada sem gerar erro/);
    });

    it('state vazio ou com data ilegível conta como nunca visitada', () => {
        for (const state of [{}, { ultimaSyncMs: null }, { ultimaSyncMs: 0 }, { ultimaSyncMs: 'ontem' }]) {
            expect(coberturaNfseSpPortal({ aplicavel: true, state, agoraMs: AGORA }).situacao)
                .toBe('nfsesp-sem-entrega');
        }
    });
});

// ════════════════════════════════════════════════════════════════════════════
// ⚠️ ZERO NOTAS NÃO É FALHA — e é por isso que o verde continua existindo.
// Empresa de comércio tem meses sem NFS-e tomada; pintar de âmbar por isso
// seria alarme que ninguém consegue apagar.
// ════════════════════════════════════════════════════════════════════════════
describe('rodou e trouxe zero — resposta LEGÍTIMA', () => {
    const c = coberturaNfseSpPortal({
        aplicavel: true,
        state: {
            ultimaSyncMs: diasAtras(2), prestadasUlt: 0, tomadasUlt: 0,
            ultimoPeriodo: { anoMes: '2026-07' },
        },
        agoraMs: AGORA,
    });

    it('continua verde', () => {
        expect(c.situacao).toBe('nfsesp-entregue');
        expect(c.cor).toBe('ok');
        expect(c.entregou).toBe(true);
        expect(c.acao).toBeNull();
    });

    it('a frase diz a data, o período e os dois números', () => {
        expect(c.texto).toMatch(/última rodada em 27\/08\/2026/);
        expect(c.texto).toMatch(/há 2 dias/);
        expect(c.texto).toMatch(/0 prestada\(s\) e 0 tomada\(s\)/);
        expect(c.texto).toMatch(/2026-07/);
    });

    it('rodada de hoje não diz "há 0 dias"', () => {
        const hoje = coberturaNfseSpPortal({
            aplicavel: true, state: { ultimaSyncMs: AGORA - 3600_000, prestadasUlt: 4, tomadasUlt: 1 },
            agoraMs: AGORA,
        });
        expect(hoje.texto).toMatch(/\(hoje\)/);
        expect(hoje.texto).toMatch(/4 prestada\(s\) e 1 tomada\(s\)/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// ⚠️ RODOU E ERROU é OUTRO fato: com o download falhando, o número de notas
// não diz nada sobre o movimento. Fundir com "entregou zero" apagaria a
// diferença justo onde ela importa.
// ════════════════════════════════════════════════════════════════════════════
describe('rodou e o download falhou', () => {
    const c = coberturaNfseSpPortal({
        aplicavel: true,
        state: {
            ultimaSyncMs: diasAtras(1), prestadasUlt: null, tomadasUlt: null,
            erroTomadas: 'HTTP 403 — sessão expirada',
        },
        agoraMs: AGORA,
    });

    it('sai do verde e não afirma entrega', () => {
        expect(c.situacao).toBe('nfsesp-com-erro');
        expect(c.cor).toBe('atencao');
        expect(c.entregou).toBe(false);
    });

    // A mensagem da Prefeitura vai INTEIRA: é ela que diz se foi sessão, WAF
    // ou período — deduzir aqui mandaria a pessoa ao lugar errado.
    it('carrega o erro da Prefeitura, sem resumir', () => {
        expect(c.texto).toMatch(/HTTP 403 — sessão expirada/);
    });

    it('erro em qualquer um dos dois lados basta', () => {
        const so = coberturaNfseSpPortal({
            aplicavel: true,
            state: { ultimaSyncMs: diasAtras(1), erroPrestadas: 'timeout', tomadasUlt: 3 },
            agoraMs: AGORA,
        });
        expect(so.situacao).toBe('nfsesp-com-erro');
    });
});

// ⚠️ NENHUM SLA INVENTADO: o app não crava janela de "parado" — entrega a data
// e quantos dias faz, e quem julga é quem lê.
describe('o app não inventa prazo', () => {
    it('entrega antiga continua verde, com a data e os dias', () => {
        const c = coberturaNfseSpPortal({
            aplicavel: true,
            state: { ultimaSyncMs: diasAtras(180), prestadasUlt: 2, tomadasUlt: 0 },
            agoraMs: AGORA,
        });
        expect(c.situacao).toBe('nfsesp-entregue');
        expect(c.diasDesdeEntrega).toBe(180);
        expect(c.texto).toMatch(/há 180 dias/);
    });
});

describe('o resumo conta o que o verde escondia', () => {
    it('separa sem-entrega, erro e entregue — e ignora quem não se aplica', () => {
        const r = resumirCoberturaNfseSp([
            coberturaNfseSpPortal({ aplicavel: false }),
            coberturaNfseSpPortal({ aplicavel: true, state: null }),
            coberturaNfseSpPortal({ aplicavel: true, state: null }),
            coberturaNfseSpPortal({ aplicavel: true, state: { ultimaSyncMs: diasAtras(1), erroTomadas: 'x' } }),
            coberturaNfseSpPortal({ aplicavel: true, state: { ultimaSyncMs: diasAtras(1), tomadasUlt: 5 } }),
        ]);
        expect(r).toEqual({
            nfseSpTotal: 4, nfseSpSemEntrega: 2, nfseSpComErro: 1, nfseSpEntregue: 1,
        });
    });

    it('lista vazia ou inválida não explode', () => {
        expect(resumirCoberturaNfseSp(null).nfseSpTotal).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 A ROTA PERGUNTA AO DONO — e lê o estado UMA VEZ para a carteira inteira.
// Leitura por card foi o HTTP 429 de 27/08.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 a rota de status usa o dono, e sem leitura por card', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'sefaz-backend/empresa-status-routes.js'), 'utf8',
    );

    it('chama a régua em vez de decidir por cadastro sozinho', () => {
        expect(src).toMatch(/from '\.\/captura-nfse-sp-cobertura\.js'/);
        expect(src).toMatch(/coberturaNfseSpPortal\(/);
    });

    // 🚨 A leitura do estado é UMA só, fora do laço das empresas.
    it('lê nfsesp_portal_state uma vez, não por empresa', () => {
        const ocorrencias = src.match(/collection\('nfsesp_portal_state'\)/g) || [];
        expect(ocorrencias).toHaveLength(1);
    });

    // O pill não pode continuar afirmando OK quando a régua diz que não
    // entregou — seriam duas leituras do mesmo fato na mesma tela.
    it('o capturaNfseSpOk honra o resultado da régua', () => {
        expect(src).toMatch(/coberturaNfseSp\.entregou !== false/);
    });
});
