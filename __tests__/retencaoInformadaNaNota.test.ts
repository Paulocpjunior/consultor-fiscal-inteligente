/**
 * 🚨 A RETENÇÃO QUE O CLIENTE ESQUECEU DE INFORMAR — e que o F600 não via.
 *
 * Paulo, 04/09, FRONTINI ENGENHEIROS (NFS-e EMITIDAS, incidência 8/2026):
 * *"ele esqueceu de informar as retenções de 2 notas, já informei que tem que
 * fazer a carta de correção, como eu faço agora no consultor? incluir um campo
 * para informar manual?"*
 *
 * Os números são do print do portal — as duas notas que ele circulou:
 *   · 00000795 · EDIFICIO SEQUOIA ................ 750,00
 *   · 00000794 · CONDOMINIO ED. CASUARINA BL. 3 . 4.200,00
 * As duas foram capturadas com retenção ZERO.
 *
 * 📌 ISTO FECHA UMA PENDÊNCIA NOMEADA EM 31/08: *"o F600 do EFD-Contribuições
 * (a retenção SOFRIDA, que é de nota de SAÍDA) continua com a régua antiga…
 * vale rever com medição própria, nunca de carona."* O caso real chegou.
 *
 * ⚠️ CNPJs FICTÍCIOS: dado de cliente não entra no repositório.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { coletarRetencoesF600 } from '../sefaz-backend/sped-contrib-blocos.js';
import { chaveDoAjuste, retencaoEfetivaDaNota } from '../sefaz-backend/retencao-pj-ajuste.js';
import { linhasRetencoes } from '../services/relatoriosAgregacoes';

const PRESTADOR = '11222333000181';   // a FRONTINI (ela EMITE)
const TOMADOR = '99888777000166';     // o condomínio

/** NFS-e EMITIDA, como o portal de SP a grava: achatada e sem retenção. */
const nfseEmitida = (numero: string, valor: number, over: any = {}) => ({
    id: `doc-${numero}`,
    tipo: 'NFSe',
    numero,
    dhEmi: '2026-08-25',
    competencia: '2026-08',
    direcao: 'saida',
    status: 'autorizado',
    empresaCnpj: PRESTADOR,
    prestadorCnpj: PRESTADOR,
    prestadorNome: 'FRONTINI ENGENHEIROS ASSOCIADOS S/S LTDA',
    tomadorCnpj: TOMADOR,
    tomadorNome: 'CONDOMINIO EDIFICIO CASUARINA BLOCO 3',
    cnpjEmit: PRESTADOR,
    cnpjDest: TOMADOR,
    xNomeDest: 'CONDOMINIO EDIFICIO CASUARINA BLOCO 3',
    valorServicos: valor,
    valorTotal: valor,
    ...over,
});

const ajuste = (over: any = {}) => ({
    pis: 27.3, cofins: 126, csll: 42,
    motivo: 'cliente emitiu sem informar a retenção; carta de correção enviada',
    autor: 'paulo@sp.com.br',
    em: '2026-09-04T12:00:00.000Z',
    ...over,
});

