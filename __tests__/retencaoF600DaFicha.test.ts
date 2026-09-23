/**
 * 🚨 A RETENÇÃO DA FICHA NÃO CHEGAVA AO ARQUIVO.
 *
 * 28/08, MONICA MOROMIZATO ENDOCRINOLOGIA 01641443000124 · 07/2026: a Memória
 * de Apuração dizia PIS Retido 64,11 · COFINS Retido 295,86, e o M200 do PVA
 * mostrava retenção 0,00 e a recolher 157,38 (o devido é 93,27). O F600 só via
 * a retenção GRAVADA NO DOCUMENTO, e só uma nota tinha o campo — ainda por
 * cima errado (12,44 = a CSRF inteira jogada em COFINS).
 *
 * Paulo autorizou montar o F600 a partir da ficha. A fonte é ela porque é ela
 * que alimenta a GUIA: calcular aqui faria o DARF e o SPED declararem números
 * diferentes sobre o mesmo fato.
 */
// @ts-expect-error — módulo .js puro
import { montarF600DaFicha, notasQueAncoramRetencao, ratearEmCentavos, retencaoDaFicha } from '../sefaz-backend/retencao-f600-da-ficha.js';

/** As notas REAIS da MONICA que decidem o caso (as três de tomador PJ + uma PF). */
const nota = (over: any = {}) => ({ direcao: 'saida', status: 'autorizado', ...over });
const NOTAS_MONICA = [
    nota({ numero: '9901', cnpjDest: '23399329001810', valorTotal: 9148.99 }),
    nota({ numero: '9900', cnpjDest: '62465117000106', valorTotal: 445.59 }),
    nota({ numero: '9899', cnpjDest: '02725347000127', valorTotal: 267.46 }),
    nota({ numero: '9930', cnpjDest: '01602520836', valorTotal: 1000.00 }),  // CPF
];
const FICHA_MONICA = { retencaoPis: 64.11, retencaoCofins: 295.86 };

describe('🚨 o caso MONICA MOROMIZATO', () => {
    it('o total do F600 fecha EXATAMENTE com a ficha — é o mesmo número da guia', () => {
        const r = montarF600DaFicha({ notas: NOTAS_MONICA, ficha: FICHA_MONICA });
        expect(r.aplicou).toBe(true);
        expect(r.totalPis).toBeCloseTo(64.11, 2);
        expect(r.totalCofins).toBeCloseTo(295.86, 2);
    });

    // ⚠️ Retenção do art. 30 da Lei 10.833/2003 é de PJ para PJ. Ratear sobre
    // nota de PF poria retenção em documento que não a comporta.
    it('a nota de tomador PF fica FORA', () => {
        const r = montarF600DaFicha({ notas: NOTAS_MONICA, ficha: FICHA_MONICA });
        expect(r.eventos).toHaveLength(3);
        expect(r.eventos.map((e: any) => e.numero)).not.toContain('9930');
    });

    it('cada evento leva o CNPJ da fonte pagadora — sem ele não há F600', () => {
        const r = montarF600DaFicha({ notas: NOTAS_MONICA, ficha: FICHA_MONICA });
        for (const e of r.eventos) expect(String(e.cnpjFonte)).toHaveLength(14);
    });

    // 📌 Número DERIVADO não se apresenta como fato lido do documento.
    it('o evento carimba a ORIGEM, e o aviso DIZ que veio da ficha', () => {
        const r = montarF600DaFicha({ notas: NOTAS_MONICA, ficha: FICHA_MONICA });
        expect(r.eventos[0].origem).toBe('ficha-rateada');
        expect(r.avisos.join(' ')).toMatch(/veio da FICHA/);
        expect(r.avisos.join(' ')).toMatch(/CSLL retida fica fora/);
    });
});

describe('quando a ficha NÃO declara retenção', () => {
    // ⚠️ Sem número na ficha nada muda: o caminho antigo (ler o documento)
    // continua valendo, e o app não inventa retenção.
    it('não aplica — e não gera evento nenhum', () => {
        const r = montarF600DaFicha({ notas: NOTAS_MONICA, ficha: { retencaoPis: 0, retencaoCofins: 0 } });
        expect(r.aplicou).toBe(false);
        expect(r.eventos).toEqual([]);
        expect(r.avisos).toEqual([]);
    });

    it('ficha ausente também não aplica', () => {
        expect(montarF600DaFicha({ notas: NOTAS_MONICA, ficha: null }).aplicou).toBe(false);
        expect(montarF600DaFicha({ notas: NOTAS_MONICA, ficha: undefined }).aplicou).toBe(false);
    });

    it('valor negativo na ficha não vira retenção', () => {
        expect(retencaoDaFicha({ retencaoPis: -5, retencaoCofins: 10 })).toEqual({ pis: 0, cofins: 10 });
    });
});

// 🚨 RETENÇÃO SEM NOTA QUE A ANCORE não pode virar silêncio: o M200 vai
// declarar A MAIOR e alguém precisa saber.
describe('retenção sem nota para ancorar', () => {
    it('não gera F600 e DIZ que o arquivo está declarando a maior', () => {
        const r = montarF600DaFicha({ notas: [], ficha: FICHA_MONICA });
        expect(r.aplicou).toBe(false);
        expect(r.avisos.join(' ')).toMatch(/NENHUMA nota de saída com tomador PJ/);
        expect(r.avisos.join(' ')).toMatch(/declarando A MAIOR/);
    });

    it('só notas de PF também não ancoram', () => {
        const r = montarF600DaFicha({
            notas: [nota({ numero: '1', cnpjDest: '01602520836', valorTotal: 500 })],
            ficha: FICHA_MONICA,
        });
        expect(r.aplicou).toBe(false);
    });
});

