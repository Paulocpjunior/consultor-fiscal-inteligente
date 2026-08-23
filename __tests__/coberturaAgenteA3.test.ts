// ============================================================================
// 🚨 "✓ CAPTURA OK" SAÍA DE UM CAMPO DE CADASTRO — em 202 empresas
//
// `capturaNfeOk` incluía `temA3Proprio = tipoCert === 'A3' && certUploaded`, e
// a tela imprimia **✓ Captura OK** a partir disso. Ou seja: alguém marcou A3 no
// cadastro ⇒ o painel AFIRMA que a captura está boa — sem nada olhar se o
// agente local `cfi-a3`, que é quem de fato captura essas empresas, alguma vez
// entregou um documento.
//
// É a primeira regra permanente do projeto invertida (*"validação por
// RESULTADO, não por status"*), na tela para onde o farol de lastro e a Rotina
// do Mês passaram a mandar essas mesmas 202 empresas.
//
// ⚠️ As DUAS travas de linguagem que este teste guarda:
//   (1) **ausência não é prova** — `sefaz_state.ultimaSync` só é gravado quando
//       o agente trouxe NSU, então "sem entrega" prova que documento nenhum
//       chegou por ele, NUNCA que ele não rodou. Por isso ÂMBAR, não vermelho:
//       vermelho afirmaria o que o app não mediu.
//   (2) **nenhum SLA inventado** — o app não conhece a agenda do agente, então
//       "entregou há muito tempo" não vira veredito de "parado". A régua
//       entrega a DATA; quem julga é quem lê.
// ============================================================================
import { coberturaAgenteA3, resumirCoberturaA3, FONTE_AGENTE_A3 } from '../sefaz-backend/captura-a3-cobertura';

const HOJE = Date.parse('2026-08-23T12:00:00Z');
const dias = (n: number) => HOJE - n * 24 * 60 * 60 * 1000;

describe('🚨 empresa A3: a tela não pode afirmar captura a partir do cadastro', () => {
    it('marcada A3 e sem NENHUMA entrega do agente NÃO é verde', () => {
        const c = coberturaAgenteA3({ tipoCert: 'A3', certUploaded: true, agoraMs: HOJE });
        expect(c.situacao).toBe('a3-sem-entrega');
        expect(c.cor).not.toBe('ok');
        expect(c.cor).toBe('atencao');
        expect(c.texto).toMatch(/nunca entregou/i);
    });

    // ⚠️ Ausência não é prova: rodada sem movimento não deixa registro. A frase
    // NÃO pode afirmar que o agente não rodou.
    it('e a frase não afirma que o agente não rodou — só que nada chegou por ele', () => {
        const c = coberturaAgenteA3({ tipoCert: 'A3', certUploaded: true, agoraMs: HOJE });
        expect(c.acao).toMatch(/não prova que ele não rodou/i);
        expect(c.acao).toMatch(/cfi-a3/);
    });

    it('com entrega do agente fica verde e DIZ a data', () => {
        const c = coberturaAgenteA3({
            tipoCert: 'A3', certUploaded: true,
            ultimaSyncMs: dias(3), ultimaSyncFonte: FONTE_AGENTE_A3, agoraMs: HOJE,
        });
        expect(c.situacao).toBe('a3-entregue');
        expect(c.cor).toBe('ok');
        expect(c.diasDesdeEntrega).toBe(3);
        expect(c.texto).toMatch(/última entrega em \d{2}\/\d{2}\/\d{4}/);
    });

    // 🚨 A ARMADILHA DAS DUAS FORMAS, aqui entre dois ESCRITORES do mesmo
    // campo: uma sync ANTIGA do cron em nuvem não prova o agente local.
    it('sync de OUTRA fonte não conta como entrega do agente', () => {
        const c = coberturaAgenteA3({
            tipoCert: 'A3', certUploaded: true,
            ultimaSyncMs: dias(1), ultimaSyncFonte: 'cloud', agoraMs: HOJE,
        });
        expect(c.situacao).toBe('a3-sem-entrega');
    });

    // ⚠️ Sem SLA inventado: entrega antiga continua sendo entrega, com o número
    // de dias na frase. Cravar uma janela aqui seria inventar prazo.
    it('entrega antiga NÃO vira veredito de "parado" — devolve o fato', () => {
        const c = coberturaAgenteA3({
            tipoCert: 'A3', certUploaded: true,
            ultimaSyncMs: dias(180), ultimaSyncFonte: FONTE_AGENTE_A3, agoraMs: HOJE,
        });
        expect(c.situacao).toBe('a3-entregue');
        expect(c.diasDesdeEntrega).toBe(180);
        expect(c.texto).toMatch(/há 180 dias/);
    });
});

describe('a régua não opina sobre os outros caminhos de captura', () => {
    it.each(['A1', 'A1-raiz', 'escritorio', 'nenhum', null, undefined])(
        'tipoCert %s cai em nao-se-aplica, neutro',
        (tipoCert) => {
            const c = coberturaAgenteA3({ tipoCert: tipoCert as string, certUploaded: true, agoraMs: HOJE });
            expect({ s: c.situacao, cor: c.cor, ehA3: c.ehA3 })
                .toEqual({ s: 'nao-se-aplica', cor: 'neutro', ehA3: false });
        },
    );

    // Marcação A3 sem arquivo é outro problema (cadastro incompleto), e quem
    // responde por ele é a lista de bloqueios — não esta régua.
    it('A3 marcada sem certificado subido não é assunto desta régua', () => {
        const c = coberturaAgenteA3({ tipoCert: 'A3', certUploaded: false, agoraMs: HOJE });
        expect(c.situacao).toBe('nao-se-aplica');
    });
});