describe('🚨 O F600 passou a honrar o ajuste declarado', () => {
    const nota = nfseEmitida('00000794', 4200);
    const chave = chaveDoAjuste(nota);

    it('a chave do ajuste sai de prestador+número quando a NFS-e não tem chave de 44', () => {
        expect(chave).toBe(`${PRESTADOR}-00000794`);
    });

    it('SEM ajuste a nota fica fora — é o estado de hoje, e ele não regride', () => {
        const r = coletarRetencoesF600([nota], null);
        expect(r.eventos).toHaveLength(0);
        expect(r.totalPis).toBe(0);
    });

    it('COM ajuste a nota entra, com o PIS e o COFINS declarados', () => {
        const r = coletarRetencoesF600([nota], null, { [chave]: ajuste() });
        expect(r.eventos).toHaveLength(1);
        expect(r.eventos[0].pis).toBe(27.3);
        expect(r.eventos[0].cofins).toBe(126);
        expect(r.eventos[0].numero).toBe('00000794');
        expect(r.eventos[0].cnpjFonte).toBe(TOMADOR);
        expect(r.totalPis).toBe(27.3);
        expect(r.totalCofins).toBe(126);
    });

    it('🚨 o número que veio de declaração humana sai DITO nos avisos, com quem declarou', () => {
        const warnings: string[] = [];
        coletarRetencoesF600([nota], warnings, { [chave]: ajuste() });
        const aviso = warnings.find(w => w.includes('AJUSTADA'));
        expect(aviso).toBeTruthy();
        expect(aviso).toMatch(/00000794/);
        expect(aviso).toMatch(/paulo@sp\.com\.br/);
        // O que muda por causa disso tem de estar na frase — o F600 abate o
        // M200/M600, ou seja muda o valor a recolher.
        expect(aviso).toMatch(/M200\/M600/);
    });

    it('a CSLL ajustada NÃO entra no F600 — o registro leva só PIS e COFINS', () => {
        const r = coletarRetencoesF600([nota], null, { [chave]: ajuste() });
        // Régua provada pelo EFD assinado da HS PROJETOS (19/08): somar a CSLL
        // declararia retenção a maior.
        expect(JSON.stringify(r.eventos[0])).not.toMatch(/csll/i);
        expect(r.eventos[0].pis + r.eventos[0].cofins).toBeCloseTo(153.3, 2);
    });

    it('ajuste com PIS e COFINS ZERADOS não força a nota para dentro do F600', () => {
        const r = coletarRetencoesF600([nota], null, {
            [chave]: ajuste({ pis: 0, cofins: 0, csll: 42 }),
        });
        expect(r.eventos).toHaveLength(0);
    });

    it('ajuste de OUTRA nota não contamina esta', () => {
        const r = coletarRetencoesF600([nota], null, { 'chave-de-outra': ajuste() });
        expect(r.eventos).toHaveLength(0);
    });

    it('as duas notas do print entram juntas', () => {
        const n795 = nfseEmitida('00000795', 750);
        const r = coletarRetencoesF600([n795, nota], null, {
            [chaveDoAjuste(n795)]: ajuste({ pis: 4.88, cofins: 22.5 }),
            [chave]: ajuste(),
        });
        expect(r.eventos.map((e: any) => e.numero).sort()).toEqual(['00000794', '00000795']);
        expect(r.totalPis).toBeCloseTo(32.18, 2);
    });

    it('nota de ENTRADA não entra: o F600 é da retenção SOFRIDA (nota de saída)', () => {
        const entrada = nfseEmitida('00000794', 4200, { direcao: 'entrada' });
        const r = coletarRetencoesF600([entrada], null, { [chave]: ajuste() });
        expect(r.eventos).toHaveLength(0);
    });

    it('nota CANCELADA não entra, mesmo com ajuste', () => {
        const cancelada = nfseEmitida('00000794', 4200, { status: 'cancelado' });
        const r = coletarRetencoesF600([cancelada], null, { [chave]: ajuste() });
        expect(r.eventos).toHaveLength(0);
    });

    /**
     * 🚨 A DECOMPOSIÇÃO DA CSRF **NÃO** ENTROU DE CARONA.
     *
     * `retencaoEfetivaDaNota` também sabe decompor a CSRF, e ligar isso junto
     * mudaria o valor do arquivo em notas que hoje ficam de FORA (a assinatura
     * 1,65%+7,60% do tributo da operação). A régua de 31/08 é literal: *vale
     * rever com medição própria, nunca de carona*.
     */
    it('nota com a assinatura da OPERAÇÃO continua FORA quando não há ajuste', () => {
        const atlas = nfseEmitida('00000700', 3413.24, {
            valorPis: 56.32, valorCofins: 259.41, valorCsll: 158.72,
        });
        const warnings: string[] = [];
        const r = coletarRetencoesF600([atlas], warnings, {});
        expect(r.eventos).toHaveLength(0);
        expect(warnings.join(' ')).toMatch(/tributo da OPERAÇÃO/);
    });

    it('…mas o AJUSTE resolve essa mesma nota, porque alguém disse o número', () => {
        const atlas = nfseEmitida('00000700', 3413.24, {
            valorPis: 56.32, valorCofins: 259.41, valorCsll: 158.72,
        });
        const r = coletarRetencoesF600([atlas], null, {
            [chaveDoAjuste(atlas)]: ajuste({ pis: 22.19, cofins: 102.4, csll: 34.13 }),
        });
        expect(r.eventos).toHaveLength(1);
        expect(r.eventos[0].pis).toBe(22.19);
    });
});

