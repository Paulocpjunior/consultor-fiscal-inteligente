// ============================================================================
// 🚨 O TERCEIRO TRILHO TAMBÉM AFIRMAVA CAPTURA A PARTIR DO CADASTRO
//
// 29/08, LAV COMERCIO DE AUTOPECAS. Depois de o CCM e o farol do portal de SP
// serem corrigidos, Paulo mandou a LINHA dela: *"a empresa em questão está com
// o cadastro ok"* — e estava mesmo. A linha dizia `A1 · ✓ marcada · **— ADN** ·
// ✓ ativa · ✓ NFe · ✓ NFSe SP · ✓ NFSe Nac · ✓ Captura OK`, com ZERO NFS-e
// tomada no relatório da mesma competência.
//
// 🔴 **O `— ADN` era a resposta.** O trilho do portal da capital NÃO SE APLICA
// a ela (não é de SP capital, não tem nem precisa de CCM) — a NFS-e dela vem
// pelo Padrão Nacional. E `classificarCapturaNfseNacionalAdn` pergunta só *"a
// flag está ativa e existe certificado?"*: **nada olhava se o ADN alguma vez
// entregou documento desta empresa.**
//
// É a primeira regra permanente deste projeto invertida pela TERCEIRA vez —
// depois do `temA3Proprio` (23/08) e do `capturaNfseSpOk` (29/08, horas antes).
// ============================================================================
import {
    coberturaNfseNacional, resumirCoberturaNfseNacional,
} from '../sefaz-backend/captura-nfse-nacional-cobertura.js';

const AGORA = Date.parse('2026-08-29T12:00:00-03:00');
const diasAtras = (n: number) => AGORA - n * 24 * 60 * 60 * 1000;

describe('o trilho do ADN não se aplica', () => {
    it('devolve neutro, sem texto e sem ação', () => {
        const c = coberturaNfseNacional({ aplicavel: false, agoraMs: AGORA });
        expect(c.situacao).toBe('nao-se-aplica');
        expect(c.entregou).toBeNull();
        expect(c.acao).toBeNull();
    });
});