describe('quem pode ancorar a retenção', () => {
    it('entrada não ancora — a retenção sofrida é do que a empresa PRESTOU', () => {
        expect(notasQueAncoramRetencao([
            nota({ numero: '1', direcao: 'entrada', cnpjEmit: '23399329001810', valorTotal: 100 }),
        ])).toEqual([]);
    });

    it('cancelada não ancora', () => {
        expect(notasQueAncoramRetencao([
            nota({ numero: '1', cnpjDest: '23399329001810', valorTotal: 100, status: 'cancelado' }),
        ])).toEqual([]);
    });

    it('sem valor legível não ancora — campo de valor não recebe default', () => {
        expect(notasQueAncoramRetencao([
            nota({ numero: '1', cnpjDest: '23399329001810' }),
        ])).toEqual([]);
    });

    // ⚠️ A ordem é DETERMINÍSTICA: a sobra de centavos vai ao ÚLTIMO, e sem
    // ordem fixa dois arquivos da mesma competência sairiam diferentes.
    it('ordena por base decrescente, com desempate estável', () => {
        const r = notasQueAncoramRetencao([
            nota({ numero: 'B', cnpjDest: '23399329001810', valorTotal: 100 }),
            nota({ numero: 'A', cnpjDest: '23399329001810', valorTotal: 100 }),
            nota({ numero: 'C', cnpjDest: '23399329001810', valorTotal: 900 }),
        ]);
        expect(r.map((n: any) => n.numero)).toEqual(['C', 'A', 'B']);
    });
});

describe('o rateio fecha na unidade', () => {
    // 🚨 A soma das partes tem de bater EXATAMENTE com o total: se o F600 não
    // fecha com o M200, o PVA acusa.
    // ⚠️ A sobra vai à MAIOR base (a primeira, pela ordenação) — e não ao
    // último como no rateio de desconto do C170. Com a lista em ordem
    // decrescente, "o último" é a MENOR nota, e um centavo de sobra nela
    // declararia retenção desproporcional.
    it('a sobra de centavos vai à maior base', () => {
        expect(ratearEmCentavos(10, [1, 1, 1])).toEqual([334, 333, 333]);
        expect(ratearEmCentavos(10, [1, 1, 1]).reduce((t: number, p: number) => t + p, 0)).toBe(1000);
    });

    it('total zero devolve zeros', () => {
        expect(ratearEmCentavos(0, [10, 20])).toEqual([0, 0]);
    });

    it('base zerada não divide por zero', () => {
        expect(ratearEmCentavos(10, [0, 0])).toEqual([0, 0]);
    });

    // Nota que ficaria com 0,00 nos dois não vira registro — F600 com valor
    // zero é linha sem conteúdo (a mesma classe do M205 zerado, 28/08).
    it('nota que fica com zero nos dois não vira evento', () => {
        const r = montarF600DaFicha({
            notas: [
                nota({ numero: 'GRANDE', cnpjDest: '23399329001810', valorTotal: 1000000 }),
                nota({ numero: 'MIGALHA', cnpjDest: '62465117000106', valorTotal: 0.01 }),
            ],
            ficha: { retencaoPis: 0.02, retencaoCofins: 0 },
        });
        expect(r.eventos.map((e: any) => e.numero)).toEqual(['GRANDE']);
        expect(r.totalPis).toBeCloseTo(0.02, 2);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 O ORQUESTRADOR TEM DE CHAMAR O DONO — gerador que lê campo que ninguém
// passa foi o defeito do `saldoCredorIpiAnterior` (19/08, PWR): o registro
// simplesmente nunca saía, e nada acusava. Aqui o sintoma seria pior: o
// arquivo volta a declarar A MAIOR, calado.
// ════════════════════════════════════════════════════════════════════════════
describe('a ligação com o orquestrador', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src = fs.readFileSync(
        path.resolve(__dirname, '..', 'sefaz-backend/sped-contrib-orchestrator.js'), 'utf8',
    );

    it('o orquestrador chama o dono e entrega o resultado em `retencoesF600`', () => {
        expect(src).toMatch(/montarF600DaFicha/);
        expect(src).toMatch(/retencoesF600:/);
    });

    // 📌 A ficha da COMPETÊNCIA vem do dono (`acharFichaCompetencia`) — ler o
    // array cru aqui repetiria a armadilha das três formas do `mesReferencia`.
    it('a ficha vem do dono da competência', () => {
        expect(src).toMatch(/montarF600DaFicha\(\{\s*notas,\s*ficha:\s*fichaDaComp\s*\}\)/);
    });

    // ⚠️ E os avisos entram DEPOIS do array existir: `warnings` só nasce no
    // meio da função, e empilhar acima seria ReferenceError (20/08).
    it('os avisos são empilhados depois de `warnings` existir', () => {
        const iWarnings = src.indexOf('const warnings = [];');
        const iAviso = src.indexOf('warnings.push(...retencaoDaFicha.avisos)');
        expect(iWarnings).toBeGreaterThan(-1);
        expect(iAviso).toBeGreaterThan(iWarnings);
    });
});