describe('o cabeçalho conta o que o "✓ Captura OK" escondia', () => {
    it('resume só as A3, separando quem entregou de quem nunca entregou', () => {
        const cs = [
            coberturaAgenteA3({ tipoCert: 'A3', certUploaded: true, agoraMs: HOJE }),
            coberturaAgenteA3({ tipoCert: 'A3', certUploaded: true, agoraMs: HOJE }),
            coberturaAgenteA3({
                tipoCert: 'A3', certUploaded: true,
                ultimaSyncMs: dias(2), ultimaSyncFonte: FONTE_AGENTE_A3, agoraMs: HOJE,
            }),
            coberturaAgenteA3({ tipoCert: 'A1', certUploaded: true, agoraMs: HOJE }),
        ];
        expect(resumirCoberturaA3(cs)).toEqual({ a3Total: 3, a3SemEntrega: 2, a3ComEntrega: 1 });
    });

    it('entrada vazia ou torta não explode o painel da carteira inteira', () => {
        expect(resumirCoberturaA3([])).toEqual({ a3Total: 0, a3SemEntrega: 0, a3ComEntrega: 0 });
        // @ts-expect-error — entrada deliberadamente inválida
        expect(resumirCoberturaA3(null)).toEqual({ a3Total: 0, a3SemEntrega: 0, a3ComEntrega: 0 });
        expect(resumirCoberturaA3([null, undefined])).toEqual({ a3Total: 0, a3SemEntrega: 0, a3ComEntrega: 0 });
    });
});

describe('🚨 a rota entrega a cobertura, e lê a FONTE da sync', () => {
    const fonte = require('fs').readFileSync('sefaz-backend/empresa-status-routes.js', 'utf8');

    // Campo fora da leitura some da régua: sem `ultimaSyncFonte` no stateMap,
    // sync do cron passaria por entrega do agente.
    it('o stateMap carrega ultimaSyncFonte', () => {
        expect(fonte).toMatch(/ultimaSyncFonte:\s*d\.ultimaSyncFonte/);
    });

    it('a rota chama o DONO e devolve coberturaA3 no item', () => {
        expect(fonte).toMatch(/coberturaAgenteA3\(\{/);
        expect(fonte).toMatch(/^\s*coberturaA3,\s*$/m);
    });

    // A tela não pode voltar a imprimir o verde absoluto para A3.
    it('a tela ramifica o "✓ Captura OK" pela cobertura do agente', () => {
        const tela = require('fs').readFileSync('components/EmpresasStatusCapturaPanel.tsx', 'utf8');
        expect(tela).toMatch(/coberturaA3\?\.ehA3/);
        expect(tela).toMatch(/a3-sem-entrega/);
    });
});

// ============================================================================
// 🚨 MEIA CORREÇÃO AQUI PRODUZ O DEFEITO QUE A CASA MAIS PAGA.
//
// `capturaNfeOk` responde "existe CAMINHO?", e para a A3 existe (o agente
// local) — então o PILL, o KPI, o filtro "tudo OK" e o CSV continuavam
// dizendo verde/sim. Com a linha de texto ao lado dizendo "⚠ nunca entregou",
// seriam DUAS LEITURAS DO MESMO FATO NA MESMA TELA.
//
// Corrigir só a frase e deixar o pill verde é pior que não corrigir: a tela
// passa a se contradizer, e quem lê escolhe a metade que preferir.
// ============================================================================
describe('🚨 os quatro leitores do "OK" concordam com a cobertura', () => {
    const tela = require('fs').readFileSync('components/EmpresasStatusCapturaPanel.tsx', 'utf8');
    const svc = require('fs').readFileSync('services/empresaStatusCapturaService.ts', 'utf8');

    it('o PILL tem terceiro estado, e o alerta VENCE o ok', () => {
        // Sem isso o pill sai verde ao lado do texto âmbar.
        expect(tela).toMatch(/alerta\?:\s*boolean/);
        expect(tela).toMatch(/alerta\s*\?\s*'bg-amber/);
        expect(tela).toMatch(/alerta=\{e\.coberturaA3\?\.situacao === 'a3-sem-entrega'\}/);
    });

    it('o filtro "tudo OK" exclui a A3 sem entrega', () => {
        // Este filtro existe para a pessoa PARAR de olhar essas empresas.
        expect(tela).toMatch(/case 'ok-tudo':[\s\S]{0,200}coberturaA3\?\.situacao !== 'a3-sem-entrega'/);
    });

    it('o KPI mostra o número que o verde escondia, e ele filtra', () => {
        expect(tela).toMatch(/r\.a3SemEntrega/);
        expect(tela).toMatch(/setFiltro\('a3-sem-entrega'\)/);
    });

    it('o CSV leva a coluna — exportar não pode perder a ressalva', () => {
        expect(svc).toMatch(/'Agente A3 entregou'/);
        expect(svc).toMatch(/a3-sem-entrega' \? 'NUNCA'/);
    });
});