describe('🚨 nunca rodou para esta empresa', () => {
    const c = () => coberturaNfseNacional({ aplicavel: true, state: null, agoraMs: AGORA });

    it('sai do verde — é a única situação em que a primeira parada é nossa', () => {
        expect(c().situacao).toBe('adn-sem-visita');
        expect(c().cor).toBe('atencao');
        expect(c().entregou).toBe(false);
    });

    // ⚠️ E a frase NÃO afirma que não há documento: o app não perguntou.
    it('não afirma ausência de documento — diz que não sabe', () => {
        expect(String(c().acao)).toMatch(/não sabe dizer se há documento/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 O CASO QUE EXPLICA A LAV: o ADN RESPONDEU e não tem nada.
//
// ⚠️ Isto é EXPLICAÇÃO, não alarme. Acusar toda empresa cujo município não usa
// o Padrão Nacional seria o alarme que ninguém consegue apagar — o jeito
// conhecido de a equipe parar de olhar o farol (a lição do aluguel, 27/08).
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 rodou e o ADN não tem documento (NSU 0/0)', () => {
    const c = coberturaNfseNacional({
        aplicavel: true,
        state: { ultimaSyncMs: diasAtras(1), ultNSU: '0', maxNSU: '0' },
        agoraMs: AGORA,
    });

    it('a cor é NEUTRA — não é pendência da captura', () => {
        expect(c.situacao).toBe('adn-sem-movimento');
        expect(c.cor).toBe('neutro');
        expect(c.entregou).toBe(false);
    });

    it('diz o fato: o ADN respondeu e não tem nada', () => {
        expect(c.texto).toMatch(/NÃO tem documento desta empresa/);
        expect(c.texto).toMatch(/NSU 0\/0/);
    });

    // 🚨 A causa vai como POSSIBILIDADE, com a saída nomeada. `maxNSU = 0`
    // prova que o ADN não tem nada para este CNPJ — NÃO prova que a empresa
    // não teve nota, nem afirma qual sistema a prefeitura usa.
    it('a causa é possibilidade, não veredito — e a saída vai junto', () => {
        expect(String(c.acao)).toMatch(/não é falha da captura/i);
        expect(String(c.acao)).toMatch(/causa mais comum/i);
        expect(String(c.acao)).toMatch(/importe pelo município/i);
    });
});

// ⚠️ FATO DIFERENTE, AÇÃO OPOSTA: o ADN TEM documento e o nosso cursor não
// andou. Aqui a pendência é NOSSA. Fundir com o caso acima apagaria a
// diferença justo onde ela decide o que fazer.
describe('o ADN tem documento e nada foi lido', () => {
    const c = coberturaNfseNacional({
        aplicavel: true,
        state: { ultimaSyncMs: diasAtras(3), ultNSU: '0', maxNSU: '000000000000042' },
        agoraMs: AGORA,
    });

    it('é pendência nossa, em âmbar', () => {
        expect(c.situacao).toBe('adn-nao-lido');
        expect(c.cor).toBe('atencao');
    });

    it('mostra os dois NSU, que é o que prova a lacuna', () => {
        expect(c.texto).toMatch(/NSU 0\/42/);
        expect(String(c.acao)).toMatch(/Rode a captura/);
    });
});

describe('entregou', () => {
    const c = coberturaNfseNacional({
        aplicavel: true,
        state: { ultimaSyncMs: diasAtras(2), ultNSU: '000000000000015', maxNSU: '000000000000015' },
        agoraMs: AGORA,
    });

    it('fica verde com a data e o cursor', () => {
        expect(c.situacao).toBe('adn-entregue');
        expect(c.cor).toBe('ok');
        expect(c.entregou).toBe(true);
        expect(c.texto).toMatch(/27\/08\/2026/);
        expect(c.texto).toMatch(/NSU 15\/15/);
        expect(c.acao).toBeNull();
    });

    // ⚠️ NENHUM SLA INVENTADO: entrega antiga continua verde.
    it('entrega antiga continua verde, com a data e os dias', () => {
        const velho = coberturaNfseNacional({
            aplicavel: true,
            state: { ultimaSyncMs: diasAtras(200), ultNSU: '7', maxNSU: '7' },
            agoraMs: AGORA,
        });
        expect(velho.situacao).toBe('adn-entregue');
        expect(velho.diasDesdeEntrega).toBe(200);
    });
});

// O NSU do ADN chega com zeros à esquerda ('000000000000123'); comparar como
// TEXTO faria '9' > '15'.
describe('o NSU compara como número, não como texto', () => {
    it('zeros à esquerda não enganam', () => {
        const c = coberturaNfseNacional({
            aplicavel: true,
            state: { ultimaSyncMs: diasAtras(1), ultNSU: '000000000000009', maxNSU: '000000000000015' },
            agoraMs: AGORA,
        });
        expect(c.situacao).toBe('adn-entregue');   // leu 9 de 15 — entregou
        expect(c.ultNSU).toBe(9);
        expect(c.maxNSU).toBe(15);
    });
});

describe('o resumo separa pendência de explicação', () => {
    it('sem movimento é contado À PARTE de sem entrega', () => {
        const r = resumirCoberturaNfseNacional([
            coberturaNfseNacional({ aplicavel: false }),
            coberturaNfseNacional({ aplicavel: true, state: null }),
            coberturaNfseNacional({ aplicavel: true, state: { ultimaSyncMs: diasAtras(1), ultNSU: '0', maxNSU: '0' } }),
            coberturaNfseNacional({ aplicavel: true, state: { ultimaSyncMs: diasAtras(1), ultNSU: '0', maxNSU: '9' } }),
            coberturaNfseNacional({ aplicavel: true, state: { ultimaSyncMs: diasAtras(1), ultNSU: '9', maxNSU: '9' } }),
        ]);
        expect(r).toEqual({
            nfseNacTotal: 4,
            nfseNacSemVisita: 1,
            nfseNacNaoLido: 1,
            nfseNacSemMovimento: 1,
            nfseNacEntregue: 1,
        });
    });

    it('lista inválida não explode', () => {
        expect(resumirCoberturaNfseNacional(null).nfseNacTotal).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 A ROTA PERGUNTA AO DONO — e lê o estado UMA VEZ para a carteira inteira.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 a rota de status usa o dono, sem leitura por card', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'sefaz-backend/empresa-status-routes.js'), 'utf8',
    );

    it('chama a régua em vez de decidir por cadastro sozinho', () => {
        expect(src).toMatch(/from '\.\/captura-nfse-nacional-cobertura\.js'/);
        expect(src).toMatch(/coberturaNfseNacional\(/);
    });

    it('lê nfse_nacional_dfe_state uma vez, não por empresa', () => {
        const oc = src.match(/collection\('nfse_nacional_dfe_state'\)/g) || [];
        expect(oc).toHaveLength(1);
    });

    // 🚨 `adn-sem-movimento` NÃO pode derrubar o ok — é explicação, não
    // pendência. Se derrubasse, centenas de empresas ficariam com alarme que
    // ninguém consegue apagar.
    it('sem movimento não derruba o capturaNfseNacionalOk', () => {
        expect(src).toMatch(/\['adn-sem-visita', 'adn-nao-lido'\]\.includes\(coberturaNfseNac\.situacao\)/);
    });
});