describe('📋 O Relatório de Retenções mostra o ajuste — senão a pessoa acha que não gravou', () => {
    const nota = nfseEmitida('00000794', 4200);
    const chave = chaveDoAjuste(nota);

    it('sem ajuste, a nota aparece com "?" (ausente ≠ zero retido)', () => {
        const [l] = linhasRetencoes([nota] as any, 'saida');
        expect(l.retencoesFederaisGravadas).toBe(false);
        expect(l.retencaoAjustada).toBeFalsy();
    });

    it('com ajuste, o "?" some e o número aparece CARIMBADO com quem declarou', () => {
        const [l] = linhasRetencoes([nota] as any, 'saida', { [chave]: ajuste() });
        expect(l.retencoesFederaisGravadas).toBe(true);
        expect(l.retencaoAjustada).toBe(true);
        expect(l.retencaoAjustadaPor).toBe('paulo@sp.com.br');
        expect(l.retencaoAjustadaMotivo).toMatch(/carta de correção/);
        expect(l.pis).toBe(27.3);
        expect(l.cofins).toBe(126);
        expect(l.csll).toBe(42);
    });

    it('o ajuste com IR também aparece — o Relatório leva os cinco tributos', () => {
        const [l] = linhasRetencoes([nota] as any, 'saida', {
            [chave]: ajuste({ ir: 63, pis: undefined, cofins: undefined, csll: undefined }),
        });
        expect(l.ir).toBe(63);
        expect(l.retencaoAjustada).toBe(true);
    });
});

describe('o dono continua ÚNICO — a precedência não mudou', () => {
    it('ajuste declarado vence o documento e carimba a origem', () => {
        const r = retencaoEfetivaDaNota({
            nota: { pis: 0, cofins: 0, base: 4200 },
            ajuste: ajuste(),
        });
        expect(r.origem).toBe('ajuste-declarado');
        expect(r.ajustadoPor).toBe('paulo@sp.com.br');
        expect(r.ressalva).toMatch(/AJUSTADA à mão/);
    });

    it('sem ajuste, a origem continua sendo o documento', () => {
        const r = retencaoEfetivaDaNota({ nota: { pis: 1, cofins: 2, base: 100 } });
        expect(r.origem).not.toBe('ajuste-declarado');
    });
});

/**
 * 🚨 GERADOR QUE LÊ CAMPO QUE NINGUÉM PASSA — o defeito do
 * `saldoCredorIpiAnterior` (19/08, PWR): o E520 saía 0,00 para sempre e nada
 * acusava, porque o gerador lia um campo que nenhum orquestrador preenchia.
 *
 * Aqui o custo é o mesmo: o F600 sairia sem os ajustes, o M200/M600 declararia
 * a recolher A MAIOR, e o arquivo seria ACEITO. Por VARREDURA, nunca por lista.
 */
describe('a ligação de ponta a ponta — o orquestrador PASSA os ajustes', () => {
    const orq = readFileSync(join(__dirname, '..', 'sefaz-backend/sped-contrib-orchestrator.js'), 'utf8');
    const blocos = readFileSync(join(__dirname, '..', 'sefaz-backend/sped-contrib-blocos.js'), 'utf8');

    it('o orquestrador LÊ a coleção dos ajustes', () => {
        expect(orq).toMatch(/reinf_retencoes_ajustadas/);
    });

    it('…e entrega o mapa no objeto que o gerador recebe', () => {
        expect(orq).toMatch(/^\s*retencoesAjustadas,\s*$/m);
    });

    it('TODA chamada de coletarRetencoesF600 recebe os ajustes — nenhuma fica para trás', () => {
        // ⚠️ A varredura nasceu LARGA e acusou a DECLARAÇÃO da função
        // (`export function coletarRetencoesF600(notas, warnings, ajustes)`),
        // que é código CERTO — alarme sobre código certo é o jeito conhecido de
        // a equipe desligar a trava. A assinatura casa só a CHAMADA.
        const chamadas = blocos.match(/(?<!function )coletarRetencoesF600\([^)]*\)/g) || [];
        // 3 chamadas hoje (A100, F600 e o bloco M); nenhuma pode ficar sem.
        expect(chamadas.length).toBeGreaterThanOrEqual(3);
        for (const c of chamadas) expect(c).toMatch(/dados\.retencoesAjustadas/);
    });

    it('falha ao LER os ajustes vira AVISO, nunca "não há ajuste"', () => {
        // Devolver {} numa falha de leitura daria o valor do DOCUMENTO — o
        // número errado que o ajuste corrigiu — sem ninguém saber.
        expect(orq).toMatch(/Não consegui ler os ajustes de retenção/);
        expect(orq).toMatch(/a MENOR neste arquivo/);
    });

    it('ficha e ajuste não se somam, e a divergência é DITA', () => {
        expect(orq).toMatch(/os dois\s*\n?\s*\/\/ não se somam|não se somam/);
    });
});
